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
 * 拒收的厂商原话照 magpie（MIT，THIRD_PARTY_NOTICES）的 sub2api_think_off_test.go、gateway_test.go
 * （含 TestAnthropicClientFallsBackPastCopilotNoEndpoints）、internal/provider/authheader_test.go，
 * 以及 safeguards_refused_test.go、thinking_display_test.go、thinking_off_test.go、deferred_tools_test.go、
 * tool_reference_result_test.go、strict_refused_test.go、image_tool_test.go（含 testdata/codex_image_gen_tool.json）、
 * format_refused_test.go 与 prefill_test.go；直通的通用修补照 billing_line_test.go（Claude Code 的一轮）与 codex_backend.go 的 withoutBareReasoning。
 */

const CLAUDE_TOKEN = "gateway-token-claude-0123456789";
const CODEX_TOKEN = "gateway-token-codex-0123456789";
const KEY_A = "sk-real-key-alpha-SECRET";
const KEY_B = "sk-real-key-beta-SECRET";
const KEY_C = "sk-real-key-gamma-SECRET";

interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

interface FakeUpstream {
  url: string;
  requests: RecordedRequest[];
  // 每个请求怎么回；默认 200 和一份只说了「ok」的整份 Anthropic 回复。
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
      res.end(
        JSON.stringify({
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
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

function catalogOf(facts: Record<string, Record<string, unknown>>) {
  const models = Object.entries(facts).map(([id, modelFacts]) => ({ id, facts: modelFacts }));
  return { fetchedAt: "2026-10-15T00:00:00.000Z", models };
}

/**
 * 两家接口：A 有 Anthropic 与 Responses 地址，B 只有 Anthropic 地址；两个 Agent 都开着。
 * 给了 chatUpstream 时再加第三家 C：只有 OpenAI Chat 地址，选了 deepseek-v3 与 qwen3-coder。
 * 给了 responsesUpstream 时再加 D：只有 OpenAI Responses 地址，选了 grok-4。
 */
async function start(
  options: {
    upstreamA?: FakeUpstream;
    upstreamB?: FakeUpstream;
    chatUpstream?: FakeUpstream;
    responsesUpstream?: FakeUpstream;
    password?: string;
    headerTimeoutMs?: number;
    retryPauseMs?: number;
    keepAliveMs?: number;
    keepAliveQuietMs?: number;
    // 写进 models-dev.json 的模型资料（按模型名），不联网。
    modelsDev?: Record<string, Record<string, unknown>>;
    // B 的上游清单（catalog）里给的模型资料（按模型名）。
    catalogB?: Record<string, Record<string, unknown>>;
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
        {
          ...storedEndpoint({
            id: "ep_b",
            slug: "relay-b",
            name: "Relay B",
            baseUrls: [{ format: "anthropic_messages", url: urlB }],
            models: ["kimi-k2", "glm-4.6"],
          }),
          ...(options.catalogB ? { catalog: catalogOf(options.catalogB) } : {}),
        },
        ...(options.chatUpstream
          ? [
              storedEndpoint({
                id: "ep_c",
                slug: "relay-c",
                name: "Relay C",
                baseUrls: [{ format: "openai_chat", url: `${options.chatUpstream.url}/v1` }],
                models: ["deepseek-v3", "qwen3-coder"],
              }),
            ]
          : []),
        ...(options.responsesUpstream
          ? [
              storedEndpoint({
                id: "ep_d",
                slug: "relay-d",
                name: "Relay D",
                baseUrls: [
                  { format: "openai_responses", url: `${options.responsesUpstream.url}/v1` },
                ],
                models: ["grok-4"],
              }),
            ]
          : []),
      ],
      agents: {
        claude: { enabled: true, defaultModelId: "kimi-k2" },
        codex: { enabled: true, defaultModelId: "gpt-5.5" },
      },
    },
    "keys.json": { keys: { ep_a: KEY_A, ep_b: KEY_B, ep_c: KEY_C, ep_d: KEY_C } },
    "gateway-tokens.json": { tokens: { claude: CLAUDE_TOKEN, codex: CODEX_TOKEN } },
  };
  for (const [name, value] of Object.entries(files)) {
    await writeFile(path.join(endpointsDir, name), JSON.stringify(value, null, 2));
  }
  if (options.modelsDev) {
    const cache = { fetchedAt: "2026-10-15T00:00:00.000Z", etag: null, models: options.modelsDev };
    await writeFile(path.join(endpointsDir, "models-dev.json"), JSON.stringify(cache));
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
        ...(options.keepAliveMs ? { gatewayKeepAliveMs: options.keepAliveMs } : {}),
        ...(options.keepAliveQuietMs ? { gatewayKeepAliveQuietMs: options.keepAliveQuietMs } : {}),
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
    // 带上思考设置：发给非 Claude 模型时请求体就不用改，到达上游的与发出的逐字节一样。
    const body = JSON.stringify({
      model: "kimi-k2",
      max_tokens: 10,
      thinking: { type: "enabled", budget_tokens: 1024 },
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

/** 一份只说了「ok」的整份 Responses 回复。 */
const RESPONSES_WHOLE = {
  object: "response",
  status: "completed",
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "ok" }],
    },
  ],
  usage: { input_tokens: 1, output_tokens: 1 },
};

function answerResponsesWhole(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(RESPONSES_WHOLE));
}

const OPENING_DELTA =
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n';

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
      res.write(OPENING_DELTA);
      void restReleased.then(() => {
        res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
        return undefined;
      });
    };
    const { gateway } = await start({ upstreamA: upstream });
    // 空格、键序与 cache_control 都要原样到达上游；带上思考设置，非 Claude 模型也不用改。
    const body = `{"model":  "relay-a/kimi-k2", "stream": true,"max_tokens":32,
      "thinking":{"type":"enabled","budget_tokens":1024},
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
    // 开口前扣下的 message_start 在第一段内容到达时一起发出。
    expect(first).toBe(`event: message_start\ndata: {"type":"message_start"}\n\n${OPENING_DELTA}`);
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
    const reply = { ...RESPONSES_WHOLE, id: "resp_1", model: "gpt-5.5" };
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

  test("a Codex request with a call left unanswered reaches the Responses address mended", async () => {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => answerResponsesWhole(res);
    const { gateway } = await start({ upstreamA: upstream });
    const input = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "run it" }] },
      { type: "function_call", call_id: "call_lone", name: "shell", arguments: "{}" },
      { type: "message", role: "user", content: [{ type: "input_text", text: "go on" }] },
    ];

    const response = await fetch(`${gateway}/v1/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${CODEX_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.5", input }),
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(upstream.requests[0]!.body.toString())).toEqual({
      model: "gpt-5.5",
      input: [
        input[0],
        input[1],
        {
          type: "function_call_output",
          call_id: "call_lone",
          output: "[The result of this tool call is unavailable: the turn was interrupted.]",
        },
        input[2],
      ],
    });
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
    // 映射到的不是 Claude：请求没提思考，告诉它思考关着。
    expect(JSON.parse(upstreamB.requests[0]!.body.toString())).toEqual({
      model: "glm-4.6",
      max_tokens: 1,
      messages: [],
      thinking: { type: "disabled" },
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

  test("a model not offered names the closest ids, in OpenAI shape for Codex", async () => {
    const { gateway } = await start();

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({ model: "kimi-k3", input: "hi", stream: false }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        message: 'No enabled API endpoint offers the model "kimi-k3"; did you mean kimi-k2?',
        type: "not_found_error",
        code: null,
        param: null,
      },
    });
  });
});

// Claude Code 的一轮（magpie billing_line_test.go 的 claudeCodeTurn 加上自动模式的审查）：计费行单独一块，
// 后面是要缓存的提示词；自适应思考与力度；空格与键序都要原样到达。
const CLAUDE_CODE_TURN = (model: string) => `{"model":  "${model}","max_tokens":32000,"stream":true,
  "thinking":{"type":"adaptive"},"output_config":{"effort":"high"},
  "system":[{"type":"text","text":"x-anthropic-billing-header: cc_version=2.1.114.aff; cc_entrypoint=sdk-cli; cch=9ebf3;"},{"type":"text","text":"You are a Claude agent, built on Anthropic's Claude Agent SDK.","cache_control":{"type":"ephemeral"}}],
  "tools":[{"name":"Read","description":"read a file","input_schema":{"type":"object","properties":{"path":{"type":"string"}}}}],
  "messages":[{"role":"user","content":[{"type":"text","text":"hi","cache_control":{"type":"ephemeral"}}]}],
  "metadata":{"user_id":"u"},"safeguards":{"dangerous_tool_use":{"enabled":true}}}`;
const CLAUDE_CODE_BETAS = "claude-code-20250219,dangerous-tool-use-2026-09-03";

describe("the generic fits a pass-through request gets, by the model it goes to", () => {
  test("Claude Code's billing line and auto mode review reach a Claude model byte for byte and no other", async () => {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => streamReply(res);
    const { gateway, endpointsDir } = await start({ upstreamA: upstream });
    await selectModels(endpointsDir, { ep_a: ["kimi-k2", "claude-opus-4-8"] });
    const ask = async (model: string) => {
      const init = claudeRequest(CLAUDE_CODE_TURN(model));
      const headers = { ...(init.headers as Record<string, string>) };
      headers["anthropic-beta"] = CLAUDE_CODE_BETAS;
      const response = await fetch(`${gateway}/v1/messages?beta=true`, { ...init, headers });
      expect(response.status).toBe(200);
      await response.text();
    };

    await ask("relay-a/claude-opus-4-8");
    await ask("relay-a/kimi-k2");

    const [claude, vendor] = upstream.requests;
    expect(claude!.body.toString()).toBe(CLAUDE_CODE_TURN("claude-opus-4-8"));
    expect(claude!.headers["anthropic-beta"]).toBe(CLAUDE_CODE_BETAS);
    expect(claude!.headers["x-api-key"]).toBe(KEY_A);
    expect(vendor!.headers["anthropic-beta"]).toBe("claude-code-20250219");
    // 别家模型：没有计费行与审查字段；自适应思考与力度照原来的修补去掉。
    expect(JSON.parse(vendor!.body.toString())).toEqual({
      model: "kimi-k2",
      max_tokens: 32000,
      stream: true,
      system: [
        {
          type: "text",
          text: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [
        {
          name: "Read",
          description: "read a file",
          input_schema: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }],
        },
      ],
      metadata: { user_id: "u" },
    });
  });

  test("a Codex conversation translated once, then passed through to a Responses address, goes without the reasoning the gateway made", async () => {
    const anthropic = await startUpstream();
    anthropic.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        { type: "message_start", message: { id: "msg_1", usage: { input_tokens: 5 } } },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Hm." },
        },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hello." } },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
        { type: "message_stop" },
      ]) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
      res.end();
    };
    const responses = await startUpstream();
    responses.respond = (_request, res) => answerResponsesWhole(res);
    const { gateway } = await start({ upstreamA: responses, upstreamB: anthropic });
    const said = { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] };

    // 第一轮：B 只有 Anthropic 地址，翻译过去；回给 Codex 的推理项是中转站造的。
    const first = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({ model: "relay-b/kimi-k2", input: [said], stream: false, store: false }),
    );
    const { output } = (await first.json()) as { output: Record<string, unknown>[] };
    expect(output.map((item) => item.type)).toEqual(["reasoning", "message"]);
    // 第二轮换到 A 的 Responses 地址直通，Codex 把上一轮的输出原样带回来。
    const again = {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "again" }],
    };
    const second = {
      model: "relay-a/kimi-k2",
      input: [said, ...output, again],
      stream: false,
      store: false,
    };
    const response = await fetch(`${gateway}/v1/responses`, codexRequest(second));

    expect(response.status).toBe(200);
    expect(JSON.parse(responses.requests[0]!.body.toString())).toEqual({
      ...second,
      model: "kimi-k2",
      input: [said, output[1], again],
    });
  });
});

