// 挪 Codex 对话的做法移植自 magpie（https://github.com/yetone/magpie，internal/sessions/codex_provider.go 的
// MoveCodexProvider、setMetaProvider、rewriteCodexProvider、moveCodexThread、keptCopy、codexMetaProvider，
// sessions.go 的 rolloutName、rolloutTwin，manage.go 的 ActiveWindow 与 recent）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs, type Stats } from "node:fs";
import path from "node:path";
import { Readable, type Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as zlib from "node:zlib";
import { z } from "zod";
import { ensurePrivateDirectory, writePrivateFileAtomicSync } from "../private-files.js";

/*
 * 把一段 Codex 对话挪到另一个 Codex 服务商（ADR 0011）：只改对话文件里每条带服务商的 session_meta 的
 * model_provider，其余字节不动；再改每个状态库 threads 表里这条对话的 model_provider。
 * 改之前把每个文件原样复制到 Osuna 自己的备份目录并写一份挪动记录；文件改到一半失败就用备份改回。
 * 设置快照事件（thread_settings_applied）里的旧服务商不改：magpie 的已知局限。
 */

/** magpie ActiveWindow：这么近写过的对话可能还在跑，不挪。 */
export const CODEX_CONVERSATION_ACTIVE_WINDOW_MS = 60_000;

/** config.toml 里 [model_providers] 的键或内置服务商的 id（magpie codexProviderRe）。 */
export const CODEX_MODEL_PROVIDER_ID_PATTERN = /^[0-9A-Za-z_.-]{1,64}$/;

const THREAD_ID_PATTERN = /^[0-9A-Za-z_-]+$/;
// rollout-2026-09-20T15-48-28-<对话 id>[_<分段>].jsonl；Codex app 压缩过的旧对话再加 .zst。
const ROLLOUT_NAME =
  /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9A-Za-z-]+?)(?:_[0-9A-Za-z-]+)?\.jsonl(?:\.zst)?$/;
const PACKED_SUFFIX = ".zst";
const ROLLOUT_FOLDERS = ["sessions", "archived_sessions"];
const SESSION_META_MARK = Buffer.from('"type":"session_meta"');
const SESSION_META_MARK_WINDOW = 1024;
const META_PROVIDER_LINES = 8;
const NEWLINE = 0x0a;

// @types/node 还停在 20，没有 zstd 的类型；Node 22.15 / 23.8 起 zlib 才有。
interface ZlibWithZstd {
  // 只为让 node:zlib 能赋给这个接口（全是可选成员的接口会被当成弱类型拒收）。
  constants: typeof zlib.constants;
  createZstdCompress?: () => Transform;
  createZstdDecompress?: () => Transform;
}
const zlibWithZstd: ZlibWithZstd = zlib;

interface SqliteStatement {
  get(...params: string[]): unknown;
  run(...params: string[]): { changes: number | bigint };
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
interface Sqlite {
  DatabaseSync: new (filePath: string) => SqliteDatabase;
}

const SqliteModuleSchema = z.object({
  DatabaseSync: z.custom<Sqlite["DatabaseSync"]>((value) => typeof value === "function"),
});
const TableColumnCountSchema = z.object({ count: z.number() });

export interface CodexConversationMoveTarget {
  /** 对话文件所在的 Codex 目录（sessions/、archived_sessions/ 的上一层）。 */
  codexHome: string;
  /** state_*.sqlite 所在目录：CODEX_SQLITE_HOME、config.toml 的 sqlite_home，缺省同 codexHome。 */
  stateDirectory: string;
  /** Osuna 自己的备份目录；每次挪动在下面建一个子目录。 */
  backupRoot: string;
}

export type CodexConversationMoveOutcome =
  | {
      kind: "moved";
      threadId: string;
      from: string | null;
      files: string[];
      stateDatabases: string[];
      backupPath: string;
    }
  | { kind: "active"; threadId: string }
  | { kind: "not_found"; threadId: string }
  /** 改对话文件时失败：已改的文件已用备份改回。备份那一步之前就失败时没有备份。 */
  | { kind: "failed"; threadId: string; message: string; backupPath: string | null }
  /** 对话文件已挪，某个状态库没改成（magpie 同样不回滚文件）。 */
  | { kind: "state_database_failed"; threadId: string; message: string; backupPath: string };

export interface MoveCodexConversationInput extends CodexConversationMoveTarget {
  threadId: string;
  to: string;
  now: Date;
}

interface BackupItem {
  from: string;
  name: string;
}

class CodexConversationMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexConversationMoveError";
  }
}

