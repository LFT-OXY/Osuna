import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import { hashDaemonPassword } from "../auth.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * 中转站直通（工单 02）：真实 daemon + 本机假上游。CLI 这一侧用 fetch 扮演，
 * 带上 gateway-tokens.json 里的口令，就像 CLI 读自己的配置文件那样。
 */

const CLAUDE_TOKEN = "gateway-token-claude-0123456789";
const CODEX_TOKEN = "gateway-token-codex-0123456789";
const KEY_A = "sk-real-key-alpha-SECRET";
const KEY_B = "sk-real-key-beta-SECRET";

interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

interface FakeUpstream {
  url: string;
  requests: RecordedRequest[];
  // 每个请求怎么回；默认 200 空 JSON。
  respond: (request: RecordedRequest, res: ServerResponse) => void;
}

interface Harness {
  daemon: TestPaseoDaemon;
  gateway: string;
  endpointsDir: string;
  logLines: string[];
}

const servers: Server[] = [];
const tempRoots: string[] = [];
const daemons: TestPaseoDaemon[] = [];
const clients: DaemonClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function startUpstream(): Promise<FakeUpstream> {
  const upstream: FakeUpstream = {
    url: "",
    requests: [],
    respond: (_request, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    },
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const request = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks),
      };
      upstream.requests.push(request);
      upstream.respond(request, res);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  upstream.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return upstream;
}

