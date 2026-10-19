import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import type { AgentModelDefinition } from "@getpaseo/protocol/agent-types";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

// 升级前的 endpoints.json：接口按 Agent 各存一份，每个 Agent 有一家「当前启用」。
const LEGACY_ENDPOINTS = {
  endpoints: [
    {
      id: "ep_a",
      provider: "claude",
      name: "Relay A",
      baseUrl: "https://a.example/api",
      models: [{ id: "a1" }, { id: "a2", label: "A Two" }],
      defaultModelId: "a2",
      modelMapping: { opus: "a1" },
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
    {
      id: "ep_b",
      provider: "claude",
      name: "Relay B",
      baseUrl: "https://b.example",
      models: [{ id: "b1" }],
      defaultModelId: "b1",
      createdAt: "2026-10-02T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z",
    },
    {
      id: "ep_c",
      provider: "codex",
      name: "中转站",
      baseUrl: "https://c.example/v1",
      models: [{ id: "c1" }, { id: "c2" }],
      defaultModelId: "c2",
      createdAt: "2026-10-03T00:00:00.000Z",
      updatedAt: "2026-10-03T00:00:00.000Z",
    },
    {
      id: "ep_d",
      provider: "codex",
      name: "Relay A",
      baseUrl: "https://d.example",
      models: [{ id: "d1" }, { id: "d2" }],
      defaultModelId: "d2",
      createdAt: "2026-10-04T00:00:00.000Z",
      updatedAt: "2026-10-04T00:00:00.000Z",
    },
  ],
  active: { claude: "ep_a", codex: "ep_d" },
};

const LEGACY_KEYS = { keys: { ep_a: "sk-a", ep_b: "sk-b", ep_c: "sk-c", ep_d: "sk-d" } };

const USER_SETTINGS = `{
  "permissions": {
    "allow": [
      "Bash(npm run *)"
    ]
  },
  "env": {
    "ANTHROPIC_BASE_URL": "https://hand-written.example"
  }
}
`;

interface Harness {
  daemon: TestPaseoDaemon;
  client: DaemonClient;
  endpointsPath: string;
  settingsPath: string;
  logLines: string[];
}

const tempRoots: string[] = [];
const harnesses: Harness[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.client.close();
    await harness.daemon.close();
  }
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * 起一个隔离 daemon；`files` 是启动前就放进 $PASEO_HOME/api-endpoints/ 的文件。
 * 给了 `reuse` 就沿用那次的 home（先关掉它的 daemon），模拟重启。
 */
async function start(files: Record<string, string> = {}, reuse?: Harness): Promise<Harness> {
  let root: string;
  if (reuse) {
    await reuse.client.close();
    await reuse.daemon.close();
    harnesses.splice(harnesses.indexOf(reuse), 1);
    root = path.dirname(path.dirname(path.dirname(reuse.endpointsPath)));
  } else {
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-host-"));
    tempRoots.push(root);
  }
  const endpointsDir = path.join(root, ".paseo", "api-endpoints");
  await mkdir(endpointsDir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    await writeFile(path.join(endpointsDir, name), text);
  }
  const claudeConfigDir = path.join(root, "claude");
  const settingsPath = path.join(claudeConfigDir, "settings.json");
  if (!reuse) {
    await mkdir(claudeConfigDir, { recursive: true });
    await writeFile(settingsPath, USER_SETTINGS);
  }

  const logLines: string[] = [];
  const logger = pino({ level: "info" }, { write: (line: string) => logLines.push(line) });
  const daemon = await createTestPaseoDaemon({
    paseoHomeRoot: root,
    // home 在 tempRoots 里统一删；重启要沿用它。
    cleanup: false,
    logger,
    apiEndpoints: { env: { CLAUDE_CONFIG_DIR: claudeConfigDir }, homeDir: root },
  });
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.12.1",
  });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  const harness = {
    daemon,
    client,
    endpointsPath: path.join(endpointsDir, "endpoints.json"),
    settingsPath,
    logLines,
  };
  harnesses.push(harness);
  return harness;
}

async function startWithLegacyFile(): Promise<Harness> {
  return start({
    "endpoints.json": JSON.stringify(LEGACY_ENDPOINTS, null, 2),
    "keys.json": JSON.stringify(LEGACY_KEYS),
  });
}

