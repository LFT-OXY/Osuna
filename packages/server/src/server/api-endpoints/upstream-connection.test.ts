import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { testUpstreamConnection } from "./upstream-connection.js";

// 本地假上游：按「方法 路径」返回预设的响应，记下每次请求的路径、请求头和请求体。
type Route = { status: number; body: unknown } | "hang";

interface FakeUpstream {
  baseUrl: string;
  requests: { method: string; url: string; headers: IncomingHttpHeaders; body: unknown }[];
}

const servers: Server[] = [];

async function startUpstream(routes: Record<string, Route>): Promise<FakeUpstream> {
  const requests: FakeUpstream["requests"] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body: text ? (JSON.parse(text) as unknown) : undefined,
      });
      const route = routes[`${request.method} ${request.url}`];
      if (route === "hang") return;
      if (!route) {
        response.writeHead(404, { "content-type": "text/plain" }).end("Not Found");
        return;
      }
      const body = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
      response.writeHead(route.status, { "content-type": "application/json" }).end(body);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, requests };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

const KEY = "sk-upstream-secret";

const ANTHROPIC_MESSAGE = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "p" }],
  stop_reason: "max_tokens",
};

const OPENAI_RESPONSE = {
  id: "resp_1",
  object: "response",
  status: "completed",
  output: [],
};

function run(input: {
  provider: "claude" | "codex";
  baseUrl: string;
  modelId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  return testUpstreamConnection({
    provider: input.provider,
    baseUrl: input.baseUrl,
    apiKey: KEY,
    modelId: input.modelId ?? "relay/model",
    signal: input.signal ?? new AbortController().signal,
    timeoutMs: input.timeoutMs ?? 2000,
  });
}

describe("testUpstreamConnection", () => {
  test("sends a minimal Anthropic Messages request for Claude", async () => {
    const upstream = await startUpstream({
      "POST /api/v1/messages": { status: 200, body: ANTHROPIC_MESSAGE },
    });

    const outcome = await run({ provider: "claude", baseUrl: `${upstream.baseUrl}/api` });

    expect(outcome).toEqual({
      kind: "result",
      result: { ok: true, status: 200, durationMs: expect.any(Number), error: null },
    });
    const [request] = upstream.requests;
    // 和 Claude Code 用 ANTHROPIC_AUTH_TOKEN 时一样：只带 Bearer，不带 x-api-key。
    expect(request?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(request?.headers["x-api-key"]).toBeUndefined();
    expect(request?.headers["anthropic-version"]).toBe("2023-06-01");
    expect(request?.body).toEqual({
      model: "relay/model",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
  });

  test("sends an OpenAI Responses request for Codex without store or previous_response_id", async () => {
    const upstream = await startUpstream({
      "POST /v1/responses": { status: 200, body: OPENAI_RESPONSE },
    });

    const outcome = await run({
      provider: "codex",
      baseUrl: `${upstream.baseUrl}/v1`,
      modelId: "gpt-5",
    });

    expect(outcome).toMatchObject({ kind: "result", result: { ok: true, status: 200 } });
    expect(upstream.requests[0]?.body).toEqual({
      model: "gpt-5",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "ping" }] }],
    });
    expect(upstream.requests[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  test("reports a 401 with the upstream message and never the key", async () => {
    const upstream = await startUpstream({
      "POST /v1/messages": {
        status: 401,
        body: { type: "error", error: { type: "authentication_error", message: `bad ${KEY}` } },
      },
    });

    const outcome = await run({ provider: "claude", baseUrl: upstream.baseUrl });

    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        ok: false,
        status: 401,
        error: {
          code: "upstream_error",
          message: `POST ${upstream.baseUrl}/v1/messages: HTTP 401: bad ***`,
        },
      },
    });
  });

  test("reports an unknown model with the upstream message", async () => {
    const upstream = await startUpstream({
      "POST /v1/responses": {
        status: 404,
        body: { error: { code: "model_not_found", message: "The model `nope` does not exist" } },
      },
    });

    const outcome = await run({
      provider: "codex",
      baseUrl: `${upstream.baseUrl}/v1`,
      modelId: "nope",
    });

    expect(outcome).toMatchObject({
      kind: "result",
      result: {
        ok: false,
        status: 404,
        error: { code: "upstream_error", message: expect.stringContaining("does not exist") },
      },
    });
  });

  test("never leaks part of a key echoed across the truncation point", async () => {
    const upstream = await startUpstream({
      "POST /v1/messages": {
        status: 400,
        body: { error: { message: `${"x".repeat(290)} ${KEY} trailing` } },
      },
    });

    const outcome = await run({ provider: "claude", baseUrl: upstream.baseUrl });

    expect(JSON.stringify(outcome)).not.toContain(KEY.slice(0, 6));
  });

  test("reports protocol_unsupported when the Responses path does not exist", async () => {
    const upstream = await startUpstream({});

    const outcome = await run({ provider: "codex", baseUrl: `${upstream.baseUrl}/v1` });

    expect(outcome).toMatchObject({
      kind: "result",
      result: { ok: false, status: 404, error: { code: "protocol_unsupported" } },
    });
  });

  test("reports protocol_unsupported for a framework's JSON 404 on an unknown path", async () => {
    const upstream = await startUpstream({
      "POST /v1/responses": { status: 404, body: { detail: "Not Found" } },
    });

    const outcome = await run({ provider: "codex", baseUrl: `${upstream.baseUrl}/v1` });

    expect(outcome).toMatchObject({
      kind: "result",
      result: { ok: false, status: 404, error: { code: "protocol_unsupported" } },
    });
  });

  test("reports protocol_unsupported when a 200 body is not a Responses object", async () => {
    const upstream = await startUpstream({
      "POST /v1/responses": {
        status: 200,
        body: { object: "chat.completion", choices: [{ message: { content: "p" } }] },
      },
    });

    const outcome = await run({ provider: "codex", baseUrl: `${upstream.baseUrl}/v1` });

    expect(outcome).toMatchObject({
      kind: "result",
      result: { ok: false, status: 200, error: { code: "protocol_unsupported" } },
    });
  });

  test("times out without a status", async () => {
    const upstream = await startUpstream({ "POST /v1/messages": "hang" });

    const outcome = await run({ provider: "claude", baseUrl: upstream.baseUrl, timeoutMs: 100 });

    expect(outcome).toMatchObject({
      kind: "result",
      result: { ok: false, status: null, error: { code: "upstream_timeout" } },
    });
  });

  test("can be cancelled", async () => {
    const upstream = await startUpstream({ "POST /v1/messages": "hang" });
    const controller = new AbortController();

    const pending = run({
      provider: "claude",
      baseUrl: upstream.baseUrl,
      signal: controller.signal,
    });
    await expect.poll(() => upstream.requests.length).toBe(1);
    controller.abort();

    expect(await pending).toEqual({ kind: "cancelled" });
  });

  test("reports an unreachable host", async () => {
    const upstream = await startUpstream({});
    const closed = servers.pop();
    await new Promise<void>((resolve) => closed?.close(() => resolve()));

    const outcome = await run({ provider: "claude", baseUrl: upstream.baseUrl });

    expect(outcome).toMatchObject({
      kind: "result",
      result: { ok: false, status: null, error: { code: "upstream_unreachable" } },
    });
  });
});