function storedEndpoint(input: {
  id: string;
  slug: string;
  name: string;
  baseUrls: { format: string; url: string }[];
  models: string[];
  enabled?: boolean;
}) {
  return {
    id: input.id,
    slug: input.slug,
    name: input.name,
    baseUrls: input.baseUrls,
    models: input.models.map((id) => ({ id })),
    enabled: input.enabled ?? true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

/** 两家接口：A 有 Anthropic 与 Responses 地址，B 只有 Anthropic 地址；两个 Agent 都开着。 */
async function start(
  options: {
    upstreamA?: FakeUpstream;
    upstreamB?: FakeUpstream;
    password?: string;
    headerTimeoutMs?: number;
  } = {},
): Promise<Harness> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-gateway-"));
  tempRoots.push(root);
  const endpointsDir = path.join(root, ".paseo", "api-endpoints");
  await mkdir(endpointsDir, { recursive: true });
  const urlA = options.upstreamA?.url ?? "http://127.0.0.1:9";
  const urlB = options.upstreamB?.url ?? "http://127.0.0.1:9";
  const files = {
    "endpoints.json": {
      endpoints: [
        storedEndpoint({
          id: "ep_a",
          slug: "relay-a",
          name: "Relay A",
          baseUrls: [
            { format: "anthropic_messages", url: urlA },
            { format: "openai_responses", url: `${urlA}/v1` },
          ],
          models: ["kimi-k2", "gpt-5.5"],
        }),
        storedEndpoint({
          id: "ep_b",
          slug: "relay-b",
          name: "Relay B",
          baseUrls: [{ format: "anthropic_messages", url: urlB }],
          models: ["kimi-k2", "glm-4.6"],
        }),
      ],
      agents: {
        claude: { enabled: true, defaultModelId: "kimi-k2" },
        codex: { enabled: true, defaultModelId: "gpt-5.5" },
      },
    },
    "keys.json": { keys: { ep_a: KEY_A, ep_b: KEY_B } },
    "gateway-tokens.json": { tokens: { claude: CLAUDE_TOKEN, codex: CODEX_TOKEN } },
  };
  for (const [name, value] of Object.entries(files)) {
    await writeFile(path.join(endpointsDir, name), JSON.stringify(value, null, 2));
  }

  const logLines: string[] = [];
  const logger = pino({ level: "debug" }, { write: (line: string) => logLines.push(line) });
  const daemon = await createTestPaseoDaemon({
    paseoHomeRoot: root,
    logger,
    ...(options.password ? { auth: { password: hashDaemonPassword(options.password) } } : {}),
    apiEndpoints: {
      env: {
        CLAUDE_CONFIG_DIR: path.join(root, "claude"),
        CODEX_HOME: path.join(root, "codex"),
      },
      homeDir: root,
      ...(options.headerTimeoutMs ? { gatewayHeaderTimeoutMs: options.headerTimeoutMs } : {}),
    },
  });
  daemons.push(daemon);
  return {
    daemon,
    gateway: `http://127.0.0.1:${daemon.port}/api-endpoint-gateway`,
    endpointsDir,
    logLines,
  };
}

function claudeRequest(body: unknown, token = CLAUDE_TOKEN): RequestInit {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "claude-code-20250219",
      "x-claude-code-session-id": "session-1",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

describe("who may use the gateway", () => {
  test("requests without the token or with a wrong one are refused", async () => {
    const { gateway } = await start();

    const missing = await fetch(`${gateway}/api/hello`);
    const wrong = await fetch(`${gateway}/api/hello`, {
      headers: { authorization: "Bearer not-the-token" },
    });

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({
      error: {
        message: "Invalid API endpoint gateway token",
        type: "authentication_error",
        code: null,
        param: null,
      },
    });
  });

  test("a request that came through a proxy is not local and is refused", async () => {
    const { gateway } = await start();

    const proxied = await fetch(`${gateway}/api/hello`, {
      headers: { authorization: `Bearer ${CLAUDE_TOKEN}`, "x-forwarded-for": "203.0.113.9" },
    });

    expect(proxied.status).toBe(403);
  });

  test("the daemon password does not apply and bodies over 100 kb go through", async () => {
    const upstream = await startUpstream();
    const { gateway } = await start({ upstreamA: upstream, password: "daemon-secret" });
    const body = JSON.stringify({
      model: "kimi-k2",
      max_tokens: 10,
      messages: [{ role: "user", content: "x".repeat(300_000) }],
    });

    const hello = await fetch(`${gateway}/api/hello`, {
      headers: { authorization: `Bearer ${CLAUDE_TOKEN}` },
    });
    const response = await fetch(`${gateway}/v1/messages`, claudeRequest(body));

    expect(hello.status).toBe(200);
    expect(response.status).toBe(200);
    expect(upstream.requests[0]?.body.toString()).toBe(body);
  });

  test("turning an agent on creates its private token and turning it off deletes it", async () => {
    const { daemon, endpointsDir } = await start();
    const tokensPath = path.join(endpointsDir, "gateway-tokens.json");
    await writeFile(tokensPath, JSON.stringify({ tokens: {} }));
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.15.1",
    });
    clients.push(client);
    await client.connect();
    await client.fetchAgents({ subscribe: {} });

    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    const afterOn = JSON.parse(await readFile(tokensPath, "utf8")) as {
      tokens: Record<string, string>;
    };
    const mode = (await stat(tokensPath)).mode & 0o777;

    const acceptedWhileOn = await fetch(
      `http://127.0.0.1:${daemon.port}/api-endpoint-gateway/api/hello`,
      {
        headers: { authorization: `Bearer ${afterOn.tokens.claude}` },
      },
    );
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    const afterOff = JSON.parse(await readFile(tokensPath, "utf8")) as {
      tokens: Record<string, string>;
    };
    const refusedAfter = await fetch(
      `http://127.0.0.1:${daemon.port}/api-endpoint-gateway/api/hello`,
      {
        headers: { authorization: `Bearer ${afterOn.tokens.claude}` },
      },
    );

    expect(afterOn.tokens.claude).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mode).toBe(0o600);
    expect(acceptedWhileOn.status).toBe(200);
    // Codex 一直开着：补上的口令在之后的改动里保持不变。
    expect(afterOn.tokens.codex).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(afterOff.tokens).toEqual({ codex: afterOn.tokens.codex });
    expect(refusedAfter.status).toBe(401);
  });
});

