import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.client.close();
    await harness.daemon.close();
  }
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** 起一个隔离 daemon；`files` 是启动前就放进 $PASEO_HOME/api-endpoints/ 的文件。 */
async function start(files: Record<string, string> = {}): Promise<Harness> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-host-"));
  tempRoots.push(root);
  const endpointsDir = path.join(root, ".paseo", "api-endpoints");
  await mkdir(endpointsDir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    await writeFile(path.join(endpointsDir, name), text);
  }
  const claudeConfigDir = path.join(root, "claude");
  const settingsPath = path.join(claudeConfigDir, "settings.json");
  await mkdir(claudeConfigDir, { recursive: true });
  await writeFile(settingsPath, USER_SETTINGS);

  const logLines: string[] = [];
  const logger = pino({ level: "info" }, { write: (line: string) => logLines.push(line) });
  const daemon = await createTestPaseoDaemon({
    paseoHomeRoot: root,
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
