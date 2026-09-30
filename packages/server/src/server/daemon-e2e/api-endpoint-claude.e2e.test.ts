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

  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-"));
    tempRoots.push(root);
    claudeConfigDir = path.join(root, "claude");
    settingsPath = path.join(claudeConfigDir, "settings.json");
    await mkdir(claudeConfigDir, { recursive: true });
    await writeFile(settingsPath, USER_SETTINGS);
    daemon = await createTestPaseoDaemon({
      apiEndpoints: { env: { CLAUDE_CONFIG_DIR: claudeConfigDir }, homeDir: root },
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
