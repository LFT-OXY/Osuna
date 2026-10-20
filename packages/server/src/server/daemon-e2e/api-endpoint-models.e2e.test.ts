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
      "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
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
    // 新建时保存当场拉过一次清单（照 magpie）；用例只看之后的请求。
    upstream.requests.length = 0;
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
    // 保存时已拉过一次；预览不能改动这份。
    const kept = (await client.apiEndpointList("claude")).endpoints[0]?.catalog;
    expect(kept).toBeDefined();

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
    ).toEqual([kept]);

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
    // 新建一家保存时当场再拉一次（照 magpie），清单与预览的是同一份。
    expect(upstream.requests.map((request) => request.headers["x-api-key"])).toEqual([
      SAVED_KEY,
      TYPED_KEY,
      TYPED_KEY,
    ]);
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

/*
 * 清单合并、每天刷新与丢掉清单。假上游按路径分格式：/multi/anthropic 是 Anthropic 地址，/multi/v1 是 Chat 地址，
 * 两边各列一部分模型；/day 是定时刷新用的单格式地址。
 */
interface ListingUpstream {
  origin: string;
  requests: string[];
  // 各列表路径答什么；没有的路径 404，值为 "fail" 的回 500。
  lists: Record<string, unknown[] | "fail">;
}

async function startListingUpstream(): Promise<ListingUpstream> {
  const upstream: ListingUpstream = { origin: "", requests: [], lists: {} };
  const server = createServer((request, response) => {
    const url = request.url ?? "";
    upstream.requests.push(url);
    const list = upstream.lists[url];
    if (list === undefined) {
      response.writeHead(404).end();
      return;
    }
    if (list === "fail") {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "upstream is down" } }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: list }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  upstream.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return upstream;
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("API endpoint model lists merged across formats, refreshed daily, and forgotten", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let upstream: ListingUpstream;
  let clock: Date;
  let autoUpdate: boolean;
  // 每天刷新的检查定时器由测试手动到点；同一时刻只有一个在等。
  let pendingCheck: (() => void) | null;

  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-merge-"));
    tempRoots.push(root);
    upstream = await startListingUpstream();
    clock = new Date("2026-10-20T08:00:00.000Z");
    autoUpdate = true;
    pendingCheck = null;
    daemon = await createTestPaseoDaemon({
      apiEndpoints: {
        env: { CLAUDE_CONFIG_DIR: path.join(root, "claude") },
        homeDir: root,
        now: () => clock,
        isModelsDevAutoUpdate: () => autoUpdate,
        // 价格表开关也管 models.dev 的下载：这里绝不下载，定时器也不到点。
        modelsDevFetch: async () => {
          throw new Error("This suite never downloads models.dev");
        },
        modelsDevTimers: { schedule: () => () => {} },
        catalogRefreshTimers: {
          schedule(handler) {
            pendingCheck = handler;
            return () => {
              if (pendingCheck === handler) pendingCheck = null;
            };
          },
        },
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

  /** 到点跑一次检查，等它跑完（跑完会排下一次）。 */
  async function runDailyCheck(): Promise<void> {
    const handler = pendingCheck;
    if (!handler) throw new Error("Expected a scheduled model list check");
    pendingCheck = null;
    handler();
    await expect.poll(() => pendingCheck !== null).toBe(true);
  }

  async function catalogOf(endpointId: string) {
    const listed = await client.apiEndpointList("claude");
    return listed.endpoints.find((entry) => entry.id === endpointId)?.catalog;
  }

  async function saveEndpoint(input: {
    name: string;
    baseUrls: { format: string; url: string }[];
    models?: { id: string }[];
  }): Promise<string> {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: input.name,
      baseUrls: input.baseUrls,
      apiKey: SAVED_KEY,
      models: input.models ?? [],
    });
    expect(saved.error).toBeNull();
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    return saved.endpoint.id;
  }

  const multiBaseUrls = () => [
    { format: "anthropic_messages", url: `${upstream.origin}/multi/anthropic` },
    { format: "openai_chat", url: `${upstream.origin}/multi/v1` },
  ];

  test("each format's list is fetched and merged by model id; the first format's names win and later ones fill gaps", async () => {
    upstream.lists["/multi/anthropic/v1/models"] = [
      { id: "shared", display_name: "Shared by Anthropic" },
      { id: "anthropic-only" },
      { id: "filled" },
    ];
    upstream.lists["/multi/v1/models"] = [
      { id: "shared", display_name: "Shared by Chat" },
      { id: "filled", display_name: "Filled by Chat" },
      { id: "chat-only" },
    ];

    // 添加窗口里保存前拉：只看不记，也合并。
    const preview = await client.apiEndpointFetchModels({
      provider: "claude",
      baseUrl: `${upstream.origin}/multi/anthropic`,
      format: "anthropic_messages",
      apiKey: TYPED_KEY,
      preview: true,
      baseUrls: multiBaseUrls(),
    });
    const merged = [
      { id: "shared", label: "Shared by Anthropic" },
      { id: "anthropic-only" },
      { id: "filled", label: "Filled by Chat" },
      { id: "chat-only" },
    ];
    expect(preview.error).toBeNull();
    expect(preview.models).toEqual(merged);

    // 新建时保存当场拉的那次也合并。
    const endpointId = await saveEndpoint({ name: "Multi", baseUrls: multiBaseUrls() });
    expect((await catalogOf(endpointId))?.models).toEqual(merged);
  });

  test("a format that fails this time keeps the models it listed before; one that answered drops what it no longer lists", async () => {
    upstream.lists["/multi/anthropic/v1/models"] = [{ id: "shared" }, { id: "anthropic-only" }];
    upstream.lists["/multi/v1/models"] = [{ id: "shared" }, { id: "chat-only" }];
    const endpointId = await saveEndpoint({ name: "Multi", baseUrls: multiBaseUrls() });

    upstream.lists["/multi/anthropic/v1/models"] = [{ id: "shared" }, { id: "anthropic-new" }];
    upstream.lists["/multi/v1/models"] = "fail";
    const refetched = await client.apiEndpointFetchModels({
      provider: "claude",
      endpointId,
      baseUrl: `${upstream.origin}/multi/anthropic`,
      format: "anthropic_messages",
      baseUrls: multiBaseUrls(),
    });

    expect(refetched.error).toBeNull();
    expect((await catalogOf(endpointId))?.models.map((model) => model.id)).toEqual([
      "shared",
      "anthropic-new",
      "chat-only",
    ]);

    // 两种格式都没答上：报错，清单不动。
    upstream.lists["/multi/anthropic/v1/models"] = "fail";
    const kept = await catalogOf(endpointId);
    const failed = await client.apiEndpointFetchModels({
      provider: "claude",
      endpointId,
      baseUrl: `${upstream.origin}/multi/anthropic`,
      format: "anthropic_messages",
      baseUrls: multiBaseUrls(),
    });
    expect(failed.error?.code).toBe("upstream_error");
    expect(await catalogOf(endpointId)).toEqual(kept);
  });

  test("a list kept before formats were recorded keeps, this once, what no format that answered lists", async () => {
    // 保存当场拉的那次两边都挂：留下的是添加窗口带来的那份，没记哪种格式列过什么。
    upstream.lists["/multi/anthropic/v1/models"] = "fail";
    upstream.lists["/multi/v1/models"] = "fail";
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Multi",
      baseUrls: multiBaseUrls(),
      apiKey: SAVED_KEY,
      models: [],
      catalog: [{ id: "shared" }, { id: "old-a" }, { id: "old-b" }],
    });
    const endpointId = saved.endpoint?.id ?? "";
    expect((await catalogOf(endpointId))?.models.map((model) => model.id)).toEqual([
      "shared",
      "old-a",
      "old-b",
    ]);
    const fetchAll = () =>
      client.apiEndpointFetchModels({
        provider: "claude",
        endpointId,
        baseUrl: `${upstream.origin}/multi/anthropic`,
        format: "anthropic_messages",
        baseUrls: multiBaseUrls(),
      });

    upstream.lists["/multi/anthropic/v1/models"] = [{ id: "shared" }, { id: "new-a" }];
    expect((await fetchAll()).error).toBeNull();
    expect((await catalogOf(endpointId))?.models.map((model) => model.id)).toEqual([
      "shared",
      "new-a",
      "old-a",
      "old-b",
    ]);

    // 下次两边都答上：没人列的就走了。
    upstream.lists["/multi/v1/models"] = [{ id: "old-b" }];
    expect((await fetchAll()).error).toBeNull();
    expect((await catalogOf(endpointId))?.models.map((model) => model.id)).toEqual([
      "shared",
      "new-a",
      "old-b",
    ]);
  });

  test("once a day the daemon fetches again for endpoints that are on, keeps the list when that fails, and stops with auto-update off", async () => {
    upstream.lists["/on/v1/models"] = [{ id: "day-one" }];
    upstream.lists["/off/v1/models"] = [{ id: "day-one" }];
    const onId = await saveEndpoint({
      name: "On",
      baseUrls: [{ format: "anthropic_messages", url: `${upstream.origin}/on` }],
    });
    const offId = await saveEndpoint({
      name: "Off",
      baseUrls: [{ format: "anthropic_messages", url: `${upstream.origin}/off` }],
    });
    expect(
      (await client.apiEndpointSetEndpointState({ endpointId: offId, enabled: false })).error,
    ).toBeNull();
    const savedAt = clock.toISOString();
    expect((await catalogOf(onId))?.fetchedAt).toBe(savedAt);
    upstream.requests.length = 0;

    // 刚拉过：不到一天不再拉。
    clock = new Date(clock.getTime() + 60 * 60 * 1000);
    await runDailyCheck();
    expect(upstream.requests).toEqual([]);

    // 过了一天：开着的那家重新拉，关着的不拉。
    upstream.lists["/on/v1/models"] = [{ id: "day-one" }, { id: "day-two" }];
    clock = new Date(Date.parse(savedAt) + DAY_MS + 60 * 1000);
    await runDailyCheck();
    expect(upstream.requests).toEqual(["/on/v1/models"]);
    const refreshed = await catalogOf(onId);
    expect(refreshed).toEqual({
      fetchedAt: clock.toISOString(),
      models: [{ id: "day-one" }, { id: "day-two" }],
    });
    expect((await catalogOf(offId))?.fetchedAt).toBe(savedAt);

    // 又过一天，上游挂了：问过，清单不动。
    upstream.requests.length = 0;
    upstream.lists["/on/v1/models"] = "fail";
    clock = new Date(clock.getTime() + DAY_MS + 60 * 1000);
    await runDailyCheck();
    expect(upstream.requests.length).toBeGreaterThan(0);
    expect(await catalogOf(onId)).toEqual(refreshed);

    // 失败后过 15 分钟再试（照 magpie listRetry），不等一天。
    upstream.requests.length = 0;
    clock = new Date(clock.getTime() + 10 * 60 * 1000);
    await runDailyCheck();
    expect(upstream.requests).toEqual([]);
    upstream.lists["/on/v1/models"] = [{ id: "day-one" }, { id: "day-two" }, { id: "retried" }];
    clock = new Date(clock.getTime() + 6 * 60 * 1000);
    await runDailyCheck();
    expect(upstream.requests).toEqual(["/on/v1/models"]);
    const retried = await catalogOf(onId);
    expect(retried?.models.map((model) => model.id)).toEqual(["day-one", "day-two", "retried"]);
    upstream.lists["/on/v1/models"] = "fail";

    // 「价格表自动更新」关掉：再过几天也不拉。
    upstream.requests.length = 0;
    upstream.lists["/on/v1/models"] = [{ id: "day-three" }];
    autoUpdate = false;
    clock = new Date(clock.getTime() + 3 * DAY_MS);
    await runDailyCheck();
    expect(upstream.requests).toEqual([]);
    expect(await catalogOf(onId)).toEqual(retried);
  });

  test("forgetting the fetched list empties it and its time, keeping the selected and hand-added models", async () => {
    upstream.lists["/on/v1/models"] = [{ id: "listed" }, { id: "picked" }];
    const endpointId = await saveEndpoint({
      name: "On",
      baseUrls: [{ format: "anthropic_messages", url: `${upstream.origin}/on` }],
      models: [{ id: "picked" }],
    });
    expect(
      (
        await client.apiEndpointSave({
          provider: "claude",
          endpointId,
          name: "On",
          baseUrls: [{ format: "anthropic_messages", url: `${upstream.origin}/on` }],
          models: [{ id: "picked" }, { id: "by-hand" }],
          manualModels: [{ id: "by-hand" }],
        })
      ).error,
    ).toBeNull();
    expect((await catalogOf(endpointId))?.models).toHaveLength(2);

    expect((await client.apiEndpointForgetCatalog(endpointId)).error).toBeNull();

    const [endpoint] = (await client.apiEndpointList("claude")).endpoints;
    expect(endpoint?.catalog).toBeUndefined();
    expect(endpoint?.models).toEqual([{ id: "picked" }, { id: "by-hand" }]);
    expect(endpoint?.manualModels).toEqual([{ id: "by-hand" }]);

    expect((await client.apiEndpointForgetCatalog("no-such-endpoint")).error?.code).toBe(
      "not_found",
    );
  });
  /* 服务范围与自动勾选规则（prd 第 17、18a 条；照 magpie models.go 的 manyModels、autolist.go）。 */

  const numbered = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: `m${String(index + 1).padStart(2, "0")}` }));

  async function endpointOf(endpointId: string) {
    const listed = await client.apiEndpointList("claude");
    const endpoint = listed.endpoints.find((entry) => entry.id === endpointId);
    if (!endpoint) throw new Error(`Expected endpoint ${endpointId}`);
    return endpoint;
  }

  const servedIds = async (endpointId: string) =>
    (await endpointOf(endpointId)).models.map((model) => model.id);

  function refetch(endpointId: string, baseUrls: { format: string; url: string }[]) {
    const [first] = baseUrls;
    return client.apiEndpointFetchModels({
      provider: "claude",
      endpointId,
      baseUrl: first?.url ?? "",
      format: first?.format ?? "",
      baseUrls,
    });
  }

  test("following the list serves its first 24 models and hand-added ones, and moves with what upstream lists", async () => {
    const followUrls = [{ format: "anthropic_messages", url: `${upstream.origin}/follow` }];
    upstream.lists["/follow/v1/models"] = numbered(30);
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Follow",
      baseUrls: followUrls,
      apiKey: SAVED_KEY,
      models: [],
      modelScope: "vendor",
    });
    expect(saved.error).toBeNull();
    const endpointId = saved.endpoint?.id ?? "";
    expect((await endpointOf(endpointId)).modelScope).toBe("vendor");
    expect(await servedIds(endpointId)).toEqual(numbered(24).map((model) => model.id));

    // 手动添加的总在里面；档位映射只能指向在服务的模型。
    const withManual = await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Follow",
      baseUrls: followUrls,
      models: [],
      manualModels: [{ id: "by-hand" }],
      modelMapping: { opus: "m01", sonnet: "by-hand" },
    });
    expect(withManual.error).toBeNull();
    expect(await servedIds(endpointId)).toEqual([...numbered(24).map((m) => m.id), "by-hand"]);

    // 上游下架 m01、在最前面新出 m00：在服务的跟着变，指向 m01 的档位一起去掉。
    upstream.lists["/follow/v1/models"] = [{ id: "m00" }, ...numbered(30).slice(1)];
    expect((await refetch(endpointId, followUrls)).error).toBeNull();
    const after = await endpointOf(endpointId);
    expect(after.models.map((model) => model.id)).toEqual([
      "m00",
      ...numbered(24)
        .slice(1)
        .map((model) => model.id),
      "by-hand",
    ]);
    expect(after.modelMapping).toEqual({ sonnet: "by-hand" });

    // 每天刷新拉到的新清单也一样。
    upstream.lists["/follow/v1/models"] = [{ id: "fresh" }, { id: "m00" }];
    clock = new Date(clock.getTime() + DAY_MS + 60 * 1000);
    await runDailyCheck();
    expect(await servedIds(endpointId)).toEqual(["fresh", "m00", "by-hand"]);

    // 丢掉清单：只剩手动添加的。
    expect((await client.apiEndpointForgetCatalog(endpointId)).error).toBeNull();
    expect(await servedIds(endpointId)).toEqual(["by-hand"]);
  });

  test("following the list leaves out a model listed only on a format the endpoint no longer has a URL for", async () => {
    upstream.lists["/multi/anthropic/v1/models"] = [{ id: "shared" }, { id: "anthropic-only" }];
    upstream.lists["/multi/v1/models"] = [{ id: "shared" }, { id: "chat-only" }];
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Multi",
      baseUrls: multiBaseUrls(),
      apiKey: SAVED_KEY,
      models: [],
      modelScope: "vendor",
    });
    const endpointId = saved.endpoint?.id ?? "";
    expect(await servedIds(endpointId)).toEqual(["shared", "anthropic-only", "chat-only"]);

    const [anthropicUrl] = multiBaseUrls();
    const edited = await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Multi",
      baseUrls: anthropicUrl ? [anthropicUrl] : [],
      models: [],
    });
    expect(edited.error).toBeNull();
    expect(await servedIds(endpointId)).toEqual(["shared", "anthropic-only"]);
  });

  test("picked only also leaves out a model listed only on a format with no URL, and a rule never ticks one", async () => {
    upstream.lists["/multi/anthropic/v1/models"] = [{ id: "shared" }, { id: "anthropic-only" }];
    upstream.lists["/multi/v1/models"] = [{ id: "shared" }, { id: "chat-only" }];
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Multi",
      baseUrls: multiBaseUrls(),
      apiKey: SAVED_KEY,
      models: [{ id: "shared" }, { id: "chat-only" }, { id: "by-hand" }],
      manualModels: [{ id: "by-hand" }],
      modelMapping: { opus: "chat-only", sonnet: "shared" },
    });
    const endpointId = saved.endpoint?.id ?? "";
    expect(await servedIds(endpointId)).toEqual(["shared", "chat-only", "by-hand"]);

    // 去掉 Chat 地址：只在 Chat 上列的 chat-only 不再服务，指向它的档位一起去掉；手动添加的留着。
    const [anthropicUrl] = multiBaseUrls();
    const anthropicOnly = anthropicUrl ? [anthropicUrl] : [];
    const edited = await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Multi",
      baseUrls: anthropicOnly,
      models: [{ id: "shared" }, { id: "chat-only" }, { id: "by-hand" }],
      modelMapping: { sonnet: "shared" },
    });
    expect(edited.error).toBeNull();
    const after = await endpointOf(endpointId);
    expect(after.models.map((model) => model.id)).toEqual(["shared", "by-hand"]);
    expect(after.modelMapping).toEqual({ sonnet: "shared" });

    // 规则匹配到没有地址的模型也不勾。
    const ruled = await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Multi",
      baseUrls: anthropicOnly,
      models: after.models,
      autoPick: ["*-only"],
    });
    expect(ruled.error).toBeNull();
    expect(await servedIds(endpointId)).toEqual(["anthropic-only", "shared", "by-hand"]);
  });

  test("an endpoint saved without a scope keeps only what was picked through new lists", async () => {
    const urls = [{ format: "anthropic_messages", url: `${upstream.origin}/kept` }];
    upstream.lists["/kept/v1/models"] = numbered(3);
    const endpointId = await saveEndpoint({
      name: "Kept",
      baseUrls: urls,
      models: [{ id: "m02" }],
    });

    upstream.lists["/kept/v1/models"] = [...numbered(3), { id: "m04" }];
    expect((await refetch(endpointId, urls)).error).toBeNull();
    const endpoint = await endpointOf(endpointId);
    expect(endpoint.modelScope).toBeUndefined();
    expect(endpoint.models).toEqual([{ id: "m02" }]);
  });

  test("switching to picked keeps what was served; rules tick matching new models and never untick", async () => {
    const urls = [{ format: "anthropic_messages", url: `${upstream.origin}/pick` }];
    upstream.lists["/pick/v1/models"] = numbered(30);
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Pick",
      baseUrls: urls,
      apiKey: SAVED_KEY,
      models: [],
      modelScope: "vendor",
    });
    const endpointId = saved.endpoint?.id ?? "";
    const served = (await endpointOf(endpointId)).models;
    const save = (fields: { models: { id: string }[]; autoPick?: string[] }) =>
      client.apiEndpointSave({
        provider: "claude",
        endpointId,
        name: "Pick",
        baseUrls: urls,
        modelScope: "picked",
        ...fields,
      });

    // 客户端切换时把在服务的写成已选。
    expect((await save({ models: served })).error).toBeNull();
    expect((await endpointOf(endpointId)).modelScope).toBe("picked");
    expect(await servedIds(endpointId)).toEqual(numbered(24).map((model) => model.id));

    // 不是规则的（没有 *、不以 re: 开头）与读不懂的正则拒收，规则不变。
    // RE2 读不懂的（含反向引用、环视）拒收，和 magpie 一样，并说明是什么问题。
    for (const [rule, problem] of [
      ["gpt-5", "not_rule"],
      ["re:(", "invalid_regex"],
      ["re: ", "empty_regex"],
      ["re:(m)\\1", "invalid_regex"],
      ["re:m(?=1)", "invalid_regex"],
    ]) {
      const refused = await save({ models: served, autoPick: [rule ?? ""] });
      expect(refused.error?.code).toBe("invalid_input");
      expect(refused.error?.params).toEqual({ rule: rule?.trim(), problem });
    }
    expect((await endpointOf(endpointId)).autoPick).toBeUndefined();

    // 设规则时当前清单里匹配的也勾上（照 magpie SetAutoInclude），新的在前；不分大小写，重复与空白的去掉。
    const unticked = served.filter((model) => model.id !== "m01");
    expect(
      (await save({ models: unticked, autoPick: [" M2* ", "M2*", "", "re:m3\\d"] })).error,
    ).toBeNull();
    const ruled = await endpointOf(endpointId);
    expect(ruled.autoPick).toEqual(["M2*", "re:m3\\d"]);
    expect(ruled.models.map((model) => model.id)).toEqual([
      "m25",
      "m26",
      "m27",
      "m28",
      "m29",
      "m30",
      ...unticked.map((model) => model.id),
    ]);

    // 取消勾选规则匹配的 m25：清单里它不算新的，下次拉也不再勾上；新出的匹配的才勾上，不匹配的不动。
    const withoutM25 = ruled.models.filter((model) => model.id !== "m25");
    expect((await save({ models: withoutM25, autoPick: ["M2*", "re:m3\\d"] })).error).toBeNull();
    upstream.lists["/pick/v1/models"] = [{ id: "m2-fresh" }, { id: "other-new" }, ...numbered(30)];
    expect((await refetch(endpointId, urls)).error).toBeNull();
    expect(await servedIds(endpointId)).toEqual([
      "m2-fresh",
      ...withoutM25.map((model) => model.id),
    ]);

    // 每天刷新拉到的也一样；已勾的不因规则取消。
    upstream.lists["/pick/v1/models"] = [{ id: "m31" }, { id: "m2-fresh" }];
    clock = new Date(clock.getTime() + DAY_MS + 60 * 1000);
    await runDailyCheck();
    expect(await servedIds(endpointId)).toEqual([
      "m31",
      "m2-fresh",
      ...withoutM25.map((model) => model.id),
    ]);

    // 清空规则。
    expect((await save({ models: [{ id: "m31" }], autoPick: [] })).error).toBeNull();
    expect((await endpointOf(endpointId)).autoPick).toBeUndefined();
  });

  test("an unknown scope is refused", async () => {
    const refused = await client.apiEndpointSave({
      provider: "claude",
      name: "Odd",
      baseUrls: [{ format: "anthropic_messages", url: `${upstream.origin}/odd` }],
      apiKey: SAVED_KEY,
      models: [],
      modelScope: "usage",
    });
    expect(refused.error?.code).toBe("invalid_input");
  });
});
