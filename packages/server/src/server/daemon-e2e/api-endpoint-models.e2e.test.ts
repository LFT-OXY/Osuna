import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

// 拉取模型与 Claude 模型映射。上游是本地假 HTTP 服务，绝不访问真实的中转站。
const SAVED_KEY = "sk-saved-secret";
const TYPED_KEY = "sk-typed-secret";

const USER_SETTINGS = `{
  "env": {
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "my-opus"
  }
}
`;

interface FakeUpstream {
  baseUrl: string;
  requests: { url: string; headers: IncomingHttpHeaders }[];
  hang: boolean;
}

const tempRoots: string[] = [];
const servers: Server[] = [];

async function startUpstream(): Promise<FakeUpstream> {
  const upstream: FakeUpstream = { baseUrl: "", requests: [], hang: false };
  const server = createServer((request, response) => {
    upstream.requests.push({ url: request.url ?? "", headers: request.headers });
    if (upstream.hang) return;
    // Codex 风格的中转站：base 已带 /v1，只有 <base>/models，返回 models[].slug。
    if (request.url === "/codex/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ models: [{ slug: "gpt-5" }, { slug: "gpt-5-mini" }] }));
      return;
    }
    if (request.url !== "/api/v1/models") {
      response.writeHead(404).end();
      return;
    }
    if (
      request.headers.authorization !== `Bearer ${TYPED_KEY}` &&
      request.headers.authorization !== `Bearer ${SAVED_KEY}`
    ) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "missing key" } }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        data: [{ id: "relay/opus", display_name: "Relay Opus" }, { id: "relay/sonnet" }],
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  upstream.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  return upstream;
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("API endpoint models over the daemon RPC", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let upstream: FakeUpstream;
  let settingsPath: string;

  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-models-"));
    tempRoots.push(root);
    const claudeConfigDir = path.join(root, "claude");
    settingsPath = path.join(claudeConfigDir, "settings.json");
    await mkdir(claudeConfigDir, { recursive: true });
    await writeFile(settingsPath, USER_SETTINGS);
    upstream = await startUpstream();
    daemon = await createTestPaseoDaemon({
      apiEndpoints: { env: { CLAUDE_CONFIG_DIR: claudeConfigDir }, homeDir: root },
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

  async function saveEndpoint(): Promise<string> {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrl: upstream.baseUrl,
      apiKey: SAVED_KEY,
      models: [{ id: "relay/opus" }, { id: "relay/sonnet" }],
      defaultModelId: "relay/sonnet",
      modelMapping: { opus: "relay/opus", fable: "relay/sonnet" },
    });
    expect(saved.error).toBeNull();
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    return saved.endpoint.id;
  }

  test("lists upstream models with the typed key, before anything is saved", async () => {
    const fetched = await client.apiEndpointFetchModels({
      provider: "claude",
      baseUrl: `${upstream.baseUrl}/`,
      apiKey: TYPED_KEY,
    });

    expect(fetched).toMatchObject({
      error: null,
      models: [{ id: "relay/opus", label: "Relay Opus" }, { id: "relay/sonnet" }],
    });
    expect(upstream.requests[0]?.headers.authorization).toBe(`Bearer ${TYPED_KEY}`);
    expect(upstream.requests[0]?.headers["x-api-key"]).toBe(TYPED_KEY);
  });

  test("an edit with a blank key lists models with the saved key and never returns it", async () => {
    const endpointId = await saveEndpoint();

    const fetched = await client.apiEndpointFetchModels({
      provider: "claude",
      endpointId,
      baseUrl: upstream.baseUrl,
      apiKey: "  ",
    });

    expect(fetched.error).toBeNull();
    expect(fetched.models.map((model) => model.id)).toEqual(["relay/opus", "relay/sonnet"]);
    expect(upstream.requests[0]?.headers.authorization).toBe(`Bearer ${SAVED_KEY}`);
    expect(JSON.stringify(fetched)).not.toContain(SAVED_KEY);
  });

  test("falls back to <base>/models for a Codex relay and reports a rejected key", async () => {
    const codexBase = upstream.baseUrl.replace(/\/api$/, "/codex/v1");
    const codex = await client.apiEndpointFetchModels({
      provider: "codex",
      baseUrl: codexBase,
      apiKey: TYPED_KEY,
    });
    expect(codex).toMatchObject({
      error: null,
      models: [{ id: "gpt-5" }, { id: "gpt-5-mini" }],
    });
    expect(upstream.requests.map((request) => request.url)).toEqual([
      "/codex/v1/v1/models",
      "/codex/v1/models",
    ]);

    const rejected = await client.apiEndpointFetchModels({
      provider: "claude",
      baseUrl: upstream.baseUrl,
      apiKey: "sk-wrong",
    });
    expect(rejected.models).toEqual([]);
    expect(rejected.error?.code).toBe("upstream_error");
    expect(rejected.error?.message).toContain("HTTP 401");
  });

  test("lists with no key headers when there is neither a typed nor a saved key", async () => {
    const fetched = await client.apiEndpointFetchModels({
      provider: "claude",
      baseUrl: upstream.baseUrl,
    });

    // 这个假上游要 key：没 key 的列表被 401 拒，原样报给用户。
    expect(fetched).toMatchObject({ models: [], error: { code: "upstream_error" } });
    expect(upstream.requests.length).toBeGreaterThan(0);
    for (const { headers } of upstream.requests) {
      expect(headers.authorization).toBeUndefined();
      expect(headers["x-api-key"]).toBeUndefined();
    }
  });

  test("a pending fetch can be cancelled", async () => {
    upstream.hang = true;
    const pending = client.apiEndpointFetchModels(
      { provider: "claude", baseUrl: upstream.baseUrl, apiKey: TYPED_KEY },
      "fetch-to-cancel",
    );
    await expect.poll(() => upstream.requests.length).toBe(1);

    const cancelled = await client.apiEndpointCancel("fetch-to-cancel");

    expect(cancelled.cancelled).toBe(true);
    expect((await pending).error?.code).toBe("cancelled");
    expect((await client.apiEndpointCancel("fetch-to-cancel")).cancelled).toBe(false);
  });

  test("keeps the tier mapping on the endpoint and takes tier variables out of settings.json", async () => {
    const endpointId = await saveEndpoint();
    const listed = await client.apiEndpointList("claude");
    expect(listed.endpoints[0]?.modelMapping).toEqual({
      opus: "relay/opus",
      fable: "relay/sonnet",
    });

    // 档位由中转站按这家的映射翻译；settings.json 里用户自己的档位变量接管期间拿掉。
    await client.apiEndpointSetActive("claude", endpointId);
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(settings.model).toBe("relay/sonnet");
    expect(Object.keys(settings.env)).toEqual([
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_AUTO_MODE_SERVER",
    ]);

    await client.apiEndpointSetActive("claude", null);
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });

  test("rejects a mapping to a model that is not checked, and any mapping on Codex", async () => {
    const unchecked = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrl: upstream.baseUrl,
      apiKey: SAVED_KEY,
      models: [{ id: "relay/sonnet" }],
      defaultModelId: "relay/sonnet",
      modelMapping: { haiku: "relay/haiku" },
    });
    expect(unchecked).toMatchObject({ endpoint: null, error: { code: "invalid_input" } });

    const codex = await client.apiEndpointSave({
      provider: "codex",
      name: "Relay",
      baseUrl: upstream.baseUrl,
      apiKey: SAVED_KEY,
      models: [{ id: "relay/sonnet" }],
      defaultModelId: "relay/sonnet",
      modelMapping: { opus: "relay/sonnet" },
    });
    expect(codex.error?.code).toBe("invalid_input");
  });
});

