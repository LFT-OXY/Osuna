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
import { ManualTimers } from "../test-utils/manual-timers.js";

// 自动检测请求格式。上游是本地假 HTTP 服务，绝不访问真实的中转站。
const SAVED_KEY = "sk-saved-secret";
const TYPED_KEY = "sk-typed-secret";

interface FakeUpstream {
  origin: string;
  requests: {
    method: string;
    url: string;
    headers: IncomingHttpHeaders;
    body: Record<string, unknown>;
  }[];
  // 列出模型时回的状态码；200 即正常列出。
  modelsStatus: number;
}

const tempRoots: string[] = [];
const servers: Server[] = [];

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

/**
 * /relay 下有 Anthropic Messages 与 OpenAI Chat，没有 Responses（框架默认的 404）。
 * 只认两把 key，Anthropic 地址两种认证头任一即可。
 */
async function startUpstream(): Promise<FakeUpstream> {
  const upstream: FakeUpstream = { origin: "", requests: [], modelsStatus: 200 };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<
        string,
        unknown
      >;
      upstream.requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body,
      });
      const keys = [`Bearer ${TYPED_KEY}`, `Bearer ${SAVED_KEY}`];
      const authorized = keys.includes(request.headers.authorization ?? "");
      if (!authorized) {
        sendJson(response, 401, { error: { message: "Invalid API key", type: "invalid_request" } });
        return;
      }
      if (request.method === "GET" && request.url === "/relay/v1/models") {
        if (upstream.modelsStatus !== 200) {
          response.writeHead(upstream.modelsStatus, { "content-type": "text/plain" }).end("nope");
          return;
        }
        sendJson(response, 200, {
          object: "list",
          data: [{ id: "deepseek-chat" }, { id: "claude-sonnet-4-5" }, { id: "gpt-5" }],
        });
        return;
      }
      if (request.method === "POST" && request.url === "/relay/v1/messages") {
        sendJson(response, 200, { type: "message", content: [{ type: "text", text: "h" }] });
        return;
      }
      if (request.method === "POST" && request.url === "/relay/v1/chat/completions") {
        sendJson(response, 200, {
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: "h" } }],
        });
        return;
      }
      response.writeHead(404, { "content-type": "text/plain" }).end("Not Found");
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  upstream.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return upstream;
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("API endpoint request format detection over the daemon RPC", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let upstream: FakeUpstream;

  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-detect-"));
    tempRoots.push(root);
    upstream = await startUpstream();
    daemon = await createTestPaseoDaemon({
      apiEndpoints: {
        env: {
          CLAUDE_CONFIG_DIR: path.join(root, "claude"),
          CODEX_HOME: path.join(root, "codex"),
        },
        homeDir: root,
      },
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.16.0" });
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

  test("asks each format once at its own base and reports which ones answered", async () => {
    const detected = await client.apiEndpointDetectFormats({
      baseUrl: `${upstream.origin}/relay/`,
      apiKey: TYPED_KEY,
    });

    expect(detected.error).toBeNull();
    expect(detected.results).toEqual([
      {
        format: "anthropic_messages",
        url: `${upstream.origin}/relay`,
        status: "ok",
        httpStatus: 200,
        message: null,
        durationMs: expect.any(Number),
        modelId: "claude-sonnet-4-5",
      },
      {
        format: "openai_chat",
        url: `${upstream.origin}/relay/v1`,
        status: "ok",
        httpStatus: 200,
        message: null,
        durationMs: expect.any(Number),
        modelId: "deepseek-chat",
      },
      {
        format: "openai_responses",
        url: `${upstream.origin}/relay/v1`,
        status: "not_detected",
        httpStatus: 404,
        message: `POST ${upstream.origin}/relay/v1/responses: HTTP 404: Not Found`,
        durationMs: expect.any(Number),
        modelId: "gpt-5",
      },
    ]);

    // 先列一次模型挑人选，再每种格式各问一次：Anthropic 问 Claude 模型，Responses 问 OpenAI 模型，
    // Chat 问第一个非 Claude 的模型。
    const posts = upstream.requests
      .filter((request) => request.method === "POST")
      .map((request) => ({ url: request.url, model: request.body.model }))
      .sort((a, b) => a.url.localeCompare(b.url));
    expect(posts).toEqual([
      { url: "/relay/v1/chat/completions", model: "deepseek-chat" },
      { url: "/relay/v1/messages", model: "claude-sonnet-4-5" },
      { url: "/relay/v1/responses", model: "gpt-5" },
    ]);
    const anthropic = upstream.requests.find((request) => request.url === "/relay/v1/messages");
    expect(anthropic?.headers["x-api-key"]).toBe(TYPED_KEY);
    expect(anthropic?.headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.stringify(detected)).not.toContain(TYPED_KEY);
  });

  test("an endpoint pasted whole is cut back to each format's base", async () => {
    const detected = await client.apiEndpointDetectFormats({
      baseUrl: `${upstream.origin}/relay/v1/chat/completions`,
      apiKey: TYPED_KEY,
    });

    expect(detected.results.map(({ format, url, status }) => ({ format, url, status }))).toEqual([
      { format: "anthropic_messages", url: `${upstream.origin}/relay`, status: "ok" },
      { format: "openai_chat", url: `${upstream.origin}/relay/v1`, status: "ok" },
      { format: "openai_responses", url: `${upstream.origin}/relay/v1`, status: "not_detected" },
    ]);
  });

  test("a rejected key marks every format as auth_failed without trying them", async () => {
    const detected = await client.apiEndpointDetectFormats({
      baseUrl: `${upstream.origin}/relay`,
      apiKey: "sk-wrong",
    });

    expect(detected.error).toBeNull();
    expect(
      detected.results.map(({ format, status, httpStatus }) => [format, status, httpStatus]),
    ).toEqual([
      ["anthropic_messages", "auth_failed", 401],
      ["openai_chat", "auth_failed", 401],
      ["openai_responses", "auth_failed", 401],
    ]);
    expect(detected.results[0]?.message).toContain("Invalid API key");
    expect(upstream.requests.filter((request) => request.method === "POST")).toEqual([]);
    expect(JSON.stringify(detected)).not.toContain("sk-wrong");
  });

  test("without a model list there is no model to try, and nothing is asked", async () => {
    upstream.modelsStatus = 404;

    const detected = await client.apiEndpointDetectFormats({
      baseUrl: `${upstream.origin}/relay`,
      apiKey: TYPED_KEY,
    });

    expect(detected.results.map(({ status, httpStatus }) => [status, httpStatus])).toEqual([
      ["not_detected", null],
      ["not_detected", null],
      ["not_detected", null],
    ]);
    expect(detected.results.map((result) => result.message)).toEqual(
      detected.results.map(
        () =>
          `Could not list models to try: GET ${upstream.origin}/relay/v1/models: HTTP 404: nope\n` +
          `GET ${upstream.origin}/relay/models: HTTP 404: Not Found`,
      ),
    );
    expect(detected.results.map((result) => result.code)).toEqual(
      Array(3).fill("models_list_failed"),
    );
    expect(detected.results[0]?.params?.detail).toContain("HTTP 404: nope");
    expect(upstream.requests.filter((request) => request.method === "POST")).toEqual([]);
  });

  test("the host's own reasons carry a code: an answer in another shape, and an address nobody listens on", async () => {
    const wrongShape = createServer((_request, response) => sendJson(response, 200, {}));
    servers.push(wrongShape);
    await new Promise<void>((resolve) => wrongShape.listen(0, "127.0.0.1", resolve));
    const shapeOrigin = `http://127.0.0.1:${(wrongShape.address() as AddressInfo).port}`;
    const shaped = await client.apiEndpointDetectFormats({
      baseUrl: shapeOrigin,
      apiKey: TYPED_KEY,
      modelId: "my-model",
    });
    expect(
      shaped.results.map(({ httpStatus, code, params }) => [httpStatus, code, params]),
    ).toEqual([
      [200, "wrong_shape", { format: "anthropic_messages" }],
      [200, "wrong_shape", { format: "openai_chat" }],
      [200, "wrong_shape", { format: "openai_responses" }],
    ]);

    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const closedOrigin = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const unreachable = await client.apiEndpointDetectFormats({
      baseUrl: closedOrigin,
      apiKey: TYPED_KEY,
      modelId: "my-model",
    });
    for (const result of unreachable.results) {
      expect(result).toMatchObject({ httpStatus: null, code: "upstream_unreachable" });
      expect(result.params?.detail).toBeTruthy();
    }
  });

  test("with no model list, a model typed to try is asked on every format", async () => {
    upstream.modelsStatus = 404;

    const detected = await client.apiEndpointDetectFormats({
      baseUrl: `${upstream.origin}/relay`,
      apiKey: TYPED_KEY,
      modelId: " my-model ",
    });

    expect(
      detected.results.map(({ format, status, modelId }) => [format, status, modelId]),
    ).toEqual([
      ["anthropic_messages", "ok", "my-model"],
      ["openai_chat", "ok", "my-model"],
      ["openai_responses", "not_detected", "my-model"],
    ]);
    for (const result of detected.results) expect(result.durationMs).toBeGreaterThanOrEqual(0);
    // 指定了模型就不列清单。
    expect(upstream.requests.filter((request) => request.method === "GET")).toEqual([]);
    expect(
      upstream.requests.filter((request) => request.method === "POST").map((r) => r.body.model),
    ).toEqual(["my-model", "my-model", "my-model"]);
  });

  test("the form's picked models are tried per format before the vendor's list", async () => {
    const detected = await client.apiEndpointDetectFormats({
      baseUrl: `${upstream.origin}/relay`,
      apiKey: TYPED_KEY,
      modelIds: ["kimi-k2", "claude-opus-5", "gpt-6"],
    });

    expect(detected.results.map((result) => result.modelId)).toEqual([
      "claude-opus-5",
      "kimi-k2",
      "gpt-6",
    ]);
    expect(upstream.requests.filter((request) => request.method === "GET")).toEqual([]);
  });

  // 接口管理好用性工单 22：表单里还没保存的请求头、附加请求体与 key 头，单次检测也带。
  test("asks with the form's unsaved headers, extra body and key header", async () => {
    const detected = await client.apiEndpointDetectFormats({
      baseUrl: `${upstream.origin}/relay`,
      apiKey: TYPED_KEY,
      modelId: "claude-sonnet-4-5",
      headers: { "X-Relay-Team": "typed" },
      extraBody: { "!max_tokens": 4, prompt_cache_key: "${sessionId}" },
      keyHeader: "bearer",
    });

    expect(detected.error).toBeNull();
    const posts = upstream.requests.filter((request) => request.method === "POST");
    expect(posts).toHaveLength(3);
    for (const post of posts) {
      expect(post.headers["x-relay-team"]).toBe("typed");
      expect(String(post.body.prompt_cache_key)).toMatch(/^osuna-test-/);
    }
    const anthropic = posts.find((post) => post.url === "/relay/v1/messages");
    expect(anthropic?.headers["x-api-key"]).toBeUndefined();
    expect(anthropic?.body.max_tokens).toBe(4);
  });

  test("detects with no key headers when there is no key", async () => {
    const noKey = await client.apiEndpointDetectFormats({ baseUrl: `${upstream.origin}/relay` });

    // 这个假上游要 key：列模型就被 401 拒，三种格式都是 key 的问题。
    expect(noKey.error).toBeNull();
    expect(noKey.results.map((result) => result.status)).toEqual([
      "auth_failed",
      "auth_failed",
      "auth_failed",
    ]);
    expect(upstream.requests.length).toBeGreaterThan(0);
    for (const { headers } of upstream.requests) {
      expect(headers.authorization).toBeUndefined();
      expect(headers["x-api-key"]).toBeUndefined();
    }
  });

  test("rejects an address that is not http before calling upstream", async () => {
    const notHttp = await client.apiEndpointDetectFormats({
      baseUrl: "ftp://relay.example",
      apiKey: TYPED_KEY,
    });
    expect(notHttp).toMatchObject({ results: [], error: { code: "invalid_input" } });
    expect(upstream.requests).toEqual([]);
  });

  test("editing the connection with a blank key keeps the saved key for detection", async () => {
    const created = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrls: [{ format: "openai_chat", url: `${upstream.origin}/relay/v1` }],
      apiKey: SAVED_KEY,
      models: [],
    });
    if (!created.endpoint) throw new Error("Expected a saved endpoint");
    const edited = await client.apiEndpointSave({
      provider: "claude",
      endpointId: created.endpoint.id,
      name: "Relay renamed",
      baseUrls: [
        { format: "anthropic_messages", url: `${upstream.origin}/relay` },
        { format: "openai_chat", url: `${upstream.origin}/relay/v1` },
      ],
      apiKey: " ",
      models: [],
    });
    expect(edited).toMatchObject({
      error: null,
      endpoint: { name: "Relay renamed", hasApiKey: true },
    });

    const detected = await client.apiEndpointDetectFormats({
      endpointId: created.endpoint.id,
      baseUrl: `${upstream.origin}/relay`,
    });

    expect(detected.results.map((result) => result.status)).toEqual(["ok", "ok", "not_detected"]);
    expect(upstream.requests.map((request) => request.headers.authorization)).toEqual(
      upstream.requests.map(() => `Bearer ${SAVED_KEY}`),
    );
    expect(JSON.stringify(detected)).not.toContain(SAVED_KEY);
  });

  test("a pending detection can be cancelled", async () => {
    let arrived: () => void = () => undefined;
    const requestArrived = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    // 收到请求就不再回应，直到被取消。
    const hang = createServer(() => arrived());
    servers.push(hang);
    await new Promise<void>((resolve) => hang.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(hang.address() as AddressInfo).port}`;

    const pending = client.apiEndpointDetectFormats(
      { baseUrl: origin, apiKey: TYPED_KEY },
      "detect-to-cancel",
    );
    await requestArrived;
    const cancel = await client.apiEndpointCancel("detect-to-cancel");

    expect(cancel.cancelled).toBe(true);
    expect(await pending).toMatchObject({ results: [], error: { code: "cancelled" } });
  });
});

/*
 * 逐个模型识别（工单 21，照 magpie DetectModels 与其用例 TestDetectModels，MIT，见 THIRD_PARTY_NOTICES）：
 * 假上游按路径只答某些模型，slow-* 一直不答。单个与整批的时限用手动计时器，用例自己决定何时到点。
 */
const EACH_PROBE_TIMEOUT_MS = 30_000;
const EACH_BATCH_TIMEOUT_MS = 600_000;

const EACH_SERVES: Record<string, string[]> = {
  "/each/v1/chat/completions": ["gpt-both", "glm-chat"],
  "/each/v1/responses": ["gpt-both", "gpt-resp"],
  "/each/v1/messages": ["claude-only"],
};

interface EachUpstream {
  origin: string;
  posts: { path: string; model: string; team: unknown; session: unknown }[];
  inFlight: number;
  maxInFlight: number;
}

async function startEachUpstream(): Promise<EachUpstream> {
  const upstream: EachUpstream = { origin: "", posts: [], inFlight: 0, maxInFlight: 0 };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
        model?: string;
        prompt_cache_key?: unknown;
      };
      const model = body.model ?? "";
      const requestPath = request.url ?? "";
      const team = request.headers["x-relay-team"];
      upstream.posts.push({ path: requestPath, model, team, session: body.prompt_cache_key });
      if (model.startsWith("slow-")) return;
      upstream.inFlight += 1;
      upstream.maxInFlight = Math.max(upstream.maxInFlight, upstream.inFlight);
      // 晚一点回，好让同时在问的请求叠起来。
      setTimeout(() => {
        upstream.inFlight -= 1;
        const served = EACH_SERVES[requestPath]?.includes(model) || model.startsWith("m-");
        if (!served) {
          sendJson(response, 400, {
            error: { message: `model ${model} not supported on this endpoint` },
          });
          return;
        }
        if (requestPath.endsWith("/messages")) {
          sendJson(response, 200, { type: "message", content: [{ type: "text", text: "hi" }] });
        } else if (requestPath.endsWith("/responses")) {
          sendJson(response, 200, { object: "response", output: [] });
        } else {
          sendJson(response, 200, {
            object: "chat.completion",
            choices: [{ index: 0, message: { role: "assistant", content: "hi" } }],
          });
        }
      }, 20);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  upstream.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return upstream;
}

/** 只在一种格式上答上的模型与那种格式。 */
function singleFormatModels(
  models: { modelId: string; results: { format: string; status: string }[] }[] | undefined,
): (readonly [string, string])[] {
  return (models ?? []).flatMap((row) => {
    const formats = row.results.filter((result) => result.status === "ok");
    const [only] = formats;
    if (formats.length !== 1 || !only) return [];
    return [[row.modelId, only.format] as const];
  });
}

function codesOf(models: { results: { code?: string }[] }[] | undefined) {
  return (models ?? []).flatMap((row) => row.results.map((result) => result.code));
}

function okFlags(models: { modelId: string; results: { status: string }[] }[] | undefined) {
  return (models ?? []).map((row) => [
    row.modelId,
    row.results.map((result) => result.status === "ok"),
  ]);
}

describe("Detecting each picked model on every request format", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let upstream: EachUpstream;
  let timers: ManualTimers;

  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-detect-each-"));
    tempRoots.push(root);
    upstream = await startEachUpstream();
    timers = new ManualTimers();
    daemon = await createTestPaseoDaemon({
      apiEndpoints: {
        env: {
          CLAUDE_CONFIG_DIR: path.join(root, "claude"),
          CODEX_HOME: path.join(root, "codex"),
        },
        homeDir: root,
        detectEach: {
          concurrency: 8,
          probeTimeoutMs: EACH_PROBE_TIMEOUT_MS,
          batchTimeoutMs: EACH_BATCH_TIMEOUT_MS,
        },
        modelTestTimers: timers,
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

  test("says model by model which formats answered, and by format the first model that answered", async () => {
    const detected = await client.apiEndpointDetectFormats({
      baseUrl: `${upstream.origin}/each/v1`,
      apiKey: TYPED_KEY,
      modelIds: ["gpt-both", "gpt-resp", " glm-chat", "claude-only", "gpt-both", "gpt-image-2", ""],
      eachModel: true,
    });

    expect(detected.error).toBeNull();
    // 按 Anthropic、Chat、Responses。
    expect(okFlags(detected.models)).toEqual([
      ["gpt-both", [false, true, true]],
      ["gpt-resp", [false, false, true]],
      ["glm-chat", [false, true, false]],
      ["claude-only", [true, false, false]],
      ["gpt-image-2", [false, false, false]],
    ]);
    const gptResp = detected.models?.[1]?.results ?? [];
    expect(gptResp[1]).toMatchObject({
      format: "openai_chat",
      url: `${upstream.origin}/each/v1`,
      status: "not_detected",
      httpStatus: 400,
      modelId: "gpt-resp",
    });
    expect(gptResp[1]?.message).toContain("not supported on this endpoint");
    expect(gptResp[2]?.durationMs).toBeGreaterThanOrEqual(0);
    // 生图模型不能对话，不问它。
    const image = detected.models?.[4]?.results ?? [];
    expect(image.map(({ httpStatus, code }) => [httpStatus, code])).toEqual([
      [null, "image_model"],
      [null, "image_model"],
      [null, "image_model"],
    ]);
    expect(image[0]?.message).toContain("image model");
    // 上游给的失败没有 daemon 的原因码。
    expect(gptResp[1]?.code).toBeUndefined();
    expect(upstream.posts.some((post) => post.model === "gpt-image-2")).toBe(false);
    expect(upstream.posts).toHaveLength(12);
    // 每种格式：第一个答上的模型。
    expect(
      detected.results.map(({ format, url, status, modelId }) => [format, url, status, modelId]),
    ).toEqual([
      ["anthropic_messages", `${upstream.origin}/each`, "ok", "claude-only"],
      ["openai_chat", `${upstream.origin}/each/v1`, "ok", "gpt-both"],
      ["openai_responses", `${upstream.origin}/each/v1`, "ok", "gpt-both"],
    ]);
    expect((await client.apiEndpointList("claude")).endpoints).toEqual([]);
  });

  // 接口管理好用性工单 22：逐个模型识别也带这家存的请求头与附加请求体，在识别自己的会话上（magpie tested）。
  test("asks with the saved endpoint's headers and extra body, on a session of its own", async () => {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Each",
      baseUrls: [{ format: "openai_chat", url: `${upstream.origin}/each/v1` }],
      apiKey: SAVED_KEY,
      models: [{ id: "gpt-both" }],
      headers: { "X-Relay-Team": "team-each" },
      extraBody: { prompt_cache_key: "${sessionId}" },
    });
    expect(saved.error).toBeNull();
    upstream.posts.length = 0;

    const detected = await client.apiEndpointDetectFormats({
      endpointId: saved.endpoint?.id,
      baseUrl: `${upstream.origin}/each/v1`,
      modelIds: ["gpt-both"],
      eachModel: true,
    });

    expect(detected.error).toBeNull();
    expect(upstream.posts).toHaveLength(3);
    for (const post of upstream.posts) {
      expect(post.team).toBe("team-each");
      expect(String(post.session)).toMatch(/^osuna-test-[0-9a-f]{12}$/);
    }
  });

  test("asks no more than the first 30 models, 8 requests at a time", async () => {
    const many = Array.from({ length: 35 }, (_, index) => `m-${String(index).padStart(2, "0")}`);

    const detected = await client.apiEndpointDetectFormats({
      baseUrl: `${upstream.origin}/each/v1`,
      apiKey: TYPED_KEY,
      modelIds: many,
      eachModel: true,
    });

    expect(detected.models?.map((row) => row.modelId)).toEqual(many.slice(0, 30));
    expect(upstream.posts).toHaveLength(90);
    expect(new Set(upstream.posts.map((post) => post.model))).toEqual(new Set(many.slice(0, 30)));
    expect(upstream.maxInFlight).toBeLessThanOrEqual(8);
    expect(upstream.maxInFlight).toBeGreaterThan(1);
  });

  test("a disabled model is still asked, by each model and by a single detection (magpie's detection ignores Disabled models)", async () => {
    await client.apiEndpointSetDisabledModels({ models: ["glm-*"] });

    const each = await client.apiEndpointDetectFormats({
      baseUrl: `${upstream.origin}/each/v1`,
      apiKey: TYPED_KEY,
      modelIds: ["glm-chat"],
      eachModel: true,
    });
    expect(okFlags(each.models)).toEqual([["glm-chat", [false, true, false]]]);

    const single = await client.apiEndpointDetectFormats({
      baseUrl: `${upstream.origin}/each/v1`,
      apiKey: TYPED_KEY,
      modelIds: ["glm-chat"],
    });
    expect(single.results.map((result) => [result.modelId, result.status])).toEqual([
      ["glm-chat", "not_detected"],
      ["glm-chat", "ok"],
      ["glm-chat", "not_detected"],
    ]);
    expect(upstream.posts.map((post) => post.model)).toEqual(Array(6).fill("glm-chat"));
  });

  test("a model that answers on one format only is saved as Use only this format after the detection", async () => {
    const created = await client.apiEndpointSave({
      provider: "claude",
      name: "Each relay",
      baseUrls: [{ format: "openai_chat", url: `${upstream.origin}/each/v1` }],
      apiKey: TYPED_KEY,
      models: [{ id: "gpt-both" }, { id: "gpt-resp" }],
    });
    const endpointId = created.endpoint?.id ?? "";

    const detected = await client.apiEndpointDetectFormats({
      endpointId,
      baseUrl: `${upstream.origin}/each/v1`,
      modelIds: ["gpt-both", "gpt-resp"],
      eachModel: true,
    });
    // 采用这些：答上的格式的地址，只在一种格式上答上的模型只用它（界面上「采用这些」做的事）。
    const answered = detected.results.filter((result) => result.status === "ok");
    const onlyOne = singleFormatModels(detected.models);
    expect(onlyOne).toEqual([["gpt-resp", "openai_responses"]]);
    const saved = await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Each relay",
      baseUrls: answered.map(({ format, url }) => ({ format, url })),
      models: [{ id: "gpt-both" }, { id: "gpt-resp" }],
      modelSettings: {
        models: Object.fromEntries(onlyOne.map(([id, format]) => [id, { format }])),
      },
    });
    expect(saved.error).toBeNull();

    const [endpoint] = (await client.apiEndpointList("claude")).endpoints;
    expect(endpoint?.modelSettings).toEqual({
      models: { "gpt-resp": { format: "openai_responses" } },
    });
    expect(endpoint?.baseUrls).toEqual([
      { format: "openai_chat", url: `${upstream.origin}/each/v1` },
      { format: "openai_responses", url: `${upstream.origin}/each/v1` },
    ]);
  });

  test("a format that does not answer in time says so", async () => {
    const pending = client.apiEndpointDetectFormats({
      baseUrl: `${upstream.origin}/each/v1`,
      apiKey: TYPED_KEY,
      modelIds: ["slow-a", "gpt-resp"],
      eachModel: true,
    });
    await expect.poll(() => upstream.posts.length).toBe(6);
    timers.fire(EACH_PROBE_TIMEOUT_MS);
    const detected = await pending;

    expect(detected.error).toBeNull();
    const timedOut = detected.models?.[0]?.results ?? [];
    for (const result of timedOut) {
      expect(result).toMatchObject({
        httpStatus: null,
        code: "upstream_timeout",
        params: { seconds: "30" },
        message: "No response within 30s",
      });
    }
    expect(timedOut).toHaveLength(3);
    expect(okFlags(detected.models)[1]).toEqual(["gpt-resp", [false, false, true]]);
  });

  test("when the detection runs out of time, what was asked says so and the rest is not asked", async () => {
    const slow = Array.from({ length: 9 }, (_, index) => `slow-${index}`);
    const pending = client.apiEndpointDetectFormats({
      baseUrl: `${upstream.origin}/each/v1`,
      apiKey: TYPED_KEY,
      modelIds: slow,
      eachModel: true,
    });
    // 8 个一起问，到齐了再让整批到点。
    await expect.poll(() => upstream.posts.length).toBe(8);
    timers.fire(EACH_BATCH_TIMEOUT_MS);
    const detected = await pending;

    expect(detected.error).toBeNull();
    const codes = codesOf(detected.models);
    expect(codes).toHaveLength(27);
    expect(codes.slice(0, 8)).toEqual(Array(8).fill("batch_timeout"));
    expect(codes.slice(8)).toEqual(Array(19).fill("not_asked"));
    expect(upstream.posts).toHaveLength(8);
  });
});
