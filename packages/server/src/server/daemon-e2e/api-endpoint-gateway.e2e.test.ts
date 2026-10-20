// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway 的拒收、改写与断流用例，逐项出处见下方注释）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import dns from "node:dns";
import os from "node:os";
import path from "node:path";
import * as zlib from "node:zlib";
import pino from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  ENDED_SHORT,
  brokenMessage,
  connectionLost,
} from "../api-endpoints/gateway/broken-reply.js";
import { heldClock } from "../api-endpoints/gateway/cooldown.js";
import { HIGH_RISK_REFUSAL as HIGH_RISK } from "../api-endpoints/gateway/safety-filter.js";
import { isRecord } from "../api-endpoints/upstream-http.js";
import { hashDaemonPassword } from "../auth.js";
import { createPaseoDaemon } from "../bootstrap.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { FakeHostProcesses } from "../test-utils/fake-host-processes.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * 中转站直通（工单 02）：真实 daemon + 本机假上游。CLI 这一侧用 fetch 扮演，
 * 带上 gateway-tokens.json 里的口令，就像 CLI 读自己的配置文件那样。
 * 拒收的厂商原话照 magpie 的 sub2api_think_off_test.go、gateway_test.go
 * （含 TestAnthropicClientFallsBackPastCopilotNoEndpoints）、internal/provider/authheader_test.go，
 * 以及 safeguards_refused_test.go、thinking_display_test.go、thinking_off_test.go、deferred_tools_test.go、
 * tool_reference_result_test.go、strict_refused_test.go、image_tool_test.go（含 testdata/codex_image_gen_tool.json）、
 * format_refused_test.go 与 prefill_test.go；直通的通用修补照 billing_line_test.go（Claude Code 的一轮）与 codex_backend.go 的 withoutBareReasoning；翻译时去掉 prompt_cache_key 重问照 prompt_cache_test.go（TestPromptCacheKeyRefused）；
 * 改模型输出（工单 08）照 format_fence_test.go（TestStructuredOutputFencedAnswerUnfenced）、textcalls_test.go 与 textcalls_glm_test.go；
 * 对话太长（工单 15）照 overflow_cap_test.go（TestRelayInputCapGoesToTheNextMember）与 fallback.go 的 tooLongUnsaid。
 * 按厂商的改写（工单 16）照 grok_integral_test.go 与 grok_schema_test.go。
 * 认清上游回的是什么（工单 18）照 notapi_test.go（cloudflarePage）、quiet_whole_test.go 与 codex_access_programs_test.go。
 * 拒答换家（工单 19）照 refusal_error_test.go（highRiskMessage、TestHighRiskQuotationIsAnAnswer）、refusal_test.go 与 refusal_details_test.go。
 * 开口后断流（工单 20）照 gateway.go 的 cutMidReply、saysPassing 与 TestPassthroughStreamEndsOnLineEnd 的流尾空行；
 * 断流后接着写（工单 21）照 continuation_test.go（TestStreamCutContinuesOnAnthropic、TestStreamCutContinuesWithDeepSeekPrefix、
 * TestStreamCutAfterToolCallEndsAsBefore、TestStreamCutOnPlainChatEndsAsBefore、TestStreamCutContinuesOnlySoLong、
 * TestStreamCutPrefillRefusedEndsAsBefore）。
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
    // 写进 models-dev.json 的各服务商收不收采样参数（按主机名，再按模型名）。
    modelsDevSampling?: Record<string, Record<string, boolean>>;
    // B 的上游清单（catalog）里给的模型资料（按模型名）。
    catalogB?: Record<string, Record<string, unknown>>;
    // A 选了的模型；缺省 kimi-k2 与 gpt-5.5。
    modelsA?: string[];
    // Claude Code 的默认模型；缺省 kimi-k2。
    claudeDefaultModel?: string;
    // 已下线模型记录用的时钟，测试拿它快进一周。
    retiredModelsNow?: () => number;
    // 已下线记录的到期定时器，测试拿它在快进后手动到点。
    retiredModelsTimers?: { schedule: (handler: () => void, ms: number) => () => void };
    // 中转站收的请求体上限，测试用小的，不必真造 64 MB。
    bodyLimitBytes?: number;
    // daemon 自报的版本：CLI 没带 User-Agent 时中转站写 Osuna/<版本>。
    daemonVersion?: string;
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
          models: options.modelsA ?? ["kimi-k2", "gpt-5.5"],
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
        claude: { enabled: true, defaultModelId: options.claudeDefaultModel ?? "kimi-k2" },
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
    const cache = {
      fetchedAt: "2026-10-15T00:00:00.000Z",
      etag: null,
      models: options.modelsDev,
      sampling: options.modelsDevSampling ?? {},
    };
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
      ...(options.daemonVersion ? { daemonVersion: options.daemonVersion } : {}),
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
        ...(options.bodyLimitBytes ? { gatewayBodyLimitBytes: options.bodyLimitBytes } : {}),
        ...(options.retiredModelsNow ? { retiredModelsNow: options.retiredModelsNow } : {}),
        ...(options.retiredModelsTimers
          ? { retiredModelsTimers: options.retiredModelsTimers }
          : {}),
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

// ChatGPT 登录的 Codex、claude.ai 登录的 Claude Code 带来的令牌：都不是中转站的口令。
const CHATGPT_TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl";
const CLAUDE_AI_TOKEN = "sk-ant-oat01-abcdefghijklmnopqrstuvwxyz";
const CLAUDE_UA = "claude-cli/2.1.302 (external, cli)";
const CODEX_UA = "codex_cli_rs/0.130.0 (Mac OS 26.0; arm64)";

/** 不经 fetch 发请求：fetch 不让改 Host 头，扮演 DNS 重绑定的网页要改。 */
function rawRequest(input: {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const sent = httpRequest(
      input.url,
      { method: input.method ?? "GET", headers: input.headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    sent.on("error", reject);
    sent.end(input.body);
  });
}

describe("who may use the gateway", () => {
  /** B 把 Claude 的 haiku 档位映射到 glm-4.6（只对 Claude Code 生效）；A 的 Responses 地址整份回复。 */
  async function startRecognising() {
    const upstreamA = await startUpstream();
    upstreamA.respond = (_request, res) => answerResponsesWhole(res);
    const upstreamB = await startUpstream();
    const harness = await start({ upstreamA, upstreamB });
    const endpointsPath = path.join(harness.endpointsDir, "endpoints.json");
    const file = JSON.parse(await readFile(endpointsPath, "utf8")) as {
      endpoints: { modelMapping?: Record<string, string> }[];
    };
    file.endpoints[1]!.modelMapping = { haiku: "glm-4.6" };
    await writeFile(endpointsPath, JSON.stringify(file));
    const haiku = (headers: Record<string, string>) =>
      fetch(`${harness.gateway}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          ...headers,
        },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1, messages: [] }),
      });
    const responses = (model: string, headers: Record<string, string>) =>
      fetch(`${harness.gateway}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", "thread-id": "thread-1", ...headers },
        body: JSON.stringify({ model, input: "hi", stream: false }),
      });
    return { ...harness, upstreamA, upstreamB, haiku, responses };
  }

  test("a local request with no token, a ChatGPT token or a claude.ai token is taken and told apart by its User-Agent", async () => {
    const { haiku, responses, upstreamB } = await startRecognising();
    const credentials: Record<string, string>[] = [
      {},
      { authorization: `Bearer ${CHATGPT_TOKEN}` },
      { authorization: `Bearer ${CLAUDE_AI_TOKEN}` },
      { "x-api-key": CLAUDE_AI_TOKEN },
    ];

    for (const credential of credentials) {
      // Claude Code：档位名按映射发给 B。
      const claude = await haiku({ ...credential, "user-agent": CLAUDE_UA });
      expect(claude.status, JSON.stringify(credential)).toBe(200);
      expect(claude.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
      // Codex：auto-review 跟上一轮答的模型走。
      expect((await responses("gpt-5.5", { ...credential, "user-agent": CODEX_UA })).status).toBe(
        200,
      );
      const review = await responses("codex-auto-review", {
        ...credential,
        "user-agent": CODEX_UA,
      });
      expect(review.status, JSON.stringify(credential)).toBe(200);
    }
    expect(upstreamB.requests).toHaveLength(credentials.length);

    // User-Agent 先于路径：Codex 发到 Anthropic 路径的档位名不映射，Claude Code 的 auto-review 不跟上一轮。
    expect((await haiku({ "user-agent": CODEX_UA })).status).toBe(404);
    expect((await responses("codex-auto-review", { "user-agent": CLAUDE_UA })).status).toBe(404);
    // 都认不出时按路径：Anthropic 路径是 Claude Code，Responses 路径是 Codex。
    expect((await haiku({ "user-agent": "curl/8.4.0" })).status).toBe(200);
    expect((await responses("codex-auto-review", { "user-agent": "curl/8.4.0" })).status).toBe(200);
  });

  test("web pages and proxied requests are refused in the agent's format", async () => {
    const { gateway, daemon, upstreamA, upstreamB } = await startRecognising();
    const claudeBody = JSON.stringify({ model: "kimi-k2", max_tokens: 1, messages: [] });

    const page = await fetch(`${gateway}/v1/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${CLAUDE_TOKEN}`,
        "anthropic-version": "2023-06-01",
        "content-type": "text/plain;charset=UTF-8",
        origin: "https://evil.example",
      },
      body: claudeBody,
    });
    expect(page.status).toBe(403);
    expect(await page.json()).toEqual({
      type: "error",
      error: {
        type: "permission_error",
        message: "The API endpoint gateway doesn't answer the web page https://evil.example",
      },
    });

    const frame = await fetch(`${gateway}/v1/responses`, {
      method: "POST",
      headers: { origin: "null", "content-type": "text/plain" },
      body: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
    });
    expect(frame.status).toBe(403);
    expect(await frame.json()).toMatchObject({
      error: { type: "permission_error", code: null, param: null },
    });

    const rebound = await rawRequest({
      url: `http://127.0.0.1:${daemon.port}/api-endpoint-gateway/v1/responses`,
      method: "POST",
      headers: {
        host: `rebind.attacker.example:${daemon.port}`,
        "user-agent": "Mozilla/5.0 (Macintosh) Chrome/140",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "content-type": "text/plain",
      },
      body: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
    });
    expect(rebound.status).toBe(403);
    expect(JSON.parse(rebound.body)).toEqual({
      error: {
        message: `The API endpoint gateway doesn't answer a browser that reached it as rebind.attacker.example:${daemon.port} (a web site's name pointed at this computer): call it as localhost or 127.0.0.1`,
        type: "permission_error",
        code: null,
        param: null,
      },
    });

    for (const name of [
      "Forwarded",
      "X-Forwarded-For",
      "X-Real-IP",
      "Cf-Connecting-IP",
      "True-Client-IP",
      "Tailscale-User-Login",
    ]) {
      const proxied = await fetch(`${gateway}/v1/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${CLAUDE_TOKEN}`,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          [name]: "203.0.113.9",
        },
        body: claudeBody,
      });
      expect(proxied.status, name).toBe(403);
      expect(await proxied.json()).toMatchObject({
        type: "error",
        error: { type: "permission_error" },
      });
    }
    expect(upstreamA.requests).toHaveLength(0);
    expect(upstreamB.requests).toHaveLength(0);
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

  test("turning an agent off keeps its token, still honoured, and turning it on again writes the same one", async () => {
    const { daemon, endpointsDir, haiku } = await startRecognising();
    const tokensPath = path.join(endpointsDir, "gateway-tokens.json");
    const settingsPath = path.join(endpointsDir, "..", "..", "claude", "settings.json");
    await writeFile(tokensPath, JSON.stringify({ tokens: {} }));
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.15.1",
    });
    clients.push(client);
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    const readTokens = async () =>
      (JSON.parse(await readFile(tokensPath, "utf8")) as { tokens: Record<string, string> }).tokens;
    const writtenToken = async () =>
      (JSON.parse(await readFile(settingsPath, "utf8")) as { env: Record<string, string> }).env
        .ANTHROPIC_AUTH_TOKEN;

    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    const afterOn = await readTokens();
    const mode = (await stat(tokensPath)).mode & 0o777;
    const writtenWhileOn = await writtenToken();

    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    const afterOff = await readTokens();
    // 口令说是 Claude Code，压过说是 Codex 的 User-Agent：档位名照样映射。
    const honouredAfterOff = await haiku({
      authorization: `Bearer ${afterOn.claude}`,
      "user-agent": CODEX_UA,
    });
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });

    expect(afterOn.claude).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mode).toBe(0o600);
    expect(writtenWhileOn).toBe(afterOn.claude);
    // Codex 一直开着：补上的口令在之后的改动里保持不变。
    expect(afterOn.codex).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(afterOff).toEqual(afterOn);
    expect(honouredAfterOff.status).toBe(200);
    expect(await readTokens()).toEqual(afterOn);
    expect(await writtenToken()).toBe(afterOn.claude);
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

/*
 * claude.ai 登录的 Claude Code（工单 18，照 magpie 的 claude_signin.go、betas.go askedBetas 与 claude_signin_test.go）：
 * 它把自己的 claude.ai 令牌当口令发来，中转站收下但从不转给接口；上游的 401、说 OAuth 令牌已吊销的 403
 * 改成 502 并写明哪家接口，免得 Claude Code 以为自己的登录失效。
 */
