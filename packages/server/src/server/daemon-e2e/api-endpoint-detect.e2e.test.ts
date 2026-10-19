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
    expect(upstream.requests.filter((request) => request.method === "POST")).toEqual([]);
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
