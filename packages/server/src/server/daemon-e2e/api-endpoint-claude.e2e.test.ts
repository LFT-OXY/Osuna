import { writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
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

  function gatewayUrl(): string {
    return `http://127.0.0.1:${daemon.port}/api-endpoint-gateway`;
  }

  async function gatewayTokens(): Promise<Record<string, string>> {
    const text = await readFile(
      path.join(daemon.paseoHome, "api-endpoints", "gateway-tokens.json"),
      "utf8",
    ).catch(() => '{"tokens":{}}');
    return (JSON.parse(text) as { tokens: Record<string, string> }).tokens;
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

    // 只指向 daemon 中转站：地址、口令、起始模型；真实 key 不出现。
    const token = (await gatewayTokens()).claude;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const switchedText = await readFile(settingsPath, "utf8");
    expect(switchedText).not.toContain(SECRET);
    expect(JSON.parse(switchedText)).toEqual({
      permissions: { allow: ["Bash(npm run *)"], deny: ["WebSearch"] },
      hooks: { Stop: [] },
      enabledPlugins: { "demo@market": true },
      env: {
        ANTHROPIC_BASE_URL: gatewayUrl(),
        ANTHROPIC_AUTH_TOKEN: token,
        ANTHROPIC_API_KEY: "",
        // 别家的起始模型照 magpie 在 272K 压缩（WorkingWindow）。
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: "272000",
        // 接口模型都不是 Claude：Claude Code 的自动模式不请服务器审查。
        CLAUDE_CODE_AUTO_MODE_SERVER: "0",
      },
      model: "relay/sonnet",
      // 终端 /model 列出这家的已选模型：`标识/模型名`、模型名、接口名。
      modelPicker: {
        options: [
          { model: "relay/relay/sonnet", label: "relay/sonnet", description: "Relay" },
          { model: "relay/relay/haiku", label: "relay/haiku", description: "Relay" },
        ],
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
    // 口令不作废（ADR 0010）：关掉后还在跑的会话照样认得出是 Claude Code。
    expect((await gatewayTokens()).claude).toBe(token);
  });

  test("the token outlives the switch: still taken after Official, and written again unchanged", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("claude", endpointId);
    const token = JSON.parse(await readFile(settingsPath, "utf8")).env.ANTHROPIC_AUTH_TOKEN;
    const hello = () =>
      fetch(`${gatewayUrl()}/api/hello`, { headers: { authorization: `Bearer ${token}` } });

    expect((await hello()).status).toBe(200);
    await client.apiEndpointSetActive("claude", null);
    expect((await hello()).status).toBe(200);

    await client.apiEndpointSetActive("claude", endpointId);
    const next = JSON.parse(await readFile(settingsPath, "utf8")).env.ANTHROPIC_AUTH_TOKEN;
    expect(next).toBe(token);
  });

  test("model variables that would outrank /model are taken out and put back on Official", async () => {
    const handWritten = `{
  "env": {
    "ANTHROPIC_MODEL": "my-model",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "my-opus",
    "ANTHROPIC_SMALL_FAST_MODEL": "my-fast"
  },
  "model": "opus"
}
`;
    await writeFile(settingsPath, handWritten);
    const endpointId = await createEndpoint();

    await client.apiEndpointSetActive("claude", endpointId);
    const switched = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(switched.model).toBe("relay/sonnet");
    expect(Object.keys(switched.env)).toEqual([
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
      "CLAUDE_CODE_AUTO_MODE_SERVER",
    ]);

    await client.apiEndpointSetActive("claude", null);
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual(JSON.parse(handWritten));
  });

  test("an absent settings.json is created on switch, removed on Official, and never backed up", async () => {
    await rm(settingsPath);
    const endpointId = await createEndpoint();

    await client.apiEndpointSetActive("claude", endpointId);
    expect(JSON.parse(await readFile(settingsPath, "utf8")).env.ANTHROPIC_BASE_URL).toBe(
      gatewayUrl(),
    );

    // 编辑启用中的接口会再写一次；这时的文件是 Osuna 自己写的，不能当成「原件」备份。
    await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Relay",
      baseUrl: "https://relay.example/api",
      models: [{ id: "relay/haiku" }],
      defaultModelId: "relay/haiku",
    });
    expect(JSON.parse(await readFile(settingsPath, "utf8")).model).toBe("relay/haiku");
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
    expect(await readFile(settingsPath, "utf8")).not.toContain(SECRET);

    const keysPath = path.join(daemon.paseoHome, "api-endpoints", "keys.json");
    if (process.platform !== "win32") {
      expect((await stat(keysPath)).mode & 0o777).toBe(0o600);
    }
    const daemonConfig = await readFile(path.join(daemon.paseoHome, "config.json"), "utf8").catch(
      () => "",
    );
    expect(daemonConfig).not.toContain(SECRET);
  });

  test("a new default model rewrites the file right away; the endpoint's address and key don't", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("claude", endpointId);
    const switched = await readFile(settingsPath, "utf8");

    await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Relay",
      baseUrl: "https://moved.example/api",
      apiKey: "sk-rotated",
      models: [{ id: "relay/sonnet" }, { id: "relay/haiku" }],
      defaultModelId: "relay/sonnet",
    });
    expect(await readFile(settingsPath, "utf8")).toBe(switched);

    await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Relay",
      baseUrl: "https://moved.example/api",
      models: [{ id: "relay/sonnet" }, { id: "relay/haiku" }],
      defaultModelId: "relay/haiku",
    });
    expect(JSON.parse(await readFile(settingsPath, "utf8")).model).toBe("relay/haiku");
  });

  test("modelPicker follows the selected models and the endpoint switches; Official removes it", async () => {
    const relayId = await createEndpoint();
    const backup = await client.apiEndpointSave({
      provider: "claude",
      name: "Backup",
      baseUrl: "https://backup.example/v1",
      apiKey: "sk-backup",
      models: [{ id: "gpt-6" }],
      defaultModelId: "gpt-6",
    });
    const backupId = backup.endpoint?.id;
    if (!backupId) throw new Error("Expected a saved endpoint");
    await client.apiEndpointSetActive("claude", relayId);
    await client.apiEndpointSetEndpointState({ endpointId: backupId, enabled: true });
    const picker = async () => JSON.parse(await readFile(settingsPath, "utf8")).modelPicker;

    expect(await picker()).toEqual({
      options: [
        { model: "relay/relay/sonnet", label: "relay/sonnet", description: "Relay" },
        { model: "relay/relay/haiku", label: "relay/haiku", description: "Relay" },
        { model: "backup/gpt-6", label: "gpt-6", description: "Backup" },
      ],
    });

    await client.apiEndpointSave({
      provider: "claude",
      endpointId: relayId,
      name: "Relay",
      baseUrl: "https://relay.example/api",
      models: [{ id: "relay/haiku" }],
      defaultModelId: "relay/haiku",
    });
    expect(await picker()).toEqual({
      options: [
        { model: "relay/relay/haiku", label: "relay/haiku", description: "Relay" },
        { model: "backup/gpt-6", label: "gpt-6", description: "Backup" },
      ],
    });

    await client.apiEndpointSetEndpointState({ endpointId: backupId, enabled: false });
    expect(await picker()).toEqual({
      options: [{ model: "relay/relay/haiku", label: "relay/haiku", description: "Relay" }],
    });

    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });

  test("a modelPicker the user wrote stays as it is while switched and after Official", async () => {
    const withPicker = USER_SETTINGS.replace(
      `  "enabledPlugins": {`,
      `  "modelPicker": {
    "options": [
      {
        "model": "opus",
        "label": "Mine"
      }
    ]
  },
  "enabledPlugins": {`,
    );
    await writeFile(settingsPath, withPicker);
    const endpointId = await createEndpoint();

    await client.apiEndpointSetActive("claude", endpointId);
    const switched = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(switched.modelPicker).toEqual({ options: [{ model: "opus", label: "Mine" }] });
    expect(switched.model).toBe("relay/sonnet");

    await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Relay",
      baseUrl: "https://relay.example/api",
      models: [{ id: "relay/haiku" }],
      defaultModelId: "relay/haiku",
    });
    expect(JSON.parse(await readFile(settingsPath, "utf8")).modelPicker).toEqual({
      options: [{ model: "opus", label: "Mine" }],
    });

    await client.apiEndpointSetActive("claude", null);
    expect(await readFile(settingsPath, "utf8")).toBe(withPicker);
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
      switched.replace(`"${gatewayUrl()}"`, '"https://other-tool.example"'),
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

  test("refuses to write when settings.json isn't valid JSONC either, with the file and where", async () => {
    const endpointId = await createEndpoint();
    const broken = `{\n  "env": {\n    "A": "1"\n    "B": "2"\n  }\n}\n`;
    await writeFile(settingsPath, broken);

    const activated = await client.apiEndpointSetActive("claude", endpointId);

    expect(activated.activeEndpointId).toBeNull();
    expect(activated.error).toEqual({
      code: "config_unparsable",
      params: {
        file: settingsPath,
        detail: "CommaExpected at line 4, column 5",
        reason: "syntax",
        line: "4",
        column: "5",
      },
      message: expect.stringContaining(settingsPath),
    });
    expect(await readFile(settingsPath, "utf8")).toBe(broken);
    expect((await client.apiEndpointList("claude")).activeEndpointId).toBeNull();
  });

  describe("settings.json with a BOM, comments or trailing commas", () => {
    const BOM = "\uFEFF";
    // 用户自己写的 JSONC：注释紧挨着 Osuna 负责的键，结尾带逗号。
    const COMMENTED = `{
  // 我自己的中转站，切回官方时要回来
  "env": {
    "ANTHROPIC_BASE_URL": "https://hand-written.example", /* 手填 */
    "DISABLE_TELEMETRY": "1", // 关遥测
  },
  "theme": "dark",
}
`;

    async function switchOn(): Promise<void> {
      const endpointId = await createEndpoint();
      const on = await client.apiEndpointSetActive("claude", endpointId);
      expect(on).toMatchObject({ activeEndpointId: endpointId, error: null });
    }

    test("a leading BOM stays, the owned keys are written after it, and switching off restores the bytes", async () => {
      await writeFile(settingsPath, `${BOM}${USER_SETTINGS}`);

      await switchOn();

      const switched = await readFile(settingsPath, "utf8");
      expect(switched.startsWith(BOM)).toBe(true);
      expect(JSON.parse(switched.slice(BOM.length)).env).toMatchObject({
        ANTHROPIC_BASE_URL: gatewayUrl(),
        ANTHROPIC_API_KEY: "",
      });
      // Claude Code 自己读得了带 BOM 的文件：不算「设置文件带注释」。
      expect((await client.apiEndpointList("claude")).agentIssues?.claude).toEqual([]);

      await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
      expect(await readFile(settingsPath, "utf8")).toBe(`${BOM}${USER_SETTINGS}`);
    });

    test("comments and trailing commas are kept word for word; only the owned keys change", async () => {
      await writeFile(settingsPath, COMMENTED);

      await switchOn();

      const token = (await gatewayTokens()).claude;
      expect(await readFile(settingsPath, "utf8")).toBe(`{
  // 我自己的中转站，切回官方时要回来
  "env": {
    "ANTHROPIC_BASE_URL": "${gatewayUrl()}", /* 手填 */
    "DISABLE_TELEMETRY": "1", // 关遥测
    "ANTHROPIC_AUTH_TOKEN": "${token}",
    "ANTHROPIC_API_KEY": "",
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "272000",
    "CLAUDE_CODE_AUTO_MODE_SERVER": "0",
  },
  "theme": "dark",
  "model": "relay/sonnet",
  "permissions": {
    "deny": [
      "WebSearch"
    ]
  },
  "modelPicker": {
    "options": [
      {
        "model": "relay/relay/sonnet",
        "label": "relay/sonnet",
        "description": "Relay"
      },
      {
        "model": "relay/relay/haiku",
        "label": "relay/haiku",
        "description": "Relay"
      }
    ]
  },
}
`);

      await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
      expect(await readFile(settingsPath, "utf8")).toBe(COMMENTED);
    });

    test("the list says Claude Code can't read the file while it has comments, and stops once they are gone", async () => {
      await writeFile(settingsPath, COMMENTED);
      await switchOn();

      expect((await client.apiEndpointList("claude")).agentIssues?.claude).toEqual([
        {
          code: "settings_has_comments",
          params: { file: settingsPath },
          message: expect.stringContaining(settingsPath),
        },
      ]);

      const switched = await readFile(settingsPath, "utf8");
      // 用户删掉注释与尾随逗号：同样的内容存成严格 JSON。
      const withoutComments = JSON.stringify(parseJsonc(switched), null, 2);
      await writeFile(settingsPath, withoutComments);
      expect((await client.apiEndpointList("claude")).agentIssues?.claude).toEqual([]);
    });

    test("a trailing comma alone counts too", async () => {
      await writeFile(settingsPath, `{\n  "theme": "dark",\n}\n`);
      await switchOn();

      expect((await client.apiEndpointList("claude")).agentIssues?.claude).toEqual([
        expect.objectContaining({ code: "settings_has_comments" }),
      ]);
    });

    test("nothing is said while the switch is off", async () => {
      await writeFile(settingsPath, COMMENTED);
      expect((await client.apiEndpointList("claude")).agentIssues?.claude).toEqual([]);
    });
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
      otherKeyEdited.replace(`"${gatewayUrl()}"`, '"https://other-tool.example"'),
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
    const modified = switched.replace(`"${gatewayUrl()}"`, '"https://other-tool.example"');
    await writeFile(settingsPath, modified);

    // 「重新应用」就是再启用一次当前接口。
    expect(await client.apiEndpointSetActive("claude", endpointId)).toMatchObject({ error: null });
    expect(await readFile(settingsPath, "utf8")).toBe(switched);
    expect((await client.apiEndpointList("claude")).health).toEqual([]);

    await writeFile(settingsPath, modified);
    expect(await client.apiEndpointSetActive("claude", null)).toMatchObject({ error: null });
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });

  describe("keeping Claude Code's claude.ai sign-in (ADR 0012)", () => {
    async function switchOn(): Promise<string> {
      const endpointId = await createEndpoint();
      await client.apiEndpointSetActive("claude", endpointId);
      return JSON.parse(await readFile(settingsPath, "utf8")).env.ANTHROPIC_AUTH_TOKEN as string;
    }
    function keep(keepsClaudeAiLogin: boolean, enabled = true) {
      return client.apiEndpointSetAgentSettings({
        provider: "claude",
        enabled,
        keepsClaudeAiLogin,
      });
    }
    async function writtenToken(): Promise<unknown> {
      return JSON.parse(await readFile(settingsPath, "utf8")).env.ANTHROPIC_AUTH_TOKEN;
    }

    test("on writes the token empty, off writes it back, and switching off restores the file", async () => {
      const token = await switchOn();

      const kept = await keep(true);
      expect(kept).toMatchObject({
        error: null,
        agent: { enabled: true, keepsClaudeAiLogin: true },
      });
      expect(await writtenToken()).toBe("");
      expect((await client.apiEndpointList("claude")).agents?.claude?.keepsClaudeAiLogin).toBe(
        true,
      );
      expect((await client.apiEndpointList("claude")).agentIssues?.claude).toEqual([]);

      expect(await keep(false)).toMatchObject({ error: null });
      expect(await writtenToken()).toBe(token);

      await keep(true);
      expect(
        await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false }),
      ).toMatchObject({ error: null, agent: { enabled: false, keepsClaudeAiLogin: true } });
      expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
    });

    test("the choice is kept while switched off and applies when switched on again", async () => {
      const endpointId = await createEndpoint();

      expect(await keep(true, false)).toMatchObject({
        error: null,
        agent: { enabled: false, keepsClaudeAiLogin: true },
      });
      expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);

      await client.apiEndpointSetActive("claude", endpointId);
      expect(await writtenToken()).toBe("");
    });

    test("a token typed back in while it is on is reported; Re-apply empties it again", async () => {
      const token = await switchOn();
      await keep(true);
      const kept = await readFile(settingsPath, "utf8");
      await writeFile(
        settingsPath,
        kept.replace('"ANTHROPIC_AUTH_TOKEN": ""', `"ANTHROPIC_AUTH_TOKEN": "${token}"`),
      );

      expect((await client.apiEndpointList("claude")).agentIssues?.claude).toEqual([
        {
          code: "claude_ai_login_token_set",
          params: { file: settingsPath },
          message: expect.stringContaining("ANTHROPIC_AUTH_TOKEN"),
        },
      ]);

      await client.apiEndpointSetAgentSettings({
        provider: "claude",
        enabled: true,
        reapply: true,
      });
      expect(await readFile(settingsPath, "utf8")).toBe(kept);
      expect((await client.apiEndpointList("claude")).agentIssues?.claude).toEqual([]);
    });

    test("an empty or missing token while it is off is reported, not as leaving the gateway", async () => {
      const token = await switchOn();
      const switched = await readFile(settingsPath, "utf8");

      await writeFile(settingsPath, switched.replace(`"${token}"`, '""'));
      expect((await client.apiEndpointList("claude")).agentIssues?.claude).toEqual([
        {
          code: "claude_ai_login_token_empty",
          params: { file: settingsPath, how: "empty" },
          message: expect.stringContaining("claude.ai"),
        },
      ]);

      const parsed = JSON.parse(switched) as { env: Record<string, string> };
      delete parsed.env.ANTHROPIC_AUTH_TOKEN;
      await writeFile(settingsPath, JSON.stringify(parsed, null, 2));
      expect((await client.apiEndpointList("claude")).agentIssues?.claude).toEqual([
        {
          code: "claude_ai_login_token_empty",
          params: { file: settingsPath, how: "missing" },
          message: expect.stringContaining("claude.ai"),
        },
      ]);

      // 「保留 claude.ai 登录」打开后就是要的样子，不再提示。
      await keep(true);
      expect(await writtenToken()).toBe("");
      expect((await client.apiEndpointList("claude")).agentIssues?.claude).toEqual([]);
    });

    test("is refused for Codex", async () => {
      const refused = await client.apiEndpointSetAgentSettings({
        provider: "codex",
        enabled: false,
        keepsClaudeAiLogin: true,
      });
      expect(refused.error).toMatchObject({ code: "invalid_input" });
    });
  });

  describe("settings changed outside Osuna (agentIssues)", () => {
    async function switchOnThenRepoint(): Promise<{ switched: string; modified: string }> {
      const endpointId = await createEndpoint();
      await client.apiEndpointSetActive("claude", endpointId);
      const switched = await readFile(settingsPath, "utf8");
      const modified = switched.replace(`"${gatewayUrl()}"`, '"https://other-tool.example"');
      await writeFile(settingsPath, modified);
      return { switched, modified };
    }

    test("advertises the capability", () => {
      expect(client.getLastServerInfoMessage()?.features?.apiEndpointCliWiring).toBe(true);
    });

    test("an address changed outside Osuna reads as no longer going through the gateway", async () => {
      await switchOnThenRepoint();

      const listed = await client.apiEndpointList("claude");
      expect(listed.agentIssues).toEqual({
        claude: [
          {
            code: "not_through_gateway",
            params: { file: settingsPath, keys: "env.ANTHROPIC_BASE_URL" },
            message: expect.stringContaining("env.ANTHROPIC_BASE_URL"),
          },
        ],
        codex: [],
      });
      // 老客户端照旧看到 modified_externally。
      expect(listed.health).toEqual([
        { code: "modified_externally", message: expect.stringContaining("env.ANTHROPIC_BASE_URL") },
      ]);
    });

    test("a changed token counts too; a changed model alone is only Model replaced", async () => {
      const endpointId = await createEndpoint();
      await client.apiEndpointSetActive("claude", endpointId);
      const switched = JSON.parse(await readFile(settingsPath, "utf8")) as {
        model: string;
        env: Record<string, string>;
      };
      await writeFile(settingsPath, JSON.stringify({ ...switched, model: "other-model" }));
      expect((await client.apiEndpointList("claude")).agentIssues?.claude).toMatchObject([
        { code: "model_replaced" },
      ]);

      await writeFile(
        settingsPath,
        JSON.stringify({ ...switched, env: { ...switched.env, ANTHROPIC_AUTH_TOKEN: "sk-other" } }),
      );
      expect((await client.apiEndpointList("claude")).agentIssues?.claude).toEqual([
        {
          code: "not_through_gateway",
          params: { file: settingsPath, keys: "env.ANTHROPIC_AUTH_TOKEN" },
          message: expect.any(String),
        },
      ]);
    });

    test("re-apply writes the gateway back and the issue is gone", async () => {
      const { switched } = await switchOnThenRepoint();

      const reapplied = await client.apiEndpointSetAgentSettings({
        provider: "claude",
        enabled: true,
        reapply: true,
      });

      expect(reapplied.error).toBeNull();
      expect(await readFile(settingsPath, "utf8")).toBe(switched);
      expect((await client.apiEndpointList("claude")).agentIssues?.claude).toEqual([]);
    });

    test("switching to official turns the switch off and restores the file", async () => {
      await switchOnThenRepoint();

      const off = await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });

      expect(off.agent?.enabled).toBe(false);
      expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
      expect((await client.apiEndpointList("claude")).agentIssues?.claude).toEqual([]);
    });

    test("keeping the current settings turns the switch off, leaves the file as changed and stops warning", async () => {
      const { modified } = await switchOnThenRepoint();

      const kept = await client.apiEndpointKeepCurrentSettings({ provider: "claude" });

      expect(kept).toMatchObject({ provider: "claude", error: null });
      expect(kept.agent?.enabled).toBe(false);
      expect(await readFile(settingsPath, "utf8")).toBe(modified);
      const listed = await client.apiEndpointList("claude");
      expect(listed.agentIssues?.claude).toEqual([]);
      expect(listed.health).toEqual([]);
      expect(listed.agents?.claude?.enabled).toBe(false);
    });

    test("keeping the current settings while the switch is off changes nothing", async () => {
      const kept = await client.apiEndpointKeepCurrentSettings({ provider: "claude" });
      expect(kept).toMatchObject({ agent: { enabled: false }, error: null });
      expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
    });

    test("a settings.json that does not parse comes with the file and the reason", async () => {
      await writeFile(settingsPath, `{ "env": "on" }`);

      expect((await client.apiEndpointList("claude")).agentIssues?.claude).toEqual([
        {
          code: "config_unparsable",
          params: {
            file: settingsPath,
            detail: expect.any(String),
            reason: "key_not_object",
            key: "env",
          },
          message: expect.stringContaining(settingsPath),
        },
      ]);
    });
  });

  describe("previewing what switching off restores", () => {
    async function fileState(): Promise<{ text: string; mtimeMs: number }> {
      return {
        text: await readFile(settingsPath, "utf8"),
        mtimeMs: (await stat(settingsPath)).mtimeMs,
      };
    }

    test("lists the lines put back and taken out, writes nothing, and matches what switching off does", async () => {
      const handWritten = `{
  "env": {
    "ANTHROPIC_BASE_URL": "https://hand-written.example",
    "ANTHROPIC_MODEL": "my-model"
  },
  "model": "opus"
}
`;
      await writeFile(settingsPath, handWritten);
      const endpointId = await createEndpoint();
      await client.apiEndpointSetActive("claude", endpointId);
      const before = await fileState();

      const previewed = await client.apiEndpointPreviewSwitchOff("claude");

      expect(previewed).toEqual({
        requestId: expect.any(String),
        provider: "claude",
        preview: {
          files: [
            {
              path: "~/claude/settings.json",
              change: "edited",
              lines: [
                {
                  op: "restored",
                  text: '    "ANTHROPIC_BASE_URL": "https://hand-written.example",',
                  was: `    "ANTHROPIC_BASE_URL": "${gatewayUrl()}",`,
                },
                { op: "added", text: '    "ANTHROPIC_MODEL": "my-model"' },
                // 中转站口令遮住。
                { op: "removed", text: '    "ANTHROPIC_AUTH_TOKEN": ••••' },
                { op: "removed", text: '    "ANTHROPIC_API_KEY": "",' },
                { op: "removed", text: '    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "272000",' },
                { op: "removed", text: '    "CLAUDE_CODE_AUTO_MODE_SERVER": "0"' },
                { op: "restored", text: '  "model": "opus"', was: '  "model": "relay/sonnet",' },
                { op: "removed", text: '  "permissions": {' },
                { op: "removed", text: '    "deny": [' },
                { op: "removed", text: '      "WebSearch"' },
                { op: "removed", text: '  "modelPicker": {' },
                { op: "removed", text: '    "options": [' },
                { op: "removed", text: '        "model": "relay/relay/sonnet",' },
                { op: "removed", text: '        "label": "relay/sonnet",' },
                { op: "removed", text: '        "description": "Relay"' },
                { op: "removed", text: '        "model": "relay/relay/haiku",' },
                { op: "removed", text: '        "label": "relay/haiku",' },
                { op: "removed", text: '        "description": "Relay"' },
              ],
            },
          ],
        },
        error: null,
      });
      expect(await fileState()).toEqual(before);
      const off = await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
      expect(off.error).toBeNull();
      expect(await readFile(settingsPath, "utf8")).toBe(handWritten);
    });

    test("a settings.json Osuna made is listed as deleted", async () => {
      await rm(settingsPath);
      const endpointId = await createEndpoint();
      await client.apiEndpointSetActive("claude", endpointId);
      const before = await fileState();

      const previewed = await client.apiEndpointPreviewSwitchOff("claude");

      expect(previewed).toEqual({
        requestId: expect.any(String),
        provider: "claude",
        preview: {
          files: [{ path: "~/claude/settings.json", change: "removed", lines: [] }],
        },
        error: null,
      });
      expect(await fileState()).toEqual(before);
      await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
      await expect(stat(settingsPath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    test("with the switch off there is nothing to restore", async () => {
      expect(await client.apiEndpointPreviewSwitchOff("claude")).toEqual({
        requestId: expect.any(String),
        provider: "claude",
        preview: { files: [] },
        error: null,
      });
    });

    test("a settings.json that does not parse can't be previewed: the reason comes back, nothing written", async () => {
      const endpointId = await createEndpoint();
      await client.apiEndpointSetActive("claude", endpointId);
      const broken = `{\n  "env": {\n    "A": "1"\n    "B": "2"\n  }\n}\n`;
      await writeFile(settingsPath, broken);
      const before = await fileState();

      const previewed = await client.apiEndpointPreviewSwitchOff("claude");

      expect(previewed).toEqual({
        requestId: expect.any(String),
        provider: "claude",
        preview: null,
        error: {
          code: "config_unparsable",
          params: {
            file: settingsPath,
            detail: "CommaExpected at line 4, column 5",
            reason: "syntax",
            line: "4",
            column: "5",
          },
          message: expect.stringContaining(settingsPath),
        },
      });
      expect(await fileState()).toEqual(before);
    });
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
    await writeFile(settingsPath, `{ "env": { "A": "1" "B": "2" } }`);

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
    expect(written.env.ANTHROPIC_BASE_URL).toBe(gatewayUrl());
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

  test("rejects invalid input and unsupported providers with a code; a save without a key is not one", async () => {
    // key 选填（工单 02）：不填就保存成没有 key 的一家，不再拒收。
    const withoutKey = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrl: "https://relay.example",
      models: [{ id: "m" }],
      defaultModelId: "m",
    });
    expect(withoutKey).toMatchObject({ error: null, endpoint: { hasApiKey: false } });

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

describe("a resumed agent session says nothing about the API endpoint mode", () => {
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

  // daemon 停着时也要能找到记录，所以按 PASEO_HOME 的固定位置找。
  async function agentRecordPath(agentId: string): Promise<string> {
    const agentsDir = path.join(root, ".paseo", "agents");
    const files = await readdir(agentsDir, { recursive: true });
    const file = files.find((candidate) => path.basename(candidate) === `${agentId}.json`);
    if (!file) throw new Error(`No record for ${agentId}`);
    return path.join(agentsDir, file);
  }

  async function readAgentRecord(agentId: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(await agentRecordPath(agentId), "utf8"));
  }

  async function notifications(active: DaemonClient, agentId: string) {
    const timeline = await active.fetchAgentTimeline(agentId, {
      direction: "tail",
      limit: 0,
      projection: "canonical",
    });
    return timeline.entries
      .map((entry) => entry.item)
      .filter((item) => item.type === "notification");
  }

  test("the record does not store which endpoint was on", async () => {
    const active = await startDaemon();
    const endpointId = await createEndpoint(active);
    expect(await active.apiEndpointSetActive("claude", endpointId)).toMatchObject({ error: null });
    const agent = await active.createAgent({ provider: "claude", cwd, title: "Relay" });

    await expect.poll(async () => (await readAgentRecord(agent.id)).id).toBe(agent.id);
    expect(await readAgentRecord(agent.id)).not.toHaveProperty("apiEndpointId");
  });

  test("an old record naming a deleted endpoint resumes without a notice and keeps working", async () => {
    let active = await startDaemon();
    const endpointId = await createEndpoint(active);
    expect(await active.apiEndpointSetActive("claude", endpointId)).toMatchObject({ error: null });
    const agent = await active.createAgent({ provider: "claude", cwd, title: "Relay" });
    await expect.poll(async () => (await readAgentRecord(agent.id)).id).toBe(agent.id);
    expect(await active.apiEndpointDelete("claude", endpointId)).toMatchObject({ error: null });
    await stopDaemon();

    // 老版本写下的记录带着创建时的接口 id。
    const record = await readAgentRecord(agent.id);
    await writeFile(
      await agentRecordPath(agent.id),
      JSON.stringify({ ...record, apiEndpointId: endpointId }),
    );

    active = await startDaemon();
    expect(await notifications(active, agent.id)).toEqual([]);
    await active.sendMessage(agent.id, "hello again");
    const finished = await active.waitForFinish(agent.id, 30000);
    expect(finished.status).toBe("idle");
    expect(finished.final?.lastError).toBeUndefined();
    expect(await notifications(active, agent.id)).toEqual([]);
  });
});

// 工单 18：Claude Code 不认识接口模型，Osuna 按已知资料告诉它上下文、回复上限与思考档位。
describe("Claude Code is told what the endpoint models can do", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let settingsPath: string;
  let upstream: Server | null;

  // daemon 启动前放好的 models.dev 缓存（测试 daemon 关着自动更新，不会真的去下载）。
  const MODELS_DEV_CACHE = {
    fetchedAt: "2026-10-15T00:00:00.000Z",
    etag: null,
    models: {
      "gpt-6-sol": { context: 922_000, output: 128_000, efforts: ["low", "high", "xhigh", "max"] },
      "deepseek-v4-pro": { context: 1_000_000, output: 384_000, efforts: ["high", "max"] },
      "claude-opus-5-5": { context: 1_000_000, output: 128_000, efforts: ["low", "max"] },
    },
  };

  async function start(initialSettings: string): Promise<void> {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-hints-"));
    tempRoots.push(root);
    const claudeConfigDir = path.join(root, "claude");
    settingsPath = path.join(claudeConfigDir, "settings.json");
    await mkdir(claudeConfigDir, { recursive: true });
    await writeFile(settingsPath, initialSettings);
    const cacheDir = path.join(root, "home", ".paseo", "api-endpoints");
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path.join(cacheDir, "models-dev.json"), JSON.stringify(MODELS_DEV_CACHE));
    daemon = await createTestPaseoDaemon({
      paseoHomeRoot: path.join(root, "home"),
      apiEndpoints: { env: { CLAUDE_CONFIG_DIR: claudeConfigDir }, homeDir: root },
    });
    client = await connect(daemon);
  }

  beforeEach(() => {
    upstream = null;
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    if (upstream) {
      upstream.closeAllConnections();
      await new Promise((resolve) => upstream?.close(resolve));
    }
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function switchOn(baseUrl = "https://relay.example/api"): Promise<string> {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrl,
      apiKey: SECRET,
      models: [{ id: "gpt-6-sol" }, { id: "deepseek-v4-pro" }, { id: "claude-opus-5-5" }],
      defaultModelId: "gpt-6-sol",
    });
    const endpointId = saved.endpoint?.id;
    if (!endpointId) throw new Error("Expected a saved endpoint");
    await client.apiEndpointSetActive("claude", endpointId);
    return endpointId;
  }

  async function settings() {
    return JSON.parse(await readFile(settingsPath, "utf8"));
  }

  test("marks [1m], writes the four hints, and Official returns the file to its bytes", async () => {
    await start(USER_SETTINGS);
    await switchOn();

    const switched = await settings();
    expect(switched.model).toBe("gpt-6-sol");
    expect(switched.modelPicker.options.map((row: { model: string }) => row.model)).toEqual([
      "relay/gpt-6-sol",
      "relay/deepseek-v4-pro[1m]",
      "relay/claude-opus-5-5[1m]",
    ]);
    // 工单 14 照 magpie 合并后，没有手改时与之前的差别只有两处：Claude 模型也报档位（只报 Claude Code 给它的），
    // 别家起始模型在 272K 压缩（magpie WorkingWindow）。
    expect(switched.env).toMatchObject({
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: "922000",
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: "128000",
      CLAUDE_CODE_MODEL_CAPABILITIES:
        "gpt-6-sol=effort,xhigh_effort,max_effort;relay/gpt-6-sol=effort,xhigh_effort,max_effort;relay/deepseek-v4-pro=effort,xhigh_effort,max_effort;relay/claude-opus-5-5=effort,xhigh_effort,max_effort",
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: "272000",
    });
    // 这几个值不算 Osuna 负责的键，健康检查不会因为它们报「被外部改动」。
    expect((await client.apiEndpointList("claude")).health ?? []).toEqual([]);

    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });

  test("a value the user set stays as it is while switched and after Official", async () => {
    const own = USER_SETTINGS.replace(
      `"ANTHROPIC_BASE_URL": "https://hand-written.example"`,
      `"ANTHROPIC_BASE_URL": "https://hand-written.example",
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "64000"`,
    );
    await start(own);
    await switchOn();

    const switched = await settings();
    expect(switched.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("64000");
    expect(switched.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("922000");

    await client.apiEndpointSetActive("claude", null);
    expect(await readFile(settingsPath, "utf8")).toBe(own);
  });

  async function saveModelSettings(endpointId: string, modelSettings: object): Promise<void> {
    const [stored] = (await client.apiEndpointList("claude")).endpoints;
    const saved = await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Relay",
      baseUrls: stored?.baseUrls ?? [],
      models: stored?.models ?? [],
      modelSettings,
    });
    expect(saved.error).toBeNull();
  }

  test("hand-set context, reply limit, levels and Compact at reach Claude Code; Official puts the user's own values back", async () => {
    const own = USER_SETTINGS.replace(
      `"ANTHROPIC_BASE_URL": "https://hand-written.example"`,
      `"ANTHROPIC_BASE_URL": "https://hand-written.example",
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "150000"`,
    );
    await start(USER_SETTINGS);
    const endpointId = await switchOn();
    await saveModelSettings(endpointId, {
      models: {
        "gpt-6-sol": {
          context: 600_000,
          output: 64_000,
          efforts: ["low", "high"],
          compact: 500_000,
        },
      },
    });
    expect((await settings()).env).toMatchObject({
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: "600000",
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: "64000",
      CLAUDE_CODE_MODEL_CAPABILITIES: expect.stringMatching(
        /^gpt-6-sol=effort;relay\/gpt-6-sol=effort;/,
      ),
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000",
    });

    // 整家默认的上下文算手填：没有压缩阈值时整个窗口跑到底（magpie #1809）。
    await saveModelSettings(endpointId, { defaults: { context: 500_000 } });
    const typed = (await settings()).env;
    expect(typed.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("500000");
    expect(typed.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined();

    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);

    // 用户自己写的压缩阈值归用户：开着时不碰，关掉后原样还在。
    await writeFile(settingsPath, own);
    await client.apiEndpointSetAgentSettings({
      provider: "claude",
      enabled: true,
      defaultModelId: "gpt-6-sol",
    });
    await saveModelSettings(endpointId, { models: { "gpt-6-sol": { compact: 400_000 } } });
    expect((await settings()).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("150000");
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    expect(await readFile(settingsPath, "utf8")).toBe(own);
  });

  test("the host's long conversations: Full window drops the compaction, a typed Compact at replaces 272K and beats a typed window", async () => {
    await start(USER_SETTINGS);
    const endpointId = await switchOn();
    const compactAt = async () => (await settings()).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
    expect(await compactAt()).toBe("272000");

    const full = await client.apiEndpointSetLongConversations({ fullContext: true });
    expect(full.error).toBeNull();
    expect((await client.apiEndpointList("claude")).longConversations).toEqual({
      fullContext: true,
    });
    expect(await compactAt()).toBeUndefined();

    await client.apiEndpointSetLongConversations({ fullContext: false, compactAt: 400_000 });
    expect((await client.apiEndpointList("claude")).longConversations).toEqual({
      compactAt: 400_000,
    });
    expect(await compactAt()).toBe("400000");
    await saveModelSettings(endpointId, { defaults: { context: 600_000 } });
    expect(await compactAt()).toBe("400000");

    // 272K 等于不设；数不是正整数拒收。
    await client.apiEndpointSetLongConversations({ fullContext: false, compactAt: 272_000 });
    expect((await client.apiEndpointList("claude")).longConversations).toEqual({});
    expect(await compactAt()).toBeUndefined();
    const refused = await client.apiEndpointSetLongConversations({
      fullContext: false,
      compactAt: 1.5,
    });
    expect(refused.error?.code).toBe("invalid_input");

    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });

  test("the old client's save and switch keep the host's long conversations, disabled models and endpoint name display", async () => {
    await start(USER_SETTINGS);
    await client.apiEndpointSetLongConversations({ fullContext: false, compactAt: 400_000 });
    await client.apiEndpointSetDisabledModels({ models: ["*-preview"] });
    await client.apiEndpointSetEndpointNameDisplay({ display: "clash" });
    const hostWide = async () => {
      const list = await client.apiEndpointList("claude");
      return {
        longConversations: list.longConversations,
        disabledModels: list.disabledModels,
        endpointNameDisplay: list.endpointNameDisplay,
      };
    };
    const kept = {
      longConversations: { compactAt: 400_000 },
      disabledModels: ["*-preview"],
      endpointNameDisplay: "clash",
    };
    // switchOn 走老客户端的 save 与 set_active。
    const endpointId = await switchOn();
    expect(await hostWide()).toEqual(kept);
    expect((await settings()).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("400000");
    // 老样子的 save 改一家：几项主机设置照样留着。
    const edited = await client.apiEndpointSave({
      provider: "claude",
      endpointId,
      name: "Relay renamed",
      baseUrl: "https://relay.example/api",
      models: [{ id: "gpt-6-sol" }, { id: "gpt-6-preview" }],
      defaultModelId: "gpt-6-sol",
    });
    expect(edited.error).toBeNull();
    expect(await hostWide()).toEqual(kept);
  });

  test("Osuna's 272K gives way to an autoCompactWindow the user set in Claude Code", async () => {
    const own = USER_SETTINGS.replace(
      `"env": {`,
      `"autoCompactWindow": 300000,
  "env": {`,
    );
    await start(own);
    await switchOn();
    expect((await settings()).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined();
    await client.apiEndpointSetLongConversations({ fullContext: false, compactAt: 400_000 });
    expect((await settings()).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("400000");
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    expect(await readFile(settingsPath, "utf8")).toBe(own);
  });

  async function switchOnWith(models: string[]): Promise<void> {
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrl: "https://relay.example/api",
      apiKey: SECRET,
      models: models.map((id) => ({ id })),
      defaultModelId: models[0],
    });
    const endpointId = saved.endpoint?.id;
    if (!endpointId) throw new Error("Expected a saved endpoint");
    await client.apiEndpointSetActive("claude", endpointId);
  }

  test("a dotted Claude version is written with hyphens; other vendors' ids are not", async () => {
    await start(USER_SETTINGS);
    await switchOnWith(["claude-opus-4.6", "glm-4.6"]);

    const switched = await settings();
    expect(switched.model).toBe("claude-opus-4-6");
    expect(switched.modelPicker.options.map((row: { model: string }) => row.model)).toEqual([
      "relay/claude-opus-4-6",
      "relay/glm-4.6",
    ]);
  });

  test("a dotted Claude version the user wrote stays as it is", async () => {
    const own = USER_SETTINGS.replace(
      `"env": {`,
      `"modelPicker": { "options": [{ "model": "claude-opus-4.6", "label": "Mine", "description": "" }] },
  "env": {`,
    );
    await start(own);
    await switchOnWith(["claude-opus-4.6"]);

    expect((await settings()).modelPicker.options[0].model).toBe("claude-opus-4.6");
    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    expect(await readFile(settingsPath, "utf8")).toBe(own);
  });

  test("CLAUDE_CODE_AUTO_MODE_SERVER=0 while nothing reachable is reviewed, gone once an api.anthropic.com endpoint is on and after Official", async () => {
    await start(USER_SETTINGS);
    await switchOnWith(["glm-4.6", "kimi-k2"]);
    expect((await settings()).env.CLAUDE_CODE_AUTO_MODE_SERVER).toBe("0");

    const anthropic = await client.apiEndpointSave({
      provider: "claude",
      name: "Anthropic",
      baseUrls: [{ format: "anthropic_messages", url: "https://api.anthropic.com" }],
      apiKey: SECRET,
      models: [{ id: "glm-4.6" }],
    });
    expect(anthropic.error).toBeNull();
    expect((await settings()).env.CLAUDE_CODE_AUTO_MODE_SERVER).toBeUndefined();

    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });

  test("an auto mode review the user set is theirs", async () => {
    const own = USER_SETTINGS.replace(
      `"ANTHROPIC_BASE_URL": "https://hand-written.example"`,
      `"ANTHROPIC_BASE_URL": "https://hand-written.example",
    "CLAUDE_CODE_AUTO_MODE_SERVER": "1"`,
    );
    await start(own);
    await switchOnWith(["glm-4.6"]);
    expect((await settings()).env.CLAUDE_CODE_AUTO_MODE_SERVER).toBe("1");

    await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    expect(await readFile(settingsPath, "utf8")).toBe(own);
  });

  test("numbers the endpoint's own model list, fetched when it is saved, win over models.dev", async () => {
    await start(USER_SETTINGS);
    upstream = createServer((request, response) => {
      if (request.url !== "/api/v1/models") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          data: [{ id: "gpt-6-sol", max_input_tokens: 1_050_000, max_tokens: 128_000 }],
        }),
      );
    });
    await new Promise<void>((resolve) => upstream?.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/api`;
    // 照 magpie：新建一家时保存当场拉一次清单，打开开关写进 settings.json 时就用上清单给的数。
    const endpointId = await switchOn(baseUrl);
    // 这些数只留在 daemon 里，不发给客户端。
    expect((await client.apiEndpointList("claude")).endpoints[0]?.catalog?.models).toEqual([
      { id: "gpt-6-sol" },
    ]);

    const fetched = await client.apiEndpointFetchModels({
      provider: "claude",
      endpointId,
      baseUrl,
      format: "anthropic_messages",
    });
    expect(fetched.models).toEqual([{ id: "gpt-6-sol" }]);

    // 起始模型已知 105 万：带 [1m]，上下文那一项就不写了（models.dev 说的 92.2 万不用）。
    const refreshed = await settings();
    expect(refreshed.model).toBe("gpt-6-sol[1m]");
    expect(refreshed.modelPicker.options[0].model).toBe("relay/gpt-6-sol[1m]");
    expect(refreshed.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();

    await client.apiEndpointSetActive("claude", null);
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });
});

/** 假代理把一个请求转给中转站，原样答回。 */
async function forward(input: { url: string; res: ServerResponse }) {
  const answer = await fetch(input.url);
  input.res.writeHead(answer.status, { "content-type": "application/json" });
  input.res.end(await answer.text());
}

describe("Claude Code's cloud-platform switches and managed settings", () => {
  let daemon: TestPaseoDaemon | null = null;
  let client: DaemonClient | null = null;
  let root: string;
  let claudeConfigDir: string;
  let settingsPath: string;
  let managedDir: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-clouds-"));
    tempRoots.push(root);
    claudeConfigDir = path.join(root, "claude");
    settingsPath = path.join(claudeConfigDir, "settings.json");
    managedDir = path.join(root, "managed");
    await mkdir(claudeConfigDir, { recursive: true });
    await mkdir(managedDir, { recursive: true });
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    client = null;
    daemon = null;
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  // daemon 自己的环境（除了 CLAUDE_CONFIG_DIR 只放用例给的变量）与假的登录 shell 答出的变量。
  async function start(
    input: { daemonEnv?: Record<string, string>; loginShell?: Record<string, string> } = {},
  ): Promise<DaemonClient> {
    daemon = await createTestPaseoDaemon({
      apiEndpoints: {
        env: { CLAUDE_CONFIG_DIR: claudeConfigDir, ...input.daemonEnv },
        homeDir: root,
        claudeManagedSettingsDir: managedDir,
        readLoginShellEnv: async () => input.loginShell ?? {},
      },
    });
    client = await connect(daemon);
    return client;
  }

  async function switchOn(rpc: DaemonClient): Promise<void> {
    const saved = await rpc.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrl: "https://relay.example/api",
      apiKey: SECRET,
      models: [{ id: "relay/sonnet" }],
      defaultModelId: "relay/sonnet",
    });
    const endpointId = saved.endpoint?.id;
    if (!endpointId) throw new Error("Expected a saved endpoint");
    const on = await rpc.apiEndpointSetActive("claude", endpointId);
    expect(on).toMatchObject({ activeEndpointId: endpointId, error: null });
  }

  async function switchOff(rpc: DaemonClient): Promise<void> {
    const off = await rpc.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    expect(off.error).toBeNull();
  }

  async function settingsEnv(): Promise<Record<string, unknown>> {
    const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as {
      env?: Record<string, unknown>;
    };
    return parsed.env ?? {};
  }

  async function claudeIssues(rpc: DaemonClient) {
    return (await rpc.apiEndpointList("claude")).agentIssues?.claude ?? [];
  }

  test("a switch that is on is taken out and put back; one that is off stays; one the user set again is theirs", async () => {
    await writeFile(
      settingsPath,
      `{\n  "env": {\n    "CLAUDE_CODE_USE_BEDROCK": "1",\n    "CLAUDE_CODE_USE_VERTEX": "0",\n    "AWS_REGION": "us-east-1"\n  }\n}\n`,
    );
    const rpc = await start();

    await switchOn(rpc);
    let env = await settingsEnv();
    expect(env).not.toHaveProperty("CLAUDE_CODE_USE_BEDROCK");
    expect(env).toMatchObject({ CLAUDE_CODE_USE_VERTEX: "0", AWS_REGION: "us-east-1" });
    expect(await claudeIssues(rpc)).toEqual([]);

    await switchOff(rpc);
    env = await settingsEnv();
    expect(env).toEqual({
      CLAUDE_CODE_USE_VERTEX: "0",
      AWS_REGION: "us-east-1",
      CLAUDE_CODE_USE_BEDROCK: "1",
    });

    // 再打开，开着期间用户自己又写了一个（关着的值）：关掉时不覆盖。
    const again = await rpc.apiEndpointSetAgentSettings({ provider: "claude", enabled: true });
    expect(again.error).toBeNull();
    expect(await settingsEnv()).not.toHaveProperty("CLAUDE_CODE_USE_BEDROCK");
    const switched = JSON.parse(await readFile(settingsPath, "utf8")) as {
      env: Record<string, unknown>;
    };
    switched.env.CLAUDE_CODE_USE_BEDROCK = "0";
    await writeFile(settingsPath, JSON.stringify(switched, null, 2));
    await switchOff(rpc);
    expect((await settingsEnv()).CLAUDE_CODE_USE_BEDROCK).toBe("0");
  });

  test("a switch set again in settings.json while the switch is on is reported, and Re-apply takes it out", async () => {
    const rpc = await start();
    await switchOn(rpc);
    const switched = JSON.parse(await readFile(settingsPath, "utf8")) as {
      env: Record<string, unknown>;
    };
    switched.env.CLAUDE_CODE_USE_MANTLE = "yes";
    await writeFile(settingsPath, JSON.stringify(switched, null, 2));

    expect(await claudeIssues(rpc)).toEqual([
      {
        code: "cloud_switch_on",
        params: {
          source: "settings",
          file: settingsPath,
          key: "CLAUDE_CODE_USE_MANTLE",
          cloud: "Amazon Bedrock (Mantle)",
        },
        message: expect.stringContaining("CLAUDE_CODE_USE_MANTLE"),
      },
    ]);

    const reapplied = await rpc.apiEndpointSetAgentSettings({
      provider: "claude",
      enabled: true,
      reapply: true,
    });
    expect(reapplied.error).toBeNull();
    expect(await settingsEnv()).not.toHaveProperty("CLAUDE_CODE_USE_MANTLE");
    expect(await claudeIssues(rpc)).toEqual([]);
  });

  test("switches in managed settings, ~/.claude.json and the login shell are each reported with where they are set", async () => {
    const dropIn = path.join(managedDir, "managed-settings.d", "20-cloud.json");
    await mkdir(path.dirname(dropIn), { recursive: true });
    await writeFile(dropIn, JSON.stringify({ env: { CLAUDE_CODE_USE_BEDROCK: "1" } }));
    const globalConfigPath = path.join(claudeConfigDir, ".claude.json");
    await writeFile(globalConfigPath, JSON.stringify({ env: { CLAUDE_CODE_USE_VERTEX: true } }));
    const rpc = await start({ daemonEnv: { CLAUDE_CODE_USE_FOUNDRY: "1" } });
    await switchOn(rpc);

    expect(await claudeIssues(rpc)).toEqual([
      {
        code: "cloud_switch_on",
        params: {
          source: "managed",
          file: dropIn,
          key: "CLAUDE_CODE_USE_BEDROCK",
          cloud: "Amazon Bedrock",
        },
        message: expect.stringContaining(dropIn),
      },
    ]);

    await rm(dropIn);
    expect(await claudeIssues(rpc)).toEqual([
      expect.objectContaining({
        code: "cloud_switch_on",
        params: {
          source: "global_config",
          file: globalConfigPath,
          key: "CLAUDE_CODE_USE_VERTEX",
          cloud: "Google Vertex AI",
        },
      }),
    ]);

    await writeFile(globalConfigPath, JSON.stringify({ env: {} }));
    expect(await claudeIssues(rpc)).toEqual([
      {
        code: "cloud_switch_on",
        params: {
          source: "shell",
          key: "CLAUDE_CODE_USE_FOUNDRY",
          cloud: "Microsoft Foundry",
          platform: process.platform,
        },
        message: expect.stringContaining("shell"),
      },
    ]);
    // 写不到的地方不动；关着开关时也不提示。
    await switchOff(rpc);
    expect(await claudeIssues(rpc)).toEqual([]);
  });

  test("a managed ANTHROPIC_BASE_URL that does not point at the gateway reads as not going through it", async () => {
    const managedFile = path.join(managedDir, "managed-settings.json");
    await writeFile(
      managedFile,
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://corp-gateway.example" } }),
    );
    const rpc = await start();
    await switchOn(rpc);

    expect(await claudeIssues(rpc)).toEqual([
      {
        code: "managed_base_url",
        params: { file: managedFile, url: "https://corp-gateway.example" },
        message: expect.stringContaining("https://corp-gateway.example"),
      },
    ]);

    const gateway = `http://127.0.0.1:${daemon?.port}/api-endpoint-gateway/`;
    await writeFile(managedFile, JSON.stringify({ env: { ANTHROPIC_BASE_URL: gateway } }));
    expect(await claudeIssues(rpc)).toEqual([]);
  });

  test("the login shell's own value goes before the daemon's environment", async () => {
    const rpc = await start({
      daemonEnv: { CLAUDE_CODE_USE_VERTEX: "1" },
      loginShell: { CLAUDE_CODE_USE_VERTEX: "0", CLAUDE_CODE_USE_MANTLE: "1" },
    });
    await switchOn(rpc);

    expect(await claudeIssues(rpc)).toEqual([
      expect.objectContaining({
        code: "cloud_switch_on",
        params: expect.objectContaining({ source: "shell", key: "CLAUDE_CODE_USE_MANTLE" }),
      }),
    ]);
  });

  test("a managed address that is a proxy forwarding to the gateway goes through it", async () => {
    const rpc = await start();
    await switchOn(rpc);
    const gatewayUrl = `http://127.0.0.1:${daemon?.port}/api-endpoint-gateway`;
    // 假的合规代理：/corp 下的请求原样转给中转站。
    const proxy = createServer((req, res) => {
      void forward({ url: `${gatewayUrl}${(req.url ?? "").replace(/^\/corp/, "")}`, res });
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}/corp`;
    const managedFile = path.join(managedDir, "managed-settings.json");
    try {
      await writeFile(managedFile, JSON.stringify({ env: { ANTHROPIC_BASE_URL: proxyUrl } }));
      expect(await claudeIssues(rpc)).toEqual([]);

      // 同样在本机、带路径，但后面不是中转站：照样提示。
      const elsewhere = `${proxyUrl.replace("/corp", "/other")}`;
      await writeFile(managedFile, JSON.stringify({ env: { ANTHROPIC_BASE_URL: elsewhere } }));
      expect(await claudeIssues(rpc)).toEqual([
        expect.objectContaining({
          code: "managed_base_url",
          params: { file: managedFile, url: elsewhere },
        }),
      ]);
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });
});

describe("Claude Code used without going through the gateway (bypassed)", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let claudeConfigDir: string;
  let settingsPath: string;
  let upstream: Server;
  // 接口服务与中转站共用的时钟，测试拨动它，不必真的等 30 秒的余量。
  let clock: Date;
  // 整秒起步：history.jsonl 的时间按秒比，同 magpie。
  const start = new Date(Math.floor(Date.now() / 1000) * 1000);

  function after(seconds: number): Date {
    return new Date(start.getTime() + seconds * 1000);
  }

  beforeEach(async () => {
    clock = start;
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-bypass-"));
    tempRoots.push(root);
    claudeConfigDir = path.join(root, "claude");
    settingsPath = path.join(claudeConfigDir, "settings.json");
    await mkdir(claudeConfigDir, { recursive: true });
    await writeFile(settingsPath, USER_SETTINGS);
    // 假上游：Anthropic 格式的一句回答。
    upstream = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "sonnet",
          content: [{ type: "text", text: "hi" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    daemon = await createTestPaseoDaemon({
      apiEndpoints: {
        env: { CLAUDE_CONFIG_DIR: claudeConfigDir },
        homeDir: root,
        now: () => clock,
      },
    });
    client = await connect(daemon);
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function switchOnAt(seconds: number): Promise<void> {
    const address = upstream.address();
    if (address === null || typeof address === "string") throw new Error("No upstream port");
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Relay",
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: SECRET,
      models: [{ id: "sonnet" }],
      defaultModelId: "sonnet",
    });
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    clock = after(seconds);
    await client.apiEndpointSetActive("claude", saved.endpoint.id);
  }

  async function typedAt(...seconds: number[]): Promise<void> {
    const lines = seconds.map((at) =>
      JSON.stringify({ display: "fix the bug", timestamp: after(at).getTime(), project: "/p" }),
    );
    await writeFile(path.join(claudeConfigDir, "history.jsonl"), `${lines.join("\n")}\n`);
  }

  async function claudeIssues(): Promise<unknown> {
    return (await client.apiEndpointList("claude")).agentIssues?.claude;
  }

  function bypassedAt(seconds: number): unknown {
    return [
      {
        code: "bypassed",
        params: { how: "used", at: after(seconds).toISOString() },
        message: expect.stringContaining("none of its requests reached Osuna"),
      },
    ];
  }

  test("used after the rewrite with no request reaching the gateway: bypassed", async () => {
    await switchOnAt(10);
    await typedAt(20);
    clock = after(100);

    expect(await claudeIssues()).toEqual(bypassedAt(20));
  });

  test("a request the gateway received means it came through", async () => {
    await switchOnAt(10);
    await typedAt(20);
    clock = after(21);
    const reply = await fetch(`http://127.0.0.1:${daemon.port}/api-endpoint-gateway/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "claude-cli/2.1.0" },
      body: JSON.stringify({
        model: "sonnet",
        max_tokens: 16,
        messages: [{ role: "user", content: "fix the bug" }],
      }),
    });
    expect(reply.status).toBe(200);
    clock = after(100);

    expect(await claudeIssues()).toEqual([]);
  });

  test("a use before the rewrite, or within the last thirty seconds, doesn't count", async () => {
    await switchOnAt(10);
    await typedAt(5);
    clock = after(100);
    expect(await claudeIssues()).toEqual([]);

    await typedAt(5, 90);
    expect(await claudeIssues()).toEqual([]);
  });

  test("Re-apply clears it and earlier uses no longer count; Official restores the file", async () => {
    await switchOnAt(10);
    await typedAt(20);
    clock = after(100);
    expect(await claudeIssues()).toEqual(bypassedAt(20));

    const reapplied = await client.apiEndpointSetAgentSettings({
      provider: "claude",
      enabled: true,
      reapply: true,
    });
    expect(reapplied.error).toBeNull();
    clock = after(300);
    expect(await claudeIssues()).toEqual([]);

    // 重新应用之后又绕过一次，照样提示；切回官方后不再提示、文件还原。
    await typedAt(20, 200);
    expect(await claudeIssues()).toEqual(bypassedAt(200));
    const off = await client.apiEndpointSetAgentSettings({ provider: "claude", enabled: false });
    expect(off.agent?.enabled).toBe(false);
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
    expect(await claudeIssues()).toEqual([]);
  });

  test("settings that no longer go through the gateway say that, not bypassed", async () => {
    await switchOnAt(10);
    await typedAt(20);
    clock = after(100);
    const switched = await readFile(settingsPath, "utf8");
    await writeFile(
      settingsPath,
      switched.replace(
        `"http://127.0.0.1:${daemon.port}/api-endpoint-gateway"`,
        '"https://other-tool.example"',
      ),
    );

    expect(await claudeIssues()).toEqual([
      {
        code: "not_through_gateway",
        params: { file: settingsPath, keys: "env.ANTHROPIC_BASE_URL" },
        message: expect.stringContaining("env.ANTHROPIC_BASE_URL"),
      },
    ]);
  });
});