describe("Claude Code signed in to claude.ai", () => {
  function signedInRequest(body: unknown): RequestInit {
    return {
      method: "POST",
      headers: {
        authorization: `Bearer ${CLAUDE_AI_TOKEN}`,
        "user-agent": CLAUDE_UA,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "claude-code-20250219,oauth-2025-04-20, context-1m-2025-08-07",
      },
      body: JSON.stringify(body),
    };
  }
  const glmTurn = { model: "glm-4.6", max_tokens: 8, messages: [{ role: "user", content: "hi" }] };

  /** 只有 B 选了 glm-4.6：它的错误直接交给 Claude Code。 */
  async function startAnswering(answer: { status: number; body: string }) {
    const upstreamB = await startUpstream();
    upstreamB.respond = (_request, res) => {
      res.writeHead(answer.status, { "content-type": "application/json" });
      res.end(answer.body);
    };
    const harness = await start({ upstreamB });
    return { ...harness, upstreamB };
  }

  test("the sign-in never reaches the endpoint, nor its oauth- beta; the endpoint's own key does", async () => {
    const upstream = await startUpstream();
    const { gateway } = await start({ upstreamA: upstream });

    const response = await fetch(
      `${gateway}/v1/messages`,
      signedInRequest({ ...glmTurn, model: "kimi-k2" }),
    );

    expect(response.status).toBe(200);
    const received = upstream.requests[0]!;
    expect(JSON.stringify(received.headers)).not.toContain(CLAUDE_AI_TOKEN);
    expect(received.headers.authorization).toBe(`Bearer ${KEY_A}`);
    expect(received.headers["x-api-key"]).toBe(KEY_A);
    expect(received.headers["anthropic-beta"]).toBe("claude-code-20250219,context-1m-2025-08-07");
  });

  test("an endpoint's 401 is told as a 502 naming the endpoint, x-api-key said as API key", async () => {
    const { gateway } = await startAnswering({
      status: 401,
      body: JSON.stringify({
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
      }),
    });

    const response = await fetch(`${gateway}/v1/messages`, signedInRequest(glmTurn));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      type: "error",
      error: {
        type: "api_error",
        message: "Relay B refused Osuna's credential (HTTP 401): invalid API key",
      },
    });
  });

  test("a 403 saying the OAuth token was revoked is a 502 too; any other 403 keeps its status", async () => {
    const revoked = await startAnswering({
      status: 403,
      body: JSON.stringify({
        type: "error",
        error: { type: "permission_error", message: "OAuth token has been revoked" },
      }),
    });
    const told = await fetch(`${revoked.gateway}/v1/messages`, signedInRequest(glmTurn));
    expect(told.status).toBe(502);
    expect(await told.json()).toEqual({
      type: "error",
      error: {
        type: "api_error",
        message: "Relay B refused Osuna's credential (HTTP 403): OAuth token has been revoked",
      },
    });

    const other = await startAnswering({
      status: 403,
      body: JSON.stringify({
        type: "error",
        error: { type: "permission_error", message: "this x-api-key has no access to glm-4.6" },
      }),
    });
    const kept = await fetch(`${other.gateway}/v1/messages`, signedInRequest(glmTurn));
    expect(kept.status).toBe(403);
    const keptBody = (await kept.json()) as { error: { message: string } };
    expect(keptBody.error.message).toBe("Relay B: this API key has no access to glm-4.6");
  });

  test("other errors keep their status with x-api-key said as API key; a request with the gateway's token is answered as before", async () => {
    const { gateway } = await startAnswering({
      status: 400,
      body: JSON.stringify({
        type: "error",
        error: { type: "invalid_request_error", message: "X-Api-Key header is malformed" },
      }),
    });

    const signedIn = await fetch(`${gateway}/v1/messages`, signedInRequest(glmTurn));
    expect(signedIn.status).toBe(400);
    expect(((await signedIn.json()) as { error: { message: string } }).error.message).toBe(
      "Relay B: API key header is malformed",
    );

    const withToken = await fetch(`${gateway}/v1/messages`, claudeRequest(glmTurn));
    expect(withToken.status).toBe(400);
    expect(((await withToken.json()) as { error: { message: string } }).error.message).toBe(
      "Relay B: X-Api-Key header is malformed",
    );
  });

  test("with the gateway's token an endpoint's 401 stays a 401", async () => {
    const { gateway } = await startAnswering({
      status: 401,
      body: JSON.stringify({
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
      }),
    });

    const response = await fetch(`${gateway}/v1/messages`, claudeRequest(glmTurn));

    expect(response.status).toBe(401);
  });

  test("count_tokens: an endpoint's 401 never reaches Claude Code as a 401, and the endpoint gets neither the sign-in nor its beta", async () => {
    const { gateway, upstreamB } = await startAnswering({
      status: 401,
      body: JSON.stringify({
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
      }),
    });

    const response = await fetch(
      `${gateway}/v1/messages/count_tokens?beta=true`,
      signedInRequest(glmTurn),
    );

    // 这家数不了时中转站在本地估算：Claude Code 收到 200，不是 401。
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ input_tokens: expect.any(Number) });
    const received = upstreamB.requests[0]!;
    expect(received.url).toBe("/v1/messages/count_tokens?beta=true");
    expect(JSON.stringify(received.headers)).not.toContain(CLAUDE_AI_TOKEN);
    expect(received.headers.authorization).toBe(`Bearer ${KEY_B}`);
    expect(received.headers["anthropic-beta"]).toBe("claude-code-20250219,context-1m-2025-08-07");
  });

  test("a stream's error after its 200 says API key, not x-api-key", async () => {
    const upstreamB = await startUpstream();
    upstreamB.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('event: message_start\ndata: {"type":"message_start"}\n\n');
      res.write(OPENING_DELTA);
      res.end(
        'event: error\ndata: {"type":"error","error":{"type":"authentication_error","message":"x-api-key expired"}}\n\n',
      );
    };
    const { gateway } = await start({ upstreamB });

    const response = await fetch(
      `${gateway}/v1/messages`,
      signedInRequest({ ...glmTurn, stream: true }),
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain('"message":"API key expired"');
    expect(text.toLowerCase()).not.toContain("x-api-key");
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

  test("a Claude tier name no endpoint maps is sent as Claude Code's default model, not a 404", async () => {
    const upstreamB = await startUpstream();
    const { gateway, endpointsDir } = await start({ upstreamB });
    const endpointsPath = path.join(endpointsDir, "endpoints.json");
    const file = JSON.parse(await readFile(endpointsPath, "utf8")) as {
      agents: { claude: { defaultModelId: string } };
    };
    file.agents.claude.defaultModelId = "glm-4.6";
    await writeFile(endpointsPath, JSON.stringify(file));

    // claude-mythos-5-1 对不上档位，也没人在售：一样换成默认模型（magpie 的 claudeStandInAt）。
    for (const model of ["haiku", "claude-haiku-4-5-20251001", "claude-mythos-5-1"]) {
      const response = await fetch(
        `${gateway}/v1/messages`,
        claudeRequest({ model, max_tokens: 1, messages: [] }),
      );
      expect(response.status, model).toBe(200);
      expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    }
    expect(upstreamB.requests.map(receivedModel)).toEqual(["glm-4.6", "glm-4.6", "glm-4.6"]);
  });

  test("a Claude Code tier id an endpoint selected still goes to the model its tier is mapped to", async () => {
    const upstreamA = await startUpstream();
    const upstreamB = await startUpstream();
    const { gateway, endpointsDir } = await start({ upstreamA, upstreamB });
    await selectModels(endpointsDir, { ep_a: ["kimi-k2", "claude-haiku-4-5-20251001"] });
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
    expect(upstreamB.requests.map(receivedModel)).toEqual(["glm-4.6"]);
    expect(upstreamA.requests).toEqual([]);
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

/*
 * Codex 的强制 Subagent 模型与 spawn_agent 的模型清单（工单 24），照 magpie 的 codex_subagent_test.go
 * （TestCodexSubagentPutOnTheModelSet、TestCodexSubagentModelLeavesOtherRequests、TestCodexSubagentModelNotServedKeepsTheAsked）
 * 与 codex_spawn_models_test.go（TestSpawnAgentNamesEveryModel；spawn_agent 的说明取自其中 Codex 0.162.0 的真实请求）。
 */
const SPAWN_LISTED =
  "\n        \n        Available model overrides (optional; inherited parent model is preferred):\n- `gpt-5.5`: Latest workhorse model for coding and everyday work.\n";
const SPAWN_TEXT =
  "        Spawn a sub-agent for a well-scoped task. Returns the spawned agent id plus the user-facing nickname when available.";

function spawnTools(description: string) {
  return [
    {
      type: "namespace",
      name: "multi_agent_v1",
      tools: [
        {
          type: "function",
          name: "spawn_agent",
          description,
          parameters: {
            type: "object",
            properties: { message: { type: "string" }, model: { type: "string" } },
          },
        },
      ],
    },
  ];
}

const SpawnBodySchema = z.object({
  tools: z.array(
    z.object({ tools: z.array(z.object({ name: z.string(), description: z.string() })) }),
  ),
});

// endpoints.json 里测试要改的部分，其余照原样带着。
const EndpointsJsonSchema = z
  .object({
    agents: z.object({ codex: z.record(z.string(), z.unknown()) }).catchall(z.unknown()),
  })
  .catchall(z.unknown());

function spawnDescriptionOf(request: RecordedRequest | undefined): string | undefined {
  const parsed = SpawnBodySchema.safeParse(JSON.parse(request?.body.toString() ?? "{}"));
  return parsed.success ? parsed.data.tools[0]?.tools[0]?.description : undefined;
}

describe("Codex's Subagents on the forced Subagent model, and spawn_agent naming every model", () => {
  async function codexRelays(forced: string | null) {
    const upstreamA = await startUpstream();
    upstreamA.respond = (_request, res) => answerResponsesWhole(res);
    const responsesUpstream = await startUpstream();
    responsesUpstream.respond = (_request, res) => answerResponsesWhole(res);
    const harness = await start({ upstreamA, responsesUpstream });
    const endpointsPath = path.join(harness.endpointsDir, "endpoints.json");
    const stored = EndpointsJsonSchema.parse(JSON.parse(await readFile(endpointsPath, "utf8")));
    stored.agents.codex = { ...stored.agents.codex, forcedSubagentModelId: forced };
    await writeFile(endpointsPath, JSON.stringify(stored, null, 2));
    const ask = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
      fetch(`${harness.gateway}/v1/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${CODEX_TOKEN}`,
          "content-type": "application/json",
          "thread-id": "thread-1",
          ...headers,
        },
        body: JSON.stringify({ input: "hi", stream: false, ...body }),
      });
    return { ...harness, upstreamA, responsesUpstream, ask };
  }

  test("a Subagent's request reaches the forced model, whatever its lead asked; the lead's and other calls stay as asked", async () => {
    const { upstreamA, responsesUpstream, ask } = await codexRelays("grok-4");

    const lead = await ask({ model: "gpt-5.5" });
    const subagent = await ask({ model: "gpt-5.5" }, { "x-openai-subagent": "thread_spawn" });
    const older = await ask({ model: "kimi-k2" }, { "x-openai-subagent": "collab_spawn" });
    const review = await ask({ model: "gpt-5.5" }, { "x-openai-subagent": "review" });

    expect([lead.status, subagent.status, older.status, review.status]).toEqual([
      200, 200, 200, 200,
    ]);
    expect(upstreamA.requests.map(receivedModel)).toEqual(["gpt-5.5", "gpt-5.5"]);
    expect(responsesUpstream.requests.map(receivedModel)).toEqual(["grok-4", "grok-4"]);
  });

  test("a forced model no endpoint serves now, or one that can't open a sealed task, leaves the Subagent where its lead put it", async () => {
    const { upstreamA, responsesUpstream, ask } = await codexRelays("gone-9");
    expect((await ask({ model: "gpt-5.5" }, { "x-openai-subagent": "thread_spawn" })).status).toBe(
      200,
    );
    expect(upstreamA.requests.map(receivedModel)).toEqual(["gpt-5.5"]);

    const sealed = await codexRelays("grok-4");
    const task = {
      type: "agent_message",
      author: "/root",
      content: [
        { type: "input_text", text: "Message Type: NEW_TASK\n" },
        { type: "encrypted_content", encrypted_content: "gAAAAABsealedtask_-0123" },
      ],
    };
    const reply = await sealed.ask(
      { model: "gpt-5.5", input: [task] },
      { "x-openai-subagent": "thread_spawn" },
    );
    expect(reply.status).toBe(200);
    expect(sealed.upstreamA.requests.map(receivedModel)).toEqual(["gpt-5.5"]);
    expect(sealed.responsesUpstream.requests).toEqual([]);
    expect(responsesUpstream.requests).toEqual([]);
  });

  test("spawn_agent names the rest of the models in Codex's list after Codex's own, and a request without it is left alone", async () => {
    const { upstreamA, ask } = await codexRelays(null);

    const spawning = await ask({ model: "gpt-5.5", tools: spawnTools(SPAWN_LISTED + SPAWN_TEXT) });
    const plain = await ask({ model: "gpt-5.5" });

    expect([spawning.status, plain.status]).toEqual([200, 200]);
    expect(spawnDescriptionOf(upstreamA.requests[0])).toBe(
      `${SPAWN_LISTED.slice(0, -1)}\nMore models that may be set as \`model\`:\n- \`kimi-k2\`\n- \`glm-4.6\`\n- \`grok-4\`\n${SPAWN_TEXT}`,
    );
    expect(JSON.parse(upstreamA.requests[1]?.body.toString() ?? "{}")).not.toHaveProperty("tools");
  });
});

/** 假 Chat 上游的流式回复：一段文字、一个带参数的工具调用、以工具调用结束、最后报用量。 */
function chatStream(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const chunk of CHAT_CHUNKS) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.end("data: [DONE]\n\n");
}

/** chatStream 的整个流一次写完（工单 18：开口那一段之后 end 不等人读就发出）。 */
function chatStreamInOneWrite(res: ServerResponse): void {
  const events = CHAT_CHUNKS.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`);
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(`${events.join("")}data: [DONE]\n\n`);
}

const CHAT_CHUNKS = [
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
];

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

/** chatStream 翻给 Claude Code 的事件流（每个事件的 data）。 */
const CHAT_AS_ANTHROPIC_EVENTS = [
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
];

/** chatStream 翻给不要流式的 Claude Code 的整份回复（请求的是 relay-c/deepseek-v3）。 */
const CHAT_AS_ANTHROPIC_WHOLE = {
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
};

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
    expect(sseData(text)).toEqual(CHAT_AS_ANTHROPIC_EVENTS);
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
    expect(await response.json()).toEqual(CHAT_AS_ANTHROPIC_WHOLE);
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
        "qwen3-coder": { efforts: ["low", "high", "max"] },
        "glm-4.6": { context: 200_000, output: 131_072, efforts: ["low", "medium", "high"] },
      },
      // 假上游在 127.0.0.1：models.dev 里这个主机名的服务商说 qwen3-coder 不收采样参数。
      modelsDevSampling: { "127.0.0.1": { "qwen3-coder": false } },
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

  test("a Chat endpoint's unexplained 400 to the cache key is asked again without it, remembered once that answers (magpie TestPromptCacheKeyRefused)", async () => {
    const keyed = (request: RecordedRequest) =>
      "prompt_cache_key" in (JSON.parse(request.body.toString()) as Record<string, unknown>);
    const ask = (gateway: string) =>
      fetch(
        `${gateway}/v1/responses`,
        codexRequest({ ...codexConversation("qwen3-coder", true), prompt_cache_key: "thread-1" }),
      );

    const keyRefusing = await startUpstream();
    keyRefusing.respond = (request, res) => {
      if (!keyed(request)) return chatStream(res);
      res.writeHead(422, { "content-type": "application/json" });
      res.end(`{"error":{"message":"invalid request body"}}`);
    };
    const first = await start({ chatUpstream: keyRefusing });
    const turns = [await ask(first.gateway), await ask(first.gateway)];
    expect(turns.map((response) => response.status)).toEqual([200, 200]);
    expect(keyRefusing.requests.map(keyed)).toEqual([true, false, false]);

    // 拒的是别的（对话太长）：去掉也没用，不记，下一轮照样带。
    const other = await startUpstream();
    other.respond = (_request, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(`{"error":{"message":"context too long"}}`);
    };
    const second = await start({ chatUpstream: other });
    const failed = [await ask(second.gateway), await ask(second.gateway)];
    expect(failed.map((response) => response.status)).toEqual([400, 400]);
    expect(other.requests.map(keyed)).toEqual([true, false, true, false]);
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

    // Claude Code 这边带上接口标识：光秃秃的 Claude id 会按档位映射换模型（magpie 的 claudeTierStandIn）。
    for (const model of models) {
      const response = await fetch(
        `${gateway}/v1/messages`,
        claudeRequest({
          model: `relay-b/${model}`,
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

// 接口管理好用性工单 13：模型设置里一档思考都不留，中转站不发任何思考参数（magpie Reasonless 的 withoutAnyReasoning）。
describe("a model with no thinking level kept", () => {
  async function keepNoLevels(endpointsDir: string, models: Record<string, string[]>) {
    const endpointsPath = path.join(endpointsDir, "endpoints.json");
    const file = JSON.parse(await readFile(endpointsPath, "utf8")) as {
      endpoints: { id: string; modelSettings?: unknown }[];
    };
    for (const endpoint of file.endpoints) {
      const ids = models[endpoint.id];
      if (!ids) continue;
      endpoint.modelSettings = {
        models: Object.fromEntries(ids.map((id) => [id, { efforts: [] }])),
      };
    }
    await writeFile(endpointsPath, JSON.stringify(file));
  }

  test("is sent no thinking field, passed through or translated; another model still is", async () => {
    const responses = await startUpstream();
    responses.respond = (_request, res) => answerResponsesWhole(res);
    const anthropic = await startUpstream();
    anthropic.respond = (_request, res) => anthropicStream(res);
    const chat = await startUpstream();
    chat.respond = (_request, res) => chatStream(res);
    const { gateway, endpointsDir } = await start({
      upstreamA: responses,
      upstreamB: anthropic,
      chatUpstream: chat,
    });
    await keepNoLevels(endpointsDir, {
      ep_a: ["gpt-5.5"],
      ep_b: ["glm-4.6"],
      ep_c: ["deepseek-v3"],
    });
    const codexAsk = async (model: string) => {
      const response = await fetch(
        `${gateway}/v1/responses`,
        codexRequest({
          model,
          input: "hi",
          stream: false,
          reasoning: { effort: "high", summary: "auto" },
          include: ["reasoning.encrypted_content"],
        }),
      );
      expect(response.status).toBe(200);
      await response.text();
    };
    const claudeAsk = async (model: string) => {
      const response = await fetch(
        `${gateway}/v1/messages`,
        claudeRequest({
          model,
          max_tokens: 64,
          thinking: { type: "enabled", budget_tokens: 2048 },
          output_config: { effort: "high" },
          messages: [{ role: "user", content: "hi" }],
        }),
      );
      expect(response.status).toBe(200);
      await response.text();
    };

    // 直通 Responses：reasoning 与要封存推理的 include 都去掉。
    await codexAsk("gpt-5.5");
    const passed = receivedBody(responses.requests.splice(0)[0]);
    expect(passed.reasoning).toBeUndefined();
    expect(passed.include).toEqual([]);
    // 直通 Anthropic：thinking 与 output_config.effort 都去掉。
    await claudeAsk("relay-b/glm-4.6");
    const claudePassed = receivedBody(anthropic.requests.splice(0)[0]);
    expect(claudePassed.thinking).toBeUndefined();
    expect(claudePassed.output_config).toBeUndefined();
    // 翻成 Chat：不带 reasoning_effort。
    await codexAsk("deepseek-v3");
    await claudeAsk("relay-c/deepseek-v3");
    const translated = chat.requests.splice(0).map(receivedBody);
    expect(translated.map((body) => body.reasoning_effort)).toEqual([undefined, undefined]);
    // 别的模型照常带。
    await codexAsk("qwen3-coder");
    expect(receivedBody(chat.requests.splice(0)[0]).reasoning_effort).toBe("high");
    await claudeAsk("relay-b/kimi-k2");
    expect(receivedBody(anthropic.requests.splice(0)[0]).thinking).toMatchObject({
      type: "enabled",
    });
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
      /^Relay A: Slow down, key \*\*\* is busy \(available again at (\d{4}-\d{2}-\d{2} )?\d{2}:\d{2} UTC[+-]\d{1,2}(:\d{2})?\)$/,
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

/** 一段 Anthropic 流式回复；`cacheRead`、`cacheWrite` 是这次从厂商缓存读到、写进缓存的 token 数。 */
function streamReply(
  res: ServerResponse,
  input: { text?: string; cacheRead?: number; cacheWrite?: number } = {},
) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const usage = {
    input_tokens: 10,
    cache_read_input_tokens: input.cacheRead ?? 0,
    cache_creation_input_tokens: input.cacheWrite ?? 0,
  };
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
type StartOptions = NonNullable<Parameters<typeof start>[0]>;

async function twoRelays(
  options: Pick<
    StartOptions,
    "headerTimeoutMs" | "keepAliveMs" | "keepAliveQuietMs" | "modelsDev" | "catalogB"
  > = {},
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

  test("after the endpoint order changes, a bare model name goes to the new first endpoint and fails over to the next", async () => {
    const { upstreamA, upstreamB, ask, daemon } = await twoRelays();
    upstreamA.respond = (_request, res) => streamReply(res, { text: "from A" });
    const client = await connectTo(daemon);
    expect((await client.apiEndpointSetOrder({ endpointIds: ["ep_b", "ep_a"] })).error).toBeNull();

    const first = await ask();
    expect(first.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(await first.text()).toContain("from B");
    expect(upstreamA.requests).toHaveLength(0);

    upstreamB.respond = (_request, res) => failWith(res, { status: 503, message: "upstream busy" });
    const second = await ask();
    expect(second.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(await second.text()).toContain("from A");
    expect(upstreamB.requests).toHaveLength(2);
  });

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

  test("once the reply opened it stays: the broken stream ends with an error event for the agent and the endpoint cools down", async () => {
    const { upstreamA, upstreamB, ask, daemon } = await twoRelays();
    const opening = `event: message_start\ndata: {"type":"message_start","message":{}}\n\n`;
    upstreamA.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(opening);
      res.write(OPENING_DELTA);
      setTimeout(() => res.destroy(), 50);
    };

    const response = await ask();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    // 开口后断流照 magpie：流尾先空一行，再补 api_error，然后正常结束响应。
    expect(await response.text()).toBe(
      `${opening}${OPENING_DELTA}\n${sseFrame({
        type: "error",
        error: {
          type: "api_error",
          message: brokenMessage({
            endpointName: "Relay A",
            reason: "connection lost mid-reply (aborted)",
          }),
        },
      })}`,
    );
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

  test("with every endpoint out of quota the first one's error comes back with its zone, and none is asked until one is back", async () => {
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
    expect(held.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(Number(held.headers.get("retry-after"))).toBeGreaterThan(800);
    expect(((await held.json()) as { error: { message: string } }).error.message).toMatch(
      /^Relay A: You exceeded your current quota \(available again at (\d{4}-\d{2}-\d{2} )?\d{2}:\d{2} UTC[+-]\d{1,2}(:\d{2})?\)$/,
    );
    expect(upstreamA.requests).toHaveLength(1);
    expect(upstreamB.requests).toHaveLength(1);
  });

  test("with every endpoint out of quota the first one's words come back with the time the earliest is back", async () => {
    const { upstreamA, upstreamB, ask } = await twoRelays();
    upstreamA.respond = (_request, res) =>
      failWith(res, {
        status: 429,
        message: "You exceeded your current quota",
        headers: { "retry-after": "3000" },
      });
    upstreamB.respond = (_request, res) =>
      failWith(res, {
        status: 429,
        message: "B: monthly quota used up",
        headers: { "retry-after": "600" },
      });
    const before = Date.now();
    await (await ask()).text();
    const after = Date.now();

    const held = await ask();

    expect(held.status).toBe(429);
    expect(held.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(Number(held.headers.get("retry-after"))).toBeLessThanOrEqual(600);
    expect(Number(held.headers.get("retry-after"))).toBeGreaterThan(590);
    // B 先恢复：时刻是 B 的，原话是排第一的 A 的；分钟可能恰好在两次取时之间进位。
    const told = [before, after].map(
      (at) =>
        `Relay A: You exceeded your current quota (available again at ${heldClock(at + 600_000, at)})`,
    );
    const message = ((await held.json()) as { error: { message: string } }).error.message;
    expect(told).toContain(message);
    expect(upstreamA.requests).toHaveLength(1);
    expect(upstreamB.requests).toHaveLength(1);
  });

  test("while the endpoint after it is out of quota, a busy endpoint is asked again in place and the other is not asked", async () => {
    const { upstreamA, upstreamB, ask } = await twoRelays();
    // 先让 B 因额度冷却：A 不收这个写法（换家但不冷却），B 说额度用完。
    upstreamA.respond = (_request, res) =>
      failWith(res, { status: 400, message: "Extra inputs are not permitted" });
    upstreamB.respond = (_request, res) =>
      failWith(res, { status: 429, message: "B: monthly quota used up" });
    expect((await ask()).status).toBe(429);
    expect(upstreamA.requests).toHaveLength(1);
    expect(upstreamB.requests).toHaveLength(1);

    let busy = 1;
    upstreamA.respond = (_request, res) => {
      if (busy-- > 0) failWith(res, { status: 529, message: "Overloaded" });
      else streamReply(res, { text: "from A" });
    };
    const response = await ask();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(await response.text()).toContain("from A");
    expect(upstreamA.requests).toHaveLength(3);
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

/** 按本地估算（UTF-8 字节 ÷ 4）约有这么多 token 的一句话。 */
function textOfTokens(tokens: number): string {
  return "x".repeat(tokens * 4);
}

function switchedLog(logLines: string[]): Record<string, unknown> | undefined {
  return logLines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((line) => line.msg === "API endpoint gateway switched endpoints");
}

// 中转服务自己的单次输入上限照 magpie overflow_cap_test.go 的原话（#2445）；
// 不说原因的 400 照 fallback.go 的 tooLongUnsaid 注释里 WorkBuddy 的「Invalid request parameters」。
describe("a conversation too long for a model", () => {
  test("a request past the first endpoint's known window is not sent to it and goes to one with room", async () => {
    const { upstreamA, upstreamB, ask, logLines } = await twoRelays({
      modelsDev: { "kimi-k2": { context: 4096 } },
      catalogB: { "kimi-k2": { context: 1_000_000 } },
    });

    const response = await ask({ messages: [{ role: "user", content: textOfTokens(5000) }] });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(await response.text()).toContain("from B");
    expect(upstreamA.requests).toHaveLength(0);
    expect(upstreamB.requests).toHaveLength(1);
    const skipped = logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.msg === "API endpoint skipped: the request is past its context window");
    expect(skipped).toMatchObject({
      endpoint: "Relay A",
      model: "kimi-k2",
      tokens: 5000,
      window: 4096,
    });
  });

  test("an endpoint saying it is too long hands it to the next endpoint whose known window is larger, nobody cooling", async () => {
    const { upstreamA, upstreamB, ask, daemon, logLines } = await twoRelays({
      modelsDev: { "kimi-k2": { context: 200_000 } },
      catalogB: { "kimi-k2": { context: 1_000_000 } },
    });
    upstreamA.respond = (_request, res) =>
      failWith(res, { status: 400, message: "prompt is too long: 210000 tokens > 200000" });

    const response = await ask();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(await response.text()).toContain("from B");
    expect(upstreamA.requests).toHaveLength(1);
    expect(upstreamB.requests).toHaveLength(1);
    expect(switchedLog(logLines)).toMatchObject({
      from: "Relay A",
      to: "Relay B",
      model: "kimi-k2",
      failure: "too_long",
      status: 400,
      until: null,
    });
    const client = await connectTo(daemon);
    expect(await cooldownOf(client, "ep_a")).toBeNull();
    expect(await cooldownOf(client, "ep_b")).toBeNull();
  });

  test("with no larger known window after it, the agent is told it is too long and the next endpoint is not asked", async () => {
    const { upstreamA, upstreamB, ask } = await twoRelays({
      modelsDev: { "kimi-k2": { context: 200_000 } },
    });
    upstreamA.respond = (_request, res) =>
      failWith(res, { status: 400, message: "prompt is too long: 210000 tokens > 200000" });

    const response = await ask();

    expect(response.status).toBe(400);
    expect(upstreamB.requests).toHaveLength(0);
    expect(await response.json()).toEqual({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Relay A: prompt is too long: 210000 tokens > 200000",
      },
    });
  });

  test("told too long after the keepalive began, each CLI gets the error in its stream with context_length_exceeded", async () => {
    const claude = await twoRelays({ keepAliveMs: 30 });
    const codex = await twoRelays({ keepAliveMs: 30 });
    const tooLong = (res: ServerResponse) =>
      failWith(res, { status: 400, message: "prompt is too long: 210000 tokens > 200000" });
    const releases: (() => void)[] = [];
    for (const relays of [claude, codex]) {
      const held = heldUpstream(() => {}, tooLong);
      relays.upstreamA.respond = held.respond;
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

    const message = "Relay A: prompt is too long: 210000 tokens > 200000";
    expect(claudeEvents.at(-1)).toEqual({
      type: "error",
      error: { type: "api_error", message, code: "context_length_exceeded" },
    });
    expect(codexEvents.at(-1)).toEqual({
      type: "response.failed",
      response: {
        object: "response",
        status: "failed",
        error: { code: "context_length_exceeded", message },
      },
    });
    expect(claude.upstreamB.requests).toHaveLength(0);
    expect(codex.upstreamB.requests).toHaveLength(0);
  });

  test("a 400 that says no reason, for a request past 1.2 times the window, reaches Claude Code as too long", async () => {
    const { upstreamA, upstreamB, ask, daemon } = await twoRelays({
      modelsDev: { "kimi-k2": { context: 4096 } },
    });
    upstreamA.respond = (_request, res) =>
      failWith(res, { status: 400, message: "Invalid request parameters" });

    const response = await ask({ messages: [{ role: "user", content: textOfTokens(5000) }] });

    expect(response.status).toBe(400);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(await response.json()).toEqual({
      type: "error",
      error: {
        type: "invalid_request_error",
        message:
          "Relay A: prompt is too long: about 5000 tokens, more than kimi-k2's context window of 4096 (Relay A answered 400: Invalid request parameters)",
      },
    });
    expect(upstreamA.requests).toHaveLength(1);
    expect(upstreamB.requests).toHaveLength(0);
    expect(await cooldownOf(await connectTo(daemon), "ep_a")).toBeNull();
  });

  test("the same 400 under 1.2 times the window is the endpoint's own error", async () => {
    const { upstreamA, ask } = await twoRelays({ modelsDev: { "kimi-k2": { context: 4096 } } });
    upstreamA.respond = (_request, res) =>
      failWith(res, { status: 400, message: "Invalid request parameters" });

    const response = await ask({ messages: [{ role: "user", content: textOfTokens(4500) }] });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      type: "error",
      error: { type: "api_error", message: "Relay A: Invalid request parameters" },
    });
  });

  test("a 400 that says no reason, for a request past 1.2 times the window, reaches Codex as context_length_exceeded", async () => {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid request parameters" } }));
    };
    const { gateway } = await start({
      upstreamA: upstream,
      modelsDev: { "gpt-5.5": { context: 4096 } },
    });

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({ model: "gpt-5.5", input: textOfTokens(5000), stream: false }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        message:
          "Relay A: prompt is too long: about 5000 tokens, more than gpt-5.5's context window of 4096 (Relay A answered 400: Invalid request parameters)",
        type: "invalid_request_error",
        code: "context_length_exceeded",
        param: null,
      },
    });
  });

  test("a relay's own cap on one request's input is taken as too long (magpie #2445)", async () => {
    const { upstreamA, upstreamB, ask, daemon } = await twoRelays();
    const capped = "Input token exceed the limit (request id: 2026…)";
    upstreamA.respond = (_request, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: capped, type: "invalid_request_error" } }));
    };

    const response = await ask();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      type: "error",
      error: { type: "invalid_request_error", message: `prompt is too long: Relay A: ${capped}` },
    });
    expect(upstreamB.requests).toHaveLength(0);
    expect(await cooldownOf(await connectTo(daemon), "ep_a")).toBeNull();
  });

  test("a relay's own cap reaches Codex as context_length_exceeded", async () => {
    const upstream = await startUpstream();
    const capped = "Input token exceed the limit (request id: 2026…)";
    upstream.respond = (_request, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: capped, type: "invalid_request_error" } }));
    };
    const { gateway } = await start({ upstreamA: upstream });

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({ model: "gpt-5.5", input: "hi", stream: false }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        message: `Relay A: ${capped}`,
        type: "invalid_request_error",
        code: "context_length_exceeded",
        param: null,
      },
    });
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

  /** A 先忙、B 接手第一轮（B 按 `answer` 回），A 恢复后问第二轮：返回第二轮由谁答。 */
  async function secondTurnAfterB(input: {
    answer: (res: ServerResponse) => void;
    baseUrlsB?: (upstreamB: FakeUpstream) => { format: string; url: string }[];
  }) {
    const { upstreamA, upstreamB, ask, daemon, endpointsDir } = await twoRelays();
    if (input.baseUrlsB) await setBaseUrls(endpointsDir, { ep_b: input.baseUrlsB(upstreamB) });
    const client = await connectTo(daemon);
    upstreamA.respond = (_request, res) => failWith(res, { status: 503, message: "busy" });
    upstreamB.respond = (_request, res) => input.answer(res);
    const first = await ask({ messages: [userSays("hi")] });
    expect(first.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    await first.text();
    await client.apiEndpointSetEndpointState({ endpointId: "ep_a", clearCooldown: true });
    upstreamA.respond = (_request, res) => streamReply(res, { text: "from A" });

    const newTurn = await ask({
      messages: [userSays("hi"), { role: "assistant", content: "hello" }, userSays("more")],
    });
    await newTurn.text();
    return newTurn.headers.get("x-osuna-api-endpoint");
  }

  const chatOnly = (upstream: FakeUpstream) => [
    { format: "openai_chat", url: `${upstream.url}/v1` },
  ];

  test("a first turn that only wrote the cache: the next turn stays to read it (pass-through)", async () => {
    const answeredBy = await secondTurnAfterB({
      answer: (res) => streamReply(res, { text: "from B", cacheWrite: 3000 }),
    });
    expect(answeredBy).toBe("relay-b");
  });

  test("a first turn that only wrote the cache: the next turn stays to read it (translated)", async () => {
    const answeredBy = await secondTurnAfterB({
      baseUrlsB: chatOnly,
      answer: (res) =>
        chatReply(res, {
          prompt_tokens: 3000,
          completion_tokens: 2,
          prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 3000 },
        }),
    });
    expect(answeredBy).toBe("relay-b");
  });

  test("a vendor that caches without saying so: the next turn stays where its prompt went", async () => {
    const answeredBy = await secondTurnAfterB({
      baseUrlsB: chatOnly,
      answer: (res) => chatReply(res, { prompt_tokens: 3000, completion_tokens: 2 }),
    });
    expect(answeredBy).toBe("relay-b");
  });

  test("a prompt too small for a vendor to cache still goes back to the user's choice", async () => {
    const answeredBy = await secondTurnAfterB({
      baseUrlsB: chatOnly,
      answer: (res) => chatReply(res, { prompt_tokens: 600, completion_tokens: 2 }),
    });
    expect(answeredBy).toBe("relay-a");
  });
});

/** 假 Chat 上游的流式回复：说一句「from B」，以 stop 结束，最后报给的用量。 */
function chatReply(res: ServerResponse, usage: Record<string, unknown>): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const said = { id: "c1", choices: [{ index: 0, delta: { content: "from B" } }] };
  const stop = { id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
  for (const chunk of [said, stop, { id: "c1", choices: [], usage }]) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.end("data: [DONE]\n\n");
}

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

  // 接口管理好用性工单 17：每条带模型资料（magpie gateway.go 的 modelObject），按模型设置改过；已禁用的不列。
  test("/v1/models gives each model's facts as the model settings leave them, and lists no disabled model", async () => {
    const { gateway, endpointsDir } = await start({
      modelsA: ["kimi-k2", "gpt-5.5", "qwen3-coder"],
      modelsDev: {
        "kimi-k2": {
          name: "Kimi K2",
          context: 262_144,
          output: 32_768,
          efforts: ["low", "medium", "high"],
          images: false,
        },
        "glm-4.6": { name: "GLM-4.6", context: 200_000, output: 131_072, images: false },
        "qwen3-coder": { name: "Qwen3 Coder", context: 262_144 },
      },
      catalogB: { "glm-4.6": { efforts: ["low", "high"] } },
    });
    const endpointsPath = path.join(endpointsDir, "endpoints.json");
    const file = JSON.parse(await readFile(endpointsPath, "utf8")) as {
      endpoints: { id: string; modelSettings?: unknown }[];
      disabledModels?: string[];
    };
    // 回复上限手填得比窗口大：照 magpie PublishedOutput 收在窗口以内。
    file.endpoints[0].modelSettings = {
      models: { "kimi-k2": { name: "My Kimi", output: 500_000, efforts: ["high"], images: true } },
    };
    file.disabledModels = ["qwen3-*"];
    await writeFile(endpointsPath, JSON.stringify(file));

    const models = await fetch(`${gateway}/v1/models`, {
      headers: { authorization: `Bearer ${CODEX_TOKEN}` },
    });

    expect(models.status).toBe(200);
    const list = (await models.json()) as { data: Record<string, unknown>[] };
    const shared = { object: "model", type: "model", created: 0 };
    expect(list.data.map(({ created_at: _at, owned_by: _by, ...model }) => model)).toEqual([
      {
        ...shared,
        id: "kimi-k2",
        display_name: "My Kimi",
        reasoning: true,
        supported_reasoning_levels: [{ effort: "high" }],
        context_window: 262_144,
        context_length: 262_144,
        max_input_tokens: 262_144,
        max_output_tokens: 262_144,
        modalities: { input: ["text", "image"] },
      },
      {
        ...shared,
        id: "gpt-5.5",
        display_name: "gpt-5.5",
        reasoning: false,
        supported_reasoning_levels: [],
      },
      {
        ...shared,
        id: "glm-4.6",
        display_name: "GLM-4.6",
        reasoning: true,
        supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
        context_window: 200_000,
        context_length: 200_000,
        max_input_tokens: 200_000,
        max_output_tokens: 131_072,
        modalities: { input: ["text"] },
      },
    ]);
  });

  // 照 magpie gateway.go 的 model：按 `标识/模型名` 或光秃秃的名字给一条，和列表里的那条一样。
  test("/v1/models/{id} answers a model by its endpoint's slug or by its bare name, as the list gives it", async () => {
    const { gateway } = await start({
      modelsDev: {
        "kimi-k2": { name: "Kimi K2", context: 262_144, output: 32_768, images: false },
      },
      catalogB: { "kimi-k2": { name: "Kimi on B", efforts: ["low", "high"] } },
    });
    const headers = { authorization: `Bearer ${CODEX_TOKEN}` };
    const listed = await fetch(`${gateway}/v1/models`, { headers });
    const list = (await listed.json()) as { data: { id: string }[] };

    const bare = await fetch(`${gateway}/v1/models/kimi-k2`, { headers });
    const onB = await fetch(`${gateway}/v1/models/relay-b/kimi-k2`, { headers });

    expect(bare.status).toBe(200);
    expect(await bare.json()).toEqual(list.data.find((model) => model.id === "kimi-k2"));
    expect(onB.status).toBe(200);
    const {
      created_at: _at,
      owned_by: _by,
      ...model
    } = (await onB.json()) as Record<string, unknown>;
    expect(model).toEqual({
      id: "relay-b/kimi-k2",
      object: "model",
      type: "model",
      created: 0,
      display_name: "Kimi on B",
      reasoning: true,
      supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
      context_window: 262_144,
      context_length: 262_144,
      max_input_tokens: 262_144,
      max_output_tokens: 32_768,
      modalities: { input: ["text"] },
    });
  });

  test("/v1/models/{id} answers 404 unknown model for a model it doesn't serve or one disabled", async () => {
    const { gateway, endpointsDir } = await start({
      modelsA: ["kimi-k2", "gpt-5.5", "qwen3-coder"],
    });
    const endpointsPath = path.join(endpointsDir, "endpoints.json");
    const file = JSON.parse(await readFile(endpointsPath, "utf8")) as {
      disabledModels?: string[];
    };
    file.disabledModels = ["qwen3-*"];
    await writeFile(endpointsPath, JSON.stringify(file));
    const headers = { authorization: `Bearer ${CODEX_TOKEN}` };

    const asked = ["nothing-here", "qwen3-coder", "relay-a/qwen3-coder", "%E0%A4%A"];
    const answers = await Promise.all(
      asked.map(async (id) => {
        const answer = await fetch(`${gateway}/v1/models/${id}`, { headers });
        return { status: answer.status, body: await answer.json() };
      }),
    );

    expect(answers).toEqual(
      asked.map((id) => ({
        status: 404,
        body: {
          error: {
            message: `unknown model ${id}`,
            type: "not_found_error",
            code: null,
            param: null,
          },
        },
      })),
    );
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
      // 直接起的 daemon 不经 paseo-daemon.ts：同样给假的进程表，绝不读真的。
      hostProcesses: new FakeHostProcesses(),
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

  /** Osuna 的 Codex 服务商表，照追加时的写法。 */
  function codexTable(port: number, token: string): string {
    return `[model_providers.osuna_api_endpoint]
name = "Osuna"
base_url = "http://127.0.0.1:${port}/api-endpoint-gateway/v1"
wire_api = "responses"
experimental_bearer_token = "${token}"
`;
  }

  test("Codex's table stays when its switch goes off, a restart on another port points it there, and its conversations are served", async () => {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => answerResponsesWhole(res);
    const home = await prepareHome({
      "endpoints.json": {
        endpoints: [
          storedEndpoint({
            id: "ep_a",
            slug: "relay-a",
            name: "Relay A",
            baseUrls: [{ format: "openai_responses", url: `${upstream.url}/v1` }],
            models: ["kimi-k2"],
          }),
        ],
        agents: {
          claude: { enabled: false, defaultModelId: null },
          codex: { enabled: true, defaultModelId: "kimi-k2" },
        },
      },
      "keys.json": { keys: { ep_a: KEY_A } },
    });
    const first = await createTestPaseoDaemon({
      paseoHomeRoot: home.root,
      cleanup: false,
      apiEndpoints: apiEndpointsConfig(home),
    });
    const client = await connect(`ws://127.0.0.1:${first.port}/ws`);
    const token = (await tokens(home)).codex!;

    expect(
      (await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: false })).error,
    ).toBeNull();
    expect(await readFile(home.configPath, "utf8")).toBe(
      `${USER_CONFIG}\n${codexTable(first.port, token)}`,
    );
    await client.close();
    await first.close();

    const second = await createTestPaseoDaemon({
      paseoHomeRoot: home.root,
      listenPort: await freePort(first.port),
      apiEndpoints: apiEndpointsConfig(home),
    });
    daemons.push(second);

    expect(await readFile(home.configPath, "utf8")).toBe(
      `${USER_CONFIG}\n${codexTable(second.port, token)}`,
    );
    expect((await tokens(home)).codex).toBe(token);
    // 记在 Osuna 服务商名下的对话续上时，Codex 按这张表带着口令发来。
    const resumed = await fetch(
      `http://127.0.0.1:${second.port}/api-endpoint-gateway/v1/responses`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "kimi-k2", input: "hi", stream: false }),
      },
    );
    expect(resumed.status).toBe(200);
    expect(upstream.requests).toHaveLength(1);
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
      env: {
        ANTHROPIC_BASE_URL: gateway,
        ANTHROPIC_AUTH_TOKEN: claude,
        ANTHROPIC_API_KEY: "",
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: "272000",
        CLAUDE_CODE_AUTO_MODE_SERVER: "0",
      },
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

  test("the dedicated table an older version left behind on Official is pointed at the gateway on start and its key file removed", async () => {
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

    const { codex } = await tokens(home);
    expect(codex).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await readFile(home.configPath, "utf8")).toBe(
      `${USER_CONFIG}\n${codexTable(daemon.port, codex!)}`,
    );
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

/** 假 Chat 上游的流式回复：按给的片说一段文字，以 stop 结束。 */
function chatSays(res: ServerResponse, pieces: string[]): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const content of pieces) {
    const chunk = { id: "c1", choices: [{ index: 0, delta: { content }, finish_reason: null }] };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  const stop = { id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
  res.write(`data: ${JSON.stringify(stop)}\n\n`);
  res.end("data: [DONE]\n\n");
}

/** Codex 读到的回答文字：流里的 output_text.delta，或整份回复 output 里的文字。 */
function codexText(input: { body: string; stream: boolean }): string {
  if (input.stream) {
    const events = sseData(input.body) as Record<string, unknown>[];
    return events
      .filter((event) => event.type === "response.output_text.delta")
      .map((event) => String(event.delta))
      .join("");
  }
  const output = (JSON.parse(input.body) as { output: { content?: { text: string }[] }[] }).output;
  return output.flatMap((item) => (item.content ?? []).map((part) => part.text)).join("");
}

const CALENDAR_SCHEMA = {
  type: "object",
  properties: {
    name: { title: "Name", type: "string" },
    date: { title: "Date", type: "string" },
    participants: { items: { type: "string" }, title: "Participants", type: "array" },
  },
  required: ["name", "date", "participants"],
  title: "CalendarEvent",
  additionalProperties: false,
};
const CALENDAR_ANSWER = '{"name":"Science Fair","date":"Friday","participants":["Alice","Bob"]}';
const FENCED_CALENDAR = `\`\`\`json\n${CALENDAR_ANSWER}\n\`\`\``;

/** magpie 的 fencedChat：代码块被切在几片之间。 */
const FENCED_PIECES = [
  FENCED_CALENDAR.slice(0, 2),
  FENCED_CALENDAR.slice(2, 9),
  FENCED_CALENDAR.slice(9, -2),
  FENCED_CALENDAR.slice(-2),
];

describe("the model's output changed in two places, as magpie does", () => {
  test.each([
    {
      name: "json_schema",
      format: { type: "json_schema", strict: true, name: "CalendarEvent", schema: CALENDAR_SCHEMA },
      want: CALENDAR_ANSWER,
    },
    { name: "json_object", format: { type: "json_object" }, want: CALENDAR_ANSWER },
    // 要的是普通文字：模型怎么说就怎么给。
    { name: "no format", format: null, want: FENCED_CALENDAR },
  ])(
    "Codex asking for $name gets a fenced answer as $want, streamed and whole",
    async ({ format, want }) => {
      const chat = await startUpstream();
      chat.respond = (_request, res) => chatSays(res, FENCED_PIECES);
      const { gateway } = await start({ chatUpstream: chat });
      const ask = async (stream: boolean) => {
        const body = {
          model: "qwen3-coder",
          input: "Alice and Bob are going to a science fair on Friday.",
          stream,
          ...(format ? { text: { format } } : {}),
        };
        const response = await fetch(`${gateway}/v1/responses`, codexRequest(body));
        expect(response.status).toBe(200);
        return codexText({ body: await response.text(), stream });
      };

      expect(await ask(true)).toBe(want);
      expect(await ask(false)).toBe(want);
    },
  );

  test("Claude Code gets a Hermes call a Chat model wrote into its text as a tool_use, streamed", async () => {
    const chat = await startUpstream();
    chat.respond = (_request, res) =>
      chatSays(res, [
        "我先看看目录。\n\n<tool",
        '_call>{"name":"Bash","arguments":{"command":"ls -la"}}',
        "</tool_call>",
      ]);
    const { gateway } = await start({ chatUpstream: chat });

    const response = await fetch(`${gateway}/v1/messages`, claudeRequest(claudeConversation(true)));

    expect(response.status).toBe(200);
    expect(sseData(await response.text()).slice(1)).toEqual([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "我先看看目录。\n\n" },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: expect.stringMatching(/^call_text_/),
          name: "Bash",
          input: {},
        },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"command":"ls -la"}' },
      },
      { type: "content_block_stop", index: 1 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
      { type: "message_stop" },
    ]);
  });

  test("Claude Code gets a DeepSeek DSML call as a tool_use in a whole reply", async () => {
    const chat = await startUpstream();
    chat.respond = (_request, res) =>
      chatSays(res, [
        'Running it.\n\n<｜DSML｜function_calls>\n<｜DSML｜invoke name="Bash">\n<｜DSML｜parameter name="command" string="true">ls -la</｜DSML｜parameter>\n',
        '<｜DSML｜parameter name="timeout" string="false">30</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜function_calls>',
      ]);
    const { gateway } = await start({ chatUpstream: chat });

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest(claudeConversation(false)),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "msg_c1",
      type: "message",
      role: "assistant",
      model: "deepseek-v3",
      content: [
        { type: "text", text: "Running it.\n\n" },
        {
          type: "tool_use",
          id: expect.stringMatching(/^call_text_/),
          name: "Bash",
          input: { command: "ls -la", timeout: 30 },
        },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });
  });

  test("Codex gets GLM's arg_key call of its custom exec tool as a custom_tool_call, streamed", async () => {
    const glmExec =
      '<tool_call>exec\n<arg_key>input</arg_key>\n<arg_value>const r = await tools.shell({cmd: "ls"});\nconsole.log(r);</arg_value>\n</tool_call>';
    const said = `Let me look.\n\n${glmExec}`;
    const chat = await startUpstream();
    chat.respond = (_request, res) =>
      chatSays(res, [said.slice(0, 20), said.slice(20, 31), said.slice(31, 52), said.slice(52)]);
    const { gateway } = await start({ chatUpstream: chat });

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({
        model: "qwen3-coder",
        stream: true,
        input: "list the files",
        tools: [
          {
            type: "custom",
            name: "exec",
            description: "Run JavaScript.",
            format: { type: "grammar", syntax: "lark", definition: "start: /[\\s\\S]+/" },
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(completedResponse(await response.text()).output).toEqual([
      {
        id: expect.stringMatching(/^msg_/),
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Let me look.\n\n", annotations: [], logprobs: [] }],
        phase: "commentary",
      },
      {
        id: expect.stringMatching(/^ctc_/),
        type: "custom_tool_call",
        status: "completed",
        call_id: expect.stringMatching(/^call_text_/),
        name: "exec",
        input: 'const r = await tools.shell({cmd: "ls"});\nconsole.log(r);',
      },
    ]);
  });

  test("with no tools in the request, the same text reaches Claude Code as it was written", async () => {
    const block = '<tool_call>{"name":"Bash","arguments":{"command":"ls"}}</tool_call>';
    const chat = await startUpstream();
    chat.respond = (_request, res) => chatSays(res, [block]);
    const { gateway } = await start({ chatUpstream: chat });
    const { tools: _tools, tool_choice: _choice, ...toolless } = claudeConversation(false);

    const response = await fetch(`${gateway}/v1/messages`, claudeRequest(toolless));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "msg_c1",
      type: "message",
      role: "assistant",
      model: "deepseek-v3",
      content: [{ type: "text", text: block }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });
  });
});

/** OpenCode Zen 说模型已下线时的 410（magpie retired_test.go 的 zenDeprecated，模型名换成这里的）。 */
function retiredReply(res: ServerResponse, model: string) {
  res.writeHead(410, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      type: "error",
      error: { type: "ModelDeprecated", message: `Model ${model} has been deprecated.` },
      metadata: { model },
    }),
  );
}

