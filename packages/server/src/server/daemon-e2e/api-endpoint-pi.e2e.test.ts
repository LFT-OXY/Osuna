import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

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

describe.skipIf(process.platform === "win32")("Pi API endpoints over the daemon RPC", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let piDir: string;
  let modelsPath: string;
  let settingsPath: string;

  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-pi-"));
    tempRoots.push(root);
    piDir = path.join(root, "pi-agent");
    modelsPath = path.join(piDir, "models.json");
    settingsPath = path.join(piDir, "settings.json");
    await mkdir(piDir, { recursive: true });
    await writeFile(modelsPath, USER_MODELS);
    await writeFile(settingsPath, USER_SETTINGS);
    daemon = await createTestPaseoDaemon({
      apiEndpoints: {
        env: {
          PI_CODING_AGENT_DIR: piDir,
          CLAUDE_CONFIG_DIR: path.join(root, "claude"),
          CODEX_HOME: path.join(root, "codex"),
        },
        homeDir: root,
      },
    });
    client = await connect(daemon);
  });

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
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
  async function createEndpoint(): Promise<string> {
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
    });
    expect(saved.error).toBeNull();
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    return saved.endpoint.id;
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

  test("Pi's snapshot carries the endpoint groups for its default model, with no thinking levels yet", async () => {
    await createEndpoint();
    await client.apiEndpointSetAgentSettings({ provider: "pi", enabled: true });
    async function piGroups(): Promise<string[] | null> {
      const snapshot = await client.getProvidersSnapshot();
      const entry = snapshot.entries.find((candidate) => candidate.provider === "pi");
      const groups = entry?.apiEndpointModelGroups;
      if (!groups) return null;
      const rows: string[] = [];
      for (const group of groups) {
        for (const model of group.models) {
          rows.push(`${group.name} ${model.id}${model.thinkingOptions ? " thinks" : ""}`);
        }
      }
      return rows;
    }
    await expect
      .poll(piGroups, { timeout: 10_000 })
      .toEqual(["Relay relay/glm-5", "Relay relay/gpt-5", "Relay relay/claude-opus-5-5"]);
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
