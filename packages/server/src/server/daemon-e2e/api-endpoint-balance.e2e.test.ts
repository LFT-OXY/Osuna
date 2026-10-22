import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
import pino from "pino";
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
      aihubmix_account: "https://aihubmix.com/api/user/self",
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

  test("AiHubMix with the account's token asks the account's balance, with the token as it is", async () => {
    replies.set(pathOf("aihubmix_account"), (response) =>
      sendJson(response, 200, { success: true, data: { quota: 2500000 } }),
    );
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "AiHubMix",
      baseUrl: "https://aihubmix.com",
      apiKey: KEY,
      balanceToken: "aihubmix-system-token",
      models: [{ id: "some-model" }],
      defaultModelId: "some-model",
    });
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    const answer = await client.apiEndpointReadBalance({ endpointIds: [saved.endpoint.id] });
    expect(answer.readings[0]?.items).toEqual([
      { label: null, text: "$5.00", value: 5, unit: "USD" },
    ]);
    const sent = requests.find((request) => request.url === pathOf("aihubmix_account"));
    expect(sent?.headers.authorization).toBe("aihubmix-system-token");
    expect(sent?.headers["user-agent"]).toBe(`Osuna/${VERSION}`);
    expect(requests.some((request) => request.url === pathOf("aihubmix"))).toBe(false);
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

/*
 * 工单 03：什么时候查。daemon 对每家的读数缓存 1 分钟，刷新（force）跳过缓存，保存这家后缓存作废。
 * 「自动刷新余额与套餐用量」关着时照 magpie quota_asked.go：不是用户要求的读取不发请求，回缓存里的读数。
 * 时钟可控，不真等。
 */
