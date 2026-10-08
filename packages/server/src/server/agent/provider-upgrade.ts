import { once } from "node:events";
import { realpath } from "node:fs/promises";
import type { ChildProcess } from "node:child_process";
import type { Logger } from "pino";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type {
  ProviderUpgradeErrorCode,
  ProviderUpgradeResponsePayload,
} from "@getpaseo/protocol/messages";
import { spawnProcess } from "../../utils/spawn.js";
import { terminateWithTreeKill } from "../../utils/tree-kill.js";
import type { ProviderCliLaunch } from "./provider-cli-version.js";
import {
  clipUpgradeOutput,
  hasProviderUpgradeCommand,
  resolveProviderUpgradeCommand,
} from "./provider-upgrade-command.js";

/*
 * 一键升级内置提供方的 CLI：用它实际启动的可执行文件执行自带的升级命令，结束后（不论成败）
 * 刷新这个提供方的快照、清掉它的最新版本缓存。同一个提供方同时只跑一次；不拦截正在跑的会话。
 */

const DEFAULT_UPGRADE_TIMEOUT_MS = 10 * 60 * 1000;
// 超时或 daemon 关闭时先 SIGTERM 整棵进程树，等这么久还不退就 SIGKILL。
const TERMINATE_GRACE_MS = 3_000;
// CLI 退出后最多再等这么久收完输出：它留下的后台进程可能一直占着管道。
const OUTPUT_DRAIN_MS = 2_000;

export type ProviderUpgradeResult = Omit<ProviderUpgradeResponsePayload, "requestId">;

interface UpgradeFailure {
  errorCode: ProviderUpgradeErrorCode;
  error: string;
}

export interface ProviderUpgradeServiceOptions {
  /** 设置页快照里的这一项，不等探测。 */
  readProvider: (provider: string) => Promise<ProviderSnapshotEntry | undefined>;
  resolveCliLaunch: (provider: string) => Promise<ProviderCliLaunch | null>;
  /** 重新探测这个提供方（会重新取已装版本）。 */
  refreshProvider: (provider: string) => Promise<void>;
  /** 清掉这个提供方的最新版本缓存。 */
  forgetLatestVersion: (provider: string) => void;
  timeoutMs?: number;
  logger: Logger;
}

interface CommandOutcome {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  spawnError?: string;
}

export class ProviderUpgradeService {
  private readonly options: ProviderUpgradeServiceOptions;
  private readonly timeoutMs: number;
  private readonly running = new Set<string>();
  private readonly abort = new AbortController();

  constructor(options: ProviderUpgradeServiceOptions) {
    this.options = options;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_UPGRADE_TIMEOUT_MS;
  }

  async upgrade(provider: string): Promise<ProviderUpgradeResult> {
    // 先占位再 await，两个几乎同时到的请求才不会都通过检查。
    if (this.running.has(provider)) {
      return {
        provider,
        ok: false,
        errorCode: "in_progress",
        error: `An upgrade of ${provider} is already running`,
      };
    }
    this.running.add(provider);
    try {
      return await this.runUpgrade(provider);
    } finally {
      this.running.delete(provider);
    }
  }

  dispose(): void {
    this.abort.abort();
  }

  private async runUpgrade(provider: string): Promise<ProviderUpgradeResult> {
    const entry = await this.options.readProvider(provider);
    if (entry?.source !== "builtin") {
      return unsupported(provider);
    }
    // 没有升级命令的提供方不必先找可执行文件。
    if (!hasProviderUpgradeCommand(provider)) {
      return unsupported(provider);
    }
    const launch = await this.options.resolveCliLaunch(provider);
    if (!launch) {
      return {
        provider,
        ok: false,
        errorCode: "not_installed",
        error: `The ${provider} CLI was not found`,
      };
    }
    // 解析不了（比如刚被删掉）就按原路径判断：只会更可能落到"判断不出"，不会选错升级方式。
    const executableRealPath = await realpath(launch.executable).catch(() => launch.executable);
    const command = resolveProviderUpgradeCommand({
      provider,
      launch,
      executableRealPath,
      platform: process.platform,
    });
    if (command.kind === "unsupported") {
      return unsupported(provider);
    }
    if (command.kind === "install_method_unknown") {
      return {
        provider,
        ok: false,
        errorCode: "install_method_unknown",
        error: `Could not tell how ${provider} was installed from ${executableRealPath}`,
      };
    }

    const commandLine = [command.command, ...command.args].join(" ");
    this.options.logger.info({ provider, command: commandLine }, "Upgrading provider CLI");
    const envOverlay = { ...launch.env.envOverlay, ...command.env };
    const outcome = await runUpgradeCommand({
      command: command.command,
      args: command.args,
      env: { ...launch.env, envOverlay },
      timeoutMs: this.timeoutMs,
      signal: this.abort.signal,
    });
    this.options.logger.info(
      { provider, exitCode: outcome.exitCode, timedOut: outcome.timedOut },
      "Provider CLI upgrade finished",
    );

    const version = await this.settle(provider);
    const failure =
      describeCommandFailure({ outcome, commandLine, timeoutMs: this.timeoutMs }) ??
      describeUnchangedVersion({ commandLine, before: entry.version, after: version });
    const result: ProviderUpgradeResult = {
      provider,
      ok: failure === null,
      output: clipUpgradeOutput(outcome.output),
    };
    if (version) result.version = version;
    if (failure) {
      result.errorCode = failure.errorCode;
      result.error = failure.error;
    }
    return result;
  }

