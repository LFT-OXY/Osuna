// 「要重开谁」与 Codex 后台 app-server 的自动重启移植自 magpie（https://github.com/yetone/magpie，
// internal/agent/connectinfo.go 的 startsWith、changedAt、StaleCopies、codexCopyKind 与 daemonHelper，
// internal/agent/codex_daemon.go 的 KeepCodexDaemonCurrent 与 codexDaemonEvery，
// internal/provider/codex_daemon.go 的 isManagedDaemon、daemonPIDs、parsePIDFile、findCodexDaemon、
// KeepCodexDaemonCurrent、pidFileBehind、daemonStarted、codexClients、isCodexClient 与 splitExe）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { isErrnoException } from "../../utils/errno.js";
import type { ApiEndpointReopenHint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { UsagePricingTimers } from "../usage/pricing/service.js";
import {
  HostProcessesError,
  lastLine,
  type HostProcess,
  type HostProcesses,
} from "./host-processes.js";
import type { CliConfigProvider, CliStartRead } from "./store.js";

/*
 * 改完 CLI 配置后，还在用旧设置的副本（PRD 第 36 条）：CLI 启动时读的那部分最近一次变了之前启动的进程。
 * Codex 再分终端、编辑器扩展、桌面应用、别的应用自带的，因为重开一种不会结束另一种（macOS 上关掉 Codex 应用的
 * 窗口它照样在跑）；Codex 共用的后台 app-server 另按它的进程记录文件判断，没有客户端连着时由 Osuna 重启，
 * 之后每隔一会儿再看一次（magpie codexDaemonEvery）。
 */

/** 终端里的、编辑器扩展的、桌面应用的、别的应用自带的。 */
export type CliCopyKind = "cli" | "ide" | "app" | "embedded";

/** 同一类的副本：几个、最早什么时候启动的；桌面应用与别的应用自带的按应用分开，带应用名。 */
export interface StaleCopyGroup {
  kind: CliCopyKind;
  app: string | null;
  count: number;
  since: Date;
}

export interface FindStaleCopiesInput {
  provider: CliConfigProvider;
  processes: HostProcess[];
  changedAt: Date;
  // CLI 配置所在目录（CLAUDE_CONFIG_DIR 或 ~/.claude、CODEX_HOME 或 ~/.codex、PI_CODING_AGENT_DIR 或 ~/.pi/agent）。
  cliDir: string;
  // daemon 自己的 pid：它直接起的是 Osuna 自己的会话，另外计数。
  ownPid: number;
}

/** CLI 的进程怎么认（magpie startsWith 给 pgrep -f 的式子，看整行命令）。 */
const CLI_PATTERNS: Record<CliConfigProvider, RegExp> = {
  claude: /(^|\/)claude( |$)/,
  codex: /(^|\/)codex( |$)/,
  // Pi 是 node 跑的脚本（node …/bin/pi）；pi-mono 的 npm 包名里的 pi-coding-agent 不算。
  pi: /(^|\/)pi( |$)/,
};

// 进程记录文件与配置由不同程序写，时钟取整不同，差一秒以内算同时（magpie 的 a second's slack）。
const CLOCK_SLACK_MS = 1_000;

/** 最近一次改动之前启动、还在用旧设置的副本，按类合并；后台 app-server 与它的帮手不在这里。 */
export function findStaleCopies(input: FindStaleCopiesInput): StaleCopyGroup[] {
  const pattern = CLI_PATTERNS[input.provider];
  const others = `/${path.basename(input.cliDir)}/`;
  const ownDir = `${input.cliDir}/`;
  const before = input.changedAt.getTime() - CLOCK_SLACK_MS;
  const copies: StaleCopy[] = [];
  for (const running of input.processes) {
    const { commandLine, startedAt } = running;
    const isOsunaSession = running.parentPid === input.ownPid || running.pid === input.ownPid;
    // 从别的 home 的 CLI 目录里跑的（另一个 CODEX_HOME 留下的 app-server）读的是别的文件。
    const isOtherHome = commandLine.includes(others) && !commandLine.includes(ownDir);
    const isCandidate = pattern.test(commandLine) && !isOsunaSession && !isOtherHome;
    if (!isCandidate || startedAt === null || startedAt.getTime() >= before) continue;
    const copy = COPY_KINDS[input.provider](commandLine);
    if (copy.kind === "daemon" || copy.kind === "helper") continue;
    // 一个应用的几个进程（它的 app-server、exec-server）是一个副本，取最早的启动时间。
    const sameApp = copies.find((known) => copy.app !== null && known.app === copy.app);
    if (sameApp === undefined) copies.push({ kind: copy.kind, app: copy.app, since: startedAt });
    else if (startedAt < sameApp.since) sameApp.since = startedAt;
  }
  return groupCopies(copies);
}

interface StaleCopy {
  kind: CliCopyKind;
  // 桌面应用与别的应用自带的：应用名，合并同一个应用的进程、分行用。
  app: string | null;
  since: Date;
}

/** 每类一行；桌面应用与别的应用自带的按应用分行（ChatGPT 与 Codex 两个桌面应用各一行）。 */
function groupCopies(copies: StaleCopy[]): StaleCopyGroup[] {
  const groups = new Map<string, StaleCopyGroup>();
  for (const copy of copies) {
    const key = `${copy.kind}\0${copy.app ?? ""}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { kind: copy.kind, app: copy.app, count: 1, since: copy.since });
      continue;
    }
    group.count += 1;
    if (copy.since < group.since) group.since = copy.since;
  }
  return [...groups.values()];
}

/** 命令行里程序那一段：第一个「 -」之前（ps 不给路径里的空格加引号，按空格切会切断路径）。 */
function programPart(commandLine: string): string {
  const dashed = commandLine.indexOf(" -");
  if (dashed > 0) return commandLine.slice(0, dashed);
  return commandLine;
}

function isManagedDaemonFlag(field: string): boolean {
  return field === "--managed-daemon" || field.startsWith("--managed-daemon=");
}

/** 桌面应用里的程序所在的最外层的包的名字（ChatGPT.app 的 codex 跑在它里面的 CodexCLI.app 里）；不在包里为 null。 */
function desktopAppOf(exe: string): string | null {
  if (!exe.includes(".app/Contents/")) return null;
  const bundle = exe.slice(0, exe.indexOf(".app/"));
  return path.basename(bundle);
}

type CodexCopyKind = CliCopyKind | "daemon" | "helper";

interface CopyKindOf {
  kind: CodexCopyKind;
  app: string | null;
}

/** 从命令行看是谁跑的 Codex；桌面应用的带最外层的包名（magpie codexCopyKind）。 */
function codexCopyKind(commandLine: string): CopyKindOf {
  const exe = programPart(commandLine);
  const fields = commandLine.split(/\s+/);
  if (fields.some(isManagedDaemonFlag)) return { kind: "daemon", app: null };
  if (exe.includes("/extensions/")) return { kind: "ide", app: null };
  const desktopApp = desktopAppOf(exe);
  if (desktopApp !== null) return { kind: "app", app: desktopApp };
  if (isDaemonHelper(fields)) return { kind: "helper", app: null };
  if (fields.includes("app-server")) {
    // 自带 Codex、跟它的 app-server 说话的别的应用（Agents Anywhere）；版本管理器装在那里、在终端里跑的不算。
    for (const under of ["/Library/Application Support/", "/.local/share/"]) {
      const at = exe.indexOf(under);
      if (at < 0) continue;
      const rest = exe.slice(at + under.length);
      const name = rest.split("/")[0];
      if (name !== "" && rest.includes("/")) return { kind: "embedded", app: name };
    }
  }
  return { kind: "cli", app: null };
}

/** Pi 只有终端里的（Osuna 自己起的另外计数）。 */
function piCopyKind(): CopyKindOf {
  return { kind: "cli", app: null };
}

/** Claude Code 只分编辑器扩展、桌面应用里的与终端里的。 */
function claudeCopyKind(commandLine: string): CopyKindOf {
  const exe = programPart(commandLine);
  if (exe.includes("/extensions/")) return { kind: "ide", app: null };
  const desktopApp = desktopAppOf(exe);
  if (desktopApp !== null) return { kind: "app", app: desktopApp };
  return { kind: "cli", app: null };
}

const COPY_KINDS: Record<CliConfigProvider, (commandLine: string) => CopyKindOf> = {
  claude: claudeCopyKind,
  codex: codexCopyKind,
  pi: piCopyKind,
};

/** `app-server daemon <子命令>`（pid-update-loop……）：后台 app-server 起在旁边的帮手，不读模型列表，不用重开。 */
function isDaemonHelper(fields: string[]): boolean {
  return fields.some(
    (field, index) =>
      field === "app-server" && index + 2 < fields.length && fields[index + 1] === "daemon",
  );
}

/** 程序的文件名，小写、去掉路径。 */
function baseName(exe: string): string {
  return exe.slice(Math.max(exe.lastIndexOf("/"), exe.lastIndexOf("\\")) + 1).toLowerCase();
}

function isCodexProgram(exe: string): boolean {
  const base = baseName(exe);
  return base === "codex" || base === "codex.exe";
}

/** Codex 的后台 app-server：`codex [-c k=v…] app-server --managed-daemon …`。 */
export function isManagedDaemon(commandLine: string): boolean {
  const fields = commandLine.split(/\s+/).filter((field) => field !== "");
  const at = fields.indexOf("app-server");
  const isAfterCodex = at >= 1 && fields.slice(0, at).some(isCodexProgram);
  if (!isAfterCodex) return false;
  return fields.slice(at + 1).some(isManagedDaemonFlag);
}

/** 命令行拆成的程序与其余参数。 */
interface ProgramAndArgs {
  exe: string;
  rest: string;
}

/** 程序与参数分开；Windows 列出的程序带引号（`"C:\Program Files\…\codex.exe" …`）。 */
function splitExe(commandLine: string): ProgramAndArgs {
  const trimmed = commandLine.trim();
  if (trimmed.startsWith('"')) {
    const close = trimmed.indexOf('"', 1);
    if (close > 0) return { exe: trimmed.slice(1, close), rest: trimmed.slice(close + 1) };
  }
  const space = trimmed.indexOf(" ");
  if (space < 0) return { exe: trimmed, rest: "" };
  return { exe: trimmed.slice(0, space), rest: trimmed.slice(space + 1) };
}

/** 可能连着后台 app-server 的 codex 会话：终端里的 TUI、exec、resume、app-server proxy。 */
export function isCodexClient(commandLine: string): boolean {
  const { exe, rest } = splitExe(commandLine);
  if (!isCodexProgram(exe)) return false;
  // 应用自带的（ChatGPT.app 的 CodexCLI.app）与编辑器扩展的不连它；ps 不给路径里的空格加引号，所以看整行。
  const isAppOrEditor =
    commandLine.includes(".app/Contents/") ||
    exe.includes("/extensions/") ||
    exe.includes("\\extensions\\");
  if (isAppOrEditor) return false;
  const fields = rest.split(/\s+/).filter((field) => field !== "");
  if (fields.includes("exec-server") || fields.includes("mcp-server")) return false;
  const at = fields.indexOf("app-server");
  // app-server 本身、它的帮手、驱动它的命令、别的应用的 app-server 都不是；proxy 是它的客户端。
  if (at >= 0) return at + 1 < fields.length && fields[at + 1] === "proxy";
  return true;
}

/** Codex 给后台 app-server 记的 pid：PidRecord（{"pid": …}）或一个数。 */
export function parsePidFile(text: string): number | null {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) {
    const pid = Number(trimmed);
    if (pid > 0) return pid;
    return null;
  }
  try {
    const record: unknown = JSON.parse(trimmed);
    const parsed = PidRecordSchema.safeParse(record);
    if (parsed.success) return parsed.data.pid;
    return null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

const PidRecordSchema = z.object({ pid: z.number().int().positive() }).passthrough();

// 新的叫 app-server.pid，以前叫 daemon.pid。
const PID_FILE_NAMES = ["app-server.pid", "daemon.pid"];

interface PidFileRecord {
  pid: number;
  // 文件的修改时间：Codex 只在 app-server 起来时写一次，就是它的启动时间。
  writtenAt: Date;
}

function readPidFiles(codexHome: string): PidFileRecord[] {
  const records: PidFileRecord[] = [];
  for (const name of PID_FILE_NAMES) {
    const file = path.join(codexHome, "app-server-daemon", name);
    try {
      const pid = parsePidFile(readFileSync(file, "utf8"));
      if (pid !== null) records.push({ pid, writtenAt: statSync(file).mtime });
    } catch (error) {
      if (!isErrnoException(error)) throw error;
    }
  }
  return records;
}

/** 进程启动时的 CODEX_HOME；读不到或没设为 null（HostProcesses.readCodexHome）。 */
export type ReadCodexHome = (pid: number) => Promise<string | null>;

interface CodexHomeFilterInput {
  processes: HostProcess[];
  codexHome: string;
  readCodexHome: ReadCodexHome;
}

/** 去掉读得出、且是别的 CODEX_HOME 起的进程（magpie processCodexHome，只有 Linux 读得出）。 */
async function inCodexHome(input: CodexHomeFilterInput): Promise<HostProcess[]> {
  const kept: HostProcess[] = [];
  for (const running of input.processes) {
    const home = await input.readCodexHome(running.pid);
    const isOtherHome = home !== null && path.resolve(home) !== path.resolve(input.codexHome);
    if (!isOtherHome) kept.push(running);
  }
  return kept;
}

/** 在跑的进程里这个 CODEX_HOME 的后台 app-server：进程记录文件点名的那个，没有就取第一个；没有为 null。 */
async function findCodexDaemon(
  input: CodexHomeFilterInput & { records: PidFileRecord[] },
): Promise<number | null> {
  const managed = input.processes.filter((running) => isManagedDaemon(running.commandLine));
  const daemons = (await inCodexHome({ ...input, processes: managed })).map(
    (running) => running.pid,
  );
  if (daemons.length === 0) return null;
  const named = input.records.find((record) => daemons.includes(record.pid));
  return named?.pid ?? daemons[0];
}

/** 可能连着这个 CODEX_HOME 的后台 app-server 的 codex 会话数（magpie codexClients）。 */
async function countCodexClients(input: CodexHomeFilterInput): Promise<number> {
  const clients = input.processes.filter((running) => isCodexClient(running.commandLine));
  return (await inCodexHome({ ...input, processes: clients })).length;
}

/** Codex 后台 app-server 查完的结果：没落后、有会话连着留给用户、重启了、重启没成。 */
export type CodexAppServerCheck =
  | { kind: "current" }
  | { kind: "attached"; since: Date; clients: number }
  | { kind: "restarted"; since: Date }
  | { kind: "restart_failed"; since: Date; reason: string };

export interface KeepCodexAppServerCurrentInput {
  codexHome: string;
  changedAt: Date;
  readCodexHome: ReadCodexHome;
  // 列进程；同一次查看里列一次就够，调用方可以记下结果。失败抛 HostProcessesError。
  listProcesses: () => Promise<HostProcess[]>;
  // 执行 `codex app-server daemon restart`；失败抛 HostProcessesError。
  restart: () => Promise<void>;
}

/**
 * 后台 app-server 早于改动启动、没有 codex 会话连着时重启它（magpie KeepCodexDaemonCurrent）。
 * 进程记录文件说没有早于改动的，就不列进程；问不到进程、找不到它或不知道它何时启动的，都当作没落后。
 */
export async function keepCodexAppServerCurrent(
  input: KeepCodexAppServerCurrentInput,
): Promise<CodexAppServerCheck> {
  const before = input.changedAt.getTime() - CLOCK_SLACK_MS;
  const records = readPidFiles(input.codexHome);
  if (!records.some((record) => record.writtenAt.getTime() < before)) return { kind: "current" };
  let processes: HostProcess[];
  try {
    processes = await input.listProcesses();
  } catch (error) {
    if (error instanceof HostProcessesError) return { kind: "current" };
    throw error;
  }
  const filter = { processes, codexHome: input.codexHome, readCodexHome: input.readCodexHome };
  const pid = await findCodexDaemon({ ...filter, records });
  const record = records.find((candidate) => candidate.pid === pid);
  if (record === undefined || record.writtenAt.getTime() >= before) return { kind: "current" };
  const since = record.writtenAt;
  const clients = await countCodexClients(filter);
  if (clients > 0) return { kind: "attached", since, clients };
  try {
    await input.restart();
    return { kind: "restarted", since };
  } catch (error) {
    if (error instanceof HostProcessesError) {
      return { kind: "restart_failed", since, reason: error.message };
    }
    throw error;
  }
}

/** 一个 CLI 启动时读的那部分：哪几个文件，和那部分本身（拿来比较的文本）。 */
export interface CliStartupReads {
  files: string[];
  reads: string;
}

/** 算出来的改动时刻，和要记下的摘要（没变就是 null，不用写）。 */
export interface CliChangedAt {
  changedAt: Date | null;
  remember: CliStartRead | null;
}

/**
 * CLI 启动时读的那部分最近一次变了的时刻（magpie changedAt）：摘要和记下的一样就是记下的时刻，CLI 自己写同一个文件、
 * 「重新应用」没改什么、daemon 重启都不动它；第一次见到的摘要算在这几个文件最近一次修改的时刻。文件都不在为 null。
 */
export function cliChangedAt(input: {
  startup: CliStartupReads;
  stored: CliStartRead | null;
}): CliChangedAt {
  let modifiedAt: Date | null = null;
  for (const file of input.startup.files) {
    let mtime: Date;
    try {
      mtime = statSync(file).mtime;
    } catch (error) {
      if (isErrnoException(error)) continue;
      throw error;
    }
    if (modifiedAt === null || mtime > modifiedAt) modifiedAt = mtime;
  }
  if (modifiedAt === null) return { changedAt: null, remember: null };
  const digest = createHash("sha256").update(input.startup.reads).digest("hex").slice(0, 16);
  if (input.stored?.digest === digest) return { changedAt: input.stored.at, remember: null };
  return { changedAt: modifiedAt, remember: { digest, at: modifiedAt } };
}

/** 用户自己执行时的那条命令（magpie CodexDaemonRestart）。 */
export const CODEX_APP_SERVER_RESTART_COMMAND = "codex app-server daemon restart";

// 有会话正在跑一轮时，Codex 等它跑完再重启（最多一分钟），留些余量。
const RESTART_TIMEOUT_MS = 90_000;
// 刚改过（没查过这次改动）时，读状态最多等这么久，没查完就先报上一次查到的。
const FIRST_LOOK_WAIT_MS = 3_000;
// 多久再看一次后台 app-server 与在跑的副本（magpie codexDaemonEvery）。
export const REOPEN_CHECK_EVERY_MS = 15_000;

const AGENT_NAMES: Record<CliConfigProvider, string> = {
  claude: "Claude Code",
  codex: "Codex",
  pi: "Pi",
};

/** 读状态时一个 CLI 的情况：配置所在目录、启动时读的那部分最近一次变了的时刻、Osuna 里那之前启动的会话数。 */
export interface ReopenHintsSubject {
  cliDir: string;
  changedAt: Date | null;
  osunaSessions: number;
}

export type ReopenHintsSubjects = Record<CliConfigProvider, ReopenHintsSubject>;

export interface CliReopenHintsOptions {
  // 第一次要用时才造：真的实现在测试里一造就抛错。
  hostProcesses: () => HostProcesses;
  // 每次看都重新问：改动时刻与会话数随时在变。
  subjects: () => ReopenHintsSubjects;
  timers: UsagePricingTimers;
  // 给英文原文算「多久之前」。
  now: () => Date;
  logger: {
    info: (object: object, message: string) => void;
    warn: (object: object, message: string) => void;
    error: (object: object, message: string) => void;
  };
  ownPid: number;
}

/** 最近一次查看看到的：对应哪次改动、在跑的进程、后台 app-server。 */
interface ReopenLook {
  key: string;
  codexChangedAt: number | null;
  processes: HostProcess[];
  // 这次改动下最近一次列进程找旧副本的时刻；还没列过为 null。
  copiesListedAt: number | null;
  codex: CodexAppServerCheck;
}

/** 这次看要不要列进程找旧副本：每隔一会儿的那次只看后台 app-server 的进程记录文件（magpie codexDaemonEvery）。 */
interface LookScope {
  includesCopies: boolean;
}

/** 这次查看对应的改动：每个 CLI 的目录与改动时刻；变了就要重新看。 */
function lookKey(subjects: ReopenHintsSubjects): string {
  return JSON.stringify(
    Object.entries(subjects).map(([provider, subject]) => [
      provider,
      subject.cliDir,
      subject.changedAt?.getTime() ?? null,
    ]),
  );
}

/**
 * 改完提示要重开谁（PRD 第 36 条）。在后台看，一次只看一个：改写之后列进程找旧副本；每隔 REOPEN_CHECK_EVERY_MS 只看
 * 后台 app-server 的进程记录文件，它说落后了才列进程（magpie KeepCodexDaemonCurrent）。读状态用最近一次看到的，
 * 这次改动还没找过旧副本时等一会儿，找过但已经旧了就在后台再找。列进程、执行重启出错只记日志，不挡提示区与 daemon。
 */
export class CliReopenHints {
  private readonly options: CliReopenHintsOptions;
  private processes: HostProcesses | null = null;
  private looking: Promise<void> = Promise.resolve();
  private seen: ReopenLook | null = null;
  private cancelTick: (() => void) | null = null;
  private isDisposed = false;

  constructor(options: CliReopenHintsOptions) {
    this.options = options;
  }

  private hostProcesses(): HostProcesses {
    this.processes ??= this.options.hostProcesses();
    return this.processes;
  }

  /** 开始每隔一会儿看一次。 */
  start(): void {
    this.scheduleTick();
  }

  /** daemon 停下：不再看；正在做的那次做完就算。 */
  dispose(): void {
    this.isDisposed = true;
    this.cancelTick?.();
    this.cancelTick = null;
  }

  private scheduleTick(): void {
    if (this.isDisposed) return;
    this.cancelTick = this.options.timers.schedule(() => {
      this.cancelTick = null;
      void this.refresh({ includesCopies: false })
        .catch((error: unknown) => {
          this.options.logger.error({ err: error }, "Failed to look at Codex's app-server");
        })
        .finally(() => this.scheduleTick());
    }, REOPEN_CHECK_EVERY_MS);
  }

  /** 看一次，排在正在看的那次后面；返回这次看完。 */
  refresh(scope: LookScope): Promise<void> {
    const next = this.looking.then(() => this.look(scope));
    // 出错留给等它的人；排队的下一次照样跑。
    this.looking = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async look(scope: LookScope): Promise<void> {
    const subjects = this.options.subjects();
    const key = lookKey(subjects);
    let listed: Promise<HostProcess[]> | null = null;
    const listProcesses = () => {
      listed ??= this.hostProcesses().list();
      return listed;
    };
    const { codex } = subjects;
    let check: CodexAppServerCheck = { kind: "current" };
    if (codex.changedAt !== null) {
      check = await this.checkCodexAppServer({
        codexHome: codex.cliDir,
        changedAt: codex.changedAt,
        listProcesses,
      });
    }
    const codexChangedAt = codex.changedAt?.getTime() ?? null;
    const kept = this.keptCheck({ check, codexChangedAt });
    const copies = await this.copiesLook({ subjects, key, scope, listProcesses });
    this.seen = { key, codexChangedAt, ...copies, codex: kept };
  }

  /** 这次看到的进程：要找旧副本就列（列不出为空），否则留着同一次改动下上次列的。 */
  private async copiesLook(input: {
    subjects: ReopenHintsSubjects;
    key: string;
    scope: LookScope;
    listProcesses: () => Promise<HostProcess[]>;
  }): Promise<Pick<ReopenLook, "processes" | "copiesListedAt">> {
    const previous = this.seenFor(input.key);
    if (!input.scope.includesCopies) {
      return {
        processes: previous?.processes ?? [],
        copiesListedAt: previous?.copiesListedAt ?? null,
      };
    }
    const isAnyChanged = Object.values(input.subjects).some(
      (subject) => subject.changedAt !== null,
    );
    // 不带启动时间的进程表认不出旧副本，只为后台 app-server 列（magpie #2341）。
    const needsCopies = isAnyChanged && this.hostProcesses().reportsStartTimes;
    const listedAt = this.options.now().getTime();
    if (!needsCopies) return { processes: [], copiesListedAt: listedAt };
    return { processes: await this.listOrNothing(input.listProcesses), copiesListedAt: listedAt };
  }

  /** 重启过之后新的 app-server 不再落后：同一次改动之内照旧说「已重启」。 */
  private keptCheck(input: {
    check: CodexAppServerCheck;
    codexChangedAt: number | null;
  }): CodexAppServerCheck {
    const previous = this.seen;
    if (previous === null || input.check.kind !== "current") return input.check;
    const isSameChange = previous.codexChangedAt === input.codexChangedAt;
    const wasRestarted = previous.codex.kind === "restarted";
    if (isSameChange && wasRestarted) return previous.codex;
    return input.check;
  }

  private async checkCodexAppServer(input: {
    codexHome: string;
    changedAt: Date;
    listProcesses: () => Promise<HostProcess[]>;
  }): Promise<CodexAppServerCheck> {
    const check = await keepCodexAppServerCurrent({
      ...input,
      // 列过进程才会问，那时真的适配器已经造好。
      readCodexHome: (pid) => this.hostProcesses().readCodexHome(pid),
      restart: () => this.restartCodexAppServer(input.codexHome),
    });
    if (check.kind === "restarted") {
      this.options.logger.info(
        { since: check.since },
        "Restarted Codex's app-server, which had the settings from before",
      );
    }
    if (check.kind === "restart_failed") {
      this.options.logger.warn({ reason: check.reason }, "Could not restart Codex's app-server");
    }
    return check;
  }

  private async restartCodexAppServer(codexHome: string): Promise<void> {
    const codex = await this.hostProcesses().findCodex({ env: { CODEX_HOME: codexHome } });
    if (codex === null) {
      throw new HostProcessesError({
        message: "The codex CLI isn't installed, or Osuna can't find it",
      });
    }
    const result = await this.hostProcesses().run({
      ...codex,
      args: [...codex.args, "app-server", "daemon", "restart"],
      timeoutMs: RESTART_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      const said = lastLine(result.output) || `exit ${result.exitCode}`;
      throw new HostProcessesError({ message: `${CODEX_APP_SERVER_RESTART_COMMAND}: ${said}` });
    }
  }

  private async listOrNothing(listProcesses: () => Promise<HostProcess[]>): Promise<HostProcess[]> {
    try {
      return await listProcesses();
    } catch (error) {
      if (!(error instanceof HostProcessesError)) throw error;
      this.options.logger.warn({ err: error }, "Could not list the running CLI copies");
      return [];
    }
  }

  /** 每个 CLI 要重开的副本，用最近一次看到的；这次改动还没看过时等它看完（最多 FIRST_LOOK_WAIT_MS）。 */
  async read(): Promise<Record<CliConfigProvider, ApiEndpointReopenHint[]>> {
    const subjects = this.options.subjects();
    const key = lookKey(subjects);
    const listedAt = this.seenFor(key)?.copiesListedAt ?? null;
    if (listedAt === null) {
      await waitAtMost({ task: this.refresh({ includesCopies: true }), ms: FIRST_LOOK_WAIT_MS });
    } else if (this.options.now().getTime() - listedAt >= REOPEN_CHECK_EVERY_MS) {
      this.refresh({ includesCopies: true }).catch((error: unknown) => {
        this.options.logger.error({ err: error }, "Failed to look at the running CLI copies");
      });
    }
    const seen = this.seenFor(key);
    return {
      claude: this.hintsOf({ provider: "claude", subject: subjects.claude, seen }),
      codex: this.hintsOf({ provider: "codex", subject: subjects.codex, seen }),
      pi: this.hintsOf({ provider: "pi", subject: subjects.pi, seen }),
    };
  }

  private seenFor(key: string): ReopenLook | null {
    if (this.seen?.key === key) return this.seen;
    return null;
  }

  private hintsOf(input: {
    provider: CliConfigProvider;
    subject: ReopenHintsSubject;
    seen: ReopenLook | null;
  }): ApiEndpointReopenHint[] {
    const { provider, subject, seen } = input;
    const { changedAt } = subject;
    if (changedAt === null) return [];
    const words = { agent: AGENT_NAMES[provider], now: this.options.now() };
    const hints: ApiEndpointReopenHint[] = [];
    if (subject.osunaSessions > 0) {
      hints.push(osunaSessionsHint({ ...words, count: subject.osunaSessions }));
    }
    const copies = findStaleCopies({
      provider,
      processes: seen?.processes ?? [],
      changedAt,
      cliDir: subject.cliDir,
      ownPid: this.options.ownPid,
    });
    hints.push(...copies.map((copy) => copyHint({ ...words, copy })));
    if (provider === "codex" && seen !== null) {
      const appServer = appServerHint({ ...words, check: seen.codex });
      if (appServer !== null) hints.push(appServer);
    }
    // Claude Code 哪些改动正在跑的会话立刻用上（PRD 第 37 条），有要重开的才说。
    if (provider === "claude" && hints.length > 0) hints.push(CLAUDE_LIVE_ENV_HINT);
    return hints;
  }
}

async function waitAtMost(input: { task: Promise<void>; ms: number }): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, input.ms);
  });
  try {
    await Promise.race([input.task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** 英文原文里的「多久之前」（magpie 的 ago）。 */
function agoText(input: { since: Date; now: Date }): string {
  const seconds = (input.since.getTime() - input.now.getTime()) / 1000;
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of AGO_UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

const AGO_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

interface HintWords {
  agent: string;
  now: Date;
}

function osunaSessionsHint(input: HintWords & { count: number }): ApiEndpointReopenHint {
  const { agent, count } = input;
  return {
    kind: "osuna_sessions",
    count,
    message: `${count} ${agent} agent(s) in Osuna: reload each one (Reload agent in its tab's menu).`,
  };
}

const COPY_HOW: Record<
  CliCopyKind,
  (input: { agent: string; ago: string; app: string }) => string
> = {
  cli: ({ agent, ago }) => `${agent} in a terminal, started ${ago}: quit it and start it again.`,
  ide: ({ agent, ago }) =>
    `${agent} in an editor (VS Code, Cursor…), started ${ago}: reload that editor's window.`,
  app: ({ ago, app }) =>
    `The ${app} app, started ${ago}: closing its window keeps it running. Quit it with ⌘Q and open it again.`,
  embedded: ({ agent, ago, app }) =>
    `${app}'s own ${agent}, started ${ago}: quit ${app} and open it again.`,
};

function copyHint(input: HintWords & { copy: StaleCopyGroup }): ApiEndpointReopenHint {
  const { agent, copy, now } = input;
  const since = copy.since.toISOString();
  const app = copy.app ?? "";
  const how = COPY_HOW[copy.kind]({ agent, ago: agoText({ since: copy.since, now }), app });
  const message = `${copy.count} × ${how}`;
  if (copy.app === null) return { kind: copy.kind, count: copy.count, since, message };
  return { kind: copy.kind, count: copy.count, since, app: copy.app, message };
}

/** 后台 app-server 的那一行；没落后为 null。重启没成与有会话连着一样，交给用户执行命令。 */
function appServerHint(
  input: HintWords & { check: CodexAppServerCheck },
): ApiEndpointReopenHint | null {
  const { check, now } = input;
  switch (check.kind) {
    case "current":
      return null;
    case "restarted":
      return {
        kind: "app_server_restarted",
        since: check.since.toISOString(),
        message:
          "Osuna restarted the background app-server codex sessions share, which none was on, so new codex sessions have the new settings; restart the Codex app, if it is open, to see them there.",
      };
    case "attached":
    case "restart_failed":
      return {
        kind: "app_server",
        since: check.since.toISOString(),
        command: CODEX_APP_SERVER_RESTART_COMMAND,
        message: `Background app-server (started ${agoText({ since: check.since, now })}): restart it with ${CODEX_APP_SERVER_RESTART_COMMAND}`,
      };
  }
}

const CLAUDE_LIVE_ENV_HINT: ApiEndpointReopenHint = {
  kind: "claude_live_env",
  message:
    "Claude Code picks up newly written environment variables right away; removed variables, the model and the thinking level take effect only once a session is reopened.",
};
