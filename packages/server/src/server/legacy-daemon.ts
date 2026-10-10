// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
import { lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import treeKill from "tree-kill";

import { DaemonInstanceError } from "./daemon-instance.js";
import { resolveOsunaHome } from "./osuna-home.js";
import { isPidRunning, readLiveLegacyPidLock } from "./pid-lock.js";

// 仍在运行的 0.14.x daemon：桌面端开了"退出后保持运行"的用户升级后，它还占着数据目录。
export interface LegacyDaemon {
  // 它的锁文件所在的目录：还没搬的旧 home，或者已经搬过来的新 home。
  home: string;
  pid: number;
  startedAt: string;
  listen: string | null;
  desktopManaged: boolean;
}

export async function findLegacyDaemonInHome(home: string): Promise<LegacyDaemon | null> {
  const lock = await readLiveLegacyPidLock(home);
  if (!lock) return null;
  return {
    home,
    pid: lock.pid,
    startedAt: lock.startedAt,
    listen: lock.listen,
    desktopManaged: lock.desktopManaged === true,
  };
}

export interface RunningLegacyDaemonInput {
  // 用户显式选定的 home：OSUNA_HOME 或 --home 的值，两者都没给时是 undefined。
  explicitHome: string | undefined;
  homeDir?: string;
}

// 找的是占着 1.0.0 要用的那份数据的旧 daemon。显式选定的 home 只看它自己，和迁移一样不去碰旧目录。
// 默认 home 已经在了就只看它（0.14.x 经链接跑在上面）；还不在，才看等着被搬过来的旧目录。
// 两个真实目录并存时以新 home 为准，旧目录上的 daemon 用的是另一份数据，不归这里管。
export async function findRunningLegacyDaemon(
  input: RunningLegacyDaemonInput,
): Promise<LegacyDaemon | null> {
  const { explicitHome, homeDir = os.homedir() } = input;
  if (explicitHome !== undefined) {
    return findLegacyDaemonInHome(resolveOsunaHome({ OSUNA_HOME: explicitHome }));
  }
  const home = path.join(homeDir, ".osuna");
  if (await exists(home)) return findLegacyDaemonInHome(home);
  return findLegacyDaemonInHome(path.join(homeDir, ".paseo"));
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export interface StopLegacyDaemonOptions {
  force?: boolean;
  timeoutMs?: number;
  killTimeoutMs?: number;
}

export interface StoppedLegacyDaemon {
  pid: number;
  forced: boolean;
}

// 1.0.0 的客户端在握手处就拒绝 0.14.x，发不出关停请求，所以按 pid 停。
// Windows 上没有能让它自己收尾的信号，只有强杀这一条路，要调用方明说允许。
// 它留下的锁文件不删：被强杀的 daemon 来不及自己删，但那个 pid 再被复用时身份核对认得出来。
export async function stopLegacyDaemon(
  daemon: LegacyDaemon,
  options: StopLegacyDaemonOptions = {},
): Promise<StoppedLegacyDaemon> {
  const { force = false, timeoutMs = 15_000, killTimeoutMs = 3_000 } = options;
  const { pid, home } = daemon;
  if (pid <= 1 || pid === process.pid)
    throw new DaemonInstanceError("STOP_INVALID_PID", `Refusing to stop invalid daemon PID ${pid}`);

  let forced = false;
  if (process.platform === "win32") {
    if (!force)
      throw new DaemonInstanceError(
        "STOP_NO_GRACEFUL_CHANNEL",
        `The 0.14.x daemon (PID ${pid}) in ${home} has no graceful shutdown channel. Use --force explicitly to terminate it.`,
      );
    await killTree(pid);
    forced = true;
  } else {
    signalIfRunning(pid, "SIGTERM");
  }

  let stopped = await waitForExit(pid, forced ? killTimeoutMs : timeoutMs);
  if (!stopped && force && !forced) {
    await killTree(pid);
    forced = true;
    stopped = await waitForExit(pid, killTimeoutMs);
  }
  if (!stopped)
    throw new DaemonInstanceError(
      "STOP_NOT_CONFIRMED",
      `Timed out waiting for the 0.14.x daemon (PID ${pid}) in ${home} to exit${force ? "" : "; use --force to permit forced cleanup"}.`,
    );
  return { pid, forced };
}

function signalIfRunning(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function killTree(pid: number): Promise<void> {
  return new Promise((resolve, reject) =>
    treeKill(pid, "SIGKILL", (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    }),
  );
}

async function waitForExit(pid: number, waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  while (isPidRunning(pid)) {
    if (Date.now() >= deadline) return false;
    await delay(100);
  }
  return true;
}

// 停掉它的命令。把它的锁文件所在的目录点出来：不带 --home 的写法在设了 OSUNA_HOST 时指向别的主机。
// Windows 上没有让它自己收尾的通道，stop 要带 --force 才肯动手。
export function legacyDaemonStopCommand(
  daemon: LegacyDaemon,
  force = process.platform === "win32",
): string {
  // 路径原样放进引号：JSON 转义会把 Windows 路径的反斜杠翻倍。
  return `osuna daemon stop --home "${daemon.home}"${force ? " --force" : ""}`;
}

export class LegacyDaemonRunningError extends Error {
  readonly code = "LEGACY_DAEMON_RUNNING";
  readonly daemon: LegacyDaemon;

  constructor(daemon: LegacyDaemon) {
    super(
      [
        `A 0.14.x daemon is still running from ${daemon.home} (PID ${daemon.pid}, started ${daemon.startedAt}).`,
        "Osuna 1.0.0 will not move or share its data while it runs. Stop it, then try again:",
        `  ${legacyDaemonStopCommand(daemon)}`,
      ].join("\n"),
    );
    this.name = "LegacyDaemonRunningError";
    this.daemon = daemon;
  }
}
