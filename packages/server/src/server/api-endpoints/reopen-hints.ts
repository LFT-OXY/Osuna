// 「要重开谁」与 Codex 后台 app-server 的自动重启移植自 magpie（https://github.com/yetone/magpie，
// internal/agent/connectinfo.go 的 startsWith、StaleCopies、codexCopyKind 与 daemonHelper，
// internal/provider/codex_daemon.go 的 isManagedDaemon、daemonPIDs、parsePIDFile、findCodexDaemon、
// KeepCodexDaemonCurrent、pidFileBehind、daemonStarted、codexClients、isCodexClient 与 splitExe）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { isErrnoException } from "../../utils/errno.js";
import type { ApiEndpointReopenHint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  HostProcessesError,
  lastLine,
  type HostProcess,
  type HostProcesses,
} from "./host-processes.js";
import type { ApiEndpointProvider } from "./store.js";

/*
 * 改完 CLI 配置后，还在用旧设置的副本（PRD 第 36 条）：最近一次改写之前启动的进程。Codex 再分终端、编辑器扩展、
 * 桌面应用、别的应用自带的，因为重开一种不会结束另一种（macOS 上关掉 Codex 应用的窗口它照样在跑）；
 * Codex 共用的后台 app-server 另按它的进程记录文件判断，没有客户端连着时由 Osuna 重启。
 */

/** 终端里的、编辑器扩展的、桌面应用的、别的应用自带的。 */
export type CliCopyKind = "cli" | "ide" | "app" | "embedded";

/** 同一类的副本：几个、最早什么时候启动的；embedded 带应用名。 */
export interface StaleCopyGroup {
  kind: CliCopyKind;
  app: string | null;
  count: number;
  since: Date;
}

export interface FindStaleCopiesInput {
  provider: ApiEndpointProvider;
  processes: HostProcess[];
  changedAt: Date;
  // CLI 配置所在目录（CLAUDE_CONFIG_DIR 或 ~/.claude、CODEX_HOME 或 ~/.codex）。
  cliDir: string;
  // daemon 自己的 pid：它直接起的是 Osuna 自己的会话，另外计数。
  ownPid: number;
}

/** CLI 的进程怎么认（magpie startsWith 给 pgrep -f 的式子，看整行命令）。 */
const CLI_PATTERNS: Record<ApiEndpointProvider, RegExp> = {
  claude: /(^|\/)claude( |$)/,
  codex: /(^|\/)codex( |$)/,
};

// 进程记录文件与配置由不同程序写，时钟取整不同，差一秒以内算同时（magpie 的 a second's slack）。
const CLOCK_SLACK_MS = 1_000;