describe("a model its vendor says is retired", () => {
  const WEEK = 7 * 24 * 60 * 60 * 1000;

  /** 给 Agent 选模型的四处列表：中转站清单、Codex 目录、Claude 的 modelPicker、快照里 Claude 的分组。 */
  async function lists(harness: Harness) {
    const models = await fetch(`${harness.gateway}/v1/models`, {
      headers: { authorization: `Bearer ${CLAUDE_TOKEN}` },
    });
    const listed = (await models.json()) as { data: { id: string }[] };
    const root = path.dirname(path.dirname(harness.endpointsDir));
    const catalog = JSON.parse(
      await readFile(path.join(harness.endpointsDir, "codex-models.json"), "utf8"),
    ) as { models: { slug: string }[] };
    const settings = JSON.parse(
      await readFile(path.join(root, "claude", "settings.json"), "utf8"),
    ) as { model?: string; modelPicker?: { options: { model: string }[] } };
    const client = await connectTo(harness.daemon);
    const snapshot = await client.getProvidersSnapshot();
    const claude = snapshot.entries.find((entry) => entry.provider === "claude");
    return {
      gateway: listed.data.map((model) => model.id),
      codex: catalog.models.map((model) => model.slug),
      claudePicker: (settings.modelPicker?.options ?? []).map((option) => option.model),
      claudeModel: settings.model,
      snapshot: (claude?.apiEndpointModelGroups ?? []).map((group) =>
        group.models.map((model) => model.id),
      ),
    };
  }

  const ALL_LISTED = {
    gateway: ["kimi-k2", "gpt-5.5", "glm-4.6"],
    codex: [
      "kimi-k2",
      "gpt-5.5",
      "glm-4.6",
      "relay-a/kimi-k2",
      "relay-a/gpt-5.5",
      "relay-b/kimi-k2",
      "relay-b/glm-4.6",
    ],
    claudePicker: ["relay-a/kimi-k2", "relay-a/gpt-5.5", "relay-b/kimi-k2", "relay-b/glm-4.6"],
    claudeModel: "kimi-k2",
    snapshot: [
      ["relay-a/kimi-k2", "relay-a/gpt-5.5"],
      ["relay-b/kimi-k2", "relay-b/glm-4.6"],
    ],
  };

  // 光秃秃的名字按创建顺序去重：A 的 kimi-k2 不在了，kimi-k2 由 B 带出，排到 gpt-5.5 后面。
  const A_KIMI_RETIRED = {
    ...ALL_LISTED,
    gateway: ["gpt-5.5", "kimi-k2", "glm-4.6"],
    codex: [
      "gpt-5.5",
      "kimi-k2",
      "glm-4.6",
      "relay-a/gpt-5.5",
      "relay-b/kimi-k2",
      "relay-b/glm-4.6",
    ],
    claudePicker: ["relay-a/gpt-5.5", "relay-b/kimi-k2", "relay-b/glm-4.6"],
    snapshot: [["relay-a/gpt-5.5"], ["relay-b/kimi-k2", "relay-b/glm-4.6"]],
  };

  test("after a 410 that endpoint's entry leaves every list, and the other endpoint's stays", async () => {
    const { upstreamA, upstreamB, ask, ...harness } = await twoRelays();
    upstreamA.respond = (_request, res) => retiredReply(res, "kimi-k2");
    const endpointsBefore = await readFile(
      path.join(harness.endpointsDir, "endpoints.json"),
      "utf8",
    );
    await expect.poll(() => lists(harness), { timeout: 10_000 }).toEqual(ALL_LISTED);

    const response = await ask();

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("from B");
    await expect.poll(() => lists(harness), { timeout: 10_000 }).toEqual(A_KIMI_RETIRED);
    // 接口自己的已选模型与各 Agent 的默认模型都不变。
    expect(await readFile(path.join(harness.endpointsDir, "endpoints.json"), "utf8")).toBe(
      endpointsBefore,
    );
    const retired = harness.logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.msg === "API endpoint model retired");
    expect(retired).toMatchObject({ endpoint: "Relay A", model: "kimi-k2" });
    expect(upstreamB.requests).toHaveLength(1);
  });

  test("a bare model name skips it; with no other endpoint the CLI is told the model is not found", async () => {
    const upstreamA = await startUpstream();
    upstreamA.respond = (_request, res) => retiredReply(res, "gpt-5.5");
    const harness = await start({ upstreamA, modelsA: ["kimi-k2", "gpt-5.5", "gpt-5.5-mini"] });
    const askFor = (model: string) =>
      fetch(
        `${harness.gateway}/v1/messages`,
        claudeRequest({ model, max_tokens: 32, messages: [{ role: "user", content: "hi" }] }),
      );

    const first = await askFor("gpt-5.5");
    expect(first.status).toBe(410);
    expect(await first.json()).toMatchObject({
      error: { message: "Relay A: Model gpt-5.5 has been deprecated." },
    });

    const second = await askFor("gpt-5.5");

    expect(second.status).toBe(404);
    expect(await second.json()).toMatchObject({
      error: {
        message: 'No enabled API endpoint offers the model "gpt-5.5"; did you mean gpt-5.5-mini?',
      },
    });
    expect(upstreamA.requests).toHaveLength(1);
  });

  test("a request naming that endpoint is still sent, and an answer puts the entry back", async () => {
    const upstreamA = await startUpstream();
    upstreamA.respond = (_request, res) => retiredReply(res, "gpt-5.5");
    const harness = await start({ upstreamA });
    const askFor = (model: string) =>
      fetch(
        `${harness.gateway}/v1/messages`,
        claudeRequest({ model, max_tokens: 32, messages: [{ role: "user", content: "hi" }] }),
      );
    await (await askFor("gpt-5.5")).text();
    await expect
      .poll(async () => (await lists(harness)).claudePicker, { timeout: 10_000 })
      .toEqual(["relay-a/kimi-k2", "relay-b/kimi-k2", "relay-b/glm-4.6"]);

    // 厂商还说已下线：它的回答交给 CLI。
    const refused = await askFor("relay-a/gpt-5.5");
    expect(refused.status).toBe(410);
    await refused.text();
    upstreamA.respond = (_request, res) => streamReply(res, { text: "from A" });
    const answered = await askFor("relay-a/gpt-5.5");

    expect(answered.status).toBe(200);
    expect(upstreamA.requests.map(receivedModel)).toEqual(["gpt-5.5", "gpt-5.5", "gpt-5.5"]);
    await expect.poll(() => lists(harness), { timeout: 10_000 }).toEqual(ALL_LISTED);
    const back = harness.logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.msg === "API endpoint model back in service");
    expect(back).toMatchObject({ endpoint: "Relay A", model: "gpt-5.5", why: "answered" });
  });

  test("the record survives a restart, and a week later the files get the entry back with no one asking", async () => {
    let now = Date.parse("2026-10-17T00:00:00.000Z");
    // 最近排上的到期处理；属性而不是 let，免得 TS 把闭包里改过的变量收窄成 null。
    const expiry: { due: (() => void) | null } = { due: null };
    const timers = {
      schedule: (handler: () => void) => {
        expiry.due = handler;
        return () => {
          expiry.due = null;
        };
      },
    };
    const upstreamA = await startUpstream();
    const upstreamB = await startUpstream();
    upstreamA.respond = (_request, res) => retiredReply(res, "kimi-k2");
    upstreamB.respond = (_request, res) => streamReply(res, { text: "from B" });
    const harness = await start({
      upstreamA,
      upstreamB,
      retiredModelsNow: () => now,
      retiredModelsTimers: timers,
    });
    const askKimi = (gateway: string) =>
      fetch(
        `${gateway}/v1/messages`,
        claudeRequest({
          model: "kimi-k2",
          max_tokens: 32,
          messages: [{ role: "user", content: "hi" }],
        }),
      );
    await (await askKimi(harness.gateway)).text();
    upstreamA.respond = (_request, res) => streamReply(res, { text: "from A" });

    // 冷却只在内存里，重启后没有了；还绕开 A 的只有已下线记录。
    const next = await harness.restart();
    const restarted = { ...harness, ...next };
    const skipped = await askKimi(next.gateway);
    expect(await skipped.text()).toContain("from B");
    expect(upstreamA.requests).toHaveLength(1);
    await expect.poll(() => lists(restarted), { timeout: 10_000 }).toEqual(A_KIMI_RETIRED);

    // 一周到了，没有请求、也没人读列表：到期定时器自己重写 Codex 目录与 Claude 的 modelPicker。
    now += WEEK;
    expiry.due?.();
    const root = path.dirname(path.dirname(harness.endpointsDir));
    async function files() {
      const catalog = JSON.parse(
        await readFile(path.join(harness.endpointsDir, "codex-models.json"), "utf8"),
      ) as { models: { slug: string }[] };
      const settings = JSON.parse(
        await readFile(path.join(root, "claude", "settings.json"), "utf8"),
      ) as { modelPicker?: { options: { model: string }[] } };
      return {
        codex: catalog.models.map((model) => model.slug),
        claudePicker: (settings.modelPicker?.options ?? []).map((option) => option.model),
      };
    }
    await expect
      .poll(files, { timeout: 10_000 })
      .toEqual({ codex: ALL_LISTED.codex, claudePicker: ALL_LISTED.claudePicker });

    const asked = await askKimi(next.gateway);
    expect(await asked.text()).toContain("from A");
    expect(upstreamA.requests).toHaveLength(2);
    expect(await lists(restarted)).toEqual(ALL_LISTED);
  });

  test("an unreadable record file counts as empty and the gateway works as usual", async () => {
    const { upstreamA, endpointsDir, restart } = await twoRelays();
    await writeFile(path.join(endpointsDir, "retired-models.json"), "{ not json");
    upstreamA.respond = (_request, res) => streamReply(res, { text: "from A" });
    const { gateway } = await restart();

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({
        model: "kimi-k2",
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("from A");
  });
});