describe("when the API endpoint balance is read", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let deepseek: FakeDeepSeek;
  let clock = NOW;
  let root: string;

  async function startDaemon() {
    daemon = await createTestPaseoDaemon({
      daemonVersion: VERSION,
      paseoHomeRoot: path.join(root, "home"),
      cleanup: false,
      apiEndpoints: {
        env: { CLAUDE_CONFIG_DIR: path.join(root, "claude"), CODEX_HOME: path.join(root, "codex") },
        homeDir: root,
        now: () => new Date(clock),
        balanceUrls: { deepseek: deepseek.balanceUrl },
      },
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.17.0" });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
  }

  beforeEach(async () => {
    clock = NOW;
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-balance-timing-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "home"));
    deepseek = await startDeepSeek();
    await startDaemon();
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    await Promise.all(servers.splice(0).map(closeServer));
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function saveDeepSeek(): Promise<string> {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKey: KEY,
      models: [{ id: "deepseek-chat" }],
      defaultModelId: "deepseek-chat",
    });
    expect(saved.error).toBeNull();
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    return saved.endpoint.id;
  }

  async function read(endpointId: string, options: { asked?: boolean; force?: boolean } = {}) {
    const answer = await client.apiEndpointReadBalance({ endpointIds: [endpointId], ...options });
    expect(answer.error).toBeNull();
    return answer.readings[0]!;
  }

  function readBalanceFile(): Promise<string> {
    return readFile(
      path.join(root, "home", ".paseo", "api-endpoints", "balance-readings.json"),
      "utf8",
    );
  }

  async function listedAutoRefresh(): Promise<boolean | undefined> {
    const listed = await client.apiEndpointList("claude");
    expect(listed.error).toBeNull();
    return listed.balanceAutoRefresh;
  }

  async function setAutoRefresh(enabled: boolean) {
    const answer = await client.apiEndpointSetBalanceAutoRefresh({ enabled });
    expect(answer.error).toBeNull();
  }

  test("a reading is kept for a minute, then asked again", async () => {
    const id = await saveDeepSeek();
    const first = await read(id);
    clock = NOW + 59_000;
    expect(await read(id)).toEqual(first);
    expect(deepseek.requests).toHaveLength(1);
    clock = NOW + 60_000;
    const next = await read(id);
    expect(deepseek.requests).toHaveLength(2);
    expect(next.readAt).toBe(new Date(NOW + 60_000).toISOString());
  });

  test("a refresh asks again within the minute", async () => {
    const id = await saveDeepSeek();
    await read(id);
    clock = NOW + 10_000;
    const forced = await read(id, { force: true });
    expect(deepseek.requests).toHaveLength(2);
    expect(forced.readAt).toBe(new Date(NOW + 10_000).toISOString());
  });

  test("saving the endpoint drops its kept reading", async () => {
    const id = await saveDeepSeek();
    await read(id);
    const saved = await client.apiEndpointSave({
      provider: "claude",
      endpointId: id,
      name: "DeepSeek renamed",
      baseUrl: "https://api.deepseek.com/anthropic",
      models: [{ id: "deepseek-chat" }],
      defaultModelId: "deepseek-chat",
    });
    expect(saved.error).toBeNull();
    await read(id);
    expect(deepseek.requests).toHaveLength(2);
  });

  test("auto refresh is on by default; turned off, it is listed off and stays off after a restart", async () => {
    expect(await listedAutoRefresh()).toBe(true);
    await setAutoRefresh(false);
    expect(await listedAutoRefresh()).toBe(false);
    await client.close();
    await daemon.close();
    await startDaemon();
    expect(await listedAutoRefresh()).toBe(false);
    await setAutoRefresh(true);
    expect(await listedAutoRefresh()).toBe(true);
  });

  test("with auto refresh on, a timed read goes out", async () => {
    const id = await saveDeepSeek();
    const reading = await read(id);
    expect(reading.status).toBe("ok");
    expect(deepseek.requests).toHaveLength(1);
  });

  test("with auto refresh off, a timed read asks nothing and says it was not asked for", async () => {
    const id = await saveDeepSeek();
    await setAutoRefresh(false);
    const reading = await read(id);
    expect(reading).toEqual({
      endpointId: id,
      status: "failed",
      items: [],
      readAt: null,
      failure: { reason: "temporary", detail: null, status: null, hint: "not_asked" },
    });
    expect(deepseek.requests).toHaveLength(0);
  });

  test("with auto refresh off, opening a page and refreshing read; a timed read keeps the last reading however old", async () => {
    const id = await saveDeepSeek();
    await setAutoRefresh(false);
    const opened = await read(id, { asked: true });
    expect(opened.status).toBe("ok");
    expect(deepseek.requests).toHaveLength(1);
    clock = NOW + 5 * 60_000;
    expect(await read(id)).toEqual(opened);
    expect(deepseek.requests).toHaveLength(1);
    // 打开页面也守 1 分钟缓存；过了一分钟才再问。
    const reopened = await read(id, { asked: true });
    expect(deepseek.requests).toHaveLength(2);
    expect(reopened.readAt).toBe(new Date(NOW + 5 * 60_000).toISOString());
    await read(id, { force: true });
    expect(deepseek.requests).toHaveLength(3);
  });

  test("a temporary failure (5xx, 429) gives the last reading, marked as last time's with why it was not read now", async () => {
    const id = await saveDeepSeek();
    const good = await read(id);
    deepseek.reply = (response) => sendJson(response, 503, { error: { message: "busy" } });
    clock = NOW + 5 * 60_000;
    const stale = await read(id, { force: true });
    expect(stale).toEqual({
      ...good,
      stale: { reason: "temporary", detail: "busy", status: 503 },
    });
    deepseek.reply = (response) => sendJson(response, 429, { error: { message: "slow down" } });
    clock = NOW + 7 * 60_000;
    expect(await read(id, { force: true })).toEqual({
      ...good,
      stale: { reason: "temporary", detail: "slow down", status: 429 },
    });
  });

  test("the last reading stays across a restart, kept on disk without the key", async () => {
    const id = await saveDeepSeek();
    const good = await read(id);
    await client.close();
    await daemon.close();
    const file = await readBalanceFile();
    expect(file).toContain("¥110.00");
    expect(file).not.toContain(KEY);
    await startDaemon();
    deepseek.reply = (response) => response.destroy();
    clock = NOW + 3 * 60_000;
    const stale = await read(id);
    expect(stale).toMatchObject({ ...good, stale: { reason: "temporary", status: null } });
  });

  test("a failure that is not temporary does not fall back to the last reading", async () => {
    const id = await saveDeepSeek();
    await read(id);
    deepseek.reply = (response) => sendJson(response, 401, { error: { message: "bad key" } });
    const refused = await read(id, { force: true });
    expect(refused).toMatchObject({
      status: "failed",
      items: [],
      failure: { reason: "token_rejected", status: 401 },
    });
    expect(refused.stale).toBeUndefined();
  });

  test("changing the endpoint's address or key, or deleting it, drops its last reading", async () => {
    const busy: Reply = (response) => sendJson(response, 503, {});
    async function resave(id: string, change: { baseUrl?: string; apiKey?: string }) {
      const saved = await client.apiEndpointSave({
        provider: "claude",
        endpointId: id,
        name: "DeepSeek",
        baseUrl: change.baseUrl ?? "https://api.deepseek.com/anthropic",
        ...(change.apiKey === undefined ? {} : { apiKey: change.apiKey }),
        models: [{ id: "deepseek-chat" }],
        defaultModelId: "deepseek-chat",
      });
      expect(saved.error).toBeNull();
    }
    for (const change of [{ baseUrl: "https://api.deepseek.com" }, { apiKey: "sk-other-key" }]) {
      deepseek.reply = (response) => sendJson(response, 200, DEEPSEEK_BALANCE);
      const id = await saveDeepSeek();
      await read(id);
      // 只改名字不作废。
      await resave(id, {});
      deepseek.reply = busy;
      expect((await read(id, { force: true })).stale).toMatchObject({ status: 503 });
      await resave(id, change);
      expect(await read(id, { force: true })).toMatchObject({
        status: "failed",
        failure: { reason: "temporary", status: 503 },
      });
    }
    deepseek.reply = (response) => sendJson(response, 200, DEEPSEEK_BALANCE);
    const id = await saveDeepSeek();
    await read(id);
    expect((await client.apiEndpointDelete("claude", id)).error).toBeNull();
    await client.close();
    await daemon.close();
    const file = await readBalanceFile();
    expect(file).not.toContain(id);
  });

  test("with auto refresh off, a timed read after a restart gives the last reading, marked as not read now", async () => {
    const id = await saveDeepSeek();
    const good = await read(id);
    await setAutoRefresh(false);
    await client.close();
    await daemon.close();
    await startDaemon();
    const held = await read(id);
    expect(held).toEqual({
      ...good,
      stale: { reason: "temporary", detail: null, status: null, hint: "not_asked" },
    });
    expect(deepseek.requests).toHaveLength(1);
  });

  test("the daemon asks no balance when it starts", async () => {
    await saveDeepSeek();
    await client.close();
    await daemon.close();
    await startDaemon();
    await client.apiEndpointList("claude");
    expect(deepseek.requests).toHaveLength(0);
  });
});

/*
 * 自定义余额（工单 05）：填了余额查询地址就按它查，取值写法照 magpie；「查询余额」用表单里还没保存的值当场查。
 * 本机假中转服务按路径回话，记下每次收到的方法、地址、请求头与正文。
 */
