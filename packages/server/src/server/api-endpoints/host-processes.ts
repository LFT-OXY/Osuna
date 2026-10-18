// 列进程的读法（ps 的 etime 与 PowerShell 的 Win32_Process）移植自 magpie（https://github.com/yetone/magpie，
// internal/proc/list.go、list_other.go、list_windows.go 的 List 与 parseList，internal/agent/connectinfo.go 的 running 与 elapsed），
// 读进程的 CODEX_HOME 移植自 internal/provider/codex_daemon.go 的 processCodexHome
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { readFile } from "node:fs/promises";
import { isErrnoException } from "../../utils/errno.js";
import { spawnProcess } from "../../utils/spawn.js";

/*
 * 可替换的「进程与命令」适配器：第三方接口要看本机在跑哪些 CLI（改完提示要重开谁）、执行 CLI 自己的命令
 * （重启 Codex 的后台 app-server），以后的代理探测也经它读系统代理。生产用 createSystemHostProcesses，
 * 测试一律换成假的：真的实现在测试里一造就抛错，免得哪条用例读到真实的进程表、跑真的 codex。
 */

/** 本机的一个进程。startedAt 为 null 是系统没给启动时间（Windows 的列表不带）。 */
export interface HostProcess {
  pid: number;
  parentPid: number;
  startedAt: Date | null;
  // 整行命令，参数以空格相连。
  commandLine: string;
}