describe("old per-agent endpoints are read as host-wide endpoints", () => {
  test("the endpoints active before stay on and each agent keeps its default model", async () => {
    const { client, endpointsPath } = await startWithLegacyFile();
    const before = await readFile(endpointsPath, "utf8");

    const claude = await client.apiEndpointList("claude");

    expect(claude.error).toBeNull();
    expect(claude.agents).toEqual({
      claude: { enabled: true, defaultModelId: "a2" },
      codex: { enabled: true, defaultModelId: "d2" },
    });
    expect(
      claude.endpoints.map((endpoint) => ({
        id: endpoint.id,
        enabled: endpoint.enabled,
        baseUrls: endpoint.baseUrls,
      })),
    ).toEqual([
      {
        id: "ep_a",
        enabled: true,
        baseUrls: [{ format: "anthropic_messages", url: "https://a.example/api" }],
      },
      {
        id: "ep_b",
        enabled: false,
        baseUrls: [{ format: "anthropic_messages", url: "https://b.example" }],
      },
      {
        id: "ep_c",
        enabled: false,
        baseUrls: [{ format: "openai_responses", url: "https://c.example/v1" }],
      },
      {
        id: "ep_d",
        enabled: true,
        // 0.15 的 Codex 地址可以不带 /v1，写 config.toml 时才补；中转站按带 /v1 的地址拼路径。
        baseUrls: [{ format: "openai_responses", url: "https://d.example/v1" }],
      },
    ]);
    expect(claude.endpoints[0]).toMatchObject({
      name: "Relay A",
      models: [{ id: "a1" }, { id: "a2", label: "A Two" }],
      modelMapping: { opus: "a1" },
      hasApiKey: true,
    });
    expect(claude.activeEndpointId).toBe("ep_a");
    expect((await client.apiEndpointList("codex")).activeEndpointId).toBe("ep_d");

    // 读时换算：只读不写，文件原样。
    expect(await readFile(endpointsPath, "utf8")).toBe(before);
  });

  test("the first write upgrades the file and drops the old fields", async () => {
    const { client, endpointsPath } = await startWithLegacyFile();

    const toggled = await client.apiEndpointSetEndpointState({ endpointId: "ep_b", enabled: true });
    expect(toggled.error).toBeNull();

    const upgraded = JSON.parse(await readFile(endpointsPath, "utf8"));
    expect(upgraded.active).toBeUndefined();
    expect(upgraded.agents).toEqual({
      claude: { enabled: true, defaultModelId: "a2" },
      codex: { enabled: true, defaultModelId: "d2" },
    });
    for (const endpoint of upgraded.endpoints) {
      expect(endpoint.provider).toBeUndefined();
      expect(endpoint.baseUrl).toBeUndefined();
      expect(endpoint.defaultModelId).toBeUndefined();
    }
    expect(upgraded.endpoints.map((endpoint: { enabled: boolean }) => endpoint.enabled)).toEqual([
      true,
      true,
      false,
      true,
    ]);
    // 标识从名称生成、主机内唯一；名称生成不出来时用 api-N。
    expect(upgraded.endpoints.map((endpoint: { slug: string }) => endpoint.slug)).toEqual([
      "relay-a",
      "relay-b",
      "api-1",
      "relay-a-2",
    ]);
  });

  test("a file that does not parse is neither rewritten nor deleted, and the log has the error", async () => {
    const broken = `{ "endpoints": [ `;
    const { client, endpointsPath, logLines } = await start({ "endpoints.json": broken });

    const listed = await client.apiEndpointList("claude");
    expect(listed.error?.code).toBe("endpoints_unparsable");

    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "New",
      baseUrls: [{ format: "anthropic_messages", url: "https://new.example" }],
      apiKey: "sk-new",
      models: [],
    });
    expect(saved.error?.code).toBe("endpoints_unparsable");

    expect(await readFile(endpointsPath, "utf8")).toBe(broken);
    const errors = logLines
      .map((line) => JSON.parse(line) as { level: number; msg: string })
      .filter((entry) => entry.level >= 50);
    expect(errors.map((entry) => entry.msg)).toContain("API endpoints file could not be parsed");
  });
});

