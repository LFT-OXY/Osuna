import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { isErrnoException } from "../../utils/errno.js";

/*
 * 跨进程锁：同一个 $PASEO_HOME 上可能跑着两个 daemon（桌面端与终端里起的），续期这种「读、发请求、写回」
 * 必须一次只有一个在做（magpie 的 .renew.lock）。用 O_EXCL 建锁文件；持有者崩掉留下的锁过一分钟算作废。
 */

const RETRY_MS = 50;
// 一次续期最多 30 秒（codex-oauth.ts），超过它两倍还在的锁是崩掉的进程留下的。
const STALE_MS = 60_000;
const WAIT_MS = 90_000;

export async function withFileLock<T>(lockPath: string, run: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const started = Date.now();
  // 锁文件里写自己的记号：放锁时只删自己的那份，作废后被别人重建的不动。
  const owner = `${process.pid}:${randomUUID()}`;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(owner);
      await handle.close();
      break;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST") throw error;
      const held = await stat(lockPath).catch(() => null);
      if (held && Date.now() - held.mtimeMs > STALE_MS) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() - started > WAIT_MS) {
        throw new Error(`Timed out waiting for ${path.basename(lockPath)}`, { cause: error });
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
  try {
    return await run();
  } finally {
    const holder = await readFile(lockPath, "utf8").catch(() => null);
    if (holder === owner) await rm(lockPath, { force: true });
  }
}