/** 一个程序：可执行文件、前置参数与环境。 */
export interface HostProgram {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** 找 codex 命令（用户在提供方设置里配的那个），环境盖上 env；找不到为 null。 */
export type FindCodexCommand = (input: {
  env: Record<string, string>;
}) => Promise<HostProgram | null>;

export interface HostCommand extends HostProgram {
  timeoutMs: number;
}

/** 命令跑完了：退出码与合在一起的输出（stdout 在前）。 */
export interface HostCommandResult {
  exitCode: number;
  output: string;
}

export interface HostProcesses {
  // 列出的进程带不带启动时间（Windows 的不带）：不带时只为查 Codex 的后台 app-server 才列（magpie #2341）。
  readonly reportsStartTimes: boolean;
  /** 本机在跑的进程；问不到系统时抛 HostProcessesError，不是「什么都没在跑」。 */
  list(): Promise<HostProcess[]>;
  /** 进程启动时的 CODEX_HOME；读不到（只有 Linux 读得到自己用户的）或没设为 null。 */
  readCodexHome(pid: number): Promise<string | null>;
  /** 执行 Codex 自己的命令要用的 codex，环境盖上 env（CODEX_HOME）；找不到为 null。 */
  findCodex: FindCodexCommand;
  /** 执行一条命令直到它退出；起不来或超时抛 HostProcessesError，退出码不是 0 照常返回。 */
  run(command: HostCommand): Promise<HostCommandResult>;
}

/** 适配器没办成：起不来、超时、问不到系统。调用方当作这次查不到，不挡别的事。 */
export class HostProcessesError extends Error {
  constructor(input: { message: string; cause?: unknown }) {
    super(input.message, { cause: input.cause });
    this.name = "HostProcessesError";
  }
}

/** 测试里造了真的适配器：用例要传假的。 */
export class RealHostProcessesInTestError extends Error {
  constructor() {
    super("The real process table and commands are never used in tests: pass a fake HostProcesses");
    this.name = "RealHostProcessesInTestError";
  }
}

const LIST_TIMEOUT_MS = 10_000;
// 输出只留这么多，免得一条命令把内存撑满。
const OUTPUT_LIMIT_BYTES = 1024 * 1024;

/** ps 的 etime（[[dd-]hh:]mm:ss）换成秒；读不出为 null。 */
export function parseElapsed(text: string): number | null {
  let rest = text.trim();
  if (rest === "") return null;
  let days = 0;
  const dash = rest.indexOf("-");
  if (dash >= 0) {
    const dayText = rest.slice(0, dash);
    if (!/^\d+$/.test(dayText)) return null;
    days = Number(dayText);
    rest = rest.slice(dash + 1);
  }
  const parts = rest.split(":");
  const isClock = parts.length >= 2 && parts.length <= 3 && parts.every((p) => /^\d+$/.test(p));
  if (!isClock) return null;
  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  return days * 86_400 + seconds;
}

/** `ps -A -o pid= -o ppid= -o etime= -o args=` 的输出；读不出的行跳过。 */
export function parseProcessList(input: { output: string; now: Date }): HostProcess[] {
  const processes: HostProcess[] = [];
  for (const line of input.output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (match === null) continue;
    const pid = Number(match[1]);
    const elapsed = parseElapsed(match[3]);
    if (pid <= 0 || elapsed === null) continue;
    processes.push({
      pid,
      parentPid: Number(match[2]),
      startedAt: new Date(input.now.getTime() - elapsed * 1000),
      commandLine: match[4].trim(),
    });
  }
  return processes;
}

/** PowerShell 打的「pid 父 pid 命令行」；命令行读不了的（别的用户的）只有两个数字。 */
function parseWindowsProcessList(output: string): HostProcess[] {
  const processes: HostProcess[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*(.*)$/.exec(line);
    if (match === null || Number(match[1]) <= 0) continue;
    processes.push({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      startedAt: null,
      commandLine: match[3].trim(),
    });
  }
  return processes;
}

/**
 * 真的实现。Windows 照 magpie 只问名字以 codex 开头的进程（问全部很慢），也不带启动时间。
 * 测试里（vitest 设了 VITEST）一造就抛错。
 */
export function createSystemHostProcesses(input: { findCodex: FindCodexCommand }): HostProcesses {
  if (process.env.VITEST) throw new RealHostProcessesInTestError();
  const sealed = sealedHostProcesses();
  if (sealed !== null) return sealed;
  const isWindows = process.platform === "win32";
  return {
    reportsStartTimes: !isWindows,
    readCodexHome: readLinuxCodexHome,
    findCodex: input.findCodex,
    async list() {
      if (isWindows) {
        const result = await runCommand({
          command: "powershell",
          args: [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `Get-CimInstance Win32_Process -Filter "Name like 'codex%'" | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CommandLine)" }`,
          ],
          env: process.env,
          timeoutMs: LIST_TIMEOUT_MS,
        });
        requireSuccess({ name: "Listing processes", result });
        return parseWindowsProcessList(result.output);
      }
      const result = await runCommand({
        command: "ps",
        args: ["-A", "-o", "pid=", "-o", "ppid=", "-o", "etime=", "-o", "args="],
        env: process.env,
        timeoutMs: LIST_TIMEOUT_MS,
      });
      requireSuccess({ name: "Listing processes", result });
      return parseProcessList({ output: result.output, now: new Date() });
    },
    run: runCommand,
  };
}

// 浏览器测试的 daemon 由 e2e 封条（packages/app/e2e/support/daemon-upgrade-seal.mjs）在这里装上假的适配器，
// 列进程、读 CODEX_HOME、找 codex、执行命令都不碰本机；生产里没有它。
const SEALED_HOST_PROCESSES = Symbol.for("paseo.e2e.hostProcesses");

function sealedHostProcesses(): HostProcesses | null {
  const sealed: unknown = Reflect.get(globalThis, SEALED_HOST_PROCESSES);
  if (!isHostProcesses(sealed)) return null;
  return sealed;
}

function isHostProcesses(value: unknown): value is HostProcesses {
  if (typeof value !== "object" || value === null) return false;
  const methods = ["list", "readCodexHome", "findCodex", "run"];
  const hasMethods = methods.every((name) => typeof Reflect.get(value, name) === "function");
  return hasMethods && typeof Reflect.get(value, "reportsStartTimes") === "boolean";
}

/** Linux 上读 /proc/<pid>/environ 里的 CODEX_HOME；别的系统、别人的进程读不到，为 null。 */
async function readLinuxCodexHome(pid: number): Promise<string | null> {
  if (process.platform !== "linux") return null;
  let environ: string;
  try {
    environ = await readFile(`/proc/${pid}/environ`, "utf8");
  } catch (error) {
    if (isErrnoException(error)) return null;
    throw error;
  }
  const entry = environ.split("\0").find((pair) => pair.startsWith("CODEX_HOME="));
  if (entry === undefined) return null;
  return entry.slice("CODEX_HOME=".length) || null;
}

function requireSuccess(input: { name: string; result: HostCommandResult }): void {
  if (input.result.exitCode !== 0) {
    throw new HostProcessesError({
      message: `${input.name} failed (exit ${input.result.exitCode}): ${lastLine(input.result.output)}`,
    });
  }
}

/** 输出的最后一行非空内容，给错误信息用（magpie 的 lastLine）。 */
export function lastLine(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.at(-1) ?? "";
}

/** 起命令、收输出，stdin 不开（Codex 会等着一直开着的 stdin）。 */
function runCommand(command: HostCommand): Promise<HostCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command.command, command.args, {
      stdio: ["ignore", "pipe", "pipe"],
      baseEnv: command.env,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    const keep = (into: Buffer[]) => (chunk: Buffer) => {
      if (size >= OUTPUT_LIMIT_BYTES) return;
      size += chunk.length;
      into.push(chunk);
    };
    child.stdout?.on("data", keep(stdout));
    child.stderr?.on("data", keep(stderr));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new HostProcessesError({
          message: `${command.command} didn't finish in ${command.timeoutMs} ms`,
        }),
      );
    }, command.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(
        new HostProcessesError({
          message: `${command.command} didn't start: ${error.message}`,
          cause: error,
        }),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const output = Buffer.concat([...stdout, ...stderr]).toString("utf8");
      resolve({ exitCode: code ?? -1, output });
    });
  });
}