describe("the identifier and the keys stay inside the daemon", () => {
  test("no response carries the identifier; keys.json is private", async () => {
    const { client, daemon } = await startWithLegacyFile();
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay E",
      baseUrls: [{ format: "openai_chat", url: "https://e.example/v1" }],
      apiKey: "sk-e",
      models: [],
    });
    expect(saved.error).toBeNull();
    expect(JSON.stringify(saved)).not.toContain("sk-e");

    const listed = JSON.stringify(await client.apiEndpointList("claude"));
    expect(listed).not.toContain("slug");
    expect(listed).not.toContain("relay-a");
    expect(listed).not.toContain("sk-a");

    const keysPath = path.join(daemon.paseoHome, "api-endpoints", "keys.json");
    if (process.platform !== "win32") {
      expect((await stat(keysPath)).mode & 0o777).toBe(0o600);
    }
  });
});

/** 用新客户端的写法存一家接口，返回 id。 */
async function saveEndpoint(
  client: DaemonClient,
  name: string,
  models: string[],
  url = `https://${name.toLowerCase().replace(/\W+/g, "")}.example`,
): Promise<string> {
  const saved = await client.apiEndpointSave({
    provider: "claude",
    name,
    baseUrls: [{ format: "anthropic_messages", url }],
    apiKey: `sk-${name}`,
    models: models.map((id) => ({ id })),
  });
  expect(saved.error).toBeNull();
  if (!saved.endpoint) throw new Error("Expected a saved endpoint");
  return saved.endpoint.id;
}

describe("the Use API endpoints switch", () => {
  test("stays off while every endpoint is off", async () => {
    const { client, settingsPath } = await start();
    const id = await saveEndpoint(client, "Relay", ["m1"]);
    await client.apiEndpointSetEndpointState({ endpointId: id, enabled: false });

    const refused = await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });

    expect(refused).toMatchObject({
      agent: { enabled: false, defaultModelId: null },
      error: { code: "no_usable_model" },
    });
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });

  test("stays off while the only endpoint that is on has no model selected", async () => {
    const { client } = await start();
    await saveEndpoint(client, "Empty", []);

    const refused = await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });

    expect(refused.error?.code).toBe("no_usable_model");
    expect((await client.apiEndpointList("claude")).agents?.claude?.enabled).toBe(false);
  });

  test("turning it on without a default model picks the first model of the earliest endpoint that is on", async () => {
    const { client, settingsPath, daemon } = await start();
    const off = await saveEndpoint(client, "Off", ["z0"]);
    await client.apiEndpointSetEndpointState({ endpointId: off, enabled: false });
    await saveEndpoint(client, "Empty", []);
    const relay = await saveEndpoint(client, "Relay", ["m1", "m2"]);
    await saveEndpoint(client, "Later", ["l1"]);

    const enabled = await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });

    expect(enabled).toMatchObject({ agent: { enabled: true, defaultModelId: "m1" }, error: null });
    const listed = await client.apiEndpointList("claude");
    expect(listed.activeEndpointId).toBe(relay);
    expect(listed.agents?.codex).toEqual({ enabled: false, defaultModelId: null });
    // CLI 指向 daemon 中转站，默认模型写成起始模型；用哪家由中转站按模型名决定。
    const gateway = `http://127.0.0.1:${daemon.port}/api-endpoint-gateway`;
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe(gateway);
    expect(settings.model).toBe("m1");

    // 选另一家的模型做默认：只换起始模型。
    const chosen = await client.apiEndpointSetAgentSettings({
      provider: "claude",
      enabled: true,
      defaultModelId: "l1",
    });
    expect(chosen.agent).toEqual({ enabled: true, defaultModelId: "l1" });
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
      env: { ANTHROPIC_BASE_URL: gateway },
      model: "l1",
    });

    // 关接口里的模型不能当默认。
    const rejected = await client.apiEndpointSetAgentSettings({
      provider: "claude",
      enabled: true,
      defaultModelId: "z0",
    });
    expect(rejected).toMatchObject({
      agent: { enabled: true, defaultModelId: "l1" },
      error: { code: "invalid_input" },
    });

    expect(
      await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false }),
    ).toMatchObject({ agent: { enabled: false }, error: null });
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });
});

test("turning the switch off is never refused, even with a default model that is gone", async () => {
  const { client } = await start();
  await saveEndpoint(client, "Relay", ["m1"]);
  await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });

  const off = await client.apiEndpointSetAgentSettings({
    provider: "claude",
    enabled: false,
    defaultModelId: "deleted-model",
  });

  expect(off).toMatchObject({ agent: { enabled: false, defaultModelId: "m1" }, error: null });
});

