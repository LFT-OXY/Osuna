import { open, readFile, unlink, utimes } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { isLegacyDaemonProcess, legacyDaemonStopCommand } from "./legacy-daemon-process.js";
import { ensurePrivateDirectory } from "./private-files.js";
import { join } from "node:path";
import { hostname } from "node:os";
import { z } from "zod";

export const pidLockInfoSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string(),
  hostname: z.string(),
  uid: z.number(),
  listen: z.string().nullable(),
  desktopManaged: z.boolean().optional(),
  heartbeat: z.literal(true).optional(),
});

export interface PidLockInfo extends z.infer<typeof pidLockInfoSchema> {}

function parsePidLockInfo(raw: unknown): PidLockInfo | null {
  const result = pidLockInfoSchema.safeParse(raw);
  return result.success ? result.data : null;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

export class PidLockError extends Error {
  constructor(
    message: string,
    public readonly existingLock?: PidLockInfo,
  ) {
    super(message);
    this.name = "PidLockError";
  }
}

const PID_LOCK_HEARTBEAT_INTERVAL_MS = 30_000;
const PID_LOCK_READ_RETRY_ATTEMPTS = 10;
const PID_LOCK_READ_RETRY_DELAY_MS = 50;

export function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrnoException(error) && error.code === "EPERM";
  }
}

function getPidFilePath(osunaHome: string): string {
  return join(osunaHome, "osuna.pid");
}

async function touchPidLockFile(pidPath: string): Promise<void> {
  const now = new Date();
  await utimes(pidPath, now, now);
}

async function readPidLock(pidPath: string): Promise<PidLockInfo | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < PID_LOCK_READ_RETRY_ATTEMPTS; attempt++) {
    try {
      const content = await readFile(pidPath, "utf-8");
      const lock = parsePidLockInfo(JSON.parse(content));
      if (lock) return lock;
      lastError = new Error("Invalid lock shape");
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") return null;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, PID_LOCK_READ_RETRY_DELAY_MS));
  }
  throw Object.assign(
    new PidLockError(`Cannot read daemon state at ${pidPath}: ${String(lastError)}`),
    { code: "DAEMON_STATE_READ_FAILED" },
  );
}

function resolveOwnerPid(ownerPid?: number): number {
  if (typeof ownerPid === "number" && Number.isInteger(ownerPid) && ownerPid > 0) {
    return ownerPid;
  }
  return process.pid;
}

interface AcquirePidLockOptions {
  ownerPid?: number;
}

export function isSamePidLock(left: PidLockInfo, right: PidLockInfo): boolean {
  return left.pid === right.pid && left.startedAt === right.startedAt;
}

function createLockHeldError(lock: PidLockInfo): PidLockError {
  return new PidLockError(
    `Another Osuna daemon is already running (PID ${lock.pid}, started ${lock.startedAt})`,
    lock,
  );
}

async function clearExistingPidLock(
  pidPath: string,
  existingLock: PidLockInfo,
  lockOwnerPid: number,
): Promise<"already_owned" | "cleared"> {
  const lockOwnerRunning = isPidRunning(existingLock.pid);
  if (existingLock.pid === lockOwnerPid && lockOwnerRunning) {
    await touchPidLockFile(pidPath);
    return "already_owned";
  }

  if (lockOwnerRunning) throw createLockHeldError(existingLock);
  const confirmedLock = await readPidLock(pidPath);
  if (
    !confirmedLock ||
    !isSamePidLock(existingLock, confirmedLock) ||
    isPidRunning(confirmedLock.pid)
  ) {
    throw new PidLockError("PID lock changed while checking whether it was abandoned");
  }

  await unlink(pidPath).catch(() => {});
  return "cleared";
}

async function writeNewPidLock(pidPath: string, lockInfo: PidLockInfo): Promise<void> {
  let fd;
  try {
    fd = await open(pidPath, "wx");
    await fd.write(JSON.stringify(lockInfo));
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "EEXIST") {
      throw error;
    }

    const raceLock = await readPidLock(pidPath);
    if (raceLock) {
      throw new PidLockError(
        `Another Osuna daemon is already running (PID ${raceLock.pid})`,
        raceLock,
      );
    }
    throw new PidLockError("Failed to acquire PID lock due to race condition");
  } finally {
    await fd?.close();
  }
}

// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
// 0.14.x 的 daemon 把锁写在 paseo.pid，搬过来的 home 里可能还有一个活着的旧 daemon
// （桌面端开了"退出后保持运行"）。它还活着就不能再起一个去写同一份数据；
// 已经没人持有的旧锁文件是用户数据，原样留着。
async function assertNoLiveLegacyDaemon(osunaHome: string): Promise<void> {
  const legacyLock = await readLiveLegacyPidLock(osunaHome);
  if (!legacyLock) return;
  throw new PidLockError(
    `A 0.14.x daemon is still running in ${osunaHome} (PID ${legacyLock.pid}, started ${legacyLock.startedAt}). Stop it first: ${legacyDaemonStopCommand({ home: osunaHome })}`,
    legacyLock,
  );
}

// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
// 没有这个文件、一直读不出一把锁、持有者已经不在、或者那个 pid 已经换了进程，都等于没有旧 daemon 持锁。
// 读不出时多读几次：旧 daemon 改写锁文件不是原子的，正好撞上会读到半截内容。
export async function readLiveLegacyPidLock(home: string): Promise<PidLockInfo | null> {
  const legacyPidPath = join(home, "paseo.pid");
  for (let attempt = 0; attempt < PID_LOCK_READ_RETRY_ATTEMPTS; attempt += 1) {
    let content: string;
    try {
      content = await readFile(legacyPidPath, "utf-8");
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") return null;
      throw error;
    }
    const lock = parsePidLockJson(content);
    if (lock) return isPidRunning(lock.pid) && (await isLegacyDaemonProcess(lock)) ? lock : null;
    await new Promise((resolve) => setTimeout(resolve, PID_LOCK_READ_RETRY_DELAY_MS));
  }
  return null;
}

function parsePidLockJson(content: string): PidLockInfo | null {
  try {
    return parsePidLockInfo(JSON.parse(content));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function acquirePidLock(
  osunaHome: string,
  listen: string | null,
  options?: AcquirePidLockOptions,
): Promise<void> {
  const pidPath = getPidFilePath(osunaHome);

  ensurePrivateDirectory(osunaHome);
  await assertNoLiveLegacyDaemon(osunaHome);

  // Try to read existing lock
  const existingLock = await readPidLock(pidPath);

  // Check if existing lock is stale
  const lockOwnerPid = resolveOwnerPid(options?.ownerPid);
  if (existingLock) {
    const result = await clearExistingPidLock(pidPath, existingLock, lockOwnerPid);
    if (result === "already_owned") {
      return;
    }
  }

  // Create new lock with exclusive flag
  const lockInfo: PidLockInfo = {
    pid: lockOwnerPid,
    startedAt: new Date().toISOString(),
    hostname: hostname(),
    uid: process.getuid?.() ?? 0,
    listen,
    heartbeat: true,
    ...(process.env.OSUNA_DESKTOP_MANAGED === "1" ? { desktopManaged: true } : {}),
  };

  await writeNewPidLock(pidPath, lockInfo);
}

export async function refreshPidLock(
  osunaHome: string,
  options?: { ownerPid?: number },
): Promise<void> {
  const pidPath = getPidFilePath(osunaHome);
  const lockOwnerPid = resolveOwnerPid(options?.ownerPid);
  let fd;
  try {
    fd = await open(pidPath, "r+");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new PidLockError("Cannot refresh PID lock: lock file is missing");
    }
    throw error;
  }

  try {
    const lock = await readPidLockFromHandleWithRetry(fd);
    if (!lock) {
      throw new PidLockError("Cannot refresh PID lock: invalid lock file");
    }
    if (lock.pid !== lockOwnerPid) {
      throw new PidLockError(`Cannot refresh PID lock owned by PID ${lock.pid}`, lock);
    }
    const now = new Date();
    await fd.utimes(now, now);
  } finally {
    await fd.close();
  }
}

async function readPidLockFromHandle(fd: FileHandle): Promise<PidLockInfo | null> {
  try {
    const { size } = await fd.stat();
    if (size === 0) {
      return null;
    }
    const content = Buffer.alloc(size);
    const { bytesRead } = await fd.read(content, 0, size, 0);
    return parsePidLockInfo(JSON.parse(content.subarray(0, bytesRead).toString("utf-8")));
  } catch {
    return null;
  }
}

async function readPidLockFromHandleWithRetry(fd: FileHandle): Promise<PidLockInfo | null> {
  for (let attempt = 0; attempt < PID_LOCK_READ_RETRY_ATTEMPTS; attempt += 1) {
    const lock = await readPidLockFromHandle(fd);
    if (lock) {
      return lock;
    }
    if (attempt < PID_LOCK_READ_RETRY_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, PID_LOCK_READ_RETRY_DELAY_MS));
    }
  }
  return null;
}

