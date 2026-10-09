// COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first.
import { cpSync, existsSync, lstatSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

// 0.14.x 的 userData 目录名，与新目录同在 appData 下。
export const LEGACY_USER_DATA_DIR_NAME = "Paseo";

export interface UserDataMigrationFailure {
  kind: "failed";
  legacyDir: string;
  userDataDir: string;
  renameError: unknown;
  copyError: unknown;
}

export type UserDataMigrationResult =
  | { kind: "skipped"; reason: "no-legacy-dir" | "user-data-exists" }
  | { kind: "migrated"; method: "rename" | "copy"; legacyDir: string; userDataDir: string }
  | UserDataMigrationFailure;

export interface UserDataFileSystem {
  rename(from: string, to: string): void;
  copyDirectory(from: string, to: string): void;
}

export const nodeUserDataFileSystem: UserDataFileSystem = {
  rename: renameSync,
  copyDirectory: (from, to) =>
    // verbatimSymlinks：Chromium 的 SingletonLock 把主机名与 pid 存在链接目标里，不能被改写成绝对路径。
    cpSync(from, to, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true }),
};

// 同步执行：调用点在 Electron ready 之前的模块顶层，主进程是 CommonJS，没有顶层 await。
// 不写任何标记：旧目录是真实目录且新目录不存在就搬，所以失败后每次启动都会重试。
export interface LegacyUserDataMigrationInput {
  legacyDir: string;
  userDataDir: string;
  fileSystem?: UserDataFileSystem;
}

export function migrateLegacyUserData(
  input: LegacyUserDataMigrationInput,
): UserDataMigrationResult {
  const { legacyDir, userDataDir, fileSystem = nodeUserDataFileSystem } = input;
  // lstat：符号链接不算真实目录，用户自己把旧目录链到别处时不动它。
  if (!lstatSync(legacyDir, { throwIfNoEntry: false })?.isDirectory()) {
    return { kind: "skipped", reason: "no-legacy-dir" };
  }
  if (lstatSync(userDataDir, { throwIfNoEntry: false })) {
    return { kind: "skipped", reason: "user-data-exists" };
  }

  let renameError: unknown;
  try {
    fileSystem.rename(legacyDir, userDataDir);
    return { kind: "migrated", method: "rename", legacyDir, userDataDir };
  } catch (error) {
    // rename 失败（跨分区、Windows 上文件被占用）退回复制，旧目录原样保留。
    renameError = error;
  }

  // 先复制到同级暂存目录再改名：新目录要么完整出现要么不出现，
  // 半份数据留在新位置会让下次启动误判为"已迁移"。
  const stagingDir = `${userDataDir}.migrating`;
  try {
    rmSync(stagingDir, { recursive: true, force: true });
    fileSystem.copyDirectory(legacyDir, stagingDir);
    fileSystem.rename(stagingDir, userDataDir);
    return { kind: "migrated", method: "copy", legacyDir, userDataDir };
  } catch (copyError) {
    try {
      rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      // 清不掉的暂存目录留给下次启动，不影响重试条件。
    }
    return { kind: "failed", legacyDir, userDataDir, renameError, copyError };
  }
}

// 内嵌浏览器的会话分区名跟着产品名改了（features/browser-profile.ts），Chromium 把分区存成
// userData/Partitions/<分区名> 目录。搬过来的 userData 里还是旧目录名，不改名的话登录态与
// Cookie 就读不到了。代码只认新分区名，所以这里把目录改过去。
const LEGACY_BROWSER_PARTITION_DIR_PREFIX = "paseo-browser";
const BROWSER_PARTITION_DIR_PREFIX = "osuna-browser";

export interface UnrenamedBrowserPartition {
  partition: string;
  error: unknown;
}

export interface BrowserPartitionRenameResult {
  renamed: string[];
  failed: UnrenamedBrowserPartition[];
}

// 幂等：每次以默认 userData 启动都跑一遍，上次没改成的目录这次再试。
// 新名字已经存在说明新版用过内嵌浏览器了，那份为准，旧目录原样留着。
export function renameLegacyBrowserPartitions(
  userDataDir: string,
  fileSystem: UserDataFileSystem = nodeUserDataFileSystem,
): BrowserPartitionRenameResult {
  const partitionsDir = path.join(userDataDir, "Partitions");
  const result: BrowserPartitionRenameResult = { renamed: [], failed: [] };
  if (!existsSync(partitionsDir)) return result;

  const legacyPartitions = readdirSync(partitionsDir)
    .filter((name) => name.startsWith(LEGACY_BROWSER_PARTITION_DIR_PREFIX))
    .sort();
  for (const partition of legacyPartitions) {
    const renamedPartition = `${BROWSER_PARTITION_DIR_PREFIX}${partition.slice(LEGACY_BROWSER_PARTITION_DIR_PREFIX.length)}`;
    const target = path.join(partitionsDir, renamedPartition);
    if (existsSync(target)) continue;
    try {
      fileSystem.rename(path.join(partitionsDir, partition), target);
      result.renamed.push(renamedPartition);
    } catch (error) {
      result.failed.push({ partition, error });
    }
  }
  return result;
}

// 错误框里两条路径已经各占一行，原因只留错误码；没有错误码时才用原文。
function describeCause(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return "code" in error && typeof error.code === "string" ? error.code : error.message;
}

export interface UserDataMigrationFailureReport {
  failure: UserDataMigrationFailure;
  platform: NodeJS.Platform;
}

export interface UserDataMigrationErrorBox {
  title: string;
  content: string;
}

export function describeUserDataMigrationFailure(
  input: UserDataMigrationFailureReport,
): UserDataMigrationErrorBox {
  const { legacyDir, userDataDir, renameError, copyError } = input.failure;
  const moveCommand = input.platform === "win32" ? "move" : "mv";
  return {
    title: "Osuna 无法迁移旧版数据",
    content: [
      "旧版 Paseo 的数据目录没能搬到 Osuna 的新位置，Osuna 将退出。数据没有丢失，下次启动会再试一次。",
      "",
      `旧目录：${legacyDir}`,
      `新目录：${userDataDir}`,
      `原因：移动失败（${describeCause(renameError)}），复制也失败（${describeCause(copyError)}）`,
      "",
      "请先退出仍在运行的 Paseo，再重新打开 Osuna。仍然失败时，在终端里手动执行：",
      "",
      `${moveCommand} "${legacyDir}" "${userDataDir}"`,
    ].join("\n"),
  };
}