describe("API endpoint models by base URL and request format", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let upstream: FakeUpstream;

  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-catalog-"));
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

  async function saveHostEndpoint(): Promise<string> {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrls: [
        { format: "anthropic_messages", url: upstream.baseUrl },
        { format: "openai_chat", url: `${upstream.baseUrl}/v1` },
      ],
      apiKey: SAVED_KEY,
      models: [],
    });
    expect(saved.error).toBeNull();
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    return saved.endpoint.id;
  }

  test("a fetch for a saved endpoint keeps the upstream list on it, with when it was fetched", async () => {
    const endpointId = await saveHostEndpoint();
    const before = Date.now();

    const fetched = await client.apiEndpointFetchModels({
      provider: "claude",
      endpointId,
      baseUrl: upstream.baseUrl,
      format: "anthropic_messages",
    });

    expect(fetched.error).toBeNull();
    expect(upstream.requests[0]?.headers["x-api-key"]).toBe(SAVED_KEY);
    const [endpoint] = (await client.apiEndpointList("claude")).endpoints;
    expect(endpoint?.catalog?.models).toEqual([
      { id: "relay/opus", label: "Relay Opus" },
      { id: "relay/sonnet" },
    ]);
    expect(Date.parse(endpoint?.catalog?.fetchedAt ?? "")).toBeGreaterThanOrEqual(before - 1000);
    expect(endpoint?.models).toEqual([]);
  });

  test("an OpenAI format lists with the bearer key alone", async () => {
    const endpointId = await saveHostEndpoint();

    const fetched = await client.apiEndpointFetchModels({
      provider: "claude",
      endpointId,
      baseUrl: `${upstream.baseUrl}/v1`,
      format: "openai_chat",
    });

    expect(fetched.error).toBeNull();
    const answered = upstream.requests.find((request) => request.url === "/api/v1/models");
    expect(answered?.headers.authorization).toBe(`Bearer ${SAVED_KEY}`);
    expect(answered?.headers["x-api-key"]).toBeUndefined();
  });

  test("a failed fetch leaves the kept list alone", async () => {
    const endpointId = await saveHostEndpoint();
    await client.apiEndpointFetchModels({
      provider: "claude",
      endpointId,
      baseUrl: upstream.baseUrl,
      format: "anthropic_messages",
    });
    const kept = (await client.apiEndpointList("claude")).endpoints[0]?.catalog;

    const failed = await client.apiEndpointFetchModels({
      provider: "claude",
      endpointId,
      baseUrl: upstream.baseUrl,
      apiKey: "sk-wrong",
      format: "anthropic_messages",
    });

    expect(failed.error?.code).toBe("upstream_error");
    expect((await client.apiEndpointList("claude")).endpoints[0]?.catalog).toEqual(kept);
  });

  test("the add window's fetch borrows a saved key without keeping a list, and the save keeps the preview", async () => {
    const sourceId = await saveHostEndpoint();

    // 复制一家时 key 框留空：借原来那家的 key 拉，只看不记。
    const preview = await client.apiEndpointFetchModels({
      provider: "claude",
      endpointId: sourceId,
      baseUrl: upstream.baseUrl,
      format: "anthropic_messages",
      preview: true,
    });
    const typed = await client.apiEndpointFetchModels({
      provider: "claude",
      baseUrl: upstream.baseUrl,
      apiKey: TYPED_KEY,
      format: "anthropic_messages",
    });

    expect(preview).toMatchObject({
      error: null,
      models: [{ id: "relay/opus" }, { id: "relay/sonnet" }],
    });
    expect(typed.models.map((model) => model.id)).toEqual(["relay/opus", "relay/sonnet"]);
    expect(upstream.requests.map((request) => request.headers["x-api-key"])).toEqual([
      SAVED_KEY,
      TYPED_KEY,
    ]);
    expect(
      (await client.apiEndpointList("claude")).endpoints.map((entry) => entry.catalog),
    ).toEqual([undefined]);

    const before = Date.now();
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay copy",
      baseUrls: [{ format: "anthropic_messages", url: upstream.baseUrl }],
      apiKey: TYPED_KEY,
      models: [{ id: "relay/sonnet" }],
      catalog: preview.models,
    });

    expect(saved.error).toBeNull();
    expect(saved.endpoint?.models).toEqual([{ id: "relay/sonnet" }]);
    expect(saved.endpoint?.catalog?.models).toEqual(preview.models);
    expect(Date.parse(saved.endpoint?.catalog?.fetchedAt ?? "")).toBeGreaterThanOrEqual(
      before - 1000,
    );
    // 保存时不再向上游拉。
    expect(upstream.requests).toHaveLength(2);
  });

  test("an unsaved form's template decides the list: Bedrock's built-in one, Azure's key header", async () => {
    const bedrock = await client.apiEndpointFetchModels({
      provider: "claude",
      baseUrl: upstream.baseUrl,
      apiKey: TYPED_KEY,
      format: "openai_chat",
      templateId: "bedrock",
      region: "us-east-1",
    });

    expect(bedrock.error).toBeNull();
    expect(bedrock.models.map((model) => model.id)).toContain("global.anthropic.claude-sonnet-5");
    expect(upstream.requests).toEqual([]);

    await client.apiEndpointFetchModels({
      provider: "claude",
      baseUrl: `${upstream.baseUrl}/v1`,
      apiKey: TYPED_KEY,
      format: "openai_chat",
      templateId: "azure",
    });

    expect(upstream.requests.length).toBeGreaterThan(0);
    for (const { headers } of upstream.requests) {
      expect(headers["api-key"]).toBe(TYPED_KEY);
      expect(headers.authorization).toBeUndefined();
    }
  });

  test("an unknown template in the form is refused before calling upstream", async () => {
    const fetched = await client.apiEndpointFetchModels({
      provider: "claude",
      baseUrl: upstream.baseUrl,
      apiKey: TYPED_KEY,
      format: "openai_chat",
      templateId: "no-such-template",
    });

    expect(fetched).toMatchObject({ models: [], error: { code: "invalid_input" } });
    expect(upstream.requests).toEqual([]);
  });

  test("models added by hand stay on the endpoint through saves that leave them out", async () => {
    const endpointId = await saveHostEndpoint();
    await client.apiEndpointFetchModels({
      provider: "claude",
      endpointId,
      baseUrl: upstream.baseUrl,
      format: "anthropic_messages",
    });
    const withManual = await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Relay",
      baseUrls: [{ format: "anthropic_messages", url: upstream.baseUrl }],
      models: [{ id: "relay/opus" }, { id: "hidden-model" }],
      manualModels: [{ id: " hidden-model " }, { id: "off-by-hand" }],
    });
    expect(withManual.endpoint?.manualModels).toEqual([
      { id: "hidden-model" },
      { id: "off-by-hand" },
    ]);

    // 编辑连接的弹窗不带 manualModels：手动添加的模型与拉回来的清单都留着。
    const edited = await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Relay renamed",
      baseUrls: [{ format: "anthropic_messages", url: upstream.baseUrl }],
      models: [{ id: "relay/opus" }, { id: "hidden-model" }],
    });

    expect(edited.endpoint?.manualModels).toEqual([{ id: "hidden-model" }, { id: "off-by-hand" }]);
    expect(edited.endpoint?.catalog?.models.map((model) => model.id)).toEqual([
      "relay/opus",
      "relay/sonnet",
    ]);
  });
});