describe("names that differ only in how a model is written", () => {
  test("switch to each other, and each endpoint is sent the name it lists", async () => {
    const upstreamA = await startUpstream();
    const upstreamB = await startUpstream();
    upstreamA.respond = (_request, res) => failWith(res, { status: 503, message: "upstream busy" });
    upstreamB.respond = (_request, res) => streamReply(res, { text: "from B" });
    const { gateway, endpointsDir } = await start({ upstreamA, upstreamB });
    await selectModels(endpointsDir, {
      ep_a: ["claude-opus-4.6"],
      ep_b: ["anthropic/claude-opus-4-6-20260115"],
    });

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({
        model: "claude-opus-4-6",
        stream: true,
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(await response.text()).toContain("from B");
    expect(upstreamA.requests.map(receivedModel)).toEqual(["claude-opus-4.6"]);
    expect(upstreamB.requests.map(receivedModel)).toEqual(["anthropic/claude-opus-4-6-20260115"]);
  });
});

describe("Codex's auto-review and memory calls on a model no endpoint offers", () => {
  async function codexRelay() {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => answerResponsesWhole(res);
    const harness = await start({ upstreamA: upstream });
    const ask = (model: string, headers: Record<string, string> = {}) =>
      fetch(`${harness.gateway}/v1/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${CODEX_TOKEN}`,
          "content-type": "application/json",
          "thread-id": "thread-1",
          ...headers,
        },
        body: JSON.stringify({ model, input: "hi", stream: false }),
      });
    return { ...harness, upstream, ask };
  }

  test("go to the model the conversation's last turn was answered on", async () => {
    const { upstream, ask } = await codexRelay();

    expect((await ask("gpt-5.5")).status).toBe(200);
    const review = await ask("codex-auto-review");
    const guardian = await ask("gpt-5.6-terra", { "x-openai-subagent": "guardian" });
    const memory = await ask("gpt-5.6-luna", { "x-openai-subagent": "memory_consolidation" });

    expect([review.status, guardian.status, memory.status]).toEqual([200, 200, 200]);
    expect(upstream.requests.map(receivedModel)).toEqual([
      "gpt-5.5",
      "gpt-5.5",
      "gpt-5.5",
      "gpt-5.5",
    ]);
  });

  test("with no turn before them they are a model not found, as is any other call", async () => {
    const { upstream, ask } = await codexRelay();

    expect((await ask("codex-auto-review")).status).toBe(404);
    expect((await ask("gpt-5.6-terra", { "x-openai-subagent": "guardian" })).status).toBe(404);
    expect((await ask("gpt-5.5")).status).toBe(200);
    // 不是记忆整理或 auto-review 的请求照常找不到。
    expect((await ask("gpt-5.6-terra")).status).toBe(404);
    expect((await ask("gpt-5.6-terra", { "x-openai-subagent": "review" })).status).toBe(404);
    expect(upstream.requests.map(receivedModel)).toEqual(["gpt-5.5"]);
  });
});

/** 假 Chat 上游的流式回复：一段文字、一个带参数的工具调用、以工具调用结束、最后报用量。 */
function chatStream(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const chunk of [
    {
      id: "chatcmpl-42",
      model: "deepseek-v3-0324",
      choices: [{ index: 0, delta: { role: "assistant", content: "Let me " } }],
    },
    { id: "chatcmpl-42", choices: [{ index: 0, delta: { content: "look." } }] },
    {
      id: "chatcmpl-42",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_ls",
                type: "function",
                function: { name: "Bash", arguments: "" },
              },
            ],
          },
        },
      ],
    },
    {
      id: "chatcmpl-42",
      choices: [
        { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"command":' } }] } },
      ],
    },
    {
      id: "chatcmpl-42",
      choices: [
        { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }] } },
      ],
    },
    { id: "chatcmpl-42", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    {
      id: "chatcmpl-42",
      choices: [],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 100 },
      },
    },
  ]) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.end("data: [DONE]\n\n");
}

/** Claude Code 一轮对话的请求：系统提示、多轮、工具定义与调用、工具结果、tool_choice。 */
function claudeConversation(stream: boolean) {
  return {
    model: "deepseek-v3",
    max_tokens: 2048,
    stream,
    system: [{ type: "text", text: "You are Claude Code.", cache_control: { type: "ephemeral" } }],
    messages: [
      { role: "user", content: "list files" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "pwd" } }],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "/repo" },
          { type: "text", text: "now list them" },
        ],
      },
    ],
    tools: [
      {
        name: "Bash",
        description: "Run a command",
        input_schema: { type: "object", properties: { command: { type: "string" } } },
      },
    ],
    tool_choice: { type: "auto" },
  };
}

/** SSE 原文里每个事件的 data。 */
function sseData(text: string): unknown[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as unknown);
}

describe("translating requests for an endpoint that speaks another format", () => {
  test("a Claude Code request reaches a Chat-only endpoint translated and the stream comes back as Anthropic events", async () => {
    const chat = await startUpstream();
    chat.respond = (_request, res) => chatStream(res);
    const { gateway } = await start({ chatUpstream: chat });

    const response = await fetch(
      `${gateway}/v1/messages?beta=true`,
      claudeRequest(claudeConversation(true)),
    );
    const text = await response.text();

    const received = chat.requests[0]!;
    expect(received.url).toBe("/v1/chat/completions");
    expect(received.headers.authorization).toBe(`Bearer ${KEY_C}`);
    expect(received.headers["x-api-key"]).toBeUndefined();
    expect(JSON.parse(received.body.toString())).toEqual({
      model: "deepseek-v3",
      messages: [
        { role: "system", content: "You are Claude Code." },
        { role: "user", content: "list files" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "toolu_1",
              type: "function",
              function: { name: "Bash", arguments: '{"command":"pwd"}' },
            },
          ],
          // DeepSeek 要每个工具轮都带推理，没有的给一个空格。
          reasoning_content: " ",
        },
        { role: "tool", tool_call_id: "toolu_1", content: "/repo" },
        { role: "user", content: "now list them" },
      ],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 2048,
      tools: [
        {
          type: "function",
          function: {
            name: "Bash",
            description: "Run a command",
            parameters: { type: "object", properties: { command: { type: "string" } } },
          },
        },
      ],
      tool_choice: "auto",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-c");
    expect(text).toContain("event: message_start\ndata: ");
    expect(sseData(text)).toEqual([
      {
        type: "message_start",
        message: {
          id: "msg_42",
          type: "message",
          role: "assistant",
          model: "deepseek-v3",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me " } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "look." } },
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "call_ls", name: "Bash", input: {} },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"command":' },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '"ls"}' },
      },
      { type: "content_block_stop", index: 1 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: {
          input_tokens: 20,
          output_tokens: 30,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 0,
        },
      },
      { type: "message_stop" },
    ]);
  });

  test("a request that did not ask to stream is still streamed upstream and comes back whole", async () => {
    const chat = await startUpstream();
    chat.respond = (_request, res) => chatStream(res);
    const { gateway } = await start({ chatUpstream: chat });

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({ ...claudeConversation(false), model: "relay-c/deepseek-v3" }),
    );

    // 和流式请求翻出来的一样：Agent 没要流式，上游照样流式请求。
    expect(chat.requests[0]!.body.toString()).toBe(
      JSON.stringify({
        model: "deepseek-v3",
        messages: [
          { role: "system", content: "You are Claude Code." },
          { role: "user", content: "list files" },
          {
            role: "assistant",
            tool_calls: [
              {
                id: "toolu_1",
                type: "function",
                function: { name: "Bash", arguments: '{"command":"pwd"}' },
              },
            ],
            reasoning_content: " ",
          },
          { role: "tool", tool_call_id: "toolu_1", content: "/repo" },
          { role: "user", content: "now list them" },
        ],
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 2048,
        tools: [
          {
            type: "function",
            function: {
              name: "Bash",
              description: "Run a command",
              parameters: { type: "object", properties: { command: { type: "string" } } },
            },
          },
        ],
        tool_choice: "auto",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-c");
    expect(await response.json()).toEqual({
      id: "msg_42",
      type: "message",
      role: "assistant",
      model: "relay-c/deepseek-v3",
      content: [
        { type: "text", text: "Let me look." },
        { type: "tool_use", id: "call_ls", name: "Bash", input: { command: "ls" } },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: {
        input_tokens: 20,
        output_tokens: 30,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 0,
      },
    });
  });

  test("a Chat endpoint's error before the reply comes back under its name in Anthropic shape", async () => {
    const chat = await startUpstream();
    chat.respond = (_request, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "messages: tool_call_id is not found" } }));
    };
    const { gateway } = await start({ chatUpstream: chat });

    const response = await fetch(`${gateway}/v1/messages`, claudeRequest(claudeConversation(true)));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Relay C: messages: tool_call_id is not found",
      },
    });
  });

  test("count_tokens is passed to an Anthropic address and estimated locally for any other", async () => {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"input_tokens":4242}');
    };
    const chat = await startUpstream();
    const { gateway } = await start({ upstreamA: upstream, chatUpstream: chat });
    const counted = (model: string) =>
      fetch(
        `${gateway}/v1/messages/count_tokens?beta=true`,
        claudeRequest({
          model,
          system: "1234",
          messages: [{ role: "user", content: "12345678" }],
          tools: [{ name: "Bash", description: "", input_schema: {} }],
        }),
      );

    const passed = await counted("kimi-k2");
    const estimated = await counted("deepseek-v3");

    expect(passed.status).toBe(200);
    expect(passed.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(await passed.json()).toEqual({ input_tokens: 4242 });
    expect(upstream.requests[0]?.url).toBe("/v1/messages/count_tokens?beta=true");
    expect(JSON.parse(upstream.requests[0]!.body.toString())).toEqual({
      model: "kimi-k2",
      system: "1234",
      messages: [{ role: "user", content: "12345678" }],
      tools: [{ name: "Bash", description: "", input_schema: {} }],
    });
    expect(estimated.status).toBe(200);
    expect(estimated.headers.get("x-osuna-api-endpoint")).toBe("relay-c");
    // 「1234」「12345678」「Bash」「{}」共 18 字节，/ 4 取整。
    expect(await estimated.json()).toEqual({ input_tokens: 4 });
    expect(chat.requests).toHaveLength(0);
  });
});

