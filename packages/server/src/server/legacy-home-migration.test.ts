// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  LegacyHomeMigrationError,
  migrateLegacyHome,
  migrateLegacyHomeIfDefault,
  type LegacyHomeFileSystem,
} from "./legacy-home-migration.js";
import { LegacyDaemonRunningError } from "./legacy-daemon.js";
import { isOsunaOwnedWorktreeCwd } from "../utils/worktree.js";

describe("migrateLegacyHome", () => {
  let root: string;
  let legacyHome: string;
  let home: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "legacy-home-migration-")));
    legacyHome = path.join(root, ".paseo");
    home = path.join(root, ".osuna");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function seedLegacyHome(): void {
    mkdirSync(path.join(legacyHome, "agents"), { recursive: true });
    writeFileSync(path.join(legacyHome, "config.json"), '{"version":1}\n');
    writeFileSync(path.join(legacyHome, "agents", "agent.json"), '{"id":"agent-1"}\n');
  }

  test("moves a real legacy home and leaves a link at the old path", async () => {
    seedLegacyHome();

    const result = await migrateLegacyHome({ legacyHome, home });

    expect(result).toEqual({ outcome: "migrated", method: "rename" });
    expect(lstatSync(home).isDirectory()).toBe(true);
    expect(readFileSync(path.join(home, "agents", "agent.json"), "utf8")).toBe(
      '{"id":"agent-1"}\n',
    );
    expect(lstatSync(legacyHome).isSymbolicLink()).toBe(true);
    expect(realpathSync(legacyHome)).toBe(home);
    expect(readFileSync(path.join(legacyHome, "config.json"), "utf8")).toBe('{"version":1}\n');
  });

  test("keeps a git worktree under the legacy path usable without repair", async () => {
    seedLegacyHome();
    const repo = path.join(root, "repo");
    const worktree = path.join(legacyHome, "worktrees", "repo", "feature");
    mkdirSync(repo);
    git(repo, ["init", "-b", "main"]);
    git(repo, ["commit", "--allow-empty", "-m", "initial"]);
    git(repo, ["worktree", "add", "-b", "feature", worktree]);

    await migrateLegacyHome({ legacyHome, home });

    expect(git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("feature");
    expect(git(repo, ["worktree", "list", "--porcelain"])).not.toContain("prunable");
    expect(await isOsunaOwnedWorktreeCwd(worktree, { osunaHome: home })).toEqual({
      allowed: true,
      repoRoot: repo,
      worktreeRoot: path.join(home, "worktrees", "repo"),
      worktreePath: path.join(home, "worktrees", "repo", "feature"),
    });
  });

  test("leaves everything alone when the legacy path is already a link", async () => {
    mkdirSync(home);
    writeFileSync(path.join(home, "config.json"), '{"version":1}\n');
    symlinkSync(home, legacyHome, "dir");

    const result = await migrateLegacyHome({ legacyHome, home });

    expect(result).toEqual({ outcome: "skipped", reason: "legacy-home-is-link" });
    expect(lstatSync(legacyHome).isSymbolicLink()).toBe(true);
    expect(readdirSync(home)).toEqual(["config.json"]);
  });

  test("does nothing when there is no legacy home", async () => {
    const result = await migrateLegacyHome({ legacyHome, home });

    expect(result).toEqual({ outcome: "skipped", reason: "no-legacy-home" });
    expect(readdirSync(root)).toEqual([]);
  });

  test("keeps an existing home and reports that the legacy home was written to later", async () => {
    seedLegacyHome();
    mkdirSync(home);
    writeFileSync(path.join(home, "config.json"), '{"version":2}\n');
    setTopLevelTimes(home, new Date("2026-01-01T00:00:00Z"));
    setTopLevelTimes(legacyHome, new Date("2026-01-01T00:00:00Z"));
    writeFileSync(path.join(legacyHome, "daemon.log"), "0.14.x ran here again\n");

    const result = await migrateLegacyHome({ legacyHome, home });

    expect(result).toEqual({ outcome: "skipped", reason: "home-exists", legacyHomeIsNewer: true });
    expect(lstatSync(legacyHome).isDirectory()).toBe(true);
    expect(readFileSync(path.join(legacyHome, "config.json"), "utf8")).toBe('{"version":1}\n');
    expect(readFileSync(path.join(home, "config.json"), "utf8")).toBe('{"version":2}\n');
  });

  test("keeps an existing home without a report when the legacy home is older", async () => {
    seedLegacyHome();
    setTopLevelTimes(legacyHome, new Date("2026-01-01T00:00:00Z"));
    mkdirSync(home);
    writeFileSync(path.join(home, "config.json"), '{"version":2}\n');

    const result = await migrateLegacyHome({ legacyHome, home });

    expect(result).toEqual({ outcome: "skipped", reason: "home-exists", legacyHomeIsNewer: false });
    expect(lstatSync(legacyHome).isDirectory()).toBe(true);
    expect(readFileSync(path.join(home, "config.json"), "utf8")).toBe('{"version":2}\n');
  });

  test("copies the legacy home when it cannot be renamed and leaves the original untouched", async () => {
    seedLegacyHome();
    symlinkSync("agents", path.join(legacyHome, "latest"), "dir");

    const result = await migrateLegacyHome({
      legacyHome,
      home,
      fs: { ...nodeFs, rename: renameFailingFor(legacyHome, "EXDEV") },
    });

    expect(result).toEqual({ outcome: "migrated", method: "copy" });
    expect(readdirSync(root).sort()).toEqual([".osuna", ".paseo"]);
    expect(readFileSync(path.join(home, "agents", "agent.json"), "utf8")).toBe(
      '{"id":"agent-1"}\n',
    );
    expect(readlinkSync(path.join(home, "latest"))).toBe("agents");
    expect(lstatSync(legacyHome).isDirectory()).toBe(true);
    expect(readdirSync(legacyHome).sort()).toEqual(["agents", "config.json", "latest"]);
  });

  test("refuses with the manual command when neither rename nor copy works, then retries", async () => {
    seedLegacyHome();
    const diskFull: LegacyHomeFileSystem["cp"] = async (_source, destination) => {
      await nodeFs.mkdir(destination as string);
      await nodeFs.writeFile(path.join(destination as string, "config.json"), "{");
      throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    };

    const failure = await migrateLegacyHome({
      legacyHome,
      home,
      fs: { ...nodeFs, rename: renameFailingFor(legacyHome, "EXDEV"), cp: diskFull },
    }).catch((error: unknown) => error);

    const manualCommand = `mv "${legacyHome}" "${home}" && ln -s "${home}" "${legacyHome}"`;
    expect(failure).toBeInstanceOf(LegacyHomeMigrationError);
    expect(failure).toMatchObject({
      name: "LegacyHomeMigrationError",
      code: "LEGACY_HOME_MIGRATION_FAILED",
      legacyHome,
      home,
      manualCommand,
    });
    const { message } = failure as LegacyHomeMigrationError;
    expect(message).toContain(legacyHome);
    expect(message).toContain(home);
    expect(message).toContain(manualCommand);
    expect(message).toContain("EXDEV: rename refused");
    expect(message).toContain("ENOSPC: no space left on device");
    expect(readdirSync(root)).toEqual([".paseo"]);
    expect(readdirSync(legacyHome).sort()).toEqual(["agents", "config.json"]);

    expect(await migrateLegacyHome({ legacyHome, home })).toEqual({
      outcome: "migrated",
      method: "rename",
    });
  });

  test("moves the home back and refuses when the old path cannot be linked", async () => {
    seedLegacyHome();
    const linkRefused: LegacyHomeFileSystem["symlink"] = async () => {
      throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
    };

    const failure = await migrateLegacyHome({
      legacyHome,
      home,
      fs: { ...nodeFs, symlink: linkRefused },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LegacyHomeMigrationError);
    expect((failure as LegacyHomeMigrationError).message).toContain(
      "EPERM: operation not permitted",
    );
    expect(readdirSync(root)).toEqual([".paseo"]);
    expect(lstatSync(legacyHome).isDirectory()).toBe(true);
    expect(readdirSync(legacyHome).sort()).toEqual(["agents", "config.json"]);
  });

  const lockWrittenAt = new Date().toISOString();

  function writeLegacyLock(pid: number): string {
    const lock = JSON.stringify({
      pid,
      startedAt: lockWrittenAt,
      hostname: "current-host",
      uid: process.getuid?.() ?? 0,
      listen: "127.0.0.1:6767",
      desktopManaged: true,
    });
    writeFileSync(path.join(legacyHome, "paseo.pid"), lock);
    return lock;
  }

  test("leaves the legacy home where it is while a live 0.14.x daemon holds its lock file", async () => {
    seedLegacyHome();
    const lock = writeLegacyLock(process.pid);

    const refusal = await migrateLegacyHome({ legacyHome, home }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(LegacyDaemonRunningError);
    expect((refusal as LegacyDaemonRunningError).daemon).toEqual({
      home: legacyHome,
      pid: process.pid,
      startedAt: lockWrittenAt,
      listen: "127.0.0.1:6767",
      desktopManaged: true,
    });
    expect(readdirSync(root)).toEqual([".paseo"]);
    expect(lstatSync(legacyHome).isDirectory()).toBe(true);
    expect(readFileSync(path.join(legacyHome, "paseo.pid"), "utf8")).toBe(lock);
  });

  test("moves a legacy home whose lock file was left behind by a daemon that is gone", async () => {
    seedLegacyHome();
    const lock = writeLegacyLock(2_147_483_646);

    expect(await migrateLegacyHome({ legacyHome, home })).toEqual({
      outcome: "migrated",
      method: "rename",
    });
    expect(readFileSync(path.join(home, "paseo.pid"), "utf8")).toBe(lock);
  });
});

describe("migrateLegacyHomeIfDefault", () => {
  let homeDir: string;
  let legacyHome: string;
  let home: string;

  beforeEach(() => {
    homeDir = realpathSync(mkdtempSync(path.join(tmpdir(), "legacy-home-default-")));
    legacyHome = path.join(homeDir, ".paseo");
    home = path.join(homeDir, ".osuna");
    mkdirSync(legacyHome);
    writeFileSync(path.join(legacyHome, "config.json"), '{"version":1}\n');
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  function readDaemonLog(): unknown[] {
    return readFileSync(path.join(home, "daemon.log"), "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
  }

  test("moves the legacy home under the default home and records it once in daemon.log", async () => {
    const result = await migrateLegacyHomeIfDefault({ explicitHome: undefined, homeDir });

    expect(result).toEqual({ outcome: "migrated", method: "rename" });
    expect(readFileSync(path.join(home, "config.json"), "utf8")).toBe('{"version":1}\n');
    expect(realpathSync(legacyHome)).toBe(home);
    expect(readDaemonLog()).toEqual([
      {
        level: "info",
        time: expect.any(String),
        pid: process.pid,
        name: "LegacyHomeMigration",
        msg: "Moved the Paseo data directory to the Osuna home",
        legacyHome,
        home,
        method: "rename",
      },
    ]);
  });

  test("never touches the legacy home when OSUNA_HOME is set", async () => {
    const result = await migrateLegacyHomeIfDefault({ explicitHome: home, homeDir });

    expect(result).toEqual({ outcome: "skipped", reason: "explicit-home" });
    expect(readdirSync(homeDir)).toEqual([".paseo"]);
    expect(lstatSync(legacyHome).isDirectory()).toBe(true);
  });

  test("warns in daemon.log about a legacy home written to after the Osuna home", async () => {
    mkdirSync(home);
    writeFileSync(path.join(home, "config.json"), '{"version":2}\n');
    setTopLevelTimes(home, new Date("2026-01-01T00:00:00Z"));

    const result = await migrateLegacyHomeIfDefault({ explicitHome: undefined, homeDir });

    expect(result).toEqual({ outcome: "skipped", reason: "home-exists", legacyHomeIsNewer: true });
    expect(readDaemonLog()).toEqual([
      {
        level: "warn",
        time: expect.any(String),
        pid: process.pid,
        name: "LegacyHomeMigration",
        msg: "Detected an unmigrated Paseo data directory; using the Osuna home and leaving it untouched",
        legacyHome,
        home,
      },
    ]);
  });

  test("stays silent once the link from an earlier run is in place", async () => {
    await migrateLegacyHomeIfDefault({ explicitHome: undefined, homeDir });

    const result = await migrateLegacyHomeIfDefault({ explicitHome: undefined, homeDir });

    expect(result).toEqual({ outcome: "skipped", reason: "legacy-home-is-link" });
    expect(readDaemonLog()).toHaveLength(1);
  });
});

function renameFailingFor(source: string, code: string): LegacyHomeFileSystem["rename"] {
  return async (from, to) => {
    if (from === source) throw Object.assign(new Error(`${code}: rename refused`), { code });
    await nodeFs.rename(from, to);
  };
}

function setTopLevelTimes(directory: string, time: Date): void {
  for (const entry of readdirSync(directory)) utimesSync(path.join(directory, entry), time, time);
  utimesSync(directory, time, time);
}

function git(cwd: string, args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Osuna Test",
      "-c",
      "user.email=test@osuna.dev",
      "-c",
      "commit.gpgSign=false",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}
