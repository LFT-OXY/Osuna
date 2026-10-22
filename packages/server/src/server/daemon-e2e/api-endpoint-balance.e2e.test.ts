import { mkdtemp, rm } from "node:fs/promises";
import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * 接口的余额（工单 01）：真实 daemon + 本机假 DeepSeek 余额接口，时钟注入。
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

  async function startDaemon(balanceUrl: string) {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-balance-"));
    tempRoots.push(root);
    daemon = await createTestPaseoDaemon({
      daemonVersion: VERSION,
      apiEndpoints: {
        env: { CLAUDE_CONFIG_DIR: path.join(root, "claude"), CODEX_HOME: path.join(root, "codex") },
        homeDir: root,
        now: () => new Date(NOW),
        balanceUrls: { deepseek: balanceUrl },
      },
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.17.0" });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
  }

  beforeEach(async () => {
    deepseek = await startDeepSeek();
    await startDaemon(deepseek.balanceUrl);
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
      items: [{ label: null, text: "¥110.00", value: 110, unit: "CNY" }],
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
    await startDaemon("http://127.0.0.1:9/user/balance");
    const reading = await readOne(await saveDeepSeek());
    expect(reading.status).toBe("failed");
    expect(reading.failure?.reason).toBe("temporary");
    expect(reading.failure?.status).toBeNull();
    expect(reading.failure?.detail).toBeTruthy();
  });
});
