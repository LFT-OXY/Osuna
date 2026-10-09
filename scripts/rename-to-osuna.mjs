#!/usr/bin/env node
// 一次性改名脚本：把仓库里的 Paseo 拼写（内容、文件名、目录名）整体换成 Osuna。
// 规格见 .atw/tasks/10-09-osuna-standalone/prd.md 决策 A；例外清单与守线检查共用
// scripts/rename-guard.mjs 里的那一份。
//
// 用法：
//   node scripts/rename-to-osuna.mjs --dry-run   只打印会改哪些，不落盘
//   node scripts/rename-to-osuna.mjs             执行改名
// 执行后还要：npm install（重连 @osuna/* 工作区并重排锁文件）、重建、跑守线检查。
//
// 脚本可重复执行：已经改完的树上再跑一次是空操作。

import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  rmdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { isMainModule } from "./is-main-module.mjs";
import { isOutsideRenameScope, isRenameException, listRepoFiles } from "./rename-guard.mjs";

// 随改名整目录删除（prd 决策 A：以后上 F-Droid 从 git 历史取回）。
const DELETED_DIRECTORIES = ["fastlane/metadata/"];

// 锁文件不在守线范围内，但里面的工作区包名必须跟着改，否则 npm 认不出新的工作区。
const RENAMED_LOCKFILES = new Set(["package-lock.json"]);

// 顺序即优先级：先处理整段替换后拼写不同的 URL 与标识，最后才是三种大小写的通用替换。
// 正则里的 `\\?` 让规则同样命中源码中转义过的写法（如正则字面量里的 `relay\.paseo\.sh`）。
const CONTENT_RULES = [
  // 容器镜像：ghcr 路径必须全小写。
  [/ghcr\.io\/getpaseo\/paseo/g, "ghcr.io/lft-oxy/osuna"],
  // npm 作用域。
  [/@getpaseo(?![A-Za-z0-9])/g, "@osuna"],
  // 仓库：owner/name 两段一起换，覆盖 github.com、API、徽章、SSH 等所有写法。
  [/getpaseo(\\?\/)paseo/g, "LFT-OXY$1Osuna"],
  // 测试里与上面的仓库地址配对出现的仓库名字段。
  [/(repoName["']?: ["'])paseo(["'])/g, "$1Osuna$2"],
  // 测试用邮箱域名与其余小写出现。
  [/getpaseo(\\?\.)(local|dev)\b/g, "osuna$1$2"],
  [/(?<=-)getpaseo(?=-)/g, "osuna"],
  // 剩下的裸 owner（repoOwner、login、github.com/getpaseo）。
  [/getpaseo/g, "LFT-OXY"],
  // 域名：网页端、中继、官网。
  [/(?<![A-Za-z0-9-])app(\\?\.)paseo(\\?\.)sh(?![A-Za-z0-9])/g, "osuna-app$1chinhae$2cc"],
  [/(?<![A-Za-z0-9-])relay(\\?\.)paseo(\\?\.)sh(?![A-Za-z0-9])/g, "osuna-relay$1chinhae$2cc"],
  [/paseo(\\?\.)sh(?![A-Za-z0-9])/g, "osuna$1chinhae$1cc"],
  // 安卓包名 / iOS bundle id 以及原生模块的 Java 包路径。
  [/(?<![A-Za-z0-9_])sh(\\?\.)paseo(?![A-Za-z0-9_])/g, "com$1chinhae$1osuna"],
  [/(?<![A-Za-z0-9_])sh\/paseo\//g, "com/chinhae/osuna/"],
  // 通用替换。
  [/PASEO/g, "OSUNA"],
  [/Paseo/g, "Osuna"],
  [/paseo/g, "osuna"],
];

const PATH_RULES = [
  [/(^|\/)sh\/paseo\//g, "$1com/chinhae/osuna/"],
  [/PASEO/g, "OSUNA"],
  [/Paseo/g, "Osuna"],
  [/paseo/g, "osuna"],
];

function applyRules(rules, input) {
  return rules.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), input);
}

export function renameContent(content) {
  return applyRules(CONTENT_RULES, content);
}

export function renamePath(file) {
  return applyRules(PATH_RULES, file);
}

function isDeleted(file) {
  return DELETED_DIRECTORIES.some((directory) => file.startsWith(directory));
}

async function pathExists(absolutePath) {
  try {
    await lstat(absolutePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function removeEmptyParents(root, file) {
  let directory = dirname(join(root, file));
  while (directory !== root && (await readdir(directory)).length === 0) {
    await rmdir(directory);
    directory = dirname(directory);
  }
}

async function renameOneFile({ root, file, dryRun }) {
  const absolutePath = join(root, file);
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!stats.isSymbolicLink() && !stats.isFile()) return null;

  const original = stats.isSymbolicLink()
    ? await readlink(absolutePath)
    : await readFile(absolutePath, "utf8");
  // 非 UTF-8 的二进制文件读出来会带替换字符，写回去就坏了；它们的内容不参与改名。
  const isText = stats.isSymbolicLink() || !original.includes("�");
  const renamed = isText ? renameContent(original) : original;
  const target = renamePath(file);
  const contentChanged = renamed !== original;
  const pathChanged = target !== file;
  if (!contentChanged && !pathChanged) return null;

  if (pathChanged && (await pathExists(join(root, target)))) {
    throw new Error(`Cannot rename ${file}: ${target} already exists`);
  }
  if (dryRun) return { file, target, contentChanged, pathChanged };

  if (pathChanged) {
    await mkdir(dirname(join(root, target)), { recursive: true });
    await rename(absolutePath, join(root, target));
    await removeEmptyParents(root, file);
  }
  if (contentChanged && stats.isSymbolicLink()) {
    await rm(join(root, target));
    await symlink(renamed, join(root, target));
  } else if (contentChanged) {
    await writeFile(join(root, target), renamed);
  }
  return { file, target, contentChanged, pathChanged };
}

export async function renameTree(root, { dryRun = false } = {}) {
  const files = await listRepoFiles(root);
  const deleted = files.filter(isDeleted);
  const results = [];
  for (const file of files) {
    if (isDeleted(file) || isRenameException(file)) continue;
    if (isOutsideRenameScope(file) && !RENAMED_LOCKFILES.has(file)) continue;
    const result = await renameOneFile({ root, file, dryRun });
    if (result) results.push(result);
  }
  if (!dryRun) {
    for (const directory of DELETED_DIRECTORIES) {
      await rm(join(root, directory), { recursive: true, force: true });
    }
    for (const file of deleted) await removeEmptyParents(root, file).catch(() => {});
  }
  return { results, deleted };
}

async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const rootFlag = argv.indexOf("--root");
  const root = resolve(rootFlag === -1 ? join(import.meta.dirname, "..") : argv[rootFlag + 1]);
  const { results, deleted } = await renameTree(root, { dryRun });

  if (dryRun) {
    for (const { file, target, pathChanged } of results) {
      console.log(pathChanged ? `${file} -> ${target}` : file);
    }
  }
  const moved = results.filter((result) => result.pathChanged).length;
  const edited = results.filter((result) => result.contentChanged).length;
  console.log(
    `${dryRun ? "Would rename" : "Renamed"}: ${edited} files edited, ${moved} paths moved, ${deleted.length} files deleted.`,
  );
}

if (isMainModule(import.meta.url)) {
  await main(process.argv.slice(2));
}