describe("a default model that goes missing", () => {
  async function enableBothAgents(client: DaemonClient): Promise<{ a: string; b: string }> {
    const a = await saveEndpoint(client, "A", ["shared", "a-only"]);
    const b = await saveEndpoint(client, "B", ["b-only", "shared"]);
    for (const [provider, defaultModelId] of [
      ["claude", "a-only"],
      ["codex", "shared"],
    ] as const) {
      const set = await client.apiEndpointSetAgentSettings({
        provider,
        enabled: true,
        defaultModelId,
      });
      expect(set.error).toBeNull();
    }
    return { a, b };
  }

  async function agents(client: DaemonClient) {
    return (await client.apiEndpointList("claude")).agents;
  }

  test("deleting an endpoint moves the default to the earliest endpoint that is on", async () => {
    const { client, settingsPath } = await start();
    const { a, b } = await enableBothAgents(client);

    expect((await client.apiEndpointDelete("claude", a)).error).toBeNull();

    expect(await agents(client)).toEqual({
      claude: { enabled: true, defaultModelId: "b-only" },
      // B 也有同名模型，默认模型不变。
      codex: { enabled: true, defaultModelId: "shared" },
    });
    expect(JSON.parse(await readFile(settingsPath, "utf8")).model).toBe("b-only");

    // 一个能用的模型都不剩：两个 Agent 都回官方，CLI 配置还原。
    expect((await client.apiEndpointDelete("codex", b)).activeEndpointId).toBeNull();
    expect(await agents(client)).toMatchObject({
      claude: { enabled: false },
      codex: { enabled: false },
    });
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });

  test("turning an endpoint off follows the same rule", async () => {
    const { client, settingsPath } = await start();
    const { a, b } = await enableBothAgents(client);

    expect(
      (await client.apiEndpointSetEndpointState({ endpointId: a, enabled: false })).error,
    ).toBeNull();
    expect((await agents(client))?.claude).toEqual({ enabled: true, defaultModelId: "b-only" });

    expect(
      (await client.apiEndpointSetEndpointState({ endpointId: b, enabled: false })).error,
    ).toBeNull();
    expect((await agents(client))?.claude?.enabled).toBe(false);
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });

  test("removing the default model from an endpoint follows the same rule", async () => {
    const { client } = await start();
    const { a } = await enableBothAgents(client);

    const saved = await client.apiEndpointSave({
      provider: "claude",
      endpointId: a,
      name: "A",
      baseUrls: [{ format: "anthropic_messages", url: "https://a.example" }],
      models: [{ id: "shared" }],
    });
    expect(saved.error).toBeNull();

    expect((await agents(client))?.claude).toEqual({ enabled: true, defaultModelId: "shared" });
  });
});