// 同一时间只挪一段对话（magpie 的 mu）：两个连接同时挪同一段，后一个读到的就是前一个改完的文件。
let moveQueue: Promise<unknown> = Promise.resolve();

export function moveCodexConversation(
  input: MoveCodexConversationInput,
): Promise<CodexConversationMoveOutcome> {
  const next = moveQueue.then(() => moveNow(input));
  moveQueue = next.catch(() => undefined);
  return next;
}

async function moveNow(input: MoveCodexConversationInput): Promise<CodexConversationMoveOutcome> {
  const { threadId, to, now } = input;
  if (!THREAD_ID_PATTERN.test(threadId)) return { kind: "not_found", threadId };
  const files = await findRolloutFiles({ codexHome: input.codexHome, threadId });
  if (files.length === 0) return { kind: "not_found", threadId };
  const stats = await Promise.all(files.map((file) => fs.stat(file)));
  const isActive = stats.some(
    (stat) => now.getTime() - stat.mtimeMs < CODEX_CONVERSATION_ACTIVE_WINDOW_MS,
  );
  if (isActive) return { kind: "active", threadId };
  const stateDatabases = await findStateDatabases(input.stateDirectory);

  let backup: Backup | null = null;
  let changed: string[];
  let sqlite: Sqlite | null;
  let from: string | null;
  try {
    sqlite = stateDatabases.length > 0 ? requireSqlite() : null;
    if (files.some(isPacked)) requireZstd();
    from = await firstMetaProvider(files);
    backup = await backUp({ backupRoot: input.backupRoot, threadId, from, to, now, files });
    changed = await rewriteAll({ files, to, backup });
  } catch (error) {
    return {
      kind: "failed",
      threadId,
      message: errorMessage(error),
      backupPath: backup?.directory ?? null,
    };
  }
  const movedDatabases: string[] = [];
  try {
    for (const database of stateDatabases) {
      if (sqlite && moveThreadRow({ sqlite, database, threadId, to })) {
        movedDatabases.push(database);
      }
    }
  } catch (error) {
    return {
      kind: "state_database_failed",
      threadId,
      message: errorMessage(error),
      backupPath: backup.directory,
    };
  }
  return {
    kind: "moved",
    threadId,
    from,
    files: changed,
    stateDatabases: movedDatabases,
    backupPath: backup.directory,
  };
}

/** 这段对话的所有对话文件（含压缩过的孪生文件），按路径排好。 */
async function findRolloutFiles(input: { codexHome: string; threadId: string }): Promise<string[]> {
  const found = new Set<string>();
  for (const folder of ROLLOUT_FOLDERS) {
    const root = path.join(input.codexHome, folder);
    for (const file of await listFiles(root)) {
      const match = ROLLOUT_NAME.exec(path.basename(file));
      if (match?.[1] !== input.threadId) continue;
      for (const candidate of [file, rolloutTwin(file)]) {
        if (await isRegularFile(candidate)) found.add(candidate);
      }
    }
  }
  return [...found].sort();
}

