import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import { hashDaemonPassword } from "../auth.js";
import { createPaseoDaemon } from "../bootstrap.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
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
  // 同一个 home 再起一个 daemon（先关掉旧的），中转站地址随新端口。
  restart: () => Promise<{ daemon: TestPaseoDaemon; gateway: string }>;
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
    retryPauseMs?: number;
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
  const launch = async () => {
    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      // home 在 tempRoots 里统一删；重启要沿用它。
      cleanup: false,
      logger,
      ...(options.password ? { auth: { password: hashDaemonPassword(options.password) } } : {}),
      apiEndpoints: {
        env: {
          CLAUDE_CONFIG_DIR: path.join(root, "claude"),
          CODEX_HOME: path.join(root, "codex"),
        },
        homeDir: root,
        // 最后一家的原地重试只等很短的时间，测试不必真等一两秒。
        gatewayRetryPauseMs: options.retryPauseMs ?? 10,
        ...(options.headerTimeoutMs ? { gatewayHeaderTimeoutMs: options.headerTimeoutMs } : {}),
      },
    });
    daemons.push(daemon);
    return { daemon, gateway: `http://127.0.0.1:${daemon.port}/api-endpoint-gateway` };
  };
  const first = await launch();
  return {
    ...first,
    endpointsDir,
    logLines,
    restart: async () => {
      await first.daemon.close();
      return launch();
    },
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

    // 只有 A 选了 gpt-5.5：没有别家可换。
    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({ model: "gpt-5.5", max_tokens: 1, messages: [] }),
    );
    const text = await response.text();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("anthropic-ratelimit-requests-reset")).toBe("2026-10-14T12:00:30Z");
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    const body = JSON.parse(text) as { type: string; error: { type: string; message: string } };
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("rate_limit_error");
    // 限流判出了恢复时间，附在原文后面。
    expect(body.error.message).toMatch(
      /^Relay A: Slow down, key \*\*\* is busy \(available again at (\d{4}-\d{2}-\d{2} )?\d{2}:\d{2}\)$/,
    );
    // Retry-After 是 30 秒，超过原地重试肯等的 8 秒：只问了一次。
    expect(upstream.requests).toHaveLength(1);
    expect(logLines.join("\n")).not.toContain(KEY_A);
  });

  test.each([
    // 400 不值得再问；503 是最后一家，稍等后原地再问两次。
    { status: 400, asked: 1 },
    { status: 503, asked: 3 },
  ])("a $status comes back to Codex in OpenAI shape", async ({ status, asked }) => {
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
    expect(upstream.requests).toHaveLength(asked);
  });

  test("an endpoint that sends no response headers in time is a server error", async () => {
    const upstream = await startUpstream();
    upstream.respond = () => {};
    const { gateway } = await start({ upstreamA: upstream, headerTimeoutMs: 300 });

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({ model: "gpt-5.5", max_tokens: 1, messages: [] }),
    );

    expect(response.status).toBe(504);
    // 等不到响应头不原地重试：真实的等待是 10 分钟。
    expect(upstream.requests).toHaveLength(1);
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
      claudeRequest({ model: "gpt-5.5", max_tokens: 1, messages: [] }),
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

async function connectTo(daemon: TestPaseoDaemon): Promise<DaemonClient> {
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.15.1",
  });
  clients.push(client);
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  return client;
}

async function cooldownOf(client: DaemonClient, endpointId: string) {
  const list = await client.apiEndpointList("claude");
  return list.endpoints.find((endpoint) => endpoint.id === endpointId)?.cooldown ?? null;
}

/** 一段 Anthropic 流式回复；`cacheRead` 是这次从厂商缓存读到的 token 数。 */
function streamReply(res: ServerResponse, input: { text?: string; cacheRead?: number } = {}) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const usage = { input_tokens: 10, cache_read_input_tokens: input.cacheRead ?? 0 };
  res.write(
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage } })}\n\n`,
  );
  res.write(
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: input.text ?? "hi" } })}\n\n`,
  );
  res.end(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
}

function failWith(
  res: ServerResponse,
  input: { status: number; message: string; headers?: Record<string, string> },
) {
  res.writeHead(input.status, { "content-type": "application/json", ...input.headers });
  res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: input.message } }));
}

