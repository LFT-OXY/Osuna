import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * 从别的软件导入（工单 26，prd 第 39–41 条）：真实 daemon，临时 HOME 里放五种来源的假配置，
 * 绝不读真实的 ~/.claude、~/.codex、~/.cc-switch、Alma、OpenCode。
 */

const tempRoots: string[] = [];
const daemons: TestPaseoDaemon[] = [];
const clients: DaemonClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const daemon of daemons.splice(0)) await daemon.close();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface Sources {
  root: string;
  claudeSettings: string;
  codexConfig: string;
  ccSwitchDb: string;
  almaDb: string;
  openCodeAuth: string;
}

function sourcePaths(root: string): Sources {
  return {
    root,
    claudeSettings: path.join(root, "claude", "settings.json"),
    codexConfig: path.join(root, "codex", "config.toml"),
    ccSwitchDb: path.join(root, "cc-switch", "cc-switch.db"),
    almaDb: path.join(root, "alma", "chat_threads.db"),
    openCodeAuth: path.join(root, "opencode", "auth.json"),
  };
}

async function writeCcSwitch(file: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT,
    website_url TEXT, category TEXT, sort_index INTEGER, created_at INTEGER)`);
  const insert = db.prepare("INSERT INTO providers VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)");
  // 同一个中转服务给 Claude Code 和 Codex 各配了一条：合成一家、两个格式的地址。
  insert.run(
    "p1",
    "claude",
    "CC Relay",
    JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: "https://cc-relay.example/api",
        ANTHROPIC_AUTH_TOKEN: "sk-cc-relay-1111",
        ANTHROPIC_MODEL: "cc-sonnet",
      },
    }),
    0,
    1,
  );
  insert.run(
    "p2",
    "codex",
    "CC Relay",
    JSON.stringify({
      auth: { OPENAI_API_KEY: "sk-cc-relay-1111" },
      config:
        'model_provider = "ccr"\nmodel = "cc-gpt"\n[model_providers.ccr]\nbase_url = "https://cc-relay.example/v1"\nwire_api = "responses"\n',
    }),
    0,
    2,
  );
  // CLI 自己的登录：读不了。
  insert.run("p3", "claude", "Official", JSON.stringify({ env: {} }), 1, 3);
  db.close();
}

async function writeAlma(file: string, name: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE providers (id TEXT, name TEXT, type TEXT, api_key TEXT, models TEXT,
    base_url TEXT, enabled INTEGER, api_format TEXT, is_response_api INTEGER, custom_headers TEXT,
    created_at INTEGER)`);
  db.prepare("INSERT INTO providers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "a1",
    name,
    "openai-compatible",
    "sk-alma-4444",
    JSON.stringify(["alma-model"]),
    "https://alma.example/v1",
    0,
    "",
    0,
    JSON.stringify({ "X-Team": "osuna" }),
    1,
  );
  db.close();
}

async function writeSources(sources: Sources, input: { almaName: string }): Promise<void> {
  await writeCcSwitch(sources.ccSwitchDb);
  await writeAlma(sources.almaDb, input.almaName);
  await mkdir(path.dirname(sources.claudeSettings), { recursive: true });
  await writeFile(
    sources.claudeSettings,
    JSON.stringify({
      env: { ANTHROPIC_BASE_URL: "https://hand.example", ANTHROPIC_AUTH_TOKEN: "sk-hand-2222" },
    }),
  );
  await mkdir(path.dirname(sources.codexConfig), { recursive: true });
  await writeFile(
    sources.codexConfig,
    [
      'model_provider = "myrelay"',
      'model = "relay-gpt"',
      "[model_providers.myrelay]",
      'name = "My Relay"',
      'base_url = "https://codex-relay.example/v1"',
      'experimental_bearer_token = "sk-codex-3333"',
      'wire_api = "responses"',
      "",
    ].join("\n"),
  );
  await mkdir(path.dirname(sources.openCodeAuth), { recursive: true });
  await writeFile(
    sources.openCodeAuth,
    JSON.stringify({
      deepseek: { type: "api", key: "sk-ds-5555" },
      anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1 },
    }),
  );
}

