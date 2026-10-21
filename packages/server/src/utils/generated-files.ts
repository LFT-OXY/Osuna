// lock 文件名单移植自 orca（https://github.com/stablyai/orca，src/shared/generated-code-path.ts 的 LOCKFILE）
// Copyright (c) 2026 Lovecast Inc. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { Logger } from "pino";
import type { RunGitCommand } from "./run-git-command.js";

const LOCKFILE =
  /(?:^|\/)(?:bun\.lockb?|cargo\.lock|composer\.lock|flake\.lock|gemfile\.lock|go\.sum|gradle\.lockfile|mix\.lock|npm-shrinkwrap\.json|package-lock\.json|packages\.lock\.json|pipfile\.lock|pnpm-lock\.yaml|poetry\.lock|pubspec\.lock|uv\.lock|yarn\.lock)$/i;

const MINIFIED_OR_SOURCE_MAP = /\.(?:min\.js|min\.css|map)$/i;

function isGeneratedByName(path: string): boolean {
  return LOCKFILE.test(path) || MINIFIED_OR_SOURCE_MAP.test(path);
}

export interface FindGeneratedPathsInput {
  cwd: string;
  paths: readonly string[];
  runGitCommand: RunGitCommand;
  logger?: Pick<Logger, "warn">;
}

/**
 * 找出 diff 里的 Generated file：`.gitattributes` 显式写了 `linguist-generated`（true 或 false）的以它为准，
 * 没写的按 lock 文件名单和 `*.min.js` / `*.min.css` / `*.map` 判断。所有路径一次 `git check-attr` 问完。
 * 这个标记只影响默认收起，`check-attr` 失败时记一条警告、只按名单判断，不让整份 diff 失败。
 */
export async function findGeneratedPaths(input: FindGeneratedPathsInput): Promise<Set<string>> {
  const { cwd, paths, logger } = input;
  const generated = new Set<string>();
  if (paths.length === 0) return generated;
  let attributes = new Map<string, boolean>();
  try {
    attributes = await readLinguistGenerated(input);
  } catch (error) {
    logger?.warn(
      { err: error, cwd },
      "git check-attr failed; marking generated files by name only",
    );
  }
  for (const path of paths) {
    const attribute = attributes.get(path);
    if (attribute === undefined ? isGeneratedByName(path) : attribute) generated.add(path);
  }
  return generated;
}

/** 返回显式设置了 `linguist-generated` 的路径及其真假；没设置的不在结果里。 */
async function readLinguistGenerated(
  input: FindGeneratedPathsInput,
): Promise<Map<string, boolean>> {
  const { stdout, truncated } = await input.runGitCommand(
    ["check-attr", "-z", "--stdin", "linguist-generated"],
    {
      cwd: input.cwd,
      input: input.paths.map((path) => `${path}\0`).join(""),
      envOverlay: { GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
    },
  );
  if (truncated) throw new Error("git check-attr output exceeded the git output limit");
  // -z 输出：<path>\0<attribute>\0<info>\0，info 为 set / unset / unspecified 或具体值。
  const fields = stdout.split("\0");
  const result = new Map<string, boolean>();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const path = fields[index]!;
    const info = fields[index + 2]!;
    if (info === "set" || info === "true") result.set(path, true);
    else if (info === "unset" || info === "false") result.set(path, false);
  }
  return result;
}