// 老客户端（含官方 Paseo 手机 App）只认单接口：provider / baseUrl / defaultModelId / activeEndpointId。
describe("clients without apiEndpointGateway get a single-endpoint projection", () => {
  test("the list projects each endpoint for the asking agent", async () => {
    const { client } = await start();
    const both = await client.apiEndpointSave({
      provider: "claude",
      name: "Both",
      baseUrls: [
        { format: "anthropic_messages", url: "https://both.example" },
        { format: "openai_responses", url: "https://both.example/v1" },
      ],
      apiKey: "sk-both",
      models: [{ id: "m1" }, { id: "m2" }],
    });
    const chatOnly = await saveEndpoint(client, "Chat", ["c1"]);
    await client.apiEndpointSave({
      provider: "claude",
      endpointId: chatOnly,
      name: "Chat",
      baseUrls: [{ format: "openai_chat", url: "https://chat.example/v1" }],
      models: [{ id: "c1" }],
    });
    await client.apiEndpointSetAgentSettings({
      provider: "codex",
      enabled: true,
      defaultModelId: "m2",
    });

    const codex = await client.apiEndpointList("codex");
    expect(codex.activeEndpointId).toBe(both.endpoint?.id);
    expect(
      codex.endpoints.map(({ provider, baseUrl, defaultModelId }) => ({
        provider,
        baseUrl,
        defaultModelId,
      })),
    ).toEqual([
      { provider: "codex", baseUrl: "https://both.example/v1", defaultModelId: "m2" },
      // 没有自己格式的地址就给第一个；不持有默认模型的给第一个已选模型。
      { provider: "codex", baseUrl: "https://chat.example/v1", defaultModelId: "c1" },
    ]);

    const claude = await client.apiEndpointList("claude");
    expect(claude.activeEndpointId).toBeNull();
    expect(claude.endpoints[0]).toMatchObject({
      provider: "claude",
      baseUrl: "https://both.example",
      defaultModelId: "m1",
    });
  });

  test("set_active turns the switch on and this endpoint on without turning others off; null turns the switch off", async () => {
    const { client, settingsPath } = await start();
    const a = await saveEndpoint(client, "A", ["a1"]);
    const b = await saveEndpoint(client, "B", ["b1", "b2"]);
    await client.apiEndpointSetEndpointState({ endpointId: b, enabled: false });
    await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: true });

    const activated = await client.apiEndpointSetActive("claude", b);

    expect(activated).toMatchObject({ activeEndpointId: b, error: null });
    const listed = await client.apiEndpointList("claude");
    expect(listed.endpoints.map((endpoint) => [endpoint.id, endpoint.enabled])).toEqual([
      [a, true],
      [b, true],
    ]);
    expect(listed.agents).toEqual({
      claude: { enabled: true, defaultModelId: "b1" },
      codex: { enabled: true, defaultModelId: "a1" },
    });
    expect(JSON.parse(await readFile(settingsPath, "utf8")).model).toBe("b1");

    expect(await client.apiEndpointSetActive("claude", null)).toMatchObject({
      activeEndpointId: null,
      error: null,
    });
    const official = await client.apiEndpointList("claude");
    expect(official.agents?.claude?.enabled).toBe(false);
    expect(official.agents?.codex?.enabled).toBe(true);
    expect(official.endpoints.every((endpoint) => endpoint.enabled)).toBe(true);
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });

  test("an old save puts its base URL under the agent's own format and keeps the other formats", async () => {
    const { client } = await start();
    const id = await saveEndpoint(client, "Relay", ["m1"]);

    const fromCodex = await client.apiEndpointSave({
      provider: "codex",
      endpointId: id,
      name: "Relay",
      baseUrl: "https://relay.example/v1/",
      models: [{ id: "m1" }, { id: "m2" }],
      defaultModelId: "m2",
    });

    expect(fromCodex.error).toBeNull();
    expect(fromCodex.endpoint).toMatchObject({
      provider: "codex",
      baseUrl: "https://relay.example/v1",
      defaultModelId: "m2",
      baseUrls: [
        { format: "anthropic_messages", url: "https://relay.example" },
        { format: "openai_responses", url: "https://relay.example/v1" },
      ],
    });

    const bareFromCodex = await client.apiEndpointSave({
      provider: "codex",
      name: "Bare",
      baseUrl: "https://bare.example",
      apiKey: "sk-bare",
      models: [{ id: "b1" }],
      defaultModelId: "b1",
    });
    expect(bareFromCodex.endpoint).toMatchObject({
      baseUrl: "https://bare.example/v1",
      baseUrls: [{ format: "openai_responses", url: "https://bare.example/v1" }],
    });

    // 老客户端新建的接口要等 set_active 才开，和以前「保存不启用」一样。
    const created = await client.apiEndpointSave({
      provider: "claude",
      name: "Old form",
      baseUrl: "https://old.example",
      apiKey: "sk-old",
      models: [{ id: "o1" }],
      defaultModelId: "o1",
    });
    expect(created.endpoint).toMatchObject({
      enabled: false,
      baseUrls: [{ format: "anthropic_messages", url: "https://old.example" }],
    });
  });

  test("the model list has each model name once and is authoritative only while the switch is on", async () => {
    const { client } = await start();
    await saveEndpoint(client, "A", ["shared", "a1"]);
    await saveEndpoint(client, "B", ["b1", "shared"]);

    async function claudeEntry() {
      const snapshot = await client.getProvidersSnapshot();
      return snapshot.entries.find((entry) => entry.provider === "claude");
    }
    async function claudeModels(): Promise<string[] | null> {
      const entry = await claudeEntry();
      if (entry?.status !== "ready") return null;
      return (entry.models ?? []).map((model) => `${model.id}${model.isDefault ? " *" : ""}`);
    }

    await client.apiEndpointSetAgentSettings({
      provider: "claude",
      enabled: true,
      defaultModelId: "b1",
    });
    await expect.poll(claudeModels, { timeout: 10_000 }).toEqual(["shared", "a1", "b1 *"]);
    expect((await claudeEntry())?.isModelListAuthoritative).toBe(true);
    // 新客户端的选择器按接口分组：同名模型在两家各一条，id 带接口标识，label 是光秃秃的模型名。
    function describeGroup(group: { name: string; models: AgentModelDefinition[] }) {
      return {
        name: group.name,
        models: group.models.map((model) => [model.id, model.label, model.isDefault]),
      };
    }
    const groups = (await claudeEntry())?.apiEndpointModelGroups ?? [];
    expect(groups.map(describeGroup)).toEqual([
      {
        name: "A",
        models: [
          ["a/shared", "shared", false],
          ["a/a1", "a1", false],
        ],
      },
      {
        name: "B",
        models: [
          ["b/b1", "b1", true],
          ["b/shared", "shared", false],
        ],
      },
    ]);

    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    await expect
      .poll(async () => (await claudeEntry())?.isModelListAuthoritative, {
        timeout: 10_000,
      })
      .toBeUndefined();
    expect((await claudeEntry())?.apiEndpointModelGroups).toBeUndefined();
  });
});

