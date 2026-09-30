import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { fetchUpstreamModels } from "./upstream-models.js";

// 本地假上游：按路径返回预设的响应，记下每次请求的路径和请求头。
type Route = { status: number; body: unknown } | "hang";

interface FakeUpstream {
  baseUrl: string;
  requests: { url: string; headers: IncomingHttpHeaders }[];
}

const servers: Server[] = [];

async function startUpstream(routes: Record<string, Route>): Promise<FakeUpstream> {
  const requests: FakeUpstream["requests"] = [];
  const server = createServer((request, response) => {
    const url = request.url ?? "";
    requests.push({ url, headers: request.headers });
    const route = routes[url];
    if (route === "hang") return;
    if (!route) {
      response.writeHead(404, { "content-type": "text/plain" }).end("Not Found");
      return;
    }
    const text = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    response.writeHead(route.status, { "content-type": "application/json" }).end(text);
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

function run(input: {
  provider: "claude" | "codex";
  baseUrl: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  return fetchUpstreamModels({
    provider: input.provider,
    baseUrl: input.baseUrl,
    apiKey: KEY,
    signal: input.signal ?? new AbortController().signal,
    timeoutMs: input.timeoutMs ?? 2000,
  });
}

describe("fetchUpstreamModels", () => {
  test("reads data[] from <base>/v1/models and sends Bearer plus x-api-key for Claude", async () => {
    const upstream = await startUpstream({
      "/api/v1/models": {
        status: 200,
        body: {
          data: [
            { id: "anthropic/claude-sonnet-4.5", display_name: "Claude Sonnet 4.5" },
            { id: "z-ai/glm-4.6", name: "GLM 4.6" },
            { id: "plain-id" },
            { id: "plain-id" },
            { object: "model" },
          ],
        },
      },
    });

    const result = await run({ provider: "claude", baseUrl: `${upstream.baseUrl}/api/` });

    expect(result).toEqual({
      ok: true,
      models: [
        { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
        { id: "z-ai/glm-4.6", label: "GLM 4.6" },
        { id: "plain-id" },
      ],
    });
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(upstream.requests[0]?.headers["x-api-key"]).toBe(KEY);
  });

  test("falls back to <base>/models and reads models[].slug, sending only Bearer for Codex", async () => {
    const upstream = await startUpstream({
      "/v1/models": {
        status: 200,
        body: { models: [{ slug: "gpt-5", display_name: "GPT-5" }, { slug: "gpt-5-mini" }] },
      },
    });

    const result = await run({ provider: "codex", baseUrl: `${upstream.baseUrl}/v1` });

    expect(result).toEqual({
      ok: true,
      models: [{ id: "gpt-5", label: "GPT-5" }, { id: "gpt-5-mini" }],
    });
    expect(upstream.requests.map((request) => request.url)).toEqual([
      "/v1/v1/models",
      "/v1/models",
    ]);
    for (const request of upstream.requests) {
      expect(request.headers.authorization).toBe(`Bearer ${KEY}`);
      expect(request.headers["x-api-key"]).toBeUndefined();
    }
  });

  test("follows has_more / last_id pages", async () => {
    const upstream = await startUpstream({
      "/v1/models": {
        status: 200,
        body: { data: [{ id: "a" }], has_more: true, last_id: "a" },
      },
      "/v1/models?after_id=a": {
        status: 200,
        body: { data: [{ id: "b" }], has_more: false, last_id: "b" },
      },
    });

    const result = await run({ provider: "claude", baseUrl: upstream.baseUrl });

    expect(result).toEqual({ ok: true, models: [{ id: "a" }, { id: "b" }] });
  });

  test("reports a 401 with the upstream message and never the key", async () => {
    const upstream = await startUpstream({
      "/v1/models": {
        status: 401,
        body: { error: { message: `Invalid API key ${KEY}` } },
      },
    });

    const result = await run({ provider: "claude", baseUrl: upstream.baseUrl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("upstream_error");
    expect(result.error.message).toContain("HTTP 401");
    expect(result.error.message).toContain("Invalid API key");
    expect(result.error.message).not.toContain(KEY);
  });

  test("reports models_unsupported when neither address lists models", async () => {
    const upstream = await startUpstream({
      "/models": { status: 200, body: "<html>relay home</html>" },
    });

    const result = await run({ provider: "codex", baseUrl: upstream.baseUrl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("models_unsupported");
    expect(result.error.message).toContain("HTTP 404");
    expect(upstream.requests.map((request) => request.url)).toEqual(["/v1/models", "/models"]);
  });

  test("times out", async () => {
    const upstream = await startUpstream({ "/v1/models": "hang" });

    const result = await run({ provider: "claude", baseUrl: upstream.baseUrl, timeoutMs: 100 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("upstream_timeout");
    // 超时后不再去试第二个地址。
    expect(upstream.requests).toHaveLength(1);
  });

  test("can be cancelled", async () => {
    const upstream = await startUpstream({ "/v1/models": "hang" });
    const controller = new AbortController();

    const pending = run({
      provider: "claude",
      baseUrl: upstream.baseUrl,
      signal: controller.signal,
    });
    await expect.poll(() => upstream.requests.length).toBe(1);
    controller.abort();

    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("cancelled");
  });

  test("reports an unreachable host", async () => {
    const upstream = await startUpstream({});
    const closed = servers.pop();
    await new Promise<void>((resolve) => closed?.close(() => resolve()));

    const result = await run({ provider: "claude", baseUrl: upstream.baseUrl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("upstream_unreachable");
  });
});
