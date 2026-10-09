// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import electronBinary from "electron";
import { _electron as electron, expect } from "playwright/test";
import { readDaemonInstance, stopDaemonInstance } from "@osuna/server";

async function getAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  assert.ok(port !== 6767 && port !== 6768);
  return port;
}

// This launch resolves the real default daemon home. Ask Electron's main process
// where the user's home is before anything can migrate, and refuse to continue
// unless the answer is the fixture.
function assertUserHomeIsIsolated({ root, home, env }) {
  const probe = spawnSync(electronBinary, ["--no-sandbox", path.join(root, "probe.cjs")], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.equal(
    probe.stdout.trim(),
    home,
    `Electron resolved the user home outside the fixture: ${probe.stdout} ${probe.stderr}`,
  );
}

// The desktop app starts its own daemon on the default home. A 0.14.x data
// directory that cannot be moved must surface as the start command's own
// failure, carrying the manual command, and the next start must move it.
// Real Electron main process, the built daemon manager, the real @osuna/server.
export async function verifyLegacyHomeMigrationThroughDesktop({ repo, env: baseEnv }) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "osuna desktop legacy home ")));
  const home = path.join(root, "home");
  const legacyHome = path.join(home, ".paseo");
  const osunaHome = path.join(home, ".osuna");
  const port = await getAvailablePort();
  const env = Object.fromEntries(
    Object.entries({
      ...baseEnv,
      HOME: home,
      USERPROFILE: home,
      CFFIXED_USER_HOME: home,
      OSUNA_LOCAL_SPEECH_AUTO_DOWNLOAD: "0",
    }).filter(([key]) => key !== "OSUNA_HOME"),
  );
  const managerPath = path.join(repo, "packages/desktop/dist/daemon/daemon-manager.js");
  const autoUpdaterPath = path.join(repo, "packages/desktop/dist/features/auto-updater.js");
  const userDataDir = path.join(root, "user-data");
  const main = path.join(root, "main.cjs");
  let desktop;
  try {
    await mkdir(legacyHome, { recursive: true });
    await writeFile(
      path.join(legacyHome, "config.json"),
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
    await writeFile(
      path.join(root, "probe.cjs"),
      'const { app } = require("electron"); process.stdout.write(require("node:os").homedir()); app.exit(0);',
    );
    await writeFile(
      main,
      `const { app } = require("electron"); app.setPath("userData", ${JSON.stringify(userDataDir)}); app.whenReady().then(() => { global.lifecycle = require(${JSON.stringify(managerPath)}); global.appUpdates = require(${JSON.stringify(autoUpdaterPath)}).electronAppUpdateCommands; });`,
    );
    assertUserHomeIsIsolated({ root, home, env });

    desktop = await electron.launch({
      args: ["--no-sandbox", "--ozone-platform=headless", main],
      env,
    });
    await expect
      .poll(() => desktop.evaluate(() => Boolean(global.lifecycle)), { timeout: 10_000 })
      .toBe(true);
    const startDesktopDaemon = () =>
      desktop.evaluate(() =>
        global.lifecycle
          .createDaemonCommandHandlers({ appUpdates: global.appUpdates })
          .start_desktop_daemon(),
      );

    // 只读的上级目录让 rename 与复制都失败，和磁盘权限出问题时一样。
    await chmod(home, 0o555);
    let refusal;
    try {
      refusal = await startDesktopDaemon().then(
        () => null,
        (error) => error,
      );
    } finally {
      await chmod(home, 0o755);
    }
    assert.ok(refusal, "start_desktop_daemon started a daemon beside an unmoved legacy home");
    assert.ok(refusal.message.includes(`From: ${legacyHome}`), refusal.message);
    assert.ok(refusal.message.includes(`To: ${osunaHome}`), refusal.message);
    assert.ok(
      refusal.message.includes(
        `mv "${legacyHome}" "${osunaHome}" && ln -s "${osunaHome}" "${legacyHome}"`,
      ),
      refusal.message,
    );
    assert.equal((await lstat(legacyHome)).isDirectory(), true);
    await assert.rejects(lstat(osunaHome), { code: "ENOENT" });
    console.log(
      "PASS: a legacy home that cannot be moved fails the desktop start command with both paths and the manual command.",
    );

    const started = await startDesktopDaemon();
    assert.equal((await lstat(legacyHome)).isSymbolicLink(), true);
    assert.equal(await realpath(legacyHome), osunaHome);
    assert.equal(started.listen, `127.0.0.1:${port}`);
    assert.equal(started.ownedByDesktop, true);
    console.log(
      "PASS: the next desktop start moves the legacy home and runs the daemon on its old configuration.",
    );
  } finally {
    if (desktop) {
      const exited = once(desktop.process(), "exit");
      await desktop.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await exited;
    }
    const instance = await readDaemonInstance(osunaHome).catch(() => null);
    if (instance) {
      await stopDaemonInstance(osunaHome, { instance, force: true, timeoutMs: 5_000 });
    }
    await chmod(home, 0o755).catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
