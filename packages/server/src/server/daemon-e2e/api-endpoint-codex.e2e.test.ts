import { writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CODEX_API_ENDPOINT_PROVIDER_ID } from "../api-endpoints/codex-config-patch.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

const ID = CODEX_API_ENDPOINT_PROVIDER_ID;

// 用户手写的 config.toml：注释、自己的中转站、项目信任设置，全都不能被 Osuna 弄丢。
const USER_CONFIG = `# my codex config
model = "gpt-5.1-codex" # default
model_provider = "mine"

[projects."/Users/me/My Code"]
trust_level = "trusted"

[model_providers.mine]
name = "Mine"
base_url = "https://mine.example/v1"
`;

// ChatGPT 登录；从头到尾一个字节都不能变。
const AUTH_JSON = `{"OPENAI_API_KEY":null,"tokens":{"refresh_token":"rt-single-use"}}`;

const SECRET = "sk-relay-codex-secret";

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

// 假 codex 只会打印 codex-version 文件里的版本号；运行真的 codex 不在测试范围内。
// 它是 sh 脚本：Windows 上 execCommand 不经 shell 执行绝对路径，跑不了 .cmd，所以这组只在 POSIX 上跑；
// Windows 上读 key 的命令由 codex-auth-command.test.ts 在 CI 的 Windows 任务里验证。
describe.skipIf(process.platform === "win32")("Codex API endpoint over the daemon RPC", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let codexHome: string;
  let configPath: string;
  let authPath: string;
  let versionPath: string;
  // 改写配置时、替换文件前调用，模拟别的工具同时在改这份文件。
  let onRecheck: ((filePath: string) => void) | null;

  beforeEach(async () => {
    onRecheck = null;
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-codex-"));
    tempRoots.push(root);
    codexHome = path.join(root, "codex-home");
    configPath = path.join(codexHome, "config.toml");
    authPath = path.join(codexHome, "auth.json");
    await mkdir(codexHome, { recursive: true });
    await writeFile(configPath, USER_CONFIG);
    await writeFile(authPath, AUTH_JSON);

    const binDir = path.join(root, "bin");
    await mkdir(binDir);
    versionPath = path.join(binDir, "codex-version");
    await writeFile(versionPath, "codex-cli 0.130.0\n");
    const fakeCodex = path.join(binDir, "codex");
    await writeFile(fakeCodex, `#!/bin/sh\ncat "$(dirname "$0")/codex-version"\n`);
    await chmod(fakeCodex, 0o755);

    daemon = await createTestPaseoDaemon({
      apiEndpoints: {
        env: { CODEX_HOME: codexHome },
        homeDir: root,
        beforeConfigRecheck: (filePath) => onRecheck?.(filePath),
      },
      providerOverrides: { codex: { command: [fakeCodex] } },
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

  async function createEndpoint(name = "Relay"): Promise<string> {
    const saved = await client.apiEndpointSave({
      provider: "codex",
      name,
      baseUrl: "https://relay.example/api/",
      apiKey: SECRET,
      models: [{ id: "relay/gpt" }, { id: "relay/mini" }],
      defaultModelId: "relay/gpt",
    });
    expect(saved.error).toBeNull();
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    return saved.endpoint.id;
  }

  function keyFilePath(): string {
    return path.join(daemon.paseoHome, "api-endpoints", "codex-api-key");
  }

  test("activate → Official rewrites only the owned keys and never touches auth.json", async () => {
    const endpointId = await createEndpoint();
    expect(JSON.stringify(await client.apiEndpointList("codex"))).not.toContain(SECRET);

    const activated = await client.apiEndpointSetActive("codex", endpointId);
    expect(activated).toMatchObject({ activeEndpointId: endpointId, error: null });

    expect(await readFile(configPath, "utf8")).toBe(`# my codex config
model = "relay/gpt" # default
model_provider = "${ID}"

[projects."/Users/me/My Code"]
trust_level = "trusted"

[model_providers.mine]
name = "Mine"
base_url = "https://mine.example/v1"

[model_providers.${ID}]
name = "Relay"
base_url = "https://relay.example/api/v1"
wire_api = "responses"

[model_providers.${ID}.auth]
command = "/bin/cat"
args = [${JSON.stringify(keyFilePath())}]
timeout_ms = 5000
`);
    expect(await readFile(keyFilePath(), "utf8")).toBe(SECRET);
    expect((await stat(keyFilePath())).mode & 0o777).toBe(0o600);
    expect(await readFile(authPath, "utf8")).toBe(AUTH_JSON);

    // 首次改写前留了一份完整副本。
    const backupsDir = path.join(daemon.paseoHome, "api-endpoints", "backups");
    const backups = await readdir(backupsDir);
    expect(backups).toHaveLength(1);
    expect(await readFile(path.join(backupsDir, backups[0]!), "utf8")).toBe(USER_CONFIG);

    const official = await client.apiEndpointSetActive("codex", null);
    expect(official).toMatchObject({ activeEndpointId: null, error: null });

    // 顶层键回到原样，专用表保留，第三方模式下的会话还能恢复。
    const restored = await readFile(configPath, "utf8");
    expect(restored.startsWith(USER_CONFIG)).toBe(true);
    expect(restored).toContain(`[model_providers.${ID}]`);
    expect(await readFile(keyFilePath(), "utf8")).toBe(SECRET);
    expect(await readFile(authPath, "utf8")).toBe(AUTH_JSON);
  });

  test("the model picker lists only the endpoint's models while it is active", async () => {
    async function codexModels(): Promise<string[] | null> {
      const snapshot = await client.getProvidersSnapshot();
      const entry = snapshot.entries.find((candidate) => candidate.provider === "codex");
      if (entry?.status !== "ready") return null;
      return (entry.models ?? []).map((model) => `${model.id}${model.isDefault ? " *" : ""}`);
    }
    // 测试 daemon 的假 Codex 提供方只列出 gpt-5.4-mini。
    await expect.poll(codexModels, { timeout: 10_000 }).toEqual(["gpt-5.4-mini *"]);
    const endpointId = await createEndpoint();

    await client.apiEndpointSetActive("codex", endpointId);
    await expect.poll(codexModels, { timeout: 10_000 }).toEqual(["relay/gpt *", "relay/mini"]);

    await client.apiEndpointSetActive("codex", null);
    await expect.poll(codexModels, { timeout: 10_000 }).toEqual(["gpt-5.4-mini *"]);
  });

  test("deleting the endpoint removes the dedicated table and the key file", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("codex", endpointId);

    const deleted = await client.apiEndpointDelete("codex", endpointId);

    expect(deleted).toMatchObject({ activeEndpointId: null, error: null });
    expect(await readFile(configPath, "utf8")).toBe(USER_CONFIG);
    await expect(stat(keyFilePath())).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(authPath, "utf8")).toBe(AUTH_JSON);
  });

  test("an absent config.toml is created on switch and removed with the endpoint", async () => {
    await rm(configPath);
    const endpointId = await createEndpoint();

    await client.apiEndpointSetActive("codex", endpointId);
    expect(await readFile(configPath, "utf8")).toContain(`model_provider = "${ID}"`);
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);

    await client.apiEndpointDelete("codex", endpointId);
    await expect(stat(configPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("editing the active endpoint rewrites config.toml and the key file right away", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("codex", endpointId);

    await client.apiEndpointSave({
      provider: "codex",
      endpointId,
      name: "Relay",
      baseUrl: "https://relay.example/v1",
      apiKey: "sk-rotated",
      models: [{ id: "relay/gpt" }, { id: "relay/mini" }],
      defaultModelId: "relay/mini",
    });

    const config = await readFile(configPath, "utf8");
    expect(config).toContain(`model = "relay/mini" # default`);
    expect(config).toContain(`base_url = "https://relay.example/v1"`);
    expect(await readFile(keyFilePath(), "utf8")).toBe("sk-rotated");
  });

  test("editing the endpoint that owns the table while Official refreshes only the table and key", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("codex", endpointId);
    await client.apiEndpointSetActive("codex", null);

    await client.apiEndpointSave({
      provider: "codex",
      endpointId,
      name: "Relay",
      baseUrl: "https://moved.example",
      apiKey: "sk-rotated",
      models: [{ id: "relay/gpt" }],
      defaultModelId: "relay/gpt",
    });

    const config = await readFile(configPath, "utf8");
    expect(config.startsWith(USER_CONFIG)).toBe(true);
    expect(config).toContain(`base_url = "https://moved.example/v1"`);
    expect(await readFile(keyFilePath(), "utf8")).toBe("sk-rotated");
    expect((await client.apiEndpointList("codex")).activeEndpointId).toBeNull();
  });

  test("refuses to enable when Codex is older than 0.118.0", async () => {
    await writeFile(versionPath, "codex-cli 0.117.9\n");
    const endpointId = await createEndpoint();

    const activated = await client.apiEndpointSetActive("codex", endpointId);

    expect(activated.activeEndpointId).toBeNull();
    expect(activated.error?.code).toBe("codex_version_unsupported");
    expect(activated.error?.message).toContain("0.118.0");
    expect(await readFile(configPath, "utf8")).toBe(USER_CONFIG);
    await expect(stat(keyFilePath())).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("refuses to write anything when config.toml does not parse", async () => {
    const endpointId = await createEndpoint();
    const broken = `model = "a"\nmodel = "b"\n`;
    await writeFile(configPath, broken);

    const activated = await client.apiEndpointSetActive("codex", endpointId);

    expect(activated.activeEndpointId).toBeNull();
    expect(activated.error?.code).toBe("config_unparsable");
    expect(await readFile(configPath, "utf8")).toBe(broken);
    await expect(stat(keyFilePath())).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("an owned key changed outside Osuna shows as modified; re-apply writes it back", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("codex", endpointId);
    expect(await client.apiEndpointList("codex")).toMatchObject({ health: [], cliBaseUrl: null });
    const switched = await readFile(configPath, "utf8");

    await writeFile(
      configPath,
      switched.replace(`trust_level = "trusted"`, `trust_level = "untrusted"`),
    );
    expect((await client.apiEndpointList("codex")).health).toEqual([]);

    await writeFile(configPath, switched.replace(`model = "relay/gpt"`, `model = "gpt-5"`));
    expect((await client.apiEndpointList("codex")).health).toEqual([
      { code: "modified_externally", message: expect.stringContaining("model") },
    ]);

    expect(await client.apiEndpointSetActive("codex", endpointId)).toMatchObject({ error: null });
    expect(await readFile(configPath, "utf8")).toBe(switched);
    expect((await client.apiEndpointList("codex")).health).toEqual([]);
  });

  test("Official shows where config.toml itself points", async () => {
    expect(await client.apiEndpointList("codex")).toMatchObject({
      activeEndpointId: null,
      health: [],
      cliBaseUrl: "https://mine.example/v1",
    });
  });

  test("warns when the selected legacy profile overrides the owned keys", async () => {
    await writeFile(
      configPath,
      `profile = "work"\n${USER_CONFIG}\n[profiles.work]\nmodel_provider = "azure"\n`,
    );
    const expected = {
      code: "codex_profile_override",
      message: expect.stringContaining(`[profiles.work] sets model_provider`),
    };
    expect((await client.apiEndpointList("codex")).health).toEqual([expected]);

    const endpointId = await createEndpoint();
    expect(await client.apiEndpointSetActive("codex", endpointId)).toMatchObject({ error: null });
    expect((await client.apiEndpointList("codex")).health).toEqual([expected]);
  });

  test("reports a Codex downgraded below 0.118.0 while an endpoint is active", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("codex", endpointId);
    await writeFile(versionPath, "codex-cli 0.117.0\n");

    expect((await client.apiEndpointList("codex")).health).toEqual([
      { code: "codex_version_unsupported", message: expect.stringContaining("0.117.0") },
    ]);
  });

  test("reports a Codex that can't be run, not as an outdated one", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("codex", endpointId);
    await rm(path.join(path.dirname(versionPath), "codex"));

    const listed = await client.apiEndpointList("codex");
    expect(listed.error).toBeNull();
    expect(listed.health).toEqual([
      { code: "codex_unavailable", message: expect.stringContaining("codex --version") },
    ]);
  });

  test("a config.toml that keeps changing is a conflict: neither the key file nor the mode moves", async () => {
    const endpointId = await createEndpoint();
    let changes = 0;
    onRecheck = (filePath) => {
      changes += 1;
      writeFileSync(filePath, `${USER_CONFIG}# rev ${changes}\n`);
    };

    const activated = await client.apiEndpointSetActive("codex", endpointId);

    expect(activated).toMatchObject({ activeEndpointId: null, error: { code: "config_conflict" } });
    expect(await readFile(configPath, "utf8")).toBe(`${USER_CONFIG}# rev 3\n`);
    await expect(stat(keyFilePath())).rejects.toMatchObject({ code: "ENOENT" });
    expect((await client.apiEndpointList("codex")).activeEndpointId).toBeNull();
  });

  test("keeps the mode when config.toml cannot be replaced", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("codex", endpointId);
    const other = await createEndpoint("Other");
    // 目录只读：原子替换失败，状态和 key 文件都要停在切换前。
    await chmod(codexHome, 0o500);
    try {
      const switched = await client.apiEndpointSetActive("codex", other);

      expect(switched.activeEndpointId).toBe(endpointId);
      expect(switched.error).not.toBeNull();
      expect((await client.apiEndpointList("codex")).activeEndpointId).toBe(endpointId);
      expect(await readFile(keyFilePath(), "utf8")).toBe(SECRET);
    } finally {
      await chmod(codexHome, 0o700);
    }
  });
});