function storedEndpoint(input: { id: string; name: string; url: string }) {
  return {
    id: input.id,
    slug: input.id,
    name: input.name,
    baseUrls: [{ format: "anthropic_messages", url: input.url }],
    models: [{ id: "model-a" }],
    enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

async function start(input: {
  endpoints: ReturnType<typeof storedEndpoint>[];
  keys: Record<string, string>;
  almaName?: string;
}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-api-endpoint-import-"));
  tempRoots.push(root);
  const sources = sourcePaths(root);
  await writeSources(sources, { almaName: input.almaName ?? "Alma Relay" });
  const endpointsDir = path.join(root, ".paseo", "api-endpoints");
  await mkdir(endpointsDir, { recursive: true });
  await writeFile(
    path.join(endpointsDir, "endpoints.json"),
    JSON.stringify({ endpoints: input.endpoints, agents: {} }),
  );
  await writeFile(path.join(endpointsDir, "keys.json"), JSON.stringify({ keys: input.keys }));
  const daemon = await createTestPaseoDaemon({
    paseoHomeRoot: root,
    cleanup: false,
    apiEndpoints: {
      env: {
        CLAUDE_CONFIG_DIR: path.dirname(sources.claudeSettings),
        CODEX_HOME: path.dirname(sources.codexConfig),
      },
      homeDir: root,
      importSourcePaths: {
        ccSwitchDir: path.dirname(sources.ccSwitchDb),
        almaDatabase: sources.almaDb,
        openCodeAuth: sources.openCodeAuth,
      },
    },
  });
  daemons.push(daemon);
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.17.0",
  });
  clients.push(client);
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  return { client, daemon, sources };
}

/** 五个来源文件的修改时间，与它们所在目录里有哪些文件（SQLite 读时不该留下新文件）。 */
async function sourceSnapshot(
  sources: Sources,
): Promise<{ times: number[]; listings: string[][] }> {
  const files = [
    sources.claudeSettings,
    sources.codexConfig,
    sources.ccSwitchDb,
    sources.almaDb,
    sources.openCodeAuth,
  ];
  const times = await Promise.all(files.map(async (file) => (await stat(file)).mtimeMs));
  const listings = await Promise.all(
    files.map(async (file) => (await readdir(path.dirname(file))).sort()),
  );
  return { times, listings };
}

type ScanPayload = Awaited<ReturnType<DaemonClient["apiEndpointImportScan"]>>;

function itemsOf(scan: ScanPayload, sourceId: string) {
  return scan.sources.find((source) => source.id === sourceId)?.items ?? [];
}

