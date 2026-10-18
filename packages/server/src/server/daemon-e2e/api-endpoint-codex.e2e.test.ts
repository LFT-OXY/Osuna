import { writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
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

  /** 切回官方后：顶层键还原，Osuna 的服务商表留在末尾（ADR 0010）。 */
  async function keptConfig(base = USER_CONFIG): Promise<string> {
    return `${base}
[model_providers.${ID}]
name = "Osuna"
base_url = "http://127.0.0.1:${daemon.port}/api-endpoint-gateway/v1"
wire_api = "responses"
experimental_bearer_token = "${await codexToken()}"
`;
  }

  async function codexToken(): Promise<string | undefined> {
    const text = await readFile(
      path.join(daemon.paseoHome, "api-endpoints", "gateway-tokens.json"),
      "utf8",
    ).catch(() => '{"tokens":{}}');
    return (JSON.parse(text) as { tokens: Record<string, string> }).tokens.codex;
  }

  test("activate → Official writes only the owned keys and table, then puts the keys back and keeps the table", async () => {
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

    expect(await readFile(configPath, "utf8")).toBe(await keptConfig());
    await expect(stat(catalogPath())).rejects.toMatchObject({ code: "ENOENT" });
    // 口令不作废：关掉后经这张表来的请求照样认得出是 Codex。
    expect(await codexToken()).toBe(token);
    expect(await readFile(authPath, "utf8")).toBe(AUTH_JSON);
  });

  test("turning the switch off and on again writes the same token into config.toml", async () => {
    await createEndpointWithBaseUrls("Relay", ["relay/gpt"]);
    const writtenToken = async () =>
      /experimental_bearer_token = "([^"]+)"/.exec(await readFile(configPath, "utf8"))?.[1];
    expect(
      (await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: true })).error,
    ).toBeNull();
    const token = await writtenToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: false });
    expect(await writtenToken()).toBe(token);
    expect(
      (await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: true })).error,
    ).toBeNull();

    expect(await readFile(configPath, "utf8")).toContain(`model_provider = "${ID}"`);
    expect(await writtenToken()).toBe(token);
    expect(await codexToken()).toBe(token);
  });

  test("every catalog entry offers four reasoning levels and defaults to the one nearest the user's effort", async () => {
    await writeFile(configPath, `model_reasoning_effort = "none"\n${USER_CONFIG}`);
    await createEndpointWithBaseUrls("Relay", ["relay/gpt"]);
    expect(
      (await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: true })).error,
    ).toBeNull();

    const { models } = JSON.parse(await readFile(catalogPath(), "utf8")) as {
      models: Array<Record<string, unknown>>;
    };
    expect(models.map((model) => model.visibility)).toEqual(["list", "hide"]);
    for (const model of models) {
      expect(model).toMatchObject({
        default_reasoning_level: "low",
        supports_reasoning_summaries: true,
      });
      expect(
        (model.supported_reasoning_levels as Array<{ effort: string }>).map(
          (level) => level.effort,
        ),
      ).toEqual(["low", "medium", "high", "xhigh"]);
    }
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
    expect(await readFile(configPath, "utf8")).toBe(await keptConfig());
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

  test("deleting the last endpoint switches back to Official and puts the owned keys back", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetActive("codex", endpointId);

    const deleted = await client.apiEndpointDelete("codex", endpointId);

    expect(deleted).toMatchObject({ activeEndpointId: null, error: null });
    expect(await readFile(configPath, "utf8")).toBe(await keptConfig());
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
    expect(await readFile(configPath, "utf8")).toBe(await keptConfig());
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

  test("an absent config.toml is created on switch and keeps only Osuna's table after the endpoint is deleted", async () => {
    await rm(configPath);
    const endpointId = await createEndpoint();

    await client.apiEndpointSetActive("codex", endpointId);
    expect(await readFile(configPath, "utf8")).toContain(`model_provider = "${ID}"`);
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);

    await client.apiEndpointDelete("codex", endpointId);
    expect(await readFile(configPath, "utf8")).toBe((await keptConfig("")).slice(1));
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

  describe("settings changed outside Osuna (agentIssues)", () => {
    async function switchOn(): Promise<string> {
      const endpointId = await createEndpoint();
      await client.apiEndpointSetActive("codex", endpointId);
      return readFile(configPath, "utf8");
    }

    function gatewayV1(): string {
      return `http://127.0.0.1:${daemon.port}/api-endpoint-gateway/v1`;
    }

    test("Osuna's Codex model provider table pointed elsewhere reads as no longer going through the gateway", async () => {
      const switched = await switchOn();
      await writeFile(configPath, switched.replace(gatewayV1(), "https://other-tool.example/v1"));

      const listed = await client.apiEndpointList("claude");
      expect(listed.agentIssues?.codex).toEqual([
        {
          code: "not_through_gateway",
          params: { file: configPath, keys: `model_providers.${ID}` },
          message: expect.stringContaining("Codex no longer goes through the gateway"),
        },
      ]);
      expect(listed.agentIssues?.claude).toEqual([]);
    });

    test("a changed token or model_provider counts too; a changed model alone is only Model replaced", async () => {
      const switched = await switchOn();
      await writeFile(configPath, switched.replace(`model = "relay/gpt"`, `model = "gpt-5"`));
      expect((await client.apiEndpointList("codex")).agentIssues?.codex).toMatchObject([
        { code: "model_replaced" },
      ]);

      const token = await codexToken();
      await writeFile(configPath, switched.replace(`"${token}"`, `"sk-other"`));
      expect((await client.apiEndpointList("codex")).agentIssues?.codex).toMatchObject([
        { code: "not_through_gateway", params: { keys: `model_providers.${ID}` } },
      ]);

      await writeFile(
        configPath,
        switched.replace(`model_provider = "${ID}"`, `model_provider = "mine"`),
      );
      expect((await client.apiEndpointList("codex")).agentIssues?.codex).toMatchObject([
        { code: "not_through_gateway", params: { keys: "model_provider" } },
      ]);
    });

    test("re-apply writes the table back; switching to official restores the owned keys", async () => {
      const switched = await switchOn();
      const repointed = switched.replace(gatewayV1(), "https://other-tool.example/v1");
      await writeFile(configPath, repointed);

      const reapplied = await client.apiEndpointSetAgentSettings({
        provider: "codex",
        enabled: true,
        reapply: true,
      });
      expect(reapplied.error).toBeNull();
      expect(await readFile(configPath, "utf8")).toBe(switched);
      expect((await client.apiEndpointList("codex")).agentIssues?.codex).toEqual([]);

      await writeFile(configPath, repointed);
      const off = await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: false });
      expect(off.agent?.enabled).toBe(false);
      // 服务商表关掉开关时留着（ADR 0010），daemon 下次启动按新端口改写它。
      expect(await readFile(configPath, "utf8")).toBe(
        (await keptConfig()).replace(gatewayV1(), "https://other-tool.example/v1"),
      );
      expect((await client.apiEndpointList("codex")).agentIssues?.codex).toEqual([]);
    });

    test("keeping the current settings leaves config.toml as changed and the model list it still names", async () => {
      const switched = await switchOn();
      const changed = switched.replace(`model_provider = "${ID}"`, `model_provider = "mine"`);
      await writeFile(configPath, changed);

      const kept = await client.apiEndpointKeepCurrentSettings({ provider: "codex" });

      expect(kept).toMatchObject({ provider: "codex", agent: { enabled: false }, error: null });
      expect(await readFile(configPath, "utf8")).toBe(changed);
      // config.toml 仍写着 model_catalog_json：目录文件不能跟着关开关删掉，否则 Codex 读不到它。
      expect(await catalog()).toEqual(
        expect.arrayContaining(["relay/gpt list", "relay/mini list"]),
      );
      const listed = await client.apiEndpointList("codex");
      expect(listed.agentIssues?.codex).toEqual([]);
      expect(listed.health).toEqual([]);
    });

    test("keeping a table changed outside Osuna keeps it across a restart until the switch is on again", async () => {
      // 先换成一个保留数据目录的 daemon，后面才能用同一个数据目录重启。
      await client.close();
      await daemon.close();
      const homeRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-codex-home-"));
      tempRoots.push(homeRoot);
      const start = async () => {
        daemon = await createTestPaseoDaemon({
          paseoHomeRoot: homeRoot,
          cleanup: false,
          apiEndpoints: { env: { CODEX_HOME: codexHome }, homeDir: path.dirname(codexHome) },
        });
        client = await connect(daemon);
      };
      await start();
      const switched = await switchOn();
      const firstGateway = gatewayV1();
      const changed = switched
        .replace(firstGateway, "https://my-own-relay.example/v1")
        .replace(`"${await codexToken()}"`, '"sk-mine"');
      await writeFile(configPath, changed);

      const kept = await client.apiEndpointKeepCurrentSettings({ provider: "codex" });
      expect(kept).toMatchObject({ agent: { enabled: false }, error: null });
      expect(await readFile(configPath, "utf8")).toBe(changed);
      expect((await client.apiEndpointList("codex")).agentIssues?.codex).toEqual([]);

      await client.close();
      await daemon.close();
      await start();
      expect(gatewayV1()).not.toBe(firstGateway);
      expect(await readFile(configPath, "utf8")).toBe(changed);
      expect((await client.apiEndpointList("codex")).agentIssues?.codex).toEqual([]);

      const on = await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: true });
      expect(on.error).toBeNull();
      const back = await readFile(configPath, "utf8");
      expect(back).toContain(`base_url = "${gatewayV1()}"`);
      expect(back).toContain(`experimental_bearer_token = "${await codexToken()}"`);
      expect(back).toContain(`model_provider = "${ID}"`);
    });

    test("a profile that overrides the owned keys comes with the profile and the keys", async () => {
      await writeFile(
        configPath,
        `profile = "work"\n${USER_CONFIG}\n[profiles.work]\nmodel_provider = "azure"\n`,
      );
      expect((await client.apiEndpointList("claude")).agentIssues?.codex).toEqual([
        {
          code: "codex_profile_override",
          params: { file: configPath, profile: "work", keys: "model_provider" },
          message: expect.stringContaining("[profiles.work] sets model_provider"),
        },
      ]);
    });
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