describe("passing requests through to an endpoint that speaks the agent's format", () => {
  test("Claude requests reach the Anthropic address unchanged apart from the model and auth, and stream back", async () => {
    const upstream = await startUpstream();
    let releaseRest: () => void = () => {};
    const restReleased = new Promise<void>((resolve) => {
      releaseRest = resolve;
    });
    upstream.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream", "request-id": "req_1" });
      res.write('event: message_start\ndata: {"type":"message_start"}\n\n');
      void restReleased.then(() => {
        res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
        return undefined;
      });
    };
    const { gateway } = await start({ upstreamA: upstream });
    // 空格、键序与 cache_control 都要原样到达上游。
    const body = `{"model":  "relay-a/kimi-k2", "stream": true,"max_tokens":32,
      "system":[{"type":"text","text":"sys","cache_control":{"type":"ephemeral"}}],
      "messages":[{"role":"user","content":"hi"}]}`;

    const response = await fetch(`${gateway}/v1/messages?beta=true`, claudeRequest(body));
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    releaseRest();
    let rest = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      rest += new TextDecoder().decode(chunk.value);
    }

    const received = upstream.requests[0]!;
    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("request-id")).toBe("req_1");
    expect(first).toBe('event: message_start\ndata: {"type":"message_start"}\n\n');
    expect(rest).toBe('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    expect(received.method).toBe("POST");
    expect(received.url).toBe("/v1/messages?beta=true");
    expect(received.body.toString()).toBe(body.replace('"relay-a/kimi-k2"', '"kimi-k2"'));
    expect(received.headers.authorization).toBe(`Bearer ${KEY_A}`);
    expect(received.headers["x-api-key"]).toBe(KEY_A);
    expect(received.headers["anthropic-version"]).toBe("2023-06-01");
    expect(received.headers["anthropic-beta"]).toBe("claude-code-20250219");
    expect(received.headers["x-claude-code-session-id"]).toBe("session-1");
  });

  test("Codex requests reach the Responses address and a non-streaming reply comes back whole", async () => {
    const upstream = await startUpstream();
    const reply = { id: "resp_1", object: "response", output: [], model: "gpt-5.5" };
    upstream.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply));
    };
    const { gateway } = await start({ upstreamA: upstream });
    const body = JSON.stringify({ model: "gpt-5.5", input: "hi", stream: false });

    const response = await fetch(`${gateway}/v1/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${CODEX_TOKEN}`,
        "content-type": "application/json",
        "thread-id": "thread-1",
      },
      body,
    });

    const received = upstream.requests[0]!;
    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(await response.json()).toEqual(reply);
    expect(received.url).toBe("/v1/responses");
    expect(received.body.toString()).toBe(body);
    expect(received.headers.authorization).toBe(`Bearer ${KEY_A}`);
    expect(received.headers["x-api-key"]).toBeUndefined();
    expect(received.headers["thread-id"]).toBe("thread-1");
  });

  test("a Claude tier name is sent as the model the endpoint maps it to", async () => {
    const upstreamB = await startUpstream();
    const { gateway, endpointsDir } = await start({ upstreamB });
    const endpointsPath = path.join(endpointsDir, "endpoints.json");
    const file = JSON.parse(await readFile(endpointsPath, "utf8")) as {
      endpoints: { modelMapping?: Record<string, string> }[];
    };
    file.endpoints[1]!.modelMapping = { haiku: "glm-4.6" };
    await writeFile(endpointsPath, JSON.stringify(file));

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({ model: "claude-haiku-4-5-20251001", max_tokens: 1, messages: [] }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(JSON.parse(upstreamB.requests[0]!.body.toString())).toEqual({
      model: "glm-4.6",
      max_tokens: 1,
      messages: [],
    });
  });

  test("a model no enabled endpoint offers is an error in the agent's format", async () => {
    const { gateway } = await start();

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({ model: "no-such-model", max_tokens: 1, messages: [] }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      type: "error",
      error: {
        type: "not_found_error",
        message: 'No enabled API endpoint offers the model "no-such-model"',
      },
    });
  });
});