describe("thinking between Claude Code and an endpoint", () => {
  test("a Chat endpoint's reasoning, as a field or a leading <think> block, reaches Claude Code as thinking as it streams", async () => {
    const chat = await startUpstream();
    chat.respond = (request, res) => {
      const tagged = JSON.parse(request.body.toString()).model === "qwen3-coder";
      res.writeHead(200, { "content-type": "text/event-stream" });
      const deltas = tagged
        ? [{ content: "<think>Look " }, { content: "first.</think>\n\nDone." }]
        : [{ reasoning_content: "Look " }, { reasoning_content: "first." }, { content: "Done." }];
      for (const delta of deltas) {
        res.write(`data: ${JSON.stringify({ id: "c1", choices: [{ index: 0, delta }] })}\n\n`);
      }
      res.end(
        `data: ${JSON.stringify({ id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    };
    const { gateway } = await start({ chatUpstream: chat });
    const ask = async (model: string) => {
      const response = await fetch(
        `${gateway}/v1/messages`,
        claudeRequest({
          model,
          max_tokens: 1024,
          stream: true,
          thinking: { type: "enabled", budget_tokens: 1024 },
          messages: [{ role: "user", content: "go" }],
        }),
      );
      return sseData(await response.text()).filter((event) =>
        String((event as { type: string }).type).startsWith("content_block_"),
      );
    };

    for (const model of ["deepseek-v3", "qwen3-coder"]) {
      const blocks = await ask(model);
      expect(
        blocks.filter((event) => (event as { type: string }).type === "content_block_start"),
      ).toEqual([
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        },
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      ]);
      const said = (kind: string) =>
        blocks
          .map((event) => (event as { delta?: Record<string, string> }).delta)
          .filter((delta) => delta?.type === kind)
          .map((delta) => delta![kind === "thinking_delta" ? "thinking" : "text"])
          .join("");
      expect(said("thinking_delta")).toBe("Look first.");
      expect(said("text_delta")).toBe("Done.");
    }
  });

  test("Claude's signed thinking from earlier turns is left out for a Chat endpoint and passed through to an Anthropic one", async () => {
    const upstream = await startUpstream();
    const chat = await startUpstream();
    chat.respond = (_request, res) => chatStream(res);
    const { gateway } = await start({ upstreamA: upstream, chatUpstream: chat });
    const conversation = (model: string) => ({
      model,
      max_tokens: 2048,
      thinking: { type: "enabled", budget_tokens: 1024 },
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "A greeting.", signature: "EqQBCkgIBxAB" },
            { type: "text", text: "Hello" },
          ],
        },
        { role: "user", content: "again" },
      ],
    });

    await (
      await fetch(`${gateway}/v1/messages`, claudeRequest(conversation("qwen3-coder")))
    ).text();
    await (await fetch(`${gateway}/v1/messages`, claudeRequest(conversation("kimi-k2")))).text();

    const toChat = JSON.parse(chat.requests[0]!.body.toString()) as { messages: unknown[] };
    expect(toChat.messages[1]).toEqual({ role: "assistant", content: "Hello" });
    expect(JSON.parse(upstream.requests[0]!.body.toString()).messages[1]).toEqual(
      conversation("kimi-k2").messages[1],
    );
  });
});

function codexRequest(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { authorization: `Bearer ${CODEX_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Codex 一轮对话的请求：指令、多轮、工具定义与调用、工具结果、tool_choice。 */
function codexConversation(model: string, stream: boolean) {
  return {
    model,
    instructions: "You are Codex.",
    stream,
    store: false,
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "list files" }] },
      {
        type: "function_call",
        call_id: "call_1",
        name: "exec_command",
        arguments: '{"cmd":"pwd"}',
      },
      { type: "function_call_output", call_id: "call_1", output: "/repo" },
      { type: "message", role: "user", content: [{ type: "input_text", text: "now list them" }] },
    ],
    tools: [
      {
        type: "function",
        name: "exec_command",
        description: "Run a command",
        strict: false,
        parameters: { type: "object", properties: { cmd: { type: "string" } } },
      },
    ],
    tool_choice: "auto",
  };
}

function anthropicStream(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of [
    {
      type: "message_start",
      message: {
        id: "msg_7",
        type: "message",
        role: "assistant",
        model: "glm-4.6-0915",
        content: [],
        usage: { input_tokens: 20, output_tokens: 0, cache_read_input_tokens: 100 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me look." } },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "toolu_ls", name: "exec_command", input: {} },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"cmd":"ls"}' },
    },
    { type: "content_block_stop", index: 1 },
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
      usage: { output_tokens: 30 },
    },
    { type: "message_stop" },
  ]) {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

function responsesStream(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of [
    {
      type: "response.created",
      response: { id: "resp_9", model: "grok-4-0709", status: "in_progress" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { id: "msg_1", type: "message", role: "assistant", content: [] },
    },
    { type: "response.output_text.delta", item_id: "msg_1", delta: "Let me look." },
    {
      type: "response.output_item.added",
      output_index: 1,
      item: { id: "fc_1", type: "function_call", call_id: "call_ls", name: "Bash", arguments: "" },
    },
    { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"command":' },
    {
      type: "response.function_call_arguments.done",
      item_id: "fc_1",
      arguments: '{"command":"ls"}',
    },
    {
      type: "response.output_item.done",
      output_index: 1,
      item: {
        id: "fc_1",
        type: "function_call",
        call_id: "call_ls",
        name: "Bash",
        arguments: '{"command":"ls"}',
      },
    },
    {
      type: "response.completed",
      response: {
        id: "resp_9",
        status: "completed",
        output: [],
        usage: {
          input_tokens: 120,
          output_tokens: 30,
          input_tokens_details: { cached_tokens: 100 },
        },
      },
    },
  ]) {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

/** Codex 流里的 response.completed 带的整份回复。 */
function completedResponse(text: string): Record<string, unknown> {
  const events = sseData(text) as Record<string, unknown>[];
  return events.find((event) => event.type === "response.completed")!.response as Record<
    string,
    unknown
  >;
}

const CODEX_ANSWER = [
  {
    id: expect.stringMatching(/^msg_/),
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "Let me look.", annotations: [], logprobs: [] }],
    // 调用之前说的是过程话（工单 07，magpie phase.go）。
    phase: "commentary",
  },
];

describe("translating for Codex, and to an endpoint that speaks only Responses", () => {
  test("a Codex request reaches an Anthropic-only endpoint translated and the stream comes back as Responses events", async () => {
    const anthropic = await startUpstream();
    anthropic.respond = (_request, res) => anthropicStream(res);
    const { gateway } = await start({ upstreamB: anthropic });

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest(codexConversation("glm-4.6", true)),
    );
    const text = await response.text();

    const received = anthropic.requests[0]!;
    expect(received.url).toBe("/v1/messages");
    expect(received.headers["x-api-key"]).toBe(KEY_B);
    expect(JSON.parse(received.body.toString())).toEqual({
      model: "glm-4.6",
      stream: true,
      max_tokens: 16384,
      system: [{ type: "text", text: "You are Codex.", cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: [{ type: "text", text: "list files" }] },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call_1", name: "exec_command", input: { cmd: "pwd" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_1", content: "/repo" },
            { type: "text", text: "now list them", cache_control: { type: "ephemeral" } },
          ],
        },
      ],
      tools: [
        {
          name: "exec_command",
          description: "Run a command",
          input_schema: { type: "object", properties: { cmd: { type: "string" } } },
        },
      ],
      // auto 是 Anthropic 的默认，不写。
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(text).toContain("event: response.created\ndata: ");
    expect(completedResponse(text)).toMatchObject({
      id: "resp_msg_7",
      status: "completed",
      model: "glm-4.6",
      output: [
        ...CODEX_ANSWER,
        {
          id: expect.stringMatching(/^fc_/),
          type: "function_call",
          status: "completed",
          call_id: "toolu_ls",
          name: "exec_command",
          arguments: '{"cmd":"ls"}',
        },
      ],
      usage: {
        input_tokens: 120,
        output_tokens: 30,
        total_tokens: 150,
        input_tokens_details: { cached_tokens: 100, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    });
  });

  test("a Codex request reaches a Chat-only endpoint translated; streamed and whole replies come back in Responses shape", async () => {
    const chat = await startUpstream();
    chat.respond = (_request, res) => chatStream(res);
    const { gateway } = await start({ chatUpstream: chat });

    const streamed = await fetch(
      `${gateway}/v1/responses`,
      codexRequest(codexConversation("qwen3-coder", true)),
    );
    const text = await streamed.text();
    const whole = await fetch(
      `${gateway}/v1/responses`,
      codexRequest(codexConversation("qwen3-coder", false)),
    );

    const received = chat.requests[0]!;
    expect(received.url).toBe("/v1/chat/completions");
    expect(received.headers.authorization).toBe(`Bearer ${KEY_C}`);
    expect(JSON.parse(received.body.toString())).toEqual({
      model: "qwen3-coder",
      messages: [
        { role: "system", content: "You are Codex." },
        { role: "user", content: "list files" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "exec_command", arguments: '{"cmd":"pwd"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "/repo" },
        { role: "user", content: "now list them" },
      ],
      stream: true,
      stream_options: { include_usage: true },
      tools: [
        {
          type: "function",
          function: {
            name: "exec_command",
            description: "Run a command",
            parameters: { type: "object", properties: { cmd: { type: "string" } } },
          },
        },
      ],
      tool_choice: "auto",
    });
    // 没要流式的也照样流式问上游。
    expect(chat.requests[1]!.body.toString()).toBe(received.body.toString());
    const call = {
      id: expect.stringMatching(/^fc_/),
      type: "function_call",
      status: "completed",
      call_id: "call_ls",
      name: "Bash",
      arguments: '{"command":"ls"}',
    };
    const answer = {
      status: "completed",
      model: "qwen3-coder",
      usage: { input_tokens: 120, output_tokens: 30, input_tokens_details: { cached_tokens: 100 } },
    };
    expect(streamed.status).toBe(200);
    const completed = completedResponse(text);
    expect(completed).toMatchObject({ id: "resp_chatcmpl-42", ...answer });
    expect(completed.output).toEqual([...CODEX_ANSWER, call]);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("x-osuna-api-endpoint")).toBe("relay-c");
    const body = (await whole.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ object: "response", ...answer });
    // 整份回复里的文字没有 logprobs。
    expect(body.output).toEqual([
      {
        ...CODEX_ANSWER[0],
        content: [{ type: "output_text", text: "Let me look.", annotations: [] }],
      },
      call,
    ]);
  });

  test("Codex's cache key reaches a Chat endpoint, and each model's facts set its effort, reply limit and sampling (ticket 07)", async () => {
    const chat = await startUpstream();
    chat.respond = (_request, res) => chatStream(res);
    const anthropic = await startUpstream();
    anthropic.respond = (_request, res) => anthropicStream(res);
    const { gateway } = await start({
      chatUpstream: chat,
      upstreamB: anthropic,
      modelsDev: {
        "qwen3-coder": { efforts: ["low", "high", "max"], takesSampling: false },
        "glm-4.6": { context: 200_000, output: 131_072, efforts: ["low", "medium", "high"] },
      },
      // 这家自己的清单给的回复上限在 models.dev 的前面。
      catalogB: { "glm-4.6": { output: 98_304 } },
    });
    const codexFields = {
      prompt_cache_key: "thread-1",
      include: ["reasoning.encrypted_content"],
      client_metadata: { "x-codex-installation-id": "inst-1" },
      text: { verbosity: "low" },
      reasoning: { effort: "xhigh", summary: "auto" },
      temperature: 0.3,
    };
    const ask = (model: string) =>
      fetch(
        `${gateway}/v1/responses`,
        codexRequest({ ...codexConversation(model, true), ...codexFields }),
      ).then((response) => response.text());

    await ask("qwen3-coder");
    await ask("glm-4.6");

    const messages = {
      chat: [
        { role: "system", content: "You are Codex." },
        { role: "user", content: "list files" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "exec_command", arguments: '{"cmd":"pwd"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "/repo" },
        { role: "user", content: "now list them" },
      ],
    };
    // Chat 上游照 magpie 只收 prompt_cache_key；xhigh 是 qwen3-coder 没有的档，取最近、一样近取高的 max；它不收采样参数。
    expect(JSON.parse(chat.requests[0]!.body.toString())).toEqual({
      model: "qwen3-coder",
      messages: messages.chat,
      stream: true,
      prompt_cache_key: "thread-1",
      stream_options: { include_usage: true },
      reasoning_effort: "max",
      tools: [
        {
          type: "function",
          function: {
            name: "exec_command",
            description: "Run a command",
            parameters: { type: "object", properties: { cmd: { type: "string" } } },
          },
        },
      ],
      tool_choice: "auto",
    });
    // Anthropic 上游照 magpie 不收那四项；没给回复上限，按这家清单公布的填；思考预算放在它下面。
    expect(JSON.parse(anthropic.requests[0]!.body.toString())).toEqual({
      model: "glm-4.6",
      stream: true,
      max_tokens: 98_304,
      thinking: { type: "enabled", budget_tokens: 24_000 },
      system: [{ type: "text", text: "You are Codex.", cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: [{ type: "text", text: "list files" }] },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call_1", name: "exec_command", input: { cmd: "pwd" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_1", content: "/repo" },
            { type: "text", text: "now list them", cache_control: { type: "ephemeral" } },
          ],
        },
      ],
      tools: [
        {
          name: "exec_command",
          description: "Run a command",
          input_schema: { type: "object", properties: { cmd: { type: "string" } } },
        },
      ],
    });
  });

  test("a Claude Code request reaches a Responses-only endpoint translated and the stream comes back as Anthropic events", async () => {
    const responses = await startUpstream();
    responses.respond = (_request, res) => responsesStream(res);
    const { gateway } = await start({ responsesUpstream: responses });

    const response = await fetch(
      `${gateway}/v1/messages?beta=true`,
      claudeRequest({ ...claudeConversation(true), model: "grok-4" }),
    );
    const text = await response.text();

    const received = responses.requests[0]!;
    expect(received.url).toBe("/v1/responses");
    expect(received.headers.authorization).toBe(`Bearer ${KEY_C}`);
    expect(received.headers["x-api-key"]).toBeUndefined();
    expect(JSON.parse(received.body.toString())).toEqual({
      model: "grok-4",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "list files" }] },
        { type: "function_call", call_id: "toolu_1", name: "Bash", arguments: '{"command":"pwd"}' },
        { type: "function_call_output", call_id: "toolu_1", output: "/repo" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "now list them" }] },
      ],
      stream: true,
      store: false,
      instructions: "You are Claude Code.",
      max_output_tokens: 2048,
      tools: [
        {
          type: "function",
          name: "Bash",
          description: "Run a command",
          strict: false,
          parameters: { type: "object", properties: { command: { type: "string" } } },
        },
      ],
      tool_choice: "auto",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-d");
    expect(sseData(text)).toEqual([
      {
        type: "message_start",
        message: {
          id: "msg_resp_9",
          type: "message",
          role: "assistant",
          model: "grok-4",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Let me look." },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "call_ls", name: "Bash", input: {} },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' },
      },
      { type: "content_block_stop", index: 1 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: {
          input_tokens: 20,
          output_tokens: 30,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 0,
        },
      },
      { type: "message_stop" },
    ]);
  });

  test("an image given only as a file_id cannot be translated: a 400 in OpenAI shape, no endpoint asked", async () => {
    const anthropic = await startUpstream();
    const { gateway } = await start({ upstreamB: anthropic });

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({
        model: "glm-4.6",
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "what is this" },
              { type: "input_image", file_id: "file-abc" },
            ],
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    expect(anthropic.requests).toHaveLength(0);
    expect(await response.json()).toEqual({
      error: {
        message:
          "The latest message has an image given only as an OpenAI file_id, which this API endpoint cannot open; send the image itself",
        type: "invalid_request_error",
        code: null,
        param: null,
      },
    });
  });
});