/** 最近一次改写之前启动、还在用旧设置的副本，按类合并；后台 app-server 与它的帮手不在这里。 */
export function findStaleCopies(input: FindStaleCopiesInput): StaleCopyGroup[] {
  const pattern = CLI_PATTERNS[input.provider];
  const others = `/${path.basename(input.cliDir)}/`;
  const ownDir = `${input.cliDir}/`;
  const before = input.changedAt.getTime() - CLOCK_SLACK_MS;
  const copies: StaleCopy[] = [];
  for (const process of input.processes) {
    const { commandLine, startedAt } = process;
    const isOsunaSession = process.parentPid === input.ownPid || process.pid === input.ownPid;
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
  // 桌面应用与别的应用自带的：应用（包的路径或应用名），合并同一个应用的进程用。
  app: string | null;
  since: Date;
}

function namedApp(copy: StaleCopy): string | null {
  if (copy.kind === "embedded") return copy.app;
  return null;
}

/** 每类一行；别的应用自带的按应用分行，因为要说出是哪个应用。 */
function groupCopies(copies: StaleCopy[]): StaleCopyGroup[] {
  const groups = new Map<string, StaleCopyGroup>();
  for (const copy of copies) {
    const named = namedApp(copy);
    const key = `${copy.kind}\0${named ?? ""}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { kind: copy.kind, app: named, count: 1, since: copy.since });
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

type CodexCopyKind = CliCopyKind | "daemon" | "helper";

interface CopyKindOf {
  kind: CodexCopyKind;
  app: string | null;
}

/** 从命令行看是谁跑的 Codex；桌面应用的带最外层的包（magpie codexCopyKind）。 */
function codexCopyKind(commandLine: string): CopyKindOf {
  const exe = programPart(commandLine);
  const fields = commandLine.split(/\s+/);
  const appBundle = exe.indexOf(".app/");
  const isManaged = fields.some(
    (field) => field === "--managed-daemon" || field.startsWith("--managed-daemon="),
  );
  if (isManaged) return { kind: "daemon", app: null };
  if (exe.includes("/extensions/")) return { kind: "ide", app: null };
  // ChatGPT.app 的 codex 跑在它里面的 CodexCLI.app 里：取最外层的包。
  if (exe.includes(".app/Contents/")) {
    return { kind: "app", app: exe.slice(0, appBundle + ".app".length) };
  }
  if (isDaemonHelper(fields)) return { kind: "helper", app: null };
  if (fields.includes("app-server")) {
    // 自带 Codex、跟它的 app-server 说话的别的应用（Agents Anywhere）；版本管理器装在那里、在终端里跑的不算。
    for (const under of ["/Library/Application Support/", "/.local/share/"]) {
      const at = exe.indexOf(under);
      if (at < 0) continue;
      const name = exe.slice(at + under.length).split("/")[0];
      const hasMore = exe.slice(at + under.length).includes("/");
      if (name !== "" && hasMore) return { kind: "embedded", app: name };
    }
  }
  return { kind: "cli", app: null };
}

/** Claude Code 只分编辑器扩展、桌面应用里的与终端里的。 */
function claudeCopyKind(commandLine: string): CopyKindOf {
  const exe = programPart(commandLine);
  if (exe.includes("/extensions/")) return { kind: "ide", app: null };
  if (exe.includes(".app/Contents/")) {
    return { kind: "app", app: exe.slice(0, exe.indexOf(".app/") + ".app".length) };
  }
  return { kind: "cli", app: null };
}

const COPY_KINDS: Record<ApiEndpointProvider, (commandLine: string) => CopyKindOf> = {
  claude: claudeCopyKind,
  codex: codexCopyKind,
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
  return fields
    .slice(at + 1)
    .some((field) => field === "--managed-daemon" || field.startsWith("--managed-daemon="));
}

/** 程序与参数分开；Windows 列出的程序带引号（`"C:\Program Files\…\codex.exe" …`）。 */
function splitExe(commandLine: string): { exe: string; rest: string } {
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

/** 在跑的进程里这个 CODEX_HOME 的后台 app-server：进程记录文件点名的那个，没有就取第一个；没有为 null。 */
function findCodexDaemon(input: {
  processes: HostProcess[];
  records: PidFileRecord[];
}): number | null {
  const daemons = input.processes
    .filter((process) => isManagedDaemon(process.commandLine))
    .map((process) => process.pid);
  if (daemons.length === 0) return null;
  const named = input.records.find((record) => daemons.includes(record.pid));
  return named?.pid ?? daemons[0];
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
  hostProcesses: HostProcesses;
  // 执行 `codex app-server daemon restart`；失败抛 HostProcessesError。
  restart: () => Promise<void>;
}

/**
 * 后台 app-server 早于改写启动、没有 codex 会话连着时重启它（magpie KeepCodexDaemonCurrent）。
 * 进程记录文件说没有早于改写的，就不列进程；问不到进程、找不到它或不知道它何时启动的，都当作没落后。
 */
export async function keepCodexAppServerCurrent(
  input: KeepCodexAppServerCurrentInput,
): Promise<CodexAppServerCheck> {
  const before = input.changedAt.getTime() - CLOCK_SLACK_MS;
  const records = readPidFiles(input.codexHome);
  if (!records.some((record) => record.writtenAt.getTime() < before)) return { kind: "current" };
  let processes: HostProcess[];
  try {
    processes = await input.hostProcesses.list();
  } catch (error) {
    if (error instanceof HostProcessesError) return { kind: "current" };
    throw error;
  }
  const pid = findCodexDaemon({ processes, records });
  const record = records.find((candidate) => candidate.pid === pid);
  if (record === undefined || record.writtenAt.getTime() >= before) return { kind: "current" };
  const since = record.writtenAt;
  const clients = processes.filter((process) => isCodexClient(process.commandLine)).length;
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

/** 执行 Codex 自己命令要用的程序、前置参数与环境（用户在提供方设置里配的 codex 命令）。 */
export interface CodexCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** 找 codex 命令，环境盖上 env（CODEX_HOME）；找不到为 null。 */
export type FindCodexCommand = (input: {
  env: Record<string, string>;
}) => Promise<CodexCommand | null>;

/** 用户自己执行时的那条命令（magpie CodexDaemonRestart）。 */
export const CODEX_APP_SERVER_RESTART_COMMAND = "codex app-server daemon restart";

// 有会话正在跑一轮时，Codex 等它跑完再重启（最多一分钟），留些余量。
const RESTART_TIMEOUT_MS = 90_000;
// 读状态最多等后台 app-server 查这么久，没查完就先报上一次查到的。
const LIST_WAIT_MS = 3_000;

const AGENT_NAMES: Record<ApiEndpointProvider, string> = { claude: "Claude Code", codex: "Codex" };

/** 读状态时一个 CLI 的情况：配置所在目录、最近一次改写的时刻、Osuna 里改写之前启动的会话数。 */
export interface ReopenHintsSubject {
  cliDir: string;
  changedAt: Date | null;
  osunaSessions: number;
}

export interface CliReopenHintsOptions {
  // 第一次要用时才造：真的实现在测试里一造就抛错。
  hostProcesses: () => HostProcesses;
  findCodexCommand: FindCodexCommand;
  logger: {
    info: (object: object, message: string) => void;
    warn: (object: object, message: string) => void;
  };
  ownPid: number;
}

/** 后台 app-server 最近一次查到的，连同那时最近一次改写的时刻。 */
interface CodexAppServerSeen {
  changedAt: number;
  check: CodexAppServerCheck;
}

/**
 * 改完提示要重开谁（PRD 第 36 条）。每次改写 Codex 的配置后、每次读状态时查一次 Codex 后台 app-server，
 * 一次只查一个；列进程、执行重启出错只记日志，当作这次查不到，不挡提示区与 daemon。
 */
export class CliReopenHints {
  private readonly options: CliReopenHintsOptions;
  private processes: HostProcesses | null = null;
  private codexCheck: Promise<void> = Promise.resolve();
  private codexSeen: CodexAppServerSeen | null = null;

  constructor(options: CliReopenHintsOptions) {
    this.options = options;
  }

  private hostProcesses(): HostProcesses {
    this.processes ??= this.options.hostProcesses();
    return this.processes;
  }

  // 用到时才造真的适配器：进程记录文件说没有落后的 app-server 时，一个进程都不列。
  private readonly lazyHostProcesses: HostProcesses = {
    list: () => this.hostProcesses().list(),
    run: (command) => this.hostProcesses().run(command),
  };

  /** 查一次后台 app-server，排在正在查的那次后面；返回这次查完。 */
  checkCodexAppServer(input: { codexHome: string; changedAt: Date }): Promise<void> {
    const next = this.codexCheck.then(() => this.runCodexCheck(input));
    // 出错留给等它的人（读状态）；排队的下一次照样跑。
    this.codexCheck = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async runCodexCheck(input: { codexHome: string; changedAt: Date }): Promise<void> {
    const { codexHome, changedAt } = input;
    const check = await keepCodexAppServerCurrent({
      codexHome,
      changedAt,
      hostProcesses: this.lazyHostProcesses,
      restart: () => this.restartCodexAppServer(codexHome),
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
    const previous = this.codexSeen;
    // 重启过之后新的 app-server 不再落后：同一次改写之内照旧说「已重启」。
    const isSameRewrite = previous?.changedAt === changedAt.getTime();
    const keepsRestarted =
      check.kind === "current" && isSameRewrite && previous?.check.kind === "restarted";
    if (!keepsRestarted) this.codexSeen = { changedAt: changedAt.getTime(), check };
  }

  private async restartCodexAppServer(codexHome: string): Promise<void> {
    const codex = await this.options.findCodexCommand({ env: { CODEX_HOME: codexHome } });
    if (codex === null) {
      throw new HostProcessesError("The codex CLI isn't installed, or Osuna can't find it");
    }
    const result = await this.hostProcesses().run({
      command: codex.command,
      args: [...codex.args, "app-server", "daemon", "restart"],
      env: codex.env,
      timeoutMs: RESTART_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      const said = lastLine(result.output) || `exit ${result.exitCode}`;
      throw new HostProcessesError(`${CODEX_APP_SERVER_RESTART_COMMAND}: ${said}`);
    }
  }

  /** 两个 CLI 要重开的副本；Codex 的后台 app-server 等这次查完（最多 LIST_WAIT_MS）。 */
  async read(input: {
    subjects: Record<ApiEndpointProvider, ReopenHintsSubject>;
  }): Promise<Record<ApiEndpointProvider, ApiEndpointReopenHint[]>> {
    const { claude, codex } = input.subjects;
    if (codex.changedAt !== null) {
      await waitAtMost({
        task: this.checkCodexAppServer({ codexHome: codex.cliDir, changedAt: codex.changedAt }),
        ms: LIST_WAIT_MS,
      });
    }
    const isAnyRewritten = claude.changedAt !== null || codex.changedAt !== null;
    const processes = isAnyRewritten ? await this.listOrNothing() : [];
    return {
      claude: this.hintsOf({ provider: "claude", subject: claude, processes }),
      codex: this.hintsOf({ provider: "codex", subject: codex, processes }),
    };
  }

  private async listOrNothing(): Promise<HostProcess[]> {
    try {
      return await this.hostProcesses().list();
    } catch (error) {
      if (!(error instanceof HostProcessesError)) throw error;
      this.options.logger.warn({ err: error }, "Could not list the running CLI copies");
      return [];
    }
  }

  private hintsOf(input: {
    provider: ApiEndpointProvider;
    subject: ReopenHintsSubject;
    processes: HostProcess[];
  }): ApiEndpointReopenHint[] {
    const { provider, subject, processes } = input;
    const { changedAt } = subject;
    if (changedAt === null) return [];
    const agent = AGENT_NAMES[provider];
    const hints: ApiEndpointReopenHint[] = [];
    if (subject.osunaSessions > 0)
      hints.push(osunaSessionsHint({ agent, count: subject.osunaSessions }));
    const copies = findStaleCopies({
      provider,
      processes,
      changedAt,
      cliDir: subject.cliDir,
      ownPid: this.options.ownPid,
    });
    hints.push(...copies.map((copy) => copyHint({ agent, copy })));
    const seen = this.codexSeen;
    const isCurrentRewrite = seen?.changedAt === changedAt.getTime();
    if (provider === "codex" && seen !== null && isCurrentRewrite) {
      const appServer = appServerHint(seen.check);
      if (appServer !== null) hints.push(appServer);
    }
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

/** daemon 本地的时:分，给英文原文用。 */
function clockOf(at: Date): string {
  return at.toTimeString().slice(0, 5);
}

function osunaSessionsHint(input: { agent: string; count: number }): ApiEndpointReopenHint {
  const { agent, count } = input;
  return {
    kind: "osuna_sessions",
    count,
    message: `${count} ${agent} session(s) in Osuna started before Osuna last changed ${agent}'s settings: reload each (Reload agent in its tab's menu) to use the new ones.`,
  };
}

const COPY_HOW: Record<
  CliCopyKind,
  (input: { agent: string; when: string; app: string }) => string
> = {
  cli: ({ agent, when }) => `${agent} in a terminal, started ${when}: quit it and start it again.`,
  ide: ({ agent, when }) =>
    `${agent} in an editor (VS Code, Cursor…), started ${when}: reload that editor's window.`,
  app: ({ agent, when }) =>
    `The ${agent} app, started ${when}: closing its window keeps it running. Quit it with ⌘Q and open it again.`,
  embedded: ({ agent, when, app }) =>
    `${app}'s own ${agent}, started ${when}: quit ${app} and open it again.`,
};

function copyHint(input: { agent: string; copy: StaleCopyGroup }): ApiEndpointReopenHint {
  const { agent, copy } = input;
  const since = copy.since.toISOString();
  const message = `${copy.count} × ${COPY_HOW[copy.kind]({ agent, when: clockOf(copy.since), app: copy.app ?? "" })}`;
  if (copy.app === null) return { kind: copy.kind, count: copy.count, since, message };
  return { kind: copy.kind, count: copy.count, since, app: copy.app, message };
}

/** 后台 app-server 的那一行；没落后为 null。重启没成与有会话连着一样，交给用户执行命令。 */
function appServerHint(check: CodexAppServerCheck): ApiEndpointReopenHint | null {
  switch (check.kind) {
    case "current":
      return null;
    case "restarted":
      return {
        kind: "app_server_restarted",
        since: check.since.toISOString(),
        message:
          "Osuna restarted the app-server codex sessions share, which none was on, so new codex sessions have the new settings; restart the Codex app, if it is open, to see them there.",
      };
    case "attached":
    case "restart_failed":
      return {
        kind: "app_server",
        since: check.since.toISOString(),
        command: CODEX_APP_SERVER_RESTART_COMMAND,
        message: `Codex's background app-server, started ${clockOf(check.since)}, still has the settings from before: restart it with ${CODEX_APP_SERVER_RESTART_COMMAND}.`,
      };
  }
}
