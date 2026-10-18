// 「被绕过」的判断移植自 magpie（https://github.com/yetone/magpie，internal/agent/applied.go 的 Drift 里 bypassed 那两段、
// bypassed、lastJSONLTime 与 sameHost，codex.go 的 LastUsed、Reached 与 codexReached，claude.go 的 LastUsed，
// provider/provider.go 的 HostOf，usage/usage.go 的 Saw 与 LastSeen）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { closeSync, openSync, readdirSync, readSync, fstatSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { isErrnoException } from "../../utils/errno.js";
import type { ApiEndpointProvider } from "./store.js";
import { isRecord, parseJson } from "./upstream-http.js";

/*
 * 「被绕过」（PRD 第 34 条）：CLI 的设置没问题，但它自己的记录显示最近一次改写之后用过，中转站却没收到它的请求，
 * 多半是改写之前启动的进程还在用旧设置，或配置之外的东西盖过了它。只在读状态时查，不在后台监视文件。
 * 读的记录照 magpie：
 * - 两个 CLI 每敲一句话都记进各自目录下的 history.jsonl（Claude Code 的 timestamp 是毫秒、display 是那句话；
 *   Codex 的 ts 是秒、text 是那句话），斜杠命令 CLI 自己答，不算；
 * - Codex 另把每次打开的模型连接记进同一目录的 logs_*.sqlite（Codex 应用不写 history.jsonl，只有这里有）。
 * CLI 的记录只经 readCliUse 读，目录由调用方给（测试用临时的 CLAUDE_CONFIG_DIR、CODEX_HOME）。
 */

// 一句话发出后请求马上就走，留一点余量，免得还在路上的那次被算成没到（magpie bypassed 的 grace）。
const SENT_GRACE_MS = 30_000;
// 记录与中转站的时钟各取各的，差两秒以内算同一次（magpie 的 -2*time.Second）。
const CLOCK_SLACK_MS = 2_000;
// history.jsonl 只看末尾这么多（magpie lastJSONLTime 的 tail）。
const HISTORY_TAIL_BYTES = 64 * 1024;
// 日志库只看最近一天、最新的二十条（magpie codexReached）。
const CODEX_LOG_WINDOW_MS = 24 * 60 * 60 * 1000;
const CODEX_LOG_ROWS = 20;
const CODEX_WEBSOCKET_TARGET = "codex_api::endpoint::responses_websocket";

/** 每个 CLI 的 history.jsonl 里时间与那句话的键（magpie claude.go、codex.go 的 LastUsed）。 */
const HISTORY_KEYS: Record<ApiEndpointProvider, { timeKey: string; textKey: string }> = {
  claude: { timeKey: "timestamp", textKey: "display" },
  codex: { timeKey: "ts", textKey: "text" },
};

/** 中转站记下每个提供方最近一次收到请求的时刻；只在内存里，daemon 重启清零（magpie usage.Saw）。 */
export class GatewaySightings {
  private readonly seen = new Map<ApiEndpointProvider, Date>();
  private readonly now: () => Date;

  constructor(now: () => Date) {
    this.now = now;
  }

  saw(provider: ApiEndpointProvider): void {
    this.seen.set(provider, this.now());
  }

  /** 这个 daemon 收到过的最近一次；没收到过为 null。 */
  lastSeen(provider: ApiEndpointProvider): Date | null {
    return this.seen.get(provider) ?? null;
  }
}

/** Codex 日志库里一次模型连接：什么时候、连的地址、那里是不是没人应答。 */
export interface CliModelRequest {
  at: Date;
  to: string;
  isRefused: boolean;
}

/** CLI 自己的记录：最近敲的一句话的时刻，与（只有 Codex）某个时刻之后最近的一次模型连接。 */
export interface CliUse {
  lastPromptAt: Date | null;
  lastRequest: CliModelRequest | null;
}

export interface ReadCliUseInput {
  provider: ApiEndpointProvider;
  // CLI 的目录：Claude Code 是 settings.json 所在的，Codex 是 CODEX_HOME。
  configDir: string;
  // 只找这个时刻之后的模型连接（最近一次改写；没有为 null）。
  since: Date | null;
  now: Date;
}