function receivedModel(request: RecordedRequest | undefined): unknown {
  return (JSON.parse(request?.body.toString() ?? "{}") as { model?: unknown }).model;
}

/** 两家都选了 kimi-k2：A 是用户选的（最早建的），B 在它之后。 */
async function twoRelays(options: { headerTimeoutMs?: number } = {}) {
  const upstreamA = await startUpstream();
  const upstreamB = await startUpstream();
  upstreamB.respond = (_request, res) => streamReply(res, { text: "from B" });
  const harness = await start({ upstreamA, upstreamB, ...options });
  const ask = (body: Record<string, unknown> = {}) =>
    fetch(
      `${harness.gateway}/v1/messages`,
      claudeRequest({
        model: "kimi-k2",
        stream: true,
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
        ...body,
      }),
    );
  return { ...harness, upstreamA, upstreamB, ask };
}

describe("switching to another endpoint when one fails", () => {
  test.each([
    { failure: "a rate limit", reason: "rate", status: 429, message: "Rate limit exceeded" },
    { failure: "no credit", reason: "credit", status: 402, message: "Insufficient balance" },
    { failure: "a server error", reason: "other", status: 503, message: "upstream busy" },
  ])(
    "$failure before the first byte goes to the next endpoint with the same model",
    async ({ reason, status, message }) => {
      const { upstreamA, upstreamB, ask, daemon, logLines } = await twoRelays();
      upstreamA.respond = (_request, res) => failWith(res, { status, message });

      const response = await ask();

      expect(response.status).toBe(200);
      expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
      expect(await response.text()).toContain("from B");
      expect(upstreamA.requests).toHaveLength(1);
      expect(receivedModel(upstreamB.requests[0])).toBe("kimi-k2");
      expect(upstreamB.requests[0]?.headers.authorization).toBe(`Bearer ${KEY_B}`);

      const client = await connectTo(daemon);
      expect(await cooldownOf(client, "ep_a")).toMatchObject({ state: "cooling_down", reason });
      expect(await cooldownOf(client, "ep_b")).toBeNull();
      const switched = logLines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((line) => line.msg === "API endpoint gateway switched endpoints");
      expect(switched).toMatchObject({ from: "Relay A", to: "Relay B", failure: reason });
      expect(typeof switched?.until).toBe("string");
    },
  );

  test("no response headers in time is a server error and goes to the next endpoint", async () => {
    const { upstreamA, upstreamB, ask } = await twoRelays({ headerTimeoutMs: 300 });
    upstreamA.respond = () => {};

    const response = await ask();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(upstreamB.requests).toHaveLength(1);
  });

  test("a request the endpoint could not read goes to the next one without cooling the first", async () => {
    const { upstreamA, upstreamB, ask, daemon } = await twoRelays();
    upstreamA.respond = (_request, res) =>
      failWith(res, { status: 400, message: "Extra inputs are not permitted" });

    const response = await ask();

    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    await response.text();
    expect(upstreamB.requests).toHaveLength(1);
    expect(await cooldownOf(await connectTo(daemon), "ep_a")).toBeNull();
  });

  test("an error the next endpoint could not fix either is not passed on to it", async () => {
    const { upstreamA, upstreamB, ask } = await twoRelays();
    upstreamA.respond = (_request, res) =>
      failWith(res, { status: 400, message: "prompt is too long: 210000 tokens > 200000" });

    const response = await ask();

    expect(response.status).toBe(400);
    expect(upstreamB.requests).toHaveLength(0);
    expect(await response.json()).toMatchObject({
      error: { message: "Relay A: prompt is too long: 210000 tokens > 200000" },
    });
  });

  test("after the first byte it stays: the broken stream reaches the agent and the endpoint cools down", async () => {
    const { upstreamA, upstreamB, ask, daemon } = await twoRelays();
    upstreamA.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`event: message_start\ndata: {"type":"message_start","message":{}}\n\n`);
      setTimeout(() => res.destroy(), 50);
    };

    const response = await ask();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    await expect(response.text()).rejects.toThrow();
    expect(upstreamB.requests).toHaveLength(0);
    const client = await connectTo(daemon);
    await expect.poll(() => cooldownOf(client, "ep_a")).toMatchObject({ state: "cooling_down" });
  });

  test("an endpoint that broke off before the first byte is switched away from", async () => {
    const { upstreamA, ask } = await twoRelays();
    upstreamA.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.flushHeaders();
      setTimeout(() => res.destroy(), 50);
    };

    const response = await ask();

    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(await response.text()).toContain("from B");
  });

  test("a cooling endpoint is skipped until it is brought back by hand", async () => {
    const { upstreamA, upstreamB, ask, daemon, logLines } = await twoRelays();
    upstreamA.respond = (_request, res) => failWith(res, { status: 503, message: "busy" });
    await (await ask()).text();
    const client = await connectTo(daemon);
    const cooldown = await cooldownOf(client, "ep_a");
    expect(cooldown).toMatchObject({ state: "cooling_down", reason: "other" });
    expect(Date.parse(cooldown?.until ?? "")).toBeGreaterThan(Date.now());

    upstreamA.respond = (_request, res) => streamReply(res, { text: "from A" });
    const whileCooling = await ask();
    expect(whileCooling.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    await whileCooling.text();
    expect(upstreamA.requests).toHaveLength(1);

    await client.apiEndpointSetEndpointState({ endpointId: "ep_a", clearCooldown: true });
    expect(await cooldownOf(client, "ep_a")).toBeNull();
    const afterRecovery = await ask();
    expect(afterRecovery.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(await afterRecovery.text()).toContain("from A");
    expect(upstreamB.requests).toHaveLength(2);
    expect(logLines.some((line) => line.includes("API endpoint cooldown ended"))).toBe(true);
  });

  test("a bad key needs checking: it is not asked again until its connection is edited", async () => {
    const { upstreamA, upstreamB, ask, daemon } = await twoRelays();
    upstreamA.respond = (_request, res) => failWith(res, { status: 401, message: "invalid key" });
    await (await ask()).text();
    const client = await connectTo(daemon);
    expect(await cooldownOf(client, "ep_a")).toEqual({
      state: "needs_check",
      reason: "auth",
      until: null,
    });

    await (await ask()).text();
    expect(upstreamA.requests).toHaveLength(1);
    expect(upstreamB.requests).toHaveLength(2);

    await client.apiEndpointSave({
      provider: "claude",
      endpointId: "ep_a",
      name: "Relay A",
      baseUrls: [{ format: "anthropic_messages", url: upstreamA.url }],
      apiKey: "sk-fixed-key",
      models: [{ id: "kimi-k2" }, { id: "gpt-5.5" }],
    });
    expect(await cooldownOf(client, "ep_a")).toBeNull();
    upstreamA.respond = (_request, res) => streamReply(res, { text: "from A" });
    const fixed = await ask();
    expect(fixed.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(upstreamA.requests.at(-1)?.headers.authorization).toBe("Bearer sk-fixed-key");
    await fixed.text();
  });

  test("with every endpoint out of quota the last one's error comes back, and none is asked until one is back", async () => {
    const { upstreamA, upstreamB, ask } = await twoRelays();
    upstreamA.respond = (_request, res) =>
      failWith(res, { status: 429, message: "You exceeded your current quota" });
    upstreamB.respond = (_request, res) =>
      failWith(res, { status: 429, message: "B: monthly quota used up" });

    const first = await ask();
    expect(first.status).toBe(429);
    expect(first.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(((await first.json()) as { error: { message: string } }).error.message).toMatch(
      /^Relay B: B: monthly quota used up \(available again at /,
    );
    expect(upstreamA.requests).toHaveLength(1);
    expect(upstreamB.requests).toHaveLength(1);

    const held = await ask();
    expect(held.status).toBe(429);
    expect(held.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(Number(held.headers.get("retry-after"))).toBeGreaterThan(800);
    expect(((await held.json()) as { error: { message: string } }).error.message).toMatch(
      /^Relay B: B: monthly quota used up \(available again at /,
    );
    expect(upstreamA.requests).toHaveLength(1);
    expect(upstreamB.requests).toHaveLength(1);
  });

  test("any edit of the endpoint lifts needing a check, but editing only its models keeps a cooldown", async () => {
    const { upstreamA, ask, daemon } = await twoRelays();
    const client = await connectTo(daemon);
    const saveModels = () =>
      client.apiEndpointSave({
        provider: "claude",
        endpointId: "ep_a",
        name: "Relay A",
        baseUrls: [
          { format: "anthropic_messages", url: upstreamA.url },
          { format: "openai_responses", url: `${upstreamA.url}/v1` },
        ],
        models: [{ id: "kimi-k2" }],
      });
    upstreamA.respond = (_request, res) => failWith(res, { status: 503, message: "busy" });
    await (await ask()).text();
    await saveModels();
    expect(await cooldownOf(client, "ep_a")).toMatchObject({ state: "cooling_down" });

    await client.apiEndpointSetEndpointState({ endpointId: "ep_a", clearCooldown: true });
    upstreamA.respond = (_request, res) => failWith(res, { status: 403, message: "forbidden" });
    await (await ask()).text();
    expect(await cooldownOf(client, "ep_a")).toMatchObject({ state: "needs_check" });
    await saveModels();
    expect(await cooldownOf(client, "ep_a")).toBeNull();
  });

  test("cooldowns live in memory only: a restarted daemon starts with none", async () => {
    const { upstreamA, ask, daemon, restart } = await twoRelays();
    upstreamA.respond = (_request, res) => failWith(res, { status: 402, message: "no credit" });
    await (await ask()).text();
    expect(await cooldownOf(await connectTo(daemon), "ep_a")).toMatchObject({ reason: "credit" });

    const next = await restart();

    expect(await cooldownOf(await connectTo(next.daemon), "ep_a")).toBeNull();
  });

  test("the log has one line per switch and per cooldown, with the endpoint name and never a key", async () => {
    const { upstreamA, ask, daemon, logLines } = await twoRelays();
    upstreamA.respond = (_request, res) =>
      failWith(res, { status: 429, message: `quota used up for ${KEY_A}` });
    await (await ask()).text();
    await (
      await connectTo(daemon)
    ).apiEndpointSetEndpointState({
      endpointId: "ep_a",
      clearCooldown: true,
    });

    const lines = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const about = (msg: string) => lines.filter((line) => line.msg === msg);
    expect(about("API endpoint is cooling down")).toEqual([
      expect.objectContaining({ endpoint: "Relay A", failure: "quota", until: expect.any(String) }),
    ]);
    expect(about("API endpoint gateway switched endpoints")).toEqual([
      expect.objectContaining({ from: "Relay A", to: "Relay B", failure: "quota" }),
    ]);
    expect(about("API endpoint cooldown ended")).toEqual([
      expect.objectContaining({ endpoint: "Relay A", failure: "quota" }),
    ]);
    expect(logLines.join("\n")).not.toContain(KEY_A);
    expect(logLines.join("\n")).not.toContain(KEY_B);
  });
});

describe("a conversation stays where it was answered", () => {
  const userSays = (text: string) => ({ role: "user", content: text });
  const toolCall = {
    role: "assistant",
    content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }],
  };
  const toolResult = {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "t1", content: "file" }],
  };

  test("within a turn it stays with the endpoint that took over; a new turn goes back to the user's choice", async () => {
    const { upstreamA, upstreamB, ask, daemon } = await twoRelays();
    const client = await connectTo(daemon);
    upstreamA.respond = (_request, res) => failWith(res, { status: 503, message: "busy" });
    await (await ask({ messages: [userSays("hi")] })).text();
    await client.apiEndpointSetEndpointState({ endpointId: "ep_a", clearCooldown: true });
    upstreamA.respond = (_request, res) => streamReply(res, { text: "from A" });

    const sameTurn = await ask({ messages: [userSays("hi"), toolCall, toolResult] });
    expect(sameTurn.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    await sameTurn.text();

    const newTurn = await ask({
      messages: [
        userSays("hi"),
        toolCall,
        toolResult,
        { role: "assistant", content: "ok" },
        userSays("next"),
      ],
    });
    expect(newTurn.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    await newTurn.text();
    expect(upstreamB.requests).toHaveLength(2);
  });

  test("a new turn stays with it while its cache is warm", async () => {
    const { upstreamA, upstreamB, ask, daemon } = await twoRelays();
    const client = await connectTo(daemon);
    upstreamA.respond = (_request, res) => failWith(res, { status: 503, message: "busy" });
    upstreamB.respond = (_request, res) => streamReply(res, { text: "from B", cacheRead: 2048 });
    await (await ask({ messages: [userSays("hi")] })).text();
    await client.apiEndpointSetEndpointState({ endpointId: "ep_a", clearCooldown: true });
    upstreamA.respond = (_request, res) => streamReply(res, { text: "from A" });

    const newTurn = await ask({
      messages: [userSays("hi"), { role: "assistant", content: "hello" }, userSays("more")],
    });

    expect(newTurn.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    await newTurn.text();
    expect(upstreamA.requests).toHaveLength(1);
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

describe("the CLI configs follow the gateway across daemon starts", () => {
  const USER_SETTINGS = `{\n  "theme": "dark"\n}\n`;
  const USER_CONFIG = `# mine\napproval_policy = "never"\n`;

  interface Home {
    root: string;
    endpointsDir: string;
    settingsPath: string;
    configPath: string;
  }

  async function prepareHome(files: Record<string, unknown> = {}): Promise<Home> {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-gw-start-"));
    tempRoots.push(root);
    const endpointsDir = path.join(root, ".paseo", "api-endpoints");
    await mkdir(endpointsDir, { recursive: true });
    for (const [name, value] of Object.entries(files)) {
      const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      await writeFile(path.join(endpointsDir, name), text);
    }
    await mkdir(path.join(root, "claude"), { recursive: true });
    await mkdir(path.join(root, "codex"), { recursive: true });
    const settingsPath = path.join(root, "claude", "settings.json");
    const configPath = path.join(root, "codex", "config.toml");
    await writeFile(settingsPath, USER_SETTINGS);
    await writeFile(configPath, USER_CONFIG);
    return { root, endpointsDir, settingsPath, configPath };
  }

  function apiEndpointsConfig(home: Home) {
    return {
      env: {
        CLAUDE_CONFIG_DIR: path.join(home.root, "claude"),
        CODEX_HOME: path.join(home.root, "codex"),
      },
      homeDir: home.root,
    };
  }

  async function connect(url: string): Promise<DaemonClient> {
    const client = new DaemonClient({ url, appVersion: "0.15.1" });
    clients.push(client);
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    return client;
  }

  async function tokens(home: Home): Promise<Record<string, string>> {
    const text = await readFile(path.join(home.endpointsDir, "gateway-tokens.json"), "utf8");
    return (JSON.parse(text) as { tokens: Record<string, string> }).tokens;
  }

  /** 拿一个此刻没人用、也不是 `taken` 的端口。 */
  async function freePort(taken: number): Promise<number> {
    const server = createNetServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port === taken ? freePort(taken) : port;
  }

  const SEEDED_ENDPOINT = storedEndpoint({
    id: "ep_a",
    slug: "relay-a",
    name: "Relay A",
    baseUrls: [{ format: "anthropic_messages", url: "http://127.0.0.1:9" }],
    models: ["kimi-k2"],
  });

  test("a restart on another port rewrites the gateway address in both configs and nothing else", async () => {
    const home = await prepareHome();
    const first = await createTestPaseoDaemon({
      paseoHomeRoot: home.root,
      cleanup: false,
      apiEndpoints: apiEndpointsConfig(home),
    });
    const client = await connect(`ws://127.0.0.1:${first.port}/ws`);
    await client.apiEndpointSave({
      provider: "claude",
      name: "Relay A",
      baseUrls: [{ format: "anthropic_messages", url: "https://a.example" }],
      apiKey: KEY_A,
      models: [{ id: "kimi-k2" }],
    });
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: true });
    const settingsBefore = await readFile(home.settingsPath, "utf8");
    const configBefore = await readFile(home.configPath, "utf8");
    const tokensBefore = await tokens(home);
    const nextPort = await freePort(first.port);
    await client.close();
    await first.close();

    const second = await createTestPaseoDaemon({
      paseoHomeRoot: home.root,
      listenPort: nextPort,
      apiEndpoints: apiEndpointsConfig(home),
    });
    daemons.push(second);

    const moved = (text: string) =>
      text.replaceAll(`127.0.0.1:${first.port}/`, `127.0.0.1:${nextPort}/`);
    expect(settingsBefore).toContain(`127.0.0.1:${first.port}/api-endpoint-gateway`);
    expect(await readFile(home.settingsPath, "utf8")).toBe(moved(settingsBefore));
    expect(configBefore).toContain(`127.0.0.1:${first.port}/api-endpoint-gateway/v1`);
    expect(await readFile(home.configPath, "utf8")).toBe(moved(configBefore));
    expect(await tokens(home)).toEqual(tokensBefore);
  });

  test("agents that were on before the gateway existed get a token and point at the gateway on start", async () => {
    // 旧数据换算来的：总开关开着，却没有口令，CLI 配置也还没指向中转站。
    const home = await prepareHome({
      "endpoints.json": {
        endpoints: [SEEDED_ENDPOINT],
        agents: {
          claude: { enabled: true, defaultModelId: "kimi-k2" },
          codex: { enabled: true, defaultModelId: "kimi-k2" },
        },
      },
      "keys.json": { keys: { ep_a: KEY_A } },
    });

    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot: home.root,
      apiEndpoints: apiEndpointsConfig(home),
    });
    daemons.push(daemon);

    const { claude, codex } = await tokens(home);
    expect(claude).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codex).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const gateway = `http://127.0.0.1:${daemon.port}/api-endpoint-gateway`;
    expect(JSON.parse(await readFile(home.settingsPath, "utf8"))).toEqual({
      theme: "dark",
      env: { ANTHROPIC_BASE_URL: gateway, ANTHROPIC_AUTH_TOKEN: claude, ANTHROPIC_API_KEY: "" },
      permissions: { deny: ["WebSearch"] },
      model: "kimi-k2",
    });
    const config = await readFile(home.configPath, "utf8");
    expect(config).toContain(`base_url = "${gateway}/v1"`);
    expect(config).toContain(`experimental_bearer_token = "${codex}"`);
    const catalog = JSON.parse(
      await readFile(path.join(home.endpointsDir, "codex-models.json"), "utf8"),
    ) as { models: Array<{ slug: string }> };
    expect(catalog.models.map((model) => model.slug)).toEqual(["kimi-k2", "relay-a/kimi-k2"]);
    const hello = await fetch(`${gateway}/api/hello`, {
      headers: { authorization: `Bearer ${claude}` },
    });
    expect(hello.status).toBe(200);
  });

  test("the dedicated table and key file an older version left behind on Official are removed on start", async () => {
    const legacyTable = `
[model_providers.osuna_api_endpoint]
name = "Relay"
base_url = "https://relay.example/v1"
wire_api = "responses"

[model_providers.osuna_api_endpoint.auth]
command = "/bin/cat"
args = ["/somewhere/codex-api-key"]
timeout_ms = 5000
`;
    const home = await prepareHome({
      "endpoints.json": {
        endpoints: [SEEDED_ENDPOINT],
        agents: {
          claude: { enabled: false, defaultModelId: null },
          codex: { enabled: false, defaultModelId: "kimi-k2" },
        },
      },
      "keys.json": { keys: { ep_a: KEY_A } },
      "codex-api-key": KEY_A,
      "takeover-codex.json": {
        takeover: null,
        providerTable: { endpointId: "ep_a" },
        backup: { path: null },
      },
    });
    await writeFile(home.configPath, `${USER_CONFIG}${legacyTable}`);

    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot: home.root,
      apiEndpoints: apiEndpointsConfig(home),
    });
    daemons.push(daemon);

    expect(await readFile(home.configPath, "utf8")).toBe(USER_CONFIG);
    await expect(stat(path.join(home.endpointsDir, "codex-api-key"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  // unix socket 监听只在 POSIX 上有。
  test.skipIf(process.platform === "win32")(
    "a daemon listening on a socket refuses to turn the switch on and says why",
    async () => {
      const home = await prepareHome({
        "endpoints.json": {
          endpoints: [
            SEEDED_ENDPOINT,
            storedEndpoint({
              id: "ep_b",
              slug: "relay-b",
              name: "Relay B",
              baseUrls: [{ format: "anthropic_messages", url: "http://127.0.0.1:9" }],
              models: ["glm-4.6"],
            }),
          ],
          agents: {
            claude: { enabled: true, defaultModelId: "kimi-k2" },
            codex: { enabled: false, defaultModelId: null },
          },
        },
        "keys.json": { keys: { ep_a: KEY_A, ep_b: KEY_B } },
        "gateway-tokens.json": { tokens: { claude: CLAUDE_TOKEN } },
        "takeover-claude.json": {
          takeover: {
            originalFile: { kind: "content" },
            env: {
              ANTHROPIC_BASE_URL: {
                original: { present: false },
                written: "https://relay.example",
              },
              ANTHROPIC_AUTH_TOKEN: { original: { present: false }, written: KEY_A },
            },
            envCreated: true,
            webSearchDeny: { added: false, permissionsCreated: false, denyCreated: false },
          },
          backup: { path: null },
        },
      });
      const socketPath = path.join(home.root, "d.sock");
      const staticDir = path.join(home.root, "static");
      await mkdir(staticDir);
      const paseoHome = path.join(home.root, ".paseo");
      const daemon = await createPaseoDaemon(
        {
          listen: socketPath,
          paseoHome,
          corsAllowedOrigins: [],
          hostnames: true,
          mcpEnabled: false,
          staticDir,
          mcpDebug: false,
          agentClients: createTestAgentClients(),
          agentStoragePath: path.join(paseoHome, "agents"),
          relayEnabled: false,
          appBaseUrl: "https://app.paseo.sh",
          openai: undefined,
          speech: undefined,
          usage: {
            roots: { claude: [], codex: [], pi: [], omp: [] },
            pricing: { autoUpdate: false },
          },
          apiEndpoints: apiEndpointsConfig(home),
        },
        pino({ level: "silent" }),
      );
      await daemon.start();
      try {
        const client = await connect(`ws+unix://${socketPath}:/ws`);

        const reason = {
          code: "gateway_requires_tcp",
          message: expect.stringContaining("socket"),
        };
        // 已经开着的总开关照旧开着，列表说明为什么不可用；CLI 配置不动。
        const listed = await client.apiEndpointList("claude");
        expect(listed.agents?.claude?.enabled).toBe(true);
        expect(listed.gatewayUnavailable).toEqual(reason);
        expect(await readFile(home.settingsPath, "utf8")).toBe(USER_SETTINGS);

        const turnedOn = await client.apiEndpointSetAgentSettings({
          provider: "codex",
          enabled: true,
        });
        expect(turnedOn.error).toEqual(reason);
        expect((await client.apiEndpointSetActive("codex", "ep_a")).error?.code).toBe(
          "gateway_requires_tcp",
        );
        expect((await client.apiEndpointList("codex")).agents?.codex?.enabled).toBe(false);
        expect(await readFile(home.configPath, "utf8")).toBe(USER_CONFIG);

        // 关掉一家接口照常可以；Claude 的默认模型换家，但它的 CLI 配置从没指向过中转站（记录里是旧版本
        // 直接写的第三方地址），没有地址可写：不动它，口令更不能写到第三方地址那里。
        const off = await client.apiEndpointSetEndpointState({
          endpointId: "ep_a",
          enabled: false,
        });
        expect(off.error).toBeNull();
        expect((await client.apiEndpointList("claude")).agents?.claude).toEqual({
          enabled: true,
          defaultModelId: "glm-4.6",
        });
        expect(await readFile(home.settingsPath, "utf8")).toBe(USER_SETTINGS);
      } finally {
        await daemon.stop().catch(() => undefined);
        await daemon.agentManager.flush().catch(() => undefined);
      }
    },
  );
});