/** 换掉几家接口的已选模型；中转站每次请求都重读 endpoints.json。 */
async function selectModels(endpointsDir: string, models: Record<string, string[]>) {
  const endpointsPath = path.join(endpointsDir, "endpoints.json");
  const file = JSON.parse(await readFile(endpointsPath, "utf8")) as {
    endpoints: { id: string; models: { id: string }[] }[];
  };
  for (const endpoint of file.endpoints) {
    const selected = models[endpoint.id];
    if (selected) endpoint.models = selected.map((id) => ({ id }));
  }
  await writeFile(endpointsPath, JSON.stringify(file));
}

function receivedBody(request: RecordedRequest | undefined): Record<string, unknown> {
  return JSON.parse(request?.body.toString() ?? "{}") as Record<string, unknown>;
}

const NONE_REFUSED = `{"type":"error","error":{"type":"invalid_request_error","message":"gpt-6.1-sol does not support reasoning effort \\"none\\"; use low, medium, high, xhigh or max"}}`;
const ALWAYS_THINKS = `{"type":"error","error":{"type":"1210","message":"GLM-5.3 always engages in thinking; use low, high, or max"}}`;

function refuse(res: ServerResponse, body: string) {
  res.writeHead(400, { "content-type": "application/json" });
  res.end(body);
}

describe("reasoning turned off, sent the way each model takes it", () => {
  test("a Responses endpoint refusing effort none is asked again at low, and from then on", async () => {
    const upstream = await startUpstream();
    upstream.respond = (request, res) => {
      const body = receivedBody(request);
      const effort = (body.reasoning as { effort?: string } | undefined)?.effort;
      if (body.model === "gpt-6.1-sol" && effort === "none") refuse(res, NONE_REFUSED);
      else answerResponsesWhole(res);
    };
    const { gateway, endpointsDir } = await start({ upstreamA: upstream });
    await selectModels(endpointsDir, { ep_a: ["gpt-6.1-sol", "gpt-5.5"] });
    const ask = (model: string) =>
      fetch(
        `${gateway}/v1/responses`,
        codexRequest({ model, input: "hi", stream: false, reasoning: { effort: "none" } }),
      );
    const efforts = () =>
      upstream.requests.splice(0).map((request) => {
        const body = receivedBody(request);
        return `${String(body.model)} ${(body.reasoning as { effort: string }).effort}`;
      });

    expect((await ask("gpt-6.1-sol")).status).toBe(200);
    expect(efforts()).toEqual(["gpt-6.1-sol none", "gpt-6.1-sol low"]);
    expect((await ask("gpt-6.1-sol")).status).toBe(200);
    expect(efforts()).toEqual(["gpt-6.1-sol low"]);
    expect((await ask("gpt-5.5")).status).toBe(200);
    expect(efforts()).toEqual(["gpt-5.5 none"]);
  });

  test("a Chat endpoint refusing a translated effort none is asked again at low, and from then on", async () => {
    const chat = await startUpstream();
    chat.respond = (request, res) => {
      const body = receivedBody(request);
      if (body.model === "gpt-6.1-sol" && body.reasoning_effort === "none") {
        refuse(res, NONE_REFUSED);
      } else {
        chatStream(res);
      }
    };
    const { gateway, endpointsDir } = await start({ chatUpstream: chat });
    await selectModels(endpointsDir, { ep_c: ["gpt-6.1-sol", "qwen3-coder"] });
    const ask = (model: string) =>
      fetch(
        `${gateway}/v1/responses`,
        codexRequest({ model, input: "hi", stream: false, reasoning: { effort: "none" } }),
      );
    const efforts = () =>
      chat.requests.splice(0).map((request) => {
        const body = receivedBody(request);
        return `${String(body.model)} ${String(body.reasoning_effort)}`;
      });

    const first = await ask("gpt-6.1-sol");
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "completed" });
    expect(efforts()).toEqual(["gpt-6.1-sol none", "gpt-6.1-sol low"]);
    expect((await ask("gpt-6.1-sol")).status).toBe(200);
    expect(efforts()).toEqual(["gpt-6.1-sol low"]);
    expect((await ask("qwen3-coder")).status).toBe(200);
    expect(efforts()).toEqual(["qwen3-coder none"]);
  });

  test("Claude Code and Codex turning thinking off reach each Claude in the shape it takes", async () => {
    const anthropic = await startUpstream();
    anthropic.respond = (_request, res) => anthropicStream(res);
    const { gateway, endpointsDir } = await start({ upstreamB: anthropic });
    const models = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"];
    await selectModels(endpointsDir, { ep_b: models });
    const thinkingOf = (request: RecordedRequest | undefined) => {
      const body = receivedBody(request);
      return {
        thinking: body.thinking,
        effort: (body.output_config as { effort?: string })?.effort,
      };
    };
    const expected = [
      { thinking: { type: "between_tools" }, effort: undefined },
      { thinking: undefined, effort: "low" },
      { thinking: { type: "disabled" }, effort: undefined },
      { thinking: { type: "disabled" }, effort: undefined },
    ];

    for (const model of models) {
      const response = await fetch(
        `${gateway}/v1/messages`,
        claudeRequest({
          model,
          max_tokens: 64,
          thinking: { type: "disabled" },
          messages: [{ role: "user", content: "Is this action safe?" }],
        }),
      );
      expect(response.status).toBe(200);
      await response.text();
    }
    expect(anthropic.requests.splice(0).map(thinkingOf)).toEqual(expected);

    for (const model of models) {
      const response = await fetch(
        `${gateway}/v1/responses`,
        codexRequest({ model, input: "hi", stream: false, reasoning: { effort: "none" } }),
      );
      expect(response.status).toBe(200);
      await response.text();
    }
    expect(anthropic.requests.splice(0).map(thinkingOf)).toEqual(expected);
  });

  test("a translated request a model that always thinks refuses is asked again thinking at its least", async () => {
    const anthropic = await startUpstream();
    anthropic.respond = (request, res) => {
      const thinking = receivedBody(request).thinking as { type?: string } | undefined;
      if (thinking?.type === "disabled") refuse(res, ALWAYS_THINKS);
      else anthropicStream(res);
    };
    const { gateway } = await start({ upstreamB: anthropic });
    const ask = () =>
      fetch(
        `${gateway}/v1/responses`,
        codexRequest({
          model: "glm-4.6",
          input: "hi",
          stream: false,
          reasoning: { effort: "none" },
        }),
      );

    expect((await ask()).status).toBe(200);
    expect(anthropic.requests.splice(0).map((request) => receivedBody(request).thinking)).toEqual([
      { type: "disabled" },
      { type: "enabled", budget_tokens: 4096 },
    ]);
    expect((await ask()).status).toBe(200);
    expect(anthropic.requests.splice(0).map((request) => receivedBody(request).thinking)).toEqual([
      { type: "enabled", budget_tokens: 4096 },
    ]);
  });

  test("a model that always thinks is asked again with its thinking left on, and from then on", async () => {
    const anthropic = await startUpstream();
    anthropic.respond = (request, res) => {
      const thinking = receivedBody(request).thinking as { type?: string } | undefined;
      if (thinking?.type === "disabled") refuse(res, ALWAYS_THINKS);
      else streamReply(res);
    };
    const { gateway } = await start({ upstreamB: anthropic });
    // Claude Code 起标题的请求没提思考：发给别家模型时补上 disabled（R-C3），GLM 不收。
    const ask = () =>
      fetch(
        `${gateway}/v1/messages`,
        claudeRequest({
          model: "glm-4.6",
          max_tokens: 64,
          messages: [{ role: "user", content: "Title this" }],
        }),
      );

    const first = await ask();
    expect(first.status).toBe(200);
    await first.text();
    expect(anthropic.requests.splice(0).map((request) => receivedBody(request).thinking)).toEqual([
      { type: "disabled" },
      undefined,
    ]);
    const second = await ask();
    expect(second.status).toBe(200);
    await second.text();
    expect(anthropic.requests.splice(0).map((request) => receivedBody(request).thinking)).toEqual([
      undefined,
    ]);
  });
});

async function setBaseUrls(
  endpointsDir: string,
  baseUrls: Record<string, { format: string; url: string }[]>,
) {
  const endpointsPath = path.join(endpointsDir, "endpoints.json");
  const file = JSON.parse(await readFile(endpointsPath, "utf8")) as {
    endpoints: { id: string; baseUrls: unknown }[];
  };
  for (const endpoint of file.endpoints) {
    const urls = baseUrls[endpoint.id];
    if (urls) endpoint.baseUrls = urls;
  }
  await writeFile(endpointsPath, JSON.stringify(file));
}

/** 同一个上游上的 Anthropic 与 Chat 两个地址。 */
function anthropicAndChat(upstream: FakeUpstream) {
  return [
    { format: "anthropic_messages", url: upstream.url },
    { format: "openai_chat", url: `${upstream.url}/v1` },
  ];
}

// Copilot 的 /v1/messages 不提供只在 Chat 上的模型时说的话（magpie #754）。
const NO_MODEL_ENDPOINTS = "no model endpoints available given user constraints\n";
const BOTH_KEY_HEADERS_REFUSED = `{"error":{"type":"authentication_error","message":"鉴权 header， x-api-key 和 Authorization 不可以同时存在"}}`;

function gatewayLog(logLines: string[], msg: string): Record<string, unknown>[] {
  return logLines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line.msg === msg);
}