describe("when the endpoint fails", () => {
  test("an endpoint without the agent's own format address is refused until translation exists", async () => {
    const { gateway } = await start();

    const response = await fetch(`${gateway}/v1/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${CODEX_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "glm-4.6", input: "hi" }),
    });

    expect(response.status).toBe(502);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(await response.json()).toEqual({
      error: {
        message: "Relay B: no address for this agent's request format",
        type: "api_error",
        code: null,
        param: null,
      },
    });
  });

  test("its status, its message under the endpoint name and Retry-After come back in Anthropic shape", async () => {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => {
      res.writeHead(429, {
        "content-type": "application/json",
        "retry-after": "30",
        "anthropic-ratelimit-requests-reset": "2026-10-14T12:00:30Z",
      });
      res.end(
        JSON.stringify({
          type: "error",
          error: { type: "rate_limit_error", message: `Slow down, key ${KEY_A} is busy` },
        }),
      );
    };
    const { gateway, logLines } = await start({ upstreamA: upstream });

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({ model: "relay-a/kimi-k2", max_tokens: 1, messages: [] }),
    );
    const text = await response.text();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("anthropic-ratelimit-requests-reset")).toBe("2026-10-14T12:00:30Z");
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(JSON.parse(text)).toEqual({
      type: "error",
      error: { type: "rate_limit_error", message: "Relay A: Slow down, key *** is busy" },
    });
    expect(logLines.join("\n")).not.toContain(KEY_A);
  });

  test.each([400, 503])("a %i comes back to Codex in OpenAI shape", async (status) => {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "upstream says no", type: "bad", code: "x1" } }));
    };
    const { gateway } = await start({ upstreamA: upstream });

    const response = await fetch(`${gateway}/v1/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${CODEX_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
    });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: { message: "Relay A: upstream says no", type: "bad", code: "x1", param: null },
    });
  });

  test("an endpoint that sends no response headers in time is a server error", async () => {
    const upstream = await startUpstream();
    upstream.respond = () => {};
    const { gateway } = await start({ upstreamA: upstream, headerTimeoutMs: 300 });

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({ model: "relay-a/kimi-k2", max_tokens: 1, messages: [] }),
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      type: "error",
      error: { type: "api_error", message: "Relay A: no response headers within 0.3s" },
    });
  });

  test("the real keys never reach the daemon log or a response", async () => {
    const upstream = await startUpstream();
    upstream.respond = (request, res) => {
      res.writeHead(401, { "content-type": "text/plain" });
      res.end(`bad key ${String(request.headers.authorization)}`);
    };
    const { gateway, logLines } = await start({ upstreamA: upstream });

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({ model: "relay-a/kimi-k2", max_tokens: 1, messages: [] }),
    );
    const text = await response.text();

    expect(upstream.requests[0]?.headers.authorization).toBe(`Bearer ${KEY_A}`);
    expect(JSON.parse(text)).toEqual({
      type: "error",
      error: { type: "authentication_error", message: "Relay A: bad key Bearer ***" },
    });
    // 日志里确有这次失败的记录，下面「不含 key」的断言才有意义。
    expect(logLines.some((line) => line.includes("API endpoint returned an error"))).toBe(true);
    expect(logLines.join("\n")).not.toContain(KEY_A);
    expect(logLines.join("\n")).not.toContain(KEY_B);
  });
});

describe("model list and warm-up", () => {
  test("/v1/models lists each enabled endpoint's selected model once, and /api/hello answers", async () => {
    const { gateway } = await start();
    const headers = { authorization: `Bearer ${CODEX_TOKEN}` };

    const models = await fetch(`${gateway}/v1/models`, { headers });
    const hello = await fetch(`${gateway}/api/hello`, { headers });

    expect(models.status).toBe(200);
    const list = (await models.json()) as { data: { id: string }[] };
    expect(list.data.map((model) => model.id)).toEqual(["kimi-k2", "gpt-5.5", "glm-4.6"]);
    expect(hello.status).toBe(200);
  });
});