describe("API endpoint balance at an address the user gave", () => {
  const RELAY_KEY = "sk-relay key+/=";
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let deepseek: FakeDeepSeek;
  let relay: {
    origin: string;
    requests: {
      method: string;
      url: string;
      headers: IncomingHttpHeaders;
      body: string;
    }[];
    replies: Record<string, Reply>;
  };
  let clock = NOW;
  let logLines: string[] = [];

  async function startRelay() {
    const fake: typeof relay = { origin: "", requests: [], replies: {} };
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += String(chunk);
      });
      request.on("end", () => {
        const url = request.url ?? "";
        fake.requests.push({ method: request.method ?? "", url, headers: request.headers, body });
        const reply = fake.replies[url.split("?")[0] ?? ""];
        if (reply) reply(response);
        else sendJson(response, 404, { error: "not here" });
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    fake.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return fake;
  }

  let root: string;

  // 留着 home：重启后读回同一份接口。
  async function startDaemon() {
    daemon = await createTestPaseoDaemon({
      daemonVersion: VERSION,
      logger: pino({ level: "trace" }, { write: (line: string) => logLines.push(line) }),
      paseoHomeRoot: path.join(root, "home"),
      cleanup: false,
      apiEndpoints: {
        env: { CLAUDE_CONFIG_DIR: path.join(root, "claude"), CODEX_HOME: path.join(root, "codex") },
        homeDir: root,
        now: () => new Date(clock),
        balanceUrls: { deepseek: deepseek.balanceUrl },
      },
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.17.0" });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
  }

  beforeEach(async () => {
    clock = NOW;
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-balance-custom-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "home"));
    deepseek = await startDeepSeek();
    relay = await startRelay();
    logLines = [];
    await startDaemon();
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    await Promise.all(servers.splice(0).map(closeServer));
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function saveRelay(input: {
    balance?: { url?: string; method?: string; field?: string; userId?: string };
    balanceToken?: string;
    headers?: Record<string, string>;
    baseUrl?: string;
    endpointId?: string;
  }) {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      ...(input.endpointId === undefined ? {} : { endpointId: input.endpointId }),
      name: "Relay",
      baseUrls: [
        // 聊天地址指到本机没人听的端口：保存后拉模型清单不打到假中转服务上。
        { format: "anthropic_messages", url: input.baseUrl ?? "http://127.0.0.1:1/anthropic" },
      ],
      apiKey: RELAY_KEY,
      models: [{ id: "claude-sonnet" }],
      ...(input.balance === undefined ? {} : { balance: input.balance }),
      ...(input.balanceToken === undefined ? {} : { balanceToken: input.balanceToken }),
      ...(input.headers === undefined ? {} : { headers: input.headers }),
    });
    return saved;
  }

  async function savedRelayId(input: Parameters<typeof saveRelay>[0]): Promise<string> {
    const saved = await saveRelay(input);
    expect(saved.error).toBeNull();
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    return saved.endpoint.id;
  }

  async function read(endpointId: string, options: { force?: boolean } = {}) {
    const answer = await client.apiEndpointReadBalance({ endpointIds: [endpointId], ...options });
    expect(answer.error).toBeNull();
    return answer.readings[0]!;
  }

  async function listed(endpointId: string) {
    const list = await client.apiEndpointList("claude");
    expect(list.error).toBeNull();
    return list.endpoints.find((endpoint) => endpoint.id === endpointId);
  }

  test("a GET to the address the user gave, with the key in its placeholders and the endpoint's headers", async () => {
    relay.replies["/query"] = (response) => sendJson(response, 200, { data: { left: "7.5" } });
    const id = await savedRelayId({
      balance: { url: `${relay.origin}/query?apikey={key}`, field: "$data.left" },
      headers: { "X-Key": "{apiKey}", "X-Plain": "kept" },
    });
    expect(await read(id)).toEqual({
      endpointId: id,
      status: "ok",
      items: [{ label: null, text: "$7.50", value: 7.5, unit: "USD", ratio: null }],
      readAt: new Date(NOW).toISOString(),
      failure: null,
    });
    expect(relay.requests).toHaveLength(1);
    const [sent] = relay.requests;
    expect(sent?.method).toBe("GET");
    expect(sent?.url).toBe("/query?apikey=sk-relay+key%2B%2F%3D");
    expect(sent?.headers.authorization).toBe(`Bearer ${RELAY_KEY}`);
    expect(sent?.headers.accept).toBe("application/json");
    expect(sent?.headers["user-agent"]).toBe(`Osuna/${VERSION}`);
    expect(sent?.headers["x-key"]).toBe(RELAY_KEY);
    expect(sent?.headers["x-plain"]).toBe("kept");
  });

  test("a POST, as the user chose it, goes with no body", async () => {
    relay.replies["/api/check-balance"] = (response) =>
      sendJson(response, 200, { usd_balance: "0.94306040" });
    const id = await savedRelayId({
      balance: { url: `${relay.origin}/api/check-balance`, method: "post", field: "$usd_balance" },
    });
    expect((await listed(id))?.balance).toEqual({
      url: `${relay.origin}/api/check-balance`,
      method: "POST",
      field: "$usd_balance",
    });
    expect((await read(id)).items[0]?.text).toBe("$0.94");
    expect(relay.requests.map(({ method, body }) => `${method} ${body}`)).toEqual(["POST "]);
  });

  test("several amounts with labels, a percent with its ratio, and a dash for one the reply hasn't", async () => {
    relay.replies["/usage"] = (response) =>
      sendJson(response, 200, { left: 12, used: 45, cap: 50 });
    const id = await savedRelayId({
      balance: {
        url: `${relay.origin}/usage`,
        field: "Left: $left; Used: used / cap %; Today: today",
      },
    });
    expect((await read(id)).items).toEqual([
      { label: "Left", text: "$12.00", value: 12, unit: "USD", ratio: null },
      { label: "Used", text: "90%", value: 90, unit: "%", ratio: 0.9 },
      { label: "Today", text: "—", value: null, unit: null, ratio: null },
    ]);
  });

  test.each([
    [
      "/api/usage/token",
      { code: true, data: { total_available: 1500000, total_used: 500000 } },
      "$3.00",
    ],
    ["/v1/usage", { mode: "unrestricted", remaining: 7.25, unit: "USD" }, "$7.25"],
    [
      "/v1/dashboard/billing/credit_grants",
      { object: "credit_summary", total_granted: 20, total_used: 7.5, total_available: 12.5 },
      "$12.50",
    ],
  ])("a known query read with its field left empty: %s", async (queryPath, reply, want) => {
    relay.replies[queryPath] = (response) => sendJson(response, 200, reply);
    const id = await savedRelayId({ balance: { url: `${relay.origin}${queryPath}` } });
    expect((await read(id)).items[0]?.text).toBe(want);
  });

  test("an address with no default and no field says where to write one, as no value", async () => {
    relay.replies["/other"] = (response) => sendJson(response, 200, { balance: 3 });
    const id = await savedRelayId({ balance: { url: `${relay.origin}/other` } });
    expect((await read(id)).failure).toEqual({
      reason: "no_value",
      detail: "no balance path: where in the reply the amount is, e.g. data.balance",
      status: 200,
    });
  });

  test("a field the reply hasn't is no value, saying what was missing", async () => {
    relay.replies["/query"] = (response) => sendJson(response, 200, { data: {} });
    const id = await savedRelayId({
      balance: { url: `${relay.origin}/query`, field: "data.left" },
    });
    expect((await read(id)).failure).toEqual({
      reason: "no_value",
      detail: 'nothing at "data.left" in the reply',
      status: 200,
    });
  });

  test("an endpoint on a known vendor's host asks the address the user gave instead", async () => {
    relay.replies["/query"] = (response) => sendJson(response, 200, { balance: 3 });
    const id = await savedRelayId({
      baseUrl: "https://api.deepseek.com/anthropic",
      balance: { url: `${relay.origin}/query`, field: "balance" },
    });
    expect((await read(id)).items[0]?.text).toBe("3.00");
    expect(deepseek.requests).toHaveLength(0);
    expect(relay.requests).toHaveLength(1);
  });

  test("a reply is read up to 1 MB: one cut there is not JSON, so the address is wrong", async () => {
    relay.replies["/query"] = (response) =>
      sendJson(response, 200, { balance: 3, pad: "x".repeat(1 << 20) });
    const id = await savedRelayId({ balance: { url: `${relay.origin}/query`, field: "balance" } });
    expect((await read(id)).failure).toEqual({ reason: "wrong_url", detail: null, status: 200 });
  });

  test("a check with a method that is neither GET nor POST is refused", async () => {
    const answer = await client.apiEndpointCheckBalance({
      apiKey: RELAY_KEY,
      balance: { url: `${relay.origin}/query`, method: "PUT" },
    });
    expect(answer.reading).toBeNull();
    expect(answer.error?.code).toBe("invalid_balance_settings");
    expect(relay.requests).toHaveLength(0);
  });

  test("an address that cannot be reached does not show the key put in it", async () => {
    const id = await savedRelayId({
      balance: { url: "http://127.0.0.1:1/q?key={key}", field: "balance" },
    });
    const reading = await read(id);
    expect(reading.failure?.reason).toBe("temporary");
    expect(JSON.stringify(reading)).not.toContain("sk-relay");
  });

  test("an old client's save keeps the balance settings, an empty address clears them, and a copy takes them", async () => {
    const balance = { url: `${relay.origin}/query`, field: "balance" };
    const id = await savedRelayId({ balance });
    await savedRelayId({ endpointId: id });
    expect((await listed(id))?.balance).toEqual(balance);
    const copied = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay copy",
      baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/anthropic` }],
      models: [{ id: "claude-sonnet" }],
      copyOf: id,
    });
    expect(copied.endpoint?.balance).toEqual(balance);
    await savedRelayId({ endpointId: id, balance: { url: " ", field: "balance" } });
    expect((await listed(id))?.balance).toBeUndefined();
  });

  test("a method that is neither GET nor POST is refused on save", async () => {
    const saved = await saveRelay({ balance: { url: `${relay.origin}/query`, method: "PUT" } });
    expect(saved.endpoint).toBeNull();
    expect(saved.error).toMatchObject({
      code: "invalid_balance_settings",
      params: { field: "method" },
    });
  });

  test("changing the balance settings drops the endpoint's last reading", async () => {
    relay.replies["/query"] = (response) => sendJson(response, 200, { balance: 3 });
    relay.replies["/other"] = (response) => sendJson(response, 503, { error: "busy" });
    const id = await savedRelayId({ balance: { url: `${relay.origin}/query`, field: "balance" } });
    await read(id);
    await savedRelayId({
      endpointId: id,
      balance: { url: `${relay.origin}/other`, field: "balance" },
    });
    const reading = await read(id);
    expect(reading.status).toBe("failed");
    expect(reading.stale).toBeUndefined();
  });

  describe("checking the balance with the form's values", () => {
    test("a new endpoint is asked with the typed key, headers and settings, nothing saved", async () => {
      relay.replies["/query"] = (response) => sendJson(response, 200, { data: { left: 2 } });
      const answer = await client.apiEndpointCheckBalance({
        apiKey: RELAY_KEY,
        baseUrls: [{ format: "anthropic_messages", url: `${relay.origin}/anthropic` }],
        balance: { url: `${relay.origin}/query?k={token}`, method: "POST", field: "¥data.left" },
        headers: { "X-Key": "${API_KEY}" },
      });
      expect(answer.error).toBeNull();
      expect(answer.reading).toEqual({
        endpointId: "",
        status: "ok",
        items: [{ label: null, text: "¥2.00", value: 2, unit: "CNY", ratio: null }],
        readAt: new Date(NOW).toISOString(),
        failure: null,
      });
      const [sent] = relay.requests;
      expect(sent?.method).toBe("POST");
      expect(sent?.url).toBe("/query?k=sk-relay+key%2B%2F%3D");
      expect(sent?.headers["x-key"]).toBe(RELAY_KEY);
      expect(sent?.headers["user-agent"]).toBe(`Osuna/${VERSION}`);
      expect((await client.apiEndpointList("claude")).endpoints).toHaveLength(0);
    });

    test("an endpoint being edited is asked with its saved key and the unsaved settings", async () => {
      relay.replies["/query"] = (response) => sendJson(response, 200, { balance: 1 });
      relay.replies["/other"] = (response) => sendJson(response, 200, { left: 9 });
      const id = await savedRelayId({
        balance: { url: `${relay.origin}/query`, field: "balance" },
      });
      const answer = await client.apiEndpointCheckBalance({
        endpointId: id,
        balance: { url: `${relay.origin}/other`, field: "$left" },
      });
      expect(answer.reading?.items[0]?.text).toBe("$9.00");
      expect(relay.requests).toHaveLength(1);
      expect(relay.requests[0]?.url).toBe("/other");
      expect(relay.requests[0]?.headers.authorization).toBe(`Bearer ${RELAY_KEY}`);
      expect((await listed(id))?.balance?.url).toBe(`${relay.origin}/query`);
    });

    test("with no address, the form's base address finds a known vendor", async () => {
      const answer = await client.apiEndpointCheckBalance({
        apiKey: KEY,
        baseUrls: [{ format: "anthropic_messages", url: "https://api.deepseek.com/anthropic" }],
        balance: {},
      });
      expect(answer.reading?.items[0]?.text).toBe("¥110.00");
      expect(deepseek.requests).toHaveLength(1);
    });

    test("a failed check says why, as a reading does", async () => {
      relay.replies["/query"] = (response) =>
        sendJson(response, 401, { error: { message: `bad key ${RELAY_KEY}` } });
      const answer = await client.apiEndpointCheckBalance({
        apiKey: RELAY_KEY,
        balance: { url: `${relay.origin}/query`, field: "balance" },
      });
      expect(answer.error).toBeNull();
      expect(answer.reading?.failure?.reason).toBe("token_rejected");
      expect(answer.reading?.failure?.status).toBe(401);
      expect(JSON.stringify(answer)).not.toContain(RELAY_KEY);
    });

    test("a check is neither kept for the minute nor taken as the last reading", async () => {
      relay.replies["/query"] = (response) => sendJson(response, 200, { balance: 4 });
      const id = await savedRelayId({
        balance: { url: `${relay.origin}/query`, field: "balance" },
      });
      await client.apiEndpointCheckBalance({
        endpointId: id,
        balance: { url: `${relay.origin}/query`, field: "balance" },
      });
      expect(relay.requests).toHaveLength(1);
      relay.replies["/query"] = (response) => sendJson(response, 503, { error: "busy" });
      const reading = await read(id);
      expect(relay.requests).toHaveLength(2);
      expect(reading.status).toBe("failed");
      expect(reading.stale).toBeUndefined();
    });

    test("an endpoint that is not there is refused", async () => {
      const answer = await client.apiEndpointCheckBalance({
        endpointId: "ep_missing",
        balance: { url: `${relay.origin}/query` },
      });
      expect(answer.reading).toBeNull();
      expect(answer.error?.code).toBe("not_found");
    });
  });

  // 「自动识别」（工单 07）：依次试 new-api 与 sub2api 的 key 级地址，拼在表单地址的站点上。
  describe("detecting the balance address with the form's values", () => {
    const NEW_API_TOKEN_USAGE = {
      code: true,
      data: { total_available: 5_000_000, total_granted: 6_000_000, total_used: 1_000_000 },
    };

    function formUrls() {
      return [
        { format: "anthropic_messages", url: `${relay.origin}/relay/anthropic` },
        { format: "openai_chat", url: `${relay.origin}/relay/v1` },
      ];
    }

    type Attempts = Awaited<ReturnType<DaemonClient["apiEndpointDetectBalanceUrl"]>>["attempts"];

    function triedUrls(attempts: Attempts) {
      return attempts.map((attempt) => attempt.url);
    }

    function triedReasons(attempts: Attempts) {
      return attempts.map((attempt) => [attempt.url, attempt.reading.failure?.reason]);
    }

    function requestTo(url: string) {
      return relay.requests.find((request) => request.url === url);
    }

    function balancePaths() {
      return relay.requests
        .map((request) => request.url.split("?")[0])
        .filter((url) => url === "/api/usage/token" || url === "/v1/usage");
    }

    test("a new-api site answers the first try: its address and default field come back, nothing saved", async () => {
      relay.replies["/api/usage/token"] = (response) =>
        sendJson(response, 200, NEW_API_TOKEN_USAGE);
      const answer = await client.apiEndpointDetectBalanceUrl({
        apiKey: RELAY_KEY,
        baseUrls: formUrls(),
        headers: { "X-Plain": "kept" },
      });
      expect(answer.error).toBeNull();
      expect(answer.detected).toEqual({
        url: `${relay.origin}/api/usage/token`,
        field: "$data.total_available / 500000",
      });
      expect(answer.attempts).toHaveLength(1);
      expect(answer.attempts[0]?.url).toBe(`${relay.origin}/api/usage/token`);
      expect(answer.attempts[0]?.reading.status).toBe("ok");
      expect(answer.attempts[0]?.reading.items[0]?.text).toBe("$10.00");
      expect(balancePaths()).toEqual(["/api/usage/token"]);
      const [sent] = relay.requests;
      expect(sent?.method).toBe("GET");
      expect(sent?.headers.authorization).toBe(`Bearer ${RELAY_KEY}`);
      expect(sent?.headers["user-agent"]).toBe(`Osuna/${VERSION}`);
      expect(sent?.headers["x-plain"]).toBe("kept");
      expect((await client.apiEndpointList("claude")).endpoints).toHaveLength(0);
    });

    test("a sub2api site answers the second try, after new-api's address is not there", async () => {
      relay.replies["/v1/usage"] = (response) => sendJson(response, 200, { remaining: 3.5 });
      const answer = await client.apiEndpointDetectBalanceUrl({
        apiKey: RELAY_KEY,
        baseUrls: formUrls(),
      });
      expect(answer.detected).toEqual({ url: `${relay.origin}/v1/usage`, field: "$remaining" });
      expect(triedUrls(answer.attempts)).toEqual([
        `${relay.origin}/api/usage/token`,
        `${relay.origin}/v1/usage`,
      ]);
      expect(answer.attempts[0]?.reading.failure?.reason).toBe("wrong_url");
      expect(answer.attempts[1]?.reading.items[0]?.text).toBe("$3.50");
      expect(balancePaths()).toEqual(["/api/usage/token", "/v1/usage"]);
    });

    test("neither answering says why for each address, the key masked", async () => {
      relay.replies["/v1/usage"] = (response) =>
        sendJson(response, 401, { error: { message: `bad key ${RELAY_KEY}` } });
      const answer = await client.apiEndpointDetectBalanceUrl({
        apiKey: RELAY_KEY,
        baseUrls: formUrls(),
      });
      expect(answer.error).toBeNull();
      expect(answer.detected).toBeNull();
      expect(triedReasons(answer.attempts)).toEqual([
        [`${relay.origin}/api/usage/token`, "wrong_url"],
        [`${relay.origin}/v1/usage`, "token_rejected"],
      ]);
      expect(JSON.stringify(answer)).not.toContain(RELAY_KEY);
    });

    test("an endpoint being edited is tried with its saved key, never its account token, its settings kept", async () => {
      relay.replies["/api/usage/token"] = (response) =>
        sendJson(response, 200, NEW_API_TOKEN_USAGE);
      const id = await savedRelayId({
        balance: { url: `${relay.origin}/query`, field: "balance" },
        balanceToken: "new-api-access-token-123",
      });
      const answer = await client.apiEndpointDetectBalanceUrl({
        endpointId: id,
        baseUrls: formUrls(),
      });
      expect(answer.detected?.url).toBe(`${relay.origin}/api/usage/token`);
      const asked = requestTo("/api/usage/token");
      expect(asked?.headers.authorization).toBe(`Bearer ${RELAY_KEY}`);
      expect((await listed(id))?.balance?.url).toBe(`${relay.origin}/query`);
    });

    test("no key, or no address to find the site on, is refused without asking", async () => {
      const keyless = await client.apiEndpointDetectBalanceUrl({ baseUrls: formUrls() });
      expect(keyless.error?.code).toBe("invalid_input");
      expect(keyless.attempts).toEqual([]);
      const siteless = await client.apiEndpointDetectBalanceUrl({
        apiKey: RELAY_KEY,
        baseUrls: [{ format: "anthropic_messages", url: "not an address" }],
      });
      expect(siteless.error?.code).toBe("invalid_input");
      expect(balancePaths()).toEqual([]);
    });

    test("the daemon never tries these addresses on its own: not when listing, reading or starting", async () => {
      const id = await savedRelayId({ baseUrl: `${relay.origin}/relay/anthropic` });
      await client.apiEndpointList("claude");
      await read(id, { force: true });
      await client.close();
      await daemon.close();
      await startDaemon();
      expect((await client.apiEndpointList("claude")).endpoints).toHaveLength(1);
      expect(balancePaths()).toEqual([]);
    });
  });
  // 账户余额：用这家自己的账户令牌问（工单 06）。
  const TOKEN = "new-api-access-token-123";
  const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOjF9.c2lnbmF0dXJl";
  const NEW_API_SELF = { success: true, data: { quota: 2500000, id: 42 } };

  test("new-api's /api/user/self is asked with the token as it is and the user ID as New-Api-User", async () => {
    relay.replies["/api/user/self"] = (response) => sendJson(response, 200, NEW_API_SELF);
    const id = await savedRelayId({
      balance: { url: `${relay.origin}/api/user/self`, userId: "42" },
      balanceToken: TOKEN,
    });
    expect((await read(id)).items).toEqual([
      { label: null, text: "$5.00", value: 5, unit: "USD", ratio: null },
    ]);
    const [sent] = relay.requests;
    expect(sent?.headers.authorization).toBe(TOKEN);
    expect(sent?.headers["new-api-user"]).toBe("42");
    expect(sent?.headers["user-agent"]).toBe(`Osuna/${VERSION}`);
    expect((await listed(id))?.balance).toEqual({
      url: `${relay.origin}/api/user/self`,
      userId: "42",
    });
  });

  test("a JWT goes as a Bearer, one written with its scheme as it is", async () => {
    relay.replies["/api/v1/user/profile"] = (response) =>
      sendJson(response, 200, { code: 0, data: { balance: 12.5 } });
    const id = await savedRelayId({
      balance: { url: `${relay.origin}/api/v1/user/profile` },
      balanceToken: JWT,
    });
    expect((await read(id)).items[0]?.text).toBe("$12.50");
    await savedRelayId({ endpointId: id, balanceToken: `Token ${TOKEN}` });
    await read(id, { force: true });
    expect(relay.requests.map((sent) => sent.headers.authorization)).toEqual([
      `Bearer ${JWT}`,
      `Token ${TOKEN}`,
    ]);
  });

  test("New-Api-User in the endpoint's headers is taken too; the user ID wins over it", async () => {
    relay.replies["/api/user/self"] = (response) => sendJson(response, 200, NEW_API_SELF);
    const id = await savedRelayId({
      balance: { url: `${relay.origin}/api/user/self` },
      balanceToken: TOKEN,
      headers: { "New-Api-User": "7" },
    });
    await read(id);
    await savedRelayId({
      endpointId: id,
      balance: { url: `${relay.origin}/api/user/self`, userId: "42" },
    });
    await read(id, { force: true });
    expect(relay.requests.map((sent) => sent.headers["new-api-user"])).toEqual(["7", "42"]);
  });

  test("the user ID goes with the balance query only, never with a chat request", async () => {
    relay.replies["/anthropic/v1/messages"] = (response) =>
      sendJson(response, 200, {
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        model: "claude-sonnet",
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    const id = await savedRelayId({
      baseUrl: `${relay.origin}/anthropic`,
      balance: { url: `${relay.origin}/api/user/self`, userId: "42" },
      balanceToken: TOKEN,
    });
    relay.requests.length = 0;
    await client.apiEndpointTestConnection({
      provider: "claude",
      endpointId: id,
      baseUrl: `${relay.origin}/anthropic`,
      modelId: "claude-sonnet",
    });
    const chat = relay.requests.find((sent) => sent.url === "/anthropic/v1/messages");
    expect(chat).toBeDefined();
    expect(chat?.headers["new-api-user"]).toBeUndefined();
    expect(chat?.headers.authorization).not.toBe(TOKEN);
  });

  test("success:false about New-Api-User is a refused token, with the hint to give the user ID", async () => {
    relay.replies["/api/user/self"] = (response) =>
      sendJson(response, 200, {
        success: false,
        message: "无权进行此操作，未提供 New-Api-User",
      });
    const id = await savedRelayId({
      balance: { url: `${relay.origin}/api/user/self` },
      balanceToken: TOKEN,
    });
    expect((await read(id)).failure).toEqual({
      reason: "token_rejected",
      detail: "无权进行此操作，未提供 New-Api-User",
      status: 200,
      hint: "new_api_user_missing",
    });
  });

  test.each([
    ["/api/usage/token", "/api/user/self"],
    ["/v1/usage", "/api/v1/user/profile"],
  ])(
    "a token beside the key's own query %s asks nothing and names %s instead",
    async (keyPath, accountPath) => {
      const id = await savedRelayId({
        balance: { url: `${relay.origin}${keyPath}` },
        balanceToken: TOKEN,
      });
      expect((await read(id)).failure).toEqual({
        reason: "wrong_url",
        detail: null,
        status: null,
        hint: "token_on_key_url",
        useUrl: `${relay.origin}${accountPath}`,
      });
      expect(relay.requests).toHaveLength(0);
    },
  );

  test("an account query with no token asks the same site's query for the key, with the key", async () => {
    relay.replies["/api/usage/token"] = (response) =>
      sendJson(response, 200, { code: true, data: { total_available: 1000000 } });
    const id = await savedRelayId({
      balance: { url: `${relay.origin}/api/user/self?x=1`, field: "$data.quota / 500000" },
    });
    expect((await read(id)).items[0]?.text).toBe("$2.00");
    const [sent] = relay.requests;
    expect(sent?.url).toBe("/api/usage/token");
    expect(sent?.headers.authorization).toBe(`Bearer ${RELAY_KEY}`);
  });

  test("an account query with an Authorization header of the user's own is asked as they set it", async () => {
    relay.replies["/api/user/self"] = (response) => sendJson(response, 200, NEW_API_SELF);
    const id = await savedRelayId({
      balance: { url: `${relay.origin}/api/user/self` },
      headers: { Authorization: "own-token" },
    });
    expect((await read(id)).items[0]?.text).toBe("$5.00");
    expect(relay.requests[0]?.headers.authorization).toBe("own-token");
  });

  test("a token that is only the key pasted again is asked as the key", async () => {
    relay.replies["/v1/usage"] = (response) => sendJson(response, 200, { remaining: 3 });
    const id = await savedRelayId({
      balance: { url: `${relay.origin}/v1/usage` },
      balanceToken: `Bearer ${RELAY_KEY}`,
    });
    expect((await read(id)).items[0]?.text).toBe("$3.00");
    expect(relay.requests[0]?.headers.authorization).toBe(`Bearer ${RELAY_KEY}`);
  });

  test("sub2api's key query shows its 5-hour, day and week windows in dollars, with their resets", async () => {
    relay.replies["/v1/usage"] = (response) =>
      sendJson(response, 200, {
        mode: "quota_limited",
        rate_limits: [
          { window: "7d", limit: 800, used: 200, reset_at: "2026-10-27T00:00:00Z" },
          { window: "5h", limit: 20, used: 15, reset_at: "2026-10-22T10:00:00Z" },
          { window: "1d", limit: 50, used: 0, reset_at: null },
          { window: "30d", limit: 9, used: 1 },
        ],
      });
    const id = await savedRelayId({ balance: { url: `${relay.origin}/v1/usage` } });
    const reading = await read(id);
    expect(reading.status).toBe("ok");
    // 没有 remaining：余额取各窗口剩的最少的那个。
    expect(reading.items).toEqual([{ label: null, text: "$5.00", value: 5, unit: "USD" }]);
    expect(reading.windows).toEqual([
      {
        id: "5h",
        label: "5 hours",
        usedPct: 75,
        remainingPct: 25,
        resetsAt: "2026-10-22T10:00:00.000Z",
        used: 15,
        limit: 20,
        unit: "USD",
      },
      {
        id: "1d",
        label: "1 day",
        usedPct: 0,
        remainingPct: 100,
        resetsAt: null,
        used: 0,
        limit: 50,
        unit: "USD",
      },
      {
        id: "7d",
        label: "7 days",
        usedPct: 25,
        remainingPct: 75,
        resetsAt: "2026-10-27T00:00:00.000Z",
        used: 200,
        limit: 800,
        unit: "USD",
      },
    ]);
  });

  test("sub2api with a remaining shows it beside the windows", async () => {
    relay.replies["/v1/usage"] = (response) =>
      sendJson(response, 200, {
        remaining: 7.25,
        rate_limits: [{ window: "5h", limit: 20, used: 5, reset_at: "2026-10-22T10:00:00Z" }],
      });
    const id = await savedRelayId({ balance: { url: `${relay.origin}/v1/usage` } });
    const reading = await read(id);
    expect(reading.items[0]?.text).toBe("$7.25");
    expect(reading.windows?.map((window) => window.id)).toEqual(["5h"]);
  });

  test("the token is kept in the daemon: listed masked, revealed on asking, never in a reading or the log", async () => {
    relay.replies["/api/user/self"] = (response) =>
      sendJson(response, 401, { success: false, message: `bad token ${TOKEN}` });
    const id = await savedRelayId({
      balance: { url: `${relay.origin}/api/user/self`, userId: "42" },
      balanceToken: TOKEN,
    });
    const list = await client.apiEndpointList("claude");
    const endpoint = list.endpoints.find((entry) => entry.id === id);
    expect(endpoint?.balanceTokenMask).toBe("new-…-123");
    const reading = await read(id);
    expect(reading.failure?.reason).toBe("token_rejected");
    const checked = await client.apiEndpointCheckBalance({
      endpointId: id,
      balance: { url: `${relay.origin}/api/user/self` },
    });
    expect(checked.reading?.failure?.reason).toBe("token_rejected");
    for (const answer of [list, reading, checked]) {
      expect(JSON.stringify(answer)).not.toContain(TOKEN);
    }
    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.join("\n")).not.toContain(TOKEN);
    const revealed = await client.apiEndpointRevealSecret({
      endpointId: id,
      secret: "balance_token",
    });
    expect(revealed).toMatchObject({ value: TOKEN, error: null });
    const files = await readFile(
      path.join(daemon.paseoHome, "api-endpoints", "endpoints.json"),
      "utf8",
    );
    expect(files).not.toContain(TOKEN);
  });

  test("an old client's save keeps the token, an empty one clears it, and a copy takes it", async () => {
    relay.replies["/api/user/self"] = (response) => sendJson(response, 200, NEW_API_SELF);
    const balance = { url: `${relay.origin}/api/user/self`, userId: "42" };
    const id = await savedRelayId({ balance, balanceToken: TOKEN });
    await savedRelayId({ endpointId: id });
    expect((await listed(id))?.balanceTokenMask).toBe("new-…-123");
    const copied = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay copy",
      baseUrls: [{ format: "anthropic_messages", url: "http://127.0.0.1:1/anthropic" }],
      models: [{ id: "claude-sonnet" }],
      copyOf: id,
    });
    if (!copied.endpoint) throw new Error("Expected the copy");
    expect(copied.endpoint.balanceTokenMask).toBe("new-…-123");
    await read(copied.endpoint.id);
    expect(relay.requests.at(-1)?.headers.authorization).toBe(TOKEN);
    await savedRelayId({ endpointId: id, balanceToken: "" });
    expect((await listed(id))?.balanceTokenMask).toBeUndefined();
    expect(
      await client.apiEndpointRevealSecret({ endpointId: id, secret: "balance_token" }),
    ).toMatchObject({ value: null, error: null });
  });

  test("a check asks with the form's token: typed, cleared, or the saved one when left out", async () => {
    relay.replies["/api/user/self"] = (response) => sendJson(response, 200, NEW_API_SELF);
    relay.replies["/api/usage/token"] = (response) =>
      sendJson(response, 200, { data: { total_available: 500000 } });
    const balance = { url: `${relay.origin}/api/user/self`, userId: "42" };
    const id = await savedRelayId({ balance, balanceToken: TOKEN });
    await client.apiEndpointCheckBalance({ endpointId: id, balance });
    await client.apiEndpointCheckBalance({ endpointId: id, balance, balanceToken: "typed" });
    const cleared = await client.apiEndpointCheckBalance({
      endpointId: id,
      balance,
      balanceToken: "",
    });
    expect(cleared.reading?.items[0]?.text).toBe("$1.00");
    expect(relay.requests.map((sent) => `${sent.url} ${sent.headers.authorization}`)).toEqual([
      `/api/user/self ${TOKEN}`,
      "/api/user/self typed",
      `/api/usage/token Bearer ${RELAY_KEY}`,
    ]);
  });

  test("changing the token drops the endpoint's last reading", async () => {
    relay.replies["/api/user/self"] = (response) => sendJson(response, 200, NEW_API_SELF);
    const balance = { url: `${relay.origin}/api/user/self` };
    const id = await savedRelayId({ balance, balanceToken: TOKEN });
    await read(id);
    const kept = await readFile(
      path.join(daemon.paseoHome, "api-endpoints", "balance-readings.json"),
      "utf8",
    );
    expect(kept).toContain("$5.00");
    expect(kept).not.toContain(TOKEN);
    relay.replies["/api/user/self"] = (response) => sendJson(response, 503, { error: "busy" });
    await savedRelayId({ endpointId: id, balanceToken: "another-token" });
    const reading = await read(id);
    expect(reading.status).toBe("failed");
    expect(reading.stale).toBeUndefined();
  });
});
