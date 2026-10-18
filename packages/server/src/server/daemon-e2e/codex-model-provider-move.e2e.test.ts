import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as zlib from "node:zlib";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

/*
 * 挪 Codex 对话（ADR 0011）：CODEX_HOME 是临时目录里手写的对话文件与状态库，绝不碰真实的 ~/.codex。
 * 对话在 Codex 提供方自己的 CODEX_HOME 里（提供方设置的环境变量），与第三方接口改写的那份 config.toml
 * 所在目录故意不同：挪动必须在会话历史列出对话的那一处进行。期望值都是手写的整行文本，不按实现的改法去推。
 */

// 假 Codex：只答 --version；挪动不起 Codex，提供方仍需要一个命令，免得去找真的 codex。
const FAKE_CODEX_SOURCE = String.raw`
if (process.argv[2] === "--version") process.stdout.write("codex-cli 0.163.0\n");
process.exit(0);
`;

// @types/node 还停在 20：zstd 与 node:sqlite 都没有类型。
interface ZlibWithZstd {
  zstdCompressSync(buffer: Buffer): Buffer;
  zstdDecompressSync(buffer: Buffer): Buffer;
}
const zstd = zlib as unknown as ZlibWithZstd;

interface Statement {
  run(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}
interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}
interface Sqlite {
  DatabaseSync: new (filePath: string) => Database;
}
const sqlite = process.getBuiltinModule("node:sqlite") as Sqlite;

const THREAD_A = "019a0000-0000-7000-8000-00000000000a";
const THREAD_B = "019a0000-0000-7000-8000-00000000000b";
const THREAD_C = "019a0000-0000-7000-8000-00000000000c";

// 一段对话：开头的 session_meta 带服务商；中间有不带服务商的子 Agent 段、设置快照里的旧服务商（不改，magpie 的已知局限）、
// 正文里也写着 model_provider 字样（不是 session_meta，不改）。
function rolloutLines(input: { threadId: string; provider: string }): string[] {
  const { threadId, provider } = input;
  return [
    `{"timestamp":"2026-10-17T10:00:00.000Z","type":"session_meta","payload":{"id":"${threadId}","timestamp":"2026-10-17T10:00:00.000Z","cwd":"/repo","originator":"codex_cli_rs","cli_version":"0.163.0","model_provider":"${provider}","base_instructions":{"text":"中文 指令"}}}`,
    `{"timestamp":"2026-10-17T10:00:01.000Z","type":"event_msg","payload":{"type":"thread_settings_applied","model_provider_id":"${provider}"}}`,
    `{"timestamp":"2026-10-17T10:00:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"say \\"model_provider\\":\\"${provider}\\" back"}]}}`,
    `{"timestamp":"2026-10-17T10:00:03.000Z","type":"session_meta","payload":{"id":"${threadId}","timestamp":"2026-10-17T10:00:03.000Z","cwd":"/repo","originator":"codex_cli_rs","cli_version":"0.163.0"}}`,
    `{"timestamp":"2026-10-17T10:00:04.000Z","type":"session_meta","payload":{"id":"${threadId}","forked_from_id":null,"model_provider":"${provider}","source":"exec"}}`,
  ];
}

function rolloutText(input: { threadId: string; provider: string }): string {
  return `${rolloutLines(input).join("\n")}\n`;
}

const AN_HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000);

async function writeOldFile(filePath: string, bytes: Buffer | string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  await utimes(filePath, AN_HOUR_AGO, AN_HOUR_AGO);
}

function createStateDatabase(input: {
  filePath: string;
  threads: Array<{ id: string; provider: string }>;
}): void {
  const db = new sqlite.DatabaseSync(input.filePath);
  db.exec(
    "CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, model_provider TEXT NOT NULL, title TEXT)",
  );
  const insert = db.prepare(
    "INSERT INTO threads (id, rollout_path, model_provider, title) VALUES (?, '', ?, 't')",
  );
  for (const thread of input.threads) insert.run(thread.id, thread.provider);
  db.close();
}

