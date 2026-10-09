// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { findRunningLegacyDaemon, stopLegacyDaemon, type LegacyDaemon } from "./legacy-daemon.js";
import { isPidRunning } from "./pid-lock.js";

// 锁是 daemon 起来之后才写的，所以写锁的时刻不早于持有它的进程的启动时刻。
const STARTED_AT = new Date().toISOString();

let homeDir: string;
let legacyHome: string;
let home: string;
const processes = new Set<ChildProcess>();

beforeEach(() => {
  homeDir = realpathSync(mkdtempSync(path.join(tmpdir(), "legacy-daemon-")));
  legacyHome = path.join(homeDir, ".paseo");
  home = path.join(homeDir, ".osuna");
});

afterEach(async () => {
  for (const child of processes) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
  }
  processes.clear();
  rmSync(homeDir, { recursive: true, force: true });
});

function writeLegacyLock(
  directory: string,
  pid: number,
  desktopManaged = true,
  startedAt = STARTED_AT,
): string {
  mkdirSync(directory, { recursive: true });
  const lock = JSON.stringify({
    pid,
    startedAt,
    hostname: "current-host",
    uid: process.getuid?.() ?? 0,
    listen: "127.0.0.1:6767",
    desktopManaged,
    heartbeat: true,
  });
  writeFileSync(path.join(directory, "paseo.pid"), lock);
  return lock;
}

// 一个只会活着的进程，代替 0.14.x 的 supervisor。等它报了 ready 再用，信号处理器才装好。
async function startFakeLegacyDaemon(script: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", `${script}; process.stdout.write("ready");`], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  processes.add(child);
  await once(child.stdout!, "data");
  return child;
}

const STAYS_ALIVE = "setInterval(() => {}, 1000)";
const IGNORES_SIGTERM = `process.on("SIGTERM", () => {}); ${STAYS_ALIVE}`;

function legacyDaemon(pid: number): LegacyDaemon {
  return {
    home: legacyHome,
    pid,
    startedAt: STARTED_AT,
    listen: "127.0.0.1:6767",
    desktopManaged: true,
  };
}

describe("findRunningLegacyDaemon", () => {
  test("finds the 0.14.x daemon still running from a legacy home that has not been moved", async () => {
    writeLegacyLock(legacyHome, process.pid);

    expect(await findRunningLegacyDaemon({ explicitHome: undefined, homeDir })).toEqual(
      legacyDaemon(process.pid),
    );
    expect(readdirSync(homeDir)).toEqual([".paseo"]);
  });

  test("finds the 0.14.x daemon running through the link after the home was moved", async () => {
    writeLegacyLock(home, process.pid, false);
    symlinkSync(home, legacyHome, "dir");

    expect(await findRunningLegacyDaemon({ explicitHome: undefined, homeDir })).toEqual({
      ...legacyDaemon(process.pid),
      home,
      desktopManaged: false,
    });
  });

  test("looks only inside an explicitly chosen home", async () => {
    writeLegacyLock(legacyHome, process.pid);
    const explicitHome = path.join(homeDir, "custom-home");

    expect(await findRunningLegacyDaemon({ explicitHome, homeDir })).toBeNull();

    writeLegacyLock(explicitHome, process.pid);
    expect(await findRunningLegacyDaemon({ explicitHome, homeDir })).toEqual({
      ...legacyDaemon(process.pid),
      home: explicitHome,
    });
  });

  test("leaves a 0.14.x daemon on its own directory alone once the Osuna home exists beside it", async () => {
    writeLegacyLock(legacyHome, process.pid);
    mkdirSync(home);

    expect(await findRunningLegacyDaemon({ explicitHome: undefined, homeDir })).toBeNull();
  });

  test.skipIf(process.platform === "win32")(
    "does not take a process started after the lock was written for the 0.14.x daemon",
    async () => {
      // 崩溃或断电留下的旧锁，pid 后来被别的进程复用：这里用今天才起的测试进程顶替那个进程。
      writeLegacyLock(legacyHome, process.pid, true, "2026-01-01T00:00:00.000Z");

      expect(await findRunningLegacyDaemon({ explicitHome: undefined, homeDir })).toBeNull();
    },
  );

  test("finds nothing and creates nothing when the lock file's owner is gone", async () => {
    writeLegacyLock(legacyHome, 2_147_483_646);

    expect(await findRunningLegacyDaemon({ explicitHome: undefined, homeDir })).toBeNull();
    expect(readdirSync(homeDir)).toEqual([".paseo"]);
  });
});

describe.skipIf(process.platform === "win32")("stopLegacyDaemon", () => {
  test("stops the daemon and leaves the lock file as the daemon left it", async () => {
    const child = await startFakeLegacyDaemon(STAYS_ALIVE);
    const lock = writeLegacyLock(legacyHome, child.pid!);

    const result = await stopLegacyDaemon(legacyDaemon(child.pid!));

    expect(result).toEqual({ pid: child.pid, forced: false });
    expect(isPidRunning(child.pid!)).toBe(false);
    expect(readFileSync(path.join(legacyHome, "paseo.pid"), "utf8")).toBe(lock);
    expect(await findRunningLegacyDaemon({ explicitHome: undefined, homeDir })).toBeNull();
  });

  test("reports a daemon that does not exit in time and leaves its lock file alone", async () => {
    const child = await startFakeLegacyDaemon(IGNORES_SIGTERM);
    const lock = writeLegacyLock(legacyHome, child.pid!);

    await expect(stopLegacyDaemon(legacyDaemon(child.pid!), { timeoutMs: 300 })).rejects.toThrow(
      `Timed out waiting for the 0.14.x daemon (PID ${child.pid}) in ${legacyHome} to exit; use --force to permit forced cleanup.`,
    );

    expect(isPidRunning(child.pid!)).toBe(true);
    expect(readFileSync(path.join(legacyHome, "paseo.pid"), "utf8")).toBe(lock);
  });

  test("kills a daemon that does not exit in time when force is permitted", async () => {
    const child = await startFakeLegacyDaemon(IGNORES_SIGTERM);
    writeLegacyLock(legacyHome, child.pid!);

    const result = await stopLegacyDaemon(legacyDaemon(child.pid!), {
      timeoutMs: 300,
      force: true,
    });

    expect(result).toEqual({ pid: child.pid, forced: true });
    expect(isPidRunning(child.pid!)).toBe(false);
  });
});
