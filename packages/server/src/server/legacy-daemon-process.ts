// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// 锁是 supervisor 起来之后才写的，持有它的进程不会比锁更晚启动。余量留给 ps 的秒级精度。
const STARTED_AFTER_LOCK_TOLERANCE_MS = 5_000;
// 0.14.x 的 supervisor 给自己起的进程名。
const LEGACY_SUPERVISOR_TITLE = "Paseo Supervisor";
const ETIME_AND_ARGS = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s+(.*)$/;

export interface LegacyLockOwner {
  pid: number;
  startedAt: string;
}

// 停掉它的命令。把它的锁文件所在的目录点出来：不带 --home 的写法在设了 OSUNA_HOST 时指向别的主机。
// Windows 上没有让它自己收尾的通道，stop 要带 --force 才肯动手。
export function legacyDaemonStopCommand(
  daemon: { home: string },
  force = process.platform === "win32",
): string {
  // 路径原样放进引号：JSON 转义会把 Windows 路径的反斜杠翻倍。
  return `osuna daemon stop --home "${daemon.home}"${force ? " --force" : ""}`;
}

interface ObservedProcess {
  startedAt: number;
  title: string | null;
}

// 只看 pid 是否在跑，会把崩溃或断电后被别的进程复用了的 pid 当成旧 daemon：命令全被拦住，
// 停它的时候杀到的是无关进程。所以再核对一次：比锁还晚启动的进程不是写下这把锁的那个。
// 查不出来一律当它还是旧 daemon。认错只是多拦一次，放错是在活着的 daemon 脚下搬目录。
export async function isLegacyDaemonProcess(owner: LegacyLockOwner): Promise<boolean> {
  const lockWrittenAt = Date.parse(owner.startedAt);
  if (!Number.isFinite(lockWrittenAt)) return true;
  const observed = await observeProcess(owner.pid);
  if (!observed) return true;
  // Linux 上的启动时刻是拿当前时钟倒推的，启动之后时钟被往前拨过就会算晚。认得出进程名就不看时间。
  if (observed.title?.startsWith(LEGACY_SUPERVISOR_TITLE)) return true;
  return observed.startedAt - lockWrittenAt <= STARTED_AFTER_LOCK_TOLERANCE_MS;
}

async function observeProcess(pid: number): Promise<ObservedProcess | null> {
  try {
    return process.platform === "win32"
      ? await observeWindowsProcess(pid)
      : await observePosixProcess(pid);
  } catch (error) {
    // 没有这个命令、命令不认这些列、进程刚好退出：都算查不出来。
    if (error instanceof Error) return null;
    throw error;
  }
}

async function observePosixProcess(pid: number): Promise<ObservedProcess | null> {
  const { stdout } = await execFileAsync("ps", ["-o", "etime=,args=", "-p", String(pid)], {
    env: { ...process.env, LC_ALL: "C" },
  });
  const match = ETIME_AND_ARGS.exec(stdout.split("\n")[0] ?? "");
  if (!match) return null;
  const [, days = "0", hours = "0", minutes, seconds, title] = match;
  const elapsedSeconds =
    ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
  return { startedAt: Date.now() - elapsedSeconds * 1000, title };
}

// Windows 的进程列表里看不到 supervisor 给自己起的名字，只有启动时刻可比。
async function observeWindowsProcess(pid: number): Promise<ObservedProcess | null> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString("o")`,
    ],
    { windowsHide: true },
  );
  const startedAt = Date.parse(stdout.trim());
  return Number.isFinite(startedAt) ? { startedAt, title: null } : null;
}