function readThreadProviders(filePath: string): Record<string, string> {
  const db = new sqlite.DatabaseSync(filePath);
  const rows = db.prepare("SELECT id, model_provider FROM threads ORDER BY id").all() as Array<{
    id: string;
    model_provider: string;
  }>;
  db.close();
  return Object.fromEntries(rows.map((row) => [row.id, row.model_provider]));
}

async function mtimeMs(filePath: string): Promise<number> {
  return (await stat(filePath)).mtimeMs;
}

// Node 设回修改时间只到微秒级（Codex 的文件是纳秒级），所以比到毫秒以内。
function expectSameTime(input: { actual: number; expected: number }): void {
  expect(Math.abs(input.actual - input.expected)).toBeLessThan(1);
}

describe.skipIf(process.platform === "win32")(
  "daemon E2E - moving a Codex conversation to another Codex model provider",
  () => {
    let tempRoot: string;
    let codexHome: string;
    let gatewayCodexHome: string;
    let daemon: TestPaseoDaemon | undefined;
    let client: DaemonClient | undefined;

    beforeEach(async () => {
      tempRoot = await mkdtemp(path.join(tmpdir(), "codex-model-provider-move-"));
      codexHome = path.join(tempRoot, "provider-codex-home");
      gatewayCodexHome = path.join(tempRoot, "gateway-codex-home");
      await mkdir(codexHome, { recursive: true });
      await mkdir(gatewayCodexHome, { recursive: true });
      const fakeCodex = path.join(tempRoot, "bin", "codex");
      await mkdir(path.dirname(fakeCodex), { recursive: true });
      await writeFile(fakeCodex, `#!${process.execPath}\n${FAKE_CODEX_SOURCE}`);
      await chmod(fakeCodex, 0o755);
      daemon = await createTestPaseoDaemon({
        agentClients: {},
        providerOverrides: {
          claude: { enabled: false },
          pi: { enabled: false },
          omp: { enabled: false },
          codex: { command: [fakeCodex], env: { CODEX_HOME: codexHome } },
        },
        apiEndpoints: {
          env: {
            CLAUDE_CONFIG_DIR: path.join(tempRoot, "claude-config"),
            CODEX_HOME: gatewayCodexHome,
          },
          homeDir: tempRoot,
        },
      });
      client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
      await client.connect();
    });

    afterEach(async () => {
      await client?.close().catch(() => undefined);
      await daemon?.close().catch(() => undefined);
      client = undefined;
      daemon = undefined;
      await rm(tempRoot, { recursive: true, force: true });
    }, 60_000);

    const plainPath = () =>
      path.join(codexHome, "sessions/2026/10/17", `rollout-2026-10-17T10-00-00-${THREAD_A}.jsonl`);
    const packedPath = () =>
      path.join(
        codexHome,
        "archived_sessions",
        `rollout-2026-10-17T10-00-00-${THREAD_A}.jsonl.zst`,
      );
    const stateDbPath = () => path.join(codexHome, "state_5.sqlite");

    async function seedConversationA(): Promise<void> {
      const original = rolloutText({ threadId: THREAD_A, provider: "openai" });
      await writeOldFile(plainPath(), original);
      await writeOldFile(packedPath(), zstd.zstdCompressSync(Buffer.from(original)));
      createStateDatabase({
        filePath: stateDbPath(),
        threads: [
          { id: THREAD_A, provider: "openai" },
          { id: THREAD_B, provider: "openai" },
        ],
      });
      // 另一个版本的 Codex 留下的库：没有 threads 表，跳过。
      const other = new sqlite.DatabaseSync(path.join(codexHome, "state_4.sqlite"));
      other.exec("CREATE TABLE something_else (id TEXT)");
      other.close();
    }

    test("changes only the provider of each session_meta, keeps the times, updates the state database and backs up first", async () => {
      await seedConversationA();
      const plainBefore = await readFile(plainPath());
      const packedBefore = await readFile(packedPath());
      const plainTime = await mtimeMs(plainPath());
      const packedTime = await mtimeMs(packedPath());

      const result = await client!.codexSessionMoveModelProvider({
        providerId: "codex",
        threadIds: [THREAD_A],
        to: "osuna_api_endpoint",
      });

      expect(result.error).toBeNull();
      expect(result.skipped).toEqual([]);
      expect(result.moved).toHaveLength(1);
      const moved = result.moved[0]!;
      expect(moved.threadId).toBe(THREAD_A);
      expect(moved.from).toBe("openai");
      expect([...moved.files].sort()).toEqual([plainPath(), packedPath()].sort());
      expect(moved.stateDatabases).toEqual([stateDbPath()]);

      const expectedLines = [
        `{"timestamp":"2026-10-17T10:00:00.000Z","type":"session_meta","payload":{"id":"${THREAD_A}","timestamp":"2026-10-17T10:00:00.000Z","cwd":"/repo","originator":"codex_cli_rs","cli_version":"0.163.0","model_provider":"osuna_api_endpoint","base_instructions":{"text":"中文 指令"}}}`,
        `{"timestamp":"2026-10-17T10:00:01.000Z","type":"event_msg","payload":{"type":"thread_settings_applied","model_provider_id":"openai"}}`,
        `{"timestamp":"2026-10-17T10:00:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"say \\"model_provider\\":\\"openai\\" back"}]}}`,
        `{"timestamp":"2026-10-17T10:00:03.000Z","type":"session_meta","payload":{"id":"${THREAD_A}","timestamp":"2026-10-17T10:00:03.000Z","cwd":"/repo","originator":"codex_cli_rs","cli_version":"0.163.0"}}`,
        `{"timestamp":"2026-10-17T10:00:04.000Z","type":"session_meta","payload":{"id":"${THREAD_A}","forked_from_id":null,"model_provider":"osuna_api_endpoint","source":"exec"}}`,
      ];
      const expected = `${expectedLines.join("\n")}\n`;
      expect(await readFile(plainPath(), "utf8")).toBe(expected);
      expect(zstd.zstdDecompressSync(await readFile(packedPath())).toString("utf8")).toBe(expected);
      expectSameTime({ actual: await mtimeMs(plainPath()), expected: plainTime });
      expectSameTime({ actual: await mtimeMs(packedPath()), expected: packedTime });

      expect(readThreadProviders(stateDbPath())).toEqual({
        [THREAD_A]: "osuna_api_endpoint",
        [THREAD_B]: "openai",
      });

      // 备份在 Osuna 自己的目录里：文件原样一份，加一份挪动记录。
      expect(moved.backupPath.startsWith(daemon!.paseoHome + path.sep)).toBe(true);
      const record = JSON.parse(await readFile(path.join(moved.backupPath, "move.json"), "utf8"));
      expect(record).toMatchObject({ id: THREAD_A, from: "openai", to: "osuna_api_endpoint" });
      expect(typeof record.at).toBe("string");
      const items = record.items as Array<{ from: string; name: string }>;
      expect(items.map((item) => item.from).sort()).toEqual([plainPath(), packedPath()].sort());
      for (const item of items) {
        const copy = await readFile(path.join(moved.backupPath, "files", item.name));
        expect(copy.equals(item.from === plainPath() ? plainBefore : packedBefore)).toBe(true);
      }
    }, 60_000);

    test("moving it back to the provider it had gives the files it had", async () => {
      await seedConversationA();
      const plainBefore = await readFile(plainPath());
      const packedBefore = await readFile(packedPath());

      const there = await client!.codexSessionMoveModelProvider({
        providerId: "codex",
        threadIds: [THREAD_A],
        to: "osuna_api_endpoint",
      });
      expect(there.moved).toHaveLength(1);
      const back = await client!.codexSessionMoveModelProvider({
        providerId: "codex",
        threadIds: [THREAD_A],
        to: "openai",
      });

      expect(back.moved.map((entry) => [entry.threadId, entry.from])).toEqual([
        [THREAD_A, "osuna_api_endpoint"],
      ]);
      expect((await readFile(plainPath())).equals(plainBefore)).toBe(true);
      // 压缩的字节取决于压缩器：比的是解开后的内容。
      expect(
        zstd
          .zstdDecompressSync(await readFile(packedPath()))
          .equals(zstd.zstdDecompressSync(packedBefore)),
      ).toBe(true);
      expect(readThreadProviders(stateDbPath())[THREAD_A]).toBe("openai");
    }, 60_000);

    test("leaves a conversation written in the last minute alone and says why", async () => {
      await seedConversationA();
      const now = new Date();
      await utimes(plainPath(), now, now);
      const plainBefore = await readFile(plainPath());

      const result = await client!.codexSessionMoveModelProvider({
        providerId: "codex",
        threadIds: [THREAD_A],
        to: "osuna_api_endpoint",
      });

      expect(result.error).toBeNull();
      expect(result.moved).toEqual([]);
      expect(result.skipped).toEqual([
        { threadId: THREAD_A, reason: "active", message: expect.any(String) },
      ]);
      expect((await readFile(plainPath())).equals(plainBefore)).toBe(true);
      expect(readThreadProviders(stateDbPath())[THREAD_A]).toBe("openai");
    }, 60_000);

    test("puts back the files already changed when a later one cannot be written", async () => {
      // 同一段对话分在两天的两个文件里；第二个所在的目录不可写，临时文件建不出来。
      const first = path.join(
        codexHome,
        "sessions/2026/10/16",
        `rollout-2026-10-16T09-00-00-${THREAD_C}.jsonl`,
      );
      const secondDir = path.join(codexHome, "sessions/2026/10/17");
      const second = path.join(secondDir, `rollout-2026-10-17T09-00-00-${THREAD_C}_2.jsonl`);
      await writeOldFile(first, rolloutText({ threadId: THREAD_C, provider: "openai" }));
      await writeOldFile(second, rolloutText({ threadId: THREAD_C, provider: "openai" }));
      createStateDatabase({
        filePath: stateDbPath(),
        threads: [{ id: THREAD_C, provider: "openai" }],
      });
      const firstBefore = await readFile(first);
      const firstTime = await mtimeMs(first);
      await chmod(secondDir, 0o555);
      try {
        const result = await client!.codexSessionMoveModelProvider({
          providerId: "codex",
          threadIds: [THREAD_C],
          to: "osuna_api_endpoint",
        });

        expect(result.moved).toEqual([]);
        expect(result.skipped).toEqual([
          {
            threadId: THREAD_C,
            reason: "failed",
            message: expect.any(String),
            backupPath: expect.stringContaining(daemon!.paseoHome),
          },
        ]);
        expect((await readFile(first)).equals(firstBefore)).toBe(true);
        expectSameTime({ actual: await mtimeMs(first), expected: firstTime });
        expect(readThreadProviders(stateDbPath())[THREAD_C]).toBe("openai");
        expect(await readdir(path.dirname(first))).toEqual([path.basename(first)]);
      } finally {
        await chmod(secondDir, 0o755);
      }
    }, 60_000);

    test("lists the providers a conversation can go to from the Codex provider's own config", async () => {
      // 第三方接口那份 config.toml 里有 Osuna 的表，但对话所在的 CODEX_HOME 里没有：列的是后者。
      await writeFile(
        path.join(gatewayCodexHome, "config.toml"),
        '[model_providers.osuna_api_endpoint]\nname = "Osuna"\n[model_providers.elsewhere]\n',
      );
      await writeFile(
        path.join(codexHome, "config.toml"),
        [
          'model_provider = "cc"',
          "",
          "[model_providers.cc]",
          'name = "CC Switch"',
          'base_url = "https://relay.example/v1"',
          "",
          "[model_providers.openai]",
          'name = "OpenAI"',
          "",
          "[model_providers.bare]",
          'base_url = "https://bare.example/v1"',
          "",
        ].join("\n"),
      );

      const result = await client!.codexSessionListModelProviders("codex");

      expect(result.error).toBeNull();
      expect(result.modelProviders).toEqual([
        { id: "openai", source: "builtin" },
        { id: "osuna_api_endpoint", source: "osuna", name: "Osuna", unavailableReason: "no_table" },
        { id: "cc", source: "config", name: "CC Switch" },
        { id: "bare", source: "config" },
      ]);
    }, 60_000);

    test("offers Osuna's own provider once its table is in config.toml", async () => {
      await writeFile(
        path.join(codexHome, "config.toml"),
        '[model_providers.osuna_api_endpoint]\nname = "Osuna"\nbase_url = "http://127.0.0.1:1/v1"\n',
      );

      const result = await client!.codexSessionListModelProviders("codex");

      expect(result.modelProviders).toEqual([
        { id: "openai", source: "builtin" },
        { id: "osuna_api_endpoint", source: "osuna", name: "Osuna" },
      ]);
    }, 60_000);

    test("still moves when config.toml can't be read and skips a state database it can't inspect", async () => {
      await seedConversationA();
      await writeFile(path.join(codexHome, "config.toml"), "this is = = not toml [[[");
      // 不是 SQLite 文件：查不了表结构，magpie 当作没有 threads 表跳过。
      await writeFile(path.join(codexHome, "state_9.sqlite"), "not a database");

      const result = await client!.codexSessionMoveModelProvider({
        providerId: "codex",
        threadIds: [THREAD_A],
        to: "osuna_api_endpoint",
      });

      expect(result.error).toBeNull();
      expect(result.skipped).toEqual([]);
      expect(result.moved.map((entry) => entry.stateDatabases)).toEqual([[stateDbPath()]]);
      expect(await readFile(plainPath(), "utf8")).toContain(
        '"model_provider":"osuna_api_endpoint"',
      );
    }, 60_000);

    test("says the files moved when a state database refuses the change, and where the backup is", async () => {
      await seedConversationA();
      const db = new sqlite.DatabaseSync(stateDbPath());
      db.exec(
        "CREATE TRIGGER keep_provider BEFORE UPDATE ON threads BEGIN SELECT RAISE(ABORT, 'held by Codex'); END",
      );
      db.close();

      const result = await client!.codexSessionMoveModelProvider({
        providerId: "codex",
        threadIds: [THREAD_A],
        to: "osuna_api_endpoint",
      });

      expect(result.moved).toEqual([]);
      expect(result.skipped).toEqual([
        {
          threadId: THREAD_A,
          reason: "state_database_failed",
          message: expect.stringContaining("held by Codex"),
          backupPath: expect.stringContaining(daemon!.paseoHome),
        },
      ]);
      expect(await readFile(plainPath(), "utf8")).toContain(
        '"model_provider":"osuna_api_endpoint"',
      );
      expect(readThreadProviders(stateDbPath())[THREAD_A]).toBe("openai");
      const backupPath = result.skipped[0]!.backupPath!;
      expect(JSON.parse(await readFile(path.join(backupPath, "move.json"), "utf8")).id).toBe(
        THREAD_A,
      );
    }, 60_000);

    test("refuses a provider that is not a Codex provider", async () => {
      const result = await client!.codexSessionMoveModelProvider({
        providerId: "claude",
        threadIds: [THREAD_A],
        to: "openai",
      });

      expect(result.error?.code).toBe("invalid_input");
      expect(result.moved).toEqual([]);
    }, 60_000);
  },
);
