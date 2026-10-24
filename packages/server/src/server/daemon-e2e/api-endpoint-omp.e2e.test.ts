import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AGENT_PROVIDER_DEFINITIONS } from "@getpaseo/protocol/provider-manifest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { parse } from "yaml";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestAgentClient, createTestAgentClients } from "../test-utils/fake-agent-client.js";

type EndpointSave = Parameters<DaemonClient["apiEndpointSave"]>[0];
type ApiEndpointOptions = NonNullable<Parameters<typeof createTestPaseoDaemon>[0]>["apiEndpoints"];

// 用到的只有 Claude Code、Codex（假的）与 OMP（假的客户端）；别的内置提供方关掉，快照不去起它们的 CLI。
const USED_PROVIDERS = new Set(["claude", "codex", "omp"]);
const OTHER_PROVIDERS_OFF = Object.fromEntries(
  AGENT_PROVIDER_DEFINITIONS.filter((definition) => !USED_PROVIDERS.has(definition.id)).map(
    (definition) => [definition.id, { enabled: false }],
  ),
);

/*
 * OMP 默认那套配置的「使用第三方接口」（任务 10-16-pi-omp-endpoints 工单 04）：真实 daemon，家目录是临时目录，
 * OMP 的 agent 目录落在其中的 .omp/agent。打开、改默认设置、关掉，检查 models.yml 与 config.yml 的内容；
 * 从不运行真的 OMP，也不碰 ~/.omp。
 */

// 用户手写的 models.yml：注释、flow 写法的列表、另一家服务商。
const USER_MODELS = `# my providers
providers:
  ollama: # local
    baseUrl: http://localhost:11434/v1
    api: openai-completions
    models: [{id: llama3}]
`;

const USER_CONFIG = `# omp settings
modelRoles:
  default: anthropic/claude-sonnet-4-5 # main model
theme: dark
`;

const tempRoots: string[] = [];

async function connect(daemon: TestPaseoDaemon): Promise<DaemonClient> {
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  return client;
}

/** 快照里对话能选的一个接口模型。 */
interface ChatModel {
  id: string;
  isDefault?: boolean;
  thinkingOptions?: { id: string }[];
  defaultThinkingOptionId?: string;
}

interface OmpModel {
  id: string;
  name: string;
  thinking?: { mode: string; efforts: string[] };
}