describe("a refused shape asked again another way at the same endpoint", () => {
  function claudeAsk(gateway: string, model: string) {
    return fetch(
      `${gateway}/v1/messages`,
      claudeRequest({
        model,
        stream: true,
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
      }),
    );
  }

  test("an Anthropic address without the model sends the request on to the endpoint's Chat address, and from then on", async () => {
    const upstream = await startUpstream();
    upstream.respond = (request, res) => {
      if (request.url === "/v1/messages") {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end(NO_MODEL_ENDPOINTS);
      } else {
        chatStream(res);
      }
    };
    const { gateway, endpointsDir, daemon, logLines, restart } = await start({
      upstreamB: upstream,
    });
    await setBaseUrls(endpointsDir, { ep_b: anthropicAndChat(upstream) });
    const paths = () => upstream.requests.splice(0).map((request) => request.url);

    const first = await claudeAsk(gateway, "glm-4.6");
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("Let me ");
    expect(paths()).toEqual(["/v1/messages", "/v1/chat/completions"]);
    const second = await claudeAsk(gateway, "glm-4.6");
    expect(second.status).toBe(200);
    await second.text();
    expect(paths()).toEqual(["/v1/chat/completions"]);

    expect(await cooldownOf(await connectTo(daemon), "ep_b")).toBeNull();
    expect(gatewayLog(logLines, "API endpoint gateway switched endpoints")).toEqual([]);
    expect(
      gatewayLog(
        logLines,
        "API endpoint does not serve this model in this format; asking its next format",
      ),
    ).toEqual([
      expect.objectContaining({
        level: 30,
        endpoint: "Relay B",
        model: "glm-4.6",
        refused: "format:anthropic_messages",
      }),
    ]);

    // 记住的写法只在内存里：重启后又先问 Anthropic 地址。
    const next = await restart();
    const again = await claudeAsk(next.gateway, "glm-4.6");
    expect(again.status).toBe(200);
    await again.text();
    expect(paths()).toEqual(["/v1/messages", "/v1/chat/completions"]);
  });

  test("when every address says it has no such model, only that model cools and the next endpoint answers", async () => {
    const { upstreamA, upstreamB, ask, endpointsDir, logLines } = await twoRelays();
    upstreamA.respond = (_request, res) => {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end(NO_MODEL_ENDPOINTS);
    };
    await setBaseUrls(endpointsDir, { ep_a: anthropicAndChat(upstreamA) });

    const response = await ask();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(await response.text()).toContain("from B");
    expect(upstreamB.requests).toHaveLength(1);
    expect(upstreamA.requests.map((request) => request.url)).toEqual([
      "/v1/messages",
      "/v1/chat/completions",
    ]);
    expect(gatewayLog(logLines, "API endpoint is cooling down")).toEqual([
      expect.objectContaining({ endpoint: "Relay A", model: "kimi-k2" }),
    ]);
    expect(gatewayLog(logLines, "API endpoint gateway switched endpoints")).toEqual([
      expect.objectContaining({ from: "Relay A", to: "Relay B", model: "kimi-k2" }),
    ]);
  });

  test("once every address has said so, the next ask starts again from the first address", async () => {
    const upstream = await startUpstream();
    let chatServes = false;
    upstream.respond = (request, res) => {
      if (chatServes && request.url === "/v1/chat/completions") {
        chatStream(res);
        return;
      }
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end(NO_MODEL_ENDPOINTS);
    };
    const { gateway, endpointsDir } = await start({ upstreamB: upstream });
    await setBaseUrls(endpointsDir, { ep_b: anthropicAndChat(upstream) });
    const paths = () => upstream.requests.splice(0).map((request) => request.url);

    const refused = await claudeAsk(gateway, "glm-4.6");
    expect(refused.status).toBe(400);
    await refused.text();
    expect(paths()).toEqual(["/v1/messages", "/v1/chat/completions"]);

    chatServes = true;
    const served = await claudeAsk(gateway, "glm-4.6");
    expect(served.status).toBe(200);
    expect(await served.text()).toContain("Let me ");
    expect(paths()).toEqual(["/v1/messages", "/v1/chat/completions"]);
  });

  test("an endpoint refusing both key headers together is asked with x-api-key alone, and from then on", async () => {
    const upstream = await startUpstream();
    upstream.respond = (request, res) => {
      const { authorization } = request.headers;
      if (authorization !== undefined && request.headers["x-api-key"] !== undefined) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(BOTH_KEY_HEADERS_REFUSED);
      } else {
        streamReply(res);
      }
    };
    const { gateway, daemon, logLines, restart } = await start({ upstreamB: upstream });
    const keysSent = () =>
      upstream.requests.splice(0).map((request) => ({
        authorization: request.headers.authorization,
        xApiKey: request.headers["x-api-key"],
      }));

    const first = await claudeAsk(gateway, "glm-4.6");
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("hi");
    expect(keysSent()).toEqual([
      { authorization: `Bearer ${KEY_B}`, xApiKey: KEY_B },
      { authorization: undefined, xApiKey: KEY_B },
    ]);
    const second = await claudeAsk(gateway, "glm-4.6");
    expect(second.status).toBe(200);
    await second.text();
    expect(keysSent()).toEqual([{ authorization: undefined, xApiKey: KEY_B }]);

    expect(await cooldownOf(await connectTo(daemon), "ep_b")).toBeNull();
    expect(
      gatewayLog(logLines, "API endpoint takes its key in one header only; sending it that way"),
    ).toEqual([
      expect.objectContaining({
        level: 30,
        endpoint: "Relay B",
        model: "glm-4.6",
        refused: "bothKeyHeaders",
      }),
    ]);

    // 记住的写法只在内存里：重启后又先两个头都带。
    const next = await restart();
    const again = await claudeAsk(next.gateway, "glm-4.6");
    expect(again.status).toBe(200);
    await again.text();
    expect(keysSent()).toEqual([
      { authorization: `Bearer ${KEY_B}`, xApiKey: KEY_B },
      { authorization: undefined, xApiKey: KEY_B },
    ]);
  });

  test("a translated request is asked with Bearer alone when x-api-key alone is refused too", async () => {
    const upstream = await startUpstream();
    upstream.respond = (request, res) => {
      const { authorization } = request.headers;
      const xApiKey = request.headers["x-api-key"];
      if (authorization !== undefined && xApiKey !== undefined) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(BOTH_KEY_HEADERS_REFUSED);
      } else if (authorization === undefined) {
        failWith(res, { status: 401, message: "missing bearer" });
      } else {
        anthropicStream(res);
      }
    };
    const { gateway, daemon } = await start({ upstreamB: upstream });
    const ask = () =>
      fetch(
        `${gateway}/v1/responses`,
        codexRequest({ model: "glm-4.6", input: "hi", stream: false }),
      );
    const keysSent = () =>
      upstream.requests
        .splice(0)
        .map((request) => [request.headers.authorization, request.headers["x-api-key"]]);

    expect((await ask()).status).toBe(200);
    expect(keysSent()).toEqual([
      [`Bearer ${KEY_B}`, KEY_B],
      [undefined, KEY_B],
      [`Bearer ${KEY_B}`, undefined],
    ]);
    expect((await ask()).status).toBe(200);
    expect(keysSent()).toEqual([[`Bearer ${KEY_B}`, undefined]]);
    expect(await cooldownOf(await connectTo(daemon), "ep_b")).toBeNull();
  });
});

// 上游不收请求里的字段时说的话：magpie 的 safeguards_refused_test.go、thinking_display_test.go、thinking_off_test.go、
// deferred_tools_test.go、tool_reference_result_test.go、strict_refused_test.go 与 image_tool_test.go。
const SAFEGUARDS_REFUSED = `{"error":{"message":"safeguards: Extra inputs are not permitted","type":"invalid_request_error"}}`;
const DISPLAY_REFUSED = `{"type":"error","error":{"type":"invalid_request_error","message":"thinking.enabled.display: Extra inputs are not permitted"}}`;
const ADAPTIVE_DISPLAY_REFUSED = `{"type":"error","error":{"type":"invalid_request_error","message":"thinking.adaptive.display: Extra inputs are not permitted"}}`;
const SAMPLING_REFUSED =
  '"`temperature` is deprecated for this model. (tid: 2026101003072022550024879833267)"';
const DEFERRED_REFUSED = `{"error":{"message":"Failed to deserialize the JSON body into the target type: messages[1].content: unknown variant \`tool_removal\`, expected one of \`text\`, \`image\`, \`document\`, \`thinking\`, \`server_tool_use\`, \`tool_use\`, \`tool_result\`, \`web_search_tool_result\`, \`tool_addition\` at line 1 column 233","type":"invalid_request_error","param":null,"code":"invalid_request_error"}}`;
const REFS_ONLY_REFUSED =
  "Failed to deserialize the JSON body into the target type: messages[2]: missing field `content` at line 38 column 3";
const STRICT_REFUSED = `{"error":{"message":"Unsupported Responses API field: tools[0].strict","type":"invalid_request_error"}}`;
const BARE_400 = `{"error":{"message":"bad response status code 400","type":"invalid_request_error"}}`;

// Codex 0.160.0 给的画图工具（magpie testdata/codex_image_gen_tool.json，描述从略）。
const IMAGE_TOOL = {
  type: "namespace",
  name: "image_gen",
  description: "Tools in the image_gen namespace.",
  tools: [
    {
      type: "function",
      name: "imagegen",
      description: "The `image_gen.imagegen` tool enables image generation from descriptions.",
      strict: false,
      parameters: {
        type: "object",
        properties: { prompt: { type: "string" } },
        required: ["prompt"],
        additionalProperties: false,
      },
    },
  ],
};
const EXEC_TOOL = {
  type: "function",
  name: "exec_command",
  strict: false,
  parameters: { type: "object", properties: {} },
};

// ToolSearch 答了一个延后加载的工具：工具结果里只有 tool_reference。
const TOOL_SEARCH_MESSAGES = [
  { role: "user", content: "find the docs tool" },
  {
    role: "assistant",
    content: [{ type: "tool_use", id: "toolu_1", name: "ToolSearch", input: { query: "docs" } }],
  },
  {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "toolu_1",
        content: [{ type: "tool_reference", tool_name: "mcp__docs__search" }],
      },
    ],
  },
];

interface FieldRefusal {
  field: string;
  agent: "claude" | "codex";
  // 请求里多出的这一项，上游不收。
  extra: Record<string, unknown>;
  status: number;
  refusal: string;
  // 上游收到的请求体还带着这一项。
  has: (body: Record<string, unknown>) => boolean;
  // 换掉 A、B 的已选模型（直通时）：[学会的、同一家另一个、另一家的]，前一个两家都有。
  models?: { ep_a: string[]; ep_b: string[]; asked: [string, string, string] };
}

function mentions(word: string): (body: Record<string, unknown>) => boolean {
  return (body) => JSON.stringify(body).includes(word);
}

const PASSED_THROUGH_REFUSALS: FieldRefusal[] = [
  {
    field: "safeguards",
    agent: "claude",
    extra: { safeguards: { dangerous_tool_use: { enabled: true } } },
    status: 400,
    refusal: SAFEGUARDS_REFUSED,
    has: (body) => body.safeguards !== undefined,
    // 审查字段只发给 Claude 模型（直通的通用修补）。
    models: {
      ep_a: ["claude-sonnet-4-5", "claude-opus-4-1"],
      ep_b: ["claude-sonnet-4-5", "claude-haiku-4-5"],
      asked: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
    },
  },
  {
    field: "display",
    agent: "claude",
    extra: { thinking: { type: "enabled", budget_tokens: 1024, display: "updates" } },
    status: 400,
    refusal: DISPLAY_REFUSED,
    has: mentions('"display"'),
  },
  {
    field: "sampling",
    agent: "claude",
    extra: { temperature: 0 },
    status: 400,
    refusal: SAMPLING_REFUSED,
    has: (body) => body.temperature !== undefined,
  },
  {
    field: "deferredTools",
    agent: "claude",
    extra: {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "user",
          content: [
            { type: "tool_removal", tool: { type: "tool_reference", name: "Gone" } },
            { type: "text", text: "go on" },
          ],
        },
      ],
    },
    status: 422,
    refusal: DEFERRED_REFUSED,
    has: mentions("tool_removal"),
  },
  {
    field: "toolResultRefs",
    agent: "claude",
    extra: { messages: TOOL_SEARCH_MESSAGES },
    status: 422,
    refusal: REFS_ONLY_REFUSED,
    has: (body) => !mentions("is loaded and can be called now")(body),
  },
  {
    field: "toolStrict",
    agent: "codex",
    extra: { tools: [EXEC_TOOL] },
    status: 400,
    refusal: STRICT_REFUSED,
    has: mentions('"strict"'),
  },
  {
    field: "imageTool",
    agent: "codex",
    extra: { tools: [{ ...EXEC_TOOL, strict: undefined }, IMAGE_TOOL] },
    status: 400,
    refusal: BARE_400,
    has: mentions('"image_gen"'),
  },
];

function askAgent(input: {
  gateway: string;
  agent: "claude" | "codex";
  model: string;
  extra: Record<string, unknown>;
}): Promise<Response> {
  const { gateway, model } = input;
  if (input.agent === "codex") {
    const body = { model, input: "hi", stream: false, ...input.extra };
    return fetch(`${gateway}/v1/responses`, codexRequest(body));
  }
  const messages = [{ role: "user", content: "hi" }];
  const body = { model, stream: true, max_tokens: 32, messages, ...input.extra };
  return fetch(`${gateway}/v1/messages`, claudeRequest(body));
}

/** 带着那一项就拒收、否则答一句的上游。 */
function refusing(refused: FieldRefusal, answer: (res: ServerResponse) => void) {
  return (request: RecordedRequest, res: ServerResponse) => {
    if (!refused.has(receivedBody(request))) {
      answer(res);
      return;
    }
    res.writeHead(refused.status, { "content-type": "application/json" });
    res.end(refused.refusal);
  };
}

/**
 * 直通时谁学会、谁不受影响。Claude Code：A 的 kimi-k2 学会，A 的 gpt-5.5、B 的 glm-4.6 不受影响；
 * Codex：A 的 Responses 地址上的 gpt-5.5 学会，A 的 kimi-k2、D 的 grok-4 不受影响。
 */
