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