export function startPidLockHeartbeat(
  osunaHome: string,
  options?: {
    ownerPid?: number;
    intervalMs?: number;
    onError?: (error: unknown) => void;
  },
): () => void {
  const intervalMs = options?.intervalMs ?? PID_LOCK_HEARTBEAT_INTERVAL_MS;
  let refreshing = false;

  const timer = setInterval(() => {
    if (refreshing) {
      return;
    }
    refreshing = true;
    refreshPidLock(osunaHome, { ownerPid: options?.ownerPid })
      .catch((error) => {
        if (options?.onError) {
          options.onError(error);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`PID lock heartbeat failed: ${message}\n`);
      })
      .finally(() => {
        refreshing = false;
      });
  }, intervalMs);
  timer.unref();

  return () => clearInterval(timer);
}

export async function updatePidLock(
  osunaHome: string,
  patch: { listen: string | null },
  options?: { ownerPid?: number },
): Promise<void> {
  const pidPath = getPidFilePath(osunaHome);
  const lockOwnerPid = resolveOwnerPid(options?.ownerPid);
  const fd = await open(pidPath, "r+");
  try {
    const existingLock = await readPidLockFromHandleWithRetry(fd);
    if (!existingLock) {
      throw new PidLockError("Cannot update PID lock: invalid lock file");
    }
    if (existingLock.pid !== lockOwnerPid) {
      throw new PidLockError(
        `Cannot update PID lock owned by PID ${existingLock.pid}`,
        existingLock,
      );
    }

    const updatedLock: PidLockInfo = {
      ...existingLock,
      ...patch,
    };
    await fd.truncate(0);
    await fd.writeFile(JSON.stringify(updatedLock));
  } finally {
    await fd.close();
  }
}

export async function releasePidLock(
  osunaHome: string,
  options?: { ownerPid?: number; startedAt?: string },
): Promise<void> {
  const pidPath = getPidFilePath(osunaHome);
  const lockOwnerPid = resolveOwnerPid(options?.ownerPid);
  try {
    // Only remove if it's our lock
    const content = await readFile(pidPath, "utf-8");
    const lock = parsePidLockInfo(JSON.parse(content));
    if (
      lock?.pid === lockOwnerPid &&
      (options?.startedAt === undefined || lock.startedAt === options.startedAt)
    ) {
      await unlink(pidPath);
    }
  } catch {
    // Ignore errors - lock may already be gone
  }
}

export async function getPidLockInfo(osunaHome: string): Promise<PidLockInfo | null> {
  const pidPath = getPidFilePath(osunaHome);
  return readPidLock(pidPath);
}

export async function isLocked(
  osunaHome: string,
): Promise<{ locked: boolean; info?: PidLockInfo }> {
  const info = await getPidLockInfo(osunaHome);
  if (!info) {
    return { locked: false };
  }
  if (!isPidRunning(info.pid)) {
    return { locked: false, info };
  }
  return { locked: true, info };
}
