import { DatabaseSync } from "node:sqlite";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { NODE_DATA_FILE_SYSTEM, type DataFileSystem } from "../api-endpoints/last-good.js";

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
  dataFileSystem?: DataFileSystem;
  now?: () => Date;
  // 起 daemon 之前在 api-endpoints/ 里放好的文件（文件名 → 内容）。
  files?: Record<string, string>;
  logger?: pino.Logger;
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
  for (const [name, text] of Object.entries(input.files ?? {})) {
    await writeFile(path.join(endpointsDir, name), text);
  }
  return startOn({
    root,
    sources,
    dataFileSystem: input.dataFileSystem,
    now: input.now,
    logger: input.logger,
  });
}

/** 在已有的临时目录上起 daemon：重启后接着用同一份 PASEO_HOME 与来源。 */
async function startOn(input: {
  root: string;
  sources: Sources;
  dataFileSystem?: DataFileSystem;
  now?: () => Date;
  logger?: pino.Logger;
}) {
  const { root, sources } = input;
  const daemon = await createTestPaseoDaemon({
    ...(input.logger === undefined ? {} : { logger: input.logger }),
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
      ...(input.dataFileSystem === undefined ? {} : { dataFileSystem: input.dataFileSystem }),
      ...(input.now === undefined ? {} : { now: input.now }),
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
interface SourceSnapshot {
  times: number[];
  listings: string[][];
}

async function sourceSnapshot(sources: Sources): Promise<SourceSnapshot> {
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

  test("a write that fails partway stops there and still answers what came in before it; an unknown fingerprint says the scan is out of date", async () => {
    // 换上 endpoints.json 时，armed 之后第二次改名失败（像磁盘写不进去）。
    const control = { armed: false, endpointWrites: 0 };
    const dataFileSystem: DataFileSystem = {
      ...NODE_DATA_FILE_SYSTEM,
      rename(from, to) {
        if (control.armed && to.endsWith("endpoints.json")) {
          control.endpointWrites += 1;
          if (control.endpointWrites === 2) {
            throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
          }
        }
        NODE_DATA_FILE_SYSTEM.rename(from, to);
      },
    };
    const { client } = await start({ endpoints: [], keys: {}, dataFileSystem });
    const scan = await client.apiEndpointImportScan();
    const alma = itemsOf(scan, "alma")[0];
    const ccRelay = itemsOf(scan, "cc-switch")[0];
    const codex = itemsOf(scan, "codex")[0];
    if (!alma || !ccRelay || !codex) throw new Error("Expected three entries");

    control.armed = true;
    const result = await client.apiEndpointImport([
      { fingerprint: alma.fingerprint, action: "add" },
      { fingerprint: ccRelay.fingerprint, action: "add" },
      { fingerprint: codex.fingerprint, action: "add" },
    ]);
    control.armed = false;
    expect(result.imported.map((entry) => entry.name)).toEqual(["Alma Relay"]);
    expect(result.failed).toEqual({ fingerprint: ccRelay.fingerprint, name: "CC Relay" });
    expect(result.error).toMatchObject({ code: "import_failed", params: { reason: "EACCES" } });
    expect((await client.apiEndpointList("claude")).endpoints.map((e) => e.name)).toEqual([
      "Alma Relay",
    ]);

    const gone = await client.apiEndpointImport([
      { fingerprint: "from-before-a-restart", action: "add" },
    ]);
    expect(gone).toMatchObject({ imported: [], failed: null, error: { code: "import_gone" } });
  });
});

describe("the prompt on the endpoints page (ticket 27)", () => {
  async function addCcSwitchRelay(sources: Sources, name: string): Promise<void> {
    const db = new DatabaseSync(sources.ccSwitchDb);
    db.prepare("INSERT INTO providers VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)").run(
      `added-${name}`,
      "claude",
      name,
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: `https://${name.toLowerCase()}.example/api`,
          ANTHROPIC_AUTH_TOKEN: `sk-${name.toLowerCase()}-7777`,
        },
      }),
      9,
      9,
    );
    db.close();
  }

  function sourcesOf(discovery: Awaited<ReturnType<DaemonClient["apiEndpointImportDiscovery"]>>) {
    return discovery.candidates.map((candidate) => [candidate.sourceId, candidate.source]);
  }

  test("offers what the dialog would preselect, never reads OpenCode, and reads the files at most once a minute", async () => {
    let clock = new Date("2026-10-21T08:00:00.000Z");
    const { client, sources } = await start({
      endpoints: [
        storedEndpoint({ id: "ep_hand", name: "Hand", url: "https://hand.example" }),
        storedEndpoint({
          id: "ep_only_taken",
          name: "My Relay",
          url: "https://elsewhere.example",
        }),
      ],
      keys: { ep_hand: "sk-hand-2222", ep_only_taken: "sk-elsewhere" },
      now: () => clock,
    });
    const first = await client.apiEndpointImportDiscovery();
    expect(first.error).toBeNull();
    // CC Relay 是新的；Alma 那条在 Alma 里关着、Claude Code 那条已添加、Codex 那条只是名称撞上，都要用户自己选；
    // OpenCode 不读。
    expect(sourcesOf(first)).toEqual([["cc-switch", "CC Switch"]]);
    const scan = await client.apiEndpointImportScan({ includeOpenCode: true });
    expect(first.candidates[0]?.fingerprint).toBe(itemsOf(scan, "cc-switch")[0]?.fingerprint);
    expect(JSON.stringify(first)).not.toContain("sk-cc-relay-1111");

    await addCcSwitchRelay(sources, "Fresh");
    clock = new Date("2026-10-21T08:00:59.000Z");
    // 一分钟之内：不重读，新加的那条还没出现。
    expect(sourcesOf(await client.apiEndpointImportDiscovery())).toHaveLength(1);
    clock = new Date("2026-10-21T08:01:01.000Z");
    expect(sourcesOf(await client.apiEndpointImportDiscovery())).toEqual([
      ["cc-switch", "CC Switch"],
      ["cc-switch", "CC Switch"],
    ]);
  });

  test("an import makes the next prompt read again, even within the minute", async () => {
    const clock = new Date("2026-10-21T08:00:00.000Z");
    const { client, sources } = await start({ endpoints: [], keys: {}, now: () => clock });
    const first = await client.apiEndpointImportDiscovery();
    expect(sourcesOf(first)).toEqual([
      ["cc-switch", "CC Switch"],
      ["claude-code", "Claude Code"],
      ["codex", "Codex"],
    ]);
    const ccRelay = first.candidates[0];
    if (!ccRelay) throw new Error("Expected CC Relay");
    await addCcSwitchRelay(sources, "Fresh");
    const imported = await client.apiEndpointImport([
      { fingerprint: ccRelay.fingerprint, action: "add" },
    ]);
    expect(imported.error).toBeNull();
    expect(sourcesOf(await client.apiEndpointImportDiscovery())).toEqual([
      ["cc-switch", "CC Switch"],
      ["claude-code", "Claude Code"],
      ["codex", "Codex"],
    ]);
  });

  test("the import dialog's own scan reads the files, and the prompt goes by what it read", async () => {
    const clock = new Date("2026-10-21T08:00:00.000Z");
    const { client, sources } = await start({ endpoints: [], keys: {}, now: () => clock });
    expect((await client.apiEndpointImportDiscovery()).candidates).toHaveLength(3);
    await addCcSwitchRelay(sources, "Fresh");
    await client.apiEndpointImportScan({ includeOpenCode: true });
    const after = await client.apiEndpointImportDiscovery();
    expect(after.candidates).toHaveLength(4);
    expect(after.candidates.map((candidate) => candidate.sourceId)).not.toContain("opencode");
  });

  test("a fingerprint key file that can't be parsed is replaced, with a warning that has no secret in it", async () => {
    const lines: string[] = [];
    const logger = pino({ level: "warn" }, { write: (line: string) => void lines.push(line) });
    const { client, sources } = await start({
      endpoints: [],
      keys: {},
      files: { "import-fingerprint-key.json": "{ not json" },
      logger,
    });
    expect((await client.apiEndpointImportDiscovery()).candidates).toHaveLength(3);
    const keyFile = path.join(
      path.dirname(path.dirname(sources.ccSwitchDb)),
      ".paseo",
      "api-endpoints",
      "import-fingerprint-key.json",
    );
    const secret: unknown = JSON.parse(await readFile(keyFile, "utf8")).secret;
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const warning = lines.find((line) => line.includes("Import fingerprint key file"));
    expect(warning).toBeDefined();
    expect(warning).not.toContain(String(secret));
  });

  test("a fingerprint key file Osuna can't read fails the prompt and the dialog's scan alike, each saying so", async () => {
    const { client, sources } = await start({
      endpoints: [],
      keys: {},
      files: { "import-fingerprint-key.json": JSON.stringify({ secret: "ab".repeat(32) }) },
    });
    const keyFile = path.join(
      path.dirname(path.dirname(sources.ccSwitchDb)),
      ".paseo",
      "api-endpoints",
      "import-fingerprint-key.json",
    );
    await chmod(keyFile, 0o000);
    const discovery = await client.apiEndpointImportDiscovery();
    expect(discovery).toMatchObject({ candidates: [], error: { code: "unknown" } });
    const scan = await client.apiEndpointImportScan({ includeOpenCode: true });
    expect(scan).toMatchObject({ sources: [], error: { code: "unknown" } });
    await chmod(keyFile, 0o600);
    expect((await client.apiEndpointImportDiscovery()).candidates).toHaveLength(3);
  });

  test("Ignore takes only fingerprints", async () => {
    const { client } = await start({ endpoints: [], keys: {} });
    const refused = await client.apiEndpointImportIgnore(["not-a-fingerprint"]);
    expect(refused.error).toMatchObject({ code: "invalid_input" });
  });

  test("ignoring hides that batch, across a restart, until something new comes", async () => {
    let clock = new Date("2026-10-21T08:00:00.000Z");
    const { client, daemon, sources } = await start({
      endpoints: [],
      keys: {},
      now: () => clock,
    });
    const shown = await client.apiEndpointImportDiscovery();
    expect(shown.candidates).toHaveLength(3);
    const ignored = await client.apiEndpointImportIgnore(
      shown.candidates.map((candidate) => candidate.fingerprint),
    );
    expect(ignored.error).toBeNull();
    expect((await client.apiEndpointImportDiscovery()).candidates).toEqual([]);

    // 记在主机上，不存 key 原文。
    const root = path.dirname(path.dirname(sources.ccSwitchDb));
    const endpointsDir = path.join(root, ".paseo", "api-endpoints");
    const stored = await readFile(path.join(endpointsDir, "endpoints.json"), "utf8");
    expect(JSON.parse(stored).ignoredImports).toHaveLength(3);
    for (const key of ["sk-cc-relay-1111", "sk-hand-2222", "sk-codex-3333"]) {
      expect(stored).not.toContain(key);
    }
    // 指纹的密钥只有 daemon 能读。
    const secret = await stat(path.join(endpointsDir, "import-fingerprint-key.json"));
    expect(secret.mode & 0o077).toBe(0);

    // 重启之后照样不提示。
    clients.splice(clients.indexOf(client), 1);
    await client.close();
    daemons.splice(daemons.indexOf(daemon), 1);
    await daemon.close();
    const again = await startOn({ root, sources, now: () => clock });
    expect((await again.client.apiEndpointImportDiscovery()).candidates).toEqual([]);

    // 来了一条新的：只提示它。
    await addCcSwitchRelay(sources, "Fresh");
    clock = new Date("2026-10-21T08:02:00.000Z");
    const fresh = await again.client.apiEndpointImportDiscovery();
    expect(sourcesOf(fresh)).toEqual([["cc-switch", "CC Switch"]]);
    // 改了 key 的也算新的（magpie 的指纹含 key）。
    await writeFile(
      sources.claudeSettings,
      JSON.stringify({
        env: { ANTHROPIC_BASE_URL: "https://hand.example", ANTHROPIC_AUTH_TOKEN: "sk-hand-9999" },
      }),
    );
    clock = new Date("2026-10-21T08:04:00.000Z");
    expect(sourcesOf(await again.client.apiEndpointImportDiscovery())).toEqual([
      ["cc-switch", "CC Switch"],
      ["claude-code", "Claude Code"],
    ]);
  });
});
