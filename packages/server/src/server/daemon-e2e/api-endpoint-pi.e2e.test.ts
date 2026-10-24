import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { AGENT_PROVIDER_DEFINITIONS } from "@getpaseo/protocol/provider-manifest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestAgentClient, createTestAgentClients } from "../test-utils/fake-agent-client.js";

type EndpointSave = Parameters<DaemonClient["apiEndpointSave"]>[0];
type ApiEndpointOptions = NonNullable<Parameters<typeof createTestPaseoDaemon>[0]>["apiEndpoints"];

// 用到的只有 Claude Code、Codex（假的）与 Pi（假的客户端）；别的内置提供方关掉，快照不去起它们的 CLI。
const USED_PROVIDERS = new Set(["claude", "codex", "pi"]);
const OTHER_PROVIDERS_OFF = Object.fromEntries(
  AGENT_PROVIDER_DEFINITIONS.filter((definition) => !USED_PROVIDERS.has(definition.id)).map(
    (definition) => [definition.id, { enabled: false }],
  ),
);

/*
 * Pi 的「使用第三方接口」（任务 10-16-pi-omp-endpoints 工单 02）：真实 daemon，Pi 的 agent 目录是临时目录
 * （PI_CODING_AGENT_DIR）。打开、改默认模型、关掉，检查 models.json 与 settings.json 的内容；
 * 从不运行真的 Pi，也不碰 ~/.pi。
 */

// Pi 自己写的 models.json 带注释（Pi 读时去掉），用户另有一家服务商。
const USER_MODELS = `{
  // my local ollama
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [{ "id": "llama3" }]
    }
  }
}
`;

const USER_SETTINGS = `{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-5",
  "theme": "dark",
  "packages": ["npm:pi-mcp-adapter"]
}
`;

// 价格表里的价（每百万 token 美元）：gpt-5 与 Claude Opus 5.5。
const CLAUDE_COST = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

const tempRoots: string[] = [];

async function connect(daemon: TestPaseoDaemon): Promise<DaemonClient> {
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  return client;
}

/** 去掉 // 注释再按 JSON 读（Pi 读 models.json 也这样）。 */
function readJsonc(text: string): Record<string, unknown> {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
}