/** 读 CLI 自己的记录的唯一入口。 */
export function readCliUse(input: ReadCliUseInput): CliUse {
  const keys = HISTORY_KEYS[input.provider];
  const lastPromptAt = readLastPromptAt({
    filePath: path.join(input.configDir, "history.jsonl"),
    ...keys,
  });
  if (input.provider === "claude") return { lastPromptAt, lastRequest: null };
  return {
    lastPromptAt,
    lastRequest: readCodexLastRequest({
      codexHome: input.configDir,
      since: input.since,
      now: input.now,
    }),
  };
}

/** 怎么看出被绕过的：用过却没请求到（used）、最近的连接发去了别处（elsewhere）、连中转站时没人应答（refused）。 */
export type CliBypass =
  | { how: "used"; at: Date }
  | { how: "elsewhere"; at: Date; host: string }
  | { how: "refused"; at: Date };

export interface FindCliBypassInput {
  use: CliUse;
  // 这个 daemon（和它里面的中转站）起来的时刻：之前中转站没收到说明不了什么。
  startedAt: Date;
  // 最近一次改写 CLI 配置的时刻；之前的使用不算。没有为 null。
  rewrittenAt: Date | null;
  lastSeen: Date | null;
  // 中转站现在的地址与 CLI 配置里写着的地址：连到这两处都算到了中转站。
  gatewayUrls: string[];
  now: Date;
}

/** magpie Drift 里配置没问题之后的那两段：先看 Codex 的连接记录，再看敲过的话。 */
export function findCliBypass(input: FindCliBypassInput): CliBypass | null {
  const request = input.use.lastRequest;
  if (request !== null) {
    const isGateway = input.gatewayUrls.some((url) => sameHost(request.to, url));
    const isMissed = seenBefore(input.lastSeen, request.at.getTime() - CLOCK_SLACK_MS);
    const wentElsewhere = !isGateway && isMissed;
    if (wentElsewhere) return { how: "elsewhere", at: request.at, host: hostOf(request.to) };
    if (request.isRefused) return { how: "refused", at: request.at };
  }
  const used = input.use.lastPromptAt;
  if (used !== null && isBypassedUse({ ...input, used })) return { how: "used", at: used };
  return null;
}

/** 用过（中转站起来以后、最近一次改写以后，且已过了余量），之后却没有请求到（magpie bypassed）。 */
function isBypassedUse(input: FindCliBypassInput & { used: Date }): boolean {
  const used = input.used.getTime();
  const isAfterStart = used > input.startedAt.getTime();
  const isAfterRewrite = input.rewrittenAt === null || used > input.rewrittenAt.getTime();
  const isPastGrace = input.now.getTime() - used > SENT_GRACE_MS;
  const isMissed = seenBefore(input.lastSeen, used - CLOCK_SLACK_MS);
  return isAfterStart && isAfterRewrite && isPastGrace && isMissed;
}

/** 中转站最近一次收到请求早于这个时刻（没收到过也算）。 */
function seenBefore(lastSeen: Date | null, at: number): boolean {
  return lastSeen === null || lastSeen.getTime() < at;
}

/** 两个地址是同一台服务器，不管协议（Codex 用 ws 连 http 的中转站）与路径（magpie sameHost）。 */
function sameHost(a: string, b: string): boolean {
  return hostOf(a) === hostOf(b);
}

/** 地址的「主机:端口」，小写（magpie provider.HostOf）。 */
function hostOf(url: string): string {
  let rest = url.trim();
  const scheme = rest.indexOf("://");
  if (scheme >= 0) rest = rest.slice(scheme + 3);
  const end = rest.search(/[/?#]/);
  if (end >= 0) rest = rest.slice(0, end);
  return rest.toLowerCase();
}

/**
 * history.jsonl 末尾几行里最新的时间（秒或毫秒都认），跳过斜杠命令；读不到或没有为 null（magpie lastJSONLTime）。
 * 精确到秒，同 magpie。
 */
function readLastPromptAt(input: {
  filePath: string;
  timeKey: string;
  textKey: string;
}): Date | null {
  const tail = readTail(input.filePath);
  if (tail === null) return null;
  let last = 0;
  for (const line of tail.split("\n")) {
    const entry = parseJson(line);
    if (!isRecord(entry)) continue;
    const text = entry[input.textKey];
    const isSlashCommand = typeof text === "string" && text.trim().startsWith("/");
    if (isSlashCommand) continue;
    const seconds = unixSeconds(entry[input.timeKey]);
    if (seconds !== null) last = Math.max(last, seconds);
  }
  if (last === 0) return null;
  return new Date(last * 1000);
}

/** 秒或毫秒的整数时间，换成秒；不是整数为 null。 */
function unixSeconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value > 1e12) return Math.trunc(value / 1000);
  return value;
}