describe("import from other apps", () => {
  test("reads all five sources read-only and says how each entry stands", async () => {
    const { client, sources } = await start({
      endpoints: [
        storedEndpoint({ id: "ep_hand", name: "Hand", url: "https://hand.example" }),
        // 和 Codex 那条同名、同一主机、另一把 key：名称已被占用，也是同一家。
        storedEndpoint({
          id: "ep_taken",
          name: "My Relay",
          url: "https://codex-relay.example/anthropic",
        }),
        storedEndpoint({ id: "ep_other", name: "Relay One", url: "https://cc-relay.example/api" }),
      ],
      keys: { ep_hand: "sk-hand-2222", ep_taken: "sk-elsewhere", ep_other: "sk-another-key" },
    });
    const before = await sourceSnapshot(sources);

    // 打开接口页时的扫描不碰 OpenCode。
    const discovery = await client.apiEndpointImportScan();
    expect(discovery.error).toBeNull();
    expect(discovery.sources.map((source) => source.id)).toEqual([
      "alma",
      "cc-switch",
      "claude-code",
      "codex",
    ]);

    const scan = await client.apiEndpointImportScan({ includeOpenCode: true });
    expect(scan.error).toBeNull();
    expect(scan.sources.map((source) => [source.id, source.found, source.error])).toEqual([
      ["alma", true, null],
      ["cc-switch", true, null],
      ["claude-code", true, null],
      ["codex", true, null],
      ["opencode", true, null],
    ]);
    expect(scan.sources.find((source) => source.id === "codex")?.path).toBe(
      path.join("~", "codex", "config.toml"),
    );
    // 读的是数据库，显示的也是它。
    expect(scan.sources.find((source) => source.id === "cc-switch")?.path).toBe(
      path.join("~", "cc-switch", "cc-switch.db"),
    );

    expect(itemsOf(scan, "alma")).toMatchObject([
      {
        name: "Alma Relay",
        baseUrls: [{ format: "openai_chat", url: "https://alma.example/v1" }],
        maskedKey: "sk-a…4444",
        models: ["alma-model"],
        status: "new",
        off: "turned_off",
        skip: null,
      },
    ]);
    expect(itemsOf(scan, "cc-switch")).toMatchObject([
      {
        name: "CC Relay",
        from: "Claude Code, Codex",
        baseUrls: [
          { format: "anthropic_messages", url: "https://cc-relay.example/api" },
          { format: "openai_responses", url: "https://cc-relay.example/v1" },
        ],
        models: ["cc-sonnet", "cc-gpt"],
        status: "other_key",
        existingEndpointId: "ep_other",
        existingName: "Relay One",
      },
      { name: "Official", skip: "sign_in", status: "new" },
    ]);
    expect(itemsOf(scan, "claude-code")).toMatchObject([
      { name: "hand.example", status: "added", existingEndpointId: "ep_hand" },
    ]);
    expect(itemsOf(scan, "codex")).toMatchObject([
      {
        name: "My Relay",
        baseUrls: [{ format: "openai_responses", url: "https://codex-relay.example/v1" }],
        models: ["relay-gpt"],
        status: "name_taken",
        existingEndpointId: "ep_taken",
        otherKeyName: "My Relay",
      },
    ]);
    // 读不了的排在后面。
    expect(itemsOf(scan, "opencode")).toMatchObject([
      { ref: "deepseek", name: "DeepSeek", templateId: "deepseek", status: "new", skip: null },
      { ref: "anthropic", skip: "sign_in" },
    ]);

    // key 原文不出 daemon。
    const text = JSON.stringify(scan);
    for (const key of [
      "sk-cc-relay-1111",
      "sk-hand-2222",
      "sk-codex-3333",
      "sk-alma-4444",
      "sk-ds-5555",
    ]) {
      expect(text).not.toContain(key);
    }
    expect(await sourceSnapshot(sources)).toEqual(before);
  });

  test("while Osuna has taken over Claude Code, the scan reads the original values, not the gateway", async () => {
    const { client, sources } = await start({ endpoints: [], keys: {} });
    const saved = await client.apiEndpointSave({
      provider: "claude",
      name: "Saved",
      baseUrl: "https://saved.example/api",
      apiKey: "sk-saved-9999",
      models: [{ id: "saved-model" }],
      defaultModelId: "saved-model",
    });
    if (!saved.endpoint) throw new Error("Expected a saved endpoint");
    const activated = await client.apiEndpointSetActive("claude", saved.endpoint.id);
    expect(activated.error).toBeNull();
    const settings = JSON.parse(await readFile(sources.claudeSettings, "utf8"));
    expect(settings.env.ANTHROPIC_BASE_URL).toContain("/api-endpoint-gateway");

    const scan = await client.apiEndpointImportScan();
    const items = itemsOf(scan, "claude-code");
    expect(items).toMatchObject([
      {
        name: "hand.example",
        baseUrls: [{ format: "anthropic_messages", url: "https://hand.example" }],
        maskedKey: "sk-h…2222",
        status: "new",
        skip: null,
      },
    ]);
    expect(JSON.stringify(scan)).not.toContain("127.0.0.1");
  });

  test("add, replace and rename: a replaced endpoint keeps its id and its place in the order", async () => {
    const { client } = await start({
      endpoints: [
        storedEndpoint({ id: "ep_first", name: "First", url: "https://first.example" }),
        storedEndpoint({ id: "ep_taken", name: "My Relay", url: "https://elsewhere.example" }),
        storedEndpoint({ id: "ep_other", name: "Relay One", url: "https://cc-relay.example/api" }),
      ],
      keys: { ep_first: "sk-first", ep_taken: "sk-elsewhere", ep_other: "sk-another-key" },
      almaName: "First",
    });
    const scan = await client.apiEndpointImportScan();
    const ccRelay = itemsOf(scan, "cc-switch")[0];
    const codex = itemsOf(scan, "codex")[0];
    const alma = itemsOf(scan, "alma")[0];
    if (!ccRelay || !codex || !alma) throw new Error("Expected three entries");
    expect([ccRelay.status, codex.status, alma.status]).toEqual([
      "other_key",
      "name_taken",
      "name_taken",
    ]);

    // 只有名称撞上的能替换。
    const notTaken = await client.apiEndpointImport([
      { fingerprint: ccRelay.fingerprint, action: "replace" },
    ]);
    expect(notTaken.error).toMatchObject({ code: "import_cannot_replace" });
    const gone = await client.apiEndpointImport([{ fingerprint: "nope", action: "add" }]);
    expect(gone.error).toMatchObject({ code: "import_gone" });

    const result = await client.apiEndpointImport([
      { fingerprint: ccRelay.fingerprint, action: "add" },
      { fingerprint: codex.fingerprint, action: "replace" },
      { fingerprint: alma.fingerprint, action: "rename", name: "Alma Relay" },
    ]);
    expect(result.error).toBeNull();
    expect(result.imported.map((entry) => entry.name)).toEqual([
      "CC Relay",
      "My Relay",
      "Alma Relay",
    ]);

    const listed = await client.apiEndpointList("claude");
    expect(listed.endpoints.map((endpoint) => [endpoint.id, endpoint.name])).toEqual([
      ["ep_first", "First"],
      ["ep_taken", "My Relay"],
      ["ep_other", "Relay One"],
      [result.imported[0]?.endpointId, "CC Relay"],
      [result.imported[2]?.endpointId, "Alma Relay"],
    ]);
    const replaced = listed.endpoints[1];
    expect(replaced?.baseUrls).toEqual([
      { format: "openai_responses", url: "https://codex-relay.example/v1" },
    ]);
    expect(replaced?.models).toEqual([{ id: "relay-gpt" }]);
    expect(replaced?.enabled).toBe(true);
    const added = listed.endpoints[3];
    expect(added?.baseUrls).toEqual([
      { format: "anthropic_messages", url: "https://cc-relay.example/api" },
      { format: "openai_responses", url: "https://cc-relay.example/v1" },
    ]);

    // key 在 daemon 里按指纹找回。
    expect((await client.apiEndpointRevealKey("ep_taken")).apiKey).toBe("sk-codex-3333");
    expect((await client.apiEndpointRevealKey(result.imported[0]?.endpointId ?? "")).apiKey).toBe(
      "sk-cc-relay-1111",
    );
    expect((await client.apiEndpointRevealKey(result.imported[2]?.endpointId ?? "")).apiKey).toBe(
      "sk-alma-4444",
    );
    // 原来那家没被动。
    expect((await client.apiEndpointRevealKey("ep_other")).apiKey).toBe("sk-another-key");

    // 再扫一遍：都是已添加。
    const again = await client.apiEndpointImportScan();
    expect(
      [itemsOf(again, "cc-switch")[0], itemsOf(again, "codex")[0], itemsOf(again, "alma")[0]].map(
        (item) => item?.status,
      ),
    ).toEqual(["added", "added", "added"]);
  });

  test("one at a time: what came in before an entry fails stays, and the reply names the failed one; an empty rename is no rename", async () => {
    const { client } = await start({
      endpoints: [
        storedEndpoint({ id: "ep_first", name: "First", url: "https://first.example" }),
        storedEndpoint({ id: "ep_taken", name: "My Relay", url: "https://elsewhere.example" }),
      ],
      keys: { ep_first: "sk-first", ep_taken: "sk-elsewhere" },
      almaName: "First",
    });
    const scan = await client.apiEndpointImportScan();
    const alma = itemsOf(scan, "alma")[0];
    const ccRelay = itemsOf(scan, "cc-switch")[0];
    const codex = itemsOf(scan, "codex")[0];
    if (!alma || !ccRelay || !codex) throw new Error("Expected three entries");

    const result = await client.apiEndpointImport([
      // 空名称当没改名：照新增，名称重了加「 2」。
      { fingerprint: alma.fingerprint, action: "rename", name: "  " },
      // CC Relay 不和谁重名，不能替换：停在这里。
      { fingerprint: ccRelay.fingerprint, action: "replace" },
      { fingerprint: codex.fingerprint, action: "replace" },
    ]);
    expect(result.imported.map((entry) => entry.name)).toEqual(["First 2"]);
    expect(result.failed).toEqual({ fingerprint: ccRelay.fingerprint, name: "CC Relay" });
    expect(result.error).toMatchObject({
      code: "import_cannot_replace",
      params: { name: "CC Relay" },
    });
    const listed = await client.apiEndpointList("claude");
    expect(listed.endpoints.map((endpoint) => endpoint.name)).toEqual([
      "First",
      "My Relay",
      "First 2",
    ]);
    // 出错之后的那条没动。
    expect((await client.apiEndpointRevealKey("ep_taken")).apiKey).toBe("sk-elsewhere");
  });
});