const PASSED_THROUGH_SETUPS = {
  claude: {
    answer: streamReply,
    start: (upstreamA: FakeUpstream, other: FakeUpstream) => start({ upstreamA, upstreamB: other }),
    models: ["kimi-k2", "gpt-5.5", "glm-4.6"],
  },
  codex: {
    answer: answerResponsesWhole,
    start: (upstreamA: FakeUpstream, other: FakeUpstream) =>
      start({ upstreamA, responsesUpstream: other }),
    models: ["gpt-5.5", "kimi-k2", "grok-4"],
  },
};

/** 翻译时 A 与另一家都只有这个格式的地址：另一家是 B（Anthropic）、D（Responses）或 C（Chat）。 */
const TRANSLATED_SETUPS = {
  anthropic: {
    answer: anthropicStream,
    options: (other: FakeUpstream) => ({ upstreamB: other }),
    otherId: "ep_b",
    address: (upstream: FakeUpstream) => ({ format: "anthropic_messages", url: upstream.url }),
  },
  responses: {
    answer: responsesStream,
    options: (other: FakeUpstream) => ({ responsesUpstream: other }),
    otherId: "ep_d",
    address: (upstream: FakeUpstream) => ({
      format: "openai_responses",
      url: `${upstream.url}/v1`,
    }),
  },
  chat: {
    answer: chatStream,
    options: (other: FakeUpstream) => ({ chatUpstream: other }),
    otherId: "ep_c",
    address: (upstream: FakeUpstream) => ({ format: "openai_chat", url: `${upstream.url}/v1` }),
  },
};

describe("a refused field left out at the same endpoint", () => {
  test.each(PASSED_THROUGH_REFUSALS)(
    "$field passed through: asked again without it, and from then on for that endpoint's model only",
    async (refused) => {
      const setup = PASSED_THROUGH_SETUPS[refused.agent];
      const upstreamA = await startUpstream();
      const other = await startUpstream();
      upstreamA.respond = refusing(refused, setup.answer);
      other.respond = refusing(refused, setup.answer);
      const harness = await setup.start(upstreamA, other);
      if (refused.models) await selectModels(harness.endpointsDir, refused.models);
      const [model, sameEndpoint, otherEndpoint] = refused.models?.asked ?? setup.models;
      const ask = async (input: { gateway: string; model: string }) => {
        const response = await askAgent({ ...input, agent: refused.agent, extra: refused.extra });
        expect(response.status).toBe(200);
        await response.text();
      };
      const sent = (upstream: FakeUpstream) =>
        upstream.requests.splice(0).map((request) => refused.has(receivedBody(request)));

      await ask({ gateway: harness.gateway, model });
      expect(sent(upstreamA)).toEqual([true, false]);
      await ask({ gateway: harness.gateway, model });
      expect(sent(upstreamA)).toEqual([false]);

      await ask({ gateway: harness.gateway, model: sameEndpoint });
      expect(sent(upstreamA)).toEqual([true, false]);
      await ask({ gateway: harness.gateway, model: otherEndpoint });
      expect(sent(other)).toEqual([true, false]);

      expect(
        gatewayLog(
          harness.logLines,
          "API endpoint refused a field of the request; asking it again without it",
        ),
      ).toContainEqual(
        expect.objectContaining({ level: 30, endpoint: "Relay A", model, refused: refused.field }),
      );
      expect(gatewayLog(harness.logLines, "API endpoint gateway switched endpoints")).toEqual([]);

      // 记住的写法只在内存里：重启后又先带着它问。
      const next = await harness.restart();
      await ask({ gateway: next.gateway, model });
      expect(sent(upstreamA)).toEqual([true, false]);
    },
  );

  test.each([
    {
      field: "display",
      agent: "codex",
      to: "anthropic",
      models: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-sonnet-5-5"],
      extra: { reasoning: { effort: "high" } },
      status: 400,
      refusal: ADAPTIVE_DISPLAY_REFUSED,
      has: mentions('"display"'),
    },
    {
      field: "sampling",
      agent: "codex",
      to: "anthropic",
      models: ["glm-4.6", "glm-4.5", "glm-4.7"],
      extra: { temperature: 0 },
      status: 400,
      refusal: SAMPLING_REFUSED,
      has: (body: Record<string, unknown>) => body.temperature !== undefined,
    },
    {
      field: "toolStrict",
      agent: "claude",
      to: "responses",
      models: ["grok-4", "grok-4-fast", "grok-3"],
      extra: { tools: [{ name: "Read", input_schema: { type: "object", properties: {} } }] },
      status: 400,
      refusal: STRICT_REFUSED,
      has: mentions('"strict"'),
    },
    {
      field: "imageTool",
      agent: "codex",
      to: "chat",
      models: ["deepseek-v3", "qwen3-coder", "kimi-k2.5"],
      extra: { tools: [EXEC_TOOL, IMAGE_TOOL] },
      status: 400,
      refusal: BARE_400,
      has: mentions("image_gen__imagegen"),
    },
  ] as const)(
    "$field translated for a $to endpoint: asked again without it, and from then on for that endpoint's model only",
    async (refused) => {
      const setup = TRANSLATED_SETUPS[refused.to];
      const upstreamA = await startUpstream();
      const other = await startUpstream();
      upstreamA.respond = refusing(refused, setup.answer);
      other.respond = refusing(refused, setup.answer);
      const { gateway, endpointsDir } = await start(setup.options(other));
      const [model, sameEndpoint, otherEndpoint] = refused.models;
      // A 只留这个格式的地址：两家都要翻译；A 有两个模型，另一家有第三个。
      await setBaseUrls(endpointsDir, { ep_a: [setup.address(upstreamA)] });
      await selectModels(endpointsDir, {
        ep_a: [model, sameEndpoint],
        [setup.otherId]: [otherEndpoint],
      });
      const ask = async (asked: string) => {
        const response = await askAgent({
          gateway,
          ...refused,
          model: asked,
          extra: { ...refused.extra },
        });
        expect(response.status).toBe(200);
        await response.text();
      };
      const sent = (upstream: FakeUpstream) =>
        upstream.requests.splice(0).map((request) => refused.has(receivedBody(request)));

      await ask(model);
      expect(sent(upstreamA)).toEqual([true, false]);
      await ask(model);
      expect(sent(upstreamA)).toEqual([false]);
      await ask(sameEndpoint);
      expect(sent(upstreamA)).toEqual([true, false]);
      await ask(otherEndpoint);
      expect(sent(other)).toEqual([true, false]);
    },
  );

  test("a tool result holding only tool references gets a text block naming the tools, the pairing kept", async () => {
    const upstream = await startUpstream();
    upstream.respond = (request, res) => {
      if (request.body.toString().includes("is loaded and can be called now")) {
        streamReply(res);
        return;
      }
      res.writeHead(422, { "content-type": "text/plain" });
      res.end(REFS_ONLY_REFUSED);
    };
    const { gateway } = await start({ upstreamB: upstream });
    const messages = TOOL_SEARCH_MESSAGES;

    const response = await askAgent({
      gateway,
      agent: "claude",
      model: "glm-4.6",
      extra: { messages },
    });
    expect(response.status).toBe(200);
    await response.text();

    expect(upstream.requests.map((request) => receivedBody(request).messages)).toEqual([
      messages,
      [
        messages[0],
        messages[1],
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [
                { type: "text", text: "Tool mcp__docs__search is loaded and can be called now." },
                { type: "tool_reference", tool_name: "mcp__docs__search" },
              ],
            },
          ],
        },
      ],
    ]);
  });

  test("asked again without it and refused still, the request goes on to the next endpoint", async () => {
    const { upstreamA, upstreamB, ask, endpointsDir, logLines } = await twoRelays();
    // 审查字段只发给 Claude 模型。
    const model = "claude-sonnet-4-5";
    await selectModels(endpointsDir, { ep_a: [model], ep_b: [model] });
    upstreamA.respond = (request, res) => {
      if (receivedBody(request).safeguards !== undefined) refuse(res, SAFEGUARDS_REFUSED);
      else failWith(res, { status: 503, message: "upstream busy" });
    };

    const response = await ask({ model, safeguards: { dangerous_tool_use: { enabled: true } } });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("from B");
    expect(upstreamA.requests.map((request) => receivedBody(request).safeguards)).toEqual([
      { dangerous_tool_use: { enabled: true } },
      undefined,
    ]);
    expect(receivedBody(upstreamB.requests[0]).safeguards).toEqual({
      dangerous_tool_use: { enabled: true },
    });
    expect(gatewayLog(logLines, "API endpoint gateway switched endpoints")).toEqual([
      expect.objectContaining({ from: "Relay A", to: "Relay B", model }),
    ]);
  });

  test("Codex's image tool refused again without it is offered again next time", async () => {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => refuse(res, BARE_400);
    const { gateway } = await start({ upstreamA: upstream });
    const ask = () =>
      askAgent({ gateway, agent: "codex", model: "gpt-5.5", extra: { tools: [IMAGE_TOOL] } });
    const offered = () =>
      upstream.requests.splice(0).map((request) => mentions('"image_gen"')(receivedBody(request)));

    expect((await ask()).status).toBe(400);
    expect(offered()).toEqual([true, false]);
    expect((await ask()).status).toBe(400);
    expect(offered()).toEqual([true, false]);
  });
});

// 小米 MiMo 不收 json_schema、DeepSeek 不收 json_object（magpie format_refused_test.go）。
const SCHEMA_REFUSED = `{"error":{"message":"text.format type 'json_schema' is not supported, only 'text' and 'json_object' are allowed.","type":"invalid_request_error","param":null,"code":"400"}}`;
const OBJECT_REFUSED = `{"error":{"message":"This response_format type is unavailable now","type":"invalid_request_error","param":null,"code":"invalid_request_error"}}`;
// 火山方舟 Agent Plan 与 OpenCode Go 不收预填（magpie prefill_test.go）。
const VOLCENGINE_PREFILL_REFUSED = `{"error":{"code":"InvalidParameter","message":"The parameter input[1].role specified in the request are not valid: The last message cannot be from the assistant for a model that does not support prefill","param":"input[1].role","type":"BadRequest"}}`;
const OPENCODE_PREFILL_REFUSED = `{"type":"error","error":{"type":"api_error","message":"Upstream request failed: [invalid_request_error] This model does not support assistant message prefill. The conversation must end with a user message."}}`;

const ANSWER_SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};
const SCHEMA_LINE = `Respond with a single JSON value and nothing else, matching this JSON schema:\n${JSON.stringify(ANSWER_SCHEMA)}.`;

