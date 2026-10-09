// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import electronBinary from "electron";
import { expect } from "playwright/test";

const LEGACY_SETTINGS = {
  version: 1,
  settings: {
    releaseChannel: "beta",
    notifications: { playSound: false },
    daemon: { manageBuiltInDaemon: true, keepRunningAfterQuit: true },
  },
  migrations: { legacyRendererSettingsImported: true, daemonStopOnQuitDefaultApplied: true },
};
const LEGACY_WINDOW_STATE = {
  version: 1,
  state: { x: 40, y: 40, width: 900, height: 700, isMaximized: false },
};
const LEGACY_MAC_LOG = "0.14.x log line\n";
const MIGRATED_LOG_LINE = "[user-data-migration] moved legacy userData";

// HOME alone does not move Electron's appData on macOS (it follows
// CFFIXED_USER_HOME there), and these launches run the real default-userData
// path. Ask Electron where appData is before any migration code can run, and
// refuse to continue unless the answer is inside the fixture.
export function resolveIsolatedAppData({ root, home, env }) {
  const probe = spawnSync(electronBinary, ["--no-sandbox", path.join(root, "probe.cjs")], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  const appData = probe.stdout.trim();
  assert.ok(
    appData.startsWith(`${home}${path.sep}`),
    `Electron resolved appData outside the fixture home: ${JSON.stringify(appData)} ${probe.stderr}`,
  );
  return appData;
}

export function mainLogPath({ home, appData }) {
  if (process.platform === "darwin") return path.join(home, "Library/Logs/Osuna/main.log");
  return path.join(appData, "Osuna/logs/main.log");
}

// Runs the real main process until it has logged the move. The first window is
// not under test, so the process is stopped as soon as the line is on disk.
async function launchUntilMigrationIsLogged({ repo, root, env, logPath }) {
  const desktop = spawn(
    electronBinary,
    [path.join(repo, "packages/desktop/dist/main.js"), "--no-sandbox"],
    { cwd: root, env, stdio: "ignore" },
  );
  const exited = once(desktop, "exit");
  try {
    await expect
      .poll(() => readFile(logPath, "utf8").catch(() => ""), { timeout: 30_000 })
      .toContain(MIGRATED_LOG_LINE);
    return await readFile(logPath, "utf8");
  } finally {
    desktop.kill("SIGKILL");
    await exited;
  }
}

// A 0.14.x userData directory named `Paseo` becomes `Osuna` on the first
// launch, before electron-log creates `Osuna/logs` on Linux.
export async function verifyLegacyUserDataMigration({ repo, env: baseEnv }) {
  const root = await mkdtemp(path.join(tmpdir(), "osuna user data migration "));
  const home = path.join(root, "home");
  const env = {
    ...baseEnv,
    HOME: home,
    USERPROFILE: home,
    CFFIXED_USER_HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    OSUNA_HOME: path.join(root, "daemon"),
    OSUNA_DISABLE_SINGLE_INSTANCE_LOCK: "1",
    // Keep the first window off any real dev server.
    EXPO_DEV_URL: "http://127.0.0.1:1",
  };
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(root, "probe.cjs"),
    'const { app } = require("electron"); process.stdout.write(app.getPath("appData")); app.exit(0);',
  );
  const appData = resolveIsolatedAppData({ root, home, env });
  const legacyDir = path.join(appData, "Paseo");
  const userDataDir = path.join(appData, "Osuna");
  const legacyMacLog = path.join(home, "Library/Logs/Paseo/main.log");

  try {
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, "desktop-settings.json"), JSON.stringify(LEGACY_SETTINGS));
    await writeFile(path.join(legacyDir, "window-state.json"), JSON.stringify(LEGACY_WINDOW_STATE));
    await mkdir(path.dirname(legacyMacLog), { recursive: true });
    await writeFile(legacyMacLog, LEGACY_MAC_LOG);

    // Before `ready` Electron's error box is a blocking native dialog on macOS;
    // Linux prints it to stderr and returns, so only Linux can drive this branch.
    if (process.platform === "linux") {
      await chmod(appData, 0o555);
      const blocked = spawnSync(
        electronBinary,
        [path.join(repo, "packages/desktop/dist/main.js"), "--no-sandbox"],
        { cwd: root, env, encoding: "utf8" },
      );
      await chmod(appData, 0o755);
      assert.equal(blocked.status, 1, blocked.stderr);
      assert.match(blocked.stderr, /Osuna 无法迁移旧版数据/);
      assert.ok(blocked.stderr.includes(`mv "${legacyDir}" "${userDataDir}"`), blocked.stderr);
      assert.deepEqual(await readdir(appData), ["Paseo"]);
      console.log(
        "PASS: a blocked userData move exits before any window and leaves no Osuna directory.",
      );
    }

    const mainLog = await launchUntilMigrationIsLogged({
      repo,
      root,
      env,
      logPath: mainLogPath({ home, appData }),
    });

    assert.ok(mainLog.includes(userDataDir), mainLog);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(userDataDir, "desktop-settings.json"), "utf8")).settings,
      LEGACY_SETTINGS.settings,
    );
    // The window owner may already have rewritten the geometry; the document only has to be here.
    assert.equal((await readdir(userDataDir)).includes("window-state.json"), true);
    assert.deepEqual(
      (await readdir(appData)).filter((name) => name === "Paseo" || name === "Osuna"),
      ["Osuna"],
    );
    assert.equal(await readFile(legacyMacLog, "utf8"), LEGACY_MAC_LOG);
    console.log(
      "PASS: legacy Paseo userData is served from the Osuna directory and the log directory is created after the move.",
    );
  } finally {
    await chmod(appData, 0o755).catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
