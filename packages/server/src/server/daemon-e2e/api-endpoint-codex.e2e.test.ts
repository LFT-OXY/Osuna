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

// 目录只读与 0600 权限的用例依赖 POSIX 权限位。
describe.skipIf(process.platform === "win32")("Codex API endpoint over the daemon RPC", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let codexHome: string;
  let configPath: string;
  let authPath: string;
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

    daemon = await createTestPaseoDaemon({
      apiEndpoints: {
        env: { CODEX_HOME: codexHome },
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

  async function createEndpoint(
    name = "Relay",
    models: string[] = ["relay/gpt", "relay/mini"],
  ): Promise<string> {
    const saved = await client.apiEndpointSave({
      provider: "codex",
      name,
      baseUrl: "https://relay.example/api/",
      apiKey: SECRET,
      models: models.map((id) => ({ id })),
      defaultModelId: models[0]!,
    });
    expect(saved.error).toBeNull();
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    return saved.endpoint.id;
  }

  function catalogPath(): string {
    return path.join(daemon.paseoHome, "api-endpoints", "codex-models.json");
  }

  async function catalog(): Promise<string[]> {
    const parsed = JSON.parse(await readFile(catalogPath(), "utf8")) as {
      models: Array<{ slug: string; visibility: string }>;
    };
    return parsed.models.map((model) => `${model.slug} ${model.visibility}`);
  }

  async function codexToken(): Promise<string | undefined> {
    const text = await readFile(
      path.join(daemon.paseoHome, "api-endpoints", "gateway-tokens.json"),
      "utf8",
    ).catch(() => '{"tokens":{}}');
    return (JSON.parse(text) as { tokens: Record<string, string> }).tokens.codex;
  }

  test("activate → Official writes only the owned keys and table, then puts the file back", async () => {
    const endpointId = await createEndpoint();
    expect(JSON.stringify(await client.apiEndpointList("codex"))).not.toContain(SECRET);

    const activated = await client.apiEndpointSetActive("codex", endpointId);
    expect(activated).toMatchObject({ activeEndpointId: endpointId, error: null });

    const token = await codexToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await readFile(configPath, "utf8")).toBe(`# my codex config
model = "relay/gpt" # default
model_provider = "${ID}"
model_catalog_json = ${JSON.stringify(catalogPath())}

[projects."/Users/me/My Code"]
trust_level = "trusted"

[model_providers.mine]
name = "Mine"
base_url = "https://mine.example/v1"

[model_providers.${ID}]
name = "Osuna"
base_url = "http://127.0.0.1:${daemon.port}/api-endpoint-gateway/v1"
wire_api = "responses"
experimental_bearer_token = "${token}"
`);
    expect(await catalog()).toEqual([
      "relay/gpt list",
      "relay/mini list",
      "relay/relay/gpt hide",
      "relay/relay/mini hide",
    ]);
    expect((await stat(catalogPath())).mode & 0o777).toBe(0o600);
    expect(await readFile(authPath, "utf8")).toBe(AUTH_JSON);
    expect(await readdir(path.join(daemon.paseoHome, "api-endpoints"))).not.toContain(
      "codex-api-key",
    );

    // 首次改写前留了一份完整副本。
    const backupsDir = path.join(daemon.paseoHome, "api-endpoints", "backups");
    const backups = await readdir(backupsDir);
    expect(backups).toHaveLength(1);
    expect(await readFile(path.join(backupsDir, backups[0]!), "utf8")).toBe(USER_CONFIG);

    const official = await client.apiEndpointSetActive("codex", null);
    expect(official).toMatchObject({ activeEndpointId: null, error: null });

    expect(await readFile(configPath, "utf8")).toBe(USER_CONFIG);
    await expect(stat(catalogPath())).rejects.toMatchObject({ code: "ENOENT" });
    expect(await codexToken()).toBeUndefined();
    expect(await readFile(authPath, "utf8")).toBe(AUTH_JSON);
  });

  test("the model catalog follows the selected models, the endpoint switches, and the agent switch", async () => {
    const endpointId = await createEndpointWithBaseUrls("Relay", ["relay/gpt", "relay/mini"]);
    expect(
      (await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: true })).error,
    ).toBeNull();
    const config = await readFile(configPath, "utf8");

    await client.apiEndpointSave({
      provider: "codex",
      endpointId,
      name: "Relay",
      baseUrl: "https://relay.example/api",
      models: [{ id: "relay/gpt" }, { id: "relay/new" }],
      defaultModelId: "relay/gpt",
    });
    expect(await catalog()).toEqual([
      "relay/gpt list",
      "relay/new list",
      "relay/relay/gpt hide",
      "relay/relay/new hide",
    ]);

    const other = await createEndpointWithBaseUrls("Other", ["glm"]);
    expect(await catalog()).toContain("glm list");
    await client.apiEndpointSetEndpointState({ endpointId: other, enabled: false });
    expect(await catalog()).not.toContain("glm list");
    // 目录变了，config.toml 不用动。
    expect(await readFile(configPath, "utf8")).toBe(config);

    await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: false });
    await expect(stat(catalogPath())).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(configPath, "utf8")).toBe(USER_CONFIG);
  });

  async function createEndpointWithBaseUrls(name: string, models: string[]): Promise<string> {
    const saved = await client.apiEndpointSave({
      provider: "codex",
      name,
      baseUrls: [{ format: "openai_responses", url: `https://${name.toLowerCase()}.example/v1` }],
      apiKey: SECRET,
      models: models.map((id) => ({ id })),
    });
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    return saved.endpoint.id;
  }

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

  test("deleting the last endpoint switches back to Official and puts the file back", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("codex", endpointId);

    const deleted = await client.apiEndpointDelete("codex", endpointId);

    expect(deleted).toMatchObject({ activeEndpointId: null, error: null });
    expect(await readFile(configPath, "utf8")).toBe(USER_CONFIG);
    await expect(stat(catalogPath())).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(authPath, "utf8")).toBe(AUTH_JSON);
  });

  test("deleting the active endpoint restores the original values after an outside change", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("codex", endpointId);
    const switched = await readFile(configPath, "utf8");
    await writeFile(configPath, switched.replace(`model = "relay/gpt"`, `model = "other-tool"`));
    expect((await client.apiEndpointList("codex")).health?.[0]?.code).toBe("modified_externally");

    expect(await client.apiEndpointDelete("codex", endpointId)).toMatchObject({
      activeEndpointId: null,
      error: null,
    });
    expect(await readFile(configPath, "utf8")).toBe(USER_CONFIG);
  });

  test("deleting the active endpoint while config.toml keeps changing deletes nothing", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("codex", endpointId);
    const switched = await readFile(configPath, "utf8");
    const catalogBefore = await catalog();
    let changes = 0;
    onRecheck = (filePath) => {
      changes += 1;
      writeFileSync(filePath, `${switched}# rev ${changes}\n`);
    };

    const deleted = await client.apiEndpointDelete("codex", endpointId);

    expect(deleted.error?.code).toBe("config_conflict");
    onRecheck = null;
    const listed = await client.apiEndpointList("codex");
    expect(listed.activeEndpointId).toBe(endpointId);
    expect(listed.endpoints.map((endpoint) => endpoint.id)).toEqual([endpointId]);
    expect(await catalog()).toEqual(catalogBefore);
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

  test("a new default model rewrites config.toml; the endpoint's address and key don't", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("codex", endpointId);
    const switched = await readFile(configPath, "utf8");

    await client.apiEndpointSave({
      provider: "codex",
      endpointId,
      name: "Relay",
      baseUrl: "https://moved.example/v1",
      apiKey: "sk-rotated",
      models: [{ id: "relay/gpt" }, { id: "relay/mini" }],
      defaultModelId: "relay/gpt",
    });
    expect(await readFile(configPath, "utf8")).toBe(switched);
    expect(await readFile(configPath, "utf8")).not.toContain("sk-rotated");

    await client.apiEndpointSetAgentSettings({
      provider: "codex",
      enabled: true,
      defaultModelId: "relay/mini",
    });
    expect(await readFile(configPath, "utf8")).toContain(`model = "relay/mini" # default`);
  });

  test("refuses to write anything when config.toml does not parse", async () => {
    const endpointId = await createEndpoint();
    const broken = `model = "a"\nmodel = "b"\n`;
    await writeFile(configPath, broken);

    const activated = await client.apiEndpointSetActive("codex", endpointId);

    expect(activated.activeEndpointId).toBeNull();
    expect(activated.error?.code).toBe("config_unparsable");
    expect(await readFile(configPath, "utf8")).toBe(broken);
    await expect(stat(catalogPath())).rejects.toMatchObject({ code: "ENOENT" });
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

  test("a config.toml that keeps changing is a conflict: neither the catalog nor the mode moves", async () => {
    const endpointId = await createEndpoint();
    let changes = 0;
    onRecheck = (filePath) => {
      changes += 1;
      writeFileSync(filePath, `${USER_CONFIG}# rev ${changes}\n`);
    };

    const activated = await client.apiEndpointSetActive("codex", endpointId);

    expect(activated).toMatchObject({ activeEndpointId: null, error: { code: "config_conflict" } });
    expect(await readFile(configPath, "utf8")).toBe(`${USER_CONFIG}# rev 3\n`);
    await expect(stat(catalogPath())).rejects.toMatchObject({ code: "ENOENT" });
    expect(await codexToken()).toBeUndefined();
    expect((await client.apiEndpointList("codex")).activeEndpointId).toBeNull();
  });

  test("keeps the mode when config.toml cannot be replaced", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("codex", endpointId);
    // 模型名与第一家不同：默认模型换成它，config.toml 的 model 要改写。
    const other = await createEndpoint("Other", ["other/gpt"]);
    const catalogBefore = await catalog();
    // 目录只读：原子替换失败，状态和模型目录都要停在切换前。
    await chmod(codexHome, 0o500);
    try {
      const switched = await client.apiEndpointSetActive("codex", other);

      expect(switched.activeEndpointId).toBe(endpointId);
      expect(switched.error).not.toBeNull();
      expect((await client.apiEndpointList("codex")).activeEndpointId).toBe(endpointId);
      expect(await catalog()).toEqual(catalogBefore);
    } finally {
      await chmod(codexHome, 0o700);
    }
  });
});