// @types/node 还停在 20，没有 zstd 的类型；跑测试的 Node 自带 zlib.zstdCompressSync。
interface ZlibWithZstd {
  gzipSync: typeof zlib.gzipSync;
  zstdCompressSync?: (data: Buffer) => Buffer;
}
const zlibWithZstd: ZlibWithZstd = zlib;

type BodyEncoding = "zstd" | "gzip";

function compressed(input: { body: string; encoding: BodyEncoding }): Buffer {
  const data = Buffer.from(input.body);
  if (input.encoding === "gzip") return zlibWithZstd.gzipSync(data);
  const zstd = zlibWithZstd.zstdCompressSync;
  if (!zstd) throw new Error("this Node.js has no zstd");
  return zstd(data);
}

/** 不带 User-Agent 的 POST（fetch 总会写上自己的），回状态码与回复原文。 */
function postWithoutUserAgent(input: {
  url: string;
  headers: Record<string, string>;
  body: string;
}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const sent = httpRequest(input.url, { method: "POST", headers: input.headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () =>
        resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString() }),
      );
    });
    sent.on("error", reject);
    sent.end(input.body);
  });
}

describe("connections, compressed bodies and the User-Agent", () => {
  const KIMI_BODY = JSON.stringify({
    model: "kimi-k2",
    max_tokens: 10,
    thinking: { type: "enabled", budget_tokens: 1024 },
    messages: [{ role: "user", content: "hi" }],
  });
  const DEEPSEEK_BODY = JSON.stringify({
    model: "deepseek-v3",
    max_tokens: 10,
    messages: [{ role: "user", content: "hi" }],
  });
  // 翻成 Chat 后上游收到的：与 Claude Code 发来的是同一段对话。
  const DEEPSEEK_AS_CHAT = {
    model: "deepseek-v3",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 10,
  };

  test("a kept-alive connection the endpoint dropped is asked again at once on a new one, with no cooldown", async () => {
    const upstreamA = await startUpstream();
    const upstreamB = await startUpstream();
    const { gateway, daemon } = await start({ upstreamA, upstreamB });
    const answerOk = upstreamA.respond;
    // 第二个请求落在第一个留下的连接上：上游一个字节不回就关掉它。
    upstreamA.respond = (request, res) => {
      if (upstreamA.requests.length === 2) res.socket?.destroy();
      else answerOk(request, res);
    };

    const first = await fetch(`${gateway}/v1/messages`, claudeRequest(KIMI_BODY));
    await first.text();
    const second = await fetch(`${gateway}/v1/messages`, claudeRequest(KIMI_BODY));

    expect(second.status).toBe(200);
    expect(second.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(await second.json()).toEqual({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    expect(upstreamA.requests).toHaveLength(3);
    expect(upstreamB.requests).toHaveLength(0);
    expect(await cooldownOf(await connectTo(daemon), "ep_a")).toBeNull();
  });

  test("a new connection the endpoint dropped is not asked again there: it fails and the next endpoint answers", async () => {
    const upstreamA = await startUpstream();
    const upstreamB = await startUpstream();
    const { gateway, daemon } = await start({ upstreamA, upstreamB });
    upstreamA.respond = (_request, res) => res.socket?.destroy();

    const response = await fetch(`${gateway}/v1/messages`, claudeRequest(KIMI_BODY));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(upstreamA.requests).toHaveLength(1);
    expect(upstreamB.requests).toHaveLength(1);
    expect(await cooldownOf(await connectTo(daemon), "ep_a")).toMatchObject({
      state: "cooling_down",
    });
  });

  test("a corrupt gzip body is refused with 400, logged, and no endpoint is asked", async () => {
    const upstream = await startUpstream();
    const { gateway, logLines } = await start({ upstreamA: upstream });
    const init = claudeRequest("");

    const response = await fetch(`${gateway}/v1/messages`, {
      ...init,
      headers: { ...init.headers, "content-encoding": "gzip" },
      body: Buffer.from("not gzip at all"),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "The request body is not valid gzip data",
      },
    });
    expect(upstream.requests).toHaveLength(0);
    const warned = logLines
      .map((line) => JSON.parse(line) as { msg: string; encoding?: string; level: number })
      .filter((line) => line.msg === "API endpoint gateway could not decompress a request body")
      .map((line) => ({ level: line.level, encoding: line.encoding }));
    expect(warned).toEqual([{ level: 40, encoding: "gzip" }]);
  });

  test.each<BodyEncoding>(["zstd", "gzip"])(
    "a %s body passed through reaches the endpoint decompressed, without Content-Encoding",
    async (encoding) => {
      const upstream = await startUpstream();
      const { gateway } = await start({ upstreamA: upstream });
      const init = claudeRequest("");

      const response = await fetch(`${gateway}/v1/messages`, {
        ...init,
        headers: { ...init.headers, "content-encoding": encoding },
        body: compressed({ body: KIMI_BODY, encoding }),
      });

      expect(response.status).toBe(200);
      const received = upstream.requests[0]!;
      expect(received.body.toString()).toBe(KIMI_BODY);
      expect(received.headers["content-encoding"]).toBeUndefined();
      expect(received.headers["content-length"]).toBe(String(Buffer.byteLength(KIMI_BODY)));
    },
  );

  test.each<BodyEncoding>(["zstd", "gzip"])(
    "a %s body translated reaches the endpoint as the same conversation, without Content-Encoding",
    async (encoding) => {
      const chat = await startUpstream();
      chat.respond = (_request, res) => chatSays(res, ["ok"]);
      const { gateway } = await start({ chatUpstream: chat });
      const init = claudeRequest("");

      const response = await fetch(`${gateway}/v1/messages`, {
        ...init,
        headers: { ...init.headers, "content-encoding": encoding },
        body: compressed({ body: DEEPSEEK_BODY, encoding }),
      });

      expect(response.status).toBe(200);
      const received = chat.requests[0]!;
      expect(JSON.parse(received.body.toString())).toEqual(DEEPSEEK_AS_CHAT);
      expect(received.headers["content-encoding"]).toBeUndefined();
    },
  );

  test("a body in another encoding is refused with 415 and no endpoint is asked", async () => {
    const upstream = await startUpstream();
    const { gateway } = await start({ upstreamA: upstream });
    const init = claudeRequest("");

    const response = await fetch(`${gateway}/v1/messages`, {
      ...init,
      headers: { ...init.headers, "content-encoding": "br" },
      body: zlib.brotliCompressSync(Buffer.from(KIMI_BODY)),
    });

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      type: "error",
      error: {
        type: "invalid_request_error",
        message:
          'The API endpoint gateway cannot read a "br" request body; send it as identity, gzip or zstd',
      },
    });
    expect(upstream.requests).toHaveLength(0);
  });

  test("a body over the limit once decompressed is refused with 413 that names the gateway and /compact", async () => {
    const upstream = await startUpstream();
    const { gateway } = await start({ upstreamA: upstream, bodyLimitBytes: 1024 * 1024 });
    const huge = JSON.stringify({
      model: "kimi-k2",
      max_tokens: 10,
      messages: [{ role: "user", content: "x".repeat(1024 * 1024) }],
    });
    const init = claudeRequest("");

    const response = await fetch(`${gateway}/v1/messages`, {
      ...init,
      headers: { ...init.headers, "content-encoding": "gzip" },
      body: compressed({ body: huge, encoding: "gzip" }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      type: "error",
      error: {
        type: "request_too_large",
        message:
          "The request body is over the API endpoint gateway's limit of 1 MB (decompressed); no API endpoint was asked. " +
          "This is the gateway's limit, not the model's context: run /compact to shorten the conversation, or start a new one.",
      },
    });
    expect(upstream.requests).toHaveLength(0);
  });

  test("the CLI's own User-Agent reaches the endpoint, passed through and translated", async () => {
    const upstream = await startUpstream();
    const chat = await startUpstream();
    chat.respond = (_request, res) => chatSays(res, ["ok"]);
    const { gateway } = await start({ upstreamA: upstream, chatUpstream: chat });
    const userAgent = "claude-cli/2.1.30 (external, cli)";
    const ask = (body: string) => {
      const init = claudeRequest(body);
      return fetch(`${gateway}/v1/messages`, {
        ...init,
        headers: { ...init.headers, "user-agent": userAgent },
      });
    };

    const passed = await ask(KIMI_BODY);
    const translated = await ask(DEEPSEEK_BODY);

    expect([passed.status, translated.status]).toEqual([200, 200]);
    expect(upstream.requests[0]?.headers["user-agent"]).toBe(userAgent);
    expect(chat.requests[0]?.headers["user-agent"]).toBe(userAgent);
  });

  test("a CLI that sends no User-Agent goes out as Osuna/<version>, passed through and translated", async () => {
    const upstream = await startUpstream();
    const chat = await startUpstream();
    chat.respond = (_request, res) => chatSays(res, ["ok"]);
    const { gateway } = await start({
      upstreamA: upstream,
      chatUpstream: chat,
      daemonVersion: "0.11.2",
    });
    const headers = {
      authorization: `Bearer ${CLAUDE_TOKEN}`,
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    };

    const passed = await postWithoutUserAgent({
      url: `${gateway}/v1/messages`,
      headers,
      body: KIMI_BODY,
    });
    const translated = await postWithoutUserAgent({
      url: `${gateway}/v1/messages`,
      headers,
      body: DEEPSEEK_BODY,
    });

    expect([passed.status, translated.status]).toEqual([200, 200]);
    expect(upstream.requests[0]?.headers["user-agent"]).toBe("Osuna/0.11.2");
    expect(chat.requests[0]?.headers["user-agent"]).toBe("Osuna/0.11.2");
  });
});

/** endpointsDir 里以 name 开头的文件名，按字母排。 */
async function filesOf(endpointsDir: string, name: string): Promise<string[]> {
  const names = await readdir(endpointsDir);
  return names.filter((entry) => entry.startsWith(name)).sort();
}

/** 「坏文件已用 .bak 放回」那行警告；只取固定的几个字段，不带解析错误。 */
function putBackWarnings(logLines: string[]) {
  return gatewayLog(
    logLines,
    "API endpoint data file could not be parsed; its last good copy was put back",
  ).map(({ level, filePath, why, badPath, err }) => ({ level, filePath, why, badPath, err }));
}

const BAD_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/;

function claudeAskKimi(gateway: string): Promise<Response> {
  return fetch(
    `${gateway}/v1/messages`,
    claudeRequest({
      model: "kimi-k2",
      max_tokens: 16,
      messages: [{ role: "user", content: "hi" }],
    }),
  );
}

describe("a data file written badly is served from its last good copy (magpie lastgood)", () => {
  test("endpoints.json: the gateway routes by the .bak, the bad one is kept as .bad-<time> and a warning is logged", async () => {
    const upstreamA = await startUpstream();
    const upstreamB = await startUpstream();
    const { daemon, gateway, endpointsDir, logLines } = await start({ upstreamA, upstreamB });
    const endpointsPath = path.join(endpointsDir, "endpoints.json");
    const seeded = await readFile(endpointsPath, "utf8");
    const client = await connectTo(daemon);

    // 这次写入前的那份（A 开着）存成 .bak；写进去的这份把 A 关了。
    await client.apiEndpointSetEndpointState({ endpointId: "ep_a", enabled: false });
    const bakAfterWrite = await readFile(`${endpointsPath}.bak`, "utf8");
    await writeFile(endpointsPath, "{ not json");
    const response = await claudeAskKimi(gateway);

    expect(bakAfterWrite).toBe(seeded);
    expect(response.status).toBe(200);
    // 按 .bak 路由：A 还开着，kimi-k2 先到 A。
    expect([upstreamA.requests.length, upstreamB.requests.length]).toEqual([1, 0]);
    expect(await readFile(endpointsPath, "utf8")).toBe(seeded);
    const files = await filesOf(endpointsDir, "endpoints.json");
    expect(files).toHaveLength(3);
    // .bad-<时间> 按字母排在 .bak 前面。
    expect([files[0], files[2]]).toEqual(["endpoints.json", "endpoints.json.bak"]);
    const badName = files[1]!;
    expect(badName.replace("endpoints.json.bad-", "")).toMatch(BAD_STAMP);
    expect(await readFile(path.join(endpointsDir, badName), "utf8")).toBe("{ not json");
    expect(putBackWarnings(logLines)).toEqual([
      {
        level: 40,
        filePath: endpointsPath,
        why: "not_json",
        badPath: path.join(endpointsDir, badName),
      },
    ]);
  });

  test("keys.json: the request goes out with the key from the .bak", async () => {
    const upstreamA = await startUpstream();
    const { gateway, endpointsDir, logLines } = await start({ upstreamA });
    const keysPath = path.join(endpointsDir, "keys.json");
    const good = await readFile(keysPath, "utf8");
    await writeFile(`${keysPath}.bak`, good);
    await writeFile(keysPath, "");

    const response = await claudeAskKimi(gateway);

    expect(response.status).toBe(200);
    expect(upstreamA.requests[0]?.headers["x-api-key"]).toBe(KEY_A);
    expect(await readFile(keysPath, "utf8")).toBe(good);
    const files = await filesOf(endpointsDir, "keys.json");
    expect(files).toHaveLength(3);
    expect([files[0], files[2]]).toEqual(["keys.json", "keys.json.bak"]);
    expect(files[1]!.replace("keys.json.bad-", "")).toMatch(BAD_STAMP);
    expect(await readFile(path.join(endpointsDir, files[1]!), "utf8")).toBe("");
    expect(putBackWarnings(logLines)).toEqual([
      { level: 40, filePath: keysPath, why: "empty", badPath: path.join(endpointsDir, files[1]!) },
    ]);
  });

  test("gateway-tokens.json: the CLI's token is still accepted from the .bak", async () => {
    const upstreamA = await startUpstream();
    const { gateway, endpointsDir, logLines } = await start({ upstreamA });
    const tokensPath = path.join(endpointsDir, "gateway-tokens.json");
    const good = await readFile(tokensPath, "utf8");
    await writeFile(`${tokensPath}.bak`, good);
    await writeFile(tokensPath, '{"tokens": {"claude": ');

    const response = await claudeAskKimi(gateway);

    expect(response.status).toBe(200);
    expect(await readFile(tokensPath, "utf8")).toBe(good);
    const files = await filesOf(endpointsDir, "gateway-tokens.json");
    expect(files).toHaveLength(3);
    expect([files[0], files[2]]).toEqual(["gateway-tokens.json", "gateway-tokens.json.bak"]);
    expect(files[1]!.replace("gateway-tokens.json.bad-", "")).toMatch(BAD_STAMP);
    expect(await readFile(path.join(endpointsDir, files[1]!), "utf8")).toBe(
      '{"tokens": {"claude": ',
    );
    expect(putBackWarnings(logLines)).toEqual([
      {
        level: 40,
        filePath: tokensPath,
        why: "not_json",
        badPath: path.join(endpointsDir, files[1]!),
      },
    ]);
  });

  test("with the .bak bad too it is an error as before, and nothing is written or removed", async () => {
    const upstreamA = await startUpstream();
    const { gateway, endpointsDir } = await start({ upstreamA });
    const endpointsPath = path.join(endpointsDir, "endpoints.json");
    await writeFile(endpointsPath, "{ not json");
    await writeFile(`${endpointsPath}.bak`, "also not json");

    const response = await claudeAskKimi(gateway);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      type: "error",
      error: { type: "api_error", message: "The API endpoints file could not be parsed" },
    });
    expect(upstreamA.requests).toEqual([]);
    expect(await filesOf(endpointsDir, "endpoints.json")).toEqual([
      "endpoints.json",
      "endpoints.json.bak",
    ]);
    expect(await readFile(endpointsPath, "utf8")).toBe("{ not json");
    expect(await readFile(`${endpointsPath}.bak`, "utf8")).toBe("also not json");
  });

  test("a takeover record written badly is not read from a .bak: the change is refused as before", async () => {
    const { daemon, endpointsDir } = await start();
    const client = await connectTo(daemon);
    // 开着总开关时 daemon 已写好接管记录；把它写坏，旁边放一份读得懂的 .bak。
    const recordPath = path.join(endpointsDir, "takeover-claude.json");
    const good = await readFile(recordPath, "utf8");
    await writeFile(`${recordPath}.bak`, good);
    await writeFile(recordPath, "{ not json");

    const turnedOff = await client.apiEndpointSetAgentSettings({
      provider: "claude",
      enabled: false,
    });

    expect(turnedOff).toEqual({
      requestId: expect.any(String),
      provider: "claude",
      agent: { enabled: true, defaultModelId: "kimi-k2" },
      error: {
        code: "unknown",
        message: "Expected property name or '}' in JSON at position 2 (line 1 column 3)",
      },
    });
    expect(await readFile(recordPath, "utf8")).toBe("{ not json");
    expect(await readFile(`${recordPath}.bak`, "utf8")).toBe(good);
    expect(await filesOf(endpointsDir, "takeover-claude.json")).toEqual([
      "takeover-claude.json",
      "takeover-claude.json.bak",
    ]);
  });
});

/*
 * 按厂商的改写（工单 16，照 magpie grok_integral_test.go、grok_schema_test.go）：本机假上游的地址不是任何一家的官方地址，
 * 所以这里只有按模型名认的 Grok 会改；Kimi、MiniMax、DeepSeek 认官方地址的改写在 passthrough.test.ts 与 vendor-rewrites.test.ts。
 */

const GROK_ARGS_PIECES = ['{"cmd":"sleep 2.0","yield_time_ms":2500.', "0}"];
const GROK_WHOLE_ARGS = '{"cmd":"sleep 2.0","yield_time_ms":2500}';

/** Anthropic 流：Grok 调用一次工具，参数切在 `2500.` 之后。 */
function grokToolUseStream(pieces: string[]): string {
  const delta = (piece: string) =>
    `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(piece)}}}\n\n`;
  return (
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"grok-4.6","content":[],"usage":{"input_tokens":10,"output_tokens":1}}}\n\n' +
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"Bash","input":{}}}\n\n' +
    pieces.map(delta).join("") +
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n' +
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}\n\n' +
    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
  );
}

/** 整份 Responses 回复：Grok 调用一次工具。 */
function grokResponsesWhole(args: string) {
  return {
    id: "resp_1",
    object: "response",
    status: "completed",
    model: "grok-4.6",
    output: [
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "exec_command",
        arguments: args,
        status: "completed",
      },
    ],
    usage: { input_tokens: 5, output_tokens: 3 },
  };
}

/** Responses 流：Grok 调用一次工具，参数切在 `2500.` 之后。 */
function grokResponsesStream(res: ServerResponse): void {
  const args = GROK_ARGS_PIECES.join("");
  const call = { type: "function_call", id: "fc_1", call_id: "call_1", name: "exec_command" };
  const events = [
    { type: "response.created", response: { id: "resp_1", status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...call, arguments: "" } },
    ...GROK_ARGS_PIECES.map((delta) => ({
      type: "response.function_call_arguments.delta",
      item_id: "fc_1",
      output_index: 0,
      delta,
    })),
    {
      type: "response.function_call_arguments.done",
      item_id: "fc_1",
      output_index: 0,
      arguments: args,
    },
    { type: "response.output_item.done", output_index: 0, item: { ...call, arguments: args } },
    { type: "response.completed", response: grokResponsesWhole(args) },
  ];
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
}

