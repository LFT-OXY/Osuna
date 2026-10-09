import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTestOsunaDaemon, type TestOsunaDaemon } from "../test-utils/osuna-daemon.js";
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
  let daemon: TestOsunaDaemon;
  let client: DaemonClient;
  let upstream: FakeUpstream;
  let settingsPath: string;

  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "osuna-api-endpoint-models-"));
    tempRoots.push(root);
    const claudeConfigDir = path.join(root, "claude");
    settingsPath = path.join(claudeConfigDir, "settings.json");
    await mkdir(claudeConfigDir, { recursive: true });
    await writeFile(settingsPath, USER_SETTINGS);
    upstream = await startUpstream();
    daemon = await createTestOsunaDaemon({
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

  test("asks for a key when there is neither a typed nor a saved one", async () => {
    const fetched = await client.apiEndpointFetchModels({
      provider: "claude",
      baseUrl: upstream.baseUrl,
    });

    expect(fetched).toMatchObject({ models: [], error: { code: "invalid_input" } });
    expect(upstream.requests).toEqual([]);
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

  test("writes only the mapped tiers and gives them back on Official", async () => {
    const endpointId = await saveEndpoint();
    const listed = await client.apiEndpointList("claude");
    expect(listed.endpoints[0]?.modelMapping).toEqual({
      opus: "relay/opus",
      fable: "relay/sonnet",
    });

    await client.apiEndpointSetActive("claude", endpointId);
    const env = JSON.parse(await readFile(settingsPath, "utf8")).env;
    expect(env).toMatchObject({
      ANTHROPIC_MODEL: "relay/sonnet",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "relay/opus",
      ANTHROPIC_DEFAULT_FABLE_MODEL: "relay/sonnet",
    });
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();

    // 编辑启用中的接口、去掉 opus 映射：该档位回到用户自己的值。
    await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Relay",
      baseUrl: upstream.baseUrl,
      models: [{ id: "relay/opus" }, { id: "relay/sonnet" }],
      defaultModelId: "relay/sonnet",
      modelMapping: { fable: "relay/sonnet" },
    });
    expect(JSON.parse(await readFile(settingsPath, "utf8")).env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe(
      "my-opus",
    );

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
