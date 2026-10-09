// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first.
import { mkdirSync, writeFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  describeUserDataMigrationFailure,
  migrateLegacyUserData,
  nodeUserDataFileSystem,
  renameLegacyBrowserPartitions,
} from "./user-data-migration";

const LEGACY_SETTINGS = JSON.stringify({ version: 1, settings: { releaseChannel: "beta" } });

function errnoError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

describe("migrateLegacyUserData", () => {
  const directories = new Set<string>();

  afterEach(async () => {
    await Promise.all(
      [...directories].map((directory) => rm(directory, { recursive: true, force: true })),
    );
    directories.clear();
  });

  async function createAppDataDir(): Promise<{ legacyDir: string; userDataDir: string }> {
    const appDataDir = await mkdtemp(path.join(os.tmpdir(), "osuna-user-data-migration-"));
    directories.add(appDataDir);
    return {
      legacyDir: path.join(appDataDir, "Paseo"),
      userDataDir: path.join(appDataDir, "Osuna"),
    };
  }

  async function writeLegacyUserData(legacyDir: string): Promise<void> {
    await mkdir(path.join(legacyDir, "Local Storage", "leveldb"), { recursive: true });
    await writeFile(path.join(legacyDir, "desktop-settings.json"), LEGACY_SETTINGS);
    await writeFile(path.join(legacyDir, "Local Storage", "leveldb", "000003.log"), "hosts");
  }

  it("moves the legacy directory to the new location and leaves nothing behind", async () => {
    const { legacyDir, userDataDir } = await createAppDataDir();
    await writeLegacyUserData(legacyDir);

    const result = migrateLegacyUserData({ legacyDir, userDataDir });

    expect(result).toEqual({ kind: "migrated", method: "rename", legacyDir, userDataDir });
    expect(await readFile(path.join(userDataDir, "desktop-settings.json"), "utf8")).toBe(
      LEGACY_SETTINGS,
    );
    expect(
      await readFile(path.join(userDataDir, "Local Storage", "leveldb", "000003.log"), "utf8"),
    ).toBe("hosts");
    expect(await readdir(path.dirname(userDataDir))).toEqual(["Osuna"]);
  });

  it("does nothing on a fresh install with no legacy directory", async () => {
    const { legacyDir, userDataDir } = await createAppDataDir();

    const result = migrateLegacyUserData({ legacyDir, userDataDir });

    expect(result).toEqual({ kind: "skipped", reason: "no-legacy-dir" });
    expect(await readdir(path.dirname(userDataDir))).toEqual([]);
  });

  it("keeps both directories untouched when the new one already exists", async () => {
    const { legacyDir, userDataDir } = await createAppDataDir();
    await writeLegacyUserData(legacyDir);
    await mkdir(userDataDir);
    await writeFile(path.join(userDataDir, "desktop-settings.json"), "newer");

    const result = migrateLegacyUserData({ legacyDir, userDataDir });

    expect(result).toEqual({ kind: "skipped", reason: "user-data-exists" });
    expect(await readFile(path.join(userDataDir, "desktop-settings.json"), "utf8")).toBe("newer");
    expect(await readFile(path.join(legacyDir, "desktop-settings.json"), "utf8")).toBe(
      LEGACY_SETTINGS,
    );
  });

  it("leaves a symlinked legacy directory where it is", async () => {
    const { legacyDir, userDataDir } = await createAppDataDir();
    const linkTarget = path.join(path.dirname(legacyDir), "elsewhere");
    await writeLegacyUserData(linkTarget);
    await symlink(linkTarget, legacyDir, "junction");

    const result = migrateLegacyUserData({ legacyDir, userDataDir });

    expect(result).toEqual({ kind: "skipped", reason: "no-legacy-dir" });
    expect((await readdir(path.dirname(userDataDir))).sort()).toEqual(["Paseo", "elsewhere"]);
    expect((await lstat(legacyDir)).isSymbolicLink()).toBe(true);
  });

  it("copies when the legacy directory cannot be renamed and keeps the original", async () => {
    const { legacyDir, userDataDir } = await createAppDataDir();
    await writeLegacyUserData(legacyDir);

    const result = migrateLegacyUserData({
      legacyDir,
      userDataDir,
      fileSystem: {
        ...nodeUserDataFileSystem,
        rename: (from, to) => {
          if (from === legacyDir) throw errnoError("EXDEV", "cross-device link not permitted");
          nodeUserDataFileSystem.rename(from, to);
        },
      },
    });

    expect(result).toEqual({ kind: "migrated", method: "copy", legacyDir, userDataDir });
    expect(await readFile(path.join(userDataDir, "desktop-settings.json"), "utf8")).toBe(
      LEGACY_SETTINGS,
    );
    expect(
      await readFile(path.join(userDataDir, "Local Storage", "leveldb", "000003.log"), "utf8"),
    ).toBe("hosts");
    expect(await readFile(path.join(legacyDir, "desktop-settings.json"), "utf8")).toBe(
      LEGACY_SETTINGS,
    );
    expect((await readdir(path.dirname(userDataDir))).sort()).toEqual(["Osuna", "Paseo"]);
  });

  // Chromium 把持锁进程的主机名与 pid 存在悬空链接的目标里；Windows 没有这些链接。
  it.runIf(process.platform !== "win32")(
    "copies Chromium's singleton links without rewriting their targets",
    async () => {
      const { legacyDir, userDataDir } = await createAppDataDir();
      await writeLegacyUserData(legacyDir);
      await symlink("ana-laptop.local-79825", path.join(legacyDir, "SingletonLock"));

      migrateLegacyUserData({
        legacyDir,
        userDataDir,
        fileSystem: {
          ...nodeUserDataFileSystem,
          rename: (from, to) => {
            if (from === legacyDir) throw errnoError("EXDEV", "cross-device link not permitted");
            nodeUserDataFileSystem.rename(from, to);
          },
        },
      });

      expect(await readlink(path.join(userDataDir, "SingletonLock"))).toBe(
        "ana-laptop.local-79825",
      );
    },
  );

  it("reports a failure and leaves no partial copy when rename and copy both fail", async () => {
    const { legacyDir, userDataDir } = await createAppDataDir();
    await writeLegacyUserData(legacyDir);
    const crossDevice = errnoError("EXDEV", "cross-device link not permitted");
    const diskFull = errnoError("ENOSPC", "no space left on device");

    const result = migrateLegacyUserData({
      legacyDir,
      userDataDir,
      fileSystem: {
        rename: () => {
          throw crossDevice;
        },
        copyDirectory: (_from, to) => {
          mkdirSync(to);
          writeFileSync(path.join(to, "desktop-settings.json"), "half");
          throw diskFull;
        },
      },
    });

    expect(result).toEqual({
      kind: "failed",
      legacyDir,
      userDataDir,
      renameError: crossDevice,
      copyError: diskFull,
    });
    expect(await readdir(path.dirname(userDataDir))).toEqual(["Paseo"]);
    expect(await readFile(path.join(legacyDir, "desktop-settings.json"), "utf8")).toBe(
      LEGACY_SETTINGS,
    );
  });

  it("retries from scratch after an interrupted copy left a staging directory", async () => {
    const { legacyDir, userDataDir } = await createAppDataDir();
    await writeLegacyUserData(legacyDir);
    await mkdir(`${userDataDir}.migrating`);
    await writeFile(path.join(`${userDataDir}.migrating`, "stale"), "from a crashed run");

    const result = migrateLegacyUserData({
      legacyDir,
      userDataDir,
      fileSystem: {
        ...nodeUserDataFileSystem,
        rename: (from, to) => {
          if (from === legacyDir) throw errnoError("EXDEV", "cross-device link not permitted");
          nodeUserDataFileSystem.rename(from, to);
        },
      },
    });

    expect(result).toEqual({ kind: "migrated", method: "copy", legacyDir, userDataDir });
    expect((await readdir(userDataDir)).sort()).toEqual(["Local Storage", "desktop-settings.json"]);
  });
});