// Claude Code 的一轮：工具 schema 里有 Kimi、DeepSeek、Grok 各自要改的写法，消息里有延后加载工具块。
const VENDOR_TURN = (model: string) =>
  `{"model":"${model}","max_tokens":32000,"stream":true,"thinking":{"type":"enabled","budget_tokens":2048},` +
  `"tools":[{"name":"Bash","input_schema":{"type":"object","properties":{"kind":{"enum":["text","icon"]},` +
  `"content":{"type":"string","pattern":"^[^\\\\0]*$"},"selector":{"type":"string","pattern":"^[^\\\\s[\\\\]]+$"}}}}],` +
  `"messages":[{"role":"user","content":"hi"},` +
  `{"role":"user","content":[{"type":"tool_addition","tool":{"type":"tool_reference","name":"Read"}}]}]}`;

describe("vendor rewrites, only for the four vendors", () => {
  test("Grok through a relay: Claude Code's tool pattern goes in Grok's spelling, and the call's 2500.0 comes back as 2500", async () => {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(grokToolUseStream(GROK_ARGS_PIECES));
    };
    const { gateway } = await start({ upstreamA: upstream, modelsA: ["grok-4.6"] });

    const response = await fetch(
      `${gateway}/v1/messages?beta=true`,
      claudeRequest(VENDOR_TURN("relay-a/grok-4.6")),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      grokToolUseStream(['{"cmd":"sleep 2.0","yield_time_ms":2500', "}"]),
    );
    expect(upstream.requests[0]!.body.toString()).toBe(
      VENDOR_TURN("grok-4.6").replace(`"^[^\\\\s[\\\\]]+$"`, `"^[^\\\\s\\\\[\\\\]]+$"`),
    );
  });

  test("Grok through a relay: Codex's whole reply passed through has its call's numbers whole", async () => {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => {
      const body = JSON.stringify(grokResponsesWhole(GROK_ARGS_PIECES.join("")));
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      });
      res.end(body);
    };
    const { gateway } = await start({ upstreamA: upstream, modelsA: ["grok-4.6"] });

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({ ...codexConversation("grok-4.6", false), stream: false }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(grokResponsesWhole(GROK_WHOLE_ARGS));
  });

  test("Grok translated: Claude Code gets a Responses-only endpoint's call with whole numbers", async () => {
    const responses = await startUpstream();
    responses.respond = (_request, res) => grokResponsesStream(res);
    const { gateway } = await start({ responsesUpstream: responses });

    const response = await fetch(
      `${gateway}/v1/messages?beta=true`,
      claudeRequest({ ...claudeConversation(true), model: "grok-4" }),
    );
    const text = await response.text();

    const usage = (input: number, output: number) => ({
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    expect(response.status).toBe(200);
    expect(sseData(text)).toEqual([
      {
        type: "message_start",
        message: {
          id: "msg_resp_1",
          type: "message",
          role: "assistant",
          model: "grok-4",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: usage(0, 0),
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "call_1", name: "exec_command", input: {} },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: GROK_WHOLE_ARGS },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: usage(5, 3),
      },
      { type: "message_stop" },
    ]);
  });

  test.each(["relay-a/kimi-k2", "relay-b/glm-4.6"])(
    "%s through a relay gets the request as Claude Code sent it, apart from the model",
    async (model) => {
      const upstream = await startUpstream();
      const { gateway } = await start({ upstreamA: upstream, upstreamB: upstream });

      const response = await fetch(
        `${gateway}/v1/messages?beta=true`,
        claudeRequest(VENDOR_TURN(model)),
      );

      expect(response.status).toBe(200);
      const sent = model.slice(model.indexOf("/") + 1);
      expect(upstream.requests[0]!.body.toString()).toBe(VENDOR_TURN(sent));
    },
  );
});

describe("what an endpoint answers is read for what it is (ticket 18)", () => {
  test("a translated stream the endpoint wrote in one go reaches the agent, streamed and whole", async () => {
    const chat = await startUpstream();
    chat.respond = (_request, res) => chatStreamInOneWrite(res);
    const { gateway } = await start({ chatUpstream: chat });

    const streamed = await fetch(
      `${gateway}/v1/messages?beta=true`,
      claudeRequest(claudeConversation(true)),
    );
    const whole = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({ ...claudeConversation(false), model: "relay-c/deepseek-v3" }),
    );

    expect(streamed.status).toBe(200);
    expect(sseData(await streamed.text())).toEqual(CHAT_AS_ANTHROPIC_EVENTS);
    expect(whole.status).toBe(200);
    expect(await whole.json()).toEqual(CHAT_AS_ANTHROPIC_WHOLE);
  });

  test("a translated endpoint that answers whole JSON instead of a stream: the agent gets the stream it asked for, saying the same", async () => {
    const chat = await startUpstream();
    chat.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(CHAT_WHOLE));
    };
    const { gateway } = await start({ chatUpstream: chat });

    const response = await fetch(
      `${gateway}/v1/messages?beta=true`,
      claudeRequest(claudeConversation(true)),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(sseData(await response.text())).toEqual([
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
          // 整份回复一开头就知道提示词用了多少。
          usage: {
            input_tokens: 20,
            output_tokens: 0,
            cache_read_input_tokens: 100,
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
      ...CHAT_AS_ANTHROPIC_EVENTS.slice(-2),
    ]);
  });

  test("the same whole JSON reaches an agent that did not ask to stream as its whole reply", async () => {
    const chat = await startUpstream();
    chat.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(CHAT_WHOLE));
    };
    const { gateway } = await start({ chatUpstream: chat });

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({ ...claudeConversation(false), model: "relay-c/deepseek-v3" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(CHAT_AS_ANTHROPIC_WHOLE);
  });
  test("passed through after the keepalive began, a whole JSON reply goes out as the stream the agent asked for (magpie wholeAsStream)", async () => {
    const { upstreamA, ask } = await twoRelays({ keepAliveMs: 30 });
    const held = heldUpstream(
      () => {},
      (res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(ANTHROPIC_WHOLE));
      },
    );
    upstreamA.respond = held.respond;

    const response = await ask();
    const { text, rest } = await readUntil(response, "event: ping", 2);
    held.release();
    const reply = (text + (await rest())).split('event: ping\ndata: {"type":"ping"}\n\n');

    expect(response.status).toBe(200);
    const expected = [
      {
        type: "message_start",
        message: {
          ...ANTHROPIC_WHOLE,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 12, output_tokens: 0 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "", signature: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Look first." },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "sig-1" },
      },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "from A, whole" },
      },
      { type: "content_block_stop", index: 1 },
      {
        type: "content_block_start",
        index: 2,
        content_block: { type: "tool_use", id: "toolu_1", name: "Bash", input: {} },
      },
      {
        type: "content_block_delta",
        index: 2,
        delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' },
      },
      { type: "content_block_stop", index: 2 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null, stop_details: null },
        usage: { input_tokens: 12, output_tokens: 5 },
      },
      { type: "message_stop" },
    ];
    const last = reply.at(-1) ?? "";
    expect(sseData(last)).toEqual(expected);
    expect(last.match(/^event: .*$/gm)).toEqual(expected.map((event) => `event: ${event.type}`));
  });

  test("passed through after the keepalive began, a 200 that is no reply of the protocol's goes to the next endpoint", async () => {
    const { upstreamA, upstreamB, ask } = await twoRelays({ keepAliveMs: 30 });
    const held = heldUpstream(
      () => {},
      (res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      },
    );
    upstreamA.respond = held.respond;

    const response = await ask();
    const { text, rest } = await readUntil(response, "event: ping", 2);
    held.release();
    const all = text + (await rest());

    expect(upstreamB.requests).toHaveLength(1);
    expect(all).toContain("from B");
  });
  test("passed through, a sign-in page served 200 goes to the next endpoint, cools the first, and the log names its title", async () => {
    const { upstreamA, upstreamB, ask, daemon, logLines } = await twoRelays();
    upstreamA.respond = (_request, res) => servePage(res);

    const response = await ask();

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("from B");
    expect(upstreamB.requests).toHaveLength(1);
    expect(await cooldownOf(await connectTo(daemon), "ep_a")).toMatchObject({
      state: "cooling_down",
      reason: "other",
    });
    expect(gatewayLog(logLines, "API endpoint returned an error")[0]).toMatchObject({
      endpoint: "relay-a",
      status: 502,
      detail: PAGE_DETAIL,
    });
    expect(gatewayLog(logLines, "API endpoint gateway switched endpoints")[0]).toMatchObject({
      from: "Relay A",
      to: "Relay B",
      failure: "other",
      status: 502,
    });
  });

  test("translated, a sign-in page served 200 goes to the next endpoint, cools the first, and the log names its title", async () => {
    const chat = await startUpstream();
    chat.respond = (_request, res) => servePage(res);
    const upstreamA = await startUpstream();
    upstreamA.respond = (_request, res) => streamReply(res, { text: "from A" });
    const { gateway, daemon, logLines } = await start({
      chatUpstream: chat,
      upstreamA,
      modelsA: ["deepseek-v3"],
    });

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({ ...claudeConversation(true), model: "relay-c/deepseek-v3" }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("from A");
    expect(await cooldownOf(await connectTo(daemon), "ep_c")).toMatchObject({
      state: "cooling_down",
      reason: "other",
    });
    expect(gatewayLog(logLines, "API endpoint returned an error")[0]).toMatchObject({
      endpoint: "relay-c",
      status: 502,
      detail: PAGE_DETAIL,
    });
  });

  test("a page that begins after a chunk of blank lines is read as the page it is", async () => {
    const { upstreamA, ask, logLines } = await twoRelays();
    upstreamA.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write("\n\n");
      setTimeout(() => res.end(CLOUDFLARE_PAGE), 20);
    };

    const response = await ask();

    expect(await response.text()).toContain("from B");
    expect(gatewayLog(logLines, "API endpoint returned an error")[0]).toMatchObject({
      endpoint: "relay-a",
      status: 502,
      detail:
        "answered 200 OK with a web page (application/json), not an API reply: “Just a moment...”",
    });
  });

  test.each([
    {
      envelope: '{"code":1000,"msg":"身份验证失败。","success":false}',
      cooldown: { state: "needs_check", reason: "auth", until: null },
    },
    {
      envelope: '{"code":"1302","msg":"您的账户已达到速率限制，请您控制请求频率","success":false}',
      cooldown: { state: "cooling_down", reason: "rate" },
    },
  ])(
    "Zhipu's refusal in a 200 is read by its code and the next endpoint answers: $envelope",
    async ({ envelope, cooldown }) => {
      const zhipu = await startUpstream();
      zhipu.respond = (_request, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(envelope);
      };
      const upstreamB = await startUpstream();
      upstreamB.respond = (_request, res) => streamReply(res, { text: "from B" });
      // 智谱的信封只认它自己的主机名：让它解析到本机的假上游。
      const lookup = dns.lookup;
      const toLocal = vi
        .spyOn(dns, "lookup")
        .mockImplementation((hostname, ...rest) =>
          Reflect.apply(lookup, dns, [localZhipu(hostname), ...rest]),
        );
      try {
        const port = new URL(zhipu.url).port;
        const { gateway, daemon } = await start({
          upstreamA: { ...zhipu, url: `http://open.bigmodel.cn:${port}` },
          upstreamB,
        });

        const response = await fetch(
          `${gateway}/v1/messages`,
          claudeRequest({
            model: "kimi-k2",
            stream: true,
            max_tokens: 32,
            messages: [{ role: "user", content: "hi" }],
          }),
        );

        expect(await response.text()).toContain("from B");
        expect(zhipu.requests).toHaveLength(1);
        expect(await cooldownOf(await connectTo(daemon), "ep_a")).toMatchObject(cooldown);
      } finally {
        toLocal.mockRestore();
      }
    },
  );

  test("with no endpoint left, the agent is told what the page was, under the endpoint's name", async () => {
    const { upstreamA, upstreamB, ask } = await twoRelays();
    upstreamA.respond = (_request, res) => servePage(res);
    upstreamB.respond = (_request, res) => servePage(res);

    const response = await ask({ stream: false });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      type: "error",
      error: { type: "api_error", message: `Relay B: ${PAGE_DETAIL}` },
    });
  });

  test.each([
    {
      shape: "nothing at all",
      body: "",
      detail: "answered 200 OK with nothing in it, not an API reply",
    },
    {
      shape: "JSON that is not",
      body: "upstream connect error or disconnect/reset before headers",
      detail:
        "answered 200 OK with a reply that isn't JSON, not an API reply: upstream connect error or disconnect/reset before headers",
    },
  ])("a 200 with $shape is a 502 that goes to the next endpoint", async ({ body, detail }) => {
    const { upstreamA, ask, logLines } = await twoRelays();
    upstreamA.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    };

    const response = await ask();

    expect(await response.text()).toContain("from B");
    expect(gatewayLog(logLines, "API endpoint returned an error")[0]).toMatchObject({
      endpoint: "relay-a",
      status: 502,
      detail,
    });
  });
  test("Codex: a Responses stream refusing the request as invalid_request_error is a 400 with the vendor's type, code and param", async () => {
    const upstreamA = await startUpstream();
    upstreamA.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(ACCESS_PROGRAM_REFUSED);
    };
    const { gateway } = await start({ upstreamA });

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({ ...codexConversation("gpt-5.5", true), stream: true }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        message:
          "Relay A: The requested Cyber access program is not authorized for this workspace.",
        type: "invalid_request_error",
        code: "access_program_not_enabled",
        param: "access_programs.cyber",
      },
    });
  });

  test("translated: the same refusal after the reply opened reaches Claude Code with the vendor's type, code and param", async () => {
    const responses = await startUpstream();
    responses.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        sseFrame({ type: "response.created", response: { id: "resp_9", status: "in_progress" } }),
      );
      res.write(
        sseFrame({ type: "response.output_text.delta", item_id: "msg_1", delta: "Let me" }),
      );
      res.end(ACCESS_PROGRAM_REFUSED);
    };
    const { gateway } = await start({ responsesUpstream: responses });

    const response = await fetch(
      `${gateway}/v1/messages?beta=true`,
      claudeRequest({ ...claudeConversation(true), model: "grok-4" }),
    );

    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
    expect(response.status).toBe(200);
    // 照 magpie：错误事件之后编码器照样以 message_delta、message_stop 收尾。
    expect(sseData(await response.text())).toEqual([
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
          usage,
        },
      },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me" } },
      { type: "content_block_stop", index: 0 },
      {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "The requested Cyber access program is not authorized for this workspace.",
          code: "access_program_not_enabled",
          param: "access_programs.cyber",
        },
      },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage,
      },
      { type: "message_stop" },
    ]);
  });

  test.each([
    '{"message":"upstream overloaded, try later"}',
    // type 只在里面那层：顶层仍没写 type。
    '{"error":{"type":"overloaded_error","message":"Overloaded"}}',
  ])(
    "an error named only by its event: line, before the reply opened, goes to the next endpoint: %s",
    async (data) => {
      const { upstreamA, upstreamB, ask } = await twoRelays();
      upstreamA.respond = (_request, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`event: error\ndata: ${data}\n\n`);
      };

      const response = await ask();

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("from B");
      expect(upstreamB.requests).toHaveLength(1);
    },
  );
});

/** ChatGPT 后端在 200 流里拒绝工作区没开的访问计划（照 magpie codex_access_programs_test.go）。 */
const ACCESS_PROGRAM_REFUSED =
  'event: error\ndata: {"type":"error","error":{"message":"The requested Cyber access program is not authorized for this workspace.","type":"invalid_request_error","param":"access_programs.cyber","code":"access_program_not_enabled"}}\n\n';

function localZhipu(hostname: string): string {
  return hostname === "open.bigmodel.cn" ? "127.0.0.1" : hostname;
}

/** Cloudflare 的挑战页，中转服务用 200 text/html 回在回复的位置（照 magpie notapi_test.go 的 cloudflarePage）。 */
const CLOUDFLARE_PAGE = `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body><div class="main-wrapper" role="main"><div class="main-content"><noscript>Enable JavaScript and cookies to continue</noscript></div></div></body></html>`;

const PAGE_DETAIL =
  "answered 200 OK with a web page (text/html), not an API reply: “Just a moment...”";

function servePage(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(CLOUDFLARE_PAGE);
}

/** Anthropic 上游不流式时给的整份回复：一段带签名的思考、一段文字、一个调用。 */
const ANTHROPIC_WHOLE = {
  id: "msg_whole",
  type: "message",
  role: "assistant",
  model: "kimi-k2",
  content: [
    { type: "thinking", thinking: "Look first.", signature: "sig-1" },
    { type: "text", text: "from A, whole" },
    { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
  ],
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: { input_tokens: 12, output_tokens: 5 },
};

/** chatStream 说的同一份回复，Chat 上游不流式时整份给出的样子。 */
const CHAT_WHOLE = {
  id: "chatcmpl-42",
  object: "chat.completion",
  model: "deepseek-v3-0324",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: "Let me look.",
        tool_calls: [
          {
            id: "call_ls",
            type: "function",
            function: { name: "Bash", arguments: '{"command":"ls"}' },
          },
        ],
      },
      finish_reason: "tool_calls",
    },
  ],
  usage: {
    prompt_tokens: 120,
    completion_tokens: 30,
    prompt_tokens_details: { cached_tokens: 100 },
  },
};

