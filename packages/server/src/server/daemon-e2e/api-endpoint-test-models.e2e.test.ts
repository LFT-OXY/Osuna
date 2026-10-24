// 用例取自 magpie（https://github.com/yetone/magpie，internal/provider/test.go 的 TestModels、testOne）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

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
import { afterEach, describe, expect, test } from "vitest";
import type { ApiEndpointModelTestResult } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { ManualTimers } from "../test-utils/manual-timers.js";

/*
 * 测试模型（工单 19，prd 第 26–28 条）：真实 daemon + 本机假上游，绝不连真实中转站。
 * 假上游按模型名答：slow-* 一直不答，bad-* 回 404（bad-then-slow-* 在 Chat 上不答），anthropic-refused-* 在 Anthropic 上回 400、
 * Chat 上答，其余都答；cc-only-* 只答 User-Agent 是 Claude Code 的，codex-only-* 只答 originator 是 Codex 的
 * （照「只允许某 CLI」的分组）。请求要流式时按格式回事件流。单个与整批的时限用手动计时器，用例自己决定何时到点。
 */

const MODEL_TIMEOUT_MS = 60_000;
// 比内置的 0.159.0 新：没有 Codex 样本时测试用它。
const FAKE_CODEX_CLI_VERSION = "0.170.2";
const BATCH_TIMEOUT_MS = 600_000;

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

interface UpstreamRequest {
  path: string;
  model: string;
  body: Record<string, unknown>;
  authorization: string | undefined;
  headers: IncomingHttpHeaders;
}

