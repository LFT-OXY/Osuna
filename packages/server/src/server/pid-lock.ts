import { open, readFile, unlink, utimes } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
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

const PID_LOCK_FILENAME = "osuna.pid";
// COMPAT(pid-lock-paseo-name): added 2026-09-20, remove after 2027-03-20 once the first
// Osuna release is over six months old. 只读不写。触发条件只有一个：OSUNA_HOME 被指向上游
// 的 ~/.paseo（默认是 ~/.osuna，两边互不相干）。此时旧 daemon 持有的是 paseo.pid，只看
// osuna.pid 会判定没有实例在跑，于是起出第二个 daemon 抢同一个端口与同一份 agent 存储。
const PASEO_PID_LOCK_FILENAME = "paseo.pid";

function getPidFilePath(paseoHome: string): string {
  return join(paseoHome, PID_LOCK_FILENAME);
}

/**
 * 改名前的 daemon 仍在跑时返回它的锁，否则返回 null。
 * 注意「读不出来」不等于「不存在」：`readPidLock` 只在文件缺失时返回 null，权限不足或内容
 * 损坏一律抛出。那种情况下无法证明旧 daemon 没在跑，必须让启动失败而不是放行第二个实例。
 */
async function readLivePaseoPidLock(paseoHome: string): Promise<PidLockInfo | null> {
  const lock = await readPidLock(join(paseoHome, PASEO_PID_LOCK_FILENAME));
  return lock && isPidRunning(lock.pid) ? lock : null;
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

function createPaseoLockHeldError(paseoHome: string, lock: PidLockInfo): PidLockError {
  return new PidLockError(
    `A pre-rename Paseo daemon is still running in this home (PID ${lock.pid}, started ${lock.startedAt}, lock file ${join(paseoHome, PASEO_PID_LOCK_FILENAME)}). Stop it, or start Osuna with a different OSUNA_HOME.`,
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

export async function acquirePidLock(
  paseoHome: string,
  listen: string | null,
  options?: AcquirePidLockOptions,
): Promise<void> {
  const pidPath = getPidFilePath(paseoHome);

  ensurePrivateDirectory(paseoHome);

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

  const paseoLock = await readLivePaseoPidLock(paseoHome);
  if (paseoLock) throw createPaseoLockHeldError(paseoHome, paseoLock);

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
  paseoHome: string,
  options?: { ownerPid?: number },
): Promise<void> {
  const pidPath = getPidFilePath(paseoHome);
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
  paseoHome: string,
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
    refreshPidLock(paseoHome, { ownerPid: options?.ownerPid })
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
  paseoHome: string,
  patch: { listen: string | null },
  options?: { ownerPid?: number },
): Promise<void> {
  const pidPath = getPidFilePath(paseoHome);
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
  paseoHome: string,
  options?: { ownerPid?: number; startedAt?: string },
): Promise<void> {
  const pidPath = getPidFilePath(paseoHome);
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

export async function getPidLockInfo(paseoHome: string): Promise<PidLockInfo | null> {
  const pidPath = getPidFilePath(paseoHome);
  return readPidLock(pidPath);
}

export async function isLocked(
  paseoHome: string,
): Promise<{ locked: boolean; info?: PidLockInfo }> {
  const info = await getPidLockInfo(paseoHome);
  if (!info) {
    return { locked: false };
  }
  if (!isPidRunning(info.pid)) {
    return { locked: false, info };
  }
  return { locked: true, info };
}
