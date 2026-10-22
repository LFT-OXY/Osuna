import { mkdtemp, rm } from "node:fs/promises";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { BALANCE_VENDOR_URLS, type BalanceVendorId } from "../api-endpoints/balance.js";

/*
 * 接口的余额（工单 01、02）：真实 daemon + 本机假 DeepSeek 余额接口，时钟注入。
 * 厂商表里 DeepSeek 的真实地址换成本机假服务；接口地址照真实的 api.deepseek.com 写，daemon 按主机名认出它。
 */

const KEY = "sk-deepseek-balance-secret";
const NOW = Date.parse("2026-10-22T08:00:00.000Z");
const VERSION = "0.17.0-test";

type Reply = (response: ServerResponse) => void;

interface FakeDeepSeek {
  balanceUrl: string;
  requests: { method: string; url: string; headers: IncomingHttpHeaders }[];
  reply: Reply;
}

const tempRoots: string[] = [];
const servers: Server[] = [];

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

const DEEPSEEK_BALANCE = {
  is_available: true,
  balance_infos: [
    {
      currency: "CNY",
      total_balance: "110.00",
      granted_balance: "10.00",
      topped_up_balance: "100.00",
    },
  ],
};

async function startDeepSeek(): Promise<FakeDeepSeek> {
  const fake: FakeDeepSeek = {
    balanceUrl: "",
    requests: [],
    reply: (response) => sendJson(response, 200, DEEPSEEK_BALANCE),
  };
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      fake.requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
      });
      fake.reply(response);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.balanceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/user/balance`;
  return fake;
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("API endpoint balance over the daemon RPC", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let deepseek: FakeDeepSeek;

  async function startDaemon(balanceUrls: Partial<Record<BalanceVendorId, string>>) {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-balance-"));
    tempRoots.push(root);
    daemon = await createTestPaseoDaemon({
      daemonVersion: VERSION,
      apiEndpoints: {
        env: { CLAUDE_CONFIG_DIR: path.join(root, "claude"), CODEX_HOME: path.join(root, "codex") },
        homeDir: root,
        now: () => new Date(NOW),
        balanceUrls,
      },
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.17.0" });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
  }

  beforeEach(async () => {
    deepseek = await startDeepSeek();
    await startDaemon({ deepseek: deepseek.balanceUrl });
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    await Promise.all(servers.splice(0).map(closeServer));
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function save(input: {
    name: string;
    baseUrl: string;
    apiKey?: string;
    headers?: Record<string, string>;
  }): Promise<string> {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: input.name,
      baseUrl: input.baseUrl,
      ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
      ...(input.headers === undefined ? {} : { headers: input.headers }),
      models: [{ id: "deepseek-chat" }],
      defaultModelId: "deepseek-chat",
    });
    expect(saved.error).toBeNull();
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    return saved.endpoint.id;
  }

  function saveDeepSeek(headers?: Record<string, string>): Promise<string> {
    return save({
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKey: KEY,
      headers,
    });
  }

  async function readOne(endpointId: string) {
    const answer = await client.apiEndpointReadBalance({ endpointIds: [endpointId] });
    expect(answer.error).toBeNull();
    expect(answer.readings).toHaveLength(1);
    return answer.readings[0]!;
  }

  test("an endpoint on api.deepseek.com shows its balance, asked with its key and Osuna's own name", async () => {
    const id = await saveDeepSeek();
    const reading = await readOne(id);
    expect(reading).toEqual({
      endpointId: id,
      status: "ok",
      items: [
        { label: null, text: "¥110.00", value: 110, unit: "CNY" },
        { label: "Granted", text: "¥10.00", value: 10, unit: "CNY", part: "granted" },
        { label: "Topped up", text: "¥100.00", value: 100, unit: "CNY", part: "topped_up" },
      ],
      readAt: new Date(NOW).toISOString(),
      failure: null,
    });
    expect(deepseek.requests).toHaveLength(1);
    const [sent] = deepseek.requests;
    expect(sent?.method).toBe("GET");
    expect(sent?.url).toBe("/user/balance");
    expect(sent?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(sent?.headers.accept).toBe("application/json");
    expect(sent?.headers["user-agent"]).toBe(`Osuna/${VERSION}`);
  });

  test("a currency other than yuan or dollars is written with its code, two decimals", async () => {
    deepseek.reply = (response) =>
      sendJson(response, 200, { balance_infos: [{ currency: "eur", total_balance: 3.5 }] });
    const reading = await readOne(await saveDeepSeek());
    expect(reading.items).toEqual([{ label: null, text: "EUR 3.50", value: 3.5, unit: "EUR" }]);
  });

  test("the endpoint's own headers go along, and one the user set wins over Osuna's name", async () => {
    const id = await saveDeepSeek({ "User-Agent": "my-own-agent", "X-Team": "blue" });
    expect((await readOne(id)).status).toBe("ok");
    const [sent] = deepseek.requests;
    expect(sent?.headers["user-agent"]).toBe("my-own-agent");
    expect(sent?.headers["x-team"]).toBe("blue");
  });

  test("an endpoint whose vendor is not known, or one with no key, asks nothing and says it is not supported", async () => {
    const relay = await save({
      name: "Relay",
      baseUrl: "https://relay.example/anthropic",
      apiKey: KEY,
    });
    const keyless = await save({ name: "DeepSeek no key", baseUrl: "https://api.deepseek.com" });
    const answer = await client.apiEndpointReadBalance({
      endpointIds: [relay, keyless, "ep_missing"],
    });
    expect(answer.readings).toEqual([
      { endpointId: relay, status: "unsupported", items: [], readAt: null, failure: null },
      { endpointId: keyless, status: "unsupported", items: [], readAt: null, failure: null },
    ]);
    expect(deepseek.requests).toHaveLength(0);
  });

  async function failureOf(reply: Reply) {
    deepseek.reply = reply;
    const reading = await readOne(await saveDeepSeek());
    expect(reading.status).toBe("failed");
    expect(reading.items).toEqual([]);
    expect(reading.readAt).toBe(new Date(NOW).toISOString());
    return reading.failure;
  }

  test("a 404 page, or a reply that is not JSON, is the wrong address and quotes nothing", async () => {
    expect(
      await failureOf((response) =>
        response.writeHead(404, { "content-type": "text/html" }).end("<html>Not Found</html>"),
      ),
    ).toEqual({ reason: "wrong_url", detail: null, status: 404 });
    expect(
      await failureOf((response) =>
        response.writeHead(200, { "content-type": "text/html" }).end("<html>Welcome</html>"),
      ),
    ).toEqual({ reason: "wrong_url", detail: null, status: 200 });
  });

  test("a refused key is token rejected, with the vendor's words and the key masked", async () => {
    const failure = await failureOf((response) =>
      sendJson(response, 401, {
        error: { message: `Authentication Fails, Your api key: ${KEY} is invalid` },
      }),
    );
    expect(failure?.reason).toBe("token_rejected");
    expect(failure?.status).toBe(401);
    expect(failure?.detail).toContain("Authentication Fails");
    expect(failure?.detail).not.toContain(KEY);
    expect(failure?.detail).toContain("***");
  });

  test("success:false is a refusal whatever the status, said in the vendor's message", async () => {
    expect(
      await failureOf((response) =>
        sendJson(response, 200, { success: false, message: "无权进行此操作" }),
      ),
    ).toEqual({ reason: "token_rejected", detail: "无权进行此操作", status: 200 });
  });

  test("a JSON reply with no balance in it has no value", async () => {
    expect(await failureOf((response) => sendJson(response, 200, { balance_infos: [] }))).toEqual({
      reason: "no_value",
      detail: null,
      status: 200,
    });
  });

  test("a busy vendor is temporary, quoting at most 200 characters of what it said", async () => {
    const failure = await failureOf((response) =>
      sendJson(response, 503, { error: { message: "x".repeat(400) } }),
    );
    expect(failure?.reason).toBe("temporary");
    expect(failure?.status).toBe(503);
    expect(failure?.detail?.length).toBeLessThanOrEqual(201);
    expect(failure?.detail?.endsWith("…")).toBe(true);
  });

  test("a rate limit is temporary", async () => {
    const failure = await failureOf((response) =>
      sendJson(response, 429, { error: { message: "Too many requests" } }),
    );
    expect(failure).toEqual({ reason: "temporary", detail: "Too many requests", status: 429 });
  });

  test("a header of the endpoint's own that cannot be sent asks nothing and says which header", async () => {
    const reading = await readOne(await saveDeepSeek({ "X-Team": "blue\nred" }));
    expect(deepseek.requests).toHaveLength(0);
    expect(reading.status).toBe("failed");
    expect(reading.failure?.reason).toBe("temporary");
    expect(reading.failure?.status).toBeNull();
    expect(reading.failure?.detail).toContain("X-Team");
  });

  test("a vendor that cannot be reached is temporary, with no status", async () => {
    await client.close();
    await daemon.close();
    // 本机没人听的端口：连不上。
    await startDaemon({ deepseek: "http://127.0.0.1:9/user/balance" });
    const reading = await readOne(await saveDeepSeek());
    expect(reading.status).toBe("failed");
    expect(reading.failure?.reason).toBe("temporary");
    expect(reading.failure?.status).toBeNull();
    expect(reading.failure?.detail).toBeTruthy();
  });
});

/** 本机假厂商站点：请求读完后交给 answer，回本机地址。 */
async function startVendorSite(
  answer: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => answer(request, response));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/*
 * 工单 02：其余按地址认的厂商。一个本机假服务扮演所有厂商：厂商表里每家的地址换成
 * 「假服务 + 厂商 id + 真实路径」，于是请求的路径能对出问的是哪家、哪个路径。
 */
describe("API endpoint balance of the other known vendors", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let origin: string;
  const requests: { url: string; headers: IncomingHttpHeaders }[] = [];
  const replies = new Map<string, Reply>();

  function pathOf(vendor: BalanceVendorId): string {
    return `/${vendor}${new URL(BALANCE_VENDOR_URLS[vendor]).pathname}`;
  }

  beforeEach(async () => {
    requests.length = 0;
    replies.clear();
    origin = await startVendorSite((request, response) => {
      const url = request.url ?? "";
      requests.push({ url, headers: request.headers });
      const reply = replies.get(url);
      if (reply) reply(response);
      else sendJson(response, 404, { error: { message: `no fake reply for ${url}` } });
    });
    const vendors = Object.keys(BALANCE_VENDOR_URLS) as BalanceVendorId[];
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-balance-vendors-"));
    tempRoots.push(root);
    daemon = await createTestPaseoDaemon({
      daemonVersion: VERSION,
      apiEndpoints: {
        env: { CLAUDE_CONFIG_DIR: path.join(root, "claude"), CODEX_HOME: path.join(root, "codex") },
        homeDir: root,
        now: () => new Date(NOW),
        balanceUrls: Object.fromEntries(
          vendors.map((vendor) => [vendor, `${origin}${pathOf(vendor)}`]),
        ),
      },
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.17.0" });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    await Promise.all(servers.splice(0).map(closeServer));
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function readAt(baseUrl: string, apiKey: string | null = KEY) {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: `Vendor ${baseUrl}`,
      baseUrl,
      ...(apiKey === null ? {} : { apiKey }),
      models: [{ id: "some-model" }],
      defaultModelId: "some-model",
    });
    expect(saved.error).toBeNull();
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    const answer = await client.apiEndpointReadBalance({ endpointIds: [saved.endpoint.id] });
    expect(answer.error).toBeNull();
    return answer.readings[0]!;
  }

  test("each vendor is asked at its own balance query, as magpie asks it", () => {
    expect(BALANCE_VENDOR_URLS).toEqual({
      deepseek: "https://api.deepseek.com/user/balance",
      moonshot_cn: "https://api.moonshot.cn/v1/users/me/balance",
      moonshot_ai: "https://api.moonshot.ai/v1/users/me/balance",
      openrouter: "https://openrouter.ai/api/v1/credits",
      siliconflow_cn: "https://api.siliconflow.cn/v1/user/info",
      siliconflow_com: "https://api.siliconflow.com/v1/user/info",
      stepfun_com: "https://api.stepfun.com/v1/accounts",
      stepfun_ai: "https://api.stepfun.ai/v1/accounts",
      commandcode: "https://api.commandcode.ai/alpha/billing/credits",
      ollama: "https://ollama.com/api/balance",
      aihubmix: "https://aihubmix.com/dashboard/billing/remain",
    });
  });

  test.each([
    {
      vendor: "moonshot_cn",
      baseUrl: "https://api.moonshot.cn/anthropic",
      body: { code: 0, data: { available_balance: 49.58 }, status: true },
      item: { label: null, text: "¥49.58", value: 49.58, unit: "CNY" },
    },
    {
      vendor: "moonshot_ai",
      baseUrl: "https://api.moonshot.ai/anthropic",
      body: { code: 0, data: { available_balance: "12.5" }, status: true },
      item: { label: null, text: "$12.50", value: 12.5, unit: "USD" },
    },
    {
      vendor: "openrouter",
      baseUrl: "https://openrouter.ai/api",
      body: { data: { total_credits: 20, total_usage: 3.5 } },
      item: { label: null, text: "$16.50", value: 16.5, unit: "USD" },
    },
    {
      vendor: "siliconflow_cn",
      baseUrl: "https://api.siliconflow.cn",
      body: { code: 20000, data: { totalBalance: "88.88" } },
      item: { label: null, text: "¥88.88", value: 88.88, unit: "CNY" },
    },
    {
      vendor: "siliconflow_com",
      baseUrl: "https://api.siliconflow.com",
      body: { code: 20000, data: { totalBalance: 3 } },
      item: { label: null, text: "$3.00", value: 3, unit: "USD" },
    },
    {
      vendor: "stepfun_com",
      baseUrl: "https://api.stepfun.com",
      body: { object: "account", balance: 26, total_cash_balance: 0, total_voucher_balance: 26 },
      item: { label: null, text: "¥26.00", value: 26, unit: "CNY" },
    },
    {
      vendor: "stepfun_ai",
      baseUrl: "https://api.stepfun.ai",
      body: { object: "account", balance: 1.234 },
      item: { label: null, text: "$1.23", value: 1.234, unit: "USD" },
    },
    {
      vendor: "commandcode",
      baseUrl: "https://api.commandcode.ai",
      // 三项之和，负数按 0 算。
      body: { credits: { monthlyCredits: 41.2, purchasedCredits: 5, freeCredits: -1 } },
      item: { label: null, text: "$46.20", value: 46.2, unit: "USD" },
    },
    {
      vendor: "ollama",
      baseUrl: "https://ollama.com",
      body: {
        included: { balance_usd: 72.5, allowance_usd: 100 },
        purchased: { balance_usd: 25 },
      },
      item: { label: null, text: "$25.00", value: 25, unit: "USD" },
    },
    {
      vendor: "aihubmix",
      baseUrl: "https://aihubmix.com",
      body: { object: "list", total_usage: 12.5 },
      item: { label: null, text: "$12.50", value: 12.5, unit: "USD" },
    },
  ] as const)(
    "an endpoint at $baseUrl shows $item.text, asked with its key and Osuna's own name",
    async ({ vendor, baseUrl, body, item }) => {
      replies.set(pathOf(vendor), (response) => sendJson(response, 200, body));
      const reading = await readAt(baseUrl);
      expect(reading.status).toBe("ok");
      expect(reading.items).toEqual([item]);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(pathOf(vendor));
      expect(requests[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
      expect(requests[0]?.headers["user-agent"]).toBe(`Osuna/${VERSION}`);
    },
  );

  test("DeepSeek lists every currency, those with money first then by code, and splits the granted from the topped up", async () => {
    replies.set(pathOf("deepseek"), (response) =>
      sendJson(response, 200, {
        is_available: true,
        balance_infos: [
          {
            currency: "USD",
            total_balance: "0.00",
            granted_balance: "0.00",
            topped_up_balance: "0.00",
          },
          { currency: "EUR", total_balance: "5.00" },
          {
            currency: "CNY",
            total_balance: "110.00",
            granted_balance: "10.00",
            topped_up_balance: "100.00",
          },
          { currency: "HKD", total_balance: "2.00", granted_balance: "0", topped_up_balance: "2" },
        ],
      }),
    );
    const reading = await readAt("https://api.deepseek.com/anthropic");
    expect(reading.items).toEqual([
      { label: null, text: "¥110.00 · EUR 5.00 · HKD 2.00 · $0.00", value: 110, unit: "CNY" },
      { label: "Granted", text: "¥10.00", value: 10, unit: "CNY", part: "granted" },
      { label: "Topped up", text: "¥100.00", value: 100, unit: "CNY", part: "topped_up" },
    ]);
  });

  test("SiliconFlow's retired query says to read the balance on its console", async () => {
    replies.set(pathOf("siliconflow_cn"), (response) =>
      sendJson(response, 410, {
        code: 20092,
        message: "This endpoint is deprecated and is no longer available.",
        data: null,
      }),
    );
    const reading = await readAt("https://api.siliconflow.cn");
    expect(reading.status).toBe("failed");
    expect(reading.failure).toEqual({
      reason: "not_offered",
      detail: null,
      status: 410,
      hint: "siliconflow_retired",
      seeAt: "https://cloud.siliconflow.cn",
    });
  });

  test("SiliconFlow's retirement code says the same whatever the status", async () => {
    replies.set(pathOf("siliconflow_com"), (response) =>
      sendJson(response, 400, { code: 20092, message: "deprecated", data: null }),
    );
    const reading = await readAt("https://api.siliconflow.com");
    expect(reading.failure).toEqual({
      reason: "not_offered",
      detail: null,
      status: 400,
      hint: "siliconflow_retired",
      seeAt: "https://cloud.siliconflow.com",
    });
  });

  test("SiliconFlow refusing the key itself is still said as it came", async () => {
    replies.set(pathOf("siliconflow_com"), (response) =>
      sendJson(response, 401, { code: 30014, message: "Invalid api key" }),
    );
    const reading = await readAt("https://api.siliconflow.com");
    expect(reading.failure).toEqual({
      reason: "token_rejected",
      detail: "Invalid api key",
      status: 401,
    });
  });

  test("Ollama Cloud with no credits bought shows no balance; a reply with neither has no value", async () => {
    replies.set(pathOf("ollama"), (response) =>
      sendJson(response, 200, { included: { balance_usd: 72.5, allowance_usd: 100 } }),
    );
    const plan = await readAt("https://ollama.com");
    expect(plan).toMatchObject({ status: "ok", items: [], failure: null });
    replies.set(pathOf("ollama"), (response) => sendJson(response, 200, { error: "x" }));
    const neither = await readAt("https://ollama.com");
    expect(neither.failure).toEqual({
      reason: "no_value",
      detail: "Ollama's reply has no included or purchased balance: fields error",
      status: 200,
    });
  });

  test("an AiHubMix key with no limit says the account's token is needed", async () => {
    replies.set(pathOf("aihubmix"), (response) =>
      sendJson(response, 200, { object: "list", total_usage: -0.000002 }),
    );
    const reading = await readAt("https://aihubmix.com");
    expect(reading.status).toBe("failed");
    expect(reading.failure).toEqual({
      reason: "not_offered",
      detail: null,
      status: 200,
      hint: "aihubmix_no_limit",
      seeAt: null,
    });
  });

  test("OpenCode Zen tells no key its balance: said so with its console, nothing asked and no read time", async () => {
    for (const baseUrl of ["https://opencode.ai/zen", "https://opencode.ai/inference/openai/v1"]) {
      const reading = await readAt(baseUrl);
      expect(reading).toMatchObject({
        status: "failed",
        items: [],
        readAt: null,
        failure: {
          reason: "not_offered",
          detail: null,
          status: null,
          hint: "opencode_no_balance",
          seeAt: "https://opencode.ai/console",
        },
      });
    }
    // Go 的套餐窗口另算；用户自己挂在 inference/custom 下的、没 key 的都不是 Zen 的余额。
    for (const [baseUrl, apiKey] of [
      ["https://opencode.ai/zen/go", KEY],
      ["https://opencode.ai/inference/go/v1", KEY],
      ["https://opencode.ai/inference/custom/acme/v1", KEY],
      ["https://opencode.ai/zen", null],
    ] as const) {
      expect((await readAt(baseUrl, apiKey)).status).toBe("unsupported");
    }
    expect(requests).toHaveLength(0);
  });
});