interface FakeUpstream {
  url: string;
  requests: UpstreamRequest[];
  inFlight: number;
  maxInFlight: number;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function startUpstream(): Promise<FakeUpstream> {
  const upstream: FakeUpstream = { url: "", requests: [], inFlight: 0, maxInFlight: 0 };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<
        string,
        unknown
      >;
      // Gemini 的模型名在路径里（…/models/<模型>:generateContent）。
      const geminiModel = GEMINI_METHOD_PATH.exec(request.url ?? "")?.[1];
      let model = typeof body.model === "string" ? body.model : "";
      if (geminiModel !== undefined) model = decodeURIComponent(geminiModel);
      upstream.requests.push({
        path: request.url ?? "",
        model,
        body,
        authorization: request.headers.authorization,
        headers: request.headers,
      });
      upstream.inFlight += 1;
      upstream.maxInFlight = Math.max(upstream.maxInFlight, upstream.inFlight);
      response.on("close", () => {
        upstream.inFlight -= 1;
      });
      const isChat = (request.url ?? "").endsWith("/chat/completions");
      const hangsHere = model.startsWith("slow-") || (model.startsWith("bad-then-slow-") && isChat);
      if (hangsHere) return;
      // 稍等再答，好让并发的请求叠在一起。
      setTimeout(
        () => answer({ path: request.url ?? "", model, headers: request.headers, body, response }),
        30,
      );
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  upstream.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return upstream;
}

const GEMINI_METHOD_PATH = /\/models\/([^/]+):generateContent$/;

// 照 sub2api 一类只放行某 CLI 的分组的说法。
const CLAUDE_CODE_ONLY = "This group only allows Claude Code clients";
const CODEX_ONLY = "This account only allows Codex official clients";

/** 流式回答：Anthropic、Responses、Chat 各自的第一段文字。 */
const STREAMED_ANSWER: Record<string, string> = {
  "/v1/messages": `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } })}\n\n`,
  "/responses": `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "hi" })}\n\n`,
  "/chat/completions": `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n\ndata: [DONE]\n\n`,
};

function answer(input: {
  path: string;
  model: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
  response: ServerResponse;
}): void {
  const { path: url, model, response, headers } = input;
  const isClaudeCode = String(headers["user-agent"] ?? "").startsWith("claude-cli/");
  if (model.startsWith("cc-only-") && !isClaudeCode) {
    sendJson(response, 403, { error: { message: CLAUDE_CODE_ONLY } });
    return;
  }
  if (model.startsWith("codex-only-") && headers.originator !== "codex_cli_rs") {
    sendJson(response, 403, { error: { message: CODEX_ONLY } });
    return;
  }
  if (model.startsWith("stream-fails-") && input.body.stream === true) {
    const failure = JSON.stringify({ type: "error", error: { message: "Overloaded mid-stream" } });
    response
      .writeHead(200, { "content-type": "text/event-stream" })
      .end(`event: error\ndata: ${failure}\n\n`);
    return;
  }
  const streamed = Object.entries(STREAMED_ANSWER).find(([suffix]) => url.endsWith(suffix));
  if (input.body.stream === true && streamed) {
    response.writeHead(200, { "content-type": "text/event-stream" }).end(streamed[1]);
    return;
  }
  if (model.startsWith("bad-")) {
    sendJson(response, 404, { error: { message: `The model ${model} does not exist` } });
    return;
  }
  if (url.endsWith("/v1/messages")) {
    if (model.startsWith("anthropic-refused-")) {
      sendJson(response, 400, { type: "error", error: { message: "not on this API" } });
      return;
    }
    sendJson(response, 200, { type: "message", content: [{ type: "text", text: "hi" }] });
    return;
  }
  if (url.endsWith("/chat/completions")) {
    sendJson(response, 200, { choices: [{ message: { role: "assistant", content: "hi" } }] });
    return;
  }
  if (url.endsWith("/responses")) {
    sendJson(response, 200, { object: "response", output: [] });
    return;
  }
  if (GEMINI_METHOD_PATH.test(url)) {
    sendJson(response, 200, {
      candidates: [{ content: { role: "model", parts: [{ text: "hi" }] } }],
    });
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" }).end("Not Found");
}

interface EndpointInput {
  models: string[];
  baseUrls: { format: string; url: string }[];
  modelSettings?: Record<string, unknown>;
  templateId?: string;
  // 这家的请求头、附加请求体、key 放哪个头（工单 22），原样写进 endpoints.json。
  requestExtras?: Record<string, unknown>;
}

async function start(input: {
  endpoint: (upstreamUrl: string) => EndpointInput;
  disabledModels?: string[];
}) {
  const timers = new ManualTimers();
  const upstream = await startUpstream();
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-test-models-"));
  tempRoots.push(root);
  const endpointsDir = path.join(root, ".paseo", "api-endpoints");
  await mkdir(endpointsDir, { recursive: true });
  const shape = input.endpoint(upstream.url);
  const files = {
    "endpoints.json": {
      endpoints: [
        {
          id: "ep_a",
          slug: "relay-a",
          name: "Relay A",
          baseUrls: shape.baseUrls,
          models: shape.models.map((id) => ({ id })),
          ...(shape.modelSettings ? { modelSettings: shape.modelSettings } : {}),
          ...(shape.templateId ? { templateId: shape.templateId } : {}),
          ...shape.requestExtras,
          enabled: true,
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      agents: {
        claude: { enabled: false, defaultModelId: "" },
        codex: { enabled: false, defaultModelId: "" },
      },
      ...(input.disabledModels ? { disabledModels: input.disabledModels } : {}),
    },
    "keys.json": { keys: { ep_a: "sk-a" } },
  };
  for (const [name, value] of Object.entries(files)) {
    await writeFile(path.join(endpointsDir, name), JSON.stringify(value, null, 2));
  }
  const daemon = await createTestPaseoDaemon({
    paseoHomeRoot: root,
    cleanup: false,
    apiEndpoints: {
      env: { CLAUDE_CONFIG_DIR: path.join(root, "claude"), CODEX_HOME: path.join(root, "codex") },
      homeDir: root,
      modelTests: {
        concurrency: 4,
        modelTimeoutMs: MODEL_TIMEOUT_MS,
        batchTimeoutMs: BATCH_TIMEOUT_MS,
      },
      modelTestTimers: timers,
      // 绝不跑真的 codex：本机 Codex CLI 的版本换成假的。
      readCodexCliVersion: async () => FAKE_CODEX_CLI_VERSION,
    },
  });
  daemons.push(daemon);
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.12.1",
  });
  clients.push(client);
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  return {
    client,
    upstream,
    timers,
    endpointsDir,
    gateway: `http://127.0.0.1:${daemon.port}/api-endpoint-gateway`,
  };
}

/** Anthropic 与 Chat 两个地址，Anthropic 在前。 */
function twoFormats(models: string[]) {
  return (url: string): EndpointInput => ({
    models,
    baseUrls: [
      { format: "anthropic_messages", url: `${url}/a` },
      { format: "openai_chat", url: `${url}/c/v1` },
    ],
  });
}

function byModel(
  results: ApiEndpointModelTestResult[],
): Record<string, ApiEndpointModelTestResult> {
  return Object.fromEntries(results.map((result) => [result.modelId, result]));
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("test models", () => {
  test("tests every served model four at a time, one progress message per model", async () => {
    const models = [
      "ok-1",
      "ok-2",
      "ok-3",
      "ok-4",
      "ok-5",
      "ok-6",
      "bad-model",
      "slow-model",
      "anthropic-refused-model",
    ];
    const { client, upstream, timers } = await start({ endpoint: twoFormats(models) });
    const started: string[][] = [];
    const progress: { modelId: string; done: number; total: number }[] = [];
    const pending = client.apiEndpointTestModels(
      { endpointId: "ep_a" },
      {
        onStarted: ({ modelIds }) => started.push(modelIds),
        onProgress: ({ result, done, total }) =>
          progress.push({ modelId: result.modelId, done, total }),
      },
    );
    // 别的都答完了，只剩 slow-model 挂在上游：这时它到点。
    await waitFor(() => progress.length === 8);
    timers.fire(MODEL_TIMEOUT_MS);
    const response = await pending;

    expect(response.error).toBeNull();
    expect(started).toEqual([models]);
    expect(response.results.map((result) => result.modelId).sort()).toEqual([...models].sort());
    expect(progress.map((entry) => entry.done)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(progress.every((entry) => entry.total === 9)).toBe(true);
    expect(progress.map((entry) => entry.modelId).sort()).toEqual([...models].sort());
    expect(upstream.maxInFlight).toBe(4);

    const results = byModel(response.results);
    expect(results["ok-1"]).toMatchObject({
      ok: true,
      format: "anthropic_messages",
      status: 200,
      error: null,
    });
    expect(results["bad-model"]).toMatchObject({
      ok: false,
      format: "anthropic_messages",
      status: 404,
      error: { code: "upstream_error" },
    });
    // 原因只是上游的原文：不带请求地址与状态码（状态码另有字段）。
    expect(results["bad-model"]?.error?.message).toBe("The model bad-model does not exist");
    expect(results["slow-model"]).toMatchObject({
      ok: false,
      format: "anthropic_messages",
      status: null,
      error: { code: "upstream_timeout", params: { seconds: "60" } },
    });
    // 按地址依次试：Anthropic 拒了再问 Chat。
    expect(results["anthropic-refused-model"]).toMatchObject({
      ok: true,
      format: "openai_chat",
      status: 200,
    });
    expect(
      upstream.requests
        .filter((request) => request.model === "anthropic-refused-model")
        .map((request) => request.path),
    ).toEqual(["/a/v1/messages", "/c/v1/chat/completions"]);

    // 一条「hi」，回复上限 16，带这家的 key。
    const okRequest = upstream.requests.find((request) => request.model === "ok-1");
    expect(okRequest?.body).toEqual({
      model: "ok-1",
      max_tokens: 16,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(okRequest?.authorization).toBe("Bearer sk-a");
  });

  test("a disabled model gets no request, and a pinned model is asked only in its format", async () => {
    const { client, upstream } = await start({
      endpoint: (url) => ({
        models: ["gpt-5-preview", "pinned-model", "responses-model"],
        baseUrls: [
          { format: "anthropic_messages", url: `${url}/a` },
          { format: "openai_chat", url: `${url}/c/v1` },
          { format: "openai_responses", url: `${url}/r/v1` },
        ],
        modelSettings: {
          models: {
            "pinned-model": { format: "openai_chat" },
            "responses-model": { format: "openai_responses" },
          },
        },
      }),
      disabledModels: ["*-PREVIEW"],
    });
    const response = await client.apiEndpointTestModels({ endpointId: "ep_a" });

    const results = byModel(response.results);
    expect(results["gpt-5-preview"]).toMatchObject({
      ok: false,
      format: null,
      status: null,
      error: { code: "model_disabled", params: { model: "gpt-5-preview", pattern: "*-PREVIEW" } },
    });
    expect(upstream.requests.some((request) => request.model === "gpt-5-preview")).toBe(false);
    expect(results["pinned-model"]).toMatchObject({ ok: true, format: "openai_chat" });
    expect(
      upstream.requests
        .filter((request) => request.model === "pinned-model")
        .map((request) => request.path),
    ).toEqual(["/c/v1/chat/completions"]);
    // Responses 的回复上限用它自己的字段。
    const responsesRequest = upstream.requests.find(
      (request) => request.model === "responses-model",
    );
    expect(responsesRequest?.path).toBe("/r/v1/responses");
    expect(responsesRequest?.body).toEqual({
      model: "responses-model",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      max_output_tokens: 16,
    });
  });

  // 任务 10-16-gemini-upstream 工单 05：Gemini 地址也能测（magpie testOne 的 protos 含 Gemini）。
  test("a model pinned to Gemini, or on a Gemini-only endpoint, is tested at the Gemini base URL", async () => {
    const { client, upstream } = await start({
      endpoint: (url) => ({
        models: ["gem-pinned", "bad-gem"],
        baseUrls: [
          { format: "openai_chat", url: `${url}/c/v1` },
          { format: "gemini", url: `${url}/g/v1beta` },
        ],
        modelSettings: {
          models: { "gem-pinned": { format: "gemini" }, "bad-gem": { format: "gemini" } },
        },
      }),
    });
    const response = await client.apiEndpointTestModels({ endpointId: "ep_a" });

    const results = byModel(response.results);
    expect(results["gem-pinned"]).toMatchObject({ ok: true, format: "gemini", status: 200 });
    expect(results["bad-gem"]).toMatchObject({ ok: false, format: "gemini", status: 404 });
    expect(results["bad-gem"]?.error?.message).toContain("does not exist");
    const pinned = upstream.requests.filter((request) => request.model === "gem-pinned");
    expect(pinned.map((request) => request.path)).toEqual([
      "/g/v1beta/models/gem-pinned:generateContent",
    ]);
    expect(pinned[0]?.headers["x-goog-api-key"]).toBe("sk-a");
    expect(pinned[0]?.authorization).toBeUndefined();
    expect(pinned[0]?.body).toEqual({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig: { maxOutputTokens: 16 },
    });
  });

  test("testing one model asks only that one, even one the endpoint does not serve", async () => {
    const { client, upstream } = await start({
      endpoint: twoFormats(["ok-1", "ok-2"]),
    });
    const response = await client.apiEndpointTestModels({
      endpointId: "ep_a",
      modelId: "catalog-only",
    });

    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({ modelId: "catalog-only", ok: true });
    expect(upstream.requests.map((request) => request.model)).toEqual(["catalog-only"]);
  });

  test("cancelling stops sending, and the response carries what finished", async () => {
    const { client, upstream } = await start({
      endpoint: twoFormats(["ok-1", "slow-1", "slow-2", "slow-3", "slow-4", "slow-5", "slow-6"]),
    });
    const requestId = "test-models-cancel";
    const pending = client.apiEndpointTestModels({ endpointId: "ep_a" }, { requestId });
    // ok-1 答完后补上一个，四个慢的都挂在上游。
    await waitFor(() => upstream.inFlight === 4 && upstream.requests.length === 5);
    const cancel = await client.apiEndpointCancel(requestId);
    const response = await pending;

    expect(cancel.cancelled).toBe(true);
    expect(response.error).toMatchObject({ code: "cancelled" });
    expect(response.results.map((result) => result.modelId)).toEqual(["ok-1"]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(upstream.requests).toHaveLength(5);
  });

  test("a batch over its time limit ends every model left with batch_timeout", async () => {
    const models = ["slow-1", "slow-2", "slow-3", "slow-4", "slow-5", "slow-6"];
    const { client, upstream, timers } = await start({ endpoint: twoFormats(models) });
    const progress: string[] = [];
    const pending = client.apiEndpointTestModels(
      { endpointId: "ep_a" },
      { onProgress: ({ result }) => progress.push(result.modelId) },
    );
    await waitFor(() => upstream.inFlight === 4);
    timers.fire(BATCH_TIMEOUT_MS);
    const response = await pending;

    expect(response.error).toBeNull();
    expect(response.results).toHaveLength(6);
    expect(response.results.every((result) => result.error?.code === "batch_timeout")).toBe(true);
    expect(progress.sort()).toEqual([...models].sort());
    expect(upstream.requests).toHaveLength(4);
  });

  test("a later format that times out keeps the first format's reason", async () => {
    const { client, upstream, timers } = await start({
      endpoint: twoFormats(["bad-then-slow-model"]),
    });
    const pending = client.apiEndpointTestModels({ endpointId: "ep_a" });
    // Anthropic 回了 404，再问 Chat 时挂住，这时到点。
    await waitFor(() => upstream.requests.length === 2 && upstream.inFlight === 1);
    timers.fire(MODEL_TIMEOUT_MS);
    const response = await pending;

    expect(response.results).toEqual([
      {
        modelId: "bad-then-slow-model",
        ok: false,
        format: "anthropic_messages",
        status: 404,
        durationMs: expect.any(Number),
        error: { code: "upstream_error", message: "The model bad-then-slow-model does not exist" },
      },
    ]);
  });

  // 接口管理好用性工单 22：测试模型也带这家的请求头与附加请求体，按 CLI 的样子测时用户的头仍在 CLI 的之上（magpie Sign）。
  test("plain and CLI-style tests carry the endpoint's headers and extra body, the user's headers last", async () => {
    const { client, upstream } = await start({
      endpoint: (url) => ({
        ...twoFormats(["ok-1"])(url),
        baseUrls: [
          { format: "anthropic_messages", url: `${url}/a` },
          { format: "openai_responses", url: `${url}/r/v1` },
        ],
        requestExtras: {
          headers: { "X-Relay-Team": "team-t", "User-Agent": "relay-app/1.0" },
          extraBody: { prompt_cache_key: "${sessionId}" },
          keyHeader: "x-api-key",
        },
      }),
    });

    const plain = await client.apiEndpointTestModels({ endpointId: "ep_a" });
    expect(plain.results[0]).toMatchObject({ ok: true, format: "anthropic_messages" });
    const asCodex = await client.apiEndpointTestModels({ endpointId: "ep_a", method: "codex" });
    expect(asCodex.results[0]).toMatchObject({ ok: true, format: "openai_responses" });

    const [anthropic, codex] = upstream.requests;
    expect(anthropic?.headers["x-relay-team"]).toBe("team-t");
    expect(anthropic?.headers["x-api-key"]).toBe("sk-a");
    expect(anthropic?.authorization).toBeUndefined();
    expect(String(anthropic?.body.prompt_cache_key)).toMatch(/^osuna-test-[0-9a-f]{12}$/);
    expect(codex?.headers["x-relay-team"]).toBe("team-t");
    expect(codex?.headers.originator).toBe("codex_cli_rs");
    expect(codex?.headers["user-agent"]).toBe("relay-app/1.0");
    expect(String(codex?.body.prompt_cache_key)).toMatch(/^osuna-test-/);
  });

  test("an unknown endpoint and an unknown method are refused before any request", async () => {
    const { client, upstream } = await start({
      endpoint: twoFormats(["ok-1"]),
    });
    const missing = await client.apiEndpointTestModels({ endpointId: "ep_missing" });
    expect(missing).toMatchObject({ results: [], error: { code: "not_found" } });
    const method = await client.apiEndpointTestModels({
      endpointId: "ep_a",
      method: "a_future_method",
    });
    expect(method).toMatchObject({ results: [], error: { code: "invalid_input" } });
    expect(upstream.requests).toHaveLength(0);
  });
});

const CLAUDE_CODE_UA = "claude-cli/2.1.302 (external, cli)";
const CODEX_UA = "codex_cli_rs/0.162.3 (Mac OS 26.6.0; arm64) kitty";
// 这些只属于会话、账号或签名，样本里一个都不能有。
const SECRETS = [
  "gateway-token-1",
  "account-secret-1",
  "session-secret-1",
  "beta-secret-1",
  "cookie-secret-1",
  "request-secret-1",
];

/** 经中转站发一条 Claude Code 的请求（带认证、会话、beta、Cookie 等不该进样本的头）。 */
async function claudeCodeThroughGateway(input: { gateway: string; model: string }) {
  const response = await fetch(`${input.gateway}/v1/messages`, {
    method: "POST",
    headers: {
      "user-agent": CLAUDE_CODE_UA,
      "x-app": "cli",
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "anthropic-beta": "claude-code-20250219,beta-secret-1",
      "x-stainless-lang": "js",
      "x-claude-code-session-id": "session-secret-1",
      authorization: "Bearer gateway-token-1",
      "x-api-key": "gateway-token-1",
      cookie: "id=cookie-secret-1",
      "x-client-request-id": "request-secret-1",
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 32,
      messages: [{ role: "user", content: "a prompt that must never be kept" }],
    }),
  });
  expect(response.status).toBe(200);
  await response.text();
}

function testsAsOf(
  endpoints: { id: string; testsAs?: { method: string; unavailable: unknown }[] }[],
) {
  return endpoints.find((endpoint) => endpoint.id === "ep_a")?.testsAs;
}

describe("test models as Claude Code or Codex", () => {
  test("a Claude Code request through the gateway leaves a sample with no secrets, and testing as Claude Code sends it", async () => {
    const { client, upstream, endpointsDir, gateway } = await start({
      endpoint: twoFormats(["cc-only-sonnet"]),
    });
    await claudeCodeThroughGateway({ gateway, model: "cc-only-sonnet" });

    const samplePath = path.join(endpointsDir, "cli-header-samples.json");
    const text = await readFile(samplePath, "utf8");
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(text).not.toContain("a prompt that must never be kept");
    expect(JSON.parse(text)).toEqual({
      claude_code: {
        "user-agent": CLAUDE_CODE_UA,
        "x-app": "cli",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "x-stainless-lang": "js",
      },
    });
    if (process.platform !== "win32") expect((await stat(samplePath)).mode & 0o777).toBe(0o600);

    const listed = await client.apiEndpointList("claude");
    expect(testsAsOf(listed.endpoints)).toEqual([
      { method: "codex", unavailable: null },
      { method: "claude_code", unavailable: null },
    ]);

    // 普通的测试被只放行 Claude Code 的分组拒掉；按 Claude Code 的样子测能用。
    const plain = await client.apiEndpointTestModels({ endpointId: "ep_a" });
    expect(plain.results[0]).toMatchObject({ ok: false, status: 403 });
    upstream.requests.length = 0;
    const asClaudeCode = await client.apiEndpointTestModels({
      endpointId: "ep_a",
      modelId: "cc-only-sonnet",
      method: "claude_code",
    });
    expect(asClaudeCode.error).toBeNull();
    expect(asClaudeCode.results).toEqual([
      {
        modelId: "cc-only-sonnet",
        ok: true,
        format: "anthropic_messages",
        status: 200,
        durationMs: expect.any(Number),
        error: null,
      },
    ]);
    expect(upstream.requests).toHaveLength(1);
    const [sent] = upstream.requests;
    expect(sent?.path).toBe("/a/v1/messages");
    expect(sent?.headers).toMatchObject({
      "user-agent": CLAUDE_CODE_UA,
      "x-app": "cli",
      "anthropic-dangerous-direct-browser-access": "true",
      "x-stainless-lang": "js",
      accept: "application/json, text/event-stream",
      authorization: "Bearer sk-a",
    });
    expect(sent?.headers["anthropic-beta"]).toBeUndefined();
    expect(sent?.headers["x-claude-code-session-id"]).toBeUndefined();
    expect(sent?.body).toMatchObject({ model: "cc-only-sonnet", stream: true });
  });

  test("a Claude Code request for a model no endpoint serves still leaves its sample", async () => {
    const { upstream, endpointsDir, gateway } = await start({
      endpoint: twoFormats(["cc-only-sonnet"]),
    });
    const response = await fetch(`${gateway}/v1/messages`, {
      method: "POST",
      headers: {
        "user-agent": CLAUDE_CODE_UA,
        "x-app": "cli",
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "no-such-model",
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(response.status).toBe(404);
    await response.text();
    const text = await readFile(path.join(endpointsDir, "cli-header-samples.json"), "utf8");
    expect(JSON.parse(text)).toEqual({
      claude_code: {
        "user-agent": CLAUDE_CODE_UA,
        "x-app": "cli",
        "anthropic-version": "2023-06-01",
      },
    });
    expect(upstream.requests).toHaveLength(0);
  });

  test("without a Claude Code sample, testing as Claude Code sends nothing and says to use Claude Code with API endpoints first", async () => {
    const { client, upstream } = await start({
      endpoint: (url) => ({ ...twoFormats(["claude-sonnet-4-5"])(url), templateId: "openrouter" }),
    });
    const listed = await client.apiEndpointList("claude");
    expect(testsAsOf(listed.endpoints)).toEqual([
      { method: "codex", unavailable: null },
      {
        method: "claude_code",
        unavailable: {
          code: "cli_sample_missing",
          message: expect.stringContaining("API endpoints"),
        },
      },
    ]);
    const response = await client.apiEndpointTestModels({
      endpointId: "ep_a",
      method: "claude_code",
    });

    expect(response.error).toBeNull();
    expect(response.results).toEqual([
      {
        modelId: "claude-sonnet-4-5",
        ok: false,
        format: null,
        status: null,
        durationMs: 0,
        error: {
          code: "cli_sample_missing",
          message:
            "Claude Code hasn't used API endpoints yet: use Claude Code once with Use API endpoints on, then test again",
        },
      },
    ]);
    expect(upstream.requests).toHaveLength(0);
  });

  test("an endpoint from a vendor's template, or without an Anthropic URL, is not tested as Claude Code", async () => {
    const vendor = await start({
      endpoint: (url) => ({ ...twoFormats(["deepseek-chat"])(url), templateId: "deepseek" }),
    });
    const listed = await vendor.client.apiEndpointList("claude");
    expect(testsAsOf(listed.endpoints)).toEqual([{ method: "codex", unavailable: null }]);
    const refused = await vendor.client.apiEndpointTestModels({
      endpointId: "ep_a",
      method: "claude_code",
    });
    expect(refused).toMatchObject({ results: [], error: { code: "invalid_input" } });
    expect(vendor.upstream.requests).toHaveLength(0);

    // 「自定义」加的，地址却是 Anthropic 自己的或 Bedrock 的：同样不冒充 Claude Code。
    for (const anthropicUrl of [
      "https://api.anthropic.com",
      "https://bedrock-runtime.us-east-1.amazonaws.com",
    ]) {
      const ownApi = await start({
        endpoint: () => ({
          models: ["claude-sonnet-4-5"],
          baseUrls: [{ format: "anthropic_messages", url: anthropicUrl }],
        }),
      });
      const ownListed = await ownApi.client.apiEndpointList("claude");
      expect(testsAsOf(ownListed.endpoints)).toEqual([]);
    }

    const chatOnly = await start({
      endpoint: (url) => ({
        models: ["glm-5"],
        baseUrls: [{ format: "openai_chat", url: `${url}/c/v1` }],
      }),
    });
    const chatListed = await chatOnly.client.apiEndpointList("claude");
    expect(testsAsOf(chatListed.endpoints)).toEqual([{ method: "codex", unavailable: null }]);
  });

  test("without a Codex sample, testing as Codex says it is Codex CLI, on Responses when the endpoint has it", async () => {
    const { client, upstream } = await start({
      endpoint: (url) => ({
        models: ["codex-only-gpt"],
        baseUrls: [
          { format: "anthropic_messages", url: `${url}/a` },
          { format: "openai_chat", url: `${url}/c/v1` },
          { format: "openai_responses", url: `${url}/r/v1` },
        ],
        templateId: "deepseek",
      }),
    });
    const plain = await client.apiEndpointTestModels({ endpointId: "ep_a" });
    expect(plain.results.every((result) => !result.ok)).toBe(true);
    upstream.requests.length = 0;
    const response = await client.apiEndpointTestModels({ endpointId: "ep_a", method: "codex" });

    expect(response.results[0]).toMatchObject({ ok: true, format: "openai_responses" });
    expect(upstream.requests).toHaveLength(1);
    const [sent] = upstream.requests;
    expect(sent?.path).toBe("/r/v1/responses");
    expect(sent?.headers.originator).toBe("codex_cli_rs");
    expect(sent?.headers["user-agent"]).toMatch(/^codex_cli_rs\/0\.170\.2 \(.+; .+\) \S+$/);
    expect(sent?.headers.version).toBe(FAKE_CODEX_CLI_VERSION);
    expect(sent?.headers.authorization).toBe("Bearer sk-a");
    expect(sent?.body).toMatchObject({ stream: true, store: false });
  });

  test("a Codex request translated to a Chat-only endpoint carries Codex's identity and leaves its sample, and testing as Codex goes to Chat", async () => {
    const { client, upstream, endpointsDir, gateway } = await start({
      endpoint: (url) => ({
        models: ["codex-only-glm", "stream-fails-glm"],
        baseUrls: [{ format: "openai_chat", url: `${url}/c/v1` }],
      }),
    });
    // Codex 只走 /v1/responses；这家只有 Chat，中转站翻过去。
    const response = await fetch(`${gateway}/v1/responses`, {
      method: "POST",
      headers: {
        "user-agent": CODEX_UA,
        originator: "codex_cli_rs",
        version: "0.162.3",
        "content-type": "application/json",
        "session-id": "session-secret-1",
        "thread-id": "session-secret-1",
        "x-codex-turn-metadata": '{"turn_id":"session-secret-1"}',
        "x-codex-beta-features": "collab",
        authorization: "Bearer gateway-token-1",
        cookie: "id=cookie-secret-1",
        "chatgpt-account-id": "account-secret-1",
      },
      body: JSON.stringify({
        model: "codex-only-glm",
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "a prompt that must never be kept" }],
          },
        ],
      }),
    });
    // 翻成 Chat 的请求照原样带着 Codex 的身份头，只放行 Codex 的分组收下了它；中转站的口令不带过去。
    expect(response.status).toBe(200);
    await response.text();
    const relayed = upstream.requests.find((request) => request.model === "codex-only-glm");
    expect(relayed?.path).toBe("/c/v1/chat/completions");
    expect(relayed?.headers).toMatchObject({
      "user-agent": CODEX_UA,
      originator: "codex_cli_rs",
      version: "0.162.3",
      "x-codex-beta-features": "collab",
      authorization: "Bearer sk-a",
    });
    expect(relayed?.headers.cookie).toBeUndefined();
    expect(relayed?.headers["chatgpt-account-id"]).toBeUndefined();
    expect(JSON.stringify(relayed?.headers)).not.toContain("gateway-token-1");
    const text = await readFile(path.join(endpointsDir, "cli-header-samples.json"), "utf8");
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(JSON.parse(text)).toEqual({
      codex: {
        "user-agent": CODEX_UA,
        originator: "codex_cli_rs",
        version: "0.162.3",
        "x-codex-beta-features": "collab",
      },
    });

    upstream.requests.length = 0;
    const tested = await client.apiEndpointTestModels({ endpointId: "ep_a", method: "codex" });
    const results = byModel(tested.results);
    expect(results["codex-only-glm"]).toMatchObject({ ok: true, format: "openai_chat" });
    // 流里先报了错：照 magpie 读到第一段文字或错误为止，报的是那个错误。
    expect(results["stream-fails-glm"]).toMatchObject({
      ok: false,
      format: "openai_chat",
      status: 200,
      error: { code: "upstream_error", message: "Overloaded mid-stream" },
    });
    const sent = upstream.requests.find((request) => request.model === "codex-only-glm");
    expect(sent?.path).toBe("/c/v1/chat/completions");
    expect(sent?.headers).toMatchObject({
      "user-agent": CODEX_UA,
      originator: "codex_cli_rs",
      "x-codex-beta-features": "collab",
    });
    expect(sent?.headers["session-id"]).toBeUndefined();
    expect(sent?.body).toMatchObject({ stream: true });
    expect(sent?.body.store).toBeUndefined();
  });
});
