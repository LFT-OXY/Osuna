import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { isMainModule } from "./is-main-module.mjs";

const execFileAsync = promisify(execFile);

const OLD_SPELLING = /paseo/i;

// 迁移代码读旧布局的地方打这个标签（docs/protocol-compatibility.md 的 COMPAT 约定）。
// 放行范围：标签所在行；标签行往下直到第一个空行；标签在文件首行（shebang 之后）时是整个文件连同路径。
export const MIGRATION_COMPAT_TAG = "COMPAT(paseoDataMigration)";

// 例外清单的出处：.atw/tasks/10-09-osuna-standalone/map-issues/07-rename-exception-list.md。
// 改名脚本整文件跳过这些路径，守线检查放行它们。
// 写法：以 "/" 结尾是根目录下的整个目录，以 "**/" 开头是任意层级的目录，其余是根目录下的单个文件。
export const RENAME_EXCEPTIONS = [
  "LICENSE",
  "NOTICE",
  "CHANGELOG.md",
  "README.md",
  "README.zh-CN.md",
  "README.ja.md",
  "README.ko.md",
  "docs/glossary.md",
  "docs/adr/",
  ".atw/tasks/",
  ".atw/workspace/",
  "**/fixtures/legacy-paseo/",
  // 改名与守线工具自身：规则里必须写出旧拼写。
  "scripts/rename-guard.mjs",
  "scripts/rename-guard.test.mjs",
  "scripts/rename-to-osuna.mjs",
];

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist"]);
const LOCKFILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|[^/]*\.lock)$/;

// 依赖、构建产物与锁文件不是手写内容，改名脚本与守线检查都不看。
export function isOutsideRenameScope(file) {
  if (LOCKFILE.test(file)) return true;
  return file.split("/").some((segment) => SKIPPED_DIRECTORIES.has(segment));
}

export function isRenameException(file) {
  return RENAME_EXCEPTIONS.some((pattern) => {
    if (pattern.startsWith("**/")) return `/${file}`.includes(`/${pattern.slice(3)}`);
    if (pattern.endsWith("/")) return file.startsWith(pattern);
    return file === pattern;
  });
}

// 已跟踪文件加未被忽略的新文件：本机的构建产物与其他 worktree 不进扫描范围。
export async function listRepoFiles(root) {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, maxBuffer: 64 * 1024 * 1024 },
  );
  return [...new Set(stdout.split("\0").filter(Boolean))].sort();
}

// 符号链接只看它指向哪里：读穿过去会把目标文件（可能在例外清单里）算到链接头上。
// 返回 null 表示没有可检查的内容：索引里还在但工作区已删的文件、子模块目录。
async function readGuardedContent(absolutePath) {
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (stats.isSymbolicLink()) return readlink(absolutePath);
  if (!stats.isFile()) return null;
  return readFile(absolutePath, "latin1");
}

function opensWithMigrationTag(lines) {
  const firstLine = lines[0]?.startsWith("#!") ? lines[1] : lines[0];
  return firstLine?.includes(MIGRATION_COMPAT_TAG) ?? false;
}

function findUntaggedLines(lines) {
  const hits = [];
  let insideTaggedBlock = false;
  lines.forEach((text, index) => {
    if (text.trim() === "") insideTaggedBlock = false;
    else if (text.includes(MIGRATION_COMPAT_TAG)) insideTaggedBlock = true;
    if (!insideTaggedBlock && OLD_SPELLING.test(text)) hits.push({ line: index + 1, text });
  });
  return hits;
}

export async function findRenameViolations(root) {
  const violations = [];
  for (const file of await listRepoFiles(root)) {
    if (isOutsideRenameScope(file) || isRenameException(file)) continue;
    const content = await readGuardedContent(join(root, file));
    if (content === null) continue;
    const lines = content.split("\n");
    if (opensWithMigrationTag(lines)) continue;
    if (OLD_SPELLING.test(file)) violations.push({ file, text: file });
    for (const hit of findUntaggedLines(lines)) violations.push({ file, ...hit });
  }
  return violations;
}

function formatViolation({ file, line, text }) {
  if (line === undefined) return `${file}: path`;
  return `${file}:${line}: ${text.trim().slice(0, 160)}`;
}

// 默认扫描本仓库；`--root <dir>` 换成别的目录（测试用临时目录）。
export function resolveRootArgument(argv) {
  const rootFlag = argv.indexOf("--root");
  if (rootFlag === -1) return join(import.meta.dirname, "..");
  return resolve(argv[rootFlag + 1]);
}

async function main(argv) {
  const violations = await findRenameViolations(resolveRootArgument(argv));
  if (violations.length === 0) return;

  const fileCount = new Set(violations.map((violation) => violation.file)).size;
  console.error(violations.map(formatViolation).join("\n"));
  console.error(
    `\n${violations.length} old spellings in ${fileCount} files. Rename them to the Osuna spelling. ` +
      `Only the exception list in scripts/rename-guard.mjs and code tagged ${MIGRATION_COMPAT_TAG} may keep the old one.`,
  );
  process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  await main(process.argv.slice(2));
}