// 工单 07：Codex 的模型目录按接口清单与 models.dev 写真实的上下文、档位与能否看图。
describe("Codex's model catalog carries what the endpoint models can do", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let upstream: Server | null;

  // daemon 启动前放好的 models.dev 缓存；测试 daemon 默认关着自动更新，不会去下载。
  const MODELS_DEV_CACHE = {
    fetchedAt: "2026-10-15T00:00:00.000Z",
    etag: null,
    models: {
      "kimi-k2": {
        context: 262_144,
        output: 98_304,
        efforts: ["low", "high", "max"],
        images: true,
      },
    },
  };

  async function start(input: {
    modelsDevCache?: object;
    modelsDevFetch?: typeof globalThis.fetch;
    modelsDevTimers?: { schedule: (handler: () => void, ms: number) => () => void };
  }): Promise<void> {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-codex-facts-"));
    tempRoots.push(root);
    const codexHome = path.join(root, "codex-home");
    await mkdir(codexHome, { recursive: true });
    await writeFile(path.join(codexHome, "config.toml"), USER_CONFIG);
    const cacheDir = path.join(root, "home", ".paseo", "api-endpoints");
    await mkdir(cacheDir, { recursive: true });
    if (input.modelsDevCache) {
      await writeFile(path.join(cacheDir, "models-dev.json"), JSON.stringify(input.modelsDevCache));
    }
    daemon = await createTestPaseoDaemon({
      paseoHomeRoot: path.join(root, "home"),
      apiEndpoints: {
        env: { CODEX_HOME: codexHome },
        homeDir: root,
        ...(input.modelsDevFetch
          ? {
              isModelsDevAutoUpdate: () => true,
              modelsDevFetch: input.modelsDevFetch,
              modelsDevTimers: input.modelsDevTimers,
            }
          : {}),
      },
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

  async function switchOn(baseUrl: string, models: string[]): Promise<string> {
    const saved = await client.apiEndpointSave({
      provider: "codex",
      name: "Relay",
      baseUrl,
      apiKey: SECRET,
      models: models.map((id) => ({ id })),
      defaultModelId: models[0]!,
    });
    const endpointId = saved.endpoint?.id;
    if (!endpointId) throw new Error("Expected a saved endpoint");
    await client.apiEndpointSetActive("codex", endpointId);
    return endpointId;
  }

  interface Entry {
    slug: string;
    context_window: number;
    max_context_window?: number;
    default_reasoning_level: string | null;
    supported_reasoning_levels: Array<{ effort: string }>;
    input_modalities?: string[];
  }

  async function entries(): Promise<Record<string, Entry>> {
    const file = path.join(daemon.paseoHome, "api-endpoints", "codex-models.json");
    const parsed = JSON.parse(await readFile(file, "utf8")) as { models: Entry[] };
    return Object.fromEntries(parsed.models.map((entry) => [entry.slug, entry]));
  }

  function facts(entry: Entry | undefined) {
    if (!entry) throw new Error("Expected a catalog entry");
    return {
      context: entry.context_window,
      max: entry.max_context_window,
      levels: entry.supported_reasoning_levels.map((level) => level.effort),
      start: entry.default_reasoning_level,
      input: entry.input_modalities,
    };
  }

  const UNKNOWN = {
    context: 272_000,
    max: 272_000,
    levels: ["low", "medium", "high", "xhigh"],
    start: "medium",
    input: undefined,
  };

  test("the endpoint's own list first, models.dev next, and today's entry for a model neither knows", async () => {
    await start({ modelsDevCache: MODELS_DEV_CACHE });
    upstream = createServer((request, response) => {
      if (request.url !== "/api/v1/models") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          data: [
            {
              id: "glm-5",
              context_length: 200_000,
              supported_reasoning_levels: ["high", "max"],
              modalities: { input: ["text"] },
            },
            // 清单说的看图在 models.dev 的前面，没说的上下文与档位由 models.dev 补上。
            { id: "kimi-k2", modalities: { input: ["text"] } },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) => upstream?.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/api`;
    const endpointId = await switchOn(baseUrl, ["glm-5", "kimi-k2", "mystery"]);

    const before = await entries();
    expect(facts(before["glm-5"])).toEqual(UNKNOWN);
    expect(facts(before["kimi-k2"])).toEqual({
      context: 262_144,
      max: undefined,
      levels: ["low", "high", "max"],
      start: "high",
      input: ["text", "image"],
    });

    const fetched = await client.apiEndpointFetchModels({
      provider: "codex",
      endpointId,
      baseUrl,
      format: "openai_responses",
    });
    expect(fetched.error).toBeNull();

    const after = await entries();
    const glm = {
      context: 200_000,
      max: undefined,
      levels: ["high", "max"],
      start: "high",
      input: ["text"],
    };
    expect(facts(after["glm-5"])).toEqual(glm);
    expect(facts(after["relay/glm-5"])).toEqual(glm);
    expect(facts(after["kimi-k2"])).toEqual({
      context: 262_144,
      max: undefined,
      levels: ["low", "high", "max"],
      start: "high",
      input: ["text"],
    });
    expect(facts(after.mystery)).toEqual(UNKNOWN);
  });

  test("models.dev is not downloaded with both switches off; Codex alone allows it and the catalog follows", async () => {
    const requests: string[] = [];
    // 价格表自动更新开着；检查的定时器由测试手动到点。
    let pending: (() => void) | null = null;
    const modelsDevTimers = {
      schedule(handler: () => void) {
        pending = handler;
        return () => {
          if (pending === handler) pending = null;
        };
      },
    };
    function fireCheck(): void {
      const handler = pending;
      if (!handler) throw new Error("Expected a scheduled models.dev check");
      pending = null;
      handler();
    }
    const modelsDevFetch: typeof globalThis.fetch = async (input) => {
      requests.push(String(input));
      return new Response(
        JSON.stringify({
          relay: {
            models: {
              mystery: {
                limit: { context: 400_000, output: 128_000 },
                reasoning_options: [{ type: "effort", values: ["minimal", "low"] }],
                modalities: { input: ["text", "image"] },
              },
            },
          },
        }),
        { status: 200 },
      );
    };
    await start({ modelsDevFetch, modelsDevTimers });
    // 两个开关都关着：到点的检查不下载，改约一小时后。
    fireCheck();
    await expect.poll(() => pending).not.toBeNull();
    expect(requests).toEqual([]);

    await switchOn("https://relay.example/api", ["mystery"]);
    fireCheck();

    await expect.poll(() => requests).toEqual(["https://models.dev/api.json"]);
    await expect
      .poll(async () => facts((await entries()).mystery))
      .toEqual({
        context: 400_000,
        max: undefined,
        levels: ["minimal", "low"],
        start: "minimal",
        input: ["text", "image"],
      });
  });
});

describe("Codex used without going through the gateway (bypassed)", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let codexHome: string;
  let configPath: string;
  let upstream: Server;
  // 接口服务与中转站共用的时钟，测试拨动它，不必真的等 30 秒的余量。
  let clock: Date;
  // 整秒起步：Codex 的记录按秒。
  const start = new Date(Math.floor(Date.now() / 1000) * 1000);

  function after(seconds: number): Date {
    return new Date(start.getTime() + seconds * 1000);
  }

  function unixSeconds(seconds: number): number {
    return Math.trunc(after(seconds).getTime() / 1000);
  }

  beforeEach(async () => {
    clock = start;
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-codex-bypass-"));
    tempRoots.push(root);
    codexHome = path.join(root, "codex-home");
    configPath = path.join(codexHome, "config.toml");
    await mkdir(codexHome, { recursive: true });
    await writeFile(configPath, USER_CONFIG);
    // 假上游：Responses 格式的一句回答。
    upstream = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "resp_1",
          object: "response",
          status: "completed",
          model: "gpt-relay",
          output: [
            { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    daemon = await createTestPaseoDaemon({
      apiEndpoints: { env: { CODEX_HOME: codexHome }, homeDir: root, now: () => clock },
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
      provider: "codex",
      name: "Relay",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiKey: SECRET,
      models: [{ id: "gpt-relay" }],
      defaultModelId: "gpt-relay",
    });
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    clock = after(seconds);
    await client.apiEndpointSetActive("codex", saved.endpoint.id);
  }

  async function typedAt(...seconds: number[]): Promise<void> {
    const lines = seconds.map((at) =>
      JSON.stringify({ session_id: "s-1", ts: unixSeconds(at), text: "fix the bug" }),
    );
    await writeFile(path.join(codexHome, "history.jsonl"), `${lines.join("\n")}\n`);
  }

  /** Codex 应用与 TUI 的日志库里记下一次模型连接。 */
  function connectedAt(input: { seconds: number; url: string }): void {
    const db = new DatabaseSync(path.join(codexHome, "logs_2.sqlite"));
    db.exec(
      "CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY, ts INTEGER, ts_nanos INTEGER, target TEXT, feedback_log_body TEXT)",
    );
    db.prepare(
      "INSERT INTO logs (ts, ts_nanos, target, feedback_log_body) VALUES (?, 0, 'codex_api::endpoint::responses_websocket', ?)",
    ).run(unixSeconds(input.seconds), `connecting to websocket: ${input.url}`);
    db.close();
  }

  async function codexIssues(): Promise<unknown> {
    return (await client.apiEndpointList("codex")).agentIssues?.codex;
  }

  function bypassedAt(seconds: number): unknown {
    return [
      {
        code: "bypassed",
        params: { how: "used", at: after(seconds).toISOString() },
        message: expect.stringContaining("none of its requests reached the gateway"),
      },
    ];
  }

  test("used after the rewrite with no request reaching the gateway: bypassed", async () => {
    await switchOnAt(10);
    await typedAt(20);
    clock = after(100);

    expect(await codexIssues()).toEqual(bypassedAt(20));
  });

  test("a request the gateway received means it came through", async () => {
    await switchOnAt(10);
    await typedAt(20);
    clock = after(21);
    const reply = await fetch(`http://127.0.0.1:${daemon.port}/api-endpoint-gateway/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "codex_cli_rs/0.130.0" },
      body: JSON.stringify({ model: "gpt-relay", input: "fix the bug", stream: false }),
    });
    expect(reply.status).toBe(200);
    clock = after(100);

    expect(await codexIssues()).toEqual([]);
  });

  test("a use before the rewrite, or within the last thirty seconds, doesn't count", async () => {
    await switchOnAt(10);
    await typedAt(5);
    clock = after(100);
    expect(await codexIssues()).toEqual([]);

    await typedAt(5, 90);
    expect(await codexIssues()).toEqual([]);
  });

  test("the Codex app's newest model connection going somewhere else is bypassed; one before the rewrite isn't", async () => {
    connectedAt({ seconds: 5, url: "wss://chatgpt.com/backend-api/codex/responses" });
    await switchOnAt(10);
    clock = after(100);
    expect(await codexIssues()).toEqual([]);

    connectedAt({ seconds: 40, url: "wss://chatgpt.com/backend-api/codex/responses" });
    expect(await codexIssues()).toEqual([
      {
        code: "bypassed",
        params: { how: "elsewhere", at: after(40).toISOString(), host: "chatgpt.com" },
        message: expect.stringContaining("went to chatgpt.com"),
      },
    ]);
  });

  test("Re-apply clears it and earlier uses no longer count; Official restores the file", async () => {
    await switchOnAt(10);
    await typedAt(20);
    clock = after(100);
    expect(await codexIssues()).toEqual(bypassedAt(20));

    const reapplied = await client.apiEndpointSetAgentSettings({
      provider: "codex",
      enabled: true,
      reapply: true,
    });
    expect(reapplied.error).toBeNull();
    clock = after(300);
    expect(await codexIssues()).toEqual([]);

    await typedAt(20, 200);
    expect(await codexIssues()).toEqual(bypassedAt(200));
    const off = await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: false });
    expect(off.agent?.enabled).toBe(false);
    // 顶层键还原，Osuna 的服务商表留在末尾（ADR 0010）。
    const restored = await readFile(configPath, "utf8");
    expect(restored.slice(0, USER_CONFIG.length)).toBe(USER_CONFIG);
    expect(await codexIssues()).toEqual([]);
  });
});