describe("a refusal goes to the next endpoint, as magpie does (ticket 19)", () => {
  test("a stop_reason refusal before the reply opened: the agent gets only the next endpoint's answer, and the first stays available", async () => {
    const { upstreamA, upstreamB, ask, daemon, logLines } = await twoRelays();
    upstreamA.respond = (_request, res) => refusalStream(res);

    const response = await ask();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    const text = await response.text();
    expect(text).toContain("from B");
    expect(text).not.toContain("refusal");
    expect(upstreamA.requests).toHaveLength(1);
    expect(upstreamB.requests).toHaveLength(1);
    expect(await cooldownOf(await connectTo(daemon), "ep_a")).toBeNull();
    expect(switchedLog(logLines)).toMatchObject({
      from: "Relay A",
      to: "Relay B",
      model: "kimi-k2",
      failure: "refused",
      status: 400,
      until: null,
    });
  });

  test("every endpoint refusing: Claude Code gets the first one's refusal as it was, with stop_details; Codex gets a 400 with the reason", async () => {
    const { upstreamA, upstreamB, chatUpstream, gateway } = await threeRefusing();

    for (const stream of [true, false]) {
      const toClaude = await fetch(
        `${gateway}/v1/messages`,
        claudeRequest({
          model: "kimi-k2",
          stream,
          max_tokens: 32,
          messages: [{ role: "user", content: "hi" }],
        }),
      );

      expect(toClaude.status).toBe(200);
      expect(toClaude.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
      const said = stream ? sseData(await toClaude.text()) : await toClaude.json();
      expect(said).toEqual(stream ? REFUSAL_EVENTS : REFUSAL_WHOLE);
      const asked = [upstreamA, upstreamB, chatUpstream].map((upstream) =>
        upstream.requests.splice(0),
      );
      expect(asked.map((requests) => requests.length)).toEqual([1, 1, 1]);
    }

    const toCodex = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({ model: "kimi-k2", input: "hi", stream: true }),
    );

    expect(toCodex.status).toBe(400);
    expect(toCodex.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(await toCodex.json()).toEqual({
      error: {
        message: "Relay A: kimi-k2 refused this request (safety filter: content_filter)",
        type: "invalid_request_error",
        code: "invalid_prompt",
        param: null,
      },
    });
    const urls = (upstream: FakeUpstream) => upstream.requests.map((request) => request.url);
    expect([upstreamA, upstreamB, chatUpstream].map(urls)).toEqual([
      ["/v1/responses"],
      ["/v1/messages"],
      ["/v1/chat/completions"],
    ]);
  });

  test.each([
    { said: "a 400", status: 400 },
    { said: "a 403", status: 403 },
  ])(
    "the high risk refusal said as $said goes to the next endpoint, and the first is neither cooling nor marked for a check",
    async ({ status }) => {
      const { upstreamA, upstreamB, ask, daemon } = await twoRelays();
      upstreamA.respond = (_request, res) => failWith(res, { status, message: HIGH_RISK });

      const response = await ask();

      expect(response.status).toBe(200);
      expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
      expect(await response.text()).toContain("from B");
      expect(upstreamB.requests).toHaveLength(1);
      expect(await cooldownOf(await connectTo(daemon), "ep_a")).toBeNull();
    },
  );

  test("a content_filter error event before the reply opened goes to the next endpoint", async () => {
    const { upstreamA, upstreamB, ask, daemon } = await twoRelays();
    upstreamA.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        sseFrame({ type: "message_start", message: { id: "msg_a", usage: { input_tokens: 9 } } }),
      );
      res.end(
        sseFrame({
          type: "error",
          error: { type: "content_filter", message: "Output blocked by content filtering policy" },
        }),
      );
    };

    const response = await ask();

    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(await response.text()).toContain("from B");
    expect(upstreamB.requests).toHaveLength(1);
    expect(await cooldownOf(await connectTo(daemon), "ep_a")).toBeNull();
  });

  test("a Chat reply ending in content_filter with nothing said is a refusal: Codex gets a 400 with the reason, nobody cools", async () => {
    const { chatUpstream, gateway, endpointsDir, daemon } = await threeRefusing();
    await selectModels(endpointsDir, { ep_a: ["gpt-5.5"], ep_b: ["glm-4.6"] });

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({ model: "kimi-k2", input: "hi", stream: true }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        message: "Relay C: kimi-k2 refused this request (safety filter: content_filter)",
        type: "invalid_request_error",
        code: "invalid_prompt",
        param: null,
      },
    });
    expect(chatUpstream.requests).toHaveLength(1);
    const client = await connectTo(daemon);
    expect(await client.apiEndpointList("codex")).toMatchObject({
      endpoints: [{ cooldown: null }, { cooldown: null }, { cooldown: null }],
    });
  });

  test("an answer quoting the high risk sentence is an answer: it reaches the agent and the next endpoint is not asked", async () => {
    const { upstreamA, upstreamB, ask } = await twoRelays();
    upstreamA.respond = (_request, res) =>
      streamReply(res, { text: `The vendor said: "${HIGH_RISK}".` });

    const response = await ask();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(await response.text()).toContain("considered high risk");
    expect(upstreamB.requests).toHaveLength(0);
  });

  test("a refusal after the reply opened reaches the agent as it came, and the endpoint does not cool", async () => {
    const { chatUpstream, gateway, endpointsDir, daemon } = await threeRefusing();
    await selectModels(endpointsDir, { ep_a: ["gpt-5.5"], ep_b: ["glm-4.6"] });
    chatUpstream.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({ id: "chatcmpl-think", choices: [{ index: 0, delta: { reasoning_content: "Let me think." } }] })}\n\n`,
      );
      res.end(`data: ${JSON.stringify({ error: { message: HIGH_RISK } })}\n\n`);
    };

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({
        model: "kimi-k2",
        stream: false,
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-c");
    expect(await response.json()).toEqual({
      type: "error",
      error: { type: "invalid_request_error", message: `Relay C: ${HIGH_RISK}` },
    });
    expect(await cooldownOf(await connectTo(daemon), "ep_c")).toBeNull();
  });

  test("a refusal after the reply opened is not an answer: the conversation does not stay with that endpoint", async () => {
    const { upstreamA, upstreamB, ask } = await twoRelays();
    let askedA = 0;
    upstreamA.respond = (_request, res) => {
      askedA++;
      if (askedA === 1) failWith(res, { status: 400, message: "Extra inputs are not permitted" });
      else streamReply(res, { text: "from A" });
    };
    upstreamB.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const usage = { input_tokens: 10, cache_read_input_tokens: 4000 };
      res.write(sseFrame({ type: "message_start", message: { id: "msg_b", usage } }));
      res.write(
        sseFrame({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "I started" },
        }),
      );
      res.write(
        sseFrame({
          type: "message_delta",
          delta: { stop_reason: "refusal" },
          usage: { output_tokens: 2 },
        }),
      );
      res.end(sseFrame({ type: "message_stop" }));
    };

    const first = await ask();
    expect(first.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(sseData(await first.text()).at(-2)).toEqual({
      type: "message_delta",
      delta: { stop_reason: "refusal" },
      usage: { output_tokens: 2 },
    });
    const second = await ask();

    expect(second.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expect(await second.text()).toContain("from A");
    expect(upstreamA.requests).toHaveLength(2);
    expect(upstreamB.requests).toHaveLength(1);
  });

  test("every endpoint refusing after the keepalive began: Claude Code's stream ends in the refusal, Codex's in response.failed it does not retry", async () => {
    const claude = await threeRefusing({ keepAliveMs: 30 });
    const codex = await threeRefusing({ keepAliveMs: 30 });
    const releases: (() => void)[] = [];
    for (const relays of [claude, codex]) {
      // A 等测试读到保活之后才拒答。
      const refusesNow = relays.upstreamA.respond;
      const released = new Promise<void>((resolve) => releases.push(resolve));
      relays.upstreamA.respond = (request, res) => {
        void released.then(() => refusesNow(request, res));
      };
    }

    const toClaude = await fetch(
      `${claude.gateway}/v1/messages`,
      claudeRequest({
        model: "kimi-k2",
        stream: true,
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
      }),
    );
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
    expect(claudeEvents.filter((event) => !isPing(event))).toEqual(REFUSAL_EVENTS);
    expect(toCodex.status).toBe(200);
    expect(codexEvents.at(-1)).toEqual({
      type: "response.failed",
      response: {
        object: "response",
        status: "failed",
        error: {
          code: "invalid_prompt",
          message: "Relay A: kimi-k2 refused this request (safety filter: content_filter)",
        },
      },
    });
  });
});

function isPing(event: unknown): boolean {
  return isRecordLike(event) && event.type === "ping";
}

/**
 * 三家都选了 kimi-k2、都拒答：A 按问的格式回 Anthropic 或 Responses 的拒答，B 回 Anthropic 的，
 * C（只有 Chat 地址）回 content_filter。
 */
async function threeRefusing(options: Pick<StartOptions, "keepAliveMs"> = {}) {
  const upstreamA = await startUpstream();
  const upstreamB = await startUpstream();
  const chatUpstream = await startUpstream();
  const harness = await start({ upstreamA, upstreamB, chatUpstream, ...options });
  await selectModels(harness.endpointsDir, { ep_c: ["kimi-k2"] });
  upstreamA.respond = (request, res) => {
    if (request.url.endsWith("/responses")) responsesRefusal(res);
    else anthropicRefusal(request, res);
  };
  upstreamB.respond = anthropicRefusal;
  chatUpstream.respond = (_request, res) => chatRefusal(res);
  return { ...harness, upstreamA, upstreamB, chatUpstream };
}

/** Anthropic 上游的拒答：要流式回 refusalStream，不要就回整份。 */
function anthropicRefusal(request: RecordedRequest, res: ServerResponse): void {
  if (receivedBody(request).stream) {
    refusalStream(res);
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(REFUSAL_WHOLE));
}

const REFUSAL_WHOLE = {
  id: "msg_refused",
  type: "message",
  role: "assistant",
  model: "kimi-k2",
  content: [],
  stop_reason: "refusal",
  stop_sequence: null,
  stop_details: { category: "cyber", explanation: "The request asks for malware." },
  usage: { input_tokens: 9, output_tokens: 0 },
};

/** Responses 上游因 content_filter 没有完成：一个字也没说。 */
function responsesRefusal(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(sseFrame({ type: "response.created", response: { id: "resp_refused" } }));
  res.end(
    sseFrame({
      type: "response.incomplete",
      response: {
        id: "resp_refused",
        status: "incomplete",
        incomplete_details: { reason: "content_filter" },
        output: [],
        usage: { input_tokens: 9, output_tokens: 0 },
      },
    }),
  );
}

/** Chat 上游以 content_filter 结束、一个字也没说。 */
function chatRefusal(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(
    `data: ${JSON.stringify({ id: "chatcmpl-refused", choices: [{ index: 0, delta: { role: "assistant" } }] })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({ id: "chatcmpl-refused", choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }] })}\n\n`,
  );
  res.end("data: [DONE]\n\n");
}

/** Claude 的安全过滤开口前就拒答的流：没说一个字，stop_reason 是 refusal，带 stop_details（magpie fallback.go refusedDetail）。 */
function refusalStream(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of REFUSAL_EVENTS) res.write(sseFrame(event));
  res.end();
}

const REFUSAL_EVENTS = [
  { type: "message_start", message: { id: "msg_refused", usage: { input_tokens: 9 } } },
  {
    type: "message_delta",
    delta: {
      stop_reason: "refusal",
      stop_details: { category: "cyber", explanation: "The request asks for malware." },
    },
    usage: { output_tokens: 0 },
  },
  { type: "message_stop" },
];

/** 开了口的 Anthropic 流：开头、一个文字块开始、半句话。 */
const HALF_ANTHROPIC_REPLY = [
  sseFrame({ type: "message_start", message: { id: "msg_half", usage: { input_tokens: 9 } } }),
  sseFrame({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
  sseFrame({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "Let me" },
  }),
].join("");

/** HALF_ANTHROPIC_REPLY 翻给 Codex 后流尾的 response.failed：说了的半句收成一条消息。 */
function halfCodexFailed(message: string): Record<string, unknown> {
  return {
    type: "response.failed",
    sequence_number: 8,
    response: {
      id: "resp_msg_half",
      object: "response",
      created_at: expect.any(Number),
      status: "failed",
      model: "glm-4.6",
      output: [
        {
          id: expect.stringMatching(/^msg_/),
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "Let me", annotations: [], logprobs: [] }],
        },
      ],
      parallel_tool_calls: true,
      tool_choice: "auto",
      tools: [],
      error: { code: "server_error", message },
    },
  };
}

/** 开了口的 Responses 流：开头、一条消息开始、半句话。 */
const HALF_RESPONSES_REPLY = [
  sseFrame({
    type: "response.created",
    response: { id: "resp_half", model: "grok-4", status: "in_progress" },
  }),
  sseFrame({
    type: "response.output_item.added",
    output_index: 0,
    item: { id: "msg_1", type: "message", role: "assistant", content: [] },
  }),
  sseFrame({ type: "response.output_text.delta", item_id: "msg_1", delta: "Let me" }),
].join("");

describe("a reply that breaks after it opened (magpie errEndedShort, cutMidReply)", () => {
  test("passed through, a stream that ended short of message_stop gets an error event after a blank line, even cut inside a line", async () => {
    const { upstreamA, ask, daemon } = await twoRelays();
    const cutLine = 'event: content_block_delta\ndata: {"type":"conte';
    upstreamA.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(HALF_ANTHROPIC_REPLY + cutLine);
    };

    const response = await ask();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      `${HALF_ANTHROPIC_REPLY}${cutLine}\n\n${sseFrame({
        type: "error",
        error: {
          type: "api_error",
          message: brokenMessage({ endpointName: "Relay A", reason: ENDED_SHORT }),
        },
      })}`,
    );
    const client = await connectTo(daemon);
    await expect.poll(() => cooldownOf(client, "ep_a")).toMatchObject({ state: "cooling_down" });
  });

  test("passed through, a Codex stream that ended short of response.completed gets response.failed", async () => {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(HALF_RESPONSES_REPLY);
    };
    const { gateway } = await start({ upstreamA: upstream });

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest(codexConversation("gpt-5.5", true)),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      `${HALF_RESPONSES_REPLY}\n${sseFrame({
        type: "response.failed",
        response: {
          object: "response",
          status: "failed",
          error: {
            code: "server_error",
            message: brokenMessage({ endpointName: "Relay A", reason: ENDED_SHORT }),
          },
        },
      })}`,
    );
  });

  test("translated for Codex, an Anthropic stream that ended short is not finished for it: response.failed after a blank line", async () => {
    const anthropic = await startUpstream();
    anthropic.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(HALF_ANTHROPIC_REPLY);
    };
    const { gateway, daemon } = await start({ upstreamB: anthropic });

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest(codexConversation("glm-4.6", true)),
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain("response.completed");
    const tail = text.slice(text.lastIndexOf("\n\n\n") + 3);
    expect((sseData(tail) as Record<string, unknown>[]).map((event) => event.type)).toEqual([
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.failed",
    ]);
    expect(sseData(tail).at(-1)).toEqual(
      halfCodexFailed(brokenMessage({ endpointName: "Relay B", reason: ENDED_SHORT })),
    );
    const client = await connectTo(daemon);
    await expect.poll(() => cooldownOf(client, "ep_b")).toMatchObject({ state: "cooling_down" });
  });

  test("translated for Claude Code, a Responses stream that ended short gets api_error after a blank line and no message_stop", async () => {
    const responses = await startUpstream();
    responses.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(HALF_RESPONSES_REPLY);
    };
    const { gateway } = await start({ responsesUpstream: responses });

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({ ...claudeConversation(true), model: "grok-4" }),
    );
    const text = await response.text();

    expect(text).not.toContain("message_stop");
    expect(text).not.toContain("message_delta");
    const tail = text.slice(text.lastIndexOf("\n\n\n") + 3);
    expect(sseData(tail)).toEqual([
      { type: "content_block_stop", index: 0 },
      {
        type: "error",
        error: {
          type: "api_error",
          message: brokenMessage({ endpointName: "Relay D", reason: ENDED_SHORT }),
        },
      },
    ]);
  });

  test("translated, a connection lost mid-reply gets the error in the stream instead of a cut connection", async () => {
    const anthropic = await startUpstream();
    anthropic.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(HALF_ANTHROPIC_REPLY);
      setTimeout(() => res.destroy(), 50);
    };
    const { gateway } = await start({ upstreamB: anthropic });

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest(codexConversation("glm-4.6", true)),
    );
    const events = sseData(await response.text());

    expect(events.at(-1)).toEqual(
      halfCodexFailed(
        brokenMessage({ endpointName: "Relay B", reason: "connection lost mid-reply (aborted)" }),
      ),
    );
  });

  test("a Chat stream that ends without [DONE] after its finish_reason is whole", async () => {
    const chat = await startUpstream();
    chat.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(CHAT_CHUNKS.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""));
    };
    const { gateway } = await start({ chatUpstream: chat });

    const response = await fetch(`${gateway}/v1/messages`, claudeRequest(claudeConversation(true)));

    expect(sseData(await response.text())).toEqual(CHAT_AS_ANTHROPIC_EVENTS);
  });

  test.each([
    { broken: "a connection lost", reason: "connection lost mid-reply (aborted)", cut: true },
    { broken: "a stream that ended short", reason: ENDED_SHORT, cut: false },
  ])(
    "an agent that did not ask to stream gets a 502 with the reason for $broken",
    async ({ reason, cut }) => {
      const anthropic = await startUpstream();
      anthropic.respond = (_request, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        if (!cut) {
          res.end(HALF_ANTHROPIC_REPLY);
          return;
        }
        res.write(HALF_ANTHROPIC_REPLY);
        setTimeout(() => res.destroy(), 50);
      };
      const { gateway } = await start({ upstreamB: anthropic });

      const response = await fetch(
        `${gateway}/v1/responses`,
        codexRequest(codexConversation("glm-4.6", false)),
      );

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: { message: `Relay B: ${reason}`, type: "api_error", code: null, param: null },
      });
    },
  );
});

/** 接着写的那一次说完的 Anthropic 流：开头、接上的半句、正常收尾。 */
const REST_ANTHROPIC_REPLY = [
  sseFrame({ type: "message_start", message: { id: "msg_rest", usage: { input_tokens: 11 } } }),
  sseFrame({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
  sseFrame({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: " look." },
  }),
  sseFrame({ type: "content_block_stop", index: 0 }),
  sseFrame({
    type: "message_delta",
    delta: { stop_reason: "end_turn" },
    usage: { output_tokens: 4 },
  }),
  sseFrame({ type: "message_stop" }),
].join("");

/** 说了半句、接着开始工具调用、参数写了一半的 Anthropic 流。 */
const HALF_CALL_ANTHROPIC_REPLY = [
  HALF_ANTHROPIC_REPLY,
  sseFrame({ type: "content_block_stop", index: 0 }),
  sseFrame({
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id: "toolu_9", name: "exec_command", input: {} },
  }),
  sseFrame({
    type: "content_block_delta",
    index: 1,
    delta: { type: "input_json_delta", partial_json: '{"cmd":' },
  }),
].join("");

/** 开了口、写了 `head` 之后上游掐断连接（回复说到一半连接中断）。 */
function writeThenCut(res: ServerResponse, head: string): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(head);
  setTimeout(() => res.destroy(), 50);
}

/** 第 n 次（从 0 起）请求怎么回：前 `cuts` 次说半句就断（掐断连接或流读完却没说完），之后回 REST_ANTHROPIC_REPLY。 */
function cutThenRest(input: { cuts: number; cut: boolean }): FakeUpstream["respond"] {
  let asked = 0;
  return (_request, res) => {
    const call = asked++;
    const isCut = call < input.cuts;
    const losesConnection = isCut && input.cut;
    if (losesConnection) {
      writeThenCut(res, HALF_ANTHROPIC_REPLY);
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(isCut ? HALF_ANTHROPIC_REPLY : REST_ANTHROPIC_REPLY);
  };
}

/** 一次请求最后一条消息。 */
function lastMessageOf(request: RecordedRequest): unknown {
  const body: unknown = JSON.parse(request.body.toString());
  if (!isRecord(body) || !Array.isArray(body.messages)) return undefined;
  return body.messages.at(-1);
}

/** Agent 收到的流：依次的事件类型与说的全部文字。 */
interface AgentRead {
  types: string[];
  said: string;
}

/** Codex 收到的流读成 AgentRead：文字是 output_text.delta 的 delta 连起来。 */
function codexReadOf(text: string): AgentRead {
  const read: AgentRead = { types: [], said: "" };
  for (const event of sseData(text)) {
    if (!isRecord(event)) continue;
    read.types.push(String(event.type));
    if (event.type === "response.output_text.delta") read.said += String(event.delta);
  }
  return read;
}

/** 开了口的 Chat 流说了半句；接着写的那一次说完。 */
const HALF_CHAT_CHUNK = {
  id: "chatcmpl-half",
  choices: [{ index: 0, delta: { content: "Let me" } }],
};
const REST_CHAT_CHUNKS = [
  { id: "chatcmpl-rest", choices: [{ index: 0, delta: { content: " look." } }] },
  { id: "chatcmpl-rest", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
];

function chatData(chunks: unknown[]): string {
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
}

/** Chat 上游：第一次说半句就掐断，之后的说完。 */
function chatCutThenRest(): FakeUpstream["respond"] {
  let asked = 0;
  return (_request, res) => {
    if (asked++ === 0) {
      writeThenCut(res, chatData([HALF_CHAT_CHUNK]));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`${chatData(REST_CHAT_CHUNKS)}data: [DONE]\n\n`);
  };
}

/** 认一种类型的事件。 */
function isEventOf(type: string): (event: unknown) => boolean {
  return (event) => isRecord(event) && event.type === type;
}

/** Claude Code 收到的流读成 AgentRead：文字是 text_delta 连起来。 */
function claudeReadOf(text: string): AgentRead {
  const read: AgentRead = { types: [], said: "" };
  for (const event of sseData(text)) {
    if (!isRecord(event)) continue;
    read.types.push(String(event.type));
    const { delta } = event;
    if (isRecord(delta) && delta.type === "text_delta") read.said += String(delta.text);
  }
  return read;
}

const CUT_REASON = connectionLost({ error: undefined });

describe("a reply that breaks goes on where it was cut (magpie continuation)", () => {
  test("translated for Codex, an Anthropic reply cut mid-way is asked to go on from what Codex has, and Codex reads one whole reply", async () => {
    const anthropic = await startUpstream();
    anthropic.respond = cutThenRest({ cuts: 1, cut: true });
    const { gateway } = await start({ upstreamB: anthropic });

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest(codexConversation("glm-4.6", true)),
    );
    const read = codexReadOf(await response.text());

    expect(anthropic.requests).toHaveLength(2);
    expect(lastMessageOf(anthropic.requests[1])).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "Let me", cache_control: { type: "ephemeral" } }],
    });
    expect(read.said).toBe("Let me look.");
    expect(read.types.filter((type) => type === "response.created")).toHaveLength(1);
    expect(read.types.filter((type) => type === "response.completed")).toHaveLength(1);
    expect(read.types).not.toContain("response.failed");
  });

  test("translated for Claude Code, a DeepSeek Chat reply cut mid-way goes on in its prefix mode, and Claude Code reads one whole reply", async () => {
    const chat = await startUpstream();
    chat.respond = chatCutThenRest();
    const { gateway } = await start({ chatUpstream: chat });

    const response = await fetch(`${gateway}/v1/messages`, claudeRequest(claudeConversation(true)));
    const read = claudeReadOf(await response.text());

    expect(chat.requests.map((request) => request.url)).toEqual([
      "/v1/chat/completions",
      "/beta/chat/completions",
    ]);
    expect(lastMessageOf(chat.requests[1])).toEqual({
      role: "assistant",
      content: "Let me",
      prefix: true,
    });
    expect(read.said).toBe("Let me look.");
    expect(read.types.filter((type) => type === "message_start")).toHaveLength(1);
    expect(read.types.filter((type) => type === "message_stop")).toHaveLength(1);
    expect(read.types).not.toContain("error");
  });

  test("a reply cut after a tool call began is not asked to go on: the error ends the stream", async () => {
    const anthropic = await startUpstream();
    anthropic.respond = (_request, res) => writeThenCut(res, HALF_CALL_ANTHROPIC_REPLY);
    const { gateway } = await start({ upstreamB: anthropic });

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest(codexConversation("glm-4.6", true)),
    );
    const events = sseData(await response.text()) as Record<string, unknown>[];

    expect(anthropic.requests).toHaveLength(1);
    expect(events.at(-1)).toEqual({
      type: "response.failed",
      sequence_number: 12,
      response: {
        id: "resp_msg_half",
        object: "response",
        created_at: expect.any(Number),
        status: "failed",
        model: "glm-4.6",
        output: [
          {
            id: expect.stringMatching(/^msg_/),
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "Let me", annotations: [], logprobs: [] }],
            phase: "commentary",
          },
          {
            id: expect.stringMatching(/^fc_/),
            type: "function_call",
            status: "completed",
            call_id: "toolu_9",
            arguments: '{"cmd":',
            name: "exec_command",
          },
        ],
        parallel_tool_calls: true,
        tool_choice: "auto",
        tools: [],
        error: {
          code: "server_error",
          message: brokenMessage({ endpointName: "Relay B", reason: CUT_REASON }),
        },
      },
    });
  });

  test("a Chat upstream with no prefill mode of its own is not asked to go on: the error ends the stream", async () => {
    const chat = await startUpstream();
    chat.respond = chatCutThenRest();
    const { gateway } = await start({ chatUpstream: chat });

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({ ...claudeConversation(true), model: "qwen3-coder" }),
    );
    const events = sseData(await response.text());

    expect(chat.requests).toHaveLength(1);
    expect(events.slice(-2)).toEqual([
      { type: "content_block_stop", index: 0 },
      {
        type: "error",
        error: {
          type: "api_error",
          message: brokenMessage({ endpointName: "Relay C", reason: CUT_REASON }),
        },
      },
    ]);
  });

  test("a model that turned the continuation's prefill away ends with what cut the reply, and is not asked to go on again", async () => {
    const anthropic = await startUpstream();
    const prefillRefused = {
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "This model does not support assistant message prefill.",
      },
    };
    anthropic.respond = (_request, res) => {
      if (anthropic.requests.length === 2) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify(prefillRefused));
        return;
      }
      writeThenCut(res, HALF_ANTHROPIC_REPLY);
    };
    const { gateway, logLines } = await start({ upstreamB: anthropic });
    const ask = async () => {
      const response = await fetch(
        `${gateway}/v1/responses`,
        codexRequest(codexConversation("glm-4.6", true)),
      );
      return sseData(await response.text()).at(-1);
    };
    const cutFailed = halfCodexFailed(
      brokenMessage({ endpointName: "Relay B", reason: CUT_REASON }),
    );

    expect(await ask()).toEqual(cutFailed);
    expect(anthropic.requests).toHaveLength(2);
    expect(logLines.join("")).toContain(
      "API endpoint refused a conversation ending with the assistant's message; it takes no prefill for this model",
    );

    expect(await ask()).toEqual(cutFailed);
    expect(anthropic.requests).toHaveLength(3);
  });

  test("a reply cut three times running goes on twice, then the error ends the stream", async () => {
    const anthropic = await startUpstream();
    anthropic.respond = cutThenRest({ cuts: 3, cut: true });
    const { gateway } = await start({ upstreamB: anthropic });

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest(codexConversation("glm-4.6", true)),
    );
    const text = await response.text();

    expect(anthropic.requests).toHaveLength(3);
    expect(codexReadOf(text).said).toBe("Let me");
    expect(codexReadOf(text).types).not.toContain("response.completed");
    expect(sseData(text).at(-1)).toEqual(
      halfCodexFailed(brokenMessage({ endpointName: "Relay B", reason: CUT_REASON })),
    );
  });

  test("while the reply waits to go on, Codex is kept alive with response.in_progress", async () => {
    const anthropic = await startUpstream();
    anthropic.respond = (_request, res) => {
      if (anthropic.requests.length === 1) {
        writeThenCut(res, HALF_ANTHROPIC_REPLY);
        return;
      }
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(REST_ANTHROPIC_REPLY);
      }, 300);
    };
    const { gateway } = await start({ upstreamB: anthropic, keepAliveMs: 40 });

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest(codexConversation("glm-4.6", true)),
    );
    const text = await response.text();
    const events = sseData(text);
    const saidAt = events.findIndex(isEventOf("response.output_text.delta"));
    const waiting = events.slice(saidAt + 1).filter(isEventOf("response.in_progress"));

    expect(waiting.length).toBeGreaterThan(0);
    for (const event of waiting) {
      expect(event).toEqual({
        type: "response.in_progress",
        response: { object: "response", status: "in_progress", output: [] },
      });
    }
    expect(codexReadOf(text).said).toBe("Let me look.");
  });

  test("a continuation that fails on its own ends with what it said, after it was asked again", async () => {
    const anthropic = await startUpstream();
    anthropic.respond = (_request, res) => {
      if (anthropic.requests.length === 1) {
        writeThenCut(res, HALF_ANTHROPIC_REPLY);
        return;
      }
      res.writeHead(503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          type: "error",
          error: { type: "api_error", message: "upstream is busy" },
        }),
      );
    };
    const { gateway } = await start({ upstreamB: anthropic });

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest(codexConversation("glm-4.6", true)),
    );
    const events = sseData(await response.text());

    expect(anthropic.requests).toHaveLength(3);
    expect(events.at(-1)).toEqual(
      halfCodexFailed("Relay B: upstream is busy (503: you can retry your request)"),
    );
  });

  test("a Chat reply that ended as a refusal and then lost its connection is not asked to go on", async () => {
    const chat = await startUpstream();
    const refused = {
      id: "chatcmpl-half",
      choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }],
    };
    chat.respond = (_request, res) => writeThenCut(res, chatData([HALF_CHAT_CHUNK, refused]));
    const { gateway } = await start({ chatUpstream: chat });

    const response = await fetch(`${gateway}/v1/messages`, claudeRequest(claudeConversation(true)));
    const text = await response.text();

    expect(chat.requests).toHaveLength(1);
    expect(claudeReadOf(text).said).toBe("Let me");
    expect(sseData(text).at(-1)).toEqual({
      type: "error",
      error: {
        type: "api_error",
        message: brokenMessage({ endpointName: "Relay C", reason: CUT_REASON }),
      },
    });
  });
});

/*
 * 联网搜索按接口放行（工单 04，ADR 0009）：Claude Code 的 WebSearch 另发一次只带 web_search_20250305 的子请求，
 * 样子照 Claude Code 2.1.302（research/web-search.md 第 1 题）。
 */
describe("Claude Code's web search goes only to endpoints that search the web by themselves", () => {
  const SEARCH_SYSTEM = [
    { type: "text", text: "x-anthropic-billing-header: cc_version=2.1.302;" },
    { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
    {
      type: "text",
      text: "You run a web search for another Claude model, which is waiting on the result and can search again. Search once, then reply with a brief summary of the results.",
    },
  ];
  const SEARCH_TOOLS = [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }];

  function searchRequest(model: string) {
    return {
      model,
      max_tokens: 32000,
      stream: true,
      system: SEARCH_SYSTEM,
      messages: [{ role: "user", content: "Perform a web search for the query: osuna" }],
      thinking: { type: "disabled" },
      tool_choice: { type: "tool", name: "web_search" },
      tools: SEARCH_TOOLS,
    };
  }

  /**
   * 三家都选了 claude-sonnet-4-5（Anthropic 官方接口前面的中转）：A、C 打开了「自己能联网搜索」，B 没有；`searchers` 改写哪几家打开。
   * 都只有 Anthropic 地址；`responsesOnly` 里的那几家改成只有 Responses 地址。
   */
  async function threeRelays(
    searchers: Record<string, boolean> = { a: true, c: true },
    models: Record<string, string[]> = {},
    responsesOnly: string[] = [],
  ) {
    const upstreams = {
      a: await startUpstream(),
      b: await startUpstream(),
      c: await startUpstream(),
    };
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-search-"));
    tempRoots.push(root);
    const endpointsDir = path.join(root, ".paseo", "api-endpoints");
    await mkdir(endpointsDir, { recursive: true });
    const endpoints = (["a", "b", "c"] as const).map((key) => {
      const endpoint = storedEndpoint({
        id: `ep_${key}`,
        slug: `relay-${key}`,
        name: `Relay ${key.toUpperCase()}`,
        baseUrls: [
          responsesOnly.includes(key)
            ? { format: "openai_responses", url: `${upstreams[key].url}/v1` }
            : { format: "anthropic_messages", url: upstreams[key].url },
        ],
        models: models[key] ?? ["claude-sonnet-4-5"],
      });
      return searchers[key] ? Object.assign(endpoint, { searchesWeb: true }) : endpoint;
    });
    const files = {
      "endpoints.json": {
        endpoints,
        agents: {
          claude: { enabled: true, defaultModelId: "claude-sonnet-4-5" },
          codex: { enabled: false, defaultModelId: null },
        },
      },
      "keys.json": { keys: { ep_a: KEY_A, ep_b: KEY_B, ep_c: KEY_C } },
      "gateway-tokens.json": { tokens: { claude: CLAUDE_TOKEN } },
    };
    for (const [name, value] of Object.entries(files)) {
      await writeFile(path.join(endpointsDir, name), JSON.stringify(value, null, 2));
    }
    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      cleanup: false,
      logger: pino({ level: "silent" }),
      apiEndpoints: {
        env: { CLAUDE_CONFIG_DIR: path.join(root, "claude"), CODEX_HOME: path.join(root, "codex") },
        homeDir: root,
        gatewayRetryPauseMs: 10,
      },
    });
    daemons.push(daemon);
    const gateway = `http://127.0.0.1:${daemon.port}/api-endpoint-gateway`;
    const ask = (body: unknown) => fetch(`${gateway}/v1/messages`, claudeRequest(body));
    return { upstreams, ask };
  }

  test("a search in a conversation on B goes to A first, then to C when A fails, never to B, as it was sent", async () => {
    const { upstreams, ask } = await threeRelays();
    upstreams.a.respond = (_request, res) => failWith(res, { status: 503, message: "busy" });
    upstreams.c.respond = (_request, res) => streamReply(res, { text: "found it" });

    const response = await ask(searchRequest("relay-b/claude-sonnet-4-5"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-c");
    expect(await response.text()).toContain("found it");
    expect(upstreams.b.requests).toHaveLength(0);
    expect(upstreams.a.requests).toHaveLength(1);
    expect(upstreams.c.requests).toHaveLength(1);
    for (const request of [upstreams.a.requests[0], upstreams.c.requests[0]]) {
      const body = JSON.parse(request?.body.toString() ?? "{}");
      expect(body.tools).toEqual(SEARCH_TOOLS);
      expect(body.system).toEqual(SEARCH_SYSTEM);
      expect(body.tool_choice).toEqual({ type: "tool", name: "web_search" });
      expect(body.model).toBe("claude-sonnet-4-5");
    }
  });

  test("a Subagent's search is matched by the Subagent's model, not the conversation's", async () => {
    const { upstreams, ask } = await threeRelays(
      { a: true, b: true, c: true },
      { b: ["claude-sonnet-4-5", "claude-haiku-4-5"] },
    );
    for (const upstream of Object.values(upstreams)) {
      upstream.respond = (_request, res) => streamReply(res, { text: "found it" });
    }

    // 同一个会话里：主对话的搜索按主模型，Subagent（haiku）的搜索按它自己的模型。
    const main = await ask(searchRequest("claude-sonnet-4-5"));
    expect(main.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    await main.text();
    // Subagent 的模型带接口标识（光秃秃的 claude-haiku-… 会按档位换成默认模型）。
    const subagent = await ask(searchRequest("relay-b/claude-haiku-4-5"));

    expect(subagent.status).toBe(200);
    expect(subagent.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(await subagent.text()).toContain("found it");
    expect(upstreams.b.requests.map(receivedModel)).toEqual(["claude-haiku-4-5"]);
    expect(upstreams.a.requests.map(receivedModel)).toEqual(["claude-sonnet-4-5"]);
    expect(upstreams.c.requests).toHaveLength(0);
  });

  test("the conversation itself still goes to the endpoint it names", async () => {
    const { upstreams, ask } = await threeRelays();
    upstreams.b.respond = (_request, res) => streamReply(res, { text: "from B" });

    const response = await ask({
      model: "relay-b/claude-sonnet-4-5",
      max_tokens: 32,
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(upstreams.b.requests).toHaveLength(1);
    expect(upstreams.a.requests).toHaveLength(0);
  });

  /*
   * 只有 Responses 地址的那家（工单 06）：照 magpie 写成原生 web_search；回复里的 web_search_call 写回 server_tool_use 与
   * web_search_tool_result，结果项的 title 是地址（Responses 的 sources 只给地址，magpie 同样）。
   */
  const SEARCHED = {
    id: "ws_1",
    type: "web_search_call",
    status: "completed",
    action: {
      type: "search",
      query: "osuna",
      sources: [{ type: "url", url: "https://osuna.dev/" }],
    },
  };
  const ANSWER = {
    id: "msg_1",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "Osuna is an app.", annotations: [] }],
  };
  const RESULTS = {
    type: "web_search_tool_result",
    tool_use_id: expect.stringMatching(/^srvtoolu_/),
    content: [
      {
        type: "web_search_result",
        title: "https://osuna.dev/",
        url: "https://osuna.dev/",
        encrypted_content: "",
        page_age: null,
      },
    ],
  };

  function searchedStream(res: ServerResponse) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      { type: "response.created", response: { id: "resp_1", status: "in_progress" } },
      { type: "response.output_item.added", item: { ...SEARCHED, status: "in_progress" } },
      { type: "response.output_item.done", item: SEARCHED },
      { type: "response.output_item.added", item: { ...ANSWER, content: [] } },
      { type: "response.output_text.delta", delta: "Osuna is an app." },
      { type: "response.output_item.done", item: ANSWER },
      {
        type: "response.completed",
        response: { id: "resp_1", status: "completed", usage: { input_tokens: 9 } },
      },
    ]) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    res.end();
  }

  /** 发给只有 Responses 地址那家的请求：原生 web_search、照 magpie 点名同名函数、要了搜到的页面。 */
  function expectNativeSearch(request: RecordedRequest | undefined) {
    expect(request?.url).toBe("/v1/responses");
    const body = receivedBody(request);
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.tool_choice).toEqual({ type: "function", name: "web_search" });
    expect(body.include).toEqual(["web_search_call.action.sources"]);
  }

  test("an endpoint with only a Responses URL gets Responses' own web_search; Claude Code's stream gets the search blocks", async () => {
    const { upstreams, ask } = await threeRelays({ a: true }, {}, ["a"]);
    upstreams.a.respond = (_request, res) => searchedStream(res);

    const response = await ask(searchRequest("claude-sonnet-4-5"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-a");
    expectNativeSearch(upstreams.a.requests[0]);
    const sent = sseData(await response.text()) as Record<string, unknown>[];
    const blocks = sent
      .filter((event) => event.type === "content_block_start")
      .map((event) => event.content_block);
    expect(blocks).toEqual([
      {
        type: "server_tool_use",
        id: expect.stringMatching(/^srvtoolu_/),
        name: "web_search",
        input: {},
      },
      RESULTS,
      { type: "text", text: "" },
    ]);
    expect(sent).toContainEqual(
      expect.objectContaining({
        delta: { type: "input_json_delta", partial_json: '{"query":"osuna"}' },
      }),
    );
  });

  test("an endpoint with only a Responses URL answering whole: Claude Code's whole reply has the search blocks", async () => {
    const { upstreams, ask } = await threeRelays({ a: true }, {}, ["a"]);
    upstreams.a.respond = (_request, res) => {
      const whole = {
        id: "resp_1",
        object: "response",
        status: "completed",
        output: [SEARCHED, ANSWER],
      };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(whole));
    };

    const response = await ask({ ...searchRequest("claude-sonnet-4-5"), stream: false });

    expect(response.status).toBe(200);
    expectNativeSearch(upstreams.a.requests[0]);
    const body = (await response.json()) as { content: unknown[]; stop_reason: string };
    expect(body.content).toEqual([
      {
        type: "server_tool_use",
        id: expect.stringMatching(/^srvtoolu_/),
        name: "web_search",
        input: { query: "osuna" },
      },
      RESULTS,
      { type: "text", text: "Osuna is an app." },
    ]);
    expect(body.stop_reason).toBe("end_turn");
  });

  test("an endpoint with only a Responses URL and the switch off: the search still gets the 400 and nothing reaches it", async () => {
    const { upstreams, ask } = await threeRelays({}, {}, ["a"]);

    const response = await ask(searchRequest("relay-a/claude-sonnet-4-5"));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { type: string; error: { type: string } };
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("invalid_request_error");
    expect(upstreams.a.requests).toHaveLength(0);
  });

  test("with no endpoint for the model that searches, the CLI gets a 400 invalid_request_error and no upstream is asked", async () => {
    const { upstreams, ask } = await threeRelays({});

    const response = await ask(searchRequest("claude-sonnet-4-5"));

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      type: string;
      error: { type: string; message: string };
    };
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("claude-sonnet-4-5");
    expect(body.error.message).toContain("Searches the web by itself");
    for (const upstream of Object.values(upstreams)) expect(upstream.requests).toHaveLength(0);
  });
});