/** 要了结构化输出就拒收：json_schema 与 json_object 都不收。 */
function refusingFormats(input: {
  formatOf: (body: Record<string, unknown>) => unknown;
  answer: (res: ServerResponse) => void;
}) {
  return (request: RecordedRequest, res: ServerResponse) => {
    const format = input.formatOf(receivedBody(request));
    if (!isRecordLike(format)) {
      input.answer(res);
      return;
    }
    refuse(res, format.type === "json_schema" ? SCHEMA_REFUSED : OBJECT_REFUSED);
  };
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 对话以 assistant 结尾就拒收。 */
function refusingPrefill(input: {
  lastOf: (body: Record<string, unknown>) => unknown;
  refusal: string;
  answer: (res: ServerResponse) => void;
}) {
  return (request: RecordedRequest, res: ServerResponse) => {
    const last = input.lastOf(receivedBody(request));
    if (isRecordLike(last) && last.role === "assistant") refuse(res, input.refusal);
    else input.answer(res);
  };
}

function roleAndContent(message: Record<string, unknown>): Record<string, unknown> {
  return { role: message.role, content: message.content };
}

function lastItem(items: unknown): unknown {
  return Array.isArray(items) ? items.at(-1) : undefined;
}

describe("a refused shape downgraded at the same endpoint", () => {
  test("Codex's schema refused twice is asked as a JSON object, then in words, and from then on", async () => {
    const upstream = await startUpstream();
    upstream.respond = refusingFormats({
      formatOf: (body) => (isRecordLike(body.text) ? body.text.format : undefined),
      answer: answerResponsesWhole,
    });
    const harness = await start({ upstreamA: upstream });
    const format = { type: "json_schema", name: "probe", strict: true, schema: ANSWER_SCHEMA };
    const ask = async (gateway: string) => {
      const response = await askAgent({
        gateway,
        agent: "codex",
        model: "gpt-5.5",
        extra: { instructions: "You are Codex.", text: { format } },
      });
      expect(response.status).toBe(200);
      await response.text();
    };
    const sent = () =>
      upstream.requests.splice(0).map((request) => {
        const { instructions, text } = receivedBody(request);
        return { instructions, text };
      });
    const told = `You are Codex.\n\n${SCHEMA_LINE}`;

    await ask(harness.gateway);
    expect(sent()).toEqual([
      { instructions: "You are Codex.", text: { format } },
      { instructions: told, text: { format: { type: "json_object" } } },
      { instructions: told, text: undefined },
    ]);
    await ask(harness.gateway);
    expect(sent()).toEqual([{ instructions: told, text: undefined }]);

    const remembered = (msg: string) =>
      gatewayLog(harness.logLines, msg).map(({ level, endpoint, model, refused }) => ({
        level,
        endpoint,
        model,
        refused,
      }));
    expect(
      remembered(
        "API endpoint refused a JSON schema; asking it again for a JSON object with the schema in the system prompt",
      ),
    ).toEqual([{ level: 30, endpoint: "Relay A", model: "gpt-5.5", refused: "jsonSchema" }]);
    expect(
      remembered(
        "API endpoint refused structured output; asking it again with the format told in the system prompt",
      ),
    ).toEqual([{ level: 30, endpoint: "Relay A", model: "gpt-5.5", refused: "structuredOutput" }]);

    // 记住的写法只在内存里：重启后又先要 schema。
    const next = await harness.restart();
    await ask(next.gateway);
    expect(sent().map((body) => body.text)).toEqual([
      { format },
      { format: { type: "json_object" } },
      undefined,
    ]);
  });

  test("Claude Code's schema translated for a Chat endpoint steps down the same way", async () => {
    const upstream = await startUpstream();
    upstream.respond = refusingFormats({
      formatOf: (body) => body.response_format,
      answer: chatStream,
    });
    const { gateway } = await start({ chatUpstream: upstream });
    const ask = async () => {
      const response = await askAgent({
        gateway,
        agent: "claude",
        model: "deepseek-v3",
        extra: {
          system: "Be brief.",
          output_config: { format: { type: "json_schema", schema: ANSWER_SCHEMA } },
        },
      });
      expect(response.status).toBe(200);
      await response.text();
    };
    const sent = () =>
      upstream.requests.splice(0).map((request) => {
        const body = receivedBody(request);
        const [system] = body.messages as unknown[];
        return { system, format: body.response_format };
      });
    const told = { role: "system", content: `Be brief.\n\n${SCHEMA_LINE}` };

    await ask();
    expect(sent()).toEqual([
      {
        system: { role: "system", content: "Be brief." },
        format: {
          type: "json_schema",
          json_schema: { name: "response", schema: ANSWER_SCHEMA },
        },
      },
      { system: told, format: { type: "json_object" } },
      { system: told, format: undefined },
    ]);
    await ask();
    expect(sent()).toEqual([{ system: told, format: undefined }]);
  });

  test("Codex's prefill refused is asked with a user turn after it, and from then on for that model only", async () => {
    const upstream = await startUpstream();
    upstream.respond = refusingPrefill({
      lastOf: (body) => lastItem(body.input),
      refusal: VOLCENGINE_PREFILL_REFUSED,
      answer: answerResponsesWhole,
    });
    const harness = await start({ upstreamA: upstream });
    const said = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "a" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "b" }] },
    ];
    const turnAfter = {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Continue." }],
    };
    const ask = async (model: string) => {
      const response = await askAgent({
        gateway: harness.gateway,
        agent: "codex",
        model,
        extra: { input: said },
      });
      expect(response.status).toBe(200);
      await response.text();
    };
    const sent = () => upstream.requests.splice(0).map((request) => receivedBody(request).input);

    await ask("gpt-5.5");
    expect(sent()).toEqual([said, [...said, turnAfter]]);
    await ask("gpt-5.5");
    expect(sent()).toEqual([[...said, turnAfter]]);
    // A 的另一个模型没拒过预填：照原样问。
    await ask("kimi-k2");
    expect(sent()).toEqual([said, [...said, turnAfter]]);

    expect(
      gatewayLog(
        harness.logLines,
        "API endpoint refused a conversation ending with the assistant's message; it takes no prefill for this model",
      ),
    ).toContainEqual(
      expect.objectContaining({
        level: 30,
        endpoint: "Relay A",
        model: "gpt-5.5",
        refused: "prefill",
      }),
    );

    const next = await harness.restart();
    const response = await askAgent({
      gateway: next.gateway,
      agent: "codex",
      model: "gpt-5.5",
      extra: { input: said },
    });
    expect(response.status).toBe(200);
    await response.text();
    expect(sent()).toEqual([said, [...said, turnAfter]]);
  });

  test("Codex's prefill translated for a Chat endpoint gets a user turn after it", async () => {
    const upstream = await startUpstream();
    upstream.respond = refusingPrefill({
      lastOf: (body) => lastItem(body.messages),
      refusal: OPENCODE_PREFILL_REFUSED,
      answer: chatStream,
    });
    const { gateway } = await start({ chatUpstream: upstream });
    const ask = async () => {
      const response = await askAgent({
        gateway,
        agent: "codex",
        model: "deepseek-v3",
        extra: {
          input: [
            { type: "message", role: "user", content: [{ type: "input_text", text: "a" }] },
            { type: "message", role: "assistant", content: [{ type: "output_text", text: "b" }] },
          ],
        },
      });
      expect(response.status).toBe(200);
      await response.text();
    };
    const sent = () =>
      upstream.requests.splice(0).map((request) => {
        const messages = receivedBody(request).messages as Record<string, unknown>[];
        return messages.map(roleAndContent);
      });
    const said = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ];
    const turnAfter = { role: "user", content: "Continue." };

    await ask();
    expect(sent()).toEqual([said, [...said, turnAfter]]);
    await ask();
    expect(sent()).toEqual([[...said, turnAfter]]);
  });

  test("Claude Code's own prefill is its ask: the refusal comes back and it is not asked again", async () => {
    const upstream = await startUpstream();
    upstream.respond = refusingPrefill({
      lastOf: (body) => lastItem(body.messages),
      refusal: OPENCODE_PREFILL_REFUSED,
      answer: streamReply,
    });
    const { gateway } = await start({ upstreamB: upstream });
    const messages = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ];

    const response = await askAgent({
      gateway,
      agent: "claude",
      model: "glm-4.6",
      extra: { messages },
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("does not support assistant message prefill");
    expect(upstream.requests.map((request) => receivedBody(request).messages)).toEqual([messages]);
  });
});

describe("when the endpoint fails", () => {
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
async function twoRelays(
  options: { headerTimeoutMs?: number; keepAliveMs?: number; keepAliveQuietMs?: number } = {},
) {
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

  test("once the reply opened it stays: the broken stream reaches the agent and the endpoint cools down", async () => {
    const { upstreamA, upstreamB, ask, daemon } = await twoRelays();
    upstreamA.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`event: message_start\ndata: {"type":"message_start","message":{}}\n\n`);
      res.write(OPENING_DELTA);
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

/** 一个 SSE 事件的原文，带 `event:` 行。 */
function sseFrame(event: { type: string } & Record<string, unknown>): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

describe("the reply opens at its first content", () => {
  test("a stream that only began before an overloaded error goes to the next endpoint, and the agent sees none of it", async () => {
    const { upstreamA, upstreamB, ask, daemon } = await twoRelays();
    upstreamA.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        sseFrame({
          type: "message_start",
          message: { id: "msg_from_a", usage: { input_tokens: 9 } },
        }),
      );
      res.write(sseFrame({ type: "ping" }));
      res.end(
        sseFrame({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
      );
    };

    const response = await ask();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    const text = await response.text();
    expect(text).toContain("from B");
    expect(text).not.toContain("msg_from_a");
    expect(text).not.toContain("Overloaded");
    expect(upstreamB.requests).toHaveLength(1);
    expect(await cooldownOf(await connectTo(daemon), "ep_a")).toMatchObject({
      state: "cooling_down",
    });
  });

  test("Codex: a stream that only said response.created before failing goes to the next endpoint", async () => {
    const { upstreamA, upstreamB, gateway, daemon } = await twoRelays();
    upstreamA.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        sseFrame({
          type: "response.created",
          response: { id: "resp_from_a", status: "in_progress" },
        }),
      );
      res.end(
        sseFrame({
          type: "response.failed",
          response: {
            id: "resp_from_a",
            status: "failed",
            error: { code: "server_error", message: "The server is overloaded" },
          },
        }),
      );
    };

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({ model: "kimi-k2", input: "hi", stream: true }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    const text = await response.text();
    expect(text).not.toContain("resp_from_a");
    expect(text).not.toContain("overloaded");
    expect(completedResponse(text).output).toEqual([
      expect.objectContaining({
        type: "message",
        content: [expect.objectContaining({ type: "output_text", text: "from B" })],
      }),
    ]);
    expect(upstreamA.requests[0]?.url).toBe("/v1/responses");
    expect(upstreamB.requests).toHaveLength(1);
    expect(await cooldownOf(await connectTo(daemon), "ep_a")).toMatchObject({
      state: "cooling_down",
      reason: "other",
    });
  });

  test("thinking opens the reply: it reaches the agent as it comes, and an error after it stays", async () => {
    const { upstreamA, upstreamB, ask } = await twoRelays();
    let releaseError: () => void = () => {};
    const errorReleased = new Promise<void>((resolve) => {
      releaseError = resolve;
    });
    upstreamA.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sseFrame({ type: "message_start", message: { id: "msg_from_a" } }));
      res.write(
        sseFrame({
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        }),
      );
      res.write(
        sseFrame({
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Let me think." },
        }),
      );
      void errorReleased.then(() => {
        res.end(
          sseFrame({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
        );
        return undefined;
      });
    };

    const response = await ask();
    const reader = response.body!.getReader();
    let shown = "";
    while (!shown.includes("Let me think.")) {
      shown += new TextDecoder().decode((await reader.read()).value);
    }
    releaseError();
    let rest = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      rest += new TextDecoder().decode(chunk.value);
    }

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(shown).toContain("msg_from_a");
    expect(rest).toContain("overloaded_error");
    expect(upstreamB.requests).toHaveLength(0);
  });

  test("an empty reply is asked again at the same endpoint, then at the next, which does not cool down", async () => {
    const { upstreamA, upstreamB, ask, daemon, logLines } = await twoRelays();
    upstreamA.respond = (_request, res) => emptyAnthropicStream(res);

    const response = await ask();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(await response.text()).toContain("from B");
    expect(upstreamA.requests).toHaveLength(2);
    expect(upstreamB.requests).toHaveLength(1);
    expect(await cooldownOf(await connectTo(daemon), "ep_a")).toBeNull();
    const switched = logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.msg === "API endpoint gateway switched endpoints");
    expect(switched).toEqual([
      expect.objectContaining({ from: "Relay A", to: "Relay B", failure: "empty" }),
    ]);
  });

  test("when every endpoint replies empty the agent gets an empty reply error in its own shape, streamed or not", async () => {
    const { upstreamA, upstreamB, gateway } = await twoRelays();
    const whole = (res: ServerResponse) =>
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          type: "message",
          role: "assistant",
          content: [],
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
      );
    upstreamA.respond = (request, res) =>
      receivedBody(request).stream ? emptyAnthropicStream(res) : whole(res);
    upstreamB.respond = upstreamA.respond;
    const ask = (stream: boolean) =>
      fetch(
        `${gateway}/v1/messages`,
        claudeRequest({
          model: "kimi-k2",
          stream,
          max_tokens: 32,
          messages: [{ role: "user", content: "hi" }],
        }),
      );

    for (const stream of [true, false]) {
      const response = await ask(stream);

      expect(response.status).toBe(502);
      expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
      expect(await response.json()).toEqual({
        type: "error",
        error: {
          type: "api_error",
          message: "Relay B: an empty reply (the model answered nothing; try again)",
        },
      });
      const asked = [upstreamA, upstreamB].map((upstream) => upstream.requests.splice(0));
      expect(asked.map((requests) => requests.length)).toEqual([2, 2]);
    }
  });

  test("a reply that counted its prompt, or a Chat reply, is an answer however little it said (magpie)", async () => {
    const { upstreamA, upstreamB, ask } = await twoRelays();
    // Claude 在工具结果之后自己以空回复结束一轮：计了提示词，是回答。
    upstreamA.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        sseFrame({
          type: "message_start",
          message: { id: "msg_said_nothing", usage: { input_tokens: 5, output_tokens: 0 } },
        }),
      );
      res.write(sseFrame({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: {} }));
      res.end(sseFrame({ type: "message_stop" }));
    };

    const counted = await ask();

    expect(counted.status).toBe(200);
    expect(counted.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(await counted.text()).toContain("msg_said_nothing");
    expect(upstreamA.requests).toHaveLength(1);
    expect(upstreamB.requests).toHaveLength(0);

    const chat = await startUpstream();
    chat.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant" } }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    };
    const { gateway } = await start({ chatUpstream: chat });

    const silent = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({
        model: "deepseek-v3",
        stream: true,
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(silent.status).toBe(200);
    expect(silent.headers.get("x-osuna-api-endpoint")).toBe("relay-c");
    expect(await silent.text()).toContain("message_stop");
    expect(chat.requests).toHaveLength(1);
  });

  test("Codex gets the empty reply error in OpenAI shape when every endpoint replies empty", async () => {
    const { upstreamA, upstreamB, gateway } = await twoRelays();
    upstreamA.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sseFrame({ type: "response.created", response: { id: "resp_empty" } }));
      res.end(
        sseFrame({
          type: "response.completed",
          response: {
            id: "resp_empty",
            status: "completed",
            output: [],
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }),
      );
    };
    upstreamB.respond = (_request, res) => emptyAnthropicStream(res);

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({ model: "kimi-k2", input: "hi", stream: true }),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(await response.json()).toEqual({
      error: {
        message: "Relay B: an empty reply (the model answered nothing; try again)",
        type: "api_error",
        code: null,
        param: null,
      },
    });
    expect(upstreamA.requests).toHaveLength(2);
    expect(upstreamB.requests).toHaveLength(2);
  });
});