describe("Searches the web by itself", () => {
  test("is off for old endpoints, saved with the endpoint, kept by a save that omits it, and survives a restart", async () => {
    const harness = await startWithLegacyFile();
    const legacy = await harness.client.apiEndpointList("claude");
    expect(legacy.endpoints.map((endpoint) => endpoint.searchesWeb)).toEqual([
      false,
      false,
      false,
      false,
    ]);

    const id = await saveEndpoint(harness.client, "Relay", ["m1"]);
    const turnedOn = await harness.client.apiEndpointSave({
      provider: "claude",
      endpointId: id,
      name: "Relay",
      baseUrls: [{ format: "anthropic_messages", url: "https://relay.example" }],
      models: [{ id: "m1" }],
      searchesWeb: true,
    });
    expect(turnedOn.error).toBeNull();
    expect(turnedOn.endpoint?.searchesWeb).toBe(true);

    // 老客户端（含官方 Paseo 手机 App）的保存不带这个字段：保留。
    const oldClientSave = await harness.client.apiEndpointSave({
      provider: "claude",
      endpointId: id,
      name: "Relay renamed",
      baseUrl: "https://relay.example",
      models: [{ id: "m1" }, { id: "m2" }],
      defaultModelId: "m1",
    });
    expect(oldClientSave.error).toBeNull();
    expect(oldClientSave.endpoint?.searchesWeb).toBe(true);

    const restarted = await start({}, harness);
    const listed = await restarted.client.apiEndpointList("claude");
    expect(listed.endpoints.find((endpoint) => endpoint.id === id)).toMatchObject({
      name: "Relay renamed",
      searchesWeb: true,
    });

    // 手改成 false 的文件照常读，读作关。
    const handEdited = JSON.parse(await readFile(restarted.endpointsPath, "utf8"));
    for (const endpoint of handEdited.endpoints) {
      if (endpoint.id === id) endpoint.searchesWeb = false;
    }
    await writeFile(restarted.endpointsPath, JSON.stringify(handEdited, null, 2));
    const reread = await restarted.client.apiEndpointList("claude");
    expect(reread.error).toBeNull();
    expect(reread.endpoints.find((endpoint) => endpoint.id === id)?.searchesWeb).toBe(false);
    await restarted.client.apiEndpointSave({
      provider: "claude",
      endpointId: id,
      name: "Relay renamed",
      baseUrls: [{ format: "anthropic_messages", url: "https://relay.example" }],
      models: [{ id: "m1" }],
      searchesWeb: true,
    });

    const turnedOff = await restarted.client.apiEndpointSave({
      provider: "claude",
      endpointId: id,
      name: "Relay renamed",
      baseUrls: [{ format: "anthropic_messages", url: "https://relay.example" }],
      models: [{ id: "m1" }],
      searchesWeb: false,
    });
    expect(turnedOff.endpoint?.searchesWeb).toBe(false);
  });
});