describe("Pi API endpoints over the daemon RPC", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let root: string;
  let piDir: string;
  let modelsPath: string;
  let settingsPath: string;
  // 守卫：PATH 最前面放会留下记号并失败的 pi 与 omp，真的 CLI 被起就能看出来。
  let guardDir: string;
  let guardMark: string;
  let pathBefore: string | undefined;

  beforeAll(async () => {
    guardDir = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-pi-guard-"));
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
      agentClients: { ...createTestAgentClients(), pi: createTestAgentClient("pi") },
      providerOverrides: OTHER_PROVIDERS_OFF,
      apiEndpoints: {
        env: {
          PI_CODING_AGENT_DIR: piDir,
          CLAUDE_CONFIG_DIR: path.join(root, "claude"),
          CODEX_HOME: path.join(root, "codex"),
        },
        homeDir: root,
        ...extra,
      },
    });
    client = await connect(daemon);
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-pi-"));
    tempRoots.push(root);
    piDir = path.join(root, "pi-agent");
    modelsPath = path.join(piDir, "models.json");
    settingsPath = path.join(piDir, "settings.json");
    await mkdir(piDir, { recursive: true });
    await writeFile(modelsPath, USER_MODELS);
    await writeFile(settingsPath, USER_SETTINGS);
    await startDaemon();
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    await expect(stat(guardMark)).rejects.toMatchObject({ code: "ENOENT" });
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  function gatewayRoot(): string {
    return `http://127.0.0.1:${daemon.port}/api-endpoint-gateway`;
  }

  async function piToken(): Promise<string | undefined> {
    const text = await readFile(
      path.join(daemon.paseoHome, "api-endpoints", "gateway-tokens.json"),
      "utf8",
    );
    return (JSON.parse(text) as { tokens: Record<string, string> }).tokens.pi;
  }

  /** 一家接口，三种格式的地址都有：GPT 走 Responses、Claude 走 Anthropic、别的留在 Chat。 */
  async function createEndpoint(extra: Partial<EndpointSave> = {}): Promise<string> {
    const saved = await client.apiEndpointSave({
      provider: "pi",
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

  async function settingsJson(): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
  }

  async function osunaModelIds(): Promise<string[]> {
    const providers = readJsonc(await readFile(modelsPath, "utf8")).providers as Record<
      string,
      { models: { id: string; name: string }[] }
    >;
    return providers.osuna?.models.map((model) => `${model.id} ${model.name}`) ?? [];
  }

  test("turning the switch on adds Osuna's provider and default, and turning it off puts both files back", async () => {
    await createEndpoint();
    const on = await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    expect(on.error).toBeNull();
    expect(on.agent).toMatchObject({ enabled: true, defaultModelId: "glm-5" });

    const token = await piToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const modelsText = await readFile(modelsPath, "utf8");
    expect(modelsText).toContain("// my local ollama");
    const providers = readJsonc(modelsText).providers as Record<string, unknown>;
    expect(Object.keys(providers)).toEqual(["ollama", "osuna"]);
    expect(providers.osuna).toEqual({
      baseUrl: `${gatewayRoot()}/v1`,
      api: "openai-completions",
      apiKey: token,
      compat: { sendSessionAffinityHeaders: true },
      models: [
        { id: "glm-5", name: "glm-5", reasoning: false },
        {
          id: "gpt-5",
          name: "gpt-5",
          reasoning: false,
          api: "openai-responses",
          cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
          promptCache: { short: 300 },
        },
        // 光秃秃的 Claude 留在 Chat：中转站按接住它的那家翻译。
        {
          id: "claude-opus-5-5",
          name: "claude-opus-5-5",
          reasoning: false,
          cost: CLAUDE_COST,
        },
        { id: "relay/glm-5", name: "glm-5 (Relay)", reasoning: false },
        {
          id: "relay/gpt-5",
          name: "gpt-5 (Relay)",
          reasoning: false,
          api: "openai-responses",
          cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
          promptCache: { short: 300 },
        },
        {
          id: "relay/claude-opus-5-5",
          name: "claude-opus-5-5 (Relay)",
          reasoning: false,
          api: "anthropic-messages",
          baseUrl: gatewayRoot(),
          compat: { forceAdaptiveThinking: true },
          cost: CLAUDE_COST,
          promptCache: { short: 300, long: 3600 },
        },
      ],
    });
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
      defaultProvider: "osuna",
      defaultModel: "glm-5",
      theme: "dark",
      packages: ["npm:pi-mcp-adapter"],
    });
    // 首次改写前两份文件各留一份完整副本。
    const backupsDir = path.join(daemon.paseoHome, "api-endpoints", "backups");
    const backups = (await readdir(backupsDir)).sort();
    expect(backups).toHaveLength(2);
    expect(backups[0]).toMatch(/^pi-models\./);
    expect(await readFile(path.join(backupsDir, backups[0]!), "utf8")).toBe(USER_MODELS);
    expect(await readFile(path.join(backupsDir, backups[1]!), "utf8")).toBe(USER_SETTINGS);
    expect((await client.apiEndpointList("pi")).agentIssues?.pi).toEqual([]);

    const off = await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: false });
    expect(off.error).toBeNull();
    expect(await readFile(modelsPath, "utf8")).toBe(USER_MODELS);
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
    // 口令关掉不作废。
    expect(await piToken()).toBe(token);
  });

  test("changing the default model rewrites settings.json, and turning on again brings it back", async () => {
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    const changed = await client.apiEndpointSetAgentSettings({
      provider: "pi",
      enabled: true,
      defaultModelId: "relay/claude-opus-5-5",
    });
    expect(changed.error).toBeNull();
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
      defaultProvider: "osuna",
      defaultModel: "relay/claude-opus-5-5",
    });

    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: false });
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
    const again = await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    expect(again.agent).toMatchObject({ defaultModelId: "relay/claude-opus-5-5" });
    expect(again.connection).toMatchObject({ how: "again", model: "relay/claude-opus-5-5" });
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
      defaultModel: "relay/claude-opus-5-5",
    });
  });

  test("new Pi chats in Osuna pick from Osuna's models as Pi names them, with the levels Pi offers", async () => {
    await createEndpoint({ modelSettings: { models: { "glm-5": { efforts: ["low", "high"] } } } });
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    async function piChoices(): Promise<{ models: string[]; groups: string[] } | null> {
      const snapshot = await client.getProvidersSnapshot();
      const entry = snapshot.entries.find((candidate) => candidate.provider === "pi");
      const groups = entry?.apiEndpointModelGroups;
      if (!groups || !entry.models) return null;
      const describeModel = (model: {
        id: string;
        isDefault?: boolean;
        thinkingOptions?: { id: string }[];
        defaultThinkingOptionId?: string;
      }) => {
        const levels = model.thinkingOptions?.map((option) => option.id).join(",");
        const thinking = levels ? ` [${levels}] from ${model.defaultThinkingOptionId}` : "";
        return `${model.id}${model.isDefault ? " (default)" : ""}${thinking}`;
      };
      return {
        models: entry.models.map(describeModel),
        groups: groups.flatMap((group) => group.models.map(describeModel)),
      };
    }
    // 没记住上次选择的新对话用默认模型；起步档位没设时是 Pi 的 medium 贴合到模型有的一档。
    // 模型没有 none，Pi 的 off 映射成 null，不给选；不会思考的模型 Pi 只给 off（magpie piSupported）。
    await expect.poll(piChoices, { timeout: 10_000 }).toEqual({
      models: [
        "osuna/glm-5 (default) [low,high] from high",
        "osuna/gpt-5 [off] from off",
        "osuna/claude-opus-5-5 [off] from off",
      ],
      groups: [
        // 光秃秃的默认模型在分组里标在提供它的第一家上。
        "osuna/relay/glm-5 (default) [low,high] from high",
        "osuna/relay/gpt-5 [off] from off",
        "osuna/relay/claude-opus-5-5 [off] from off",
      ],
    });
  });

  test("the default thinking is written only when set, and put back when the switch goes off", async () => {
    await writeFile(
      settingsPath,
      USER_SETTINGS.replace('"theme": "dark"', '"defaultThinkingLevel": "low",\n  "theme": "dark"'),
    );
    const before = await readFile(settingsPath, "utf8");
    await createEndpoint({ modelSettings: { models: { "glm-5": { efforts: ["low", "high"] } } } });
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    // 没设：用户自己的档位跟过来，文件不改。
    expect(await settingsJson()).toMatchObject({ defaultThinkingLevel: "low" });

    const set = await client.apiEndpointSetAgentSettings({
      provider: "pi",
      enabled: true,
      defaultThinkingOptionId: "high",
    });
    expect(set.error).toBeNull();
    expect(set.agent).toMatchObject({ defaultThinkingOptionId: "high" });
    expect(await settingsJson()).toMatchObject({ defaultThinkingLevel: "high" });
    const refused = await client.apiEndpointSetAgentSettings({
      provider: "pi",
      enabled: true,
      defaultThinkingOptionId: "ultra",
    });
    expect(refused.error).toMatchObject({ code: "invalid_input" });

    // Pi 里改了档位：跟过去。
    const text = await readFile(settingsPath, "utf8");
    await writeFile(
      settingsPath,
      text.replace('"defaultThinkingLevel": "high"', '"defaultThinkingLevel": "minimal"'),
    );
    const listed = await client.apiEndpointList("pi");
    // minimal 这个模型没有：照 Pi 显示成它跑的那一档。
    expect(listed.agents?.pi).toMatchObject({ defaultThinkingOptionId: "low" });
    expect(listed.health).toEqual([]);

    await client.apiEndpointSetAgentSettings({
      provider: "pi",
      enabled: true,
      defaultThinkingOptionId: "high",
    });
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: false });
    expect(await readFile(settingsPath, "utf8")).toBe(before);
  });

  test("an existing enabledModels list gets the default first, follows it, and is put back", async () => {
    const scoped = USER_SETTINGS.replace(
      '"theme": "dark"',
      '"enabledModels": ["anthropic/claude-sonnet-4-5", "openai/gpt-5"],\n  "theme": "dark"',
    );
    await writeFile(settingsPath, scoped);
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    expect((await settingsJson()).enabledModels).toEqual([
      "osuna/glm-5",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-5",
    ]);
    await client.apiEndpointSetAgentSettings({
      provider: "pi",
      enabled: true,
      defaultModelId: "relay/gpt-5",
    });
    expect((await settingsJson()).enabledModels).toEqual([
      "osuna/relay/gpt-5",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-5",
    ]);
    const preview = await client.apiEndpointPreviewSwitchOff("pi");
    expect(JSON.stringify(preview.preview?.files[0]?.lines)).toContain("osuna/relay/gpt-5");

    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: false });
    expect(await readFile(settingsPath, "utf8")).toBe(scoped);
  });

  test("no enabledModels list is made when there is none", async () => {
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    expect(await settingsJson()).not.toHaveProperty("enabledModels");
  });

  test("another of Osuna's models saved as the default in Pi becomes Osuna's default model", async () => {
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    const text = await readFile(settingsPath, "utf8");
    await writeFile(
      settingsPath,
      text.replace('"defaultModel": "glm-5"', '"defaultModel": "relay/gpt-5"'),
    );

    const listed = await client.apiEndpointList("pi");
    expect(listed.agents?.pi).toMatchObject({ defaultModelId: "relay/gpt-5" });
    expect(listed.agentIssues?.pi).toEqual([]);
    expect(listed.health).toEqual([]);
    expect(await settingsJson()).toMatchObject({
      defaultProvider: "osuna",
      defaultModel: "relay/gpt-5",
    });
  });

  test("a model outside Osuna saved in Pi is reported as replaced, like Claude Code and Codex", async () => {
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    const text = await readFile(settingsPath, "utf8");
    const replaced = text
      .replace('"defaultProvider": "osuna"', '"defaultProvider": "openai"')
      .replace('"defaultModel": "glm-5"', '"defaultModel": "gpt-6"');
    await writeFile(settingsPath, replaced);

    const listed = await client.apiEndpointList("pi");
    expect(listed.agentIssues?.pi).toEqual([
      {
        code: "model_replaced",
        params: { file: settingsPath, model: "openai/gpt-6", defaultModel: "glm-5" },
        message: expect.stringContaining("Pi's model was changed to openai/gpt-6"),
      },
    ]);
    expect(listed.agents?.pi).toMatchObject({ defaultModelId: "glm-5" });

    const kept = await client.apiEndpointKeepCurrentSettings({
      provider: "pi",
      code: "model_replaced",
    });
    expect(kept.error).toBeNull();
    expect((await client.apiEndpointList("pi")).agentIssues?.pi).toEqual([]);
    // 之后的重写不碰 Pi 自己的默认模型。
    await client.apiEndpointSetAgentSettings({
      provider: "pi",
      enabled: true,
      defaultThinkingOptionId: "high",
    });
    expect(await settingsJson()).toMatchObject({
      defaultProvider: "openai",
      defaultModel: "gpt-6",
    });

    // 重新应用写回默认模型。
    const reapplied = await client.apiEndpointSetAgentSettings({
      provider: "pi",
      enabled: true,
      reapply: true,
    });
    expect(reapplied.error).toBeNull();
    expect(await settingsJson()).toMatchObject({ defaultProvider: "osuna", defaultModel: "glm-5" });
  });

  test("Osuna's provider pointed elsewhere reads as no longer going through the gateway", async () => {
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    const text = await readFile(modelsPath, "utf8");
    await writeFile(
      modelsPath,
      text.replace(`${gatewayRoot()}/v1`, "https://other-tool.example/v1"),
    );

    expect((await client.apiEndpointList("pi")).agentIssues?.pi).toEqual([
      {
        code: "not_through_gateway",
        params: { file: modelsPath, keys: "providers.osuna" },
        message: expect.stringContaining("Pi no longer goes through the gateway"),
      },
    ]);
  });

  test("the model list in models.json follows the endpoints, selected models and name display", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    const saved = await client.apiEndpointSave({
      provider: "pi",
      endpointId,
      name: "Relay",
      baseUrls: [{ format: "openai_chat", url: "https://relay.example/v1" }],
      models: [{ id: "glm-5" }, { id: "kimi-k3" }],
    });
    expect(saved.error).toBeNull();
    expect(await osunaModelIds()).toEqual([
      "glm-5 glm-5",
      "kimi-k3 kimi-k3",
      "relay/glm-5 glm-5 (Relay)",
      "relay/kimi-k3 kimi-k3 (Relay)",
    ]);
    expect((await client.apiEndpointSetEndpointNameDisplay({ display: "never" })).error).toBeNull();
    expect(await osunaModelIds()).toEqual([
      "glm-5 glm-5",
      "kimi-k3 kimi-k3",
      "relay/glm-5 glm-5",
      "relay/kimi-k3 kimi-k3",
    ]);
  });

  test("a model its vendor says is retired leaves the model list in models.json", async () => {
    // 本机假上游：glm-5 回 410 已下线（magpie retired_test.go 的 zenDeprecated）。
    const upstream = createServer((_request, res) => {
      res.writeHead(410, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          type: "error",
          error: { type: "ModelDeprecated", message: "Model glm-5 has been deprecated." },
          metadata: { model: "glm-5" },
        }),
      );
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    try {
      const address = upstream.address();
      if (address === null || typeof address === "string") throw new Error("Expected a port");
      await createEndpoint({
        baseUrls: [{ format: "openai_chat", url: `http://127.0.0.1:${address.port}/v1` }],
        models: [{ id: "glm-5" }, { id: "kimi-k3" }],
      });
      await client.apiEndpointSetAgentSettings({
        provider: "pi",
        enabled: true,
        defaultModelId: "kimi-k3",
      });
      const response = await fetch(`${gatewayRoot()}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${(await piToken()) ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "glm-5", messages: [{ role: "user", content: "hi" }] }),
      });
      expect(response.status).toBe(410);
      await expect
        .poll(osunaModelIds, { timeout: 10_000 })
        .toEqual(["kimi-k3 kimi-k3", "relay/kimi-k3 kimi-k3 (Relay)"]);
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  test("the default model no longer served moves to another one, as for the other agents", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetAgentSettings({
      provider: "pi",
      enabled: true,
      defaultModelId: "relay/gpt-5",
    });
    await client.apiEndpointSave({
      provider: "pi",
      endpointId,
      name: "Relay",
      baseUrls: [{ format: "openai_chat", url: "https://relay.example/v1" }],
      models: [{ id: "glm-5" }],
    });
    const listed = await client.apiEndpointList("pi");
    const moved = listed.agents?.pi?.defaultModelId;
    expect(moved).not.toBe("relay/gpt-5");
    expect(await settingsJson()).toMatchObject({ defaultModel: moved });
  });

  test("a rewrite lists the Pi agents open in Osuna to reopen", async () => {
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    await client.createAgent({ provider: "pi", cwd: root, title: "Pi agent" });
    // 文件的修改时刻按毫秒，让改写确实晚于会话起来。
    await new Promise((resolve) => setTimeout(resolve, 20));
    await client.apiEndpointSetAgentSettings({
      provider: "pi",
      enabled: true,
      defaultModelId: "relay/gpt-5",
    });
    expect((await client.apiEndpointList("pi")).reopenHints?.pi).toEqual([
      {
        kind: "osuna_sessions",
        count: 1,
        message: "1 Pi agent(s) in Osuna: reload each one (Reload agent in its tab's menu).",
      },
    ]);
  });

  test("a model setting change rewrites the model list in models.json", async () => {
    const endpointId = await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    const saved = await client.apiEndpointSave({
      provider: "pi",
      endpointId,
      name: "Relay",
      baseUrls: [{ format: "openai_chat", url: "https://relay.example/v1" }],
      models: [{ id: "glm-5" }],
      modelSettings: { models: { "glm-5": { name: "GLM Five", efforts: ["low", "high"] } } },
    });
    expect(saved.error).toBeNull();
    const providers = readJsonc(await readFile(modelsPath, "utf8")).providers as Record<
      string,
      { models: Record<string, unknown>[] }
    >;
    expect(providers.osuna?.models[0]).toMatchObject({
      id: "glm-5",
      name: "GLM Five",
      reasoning: true,
      thinkingLevelMap: { low: "low", high: "high", medium: null },
    });
  });

  test("updated models.dev facts rewrite the model list in models.json", async () => {
    await client.close();
    await daemon.close();
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
    const modelsDevFetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          relay: {
            models: {
              "kimi-k3": {
                limit: { context: 400_000, output: 64_000 },
                reasoning_options: [{ type: "effort", values: ["low", "high"] }],
              },
            },
          },
        }),
        { status: 200 },
      );
    await startDaemon({ isModelsDevAutoUpdate: () => true, modelsDevFetch, modelsDevTimers });
    await createEndpoint({ models: [{ id: "kimi-k3" }] });
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    expect(await kimiFacts()).toEqual({ contextWindow: undefined, reasoning: false });

    const check = pending as (() => void) | null;
    if (!check) throw new Error("Expected a scheduled models.dev check");
    check();

    await expect
      .poll(kimiFacts, { timeout: 10_000 })
      .toEqual({ contextWindow: 400_000, reasoning: true });

    async function kimiFacts() {
      const providers = readJsonc(await readFile(modelsPath, "utf8")).providers as Record<
        string,
        { models: { id: string; contextWindow?: number; reasoning: boolean }[] }
      >;
      const kimi = providers.osuna?.models.find((model) => model.id === "kimi-k3");
      return { contextWindow: kimi?.contextWindow, reasoning: kimi?.reasoning };
    }
  });

  test("the switch-off preview lists Pi's default provider and model and Osuna's provider", async () => {
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    const before = [await readFile(modelsPath, "utf8"), await readFile(settingsPath, "utf8")];

    const previewed = await client.apiEndpointPreviewSwitchOff("pi");

    expect(previewed.error).toBeNull();
    const files = previewed.preview?.files ?? [];
    expect(files.map((file) => [file.path, file.change])).toEqual([
      ["~/pi-agent/settings.json", "edited"],
      ["~/pi-agent/models.json", "edited"],
    ]);
    expect(files[0]?.lines).toEqual([
      {
        op: "restored",
        text: '  "defaultProvider": "anthropic",',
        was: '  "defaultProvider": "osuna",',
      },
      {
        op: "restored",
        text: '  "defaultModel": "claude-sonnet-4-5",',
        was: '  "defaultModel": "glm-5",',
      },
    ]);
    expect(files[1]?.lines[0]).toEqual({ op: "removed", text: '    "osuna": {' });
    // 中转站口令遮住。
    expect(JSON.stringify(files)).not.toContain((await piToken()) ?? "no token");
    expect([await readFile(modelsPath, "utf8"), await readFile(settingsPath, "utf8")]).toEqual(
      before,
    );
  });

  test("a default the user moved to another provider in Pi while the switch was on stays after it goes off", async () => {
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    const text = await readFile(settingsPath, "utf8");
    await writeFile(
      settingsPath,
      text
        .replace('"defaultProvider": "osuna"', '"defaultProvider": "openai"')
        .replace('"defaultModel": "glm-5"', '"defaultModel": "gpt-5"'),
    );

    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: false });

    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
      defaultProvider: "openai",
      defaultModel: "gpt-5",
      theme: "dark",
      packages: ["npm:pi-mcp-adapter"],
    });
  });

  test("another of Osuna's models picked in Pi goes back to the user's own default with its provider", async () => {
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    const text = await readFile(settingsPath, "utf8");
    await writeFile(
      settingsPath,
      text.replace('"defaultModel": "glm-5"', '"defaultModel": "relay/gpt-5"'),
    );

    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: false });

    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
  });

  test("Pi files that did not exist are created and removed again", async () => {
    await rm(piDir, { recursive: true });
    await createEndpoint();
    expect(
      (await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true })).error,
    ).toBeNull();
    expect(readJsonc(await readFile(modelsPath, "utf8"))).toHaveProperty("providers.osuna");
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: false });
    await expect(stat(modelsPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(settingsPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("a models.json that does not parse is named and neither file is written", async () => {
    await createEndpoint();
    const broken = '{\n  "providers": {\n    "ollama": {}\n    "x": 1\n  }\n}\n';
    await writeFile(modelsPath, broken);

    const on = await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });

    expect(on.error).toMatchObject({
      code: "config_unparsable",
      params: { file: modelsPath, reason: "syntax" },
    });
    expect(await readFile(modelsPath, "utf8")).toBe(broken);
    expect(await readFile(settingsPath, "utf8")).toBe(USER_SETTINGS);
    expect((await client.apiEndpointList("pi")).agents?.pi).toMatchObject({ enabled: false });
  });

  test("a settings.json that does not parse leaves models.json as it was", async () => {
    await createEndpoint();
    await writeFile(settingsPath, '{ "theme": "dark", }x');

    const on = await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });

    expect(on.error).toMatchObject({ code: "config_unparsable", params: { file: settingsPath } });
    expect(await readFile(modelsPath, "utf8")).toBe(USER_MODELS);
  });

  test("turning on needs an endpoint that is on with a model selected", async () => {
    const on = await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    expect(on.error).toMatchObject({ code: "no_usable_model" });
    expect(await readFile(modelsPath, "utf8")).toBe(USER_MODELS);
  });
});