/*
 * Codex 的搜索工具按开关保留或拿掉（工单 05，ADR 0009）：Codex 每轮都带 {"type":"web_search"}（research/web-search.md「Codex 自身」）。
 * 照 magpie search_own_api_test.go（TestSearchOfferedStaysOnTheClientsAPI）：不会搜的那家收不到搜索工具；
 * 历史里的 web_search_call 照 magpie responses.go 读 input 的那段：不会搜的那家不收（magpie 重建请求时不读这一项），会搜的原样收。
 */
describe("Codex's web_search tool goes only to endpoints that search the web by themselves", () => {
  const WEB_SEARCH = { type: "web_search", external_web_access: false };
  const EXEC = {
    type: "function",
    name: "exec_command",
    description: "Run a command",
    parameters: { type: "object", properties: { cmd: { type: "string" } } },
  };
  const ASKED = {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "what is the newest Go release?" }],
  };
  // 照 magpie search_history_test.go 的 searchedHistory：一次搜索与引用它的回答。
  const SEARCHED = {
    id: "ws_1",
    type: "web_search_call",
    status: "completed",
    action: { type: "search", query: "newest Go release" },
  };
  const ANSWERED = {
    id: "msg_1",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", annotations: [], text: "Go 1.27.2." }],
  };
  const AGAIN = {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "and the one before?" }],
  };

  function codexTurn(model: string, fields: Record<string, unknown> = {}) {
    return {
      model,
      instructions: "You are Codex.",
      stream: false,
      store: false,
      input: [ASKED],
      tools: [EXEC, WEB_SEARCH],
      tool_choice: "auto",
      ...fields,
    };
  }

  /** 两家都选了 kimi-k2、都只有 Responses 地址（`aFormat`、`bFormat` 改各自的）：A（先建的）打开了「自己能联网搜索」，B 没有。 */
  async function twoResponsesRelays(aFormat = "openai_responses", bFormat = "openai_responses") {
    const upstreams = { a: await startUpstream(), b: await startUpstream() };
    for (const upstream of Object.values(upstreams)) {
      upstream.respond = (_request, res) => answerResponsesWhole(res);
    }
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-codex-search-"));
    tempRoots.push(root);
    const endpointsDir = path.join(root, ".paseo", "api-endpoints");
    await mkdir(endpointsDir, { recursive: true });
    const endpoints = (["a", "b"] as const).map((key) => {
      const endpoint = storedEndpoint({
        id: `ep_${key}`,
        slug: `relay-${key}`,
        name: `Relay ${key.toUpperCase()}`,
        baseUrls: [
          (key === "a" ? aFormat : bFormat) === "anthropic_messages"
            ? { format: "anthropic_messages", url: upstreams[key].url }
            : { format: "openai_responses", url: `${upstreams[key].url}/v1` },
        ],
        models: ["kimi-k2"],
      });
      return key === "a" ? Object.assign(endpoint, { searchesWeb: true }) : endpoint;
    });
    const files = {
      "endpoints.json": {
        endpoints,
        agents: {
          claude: { enabled: false, defaultModelId: null },
          codex: { enabled: true, defaultModelId: "kimi-k2" },
        },
      },
      "keys.json": { keys: { ep_a: KEY_A, ep_b: KEY_B } },
      "gateway-tokens.json": { tokens: { codex: CODEX_TOKEN } },
    };
    for (const [name, value] of Object.entries(files)) {
      await writeFile(path.join(endpointsDir, name), JSON.stringify(value, null, 2));
    }
    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      cleanup: false,
      logger: pino({ level: "silent" }),
      apiEndpoints: {
        env: { CLAUDE_CONFIG_DIR: path.join(root, "claude"), CODEX_HOME: path.join(root, "codex") },
        homeDir: root,
        gatewayRetryPauseMs: 10,
      },
    });
    daemons.push(daemon);
    const gateway = `http://127.0.0.1:${daemon.port}/api-endpoint-gateway`;
    const ask = (body: unknown) => fetch(`${gateway}/v1/responses`, codexRequest(body));
    return { upstreams, ask };
  }

  test("A gets the tool and the tool_choice naming it as sent; when A fails, B gets the turn without either", async () => {
    const { upstreams, ask } = await twoResponsesRelays();
    upstreams.a.respond = (_request, res) => failWith(res, { status: 503, message: "busy" });
    const turn = codexTurn("kimi-k2", { tool_choice: { type: "web_search" } });

    const response = await ask(turn);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(upstreams.a.requests).toHaveLength(1);
    expect(upstreams.b.requests).toHaveLength(1);
    const toA = receivedBody(upstreams.a.requests[0]);
    expect(toA.tools).toEqual([EXEC, WEB_SEARCH]);
    expect(toA.tool_choice).toEqual({ type: "web_search" });
    const toB = receivedBody(upstreams.b.requests[0]);
    expect(toB.tools).toEqual([EXEC]);
    expect(toB).not.toHaveProperty("tool_choice");
    expect(toB.input).toEqual([ASKED]);
  });

  test("an endpoint without the switch that turns away any request offering web_search never receives it and answers the turn", async () => {
    const { upstreams, ask } = await twoResponsesRelays();
    upstreams.b.respond = (request, res) => {
      if (request.body.toString().includes("web_search")) {
        refuse(res, `{"error":{"type":"invalid_request_error","message":"unsupported tool type"}}`);
        return;
      }
      answerResponsesWhole(res);
    };

    const response = await ask(codexTurn("relay-b/kimi-k2"));

    expect(response.status).toBe(200);
    expect(upstreams.b.requests).toHaveLength(1);
    const toB = receivedBody(upstreams.b.requests[0]);
    expect(toB.tools).toEqual([EXEC]);
    expect(toB.tool_choice).toBe("auto");
    expect(upstreams.a.requests).toHaveLength(0);
  });

  test("a web_search_call in the history is left out for the endpoint that doesn't search and kept for the one that does", async () => {
    const { upstreams, ask } = await twoResponsesRelays();
    const input = [ASKED, SEARCHED, ANSWERED, AGAIN];

    await ask(codexTurn("relay-b/kimi-k2", { input }));
    await ask(codexTurn("relay-a/kimi-k2", { input }));

    expect(receivedBody(upstreams.b.requests[0]).input).toEqual([ASKED, ANSWERED, AGAIN]);
    expect(receivedBody(upstreams.a.requests[0]).input).toEqual(input);
  });

  /*
   * 只有 Anthropic 地址的那家（工单 06）：照 magpie 写成 web_search_20250305；Anthropic 自己的搜索（server_tool_use 与
   * web_search_tool_result）写回 Codex 的 web_search_call。历史里的 web_search_call 照 magpie 不读（重建请求时没有这一项）。
   */
  const SEARCH_USE = {
    type: "server_tool_use",
    id: "srvtoolu_1",
    name: "web_search",
    input: { query: "newest Go release" },
  };
  const SEARCH_RESULT = {
    type: "web_search_tool_result",
    tool_use_id: "srvtoolu_1",
    content: [
      {
        type: "web_search_result",
        title: "Go 1.27 is released",
        url: "https://go.dev/blog/go1.27",
        encrypted_content: "EqgfCioIARgB",
        page_age: "2 days ago",
      },
    ],
  };
  const SEARCH_ITEM = {
    id: expect.stringMatching(/^ws_/),
    type: "web_search_call",
    status: "completed",
    action: {
      type: "search",
      query: "newest Go release",
      queries: ["newest Go release"],
      sources: [{ type: "url", url: "https://go.dev/blog/go1.27" }],
    },
  };

  function searchedAnthropicStream(res: ServerResponse) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      { type: "message_start", message: { id: "msg_1", usage: { input_tokens: 10 } } },
      { type: "content_block_start", index: 0, content_block: { ...SEARCH_USE, input: {} } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"query":"newest Go release"}' },
      },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: SEARCH_RESULT },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Go 1.27." } },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ]) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    res.end();
  }

  /** 发给只有 Anthropic 地址那家的请求：web_search_20250305 跟在函数后面，历史里的搜索不发。 */
  function expectAnthropicSearch(request: RecordedRequest | undefined) {
    expect(request?.url).toBe("/v1/messages");
    expect(request?.body.toString()).not.toContain("ws_1");
    expect(receivedBody(request).tools).toEqual([
      expect.objectContaining({ name: "exec_command" }),
      { type: "web_search_20250305", name: "web_search", max_uses: 5 },
    ]);
  }

  test("an endpoint with the switch on but only an Anthropic URL gets web_search_20250305; Codex's stream gets the web_search_call", async () => {
    const { upstreams, ask } = await twoResponsesRelays("anthropic_messages");
    upstreams.a.respond = (_request, res) => searchedAnthropicStream(res);
    const input = [ASKED, SEARCHED, ANSWERED, AGAIN];

    const response = await ask(codexTurn("relay-a/kimi-k2", { input, stream: true }));

    expect(response.status).toBe(200);
    expectAnthropicSearch(upstreams.a.requests[0]);
    const sent = sseData(await response.text()) as Record<string, unknown>[];
    const done = sent.filter((event) => event.type === "response.output_item.done");
    expect(done.map((event) => event.item)).toEqual([
      SEARCH_ITEM,
      expect.objectContaining({ type: "message" }),
    ]);
    expect(sent.map((event) => event.type)).toContain("response.web_search_call.completed");
  });

  test("an endpoint with only an Anthropic URL and the switch off gets the turn translated without the tool or the web_search_call", async () => {
    const { upstreams, ask } = await twoResponsesRelays("openai_responses", "anthropic_messages");
    const input = [ASKED, SEARCHED, ANSWERED, AGAIN];

    const response = await ask(codexTurn("relay-b/kimi-k2", { input }));

    expect(response.status).toBe(200);
    expect(upstreams.b.requests[0]?.url).toBe("/v1/messages");
    const toB = upstreams.b.requests[0]?.body.toString() ?? "";
    expect(toB).not.toContain("web_search");
    expect(toB).not.toContain("ws_1");
    expect(receivedBody(upstreams.b.requests[0]).tools).toEqual([
      expect.objectContaining({ name: "exec_command" }),
    ]);
  });

  test("an endpoint with only an Anthropic URL answering whole: Codex's whole reply has the web_search_call", async () => {
    const { upstreams, ask } = await twoResponsesRelays("anthropic_messages");
    upstreams.a.respond = (_request, res) => {
      const whole = {
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [SEARCH_USE, SEARCH_RESULT, { type: "text", text: "Go 1.27." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(whole));
    };

    const response = await ask(codexTurn("relay-a/kimi-k2"));

    expect(response.status).toBe(200);
    expectAnthropicSearch(upstreams.a.requests[0]);
    const body = (await response.json()) as { output: unknown[]; status: string };
    expect(body.output).toEqual([SEARCH_ITEM, expect.objectContaining({ type: "message" })]);
    expect(body.status).toBe("completed");
  });
});

