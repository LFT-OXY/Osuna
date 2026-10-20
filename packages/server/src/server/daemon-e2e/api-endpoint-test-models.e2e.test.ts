// 用例取自 magpie（https://github.com/yetone/magpie，internal/provider/test.go 的 TestModels、testOne）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ApiEndpointModelTestResult } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * 测试模型（工单 19，prd 第 26–28 条）：真实 daemon + 本机假上游，绝不连真实中转站。
 * 假上游按模型名答：slow-* 一直不答，bad-* 回 404，anthropic-refused-* 在 Anthropic 上回 400、Chat 上答，其余都答。
 */

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
      const model = typeof body.model === "string" ? body.model : "";
      upstream.requests.push({
        path: request.url ?? "",
        model,
        body,
        authorization: request.headers.authorization,
      });
      upstream.inFlight += 1;
      upstream.maxInFlight = Math.max(upstream.maxInFlight, upstream.inFlight);
      response.on("close", () => {
        upstream.inFlight -= 1;
      });
      if (model.startsWith("slow-")) return;
      // 稍等再答，好让并发的请求叠在一起。
      setTimeout(() => answer({ path: request.url ?? "", model, response }), 30);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  upstream.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return upstream;
}

function answer(input: { path: string; model: string; response: ServerResponse }): void {
  const { path: url, model, response } = input;
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
  response.writeHead(404, { "content-type": "text/plain" }).end("Not Found");
}

interface EndpointInput {
  models: string[];
  baseUrls: { format: string; url: string }[];
  modelSettings?: Record<string, unknown>;
}

async function start(input: {
  endpoint: (upstreamUrl: string) => EndpointInput;
  disabledModels?: string[];
  modelTests: { concurrency?: number; modelTimeoutMs?: number; batchTimeoutMs?: number };
}) {
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
      modelTests: input.modelTests,
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
  return { client, upstream };
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
    const { client, upstream } = await start({
      endpoint: twoFormats(models),
      modelTests: { concurrency: 4, modelTimeoutMs: 300, batchTimeoutMs: 10_000 },
    });
    const progress: { modelId: string; done: number; total: number }[] = [];
    const response = await client.apiEndpointTestModels(
      { endpointId: "ep_a" },
      {
        onProgress: ({ result, done, total }) =>
          progress.push({ modelId: result.modelId, done, total }),
      },
    );

    expect(response.error).toBeNull();
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
    expect(results["bad-model"]?.error?.message).toContain("does not exist");
    expect(results["slow-model"]).toMatchObject({
      ok: false,
      status: null,
      error: { code: "upstream_timeout" },
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
      modelTests: { concurrency: 4, modelTimeoutMs: 2_000, batchTimeoutMs: 10_000 },
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

  test("testing one model asks only that one, even one the endpoint does not serve", async () => {
    const { client, upstream } = await start({
      endpoint: twoFormats(["ok-1", "ok-2"]),
      modelTests: { concurrency: 4, modelTimeoutMs: 2_000, batchTimeoutMs: 10_000 },
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
      modelTests: { concurrency: 4, modelTimeoutMs: 60_000, batchTimeoutMs: 120_000 },
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
    const { client, upstream } = await start({
      endpoint: twoFormats(models),
      modelTests: { concurrency: 4, modelTimeoutMs: 60_000, batchTimeoutMs: 300 },
    });
    const progress: string[] = [];
    const response = await client.apiEndpointTestModels(
      { endpointId: "ep_a" },
      { onProgress: ({ result }) => progress.push(result.modelId) },
    );

    expect(response.error).toBeNull();
    expect(response.results).toHaveLength(6);
    expect(response.results.every((result) => result.error?.code === "batch_timeout")).toBe(true);
    expect(progress.sort()).toEqual([...models].sort());
    expect(upstream.requests).toHaveLength(4);
  });

  test("an unknown endpoint and an unknown method are refused before any request", async () => {
    const { client, upstream } = await start({
      endpoint: twoFormats(["ok-1"]),
      modelTests: {},
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