describe("Claude Code's WebSearch follows the endpoints that search the web by themselves", () => {
  const USER_DENY = `{
  "permissions": {
    "deny": [
      "Read(./.env)"
    ]
  }
}
`;

  async function setSearchesWeb(client: DaemonClient, id: string, searchesWeb: boolean) {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      endpointId: id,
      name: "Searcher",
      baseUrls: [{ format: "anthropic_messages", url: "https://searcher.example" }],
      models: [{ id: "s1" }],
      searchesWeb,
    });
    expect(saved.error).toBeNull();
  }

  test("the deny rule is there while none is on, goes when one is on, and comes back when it is off again", async () => {
    const { client, settingsPath } = await start();
    await writeFile(settingsPath, USER_DENY);
    const id = await saveEndpoint(client, "Searcher", ["s1"]);
    await saveEndpoint(client, "Plain", ["p1"]);
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    const deny = async () => JSON.parse(await readFile(settingsPath, "utf8")).permissions?.deny;

    expect(await deny()).toEqual(["Read(./.env)", "WebSearch"]);

    await setSearchesWeb(client, id, true);
    expect(await deny()).toEqual(["Read(./.env)"]);

    // 开着开关的那家被关掉：没有开着的接口会搜了，规则回来。
    await client.apiEndpointSetEndpointState({ endpointId: id, enabled: false });
    expect(await deny()).toEqual(["Read(./.env)", "WebSearch"]);
    await client.apiEndpointSetEndpointState({ endpointId: id, enabled: true });
    expect(await deny()).toEqual(["Read(./.env)"]);

    await setSearchesWeb(client, id, false);
    expect(await deny()).toEqual(["Read(./.env)", "WebSearch"]);

    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    expect(await readFile(settingsPath, "utf8")).toBe(USER_DENY);
  });

  test("a WebSearch deny rule the user wrote stays byte for byte through all three steps", async () => {
    const userRules = `  "permissions": {
    "deny": [
      "Read(./.env)",
      "WebSearch"
    ]
  }`;
    const { client, settingsPath } = await start();
    await writeFile(settingsPath, `{\n${userRules}\n}\n`);
    const id = await saveEndpoint(client, "Searcher", ["s1"]);
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    const text = () => readFile(settingsPath, "utf8");

    // 一家都没开：规则是用户的，Osuna 不再加一条。
    expect(await text()).toContain(userRules);
    await setSearchesWeb(client, id, true);
    expect(await text()).toContain(userRules);
    await setSearchesWeb(client, id, false);
    expect(await text()).toContain(userRules);

    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    expect(await text()).toBe(`{\n${userRules}\n}\n`);
  });

  test("a switch on an endpoint with only a Chat address does not count", async () => {
    const { client, settingsPath } = await start();
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Chat only",
      baseUrls: [{ format: "openai_chat", url: "https://chat.example/v1" }],
      apiKey: "sk-chat",
      models: [{ id: "c1" }],
      searchesWeb: true,
    });
    expect(saved.error).toBeNull();
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(settings.permissions.deny).toEqual(["WebSearch"]);
  });
});

interface RecordingUpstream {
  url: string;
  requests: { method: string; url: string; headers: IncomingHttpHeaders }[];
}

