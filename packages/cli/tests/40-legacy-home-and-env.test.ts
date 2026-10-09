#!/usr/bin/env npx tsx
// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first

import "./helpers/isolated-os-home.ts";
import assert from "node:assert";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $, sleep, type ProcessPromise } from "zx";
import { getAvailablePort } from "./helpers/network.ts";

$.verbose = false;

const CLI_ENTRY = join(import.meta.dirname, "..", "dist", "index.js");
const cleanupPaths: string[] = [];

function userHome(): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "osuna-legacy-home-")));
  cleanupPaths.push(home);
  return home;
}

// 环境只带这里写明的变量：开发机 shell 里残留的旧变量不能混进断言。
function runOsuna(args: string[], home: string, env: NodeJS.ProcessEnv = {}): ProcessPromise {
  return $({
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, ...env },
  })`${process.execPath} ${CLI_ENTRY} ${args}`.nothrow();
}

function seedLegacyHome(home: string): string {
  const legacyHome = join(home, ".paseo");
  mkdirSync(legacyHome);
  writeFileSync(
    join(legacyHome, "config.json"),
    `${JSON.stringify({ version: 1, daemon: { listen: "127.0.0.1:9999" } })}\n`,
  );
  return legacyHome;
}

async function waitForLog(logPath: string, expected: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const contents = readFileSync(logPath, "utf8");
    if (contents.includes(expected)) return contents;
    if (Date.now() >= deadline)
      throw new Error(`${expected} never reached ${logPath}:\n${contents}`);
    await sleep(100);
  }
}

console.log("=== Legacy home and environment ===\n");

