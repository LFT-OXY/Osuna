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

// 测试连接。上游是本地假 HTTP 服务，绝不访问真实的中转站。
const SAVED_KEY = "sk-saved-secret";
const TYPED_KEY = "sk-typed-secret";

interface FakeUpstream {
  origin: string;
  requests: { url: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }[];
  hang: boolean;
}

const tempRoots: string[] = [];
const servers: Server[] = [];

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

/**
 * /claude 下是 Anthropic Messages（也能列模型），/codex/v1 下是 OpenAI Responses，/chat-only/v1 只有 Chat Completions。
 * 只认两把 key；模型 `missing` 当作不存在。
 */
async function startUpstream(): Promise<FakeUpstream> {
  const upstream: FakeUpstream = { origin: "", requests: [], hang: false };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<
        string,
        unknown
      >;
      upstream.requests.push({ url: request.url ?? "", headers: request.headers, body });
      if (upstream.hang) return;
      const authorized =
        request.headers.authorization === `Bearer ${TYPED_KEY}` ||
        request.headers.authorization === `Bearer ${SAVED_KEY}`;
      if (request.url === "/claude/v1/messages") {
        if (!authorized) {
          sendJson(response, 401, {
            type: "error",
            error: { type: "authentication_error", message: "invalid x-api-key" },
          });
        } else if (body.model === "missing") {
          sendJson(response, 404, {
            type: "error",
            error: { type: "not_found_error", message: "model: missing" },
          });
        } else {
          sendJson(response, 200, { type: "message", content: [{ type: "text", text: "p" }] });
        }
        return;
      }
      if (request.url === "/claude/v1/models") {
        if (authorized)
          sendJson(response, 200, { data: [{ id: "gpt-5" }, { id: "claude-opus-4" }] });
        else sendJson(response, 401, { error: { message: "invalid x-api-key" } });
        return;
      }
      if (request.url === "/codex/v1/responses" && authorized) {
        sendJson(response, 200, { object: "response", status: "completed", output: [] });
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

describe("API endpoint connection test over the daemon RPC", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let upstream: FakeUpstream;

  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-test-"));
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
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.12.1" });
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

  test("an edit with a blank key tests with the saved key and never returns it", async () => {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrl: `${upstream.origin}/claude`,
      apiKey: SAVED_KEY,
      models: [{ id: "relay/sonnet" }],
      defaultModelId: "relay/sonnet",
    });
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");

    const tested = await client.apiEndpointTestConnection({
      provider: "claude",
      endpointId: saved.endpoint.id,
      baseUrl: `${upstream.origin}/claude/`,
      apiKey: " ",
      modelId: "relay/sonnet",
    });

    expect(tested).toMatchObject({ error: null, result: { ok: true, status: 200, error: null } });
    expect(tested.result?.durationMs).toBeGreaterThanOrEqual(0);
    expect(upstream.requests[0]?.headers.authorization).toBe(`Bearer ${SAVED_KEY}`);
    expect(upstream.requests[0]?.body).toMatchObject({ model: "relay/sonnet", max_tokens: 1 });
    expect(JSON.stringify(tested)).not.toContain(SAVED_KEY);
  });

  test("reports a rejected key and an unknown model with the status and upstream message", async () => {
    const rejected = await client.apiEndpointTestConnection({
      provider: "claude",
      baseUrl: `${upstream.origin}/claude`,
      apiKey: "sk-wrong",
      modelId: "relay/sonnet",
    });
    expect(rejected).toMatchObject({
      error: null,
      result: { ok: false, status: 401, error: { code: "upstream_error" } },
    });
    expect(rejected.result?.error?.message).toContain("invalid x-api-key");
    expect(JSON.stringify(rejected)).not.toContain("sk-wrong");

    const missing = await client.apiEndpointTestConnection({
      provider: "claude",
      baseUrl: `${upstream.origin}/claude`,
      apiKey: TYPED_KEY,
      modelId: "missing",
    });
    expect(missing).toMatchObject({
      result: { ok: false, status: 404, error: { code: "upstream_error" } },
    });
    expect(missing.result?.error?.message).toContain("model: missing");
  });

  test("appends /v1 for Codex and tells a relay without the Responses API apart", async () => {
    const codex = await client.apiEndpointTestConnection({
      provider: "codex",
      baseUrl: `${upstream.origin}/codex`,
      apiKey: TYPED_KEY,
      modelId: "gpt-5",
    });
    expect(codex).toMatchObject({ error: null, result: { ok: true, status: 200 } });
    expect(upstream.requests[0]?.url).toBe("/codex/v1/responses");

    const chatOnly = await client.apiEndpointTestConnection({
      provider: "codex",
      baseUrl: `${upstream.origin}/chat-only/v1`,
      apiKey: TYPED_KEY,
      modelId: "gpt-5",
    });
    expect(chatOnly).toMatchObject({
      error: null,
      result: { ok: false, status: 404, error: { code: "protocol_unsupported" } },
    });
  });

  test("a request without a key carries no key header", async () => {
    const noKey = await client.apiEndpointTestConnection({
      provider: "claude",
      baseUrl: `${upstream.origin}/claude`,
      modelId: "relay/sonnet",
    });

    // 这个假上游要 key：没 key 的请求被 401 拒，结论照常回给用户。
    expect(noKey).toMatchObject({ error: null, result: { ok: false, status: 401 } });
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]?.headers.authorization).toBeUndefined();
    expect(upstream.requests[0]?.headers["x-api-key"]).toBeUndefined();
  });

  test("rejects a request without a model before calling upstream", async () => {
    const noModel = await client.apiEndpointTestConnection({
      provider: "claude",
      baseUrl: `${upstream.origin}/claude`,
      apiKey: TYPED_KEY,
      modelId: " ",
    });
    expect(noModel).toMatchObject({ result: null, error: { code: "invalid_input" } });
    expect(upstream.requests).toEqual([]);
  });

  test("a pending test can be cancelled", async () => {
    upstream.hang = true;
    const pending = client.apiEndpointTestConnection(
      {
        provider: "claude",
        baseUrl: `${upstream.origin}/claude`,
        apiKey: TYPED_KEY,
        modelId: "relay/sonnet",
      },
      "test-to-cancel",
    );
    await expect.poll(() => upstream.requests.length).toBe(1);

    expect((await client.apiEndpointCancel("test-to-cancel")).cancelled).toBe(true);
    expect(await pending).toMatchObject({ result: null, error: { code: "cancelled" } });
  });
});