/** 本机假上游，像不要 key 的本机模型服务：谁来都答，列模型给 local-1，对话回一句 ok。记下每个请求的头。 */
async function startRecordingUpstream(): Promise<RecordingUpstream> {
  const upstream: RecordingUpstream = { url: "", requests: [] };
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      upstream.requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
      });
      response.writeHead(200, { "content-type": "application/json" });
      if (request.method === "GET") {
        response.end(JSON.stringify({ data: [{ id: "local-1" }] }));
        return;
      }
      response.end(
        JSON.stringify({
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  upstream.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return upstream;
}

/** 这家拉一次模型、测一次连接，再扮演 Claude Code 经中转站问一句；返回上游收到的 key 头。 */
async function askThroughEveryPath(input: {
  harness: Harness;
  upstream: RecordingUpstream;
  endpointId: string;
}): Promise<{ authorization?: string; "x-api-key"?: string | string[] }[]> {
  const { harness, upstream, endpointId } = input;
  const { client, daemon } = harness;
  const fetched = await client.apiEndpointFetchModels({
    provider: "claude",
    endpointId,
    baseUrl: upstream.url,
    format: "anthropic_messages",
  });
  expect(fetched).toMatchObject({ error: null, models: [{ id: "local-1" }] });
  const tested = await client.apiEndpointTestConnection({
    provider: "claude",
    endpointId,
    baseUrl: upstream.url,
    format: "anthropic_messages",
    modelId: "local-1",
  });
  expect(tested).toMatchObject({ error: null, result: { ok: true } });

  // 老客户端的切换也认这家：打开 Claude Code 的总开关，默认模型是它。
  expect(await client.apiEndpointSetActive("claude", endpointId)).toMatchObject({ error: null });
  const tokensPath = path.join(daemon.paseoHome, "api-endpoints", "gateway-tokens.json");
  const token = JSON.parse(await readFile(tokensPath, "utf8")).tokens.claude as string;
  const answered = await fetch(`http://127.0.0.1:${daemon.port}/api-endpoint-gateway/v1/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "local-1",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  expect(answered.status).toBe(200);

  expect(upstream.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
    "GET /v1/models",
    "POST /v1/messages",
    "POST /v1/messages",
  ]);
  return upstream.requests.map(({ headers }) => ({
    authorization: headers.authorization,
    "x-api-key": headers["x-api-key"],
  }));
}

describe("an API key is optional", () => {
  test("an endpoint saved without a key keeps no key and no request to its upstream carries one", async () => {
    const upstream = await startRecordingUpstream();
    const harness = await start();
    expect(harness.client.getLastServerInfoMessage()?.features?.apiEndpointManagement).toBe(true);
    const saved = await harness.client.apiEndpointSave({
      provider: "claude",
      name: "Local",
      baseUrls: [{ format: "anthropic_messages", url: upstream.url }],
      models: [{ id: "local-1" }],
    });
    expect(saved.error).toBeNull();
    expect(saved.endpoint?.hasApiKey).toBe(false);
    const endpointId = saved.endpoint?.id ?? "";

    const sent = await askThroughEveryPath({ harness, upstream, endpointId });

    expect(sent).toEqual([
      { authorization: undefined, "x-api-key": undefined },
      { authorization: undefined, "x-api-key": undefined },
      { authorization: undefined, "x-api-key": undefined },
    ]);
    const keysPath = path.join(harness.daemon.paseoHome, "api-endpoints", "keys.json");
    const keys = await readFile(keysPath, "utf8").catch(() => "{}");
    expect(keys).not.toContain(endpointId);
  });

  test("an endpoint with a key still sends it, and an edit with a blank key keeps it", async () => {
    const upstream = await startRecordingUpstream();
    const harness = await start();
    const saved = await harness.client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrls: [{ format: "anthropic_messages", url: upstream.url }],
      apiKey: "sk-relay",
      models: [{ id: "local-1" }],
    });
    const endpointId = saved.endpoint?.id ?? "";
    const edited = await harness.client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Relay renamed",
      baseUrls: [{ format: "anthropic_messages", url: upstream.url }],
      apiKey: " ",
      models: [{ id: "local-1" }],
    });
    expect(edited.error).toBeNull();
    expect(edited.endpoint?.hasApiKey).toBe(true);

    const sent = await askThroughEveryPath({ harness, upstream, endpointId });

    // Anthropic 地址两个头都带（ADR 0008）。
    const both = { authorization: "Bearer sk-relay", "x-api-key": "sk-relay" };
    expect(sent).toEqual([both, both, both]);
  });

  test("a save in the old shape keeps the fields that client does not know", async () => {
    const upstream = await startRecordingUpstream();
    const { client } = await start();
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrls: [
        { format: "anthropic_messages", url: upstream.url },
        { format: "openai_responses", url: `${upstream.url}/v1` },
      ],
      apiKey: "sk-relay",
      models: [{ id: "local-1" }],
      manualModels: [{ id: "by-hand" }],
      searchesWeb: true,
    });
    const endpointId = saved.endpoint?.id ?? "";
    await client.apiEndpointFetchModels({
      provider: "claude",
      endpointId,
      baseUrl: upstream.url,
      format: "anthropic_messages",
    });
    await client.apiEndpointSetEndpointState({ endpointId, enabled: false });

    // 官方 Paseo 手机 App 的保存：只有 baseUrl、defaultModelId 与模型。
    const oldSave = await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Relay renamed",
      baseUrl: upstream.url,
      models: [{ id: "local-1" }],
      defaultModelId: "local-1",
    });

    expect(oldSave.error).toBeNull();
    const listed = await client.apiEndpointList("claude");
    expect(listed.endpoints.find((endpoint) => endpoint.id === endpointId)).toMatchObject({
      name: "Relay renamed",
      hasApiKey: true,
      enabled: false,
      baseUrls: [
        { format: "anthropic_messages", url: upstream.url },
        { format: "openai_responses", url: `${upstream.url}/v1` },
      ],
      manualModels: [{ id: "by-hand" }],
      searchesWeb: true,
      catalog: { models: [{ id: "local-1" }] },
    });
  });
});
