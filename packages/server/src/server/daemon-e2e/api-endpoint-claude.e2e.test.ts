import { writeFileSync } from "node:fs";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

// 用户手写的 settings.json：权限、hooks、插件、自己的中转站 URL，全都不能被 Osuna 弄丢。
const USER_SETTINGS = `{
  "permissions": {
    "allow": [
      "Bash(npm run *)"
    ]
  },
  "hooks": {
    "Stop": []
  },
  "enabledPlugins": {
    "demo@market": true
  },
  "env": {
    "ANTHROPIC_BASE_URL": "https://hand-written.example"
  }
}
`;

const SECRET = "sk-relay-secret-value";

// 模型选择器里的一行：id 与是否为默认模型。
interface ModelRow {
  id: string;
  isDefault: boolean;
}

// 测试 daemon 的假 Claude 提供方列出官方模型 haiku（默认）和 sonnet。
const OFFICIAL_MODELS: ModelRow[] = [
  { id: "haiku", isDefault: true },
  { id: "sonnet", isDefault: false },
];

const tempRoots: string[] = [];

async function connect(daemon: TestPaseoDaemon): Promise<DaemonClient> {
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.12.1",
  });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  return client;
}

describe("Claude API endpoint over the daemon RPC", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let claudeConfigDir: string;
  let settingsPath: string;
  // 改写配置时、替换文件前调用，模拟别的工具同时在改这份文件。
  let onRecheck: ((filePath: string) => void) | null;

  beforeEach(async () => {
    onRecheck = null;
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-"));
    tempRoots.push(root);
    claudeConfigDir = path.join(root, "claude");
    settingsPath = path.join(claudeConfigDir, "settings.json");
    await mkdir(claudeConfigDir, { recursive: true });
    await writeFile(settingsPath, USER_SETTINGS);
    daemon = await createTestPaseoDaemon({
      apiEndpoints: {
        env: { CLAUDE_CONFIG_DIR: claudeConfigDir },
        homeDir: root,
        beforeConfigRecheck: (filePath) => onRecheck?.(filePath),
      },
    });
    client = await connect(daemon);
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function createEndpoint(): Promise<string> {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrl: "https://relay.example/api/",
      apiKey: SECRET,
      models: [{ id: "relay/sonnet" }, { id: "relay/haiku" }],
      defaultModelId: "relay/sonnet",
    });
    expect(saved.error).toBeNull();
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    return saved.endpoint.id;
  }

  test("advertises the capability", () => {
    expect(client.getLastServerInfoMessage()?.features?.apiEndpoints).toBe(true);
  });

  test("create → activate → Official rewrites and restores only the owned keys", async () => {
    const endpointId = await createEndpoint();

    const listed = await client.apiEndpointList("claude");
    expect(listed).toMatchObject({
      provider: "claude",
      activeEndpointId: null,
      error: null,
      endpoints: [
        {
          id: endpointId,
          provider: "claude",
          name: "Relay",
          baseUrl: "https://relay.example/api",
          models: [{ id: "relay/sonnet" }, { id: "relay/haiku" }],
          defaultModelId: "relay/sonnet",
          hasApiKey: true,
        },
      ],
    });
    // 保存不改 CLI 配置，只有启用才改。
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);

    const activated = await client.apiEndpointSetActive("claude", endpointId);
    expect(activated).toMatchObject({ activeEndpointId: endpointId, error: null });

    const switched = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(switched).toEqual({
      permissions: { allow: ["Bash(npm run *)"], deny: ["WebSearch"] },
      hooks: { Stop: [] },
      enabledPlugins: { "demo@market": true },
      env: {
        ANTHROPIC_BASE_URL: "https://relay.example/api",
        ANTHROPIC_AUTH_TOKEN: SECRET,
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_MODEL: "relay/sonnet",
      },
    });
    expect((await client.apiEndpointList("claude")).activeEndpointId).toBe(endpointId);

    // 首次改写前留了一份完整副本。
    const backupsDir = path.join(daemon.paseoHome, "api-endpoints", "backups");
    const backups = await readdir(backupsDir);
    expect(backups).toHaveLength(1);
    expect(await readFile(path.join(backupsDir, backups[0]!), "utf8")).toBe(USER_SETTINGS);

    const official = await client.apiEndpointSetActive("claude", null);
    expect(official).toMatchObject({ activeEndpointId: null, error: null });
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });

  test("an absent settings.json is created on switch, removed on Official, and never backed up", async () => {
    await rm(settingsPath);
    const endpointId = await createEndpoint();

    await client.apiEndpointSetActive("claude", endpointId);
    expect(JSON.parse(await readFile(settingsPath, "utf8")).env.ANTHROPIC_AUTH_TOKEN).toBe(SECRET);

    // 编辑启用中的接口会再写一次；这时的文件是 Osuna 自己写的，不能当成「原件」备份。
    await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Relay",
      baseUrl: "https://relay.example/api",
      models: [{ id: "relay/sonnet" }],
      defaultModelId: "relay/sonnet",
    });
    const backupsDir = path.join(daemon.paseoHome, "api-endpoints", "backups");
    expect(await readdir(backupsDir).catch(() => [])).toEqual([]);

    await client.apiEndpointSetActive("claude", null);
    await expect(stat(settingsPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  // Windows 没有 POSIX 权限位。
  test.skipIf(process.platform === "win32")(
    "keeps the permissions of the user's settings.json",
    async () => {
      await chmod(settingsPath, 0o644);
      const endpointId = await createEndpoint();

      await client.apiEndpointSetActive("claude", endpointId);
      expect((await stat(settingsPath)).mode & 0o777).toBe(0o644);
      await client.apiEndpointSetActive("claude", null);
      expect((await stat(settingsPath)).mode & 0o777).toBe(0o644);
    },
  );

  test("never returns the API key and keeps it when an edit leaves it blank", async () => {
    const endpointId = await createEndpoint();

    const edited = await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Relay renamed",
      baseUrl: "https://relay.example/api",
      models: [{ id: "relay/sonnet" }],
      defaultModelId: "relay/sonnet",
    });
    expect(edited.endpoint).toMatchObject({ name: "Relay renamed", hasApiKey: true });
    expect(JSON.stringify(edited)).not.toContain(SECRET);
    expect(JSON.stringify(await client.apiEndpointList("claude"))).not.toContain(SECRET);

    await client.apiEndpointSetActive("claude", endpointId);
    expect(JSON.parse(await readFile(settingsPath, "utf8")).env.ANTHROPIC_AUTH_TOKEN).toBe(SECRET);

    const keysPath = path.join(daemon.paseoHome, "api-endpoints", "keys.json");
    if (process.platform !== "win32") {
      expect((await stat(keysPath)).mode & 0o777).toBe(0o600);
    }
    const daemonConfig = await readFile(path.join(daemon.paseoHome, "config.json"), "utf8").catch(
      () => "",
    );
    expect(daemonConfig).not.toContain(SECRET);
  });

  test("editing the active endpoint rewrites the file right away", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("claude", endpointId);

    await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Relay",
      baseUrl: "https://relay.example/api",
      models: [{ id: "relay/sonnet" }, { id: "relay/haiku" }],
      defaultModelId: "relay/haiku",
    });

    expect(JSON.parse(await readFile(settingsPath, "utf8")).env.ANTHROPIC_MODEL).toBe(
      "relay/haiku",
    );
  });

  test("deleting the active endpoint switches back to Official first", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("claude", endpointId);

    const deleted = await client.apiEndpointDelete("claude", endpointId);

    expect(deleted).toMatchObject({ activeEndpointId: null, error: null });
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
    expect((await client.apiEndpointList("claude")).endpoints).toEqual([]);
  });

  test("deleting the active endpoint restores the original values after an outside change", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("claude", endpointId);
    const switched = await readFile(settingsPath, "utf8");
    await writeFile(
      settingsPath,
      switched.replace('"https://relay.example/api"', '"https://other-tool.example"'),
    );

    expect(await client.apiEndpointDelete("claude", endpointId)).toMatchObject({
      activeEndpointId: null,
      error: null,
    });
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });

  test("deleting the active endpoint while settings.json keeps changing deletes nothing", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("claude", endpointId);
    let changes = 0;
    onRecheck = (filePath) => {
      changes += 1;
      writeFileSync(filePath, `{ "rev": ${changes} }`);
    };

    const deleted = await client.apiEndpointDelete("claude", endpointId);

    expect(deleted.error?.code).toBe("config_conflict");
    onRecheck = null;
    const listed = await client.apiEndpointList("claude");
    expect(listed.activeEndpointId).toBe(endpointId);
    expect(listed.endpoints.map((endpoint) => endpoint.id)).toEqual([endpointId]);
  });

  test("refuses to write when settings.json does not parse", async () => {
    const endpointId = await createEndpoint();
    const broken = `{ "env": { "A": "1", } }`;
    await writeFile(settingsPath, broken);

    const activated = await client.apiEndpointSetActive("claude", endpointId);

    expect(activated.activeEndpointId).toBeNull();
    expect(activated.error?.code).toBe("config_unparsable");
    expect(await readFile(settingsPath, "utf8")).toBe(broken);
    expect((await client.apiEndpointList("claude")).activeEndpointId).toBeNull();
  });

  test("an owned key changed outside Osuna shows as modified; other keys don't count", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("claude", endpointId);
    expect(await client.apiEndpointList("claude")).toMatchObject({ health: [], cliBaseUrl: null });

    const switched = await readFile(settingsPath, "utf8");
    const otherKeyEdited = switched.replace(`"demo@market": true`, `"demo@market": false`);
    await writeFile(settingsPath, otherKeyEdited);
    expect((await client.apiEndpointList("claude")).health).toEqual([]);

    await writeFile(
      settingsPath,
      otherKeyEdited.replace('"https://relay.example/api"', '"https://other-tool.example"'),
    );
    const listed = await client.apiEndpointList("claude");
    expect(listed.activeEndpointId).toBe(endpointId);
    expect(listed.health).toEqual([
      {
        code: "modified_externally",
        message: expect.stringContaining("env.ANTHROPIC_BASE_URL"),
      },
    ]);
  });

  test("re-apply writes the endpoint again; Official restores the original values", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("claude", endpointId);
    const switched = await readFile(settingsPath, "utf8");
    const modified = switched.replace(
      '"https://relay.example/api"',
      '"https://other-tool.example"',
    );
    await writeFile(settingsPath, modified);

    // 「重新应用」就是再启用一次当前接口。
    expect(await client.apiEndpointSetActive("claude", endpointId)).toMatchObject({ error: null });
    expect(await readFile(settingsPath, "utf8")).toBe(switched);
    expect((await client.apiEndpointList("claude")).health).toEqual([]);

    await writeFile(settingsPath, modified);
    expect(await client.apiEndpointSetActive("claude", null)).toMatchObject({ error: null });
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });

  test("Official shows where settings.json itself points", async () => {
    const endpointId = await createEndpoint();
    expect(await client.apiEndpointList("claude")).toMatchObject({
      activeEndpointId: null,
      health: [],
      cliBaseUrl: "https://hand-written.example",
    });

    await client.apiEndpointSetActive("claude", endpointId);
    expect((await client.apiEndpointList("claude")).cliBaseUrl).toBeNull();
  });

  test("reports a settings.json that does not parse", async () => {
    await writeFile(settingsPath, `{ "env": { "A": "1", } }`);

    expect((await client.apiEndpointList("claude")).health).toEqual([
      { code: "config_unparsable", message: expect.stringContaining(settingsPath) },
    ]);
  });

  test("a change made while it writes is kept: the patch is recomputed on the new content", async () => {
    const endpointId = await createEndpoint();
    let changes = 0;
    onRecheck = (filePath) => {
      changes += 1;
      if (changes === 1)
        writeFileSync(filePath, USER_SETTINGS.replace("{\n", '{\n  "theme": "dark",\n'));
    };

    expect(await client.apiEndpointSetActive("claude", endpointId)).toMatchObject({
      activeEndpointId: endpointId,
      error: null,
    });

    const written = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(written.theme).toBe("dark");
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe(SECRET);
    // 首次改写的完整副本只留一份：重算前做的那份随回滚收回。
    const backupsDir = path.join(daemon.paseoHome, "api-endpoints", "backups");
    const backups = await readdir(backupsDir);
    expect(backups).toHaveLength(1);
    expect(await readFile(path.join(backupsDir, backups[0]!), "utf8")).toContain('"theme": "dark"');
    onRecheck = null;
    await client.apiEndpointSetActive("claude", null);
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
      theme: "dark",
      ...JSON.parse(USER_SETTINGS),
    });
  });

  test("a file that keeps changing is a conflict for switching and for Official alike", async () => {
    const endpointId = await createEndpoint();
    let changes = 0;
    onRecheck = (filePath) => {
      changes += 1;
      writeFileSync(filePath, USER_SETTINGS.replace("{\n", `{\n  "rev": ${changes},\n`));
    };

    const activated = await client.apiEndpointSetActive("claude", endpointId);
    expect(activated).toMatchObject({ activeEndpointId: null, error: { code: "config_conflict" } });
    expect(JSON.parse(await readFile(settingsPath, "utf8")).env).toEqual({
      ANTHROPIC_BASE_URL: "https://hand-written.example",
    });

    onRecheck = null;
    await client.apiEndpointSetActive("claude", endpointId);
    onRecheck = (filePath) => {
      changes += 1;
      writeFileSync(filePath, `{ "rev": ${changes} }`);
    };
    const official = await client.apiEndpointSetActive("claude", null);
    expect(official).toMatchObject({
      activeEndpointId: endpointId,
      error: { code: "config_conflict" },
    });
    expect((await client.apiEndpointList("claude")).activeEndpointId).toBe(endpointId);
  });

  test("rejects invalid input and unsupported providers with a code", async () => {
    const missingKey = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrl: "https://relay.example",
      models: [{ id: "m" }],
      defaultModelId: "m",
    });
    expect(missingKey).toMatchObject({ endpoint: null, error: { code: "invalid_input" } });

    const badDefault = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrl: "https://relay.example",
      apiKey: SECRET,
      models: [{ id: "m" }],
      defaultModelId: "other",
    });
    expect(badDefault.error?.code).toBe("invalid_input");

    const unsupported = await client.apiEndpointList("opencode");
    expect(unsupported.error?.code).toBe("unsupported_provider");
  });
});