describe("a model asked for at an effort of its own, as the Subagent model is written (magpie askedAt)", () => {
  // Claude Code 自己问的是 low：「模型名:high」要的 high 盖过它。
  function askedAt(model: string) {
    return {
      model,
      max_tokens: 4096,
      stream: false,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "hi" }],
    };
  }

  test("an Anthropic endpoint is sent the model without the suffix, at that effort", async () => {
    const upstreamA = await startUpstream();
    const { gateway } = await start({
      upstreamA,
      modelsA: ["claude-sonnet-5-5"],
      claudeDefaultModel: "claude-sonnet-5-5",
    });

    const response = await fetch(
      `${gateway}/v1/messages?beta=true`,
      claudeRequest(askedAt("claude-sonnet-5-5:high")),
    );

    expect(response.status).toBe(200);
    const body = receivedBody(upstreamA.requests[0]);
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "high" });
  });

  test("a level the model lacks reaches it as the nearest it has (magpie fitLevel)", async () => {
    const upstreamA = await startUpstream();
    const { gateway } = await start({
      upstreamA,
      modelsA: ["claude-sonnet-5-5"],
      claudeDefaultModel: "claude-sonnet-5-5",
      modelsDev: { "claude-sonnet-5-5": { efforts: ["low", "medium", "high"] } },
    });

    await fetch(
      `${gateway}/v1/messages?beta=true`,
      claudeRequest(askedAt("claude-sonnet-5-5:max")),
    );

    expect(receivedBody(upstreamA.requests[0]).output_config).toEqual({ effort: "high" });
  });

  test("another vendor's model on an Anthropic address keeps adaptive thinking at that effort, as magpie sends it", async () => {
    const upstreamA = await startUpstream();
    const { gateway } = await start({ upstreamA });

    await fetch(`${gateway}/v1/messages?beta=true`, claudeRequest(askedAt("kimi-k2:high")));

    const body = receivedBody(upstreamA.requests[0]);
    expect(body.model).toBe("kimi-k2");
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "high" });
  });

  test("a Chat endpoint is sent the model without the suffix, at that reasoning_effort", async () => {
    const chat = await startUpstream();
    chat.respond = (_request, res) => chatStream(res);
    const { gateway } = await start({ chatUpstream: chat });

    const response = await fetch(
      `${gateway}/v1/messages?beta=true`,
      claudeRequest(askedAt("deepseek-v3:high")),
    );
    await response.text();

    expect(response.status).toBe(200);
    const body = receivedBody(chat.requests[0]);
    expect(body.model).toBe("deepseek-v3");
    expect(body.reasoning_effort).toBe("high");
  });

  test("a Responses endpoint is sent the model without the suffix, at that reasoning.effort", async () => {
    const responses = await startUpstream();
    responses.respond = (_request, res) => responsesStream(res);
    const { gateway } = await start({ responsesUpstream: responses });

    const response = await fetch(
      `${gateway}/v1/messages?beta=true`,
      claudeRequest(askedAt("grok-4:high")),
    );
    await response.text();

    expect(response.status).toBe(200);
    const body = receivedBody(responses.requests[0]);
    expect(body.model).toBe("grok-4");
    expect(body.reasoning).toMatchObject({ effort: "high" });
  });

  test("a model an endpoint lists with the colon in its own id is sent whole", async () => {
    const upstreamA = await startUpstream();
    // B 也选了光秃秃的 kimi-k2：拆开后会去 B，整个名字是 A 的才去 A。
    const { gateway } = await start({ upstreamA, modelsA: ["kimi-k2:high"] });

    await fetch(`${gateway}/v1/messages?beta=true`, claudeRequest(askedAt("kimi-k2:high")));

    expect(receivedBody(upstreamA.requests[0]).model).toBe("kimi-k2:high");
  });
});

/*
 * Bedrock 与 Azure 模板（接口管理好用性工单 07，照 magpie authheader.go 的 AuthHeaders、account.go 的 Bedrock 一段）：
 * key 放哪个头、每个模型走哪种格式由模板定。A 换成从模板加的，三个格式的地址都在同一个假上游上。
 */
describe("Amazon Bedrock and Azure OpenAI endpoints, by their template", () => {
  // openai：只有 Chat 与 Responses 地址（Azure 资源常见的样子），Claude Code 的请求要翻译过去。
  async function startTemplated(input: {
    templateId: string;
    models: string[];
    formats?: "all" | "openai";
  }) {
    const upstream = await startUpstream();
    upstream.respond = (request, res) => {
      if (request.url.endsWith("/responses")) return answerResponsesWhole(res);
      if (request.url.endsWith("/chat/completions")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            object: "chat.completion",
            choices: [
              { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        );
        return;
      }
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
    };
    const harness = await start();
    const endpointsPath = path.join(harness.endpointsDir, "endpoints.json");
    const file = JSON.parse(await readFile(endpointsPath, "utf8")) as {
      endpoints: Record<string, unknown>[];
    };
    file.endpoints[0] = {
      ...file.endpoints[0],
      templateId: input.templateId,
      baseUrls: [
        ...(input.formats === "openai"
          ? []
          : [{ format: "anthropic_messages", url: upstream.url }]),
        { format: "openai_chat", url: `${upstream.url}/v1` },
        { format: "openai_responses", url: `${upstream.url}/v1` },
      ],
      models: input.models.map((id) => ({ id })),
    };
    await writeFile(endpointsPath, JSON.stringify(file));
    return { upstream, gateway: harness.gateway };
  }

  const BEDROCK_MODELS = [
    "global.anthropic.claude-sonnet-5",
    "global.openai.gpt-6-luna",
    "deepseek.v3.2",
  ];

  test("Bedrock's Claude goes to its Anthropic address with the key in x-api-key alone, from either CLI", async () => {
    const { upstream, gateway } = await startTemplated({
      templateId: "bedrock",
      models: BEDROCK_MODELS,
    });

    const fromClaude = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({
        model: "relay-a/global.anthropic.claude-sonnet-5",
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    const fromCodex = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({ model: "global.anthropic.claude-sonnet-5", input: "hi", stream: false }),
    );

    expect(fromClaude.status).toBe(200);
    expect(fromCodex.status).toBe(200);
    expect(upstream.requests.map((request) => request.url)).toEqual([
      "/v1/messages",
      "/v1/messages",
    ]);
    for (const request of upstream.requests) {
      expect(request.headers["x-api-key"]).toBe(KEY_A);
      expect(request.headers.authorization).toBeUndefined();
    }
  });

  test("Bedrock's other models go to Chat with a Bearer, and OpenAI's GPT to Responses first", async () => {
    const { upstream, gateway } = await startTemplated({
      templateId: "bedrock",
      models: BEDROCK_MODELS,
    });

    const deepseek = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({ model: "deepseek.v3.2", input: "hi", stream: false }),
    );
    const gptFromClaude = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({
        model: "relay-a/global.openai.gpt-6-luna",
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(deepseek.status).toBe(200);
    expect(gptFromClaude.status).toBe(200);
    expect(upstream.requests.map((request) => request.url)).toEqual([
      "/v1/chat/completions",
      "/v1/responses",
    ]);
    for (const request of upstream.requests) {
      expect(request.headers.authorization).toBe(`Bearer ${KEY_A}`);
      expect(request.headers["x-api-key"]).toBeUndefined();
    }
  });

  test("Azure gets the key in api-key alone on its OpenAI formats, and in x-api-key on Anthropic's", async () => {
    const { upstream, gateway } = await startTemplated({
      templateId: "azure",
      models: ["my-gpt-deployment", "claude-sonnet-5"],
    });

    const responses = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({ model: "my-gpt-deployment", input: "hi", stream: false }),
    );
    const anthropic = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({
        model: "relay-a/claude-sonnet-5",
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(responses.status).toBe(200);
    expect(anthropic.status).toBe(200);
    const [toResponses, toAnthropic] = upstream.requests;
    expect(toResponses?.url).toBe("/v1/responses");
    expect(toResponses?.headers["api-key"]).toBe(KEY_A);
    expect(toResponses?.headers.authorization).toBeUndefined();
    expect(toAnthropic?.url).toBe("/v1/messages");
    expect(toAnthropic?.headers["x-api-key"]).toBe(KEY_A);
    expect(toAnthropic?.headers["api-key"]).toBeUndefined();
    expect(toAnthropic?.headers.authorization).toBeUndefined();
  });

  /*
   * 按模板改请求体（ADR 0008，2026-10-19 用户定，照 magpie gateway.go 的 passthrough 与翻译后 build、betas.go、codex_backend.go）。
   */
  test("to Bedrock's Anthropic address Claude Code's metadata goes, and its betas are named as Bedrock names them", async () => {
    const { upstream, gateway } = await startTemplated({
      templateId: "bedrock",
      models: BEDROCK_MODELS,
    });
    const asked = claudeRequest({
      model: "relay-a/global.anthropic.claude-sonnet-5",
      max_tokens: 32,
      metadata: { user_id: '{"device_id":"d","session_id":"s"}' },
      messages: [{ role: "user", content: "hi" }],
    });
    asked.headers = {
      ...(asked.headers as Record<string, string>),
      "anthropic-beta":
        "claude-code-20250219,advanced-tool-use-2025-11-20,prompt-caching-scope-2026-01-05,redact-thinking-2026-02-12",
    };

    const response = await fetch(`${gateway}/v1/messages`, asked);

    expect(response.status).toBe(200);
    const [received] = upstream.requests;
    expect(receivedBody(received)).not.toHaveProperty("metadata");
    expect(received?.headers["anthropic-beta"]).toBe(
      "claude-code-20250219,tool-search-tool-2025-10-19",
    );
  });

  test("Bedrock's and Azure's Chat get max_completion_tokens in place of max_tokens", async () => {
    const bedrock = await startTemplated({ templateId: "bedrock", models: BEDROCK_MODELS });
    const azure = await startTemplated({
      templateId: "azure",
      models: ["my-kimi"],
      formats: "openai",
    });

    await fetch(
      `${bedrock.gateway}/v1/responses`,
      codexRequest({ model: "deepseek.v3.2", input: "hi", max_output_tokens: 64, stream: false }),
    );
    await fetch(
      `${azure.gateway}/v1/messages`,
      claudeRequest({
        model: "relay-a/my-kimi",
        max_tokens: 64,
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    for (const { upstream } of [bedrock, azure]) {
      const [received] = upstream.requests;
      expect(received?.url).toBe("/v1/chat/completions");
      expect(receivedBody(received)).toMatchObject({ max_completion_tokens: 64 });
      expect(receivedBody(received)).not.toHaveProperty("max_tokens");
    }
  });

  test("on Azure a deployment named for an OpenAI model is translated to Responses first", async () => {
    const { upstream, gateway } = await startTemplated({
      templateId: "azure",
      models: ["gpt-5.5", "my-kimi"],
      formats: "openai",
    });

    await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({
        model: "relay-a/gpt-5.5",
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(upstream.requests[0]?.url).toBe("/v1/responses");
  });

  test("to Azure's Responses, reasoning it can't take goes and item ids keep only the characters it takes", async () => {
    const { upstream, gateway } = await startTemplated({
      templateId: "azure",
      models: ["my-gpt-deployment"],
    });
    const input = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      // 中转站翻译回复时造的、没有封存内容的推理。
      { type: "reasoning", id: "rs_bare", summary: [] },
      // 别家模型写的、带文字的推理。
      {
        type: "reasoning",
        id: "rs_text",
        summary: [],
        content: [{ type: "reasoning_text", text: "thinking" }],
        encrypted_content: "sealed",
      },
      // Muse Spark 的推理 id 是两个用冒号连起来的。
      { type: "reasoning", id: "rs_a:rs_b", summary: [], encrypted_content: "sealed" },
      {
        type: "message",
        id: "msg_a:b",
        role: "assistant",
        content: [{ type: "output_text", text: "ok" }],
      },
      { type: "message", role: "user", content: [{ type: "input_text", text: "again" }] },
    ];

    await fetch(
      `${gateway}/v1/responses`,
      codexRequest({ model: "my-gpt-deployment", input, store: false, stream: false }),
    );

    const sent = receivedBody(upstream.requests[0]).input as Record<string, unknown>[];
    expect(sent.map((item) => [item.type, item.id])).toEqual([
      ["message", undefined],
      ["message", "msg_a_b"],
      ["message", undefined],
    ]);
  });

  test("a Chat-only model refusing tools with a reasoning effort is asked again with effort none", async () => {
    const { upstream, gateway } = await startTemplated({
      templateId: "bedrock",
      models: BEDROCK_MODELS,
    });
    const answer = upstream.respond;
    upstream.respond = (request, res) => {
      if (upstream.requests.length === 1) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message:
                "Function tools with reasoning_effort are not supported for deepseek.v3.2 in /v1/chat/completions. Please set reasoning_effort to none.",
            },
          }),
        );
        return;
      }
      answer(request, res);
    };

    const response = await fetch(
      `${gateway}/v1/responses`,
      codexRequest({
        model: "deepseek.v3.2",
        input: "hi",
        reasoning: { effort: "high" },
        tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }],
        stream: false,
      }),
    );

    expect(response.status).toBe(200);
    expect(upstream.requests.map((request) => receivedBody(request).reasoning_effort)).toEqual([
      "high",
      "none",
    ]);
  });
});

// 接口管理好用性工单 15：上游模型名与只用这种格式（magpie modelprefs.go 的 UpstreamNameIn、SetModelAPI 与 ModelAPI）。
describe("an upstream name and a model's one format", () => {
  async function setModelSettings(endpointsDir: string, settings: Record<string, unknown>) {
    const endpointsPath = path.join(endpointsDir, "endpoints.json");
    const file = JSON.parse(await readFile(endpointsPath, "utf8")) as {
      endpoints: { id: string; modelSettings?: unknown }[];
    };
    for (const endpoint of file.endpoints) {
      if (endpoint.id in settings) endpoint.modelSettings = settings[endpoint.id];
    }
    await writeFile(endpointsPath, JSON.stringify(file));
  }

  async function dropBaseUrl(endpointsDir: string, input: { id: string; format: string }) {
    const endpointsPath = path.join(endpointsDir, "endpoints.json");
    const file = JSON.parse(await readFile(endpointsPath, "utf8")) as {
      endpoints: { id: string; baseUrls: { format: string }[] }[];
    };
    for (const endpoint of file.endpoints) {
      if (endpoint.id !== input.id) continue;
      endpoint.baseUrls = endpoint.baseUrls.filter((entry) => entry.format !== input.format);
    }
    await writeFile(endpointsPath, JSON.stringify(file));
  }

  /** Anthropic 回复里写上收到的模型名，像上游那样。 */
  function echoAnthropic(request: RecordedRequest, res: ServerResponse) {
    const model = receivedModel(request);
    if (receivedBody(request).stream === true) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const opening = { type: "message_start", message: { model, usage: { input_tokens: 1 } } };
      res.write(`event: message_start\ndata: ${JSON.stringify(opening)}\n\n`);
      res.end(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  }

  const claudeAsk = (gateway: string, input: { model: string; stream: boolean }) =>
    fetch(
      `${gateway}/v1/messages`,
      claudeRequest({
        model: input.model,
        stream: input.stream,
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
      }),
    );

  test("the endpoint is sent the upstream name, a * template for every model, while the CLI's reply keeps the model's name", async () => {
    const upstreamA = await startUpstream();
    upstreamA.respond = echoAnthropic;
    const { gateway, endpointsDir } = await start({ upstreamA, modelsA: ["kimi-k2", "glm-4.6"] });
    await setModelSettings(endpointsDir, {
      ep_a: {
        defaults: { upstreamName: "zhipu/*" },
        models: { "glm-4.6": { upstreamName: "vendor/glm-4.6-pro" } },
      },
    });

    const whole = await claudeAsk(gateway, { model: "kimi-k2", stream: false });
    expect(whole.status).toBe(200);
    expect(((await whole.json()) as { model?: string }).model).toBe("kimi-k2");
    const streamed = await claudeAsk(gateway, { model: "glm-4.6", stream: true });
    expect(streamed.status).toBe(200);
    const events = sseData(await streamed.text()) as { message?: { model?: string } }[];
    expect(events[0]?.message?.model).toBe("glm-4.6");

    expect(upstreamA.requests.map(receivedModel)).toEqual(["zhipu/kimi-k2", "vendor/glm-4.6-pro"]);
  });

  test("a translated request goes out under the upstream name and comes back under the model's", async () => {
    const chat = await startUpstream();
    chat.respond = (_request, res) => chatStream(res);
    const { gateway, endpointsDir } = await start({ chatUpstream: chat });
    await setModelSettings(endpointsDir, { ep_c: { defaults: { upstreamName: "router-model" } } });

    const response = await claudeAsk(gateway, { model: "deepseek-v3", stream: false });

    expect(response.status).toBe(200);
    expect(((await response.json()) as { model?: string }).model).toBe("deepseek-v3");
    expect(chat.requests.map(receivedModel)).toEqual(["router-model"]);
  });

  test("two endpoints with one model are still the same model when one of them renames it", async () => {
    const upstreamA = await startUpstream();
    const upstreamB = await startUpstream();
    upstreamA.respond = (_request, res) => failWith(res, { status: 503, message: "upstream busy" });
    upstreamB.respond = echoAnthropic;
    const { gateway, endpointsDir } = await start({ upstreamA, upstreamB });
    await setModelSettings(endpointsDir, {
      ep_a: { models: { "kimi-k2": { upstreamName: "moonshot/kimi-k2-turbo" } } },
    });

    const response = await claudeAsk(gateway, { model: "kimi-k2", stream: false });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-osuna-api-endpoint")).toBe("relay-b");
    expect(upstreamA.requests.map(receivedModel)).toEqual(["moonshot/kimi-k2-turbo"]);
    expect(upstreamB.requests.map(receivedModel)).toEqual(["kimi-k2"]);
  });

  test("a model whose upstream name is Claude keeps Claude Code's billing line and review, as a Claude model does", async () => {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => streamReply(res);
    const { gateway, endpointsDir } = await start({ upstreamA: upstream });
    await selectModels(endpointsDir, { ep_a: ["my-opus"] });
    await setModelSettings(endpointsDir, {
      ep_a: { models: { "my-opus": { upstreamName: "claude-opus-4-8" } } },
    });
    const init = claudeRequest(CLAUDE_CODE_TURN("my-opus"));
    const headers = { ...(init.headers as Record<string, string>) };
    headers["anthropic-beta"] = CLAUDE_CODE_BETAS;

    const response = await fetch(`${gateway}/v1/messages?beta=true`, { ...init, headers });

    expect(response.status).toBe(200);
    await response.text();
    expect(upstream.requests[0]!.body.toString()).toBe(CLAUDE_CODE_TURN("claude-opus-4-8"));
    expect(upstream.requests[0]!.headers["anthropic-beta"]).toBe(CLAUDE_CODE_BETAS);
  });

  test("the advisor is asked for under this endpoint's upstream name, which is what says it is Claude", async () => {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => streamReply(res);
    const { gateway, endpointsDir } = await start({ upstreamA: upstream });
    await selectModels(endpointsDir, { ep_a: ["my-opus", "my-advisor"] });
    await setModelSettings(endpointsDir, {
      ep_a: {
        models: {
          "my-opus": { upstreamName: "claude-opus-4-8" },
          "my-advisor": { upstreamName: "claude-opus-5-5" },
        },
      },
    });
    const advisor = { type: "advisor_20260301", name: "advisor", model: "relay-a/my-advisor" };

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({
        model: "my-opus",
        stream: true,
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
        tools: [advisor],
      }),
    );

    expect(response.status).toBe(200);
    await response.text();
    expect(receivedBody(upstream.requests[0]).tools).toEqual([
      { ...advisor, model: "claude-opus-5-5" },
    ]);
  });

  test("a Claude id the advisor names without this endpoint's prefix goes as it is, not under an upstream name", async () => {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => streamReply(res);
    const { gateway, endpointsDir } = await start({ upstreamA: upstream });
    await selectModels(endpointsDir, { ep_a: ["claude-opus-4-8", "claude-opus-5-5"] });
    await setModelSettings(endpointsDir, {
      ep_a: { models: { "claude-opus-5-5": { upstreamName: "vendor/opus-5-5" } } },
    });
    const advisor = { type: "advisor_20260301", name: "advisor", model: "claude-opus-5-5" };

    const response = await fetch(
      `${gateway}/v1/messages`,
      claudeRequest({
        model: "relay-a/claude-opus-4-8",
        stream: true,
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
        tools: [advisor],
      }),
    );

    expect(response.status).toBe(200);
    await response.text();
    expect(receivedBody(upstream.requests[0]).tools).toEqual([advisor]);
  });

  test("a DeepSeek model's reasoning is replayed when either its own name or its upstream name says DeepSeek", async () => {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => answerResponsesWhole(res);
    const { gateway, endpointsDir } = await start({
      upstreamA: upstream,
      modelsA: ["ds-alias", "deepseek-v4", "plain"],
    });
    await setModelSettings(endpointsDir, {
      ep_a: {
        models: {
          "ds-alias": { upstreamName: "deepseek-v4-flash" },
          "deepseek-v4": { upstreamName: "vendor/v4" },
        },
      },
    });
    const input = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { type: "reasoning", id: "rs_bare", summary: [] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "again" }] },
    ];
    const keepsReasoning = async (model: string) => {
      const response = await fetch(
        `${gateway}/v1/responses`,
        codexRequest({ model, input, store: false, stream: false }),
      );
      expect(response.status).toBe(200);
      await response.text();
      const sent = receivedBody(upstream.requests.at(-1)).input as { type: string }[];
      return sent.some((item) => item.type === "reasoning");
    };

    expect(await keepsReasoning("ds-alias")).toBe(true);
    expect(await keepsReasoning("deepseek-v4")).toBe(true);
    expect(await keepsReasoning("plain")).toBe(false);
  });

  test("a Grok reply's whole numbers are fixed when either its own name or its upstream name says Grok", async () => {
    const upstream = await startUpstream();
    upstream.respond = (_request, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(grokResponsesWhole(GROK_ARGS_PIECES.join(""))));
    };
    const { gateway, endpointsDir } = await start({
      upstreamA: upstream,
      modelsA: ["fast-alias", "grok-4.6"],
    });
    await setModelSettings(endpointsDir, {
      ep_a: {
        models: {
          "fast-alias": { upstreamName: "grok-4.6-fast" },
          "grok-4.6": { upstreamName: "vendor/fast" },
        },
      },
    });
    const argsOf = async (model: string) => {
      const response = await fetch(
        `${gateway}/v1/responses`,
        codexRequest({ ...codexConversation(model, false), stream: false }),
      );
      expect(response.status).toBe(200);
      const reply = (await response.json()) as { output: { arguments?: string }[] };
      return reply.output[0]?.arguments;
    };

    expect(await argsOf("fast-alias")).toBe(GROK_WHOLE_ARGS);
    expect(await argsOf("grok-4.6")).toBe(GROK_WHOLE_ARGS);
  });

  test("a model pinned to one format is asked only in it, and asked as before once that URL is gone", async () => {
    const upstreamA = await startUpstream();
    upstreamA.respond = (request, res) => {
      if (request.url.startsWith("/v1/responses")) answerResponsesWhole(res);
      else echoAnthropic(request, res);
    };
    const { gateway, endpointsDir } = await start({ upstreamA });
    await setModelSettings(endpointsDir, {
      ep_a: { models: { "kimi-k2": { format: "openai_responses" } } },
    });

    const pinned = await claudeAsk(gateway, { model: "kimi-k2", stream: false });
    expect(pinned.status).toBe(200);
    await pinned.text();
    expect(upstreamA.requests.splice(0).map((request) => request.url)).toEqual(["/v1/responses"]);

    await dropBaseUrl(endpointsDir, { id: "ep_a", format: "openai_responses" });
    const unpinned = await claudeAsk(gateway, { model: "kimi-k2", stream: false });
    expect(unpinned.status).toBe(200);
    await unpinned.text();
    expect(upstreamA.requests.map((request) => request.url)).toEqual(["/v1/messages"]);
  });
});