try {
  {
    console.log("Test 1: startup names every PASEO_* variable with its OSUNA_* replacement");
    const result = await runOsuna(["--version"], userHome(), {
      PASEO_LISTEN: "127.0.0.1:7000",
      PASEO_HOME: "/srv/paseo",
    });

    assert.strictEqual(result.exitCode, 0);
    assert.match(result.stdout, /\d+\.\d+\.\d+/);
    assert.strictEqual(
      result.stderr,
      "Warning: Osuna ignores PASEO_* environment variables. Rename PASEO_HOME to OSUNA_HOME, PASEO_LISTEN to OSUNA_LISTEN.\n",
    );
    console.log("✓ warns once and still runs the command\n");
  }

  {
    console.log("Test 2: startup is silent without PASEO_* variables");
    const result = await runOsuna(["--version"], userHome(), { OSUNA_LISTEN: "127.0.0.1:7000" });

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stderr, "");
    console.log("✓ no warning\n");
  }

  {
    console.log("Test 3: a local command on the default home moves the legacy home first");
    const home = userHome();
    const legacyHome = seedLegacyHome(home);

    const result = await runOsuna(["daemon", "config", "get", "daemon.listen", "--json"], home);

    assert.strictEqual(result.exitCode, 0, result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).value, "127.0.0.1:9999");
    assert.strictEqual(lstatSync(join(home, ".osuna")).isDirectory(), true);
    assert.strictEqual(lstatSync(legacyHome).isSymbolicLink(), true);
    assert.strictEqual(realpathSync(legacyHome), join(home, ".osuna"));
    console.log("✓ reads the old config from ~/.osuna and leaves a link at ~/.paseo\n");
  }

  {
    console.log("Test 4: an explicit --home leaves the legacy home alone");
    const home = userHome();
    const legacyHome = seedLegacyHome(home);
    const explicitHome = join(home, "custom-home");

    const result = await runOsuna(
      ["daemon", "config", "get", "daemon.listen", "--json", "--home", explicitHome],
      home,
    );

    assert.strictEqual(result.exitCode, 0, result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).set, false);
    assert.strictEqual(lstatSync(legacyHome).isDirectory(), true);
    assert.throws(() => lstatSync(join(home, ".osuna")), { code: "ENOENT" });
    console.log("✓ nothing moved\n");
  }

  {
    console.log("Test 5: OSUNA_HOME in the environment leaves the legacy home alone");
    const home = userHome();
    const legacyHome = seedLegacyHome(home);

    const result = await runOsuna(["daemon", "config", "get", "daemon.listen", "--json"], home, {
      OSUNA_HOME: join(home, ".osuna"),
    });

    assert.strictEqual(result.exitCode, 0, result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).set, false);
    assert.strictEqual(lstatSync(legacyHome).isDirectory(), true);
    console.log("✓ nothing moved\n");
  }

  {
    console.log(
      "Test 6: a legacy home that cannot be moved stops the command, then the next run retries",
    );
    const home = userHome();
    const legacyHome = seedLegacyHome(home);
    const osunaHome = join(home, ".osuna");

    // 只读的上级目录让 rename 与复制都失败，和磁盘权限出问题时一样。
    chmodSync(home, 0o555);
    let refused: Awaited<ProcessPromise>;
    try {
      refused = await runOsuna(["daemon", "config", "get", "daemon.listen"], home);
    } finally {
      chmodSync(home, 0o755);
    }

    assert.strictEqual(refused.exitCode, 1);
    assert.ok(refused.stderr.includes(`From: ${legacyHome}`), refused.stderr);
    assert.ok(refused.stderr.includes(`To: ${osunaHome}`), refused.stderr);
    assert.ok(
      refused.stderr.includes(
        `mv "${legacyHome}" "${osunaHome}" && ln -s "${osunaHome}" "${legacyHome}"`,
      ),
      refused.stderr,
    );
    assert.strictEqual(lstatSync(legacyHome).isDirectory(), true);
    assert.throws(() => lstatSync(osunaHome), { code: "ENOENT" });

    const retried = await runOsuna(["daemon", "config", "get", "daemon.listen", "--json"], home);

    assert.strictEqual(retried.exitCode, 0, retried.stderr);
    assert.strictEqual(JSON.parse(retried.stdout).value, "127.0.0.1:9999");
    assert.strictEqual(lstatSync(legacyHome).isSymbolicLink(), true);
    console.log(
      "✓ exits non-zero with both paths and the manual command, and moves on the retry\n",
    );
  }

  {
    console.log(
      "Test 7: starting the daemon on the default home records the move and the ignored variables",
    );
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
    const env = { PASEO_LISTEN: "127.0.0.1:7000", OSUNA_LOCAL_SPEECH_AUTO_DOWNLOAD: "0" };

    const started = await runOsuna(["daemon", "start", "--json"], home, env);
    try {
      assert.strictEqual(started.exitCode, 0, started.stderr);
      assert.strictEqual(JSON.parse(started.stdout).listen, `127.0.0.1:${port}`);
      assert.strictEqual(lstatSync(legacyHome).isSymbolicLink(), true);

      const ignoredVariables =
        "Osuna ignores PASEO_* environment variables. Rename PASEO_LISTEN to OSUNA_LISTEN.";
      const daemonLog = await waitForLog(join(home, ".osuna", "daemon.log"), ignoredVariables);
      assert.strictEqual(
        daemonLog.split("Moved the Paseo data directory to the Osuna home").length - 1,
        1,
        daemonLog,
      );
    } finally {
      await runOsuna(["daemon", "stop", "--force"], home, env);
    }
    console.log("✓ daemon.log has one line for the move and the daemon's own warning\n");
  }

  {
    console.log("Test 8: a command aimed at another host moves the legacy home before it runs");
    const home = userHome();
    const legacyHome = seedLegacyHome(home);
    const unusedPort = await getAvailablePort();

    // 连远程主机的命令也会把 cli-client-id 写进默认 home；它抢先建出的空目录会让迁移被永久跳过。
    const result = await runOsuna(["ls", "--host", `127.0.0.1:${unusedPort}`], home);

    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(lstatSync(legacyHome).isSymbolicLink(), true);
    assert.deepStrictEqual(JSON.parse(readFileSync(join(home, ".osuna", "config.json"), "utf8")), {
      version: 1,
      daemon: { listen: "127.0.0.1:9999" },
    });
    assert.strictEqual(lstatSync(join(home, ".osuna", "cli-client-id")).isFile(), true);
    console.log("✓ the client id lands next to the old data, not in a fresh empty home\n");
  }

  {
    console.log("Test 9: pairing with no daemon running moves the legacy home before it runs");
    const home = userHome();
    const legacyHome = seedLegacyHome(home);

    const result = await runOsuna(["daemon", "pair", "--relay", "--json"], home);

    assert.strictEqual(result.exitCode, 0, result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).relayEnabled, true);
    assert.strictEqual(lstatSync(legacyHome).isSymbolicLink(), true);
    assert.deepStrictEqual(JSON.parse(readFileSync(join(home, ".osuna", "config.json"), "utf8")), {
      version: 1,
      daemon: { listen: "127.0.0.1:9999", relay: { enabled: true } },
    });
    console.log("✓ the relay choice is saved into the old config instead of a new one\n");
  }

  {
    console.log("Test 10: a command on an explicit home writes nothing into the default home");
    const home = userHome();
    const legacyHome = seedLegacyHome(home);
    const explicitHome = join(home, "custom-home");
    const unusedPort = await getAvailablePort();

    // 显式选了 home 就不迁移。client id 这时要是还写进默认 home，抢先建出的目录会让旧数据再也搬不过来。
    const result = await runOsuna(["ls", "--host", `127.0.0.1:${unusedPort}`], home, {
      OSUNA_HOME: explicitHome,
    });

    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(lstatSync(join(explicitHome, "cli-client-id")).isFile(), true);
    assert.throws(() => lstatSync(join(home, ".osuna")), { code: "ENOENT" });
    assert.strictEqual(lstatSync(legacyHome).isDirectory(), true);
    console.log("✓ the client id lands in the chosen home and the legacy home stays in place\n");
  }
} finally {
  for (const target of cleanupPaths) rmSync(target, { recursive: true, force: true });
}

console.log("=== All legacy home and environment tests passed ===");