describe("provider snapshot follows the Claude API endpoint mode", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let cwd: string;

  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-snapshot-"));
    tempRoots.push(root);
    cwd = path.join(root, "project");
    await mkdir(cwd);
    daemon = await createTestPaseoDaemon({
      apiEndpoints: { env: { CLAUDE_CONFIG_DIR: path.join(root, "claude") }, homeDir: root },
    });
    client = await connect(daemon);
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function claudeEntry() {
    const snapshot = await client.getProvidersSnapshot();
    return snapshot.entries.find((entry) => entry.provider === "claude");
  }

  async function claudeModels(): Promise<ModelRow[] | null> {
    const entry = await claudeEntry();
    if (entry?.status !== "ready") return null;
    return (entry.models ?? []).map((model) => {
      const isDefault = model.isDefault === true;
      return { id: model.id, isDefault };
    });
  }

  async function expectClaudeModels(expected: ModelRow[]): Promise<void> {
    await expect.poll(claudeModels, { timeout: 10_000 }).toEqual(expected);
  }

  async function createEndpoint(): Promise<string> {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrl: "https://relay.example/api",
      apiKey: "sk-relay-secret",
      models: [{ id: "relay/sonnet", label: "Relay Sonnet" }, { id: "relay/haiku" }],
      defaultModelId: "relay/haiku",
    });
    expect(saved.error).toBeNull();
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    return saved.endpoint.id;
  }

  test("enabling lists only the endpoint's models; Official restores the official list", async () => {
    await expectClaudeModels(OFFICIAL_MODELS);
    const endpointId = await createEndpoint();
    // 只保存不启用：模型列表不变。
    await expectClaudeModels(OFFICIAL_MODELS);

    expect(await client.apiEndpointSetActive("claude", endpointId)).toMatchObject({ error: null });
    await expectClaudeModels([
      { id: "relay/sonnet", isDefault: false },
      { id: "relay/haiku", isDefault: true },
    ]);
    const claude = await claudeEntry();
    expect(claude?.models?.map((model) => model.label)).toEqual(["Relay Sonnet", "relay/haiku"]);
    // 客户端据此不再保留列表外的记忆模型（比如官方模式下选过的模型）。
    expect(claude?.isModelListAuthoritative).toBe(true);
    // 套餐用量和继承 claude 的自定义提供方据此标注「当前走第三方接口」。
    expect(claude?.activeApiEndpoint).toEqual({ id: endpointId, name: "Relay" });

    expect(await client.apiEndpointSetActive("claude", null)).toMatchObject({ error: null });
    await expectClaudeModels(OFFICIAL_MODELS);
    const official = await claudeEntry();
    expect(official?.isModelListAuthoritative).toBeUndefined();
    expect(official?.activeApiEndpoint).toBeUndefined();
  });

  test("a new agent without a model gets the endpoint's real default model id", async () => {
    const endpointId = await createEndpoint();
    expect(await client.apiEndpointSetActive("claude", endpointId)).toMatchObject({ error: null });

    const agent = await client.createAgent({ provider: "claude", cwd, title: "Relay agent" });
    expect(agent.model).toBe("relay/haiku");

    expect(await client.apiEndpointSetActive("claude", null)).toMatchObject({ error: null });
    const official = await client.createAgent({ provider: "claude", cwd, title: "Official" });
    expect(official.model).toBe("haiku");
  });

  test("the list counts the live sessions of this provider that a switch would move", async () => {
    expect((await client.apiEndpointList("claude")).runningSessionCount).toBe(0);

    const first = await client.createAgent({ provider: "claude", cwd, title: "One" });
    await client.createAgent({ provider: "claude", cwd, title: "Two" });
    await client.createAgent({ provider: "codex", cwd, title: "Codex" });
    // 空闲的会话也算：进程还在，下一轮对话就走新配置。
    expect((await client.apiEndpointList("claude")).runningSessionCount).toBe(2);
    expect((await client.apiEndpointList("codex")).runningSessionCount).toBe(1);

    await client.archiveAgent(first.id);
    expect((await client.apiEndpointList("claude")).runningSessionCount).toBe(1);
  });

  test("editing the active endpoint refreshes the models right away", async () => {
    const endpointId = await createEndpoint();
    expect(await client.apiEndpointSetActive("claude", endpointId)).toMatchObject({ error: null });
    await expectClaudeModels([
      { id: "relay/sonnet", isDefault: false },
      { id: "relay/haiku", isDefault: true },
    ]);

    const edited = await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Relay",
      baseUrl: "https://relay.example/api",
      models: [{ id: "relay/opus" }, { id: "relay/sonnet" }],
      defaultModelId: "relay/opus",
    });
    expect(edited.error).toBeNull();
    await expectClaudeModels([
      { id: "relay/opus", isDefault: true },
      { id: "relay/sonnet", isDefault: false },
    ]);
  });

  test("deleting the active endpoint brings the official models back", async () => {
    const endpointId = await createEndpoint();
    expect(await client.apiEndpointSetActive("claude", endpointId)).toMatchObject({ error: null });
    await expectClaudeModels([
      { id: "relay/sonnet", isDefault: false },
      { id: "relay/haiku", isDefault: true },
    ]);

    expect(await client.apiEndpointDelete("claude", endpointId)).toMatchObject({
      activeEndpointId: null,
      error: null,
    });
    await expectClaudeModels(OFFICIAL_MODELS);
  });
});