describe("renameLegacyBrowserPartitions", () => {
  const directories = new Set<string>();

  afterEach(async () => {
    await Promise.all(
      [...directories].map((directory) => rm(directory, { recursive: true, force: true })),
    );
    directories.clear();
  });

  async function createUserDataWithPartitions(names: string[]): Promise<string> {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), "osuna-browser-partitions-"));
    directories.add(userDataDir);
    for (const name of names) {
      await mkdir(path.join(userDataDir, "Partitions", name), { recursive: true });
      await writeFile(path.join(userDataDir, "Partitions", name, "Cookies"), `cookies of ${name}`);
    }
    return userDataDir;
  }

  it("carries the embedded browser's profile and its per-tab profiles over to the new names", async () => {
    const userDataDir = await createUserDataWithPartitions([
      "paseo-browser",
      "paseo-browser-1760000000000-ab12",
      "someone-elses-partition",
    ]);

    const result = renameLegacyBrowserPartitions(userDataDir);

    expect(result).toEqual({
      renamed: ["osuna-browser", "osuna-browser-1760000000000-ab12"],
      failed: [],
    });
    expect((await readdir(path.join(userDataDir, "Partitions"))).sort()).toEqual([
      "osuna-browser",
      "osuna-browser-1760000000000-ab12",
      "someone-elses-partition",
    ]);
    expect(
      await readFile(path.join(userDataDir, "Partitions", "osuna-browser", "Cookies"), "utf8"),
    ).toBe("cookies of paseo-browser");
  });

  it("keeps a profile the new app already created and leaves the legacy one beside it", async () => {
    const userDataDir = await createUserDataWithPartitions(["paseo-browser", "osuna-browser"]);

    const result = renameLegacyBrowserPartitions(userDataDir);

    expect(result).toEqual({ renamed: [], failed: [] });
    expect(
      await readFile(path.join(userDataDir, "Partitions", "osuna-browser", "Cookies"), "utf8"),
    ).toBe("cookies of osuna-browser");
    expect(
      await readFile(path.join(userDataDir, "Partitions", "paseo-browser", "Cookies"), "utf8"),
    ).toBe("cookies of paseo-browser");
  });

  it("does nothing when the embedded browser was never used", async () => {
    const userDataDir = await createUserDataWithPartitions([]);

    expect(renameLegacyBrowserPartitions(userDataDir)).toEqual({ renamed: [], failed: [] });
    expect(await readdir(userDataDir)).toEqual([]);
  });

  it("reports a profile it could not rename and still renames the others", async () => {
    const userDataDir = await createUserDataWithPartitions([
      "paseo-browser",
      "paseo-browser-1760000000000-ab12",
    ]);
    const busy = errnoError("EBUSY", "resource busy or locked");

    const result = renameLegacyBrowserPartitions(userDataDir, {
      ...nodeUserDataFileSystem,
      rename: (from, to) => {
        if (path.basename(from) === "paseo-browser") throw busy;
        nodeUserDataFileSystem.rename(from, to);
      },
    });

    expect(result).toEqual({
      renamed: ["osuna-browser-1760000000000-ab12"],
      failed: [{ partition: "paseo-browser", error: busy }],
    });
    expect((await readdir(path.join(userDataDir, "Partitions"))).sort()).toEqual([
      "osuna-browser-1760000000000-ab12",
      "paseo-browser",
    ]);
  });
});

