// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
import type { Stats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { daemonLogPath } from "./daemon-instance.js";
import { findLegacyDaemonInHome, LegacyDaemonRunningError } from "./legacy-daemon.js";

export type LegacyHomeFileSystem = Pick<
  typeof nodeFs,
  "cp" | "lstat" | "readdir" | "rename" | "rm" | "symlink"
>;

export interface LegacyHomeMigrationInput {
  legacyHome: string;
  home: string;
  fs?: LegacyHomeFileSystem;
}

export interface LegacyHomeMigrated {
  outcome: "migrated";
  method: "rename" | "copy";
}

export interface LegacyHomeMigrationSkipped {
  outcome: "skipped";
  reason: "explicit-home" | "no-legacy-home" | "legacy-home-is-link";
}

export interface LegacyHomeMigrationKeptExistingHome {
  outcome: "skipped";
  reason: "home-exists";
  legacyHomeIsNewer: boolean;
}

export type LegacyHomeMigrationResult =
  | LegacyHomeMigrated
  | LegacyHomeMigrationSkipped
  | LegacyHomeMigrationKeptExistingHome;

export interface DefaultHomeMigrationInput {
  // 用户显式选定的 home：OSUNA_HOME 或 --home 的值，两者都没给时是 undefined。
  explicitHome: string | undefined;
  homeDir?: string;
  fs?: LegacyHomeFileSystem;
}

// 只有默认 home 才迁移：显式选了 home 的布局由用户自己负责，不去碰旧目录。
export async function migrateLegacyHomeIfDefault(
  input: DefaultHomeMigrationInput,
): Promise<LegacyHomeMigrationResult> {
  const { explicitHome, homeDir = os.homedir(), fs } = input;
  if (explicitHome !== undefined) return { outcome: "skipped", reason: "explicit-home" };

  const legacyHome = path.join(homeDir, ".paseo");
  const home = path.join(homeDir, ".osuna");
  const result = await migrateLegacyHome({ legacyHome, home, fs });
  if (result.outcome === "migrated") {
    await appendDaemonLog(home, {
      level: "info",
      msg: "Moved the Paseo data directory to the Osuna home",
      legacyHome,
      home,
      method: result.method,
    });
  }
  // 用户删掉链接后又跑过 0.14.x 才会出现：以新 home 为准，旧目录原样留着，只提醒一声。
  const keptExistingHome = result.outcome === "skipped" && result.reason === "home-exists";
  if (keptExistingHome && result.legacyHomeIsNewer) {
    await appendDaemonLog(home, {
      level: "warn",
      msg: "Detected an unmigrated Paseo data directory; using the Osuna home and leaving it untouched",
      legacyHome,
      home,
    });
  }
  return result;
}

interface LegacyHomeLogEntry {
  level: "info" | "warn";
  msg: string;
  legacyHome: string;
  home: string;
  method?: LegacyHomeMigrated["method"];
}

// 迁移发生在 daemon 的 logger 建起来之前，所以直接往 daemon.log 追加一行同形状的 JSON。
async function appendDaemonLog(home: string, entry: LegacyHomeLogEntry): Promise<void> {
  const { level, ...fields } = entry;
  const logPath = daemonLogPath(home);
  const line = {
    level,
    time: new Date().toISOString(),
    pid: process.pid,
    name: "LegacyHomeMigration",
    ...fields,
  };
  await nodeFs.mkdir(path.dirname(logPath), { recursive: true });
  await nodeFs.appendFile(logPath, `${JSON.stringify(line)}\n`, "utf8");
}

export async function migrateLegacyHome(
  input: LegacyHomeMigrationInput,
): Promise<LegacyHomeMigrationResult> {
  const { legacyHome, home, fs = nodeFs } = input;

  const legacy = await lstatIfPresent(fs, legacyHome);
  if (legacy?.isSymbolicLink()) return { outcome: "skipped", reason: "legacy-home-is-link" };
  if (!legacy?.isDirectory()) return { outcome: "skipped", reason: "no-legacy-home" };

  if (await lstatIfPresent(fs, home)) {
    const legacyWrittenAt = await latestTopLevelWrite(fs, legacyHome);
    const homeWrittenAt = await latestTopLevelWrite(fs, home);
    return {
      outcome: "skipped",
      reason: "home-exists",
      legacyHomeIsNewer: legacyWrittenAt > homeWrittenAt,
    };
  }

  // 旧 daemon 还活着就不搬：它按旧路径开着日志、数据库和 worktree，脚下的目录不能换。
  const runningDaemon = await findLegacyDaemonInHome(legacyHome);
  if (runningDaemon) throw new LegacyDaemonRunningError(runningDaemon);

  try {
    await fs.rename(legacyHome, home);
  } catch (renameError) {
    // 跨分区之类的 rename 失败退回复制；复制成功后旧目录原样留着，所以不需要也放不下链接。
    await copyLegacyHome({ fs, legacyHome, home, renameError });
    return { outcome: "migrated", method: "copy" };
  }
  // 旧路径留链接：worktree 的 gitdir 指针、workspaces.json 与 agents/ 目录名都编码了旧路径，
  // 0.14.x 回滚也靠它找到数据。junction 在 Windows 上不需要管理员权限。
  try {
    await fs.symlink(home, legacyHome, process.platform === "win32" ? "junction" : "dir");
  } catch (linkError) {
    // 没有链接的新 home 会让旧路径上的 worktree 全部失效，所以搬回去，按整体失败处理。
    await fs.rename(home, legacyHome);
    throw new LegacyHomeMigrationError({
      legacyHome,
      home,
      failures: [`Linking the old path failed: ${errorText(linkError)}`],
    });
  }
  return { outcome: "migrated", method: "rename" };
}

interface CopyLegacyHomeInput {
  fs: LegacyHomeFileSystem;
  legacyHome: string;
  home: string;
  renameError: unknown;
}

// 先复制到旁边的临时目录再改名：复制中途失败不会留下半个新 home，下次启动还会重试。
async function copyLegacyHome(input: CopyLegacyHomeInput): Promise<void> {
  const { fs, legacyHome, home, renameError } = input;
  const staging = `${home}.migrating`;
  try {
    await fs.rm(staging, { recursive: true, force: true });
    await fs.cp(legacyHome, staging, { recursive: true, verbatimSymlinks: true });
    await fs.rename(staging, home);
  } catch (copyError) {
    // 清理失败不该盖住真正的失败原因；下一次尝试开头还会再删一遍这个临时目录。
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw new LegacyHomeMigrationError({
      legacyHome,
      home,
      failures: [
        `Rename failed: ${errorText(renameError)}`,
        `Copy failed: ${errorText(copyError)}`,
      ],
    });
  }
}

interface LegacyHomeMigrationFailure {
  legacyHome: string;
  home: string;
  failures: string[];
}

export class LegacyHomeMigrationError extends Error {
  readonly code = "LEGACY_HOME_MIGRATION_FAILED";
  readonly legacyHome: string;
  readonly home: string;
  readonly manualCommand: string;

  constructor(failure: LegacyHomeMigrationFailure) {
    const { legacyHome, home, failures } = failure;
    const manualCommand = `mv "${legacyHome}" "${home}" && ln -s "${home}" "${legacyHome}"`;
    super(
      [
        "Could not move the Paseo data directory to the Osuna home. Osuna will not start with empty data.",
        `From: ${legacyHome}`,
        `To: ${home}`,
        ...failures,
        "Move it yourself, then start Osuna again:",
        `  ${manualCommand}`,
      ].join("\n"),
    );
    this.name = "LegacyHomeMigrationError";
    this.legacyHome = legacyHome;
    this.home = home;
    this.manualCommand = manualCommand;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function lstatIfPresent(fs: LegacyHomeFileSystem, target: string): Promise<Stats | null> {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// 只看目录自身与第一层条目：daemon.log、config.json、pid 锁都在第一层，足够判断哪边最近被 daemon 用过。
async function latestTopLevelWrite(fs: LegacyHomeFileSystem, directory: string): Promise<number> {
  const entries = await fs.readdir(directory);
  const targets = [directory, ...entries.map((entry) => path.join(directory, entry))];
  const stats = await Promise.all(targets.map((target) => fs.lstat(target)));
  const writeTimes = stats.map((stat) => stat.mtimeMs);
  return Math.max(...writeTimes);
}