describe("an agent session remembers the Claude API endpoint mode it was created in", () => {
  let root: string;
  let daemon: TestPaseoDaemon | null;
  let client: DaemonClient | null;
  let cwd: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-session-"));
    tempRoots.push(root);
    cwd = path.join(root, "project");
    await mkdir(cwd);
    daemon = null;
    client = null;
  });

  afterEach(async () => {
    await stopDaemon();
    await Promise.all(
      tempRoots.splice(0).map((tempRoot) => rm(tempRoot, { recursive: true, force: true })),
    );
  });

  // 同一个 PASEO_HOME 上重启 daemon：会话从持久化记录恢复，而不是还在内存里。
  async function startDaemon(): Promise<DaemonClient> {
    daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      cleanup: false,
      apiEndpoints: { env: { CLAUDE_CONFIG_DIR: path.join(root, "claude") }, homeDir: root },
    });
    client = await connect(daemon);
    return client;
  }

  async function stopDaemon(): Promise<void> {
    await client?.close();
    await daemon?.close();
    client = null;
    daemon = null;
  }

  async function createEndpoint(active: DaemonClient): Promise<string> {
    const saved = await active.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrl: "https://relay.example/api",
      apiKey: "sk-relay-secret",
      models: [{ id: "relay/haiku" }],
      defaultModelId: "relay/haiku",
    });
    expect(saved.error).toBeNull();
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    return saved.endpoint.id;
  }

  async function readAgentRecord(agentId: string): Promise<Record<string, unknown>> {
    if (!daemon) throw new Error("Expected a running daemon");
    const agentsDir = path.join(daemon.paseoHome, "agents");
    const files = await readdir(agentsDir, { recursive: true });
    const file = files.find((candidate) => path.basename(candidate) === `${agentId}.json`);
    if (!file) throw new Error(`No record for ${agentId}`);
    return JSON.parse(await readFile(path.join(agentsDir, file), "utf8"));
  }

  async function modeNotices(active: DaemonClient, agentId: string) {
    const timeline = await active.fetchAgentTimeline(agentId, {
      direction: "tail",
      limit: 0,
      projection: "canonical",
    });
    return timeline.entries
      .map((entry) => entry.item)
      .filter((item) => item.type === "notification");
  }

  test("the record keeps the endpoint id; Official leaves the field out", async () => {
    const active = await startDaemon();
    const endpointId = await createEndpoint(active);
    expect(await active.apiEndpointSetActive("claude", endpointId)).toMatchObject({ error: null });
    const relayAgent = await active.createAgent({ provider: "claude", cwd, title: "Relay" });
    expect(await active.apiEndpointSetActive("claude", null)).toMatchObject({ error: null });
    const officialAgent = await active.createAgent({ provider: "claude", cwd, title: "Official" });
    // Codex 没启用接口：它的会话也按「官方」记录。
    const codexAgent = await active.createAgent({ provider: "codex", cwd, title: "Codex" });

    await expect
      .poll(async () => (await readAgentRecord(relayAgent.id)).apiEndpointId)
      .toBe(endpointId);
    expect(await readAgentRecord(officialAgent.id)).not.toHaveProperty("apiEndpointId");
    expect(await readAgentRecord(codexAgent.id)).not.toHaveProperty("apiEndpointId");
  });

  test("resuming a session created with an endpoint while on Official shows one notice", async () => {
    let active = await startDaemon();
    const endpointId = await createEndpoint(active);
    expect(await active.apiEndpointSetActive("claude", endpointId)).toMatchObject({ error: null });
    const agent = await active.createAgent({ provider: "claude", cwd, title: "Relay" });
    expect(await active.apiEndpointSetActive("claude", null)).toMatchObject({ error: null });
    // 还在内存里的会话不算恢复，不提示。
    expect(await modeNotices(active, agent.id)).toEqual([]);
    await stopDaemon();

    active = await startDaemon();
    const expected = [
      {
        type: "notification",
        level: "warning",
        message:
          'This session was created with the API endpoint "Relay", but the current mode is Official. It may not be able to continue.',
        apiEndpointModeMismatch: { createdIn: { id: endpointId, name: "Relay" }, current: null },
      },
    ];
    expect(await modeNotices(active, agent.id)).toEqual(expected);
    // 同一次恢复里再取时间线，不再追加。
    expect(await modeNotices(active, agent.id)).toEqual(expected);
    // 关闭后在同一进程里再恢复：时间线原样保留，不重复提示。
    await daemon?.daemon.agentManager.closeAgent(agent.id);
    expect(await modeNotices(active, agent.id)).toEqual(expected);
    // 恢复不改写创建时的模式。
    expect((await readAgentRecord(agent.id)).apiEndpointId).toBe(endpointId);
  });

  test("an old record without the field counts as Official; the same mode shows nothing", async () => {
    let active = await startDaemon();
    const endpointId = await createEndpoint(active);
    const officialAgent = await active.createAgent({ provider: "claude", cwd, title: "Official" });
    expect(await active.apiEndpointSetActive("claude", endpointId)).toMatchObject({ error: null });
    const relayAgent = await active.createAgent({ provider: "claude", cwd, title: "Relay" });
    // 官方模式写出的记录和字段出现之前的老记录一样，都没有 apiEndpointId。
    await expect
      .poll(async () => (await readAgentRecord(relayAgent.id)).apiEndpointId)
      .toBe(endpointId);
    expect(await readAgentRecord(officialAgent.id)).not.toHaveProperty("apiEndpointId");
    await stopDaemon();

    active = await startDaemon();
    expect(await modeNotices(active, officialAgent.id)).toEqual([
      {
        type: "notification",
        level: "warning",
        message:
          'This session was created on Official, but the current mode is the API endpoint "Relay". It may not be able to continue.',
        apiEndpointModeMismatch: { createdIn: null, current: { id: endpointId, name: "Relay" } },
      },
    ]);
    expect(await modeNotices(active, relayAgent.id)).toEqual([]);
  });

  test("viewing the history of an archived session shows no notice", async () => {
    let active = await startDaemon();
    const endpointId = await createEndpoint(active);
    expect(await active.apiEndpointSetActive("claude", endpointId)).toMatchObject({ error: null });
    const agent = await active.createAgent({ provider: "claude", cwd, title: "Relay" });
    expect(await active.apiEndpointSetActive("claude", null)).toMatchObject({ error: null });
    await active.archiveAgent(agent.id);
    await stopDaemon();

    active = await startDaemon();
    expect(await modeNotices(active, agent.id)).toEqual([]);
  });

  test("a deleted endpoint is reported without a name", async () => {
    let active = await startDaemon();
    const endpointId = await createEndpoint(active);
    expect(await active.apiEndpointSetActive("claude", endpointId)).toMatchObject({ error: null });
    const agent = await active.createAgent({ provider: "claude", cwd, title: "Relay" });
    expect(await active.apiEndpointDelete("claude", endpointId)).toMatchObject({ error: null });
    await stopDaemon();

    active = await startDaemon();
    expect(await modeNotices(active, agent.id)).toEqual([
      {
        type: "notification",
        level: "warning",
        message:
          "This session was created with an API endpoint that has since been deleted, but the current mode is Official. It may not be able to continue.",
        apiEndpointModeMismatch: { createdIn: { id: endpointId, name: null }, current: null },
      },
    ]);
  });
});