/** 文件末尾 HISTORY_TAIL_BYTES 字节；没有文件为 null。截断处的半行解析不了，自然跳过。 */
function readTail(filePath: string): string | null {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch (error) {
    if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "EACCES")) {
      return null;
    }
    throw error;
  }
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - HISTORY_TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

interface SqliteStatement {
  all(...params: number[]): unknown[];
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}
interface Sqlite {
  DatabaseSync: new (filePath: string, options: { readOnly: boolean }) => SqliteDatabase;
}

const SqliteModuleSchema = z.object({
  DatabaseSync: z.custom<Sqlite["DatabaseSync"]>((value) => typeof value === "function"),
});
const CodexLogRowSchema = z.object({ ts: z.number(), feedback_log_body: z.string() });

const CONNECT_FAILED = "failed to connect to websocket: ";
const CONNECTING = "connecting to websocket: ";

/**
 * Codex 应用与 TUI 共用的日志库里，某个时刻之后（最多回看一天）最近的一次模型连接：连的地址、那里是不是拒绝连接。
 * 没有为 null（magpie codexReached）。日志库打不开、不是这个版本的结构都当作没有。
 */
function readCodexLastRequest(input: {
  codexHome: string;
  since: Date | null;
  now: Date;
}): CliModelRequest | null {
  const newest = newestCodexLogDatabase(input.codexHome);
  if (newest === null) return null;
  const sqlite = SqliteModuleSchema.safeParse(process.getBuiltinModule("node:sqlite"));
  if (!sqlite.success) return null;
  const from = Math.max(
    Math.trunc((input.since?.getTime() ?? 0) / 1000),
    Math.trunc((input.now.getTime() - CODEX_LOG_WINDOW_MS) / 1000),
  );
  let rows: unknown[];
  try {
    const db = new sqlite.data.DatabaseSync(newest, { readOnly: true });
    try {
      rows = db
        .prepare(
          `SELECT ts, feedback_log_body FROM logs
           WHERE ts > ? AND target = '${CODEX_WEBSOCKET_TARGET}'
           ORDER BY ts DESC, ts_nanos DESC, id DESC LIMIT ${CODEX_LOG_ROWS}`,
        )
        .all(from);
    } finally {
      db.close();
    }
  } catch (error) {
    if (isSqliteError(error)) return null;
    throw error;
  }
  return newestConnection(rows);
}

/** 最新的在前：拒绝连接那条排在它回应的那次尝试前面。 */
function newestConnection(rows: unknown[]): CliModelRequest | null {
  const refused = new Set<string>();
  for (const raw of rows) {
    const row = CodexLogRowSchema.safeParse(raw);
    if (!row.success) continue;
    const body = row.data.feedback_log_body;
    const failed = afterMarker(body, CONNECT_FAILED);
    if (failed !== null) {
      const url = afterMarker(failed, "url: ");
      const isRefusal = body.includes("Connection refused") || body.includes("os error 10061");
      if (url !== null && isRefusal) refused.add(url.trim());
      continue;
    }
    const connecting = afterMarker(body, CONNECTING);
    if (connecting !== null) {
      const url = connecting.trim();
      return { at: new Date(row.data.ts * 1000), to: url, isRefused: refused.has(url) };
    }
  }
  return null;
}

/** marker 第一次出现之后的文字；没有为 null（Go 的 strings.Cut）。 */
function afterMarker(text: string, marker: string): string | null {
  const at = text.indexOf(marker);
  if (at < 0) return null;
  return text.slice(at + marker.length);
}

/** 名字排最后的 logs_*.sqlite；没有为 null。 */
function newestCodexLogDatabase(codexHome: string): string | null {
  let names: string[];
  try {
    names = readdirSync(codexHome);
  } catch (error) {
    if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return null;
    }
    throw error;
  }
  const logs = names.filter((name) => /^logs_.*\.sqlite$/.test(name)).sort();
  const newest = logs.at(-1);
  if (newest === undefined) return null;
  return path.join(codexHome, newest);
}

/** node:sqlite 抛的错（打不开、没有这张表或这些列、库被锁）。 */
function isSqliteError(error: unknown): boolean {
  return isErrnoException(error) && error.code === "ERR_SQLITE_ERROR";
}