/** 一段什么都没说、一个 token 也没计的 Anthropic 流式回复（magpie 的空回复）。 */
function emptyAnthropicStream(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(
    sseFrame({ type: "message_start", message: { usage: { input_tokens: 0, output_tokens: 0 } } }),
  );
  res.write(
    sseFrame({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 0 },
    }),
  );
  res.end(sseFrame({ type: "message_stop" }));
}

/** 读 Agent 收到的流，直到读到的原文里 `needle` 出现了 `times` 次；返回读到的原文与接着读的 reader。 */
async function readUntil(response: Response, needle: string, times = 1) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (text.split(needle).length - 1 < times) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`stream ended before ${times} × ${needle}: ${text}`);
    text += decoder.decode(chunk.value, { stream: true });
  }
  const rest = async () => {
    let more = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return more;
      more += decoder.decode(chunk.value, { stream: true });
    }
  };
  return { text, rest };
}

/** 上游的回复由测试放行：先回 `before`（可以是空）再等，放行后回 `after`。 */
function heldUpstream(
  before: (res: ServerResponse) => void,
  after: (res: ServerResponse) => void,
): { respond: FakeUpstream["respond"]; release: () => void } {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    respond: (_request, res) => {
      before(res);
      void released.then(() => {
        after(res);
        return undefined;
      });
    },
    release: () => release(),
  };
}

describe("the agent is kept alive while the reply has not opened", () => {
  test("Claude Code gets a 200 event stream and pings while it waits, then the reply in order", async () => {
    const { upstreamA, ask } = await twoRelays({ keepAliveMs: 30 });
    const held = heldUpstream(
      (res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(sseFrame({ type: "message_start", message: { id: "msg_slow" } }));
      },
      (res) => {
        res.write(
          sseFrame({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "at last" },
          }),
        );
        res.end(sseFrame({ type: "message_stop" }));
      },
    );
    upstreamA.respond = held.respond;

    const response = await ask();
    const { text, rest } = await readUntil(response, "event: ping", 2);
    held.release();
    const all = text + (await rest());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).not.toContain("msg_slow");
    // 放行前读到的全是 ping（至少两个，可能多一个刚好挤进同一段）。
    expect(new Set(sseData(text).map((event) => JSON.stringify(event)))).toEqual(
      new Set(['{"type":"ping"}']),
    );
    expect(all.lastIndexOf("event: ping")).toBeLessThan(all.indexOf("msg_slow"));
    expect(all.indexOf("msg_slow")).toBeLessThan(all.indexOf("at last"));
    expect(all).toContain("message_stop");
  });

  test("a translated reply follows the pings in the same stream", async () => {
    const chat = await startUpstream();
    const held = heldUpstream(
      (res) => res.writeHead(200, { "content-type": "text/event-stream" }),
      (res) => {
        res.write(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "translated" } }] })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
        );
        res.end("data: [DONE]\n\n");
      },
    );
    chat.respond = held.respond;
    const { gateway } = await start({ chatUpstream: chat, keepAliveMs: 30 });

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({
        model: "deepseek-v3",
        stream: true,
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    const { text, rest } = await readUntil(response, "event: ping");
    held.release();
    const all = text + (await rest());

    expect(response.status).toBe(200);
    expect(all.indexOf("event: message_start")).toBeGreaterThan(all.lastIndexOf("event: ping"));
    expect(all).toContain("translated");
    expect(all).toContain("event: message_stop");
  });

  test("Codex is kept alive with response.in_progress events that carry data", async () => {
    const { upstreamA, gateway } = await twoRelays({ keepAliveMs: 30 });
    const held = heldUpstream(
      (res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(sseFrame({ type: "response.created", response: { id: "resp_slow" } }));
      },
      (res) => {
        res.write(
          sseFrame({ type: "response.output_text.delta", item_id: "msg_1", delta: "at last" }),
        );
        res.end(
          sseFrame({
            type: "response.completed",
            response: { id: "resp_slow", status: "completed", output: [] },
          }),
        );
      },
    );
    upstreamA.respond = held.respond;

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({ model: "kimi-k2", input: "hi", stream: true }),
    );
    const { text, rest } = await readUntil(response, "event: response.in_progress", 2);
    held.release();
    const all = text + (await rest());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    // Codex 不认注释行：没有以冒号开头的行。
    expect(text.split("\n").filter((line) => line.startsWith(":"))).toEqual([]);
    const kept = sseData(text) as Record<string, unknown>[];
    expect(kept.length).toBeGreaterThanOrEqual(2);
    for (const event of kept) {
      expect(event).toEqual({
        type: "response.in_progress",
        response: { object: "response", status: "in_progress", output: [] },
      });
    }
    expect(all.indexOf("resp_slow")).toBeGreaterThan(
      all.lastIndexOf("event: response.in_progress"),
    );
    expect(all.indexOf("resp_slow")).toBeLessThan(all.indexOf("at last"));
    expect(completedResponse(all)).toMatchObject({ id: "resp_slow", status: "completed" });
  });

  test("when every endpoint fails after the keepalive began, the error comes in the stream", async () => {
    const claude = await twoRelays({ keepAliveMs: 30 });
    const codex = await twoRelays({ keepAliveMs: 30 });
    const fails = (res: ServerResponse) => failWith(res, { status: 503, message: "upstream busy" });
    const releases: (() => void)[] = [];
    for (const relays of [claude, codex]) {
      const held = heldUpstream(() => {}, fails);
      relays.upstreamA.respond = held.respond;
      relays.upstreamB.respond = (_request, res) => fails(res);
      releases.push(held.release);
    }

    const toClaude = await claude.ask();
    const claudeKept = await readUntil(toClaude, "event: ping");
    releases[0]?.();
    const toCodex = await fetch(
      `${codex.gateway}/v1/responses`,
      codexRequest({ model: "kimi-k2", input: "hi", stream: true }),
    );
    const codexKept = await readUntil(toCodex, "event: response.in_progress");
    releases[1]?.();
    const claudeEvents = sseData(claudeKept.text + (await claudeKept.rest()));
    const codexEvents = sseData(codexKept.text + (await codexKept.rest()));

    expect(toClaude.status).toBe(200);
    expect(claudeEvents.at(-1)).toEqual({
      type: "error",
      error: { type: "api_error", message: "Relay B: upstream busy" },
    });
    expect(toCodex.status).toBe(200);
    expect(codexEvents.at(-1)).toEqual({
      type: "response.failed",
      response: {
        object: "response",
        status: "failed",
        error: { code: "server_error", message: "Relay B: upstream busy" },
      },
    });
    expect(claude.upstreamB.requests.length).toBeGreaterThan(0);
  });

  test("empty replies after the keepalive began end the stream with the empty reply error", async () => {
    const { upstreamA, upstreamB, ask } = await twoRelays({ keepAliveMs: 30 });
    const held = heldUpstream(() => {}, emptyAnthropicStream);
    upstreamA.respond = held.respond;
    upstreamB.respond = (_request, res) => emptyAnthropicStream(res);

    const response = await ask();
    const kept = await readUntil(response, "event: ping");
    held.release();
    const events = sseData(kept.text + (await kept.rest()));

    expect(response.status).toBe(200);
    expect(events.at(-1)).toEqual({
      type: "error",
      error: {
        type: "api_error",
        message: "Relay B: an empty reply (the model answered nothing; try again)",
      },
    });
    expect(upstreamB.requests).toHaveLength(2);
  });

  test("a failure before the keepalive begins still comes back with its status and Retry-After", async () => {
    const { upstreamA, upstreamB, ask } = await twoRelays({ keepAliveMs: 5000 });
    const limited = (res: ServerResponse) =>
      failWith(res, { status: 429, message: "slow down", headers: { "retry-after": "30" } });
    upstreamA.respond = (_request, res) => limited(res);
    upstreamB.respond = upstreamA.respond;

    const response = await ask();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      type: "error",
      error: { message: expect.stringContaining("Relay B: slow down") },
    });
  });

  test("the keepalive stops once the endpoint has said nothing for too long", async () => {
    const { upstreamA, ask } = await twoRelays({ keepAliveMs: 20, keepAliveQuietMs: 100 });
    upstreamA.respond = () => {};

    const response = await ask();
    const reader = response.body!.getReader();
    const readFor = async (ms: number) => {
      let text = "";
      const until = Date.now() + ms;
      for (;;) {
        const left = until - Date.now();
        if (left <= 0) return text;
        const chunk = await Promise.race([
          reader.read(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), left)),
        ]);
        if (chunk === null) return text;
        if (chunk.done) throw new Error("the stream ended");
        text += new TextDecoder().decode(chunk.value);
      }
    };
    const whileHeard = await readFor(400);
    const afterwards = await readFor(300);
    void reader.cancel();

    expect(response.status).toBe(200);
    expect(whileHeard).toContain("event: ping");
    expect(afterwards).toBe("");
  });

  test("a request that did not ask to stream is not kept alive", async () => {
    const { upstreamA, ask } = await twoRelays({ keepAliveMs: 20 });
    const held = heldUpstream(
      () => {},
      (res) =>
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "whole" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        ),
    );
    upstreamA.respond = held.respond;

    const asked = ask({ stream: false });
    setTimeout(() => held.release(), 150);
    const response = await asked;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ content: [{ type: "text", text: "whole" }] });
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

  test("a takeover from before modelPicker was written gets it on start, and nothing else changes", async () => {
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
    const settingsBefore = await readFile(home.settingsPath, "utf8");
    await client.close();
    await first.close();

    // 工单 17 以前的样子：settings.json 与接管记录里都没有 modelPicker。
    const settings = JSON.parse(settingsBefore);
    expect(settings.modelPicker).toEqual({
      options: [{ model: "relay-a/kimi-k2", label: "kimi-k2", description: "Relay A" }],
    });
    delete settings.modelPicker;
    await writeFile(home.settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    const recordPath = path.join(home.endpointsDir, "takeover-claude.json");
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    delete record.takeover.modelPicker;
    await writeFile(recordPath, JSON.stringify(record, null, 2));

    const second = await createTestPaseoDaemon({
      paseoHomeRoot: home.root,
      listenPort: first.port,
      apiEndpoints: apiEndpointsConfig(home),
    });
    daemons.push(second);

    expect(await readFile(home.settingsPath, "utf8")).toBe(settingsBefore);
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
      modelPicker: {
        options: [{ model: "relay-a/kimi-k2", label: "kimi-k2", description: "Relay A" }],
      },
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