describe("describeUserDataMigrationFailure", () => {
  it("tells a macOS or Linux user both paths and the command to move the data by hand", () => {
    const message = describeUserDataMigrationFailure({
      failure: {
        kind: "failed",
        legacyDir: "/Users/ana/Library/Application Support/Paseo",
        userDataDir: "/Users/ana/Library/Application Support/Osuna",
        renameError: errnoError("EXDEV", "cross-device link not permitted"),
        copyError: errnoError("ENOSPC", "no space left on device"),
      },
      platform: "darwin",
    });

    expect(message).toEqual({
      title: "Osuna 无法迁移旧版数据",
      content: [
        "旧版 Paseo 的数据目录没能搬到 Osuna 的新位置，Osuna 将退出。数据没有丢失，下次启动会再试一次。",
        "",
        "旧目录：/Users/ana/Library/Application Support/Paseo",
        "新目录：/Users/ana/Library/Application Support/Osuna",
        "原因：移动失败（EXDEV），复制也失败（ENOSPC）",
        "",
        "请先退出仍在运行的 Paseo，再重新打开 Osuna。仍然失败时，在终端里手动执行：",
        "",
        'mv "/Users/ana/Library/Application Support/Paseo" "/Users/ana/Library/Application Support/Osuna"',
      ].join("\n"),
    });
  });

  it("gives a Windows user the command prompt form of the command", () => {
    const message = describeUserDataMigrationFailure({
      failure: {
        kind: "failed",
        legacyDir: "C:\\Users\\ana\\AppData\\Roaming\\Paseo",
        userDataDir: "C:\\Users\\ana\\AppData\\Roaming\\Osuna",
        renameError: errnoError("EBUSY", "resource busy or locked"),
        copyError: new Error("copy stopped"),
      },
      platform: "win32",
    });

    const lines = message.content.split("\n");
    expect(lines[4]).toBe("原因：移动失败（EBUSY），复制也失败（copy stopped）");
    expect(lines.at(-1)).toBe(
      'move "C:\\Users\\ana\\AppData\\Roaming\\Paseo" "C:\\Users\\ana\\AppData\\Roaming\\Osuna"',
    );
  });
});