  // 命令跑完以后：清缓存、重新探测，返回探测到的已装版本。刷新失败只记日志，升级结果照常返回。
  private async settle(provider: string): Promise<string | undefined> {
    this.options.forgetLatestVersion(provider);
    try {
      await this.options.refreshProvider(provider);
    } catch (error) {
      this.options.logger.warn(
        { err: error, provider },
        "Failed to refresh provider after upgrade",
      );
    }
    return (await this.options.readProvider(provider))?.version;
  }
}

function unsupported(provider: string): ProviderUpgradeResult {
  return {
    provider,
    ok: false,
    errorCode: "unsupported",
    error: `${provider} cannot be upgraded automatically`,
  };
}

function describeCommandFailure(input: {
  outcome: CommandOutcome;
  commandLine: string;
  timeoutMs: number;
}): UpgradeFailure | null {
  const { outcome, commandLine } = input;
  if (outcome.timedOut) {
    const seconds = Math.round(input.timeoutMs / 1000);
    return { errorCode: "timeout", error: `${commandLine} timed out after ${seconds}s` };
  }
  if (outcome.spawnError !== undefined) {
    return { errorCode: "command_failed", error: outcome.spawnError };
  }
  if (outcome.exitCode !== 0) {
    return {
      errorCode: "command_failed",
      error: `${commandLine} exited with code ${outcome.exitCode}`,
    };
  }
  return null;
}

// 退出码为 0 但版本没动：CLI 自带的升级子命令对包管理器装的版本常常只打印提示。
// 前后任一次读不出版本时只按退出码判断，读不出不算失败。
function describeUnchangedVersion(input: {
  commandLine: string;
  before: string | undefined;
  after: string | undefined;
}): UpgradeFailure | null {
  const { before, after } = input;
  const bothVersionsRead = Boolean(before) && Boolean(after);
  if (!bothVersionsRead || before !== after) return null;
  return {
    errorCode: "version_unchanged",
    error: `${input.commandLine} exited cleanly but the version is still ${after}`,
  };
}

// stdout 与 stderr 按到达顺序合进一段文字；超时或 daemon 关闭时终止整棵进程树。
// stdin 接空，升级命令要交互时读到 EOF，不会一直挂着。
async function runUpgradeCommand(input: {
  command: string;
  args: string[];
  env: ProviderCliLaunch["env"];
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<CommandOutcome> {
  let output = "";
  let timedOut = false;
  let spawnError: string | undefined;
  const child = spawnProcess(input.command, input.args, {
    ...input.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // 边收边截，输出再长内存也有上限。
  const append = (chunk: Buffer) => {
    output = clipUpgradeOutput(output + chunk.toString("utf8"));
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  // 一直挂着：没有 error 监听时，子进程后来的 error 会让 daemon 崩掉。
  child.on("error", (error) => {
    spawnError = error.message;
  });

  const terminate = () => {
    void terminateWithTreeKill(child, {
      gracefulTimeoutMs: TERMINATE_GRACE_MS,
      forceTimeoutMs: TERMINATE_GRACE_MS,
    });
  };
  const timer = setTimeout(() => {
    timedOut = true;
    terminate();
  }, input.timeoutMs);
  input.signal.addEventListener("abort", terminate, { once: true });

  // close 可能紧跟 exit 同步发出，所以在等 exit 之前就开始听。
  const closed = once(child, "close").then(
    () => undefined,
    () => undefined,
  );
  // 以 CLI 本身退出为准，不等管道关闭；启动失败时没有 exit，只有 error。
  let exitCode: number | null = null;
  try {
    [exitCode] = (await once(child, "exit")) as [number | null];
  } catch {
    // spawnError 已由上面的监听记下。
  }
  clearTimeout(timer);
  input.signal.removeEventListener("abort", terminate);
  await drainOutput({ child, closed });
  return { exitCode, output, timedOut, spawnError };
}

async function drainOutput(input: { child: ChildProcess; closed: Promise<void> }): Promise<void> {
  const { child, closed } = input;
  let timer: NodeJS.Timeout | undefined;
  const gaveUp = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, OUTPUT_DRAIN_MS);
  });
  await Promise.race([closed, gaveUp]);
  clearTimeout(timer);
  child.stdout?.destroy();
  child.stderr?.destroy();
}
