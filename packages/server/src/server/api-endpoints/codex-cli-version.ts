// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/proc/version.go 的 Version、npmVersion、shimVersion、
// versionsFailed）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

/*
 * 本机 Codex CLI 的版本（没有 Codex 样本时「按 Codex 的样子测」用，magpie codexCLIVersion = proc.Version）：
 * 先读它所在 npm 包的 package.json（Windows 的 npm 垫片读它指向的包），读不到才跑一次 `codex --version`。
 * 跑过却没说出版本的，这个可执行文件（路径、大小、修改时间都不变）不再跑：macOS 每跑一次都弹恶意软件警告（magpie #864）。
 * 同时来的几次查询合成一次。
 */

const VERSION = /\d+\.\d+\.\d+/;
// 比这大的不会是 npm 垫片（magpie shimVersion 的 64 KB）。
const SHIM_MAX_BYTES = 64 * 1024;
const NODE_MODULES = "/node_modules/";

export interface InstalledCodexVersionOptions {
  // codex 可执行文件的路径；没装为 null。
  locate: () => Promise<string | null>;
  // `codex --version` 的原始输出（probeCodexVersion）。
  runVersion: () => Promise<string>;
}

function packageVersion(packageJson: string): string | null {
  let text: string;
  try {
    text = readFileSync(packageJson, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { version } = parsed as { version?: unknown };
  return typeof version === "string" && version !== "" ? version : null;
}

function isMissingFile(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

/** 文件所在的 npm 包（…/node_modules/@openai/codex/bin/codex.js 在 @openai/codex 里）的版本；不在包里为 null。 */
export function npmPackageVersion(realFile: string): string | null {
  for (let dir = path.dirname(realFile); ; dir = path.dirname(dir)) {
    const up = path.dirname(dir);
    if (up === dir) return null;
    const upName = path.basename(up);
    const isScope = upName.startsWith("@") && path.basename(path.dirname(up)) === "node_modules";
    if (upName === "node_modules" || isScope) return packageVersion(path.join(dir, "package.json"));
  }
}

/** Windows 的 npm 垫片（codex.cmd 等，指向旁边 node_modules 里的包）启动的那个包的版本；不是垫片为 null。 */
export function npmShimVersion(realFile: string): string | null {
  const stat = statSync(realFile);
  if (stat.isDirectory() || stat.size > SHIM_MAX_BYTES) return null;
  const text = readFileSync(realFile, "utf8").replaceAll("\\", "/");
  const at = text.indexOf(NODE_MODULES);
  if (at < 0) return null;
  const parts = text.slice(at + NODE_MODULES.length).split("/");
  let name = parts[0] ?? "";
  if (name.startsWith("@")) name += `/${parts[1] ?? ""}`;
  if (name === "" || /[\s"'%$]/.test(name)) return null;
  const packageJson = path.join(
    path.dirname(realFile),
    "node_modules",
    ...name.split("/"),
    "package.json",
  );
  return packageVersion(packageJson);
}

function realPathOf(file: string): string {
  try {
    return realpathSync(file);
  } catch (error) {
    if (isMissingFile(error)) return file;
    throw error;
  }
}

export class InstalledCodexVersion {
  private readonly locate: () => Promise<string | null>;
  private readonly runVersion: () => Promise<string>;
  // 跑过却没说出版本的那个可执行文件（路径、大小、修改时间）。
  private failedStamp: string | null = null;
  private pending: Promise<string | null> | null = null;

  constructor(options: InstalledCodexVersionOptions) {
    this.locate = options.locate;
    this.runVersion = options.runVersion;
  }

  /** 本机 Codex CLI 的版本；没装、或问不出来为 null。同时来的查询共用一次。 */
  read(): Promise<string | null> {
    this.pending ??= this.lookUpOnce();
    return this.pending;
  }

  /** 查一次；查完（成或不成）就让下一次查询重新开始。同一时间只有一个在查，所以直接清掉。 */
  private async lookUpOnce(): Promise<string | null> {
    try {
      return await this.lookUp();
    } finally {
      this.pending = null;
    }
  }

  private async lookUp(): Promise<string | null> {
    const located = await this.locate();
    if (located === null) return null;
    const real = realPathOf(located);
    let stat;
    try {
      stat = statSync(real);
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
    const fromPackage = npmPackageVersion(real) ?? npmShimVersion(real);
    if (fromPackage !== null) return fromPackage;
    const stamp = `${real}\u0000${stat.size}\u0000${stat.mtimeMs}`;
    if (this.failedStamp === stamp) return null;
    const output = await this.runVersion();
    const version = output.match(VERSION)?.[0] ?? null;
    if (version === null) this.failedStamp = stamp;
    return version;
  }
}