async function listFiles(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function rolloutTwin(file: string): string {
  return isPacked(file) ? file.slice(0, -PACKED_SUFFIX.length) : file + PACKED_SUFFIX;
}

function isPacked(file: string): boolean {
  return file.endsWith(PACKED_SUFFIX);
}

async function isRegularFile(file: string): Promise<boolean> {
  try {
    return (await fs.lstat(file)).isFile();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function findStateDatabases(directory: string): Promise<string[]> {
  try {
    const names = await fs.readdir(directory);
    const databases = names.filter((name) => /^state_.*\.sqlite$/.test(name));
    return databases.sort().map((name) => path.join(directory, name));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function requireSqlite(): Sqlite {
  const parsed = SqliteModuleSchema.safeParse(process.getBuiltinModule("node:sqlite"));
  if (!parsed.success) {
    throw new CodexConversationMoveError(
      "The Node.js running Osuna cannot open Codex's state database (node:sqlite is missing)",
    );
  }
  return parsed.data;
}

interface Zstd {
  createZstdCompress: () => Transform;
  createZstdDecompress: () => Transform;
}

function requireZstd(): Zstd {
  const { createZstdCompress, createZstdDecompress } = zlibWithZstd;
  if (!createZstdCompress || !createZstdDecompress) {
    throw new CodexConversationMoveError(
      "The Node.js running Osuna cannot read a compressed Codex conversation (zstd is missing)",
    );
  }
  return { createZstdCompress, createZstdDecompress };
}

/** 第一个有 session_meta 的文件里记的服务商；session_meta 没写服务商按 Codex 的默认 openai。 */
async function firstMetaProvider(files: string[]): Promise<string | null> {
  for (const file of files) {
    const provider = await metaProvider(file);
    if (provider) return provider;
  }
  return null;
}

async function metaProvider(file: string): Promise<string | null> {
  let count = 0;
  for await (const line of readLines(file)) {
    const meta = readSessionMeta(line);
    if (meta) return meta.provider?.value ?? "openai";
    count += 1;
    if (count >= META_PROVIDER_LINES) break;
  }
  return null;
}

interface Backup {
  directory: string;
  items: BackupItem[];
}

async function backUp(input: {
  backupRoot: string;
  threadId: string;
  from: string | null;
  to: string;
  now: Date;
  files: string[];
}): Promise<Backup> {
  const { now, threadId } = input;
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("Z", "");
  const directory = path.join(input.backupRoot, `${stamp}-${threadId}`);
  try {
    ensurePrivateDirectory(path.join(directory, "files"));
    const items = input.files.map((file, index) => ({
      from: file,
      name: `${index}-${path.basename(file)}`,
    }));
    for (const item of items) {
      await keptCopy({ from: item.from, to: path.join(directory, "files", item.name) });
    }
    const record = { id: threadId, from: input.from, to: input.to, at: now.toISOString(), items };
    writePrivateFileAtomicSync(path.join(directory, "move.json"), JSON.stringify(record, null, 2));
    return { directory, items };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** 逐个改写；中途失败就把已改的文件用备份改回，再把错误往上抛。 */
async function rewriteAll(input: {
  files: string[];
  to: string;
  backup: Backup;
}): Promise<string[]> {
  const changed: string[] = [];
  try {
    for (const file of input.files) {
      if (await rewriteRollout({ file, to: input.to })) changed.push(file);
    }
    return changed;
  } catch (error) {
    for (const item of input.backup.items) {
      if (!changed.includes(item.from)) continue;
      await keptCopy({
        from: path.join(input.backup.directory, "files", item.name),
        to: item.from,
      });
    }
    throw error;
  }
}

/** 复制文件，保留权限与修改时间（magpie keptCopy）。 */
async function keptCopy(input: { from: string; to: string }): Promise<void> {
  const stat = await fs.stat(input.from);
  await fs.copyFile(input.from, input.to);
  await fs.chmod(input.to, (stat.mode & 0o777) | 0o600);
  await keepTimes({ file: input.to, stat });
}

async function keepTimes(input: { file: string; stat: Stats }): Promise<void> {
  await fs.utimes(input.file, input.stat.atimeMs / 1000, input.stat.mtimeMs / 1000);
}

/**
 * 把整个文件改写进旁边的临时文件：每条带服务商的 session_meta 换成新服务商，其余行原样；压缩的照样压回。
 * 没有要改的就丢掉临时文件、返回 false。改了就落盘、给回原来的权限与修改时间，再改名替换原文件。
 */
async function rewriteRollout(input: { file: string; to: string }): Promise<boolean> {
  const { file, to } = input;
  const stat = await fs.stat(file);
  const temporary = path.join(
    path.dirname(file),
    `.osuna-${path.basename(file)}-${randomBytes(6).toString("hex")}`,
  );
  let changed = false;
  async function* rewritten(): AsyncGenerator<Buffer> {
    for await (const line of readLines(file)) {
      const next = withProvider({ line, to });
      if (next !== line) changed = true;
      yield next;
    }
  }
  const output = createWriteStream(temporary, { flags: "wx", mode: stat.mode & 0o777 });
  try {
    if (isPacked(file)) {
      await pipeline(Readable.from(rewritten()), requireZstd().createZstdCompress(), output);
    } else {
      await pipeline(Readable.from(rewritten()), output);
    }
    if (!changed) {
      await fs.rm(temporary, { force: true });
      return false;
    }
    await fs.chmod(temporary, stat.mode & 0o777);
    // 改名前先落盘：机器在改名后、数据写下前断电，对话文件会变成全零（magpie #1505）。
    const handle = await fs.open(temporary, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await keepTimes({ file: temporary, stat });
    await fs.rename(temporary, file);
    return true;
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

/** 按行读（每行带着自己的换行符，最后一行可能没有）；压缩的边读边解。 */
async function* readLines(file: string): AsyncGenerator<Buffer> {
  const source = createReadStream(file);
  const stream = isPacked(file) ? source.pipe(requireZstd().createZstdDecompress()) : source;
  source.on("error", (error) => stream.destroy(error));
  let pending: Buffer = Buffer.alloc(0);
  try {
    for await (const chunk of stream) {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      let start = 0;
      let newline = pending.indexOf(NEWLINE, start);
      while (newline !== -1) {
        yield pending.subarray(start, newline + 1);
        start = newline + 1;
        newline = pending.indexOf(NEWLINE, start);
      }
      pending = pending.subarray(start);
    }
    if (pending.length > 0) yield pending;
  } finally {
    source.destroy();
    stream.destroy();
  }
}

/** 带服务商的 session_meta 行换成新服务商（magpie setMetaProvider）；别的行原样返回。 */
function withProvider(input: { line: Buffer; to: string }): Buffer {
  const { line, to } = input;
  const meta = readSessionMeta(line);
  const provider = meta?.provider;
  if (!provider || provider.value === to) return line;
  return Buffer.concat([
    line.subarray(0, provider.start),
    Buffer.from(JSON.stringify(to)),
    line.subarray(provider.end),
  ]);
}

interface StringToken {
  start: number;
  end: number;
  value: string;
}

interface SessionMeta {
  /** payload.model_provider；没写或不是字符串为 null（子 Agent 段、老版本的 Codex），这种不改。 */
  provider: StringToken | null;
}

/** 顶层 type 为 session_meta 的行（magpie 先看前 1024 字节里有没有 `"type":"session_meta"`）。 */
function readSessionMeta(line: Buffer): SessionMeta | null {
  if (!line.subarray(0, SESSION_META_MARK_WINDOW).includes(SESSION_META_MARK)) return null;
  const scanner = new JsonScanner(line);
  const found: SessionMetaScan = { isSessionMeta: false, provider: null };
  const parsed = scanner.readObject((key) => {
    if (key === "type") {
      found.isSessionMeta = scanner.readValue()?.value === "session_meta";
      return;
    }
    if (key === "payload" && scanner.peek() === "{") {
      scanner.readObject((payloadKey) => {
        const token = scanner.readValue();
        if (payloadKey === "model_provider" && !found.provider) found.provider = token;
      });
      return;
    }
    scanner.readValue();
  });
  if (!parsed || !found.isSessionMeta) return null;
  return { provider: found.provider };
}

interface SessionMetaScan extends SessionMeta {
  isSessionMeta: boolean;
}

/**
 * 只为找到 session_meta 的服务商而写的 JSON 扫描器：按字节走，记下字符串值的字节范围，不重新序列化。
 * 结构字符都是 ASCII，按字节扫 UTF-8 是安全的。读不懂就抛 SyntaxError，由 readObject 收成 false。
 */
class JsonScanner {
  private index = 0;

  constructor(private readonly bytes: Buffer) {}

  peek(): string {
    this.skipWhitespace();
    return String.fromCharCode(this.bytes[this.index] ?? 0);
  }

  /** 读一个对象，每个键交给 onKey，由它读掉对应的值；整体读不懂返回 false。 */
  readObject(onKey: (key: string) => void): boolean {
    try {
      this.expect("{");
      if (this.peek() === "}") {
        this.index += 1;
        return true;
      }
      for (;;) {
        const key = this.readString();
        this.expect(":");
        onKey(key.value);
        const next = this.peek();
        this.index += 1;
        if (next === "}") return true;
        if (next !== ",") throw new SyntaxError("expected , or }");
      }
    } catch (error) {
      if (error instanceof SyntaxError) return false;
      throw error;
    }
  }

  /** 读掉一个值；是字符串时返回它的字节范围与内容，否则 null。 */
  readValue(): StringToken | null {
    const next = this.peek();
    if (next === '"') return this.readString();
    if (next === "{" || next === "[") {
      this.skipContainer();
      return null;
    }
    this.skipLiteral();
    return null;
  }

  private readString(): StringToken {
    this.skipWhitespace();
    const start = this.index;
    if (this.bytes[start] !== 0x22) throw new SyntaxError("expected a string");
    let index = start + 1;
    while (index < this.bytes.length) {
      const byte = this.bytes[index];
      if (byte === 0x5c) {
        index += 2;
        continue;
      }
      if (byte === 0x22) {
        const end = index + 1;
        this.index = end;
        const value: unknown = JSON.parse(this.bytes.toString("utf8", start, end));
        if (typeof value !== "string") throw new SyntaxError("expected a string");
        return { start, end, value };
      }
      index += 1;
    }
    throw new SyntaxError("unterminated string");
  }

  private skipContainer(): void {
    let depth = 0;
    while (this.index < this.bytes.length) {
      const byte = this.bytes[this.index];
      if (byte === 0x22) {
        this.readString();
        continue;
      }
      this.index += 1;
      if (byte === 0x7b || byte === 0x5b) depth += 1;
      if (byte === 0x7d || byte === 0x5d) {
        depth -= 1;
        if (depth === 0) return;
      }
    }
    throw new SyntaxError("unterminated container");
  }

  private skipLiteral(): void {
    const start = this.index;
    while (this.index < this.bytes.length && !isLiteralEnd(this.bytes[this.index])) {
      this.index += 1;
    }
    if (this.index === start) throw new SyntaxError("expected a value");
  }

  private expect(character: string): void {
    if (this.peek() !== character) throw new SyntaxError(`expected ${character}`);
    this.index += 1;
  }

  private skipWhitespace(): void {
    while (this.index < this.bytes.length && isWhitespace(this.bytes[this.index])) {
      this.index += 1;
    }
  }
}

function isWhitespace(byte: number | undefined): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function isLiteralEnd(byte: number | undefined): boolean {
  const isStructural = byte === 0x2c || byte === 0x7d || byte === 0x5d;
  return isStructural || isWhitespace(byte);
}

/**
 * 改状态库里这条对话的服务商（magpie moveCodexThread），返回库里有没有这一行。
 * 没有 threads 表（或没有 id、model_provider 列）的库是别的版本的 Codex 留下的，跳过。
 */
function moveThreadRow(input: {
  sqlite: Sqlite;
  database: string;
  threadId: string;
  to: string;
}): boolean {
  const db = new input.sqlite.DatabaseSync(input.database);
  try {
    if (!hasThreadsTable(db)) return false;
    const result = db
      .prepare("UPDATE threads SET model_provider = ? WHERE id = ?")
      .run(input.to, input.threadId);
    return Number(result.changes) > 0;
  } catch (error) {
    throw new CodexConversationMoveError(
      `The conversation files moved, but Codex's ${path.basename(input.database)} didn't: ${errorMessage(error)}`,
    );
  } finally {
    db.close();
  }
}

/** magpie 同样把查不了表结构（不是 SQLite 文件、打不开等）当作没有 threads 表。 */
function hasThreadsTable(db: SqliteDatabase): boolean {
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const columns = TableColumnCountSchema.safeParse(
      db
        .prepare(
          "SELECT count(*) AS count FROM pragma_table_info('threads') WHERE name IN ('id', 'model_provider')",
        )
        .get(),
    );
    return columns.success && columns.data.count === 2;
  } catch {
    return false;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
