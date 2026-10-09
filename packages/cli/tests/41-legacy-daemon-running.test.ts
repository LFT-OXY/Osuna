#!/usr/bin/env npx tsx
// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first

import "./helpers/isolated-os-home.ts";
import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $, type ProcessPromise } from "zx";
import { getAvailablePort } from "./helpers/network.ts";

$.verbose = false;

const CLI_ENTRY = join(import.meta.dirname, "..", "dist", "index.js");
const cleanupPaths: string[] = [];
const legacyDaemons: ChildProcess[] = [];

function userHome(): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "osuna-legacy-daemon-")));
  cleanupPaths.push(home);
  return home;
}

// 环境只带这里写明的变量：开发机 shell 里残留的旧变量不能混进断言。
function runOsuna(args: string[], home: string, env: NodeJS.ProcessEnv = {}): ProcessPromise {
  return $({
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, ...env },
  })`${process.execPath} ${CLI_ENTRY} ${args}`.nothrow();
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface LegacyInstall {
  home: string;
  legacyHome: string;
  osunaHome: string;
  port: number;
  daemon: ChildProcess;
  startedAt: string;
  lock: string;
}

// 0.14.x 的数据目录，外加一个只会活着的进程顶替它的 supervisor：pid 写在旧名字的锁文件里。
async function seedRunningLegacyDaemon(): Promise<LegacyInstall> {
  const home = userHome();
  const legacyHome = join(home, ".paseo");
  const port = await getAvailablePort();
  mkdirSync(legacyHome);
  writeFileSync(
    join(legacyHome, "config.json"),
    `${JSON.stringify({
      version: 1,
      daemon: { listen: `127.0.0.1:${port}`, relay: { enabled: false } },
      features: {
        webUi: { enabled: false },
        dictation: { enabled: false },
        voiceMode: { enabled: false },
      },
    })}\n`,
  );
  const daemon = spawn(
    process.execPath,
    ["-e", 'setInterval(() => {}, 1000); process.stdout.write("ready");'],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  legacyDaemons.push(daemon);
  await once(daemon.stdout!, "data");
  // 锁是 daemon 起来之后才写的，所以写锁的时刻不早于持有它的进程的启动时刻。
  const startedAt = new Date().toISOString();
  const lock = JSON.stringify({
    pid: daemon.pid,
    startedAt,
    hostname: "current-host",
    uid: process.getuid?.() ?? 0,
    listen: `127.0.0.1:${port}`,
    desktopManaged: true,
    heartbeat: true,
  });
  writeFileSync(join(legacyHome, "paseo.pid"), lock);
  return { home, legacyHome, osunaHome: join(home, ".osuna"), port, daemon, startedAt, lock };
}

function assertNothingMoved(install: LegacyInstall): void {
  assert.deepStrictEqual(readdirSync(install.home), [".paseo"]);
  assert.strictEqual(lstatSync(install.legacyHome).isDirectory(), true);
  assert.strictEqual(readFileSync(join(install.legacyHome, "paseo.pid"), "utf8"), install.lock);
}

function refusalFor(install: LegacyInstall): string {
  return [
    `A 0.14.x daemon is still running from ${install.legacyHome} (PID ${install.daemon.pid}, started ${install.startedAt}).`,
    "Osuna 1.0.0 will not move or share its data while it runs. Stop it, then try again:",
    `  osuna daemon stop --home "${install.legacyHome}"`,
  ].join("\n");
}

console.log("=== Upgrading while a 0.14.x daemon is still running ===\n");

try {
  const install = await seedRunningLegacyDaemon();
  const env = { OSUNA_LOCAL_SPEECH_AUTO_DOWNLOAD: "0" };

  {
    console.log("Test 1: a command refuses and leaves the data where the running daemon has it");
    const result = await runOsuna(["ls"], install.home);

    assert.strictEqual(result.exitCode, 1);
    assert.ok(result.stderr.includes(refusalFor(install)), result.stderr);
    assertNothingMoved(install);
    console.log("✓ exits non-zero naming the daemon and how to stop it\n");
  }

  {
    console.log("Test 2: a command aimed at another host refuses before it writes a client id");
    const unusedPort = await getAvailablePort();
    const result = await runOsuna(["ls", "--host", `127.0.0.1:${unusedPort}`], install.home);

    assert.strictEqual(result.exitCode, 1);
    assert.ok(result.stderr.includes(refusalFor(install)), result.stderr);
    assertNothingMoved(install);
    console.log("✓ no empty home appears ahead of the move\n");
  }

  {
    console.log("Test 3: starting the daemon refuses instead of moving the data");
    const result = await runOsuna(["daemon", "start", "--json"], install.home, env);

    assert.strictEqual(result.exitCode, 1);
    assert.ok(result.stderr.includes("osuna daemon stop"), result.stderr);
    assert.strictEqual(isRunning(install.daemon.pid!), true);
    assertNothingMoved(install);
    console.log("✓ the 0.14.x daemon keeps running on its own directory\n");
  }

  {
    console.log("Test 4: daemon status recognises the 0.14.x daemon");
    const result = await runOsuna(["daemon", "status", "--json"], install.home);

    assert.strictEqual(result.exitCode, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      home: install.legacyHome,
      pid: install.daemon.pid,
      startedAt: install.startedAt,
      listen: `127.0.0.1:${install.port}`,
      localDaemon: "legacy_running",
      desktopManaged: true,
      connectedDaemon: "not_probed",
      note: `A 0.14.x daemon is still running. Osuna 1.0.0 cannot connect to it or use its data until it stops. Stop it with: osuna daemon stop --home "${install.legacyHome}"`,
    });
    assertNothingMoved(install);

    const shortcut = await runOsuna(["status"], install.home);
    assert.strictEqual(shortcut.exitCode, 0, shortcut.stderr);
    assert.ok(shortcut.stdout.includes("localDaemon: legacy_running"), shortcut.stdout);
    assert.ok(shortcut.stdout.includes("Stop it with: osuna daemon stop"), shortcut.stdout);
    assertNothingMoved(install);

    // 设了 OSUNA_HOST 时不带 --home 的命令指向别的主机；提示里给的写法要照样认得出它。
    const remoteEnv = { OSUNA_HOST: "127.0.0.1:1" };
    const aimedElsewhere = await runOsuna(["daemon", "stop"], install.home, remoteEnv);
    assert.strictEqual(aimedElsewhere.exitCode, 1);
    assert.ok(aimedElsewhere.stderr.includes(refusalFor(install)), aimedElsewhere.stderr);
    const hinted = await runOsuna(
      ["daemon", "status", "--home", install.legacyHome, "--json"],
      install.home,
      remoteEnv,
    );
    assert.strictEqual(hinted.exitCode, 0, hinted.stderr);
    assert.strictEqual(JSON.parse(hinted.stdout).localDaemon, "legacy_running");
    assert.strictEqual(isRunning(install.daemon.pid!), true);
    assertNothingMoved(install);
    console.log("✓ reports its pid, endpoint and how to stop it, without touching the data\n");
  }

  {
    console.log("Test 5: daemon stop stops the 0.14.x daemon and moves nothing");
    const exited = once(install.daemon, "exit");
    const result = await runOsuna(["daemon", "stop", "--json"], install.home);
    await exited;

    assert.strictEqual(result.exitCode, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      action: "stopped",
      pid: install.daemon.pid,
      forced: false,
      usedLifecycleRpc: false,
      home: install.legacyHome,
    });
    assert.strictEqual(isRunning(install.daemon.pid!), false);
    assert.deepStrictEqual(readdirSync(install.home), [".paseo"]);
    assert.strictEqual(lstatSync(install.legacyHome).isDirectory(), true);
    console.log("✓ the process is gone and its directory is still in place\n");
  }

  {
    console.log("Test 6: the next start moves the data and runs on it");
    const started = await runOsuna(["daemon", "start", "--json"], install.home, env);
    try {
      assert.strictEqual(started.exitCode, 0, started.stderr);
      assert.strictEqual(JSON.parse(started.stdout).listen, `127.0.0.1:${install.port}`);
      assert.strictEqual(lstatSync(install.legacyHome).isSymbolicLink(), true);
      assert.strictEqual(realpathSync(install.legacyHome), install.osunaHome);

      const status = await runOsuna(["daemon", "status", "--json"], install.home, env);
      assert.strictEqual(JSON.parse(status.stdout).localDaemon, "running");
    } finally {
      await runOsuna(["daemon", "stop", "--force"], install.home, env);
    }
    console.log("✓ ~/.osuna holds the old data and ~/.paseo links to it\n");
  }
} finally {
  for (const daemon of legacyDaemons) {
    if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGKILL");
  }
  for (const target of cleanupPaths) rmSync(target, { recursive: true, force: true });
}

console.log("=== All legacy daemon tests passed ===");