describe("OMP API endpoints over the daemon RPC", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let root: string;
  let ompDir: string;
  let modelsPath: string;
  let configPath: string;
  // 守卫：PATH 最前面放会留下记号并失败的 pi 与 omp，真的 CLI 被起就能看出来。
  let guardDir: string;
  let guardMark: string;
  let pathBefore: string | undefined;

  beforeAll(async () => {
    guardDir = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-omp-guard-"));
    guardMark = path.join(guardDir, "spawned");
    // POSIX 上找的是 sh 脚本，Windows 上按 PATHEXT 找到 .cmd：两边都放，守卫在哪都管用。
    for (const name of ["pi", "omp"]) {
      const script = path.join(guardDir, name);
      await writeFile(script, `#!/bin/sh\necho ${name} >> "${guardMark}"\nexit 1\n`);
      await chmod(script, 0o755);
      await writeFile(`${script}.cmd`, `@echo ${name}>> "${guardMark}"\r\n@exit /b 1\r\n`);
    }
    pathBefore = process.env.PATH;
    process.env.PATH = `${guardDir}${path.delimiter}${pathBefore ?? ""}`;
  });

  afterAll(async () => {
    process.env.PATH = pathBefore;
    await rm(guardDir, { recursive: true, force: true });
  });

  async function startDaemon(extra: Partial<NonNullable<ApiEndpointOptions>> = {}): Promise<void> {
    daemon = await createTestPaseoDaemon({
      agentClients: { ...createTestAgentClients(), omp: createTestAgentClient("omp") },
      providerOverrides: OTHER_PROVIDERS_OFF,
      apiEndpoints: {
        env: {
          CLAUDE_CONFIG_DIR: path.join(root, "claude"),
          CODEX_HOME: path.join(root, "codex"),
        },
        homeDir: root,
        readOmpCliVersion: async () => "18.12.6",
        ...extra,
      },
    });
    client = await connect(daemon);
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-omp-"));
    tempRoots.push(root);
    ompDir = path.join(root, ".omp", "agent");
    modelsPath = path.join(ompDir, "models.yml");
    configPath = path.join(ompDir, "config.yml");
    await mkdir(ompDir, { recursive: true });
    await writeFile(modelsPath, USER_MODELS);
    await writeFile(configPath, USER_CONFIG);
    await startDaemon();
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    await expect(stat(guardMark)).rejects.toMatchObject({ code: "ENOENT" });
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function restartDaemon(extra: Partial<NonNullable<ApiEndpointOptions>>): Promise<void> {
    await client.close();
    await daemon.close();
    await startDaemon(extra);
  }

  function gatewayRoot(): string {
    return `http://127.0.0.1:${daemon.port}/api-endpoint-gateway`;
  }

  async function ompToken(): Promise<string | undefined> {
    const text = await readFile(
      path.join(daemon.paseoHome, "api-endpoints", "gateway-tokens.json"),
      "utf8",
    );
    return (JSON.parse(text) as { tokens: Record<string, string> }).tokens.omp;
  }

  /** 一家接口，三种格式的地址都有：GPT 走 Responses、Claude 走 Anthropic、别的留在 Chat。 */
  async function createEndpoint(extra: Partial<EndpointSave> = {}): Promise<string> {
    const saved = await client.apiEndpointSave({
      provider: "omp",
      name: "Relay",
      baseUrls: [
        { format: "anthropic_messages", url: "https://relay.example" },
        { format: "openai_chat", url: "https://relay.example/v1" },
        { format: "openai_responses", url: "https://relay.example/v1" },
      ],
      apiKey: "sk-relay-secret",
      models: [{ id: "glm-5" }, { id: "gpt-5" }, { id: "claude-opus-5-5" }],
      ...extra,
    });
    expect(saved.error).toBeNull();
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    return saved.endpoint.id;
  }

  async function modelsYaml(): Promise<{ providers: Record<string, Record<string, unknown>> }> {
    return parse(await readFile(modelsPath, "utf8")) as {
      providers: Record<string, Record<string, unknown>>;
    };
  }

  async function configYaml(): Promise<Record<string, unknown>> {
    return parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  }

  async function osunaModels(): Promise<OmpModel[]> {
    return ((await modelsYaml()).providers.osuna?.models ?? []) as OmpModel[];
  }

  test("turning the switch on adds Osuna's provider and the default role, and turning it off puts both files back", async () => {
    await createEndpoint();
    const on = await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    expect(on.error).toBeNull();
    expect(on.agent).toMatchObject({ enabled: true, defaultModelId: "glm-5" });

    const token = await ompToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const modelsText = await readFile(modelsPath, "utf8");
    // 用户的注释与 flow 写法原样留着，Osuna 的服务商加在后面。
    expect(modelsText.startsWith(USER_MODELS)).toBe(true);
    expect(modelsText).not.toContain("User-Agent");
    expect((await modelsYaml()).providers.osuna).toEqual({
      baseUrl: `${gatewayRoot()}/v1`,
      api: "openai-completions",
      auth: "apiKey",
      apiKey: token,
      compat: { promptCacheSessionHeader: "x-session-affinity" },
      models: [
        { id: "glm-5", name: "glm-5", reasoning: false },
        { id: "gpt-5", name: "gpt-5", reasoning: false, api: "openai-responses" },
        // 光秃秃的 Claude 留在 Chat：中转站按接住它的那家翻译。
        { id: "claude-opus-5-5", name: "claude-opus-5-5", reasoning: false },
        { id: "relay/glm-5", name: "glm-5 (Relay)", reasoning: false },
        { id: "relay/gpt-5", name: "gpt-5 (Relay)", reasoning: false, api: "openai-responses" },
        {
          id: "relay/claude-opus-5-5",
          name: "claude-opus-5-5 (Relay)",
          api: "anthropic-messages",
          baseUrl: gatewayRoot(),
          reasoning: false,
        },
      ],
    });
    expect(await readFile(configPath, "utf8")).toBe(`# omp settings
modelRoles:
  default: osuna/glm-5 # main model
theme: dark
`);
    // 首次改写前两份文件各留一份完整副本。
    const backupsDir = path.join(daemon.paseoHome, "api-endpoints", "backups");
    const backups = (await readdir(backupsDir)).sort();
    expect(backups.map((name) => name.split(".")[0])).toEqual(["omp-config", "omp-models"]);
    expect(await readFile(path.join(backupsDir, backups[0]!), "utf8")).toBe(USER_CONFIG);
    expect(await readFile(path.join(backupsDir, backups[1]!), "utf8")).toBe(USER_MODELS);
    expect((await client.apiEndpointList("omp")).agentIssues?.omp).toEqual([]);

    const off = await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: false });
    expect(off.error).toBeNull();
    expect(await readFile(modelsPath, "utf8")).toBe(USER_MODELS);
    expect(await readFile(configPath, "utf8")).toBe(USER_CONFIG);
    expect(await ompToken()).toBe(token);
  });

  test("thinking is written as OMP's thinking block, max included for an OMP that takes it", async () => {
    const efforts = ["low", "high", "max"];
    await createEndpoint({
      modelSettings: {
        models: { "glm-5": { efforts }, "claude-opus-5-5": { efforts: ["low", "high"] } },
      },
    });
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    const current = await osunaModels();
    expect(current.find((model) => model.id === "glm-5")?.thinking).toEqual({
      mode: "effort",
      efforts: ["low", "high", "max"],
    });
    expect(current.find((model) => model.id === "relay/claude-opus-5-5")?.thinking).toEqual({
      mode: "anthropic-adaptive",
      efforts: ["low", "high"],
    });
  });

  test.each([
    ["16.3.9", "16.3.9"],
    ["unknown", null],
  ])(
    "an OMP of version %s gets xhigh in place of max, which it would refuse",
    async (_name, version) => {
      await restartDaemon({ readOmpCliVersion: async () => version });
      await createEndpoint({
        modelSettings: { models: { "glm-5": { efforts: ["low", "high", "max"] } } },
      });
      await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
      expect((await osunaModels()).find((model) => model.id === "glm-5")?.thinking).toEqual({
        mode: "effort",
        efforts: ["low", "high", "xhigh"],
      });
    },
  );

  test("an older models.json alone is carried over to models.yml first, and stays as it was", async () => {
    await rm(modelsPath);
    const legacy = `{
  // my local ollama
  "providers": { "ollama": { "baseUrl": "http://localhost:11434/v1", "models": [{ "id": "llama3" }] } }
}
`;
    const legacyPath = path.join(ompDir, "models.json");
    await writeFile(legacyPath, legacy);
    await createEndpoint();

    expect(
      (await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true })).error,
    ).toBeNull();
    expect(Object.keys((await modelsYaml()).providers)).toEqual(["ollama", "osuna"]);
    expect((await modelsYaml()).providers.ollama).toEqual({
      baseUrl: "http://localhost:11434/v1",
      models: [{ id: "llama3" }],
    });
    expect(await readFile(legacyPath, "utf8")).toBe(legacy);

    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: false });
    expect(await modelsYaml()).toEqual({
      providers: {
        ollama: { baseUrl: "http://localhost:11434/v1", models: [{ id: "llama3" }] },
      },
    });
  });

  test("models.yaml is written when it is the only one OMP has", async () => {
    await rm(modelsPath);
    const yamlPath = path.join(ompDir, "models.yaml");
    await writeFile(yamlPath, USER_MODELS);
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    await expect(stat(modelsPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(parse(await readFile(yamlPath, "utf8"))).toHaveProperty("providers.osuna");
  });

  test("what the user wrote in providers.osuna stays, the address, auth, key and models are Osuna's", async () => {
    await writeFile(
      modelsPath,
      `${USER_MODELS}  osuna:
    baseUrl: http://elsewhere/v1
    auth: none
    headers:
      X-Team: core
    compat:
      supportsStore: false
    modelOverrides:
      glm-5:
        contextWindow: 1000
    discovery:
      type: openai-models-list
    disableStrictTools: true
    remoteCompaction:
      model: glm-5
`,
    );
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    const osuna = (await modelsYaml()).providers.osuna;
    expect(osuna).toMatchObject({
      baseUrl: `${gatewayRoot()}/v1`,
      auth: "apiKey",
      apiKey: await ompToken(),
      headers: { "X-Team": "core" },
      compat: { supportsStore: false, promptCacheSessionHeader: "x-session-affinity" },
      modelOverrides: { "glm-5": { contextWindow: 1000 } },
      discovery: { type: "openai-models-list" },
      disableStrictTools: true,
      remoteCompaction: { model: "glm-5" },
    });
  });

  test("the default thinking is written only when set, takes auto, and is put back when the switch goes off", async () => {
    const withLevel = USER_CONFIG.replace("theme: dark", "defaultThinkingLevel: low\ntheme: dark");
    await writeFile(configPath, withLevel);
    await createEndpoint({ modelSettings: { models: { "glm-5": { efforts: ["low", "high"] } } } });
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    expect(await configYaml()).toMatchObject({ defaultThinkingLevel: "low" });

    const set = await client.apiEndpointSetAgentSettings({
      provider: "omp",
      enabled: true,
      defaultThinkingOptionId: "auto",
    });
    expect(set.error).toBeNull();
    expect(set.agent).toMatchObject({ defaultThinkingOptionId: "auto" });
    expect(await configYaml()).toMatchObject({ defaultThinkingLevel: "auto" });
    const refused = await client.apiEndpointSetAgentSettings({
      provider: "omp",
      enabled: true,
      defaultThinkingOptionId: "off",
    });
    expect(refused.error).toMatchObject({ code: "invalid_input" });

    // OMP 里改成这个模型没有的 max：照 OMP 显示成它跑的那一档。
    const text = await readFile(configPath, "utf8");
    await writeFile(
      configPath,
      text.replace("defaultThinkingLevel: auto", "defaultThinkingLevel: max"),
    );
    const listed = await client.apiEndpointList("omp");
    expect(listed.agents?.omp).toMatchObject({ defaultThinkingOptionId: "high" });
    expect(listed.health).toEqual([]);

    await client.apiEndpointSetAgentSettings({
      provider: "omp",
      enabled: true,
      defaultThinkingOptionId: "high",
    });
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: false });
    expect(await readFile(configPath, "utf8")).toBe(withLevel);
  });

  test("an existing enabledModels list gets the default first, keeps its flow style, and is put back", async () => {
    const scoped = `${USER_CONFIG}enabledModels: [anthropic/claude-sonnet-4-5, openai/gpt-5]\n`;
    await writeFile(configPath, scoped);
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    expect(await readFile(configPath, "utf8")).toContain(
      "enabledModels: [osuna/glm-5, anthropic/claude-sonnet-4-5, openai/gpt-5, osuna/**]",
    );
    await client.apiEndpointSetAgentSettings({
      provider: "omp",
      enabled: true,
      defaultModelId: "relay/gpt-5",
    });
    expect((await configYaml()).enabledModels).toEqual([
      "osuna/relay/gpt-5",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-5",
      "osuna/**",
    ]);
    const preview = await client.apiEndpointPreviewSwitchOff("omp");
    expect(preview.preview?.files.map((file) => [file.path, file.change])).toEqual([
      ["~/.omp/agent/config.yml", "edited"],
      ["~/.omp/agent/models.yml", "edited"],
    ]);
    expect(JSON.stringify(preview.preview?.files[0]?.lines)).toContain("osuna/relay/gpt-5");
    expect(JSON.stringify(preview.preview?.files)).not.toContain((await ompToken()) ?? "no token");

    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: false });
    expect(await readFile(configPath, "utf8")).toBe(scoped);
  });

  test("Osuna's provider stays on switch off while another role still names osuna/, with its wiring written afresh and its enabledModels entries left", async () => {
    await writeFile(configPath, `${USER_CONFIG}enabledModels: [openai/gpt-5]\n`);
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    const text = await readFile(configPath, "utf8");
    await writeFile(
      configPath,
      text.replace(
        "theme: dark",
        "theme: dark\nretry:\n  fallbackChains:\n    default: [osuna/relay/gpt-5]",
      ),
    );
    const withProvider = await readFile(modelsPath, "utf8");
    // 留下来的接线指错了地方：关开关时照 magpie 的 dropMagpie 重写一遍。
    await writeFile(
      modelsPath,
      withProvider.replace(`${gatewayRoot()}/v1`, "http://127.0.0.1:1/v1"),
    );

    const preview = await client.apiEndpointPreviewSwitchOff("omp");
    expect(preview.preview?.files.map((file) => file.path)).toEqual([
      "~/.omp/agent/config.yml",
      "~/.omp/agent/models.yml",
    ]);

    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: false });
    expect(await readFile(modelsPath, "utf8")).toBe(withProvider);
    expect(await configYaml()).toMatchObject({
      modelRoles: { default: "anthropic/claude-sonnet-4-5" },
      retry: { fallbackChains: { default: ["osuna/relay/gpt-5"] } },
      enabledModels: ["osuna/glm-5", "openai/gpt-5", "osuna/**"],
    });
  });

  test("another of Osuna's models saved as the default role in OMP becomes Osuna's default model", async () => {
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    const text = await readFile(configPath, "utf8");
    await writeFile(
      configPath,
      text.replace("default: osuna/glm-5", "default: osuna/relay/gpt-5:high"),
    );

    const listed = await client.apiEndpointList("omp");
    expect(listed.agents?.omp).toMatchObject({ defaultModelId: "relay/gpt-5" });
    expect(listed.agentIssues?.omp).toEqual([]);
    expect(listed.health).toEqual([]);
  });

  test("a model outside Osuna saved in OMP is reported as replaced, like the other agents", async () => {
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    const text = await readFile(configPath, "utf8");
    await writeFile(configPath, text.replace("default: osuna/glm-5", "default: openai/gpt-6"));

    const listed = await client.apiEndpointList("omp");
    expect(listed.agentIssues?.omp).toEqual([
      {
        code: "model_replaced",
        params: { file: configPath, model: "openai/gpt-6", defaultModel: "glm-5" },
        message: expect.stringContaining("Oh My Pi's model was changed to openai/gpt-6"),
      },
    ]);
    const kept = await client.apiEndpointKeepCurrentSettings({
      provider: "omp",
      code: "model_replaced",
    });
    expect(kept.error).toBeNull();
    expect((await client.apiEndpointList("omp")).agentIssues?.omp).toEqual([]);
    const reapplied = await client.apiEndpointSetAgentSettings({
      provider: "omp",
      enabled: true,
      reapply: true,
    });
    expect(reapplied.error).toBeNull();
    expect(await configYaml()).toMatchObject({ modelRoles: { default: "osuna/glm-5" } });
  });

  test("Osuna's provider pointed elsewhere reads as no longer going through the gateway", async () => {
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    const text = await readFile(modelsPath, "utf8");
    await writeFile(
      modelsPath,
      text.replace(`${gatewayRoot()}/v1`, "https://other-tool.example/v1"),
    );

    expect((await client.apiEndpointList("omp")).agentIssues?.omp).toEqual([
      {
        code: "not_through_gateway",
        params: { file: modelsPath, keys: "providers.osuna" },
        message: expect.stringContaining("Oh My Pi no longer goes through the gateway"),
      },
    ]);
  });

  test("the model list in models.yml follows the endpoints and selected models", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    const saved = await client.apiEndpointSave({
      provider: "omp",
      endpointId,
      name: "Relay",
      baseUrls: [{ format: "openai_chat", url: "https://relay.example/v1" }],
      models: [{ id: "glm-5" }, { id: "kimi-k3" }],
    });
    expect(saved.error).toBeNull();
    expect((await osunaModels()).map((model) => `${model.id} ${model.name}`)).toEqual([
      "glm-5 glm-5",
      "kimi-k3 kimi-k3",
      "relay/glm-5 glm-5 (Relay)",
      "relay/kimi-k3 kimi-k3 (Relay)",
    ]);
  });

  test("new OMP chats in Osuna pick from Osuna's models as OMP names them", async () => {
    await createEndpoint({ modelSettings: { models: { "glm-5": { efforts: ["low", "high"] } } } });
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    async function ompChoices(): Promise<string[] | null> {
      const snapshot = await client.getProvidersSnapshot();
      const entry = snapshot.entries.find((candidate) => candidate.provider === "omp");
      const groups = entry?.apiEndpointModelGroups;
      if (!groups) return null;
      return groups.flatMap((group) => group.models.map(describeModel));
    }
    function describeModel(model: ChatModel): string {
      const levels = (model.thinkingOptions ?? []).map(({ id }) => id).join(",");
      const thinking = levels ? ` [${levels}] from ${model.defaultThinkingOptionId}` : "";
      return `${model.id}${model.isDefault ? " (default)" : ""}${thinking}`;
    }
    // 没设默认思考档位时从 OMP 的 high 起；不会思考的模型没有档位。
    await expect
      .poll(ompChoices, { timeout: 10_000 })
      .toEqual([
        "osuna/relay/glm-5 (default) [auto,low,high] from high",
        "osuna/relay/gpt-5",
        "osuna/relay/claude-opus-5-5",
      ]);
  });

  test("a rewrite lists the OMP agents open in Osuna to reopen", async () => {
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    await client.createAgent({ provider: "omp", cwd: root, title: "OMP agent" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await client.apiEndpointSetAgentSettings({
      provider: "omp",
      enabled: true,
      defaultModelId: "relay/gpt-5",
    });
    expect((await client.apiEndpointList("omp")).reopenHints?.omp).toEqual([
      {
        kind: "osuna_sessions",
        count: 1,
        message: "1 Oh My Pi agent(s) in Osuna: reload each one (Reload agent in its tab's menu).",
      },
    ]);
  });

  test("OMP files that did not exist are created and removed again", async () => {
    await rm(ompDir, { recursive: true });
    await createEndpoint();
    expect(
      (await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true })).error,
    ).toBeNull();
    expect(await configYaml()).toEqual({ modelRoles: { default: "osuna/glm-5" } });
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: false });
    await expect(stat(modelsPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(configPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("a model role set in Osuna goes into config.yml with its thinking level, is cleared back to OMP, and comes back on switching on again", async () => {
    await writeFile(
      configPath,
      `${USER_CONFIG.replace("theme", "  smol: [anthropic/claude-haiku-4-5]\ntheme")}`,
    );
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    // 打开开关只改默认角色，别的角色空着交给 OMP。
    expect((await configYaml()).modelRoles).toEqual({
      default: "osuna/glm-5",
      smol: ["anthropic/claude-haiku-4-5"],
    });

    const set = await client.apiEndpointSetAgentSettings({
      provider: "omp",
      enabled: true,
      modelRoles: {
        slow: { modelId: "relay/gpt-5", thinkingOptionId: "xhigh" },
        smol: { modelId: "glm-5" },
      },
    });
    expect(set.error).toBeNull();
    expect(set.agent?.modelRoles).toEqual({
      slow: { modelId: "relay/gpt-5", thinkingOptionId: "xhigh" },
      smol: { modelId: "glm-5", thinkingOptionId: null },
    });
    expect((await configYaml()).modelRoles).toEqual({
      default: "osuna/glm-5",
      smol: "osuna/glm-5",
      slow: "osuna/relay/gpt-5:xhigh",
    });
    expect((await client.apiEndpointList("omp")).agents?.omp?.modelRoles).toEqual(
      set.agent?.modelRoles,
    );

    const cleared = await client.apiEndpointSetAgentSettings({
      provider: "omp",
      enabled: true,
      modelRoles: { smol: null },
    });
    expect(cleared.agent?.modelRoles).toEqual({
      slow: { modelId: "relay/gpt-5", thinkingOptionId: "xhigh" },
    });
    expect(await readFile(configPath, "utf8")).toContain("  smol: [anthropic/claude-haiku-4-5]\n");

    const preview = await client.apiEndpointPreviewSwitchOff("omp");
    expect(preview.preview?.files.map((file) => file.path)).toEqual([
      "~/.omp/agent/config.yml",
      "~/.omp/agent/models.yml",
    ]);
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: false });
    expect(await configYaml()).toEqual({
      modelRoles: { default: "anthropic/claude-sonnet-4-5", smol: ["anthropic/claude-haiku-4-5"] },
      theme: "dark",
    });
    await expect(stat(modelsPath)).resolves.toBeTruthy();
    expect(await readFile(modelsPath, "utf8")).toBe(USER_MODELS);

    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    expect((await configYaml()).modelRoles).toEqual({
      default: "osuna/glm-5",
      smol: ["anthropic/claude-haiku-4-5"],
      slow: "osuna/relay/gpt-5:xhigh",
    });
  });

  test("a role OMP saved on another of Osuna's models is followed, and one moved off Osuna is cleared and left on switch off", async () => {
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({
      provider: "omp",
      enabled: true,
      modelRoles: {
        slow: { modelId: "glm-5", thinkingOptionId: null },
        plan: { modelId: "glm-5", thinkingOptionId: "high" },
      },
    });
    const text = await readFile(configPath, "utf8");
    await writeFile(
      configPath,
      text
        .replace("slow: osuna/glm-5", "slow: osuna/relay/gpt-5:low")
        .replace("plan: osuna/glm-5:high", "plan: openai/gpt-6"),
    );

    const listed = await client.apiEndpointList("omp");
    expect(listed.agents?.omp?.modelRoles).toEqual({
      slow: { modelId: "relay/gpt-5", thinkingOptionId: "low" },
    });
    expect(listed.agentIssues?.omp).toEqual([]);

    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: false });
    expect((await configYaml()).modelRoles).toEqual({
      default: "anthropic/claude-sonnet-4-5",
      plan: "openai/gpt-6",
    });
  });

  test("a role whose model is no longer served moves the way the default model does", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetAgentSettings({
      provider: "omp",
      enabled: true,
      modelRoles: { vision: { modelId: "relay/claude-opus-5-5", thinkingOptionId: "high" } },
    });
    const saved = await client.apiEndpointSave({
      provider: "omp",
      endpointId,
      name: "Relay",
      baseUrls: [{ format: "openai_chat", url: "https://relay.example/v1" }],
      models: [{ id: "glm-5" }, { id: "kimi-k3" }],
    });
    expect(saved.error).toBeNull();

    expect((await client.apiEndpointList("omp")).agents?.omp?.modelRoles).toEqual({
      vision: { modelId: "glm-5", thinkingOptionId: "high" },
    });
    expect((await configYaml()).modelRoles).toMatchObject({ vision: "osuna/glm-5:high" });
  });

  test.each([
    ["a role OMP doesn't have", { designer: { modelId: "glm-5" } }],
    ["a model no endpoint serves", { slow: { modelId: "gpt-9" } }],
    [
      "a thinking level OMP doesn't have",
      { slow: { modelId: "glm-5", thinkingOptionId: "ultra" } },
    ],
  ])("%s is refused and config.yml is left as it was", async (_name, modelRoles) => {
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    const before = await readFile(configPath, "utf8");

    const refused = await client.apiEndpointSetAgentSettings({
      provider: "omp",
      enabled: true,
      modelRoles,
    });

    expect(refused.error).toMatchObject({ code: "invalid_input" });
    expect(await readFile(configPath, "utf8")).toBe(before);
    expect((await client.apiEndpointList("omp")).agents?.omp?.modelRoles).toBeUndefined();
  });

  test("Claude Code ignores model roles, as it does other agents' own fields", async () => {
    await createEndpoint();
    const ignored = await client.apiEndpointSetAgentSettings({
      provider: "claude",
      enabled: false,
      modelRoles: { slow: { modelId: "glm-5" } },
    });
    expect(ignored.error).toBeNull();
    expect(ignored.agent).toEqual({ enabled: false, defaultModelId: null });
  });

  test("a role keeps its model while the switch is off, and moves the way the default model does on switching on again", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetAgentSettings({
      provider: "omp",
      enabled: true,
      defaultModelId: "relay/claude-opus-5-5",
      modelRoles: { vision: { modelId: "relay/claude-opus-5-5", thinkingOptionId: "high" } },
    });
    await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: false });
    expect(
      (
        await client.apiEndpointSave({
          provider: "omp",
          endpointId,
          name: "Relay",
          baseUrls: [{ format: "openai_chat", url: "https://relay.example/v1" }],
          models: [{ id: "glm-5" }, { id: "kimi-k3" }],
        })
      ).error,
    ).toBeNull();
    expect((await client.apiEndpointList("omp")).agents?.omp).toMatchObject({
      enabled: false,
      defaultModelId: "relay/claude-opus-5-5",
      modelRoles: { vision: { modelId: "relay/claude-opus-5-5", thinkingOptionId: "high" } },
    });

    const on = await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });
    expect(on.agent?.modelRoles).toEqual({
      vision: { modelId: "glm-5", thinkingOptionId: "high" },
    });
    expect((await configYaml()).modelRoles).toMatchObject({ vision: "osuna/glm-5:high" });
  });

  test("a config.yml that does not parse is named and neither file is written", async () => {
    await createEndpoint();
    const broken = "modelRoles:\n  default: [a\n";
    await writeFile(configPath, broken);

    const on = await client.apiEndpointSetAgentSettings({ provider: "omp", enabled: true });

    expect(on.error).toMatchObject({
      code: "config_unparsable",
      params: { file: configPath, reason: "syntax" },
    });
    expect(await readFile(configPath, "utf8")).toBe(broken);
    expect(await readFile(modelsPath, "utf8")).toBe(USER_MODELS);
    expect((await client.apiEndpointList("omp")).agents?.omp).toMatchObject({ enabled: false });
  });
});