describe("API endpoint connection test by base URL and request format", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let upstream: FakeUpstream;

  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-test-format-"));
    tempRoots.push(root);
    upstream = await startUpstream();
    daemon = await createTestPaseoDaemon({
      apiEndpoints: { env: { CLAUDE_CONFIG_DIR: path.join(root, "claude") }, homeDir: root },
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.12.1" });
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

  async function saveHostEndpoint(models: string[]): Promise<string> {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrls: [
        { format: "anthropic_messages", url: `${upstream.origin}/claude` },
        { format: "openai_responses", url: `${upstream.origin}/codex/v1` },
      ],
      apiKey: SAVED_KEY,
      models: models.map((id) => ({ id })),
    });
    if (!saved.endpoint) throw new Error(`Expected a saved endpoint: ${saved.error?.message}`);
    return saved.endpoint.id;
  }

  test("each address is asked in its own format, with a selected model that suits it", async () => {
    const endpointId = await saveHostEndpoint(["gpt-5", "claude-sonnet-4-5"]);

    const anthropic = await client.apiEndpointTestConnection({
      provider: "claude",
      endpointId,
      baseUrl: `${upstream.origin}/claude`,
      format: "anthropic_messages",
    });
    const responses = await client.apiEndpointTestConnection({
      provider: "claude",
      endpointId,
      baseUrl: `${upstream.origin}/codex/v1`,
      format: "openai_responses",
    });

    expect(anthropic).toMatchObject({ error: null, result: { ok: true, status: 200 } });
    expect(responses).toMatchObject({ error: null, result: { ok: true, status: 200 } });
    expect(upstream.requests.map((request) => [request.url, request.body.model])).toEqual([
      ["/claude/v1/messages", "claude-sonnet-4-5"],
      ["/codex/v1/responses", "gpt-5"],
    ]);
  });

  test("a rejected key is told apart as auth_failed", async () => {
    const tested = await client.apiEndpointTestConnection({
      provider: "claude",
      baseUrl: `${upstream.origin}/claude`,
      apiKey: "sk-wrong",
      modelId: "claude-sonnet-4-5",
      format: "anthropic_messages",
    });

    expect(tested).toMatchObject({
      error: null,
      result: { ok: false, status: 401, error: { code: "auth_failed" } },
    });
    expect(JSON.stringify(tested)).not.toContain("sk-wrong");
  });

  test("with no model selected it lists the upstream models first and asks with one of them", async () => {
    const endpointId = await saveHostEndpoint([]);

    const tested = await client.apiEndpointTestConnection({
      provider: "claude",
      endpointId,
      baseUrl: `${upstream.origin}/claude`,
      format: "anthropic_messages",
    });

    expect(tested.result?.ok).toBe(true);
    expect(upstream.requests.map((request) => request.url)).toEqual([
      "/claude/v1/models",
      "/claude/v1/messages",
    ]);
    expect(upstream.requests[1]?.body.model).toBe("claude-opus-4");
  });

  test("an address that answers nothing in that format is a failure with the reason", async () => {
    const tested = await client.apiEndpointTestConnection({
      provider: "claude",
      baseUrl: `${upstream.origin}/codex/v1`,
      apiKey: TYPED_KEY,
      modelId: "gpt-5",
      format: "openai_chat",
    });

    expect(tested).toMatchObject({
      error: null,
      result: { ok: false, status: 404, error: { code: "upstream_error" } },
    });
  });

  test("a Bedrock endpoint is asked per format with a model served there, its key in the header that format takes", async () => {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Amazon Bedrock",
      baseUrls: [
        { format: "anthropic_messages", url: `${upstream.origin}/claude` },
        { format: "openai_chat", url: `${upstream.origin}/chat-only/v1` },
      ],
      apiKey: SAVED_KEY,
      models: [{ id: "global.anthropic.claude-sonnet-5" }, { id: "deepseek.v3.2" }],
      templateId: "bedrock",
      region: "us-east-1",
    });
    const endpointId = saved.endpoint?.id ?? "";

    await client.apiEndpointTestConnection({
      provider: "claude",
      endpointId,
      baseUrl: `${upstream.origin}/claude`,
      format: "anthropic_messages",
    });
    await client.apiEndpointTestConnection({
      provider: "claude",
      endpointId,
      baseUrl: `${upstream.origin}/chat-only/v1`,
      format: "openai_chat",
    });

    const [anthropic, chat] = upstream.requests;
    expect(anthropic?.body.model).toBe("global.anthropic.claude-sonnet-5");
    expect(anthropic?.headers["x-api-key"]).toBe(SAVED_KEY);
    expect(anthropic?.headers.authorization).toBeUndefined();
    expect(chat?.url).toBe("/chat-only/v1/chat/completions");
    expect(chat?.body).toMatchObject({ model: "deepseek.v3.2", max_completion_tokens: 16 });
    expect(chat?.body.max_tokens).toBeUndefined();
    expect(chat?.headers.authorization).toBe(`Bearer ${SAVED_KEY}`);
    expect(chat?.headers["x-api-key"]).toBeUndefined();
  });

  test("an Azure endpoint is asked with the key in api-key alone", async () => {
    const saved = await client.apiEndpointSave({
      provider: "codex",
      name: "Azure OpenAI",
      baseUrls: [{ format: "openai_responses", url: `${upstream.origin}/codex/v1` }],
      apiKey: SAVED_KEY,
      models: [{ id: "my-gpt-deployment" }],
      templateId: "azure",
    });

    await client.apiEndpointTestConnection({
      provider: "codex",
      endpointId: saved.endpoint?.id ?? "",
      baseUrl: `${upstream.origin}/codex/v1`,
      format: "openai_responses",
    });

    expect(upstream.requests[0]?.headers["api-key"]).toBe(SAVED_KEY);
    expect(upstream.requests[0]?.headers.authorization).toBeUndefined();
  });
});
