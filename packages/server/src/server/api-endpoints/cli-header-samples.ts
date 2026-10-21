// 部分逻辑移植自 magpie（https://github.com/yetone/magpie）：internal/provider/test_as.go 的 shapeHeader、SawClient、
// clientHeaders，internal/gateway/gateway.go 的 fromClaudeCode、claudeCodeHeader、fromCodex、codexClientHeader，
// internal/gateway/codex_backend.go 的 codexHeader，internal/provider/codex_request.go 的 codexSign、codexUserAgent、codexOS，
// internal/provider/codex_models.go 的 codexClientVersion、newerVersion
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { execFile } from "node:child_process";
import type { IncomingHttpHeaders } from "node:http";
import os from "node:os";
import type pino from "pino";
import type { ApiEndpointStore, CliHeaderSample } from "./store.js";
import type { CliTestClient } from "./test-as.js";

/*
 * CLI 请求头样本（ADR 0013）：中转站每放行一次 Claude Code 或 Codex 的请求，就把它表明身份的那些头记成这个 CLI
 * 的最新样本，「按 Claude Code / Codex 的样子测」用它发测试请求。只留表明是哪个 CLI 的头；认证、会话、线程、
 * 对话、轮次、请求 id、Subagent、设备证明、Cookie 与 anthropic-beta 一律不留，请求体从不记。没有 User-Agent 的不记。
 */

/** 每个样本都不留的：只属于这次对话、这一轮或这个账号的，以及签名用的（magpie shapeHeader；Cookie 另按 ADR 0013）。 */
const NEVER_KEPT_WORDS = [
  "session",
  "thread",
  "conversation",
  "turn",
  "request-id",
  "authorization",
  "api-key",
  "attestation",
  "subagent",
  "luna-reserve",
  "cookie",
];

/** Claude Code 表明自己的头：User-Agent、x-app、anthropic-*、它的 SDK 的 x-stainless-*、x-claude-code-*。 */
function isClaudeCodeHeader(name: string): boolean {
  if (name === "user-agent" || name === "x-app") return true;
  return ["anthropic-", "x-stainless-", "x-claude-code-"].some((prefix) => name.startsWith(prefix));
}

/** Codex 表明自己的头：User-Agent、originator、version 与 x-openai-* / x-codex-*（会话、线程等随后去掉）。 */
function isCodexHeader(name: string): boolean {
  if (name === "user-agent" || name === "originator" || name === "version") return true;
  return name.startsWith("x-openai-") || name.startsWith("x-codex-");
}

function isKept(input: { client: CliTestClient; name: string }): boolean {
  const { name } = input;
  if (name === "anthropic-beta") return false;
  if (NEVER_KEPT_WORDS.some((word) => name.includes(word))) return false;
  return input.client === "claude_code" ? isClaudeCodeHeader(name) : isCodexHeader(name);
}

function headerText(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? value.join(", ") : value;
}

/** 这个请求要记下的样本（头名小写）；没有 User-Agent 为 null。 */
export function cliHeaderSample(input: {
  client: CliTestClient;
  headers: IncomingHttpHeaders | Record<string, string>;
}): CliHeaderSample | null {
  const sample: CliHeaderSample = {};
  for (const [rawName, value] of Object.entries(input.headers)) {
    const name = rawName.toLowerCase();
    const text = headerText(value);
    if (text === null || text === "" || !isKept({ client: input.client, name })) continue;
    sample[name] = text;
  }
  if (sample["user-agent"] === undefined) return null;
  return sample;
}

function headerOf(headers: IncomingHttpHeaders, name: string): string {
  return headerText(headers[name]) ?? "";
}

/** Claude Code 发的：User-Agent 以 claude-cli/ 开头。 */
export function isFromClaudeCode(headers: IncomingHttpHeaders): boolean {
  return headerOf(headers, "user-agent").startsWith("claude-cli/");
}

/** Codex 发的（CLI、exec、IDE 插件、桌面版、ACP 适配器）：User-Agent 或 originator 以 codex 或 acp-extension-codex 开头。 */
export function isFromCodex(headers: IncomingHttpHeaders): boolean {
  return [headerOf(headers, "user-agent"), headerOf(headers, "originator")].some((value) => {
    const lower = value.toLowerCase();
    return lower.startsWith("codex") || lower.startsWith("acp-extension-codex");
  });
}

function sameSample(a: CliHeaderSample | undefined, b: CliHeaderSample): boolean {
  if (a === undefined) return false;
  const names = Object.keys(b);
  return Object.keys(a).length === names.length && names.every((name) => a[name] === b[name]);
}

/**
 * 中转站记样本：和上次写下的一样就不写（magpie SawClient 的 written）。写失败只记日志，不影响转发这个请求。
 */
export class CliHeaderSamples {
  private readonly store: ApiEndpointStore;
  private readonly logger: pino.Logger;
  private readonly written = new Map<CliTestClient, CliHeaderSample>();

  constructor(options: { store: ApiEndpointStore; logger: pino.Logger }) {
    this.store = options.store;
    this.logger = options.logger;
  }

  saw(input: { client: CliTestClient; headers: IncomingHttpHeaders }): void {
    const sample = cliHeaderSample(input);
    if (sample === null || sameSample(this.written.get(input.client), sample)) return;
    try {
      this.store.writeCliHeaderSample({ client: input.client, sample });
    } catch (error) {
      const isFileError = error instanceof Error && "code" in error;
      if (!isFileError) throw error;
      this.logger.warn({ err: error, client: input.client }, "Couldn't keep the CLI header sample");
      return;
    }
    this.written.set(input.client, sample);
  }
}

/** Codex 还没经过中转站、也读不到它缓存的版本时用的（magpie codexClientVersion）。 */
export const CODEX_CLIENT_VERSION = "0.159.0";

const SEMVER = /\d+\.\d+\.\d+/;
const LEADING_SEMVER = /^\d+\.\d+\.\d+/;

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** 一个 Codex 请求说的自己的版本：version 头，没有就取 User-Agent 斜杠后开头的版本（magpie SawCodexClient）。 */
export function codexVersionOf(headers: IncomingHttpHeaders): string | null {
  const userAgent = headerOf(headers, "user-agent");
  const isCodex =
    headerOf(headers, "originator") !== "" || userAgent.toLowerCase().startsWith("codex");
  if (!isCodex) return null;
  const fromHeader = headerOf(headers, "version").match(SEMVER)?.[0];
  if (fromHeader !== undefined) return fromHeader;
  const afterSlash = userAgent.slice(userAgent.indexOf("/") + 1);
  const hasSlash = userAgent.includes("/");
  const leading = afterSlash.match(LEADING_SEMVER)?.[0];
  return hasSlash && leading !== undefined ? leading : null;
}

/**
 * 经中转站来过的 Codex 里最新的版本（magpie codexSeen）：用 ChatGPT 登录、只用 ChatGPT 自带模型的 Codex 不留样本，
 * 但它说了自己是哪个版本。只记在内存里。
 */
export class SeenCodexVersion {
  private newest: string | null = null;

  saw(headers: IncomingHttpHeaders): void {
    const version = codexVersionOf(headers);
    if (version === null) return;
    this.newest = newerCodexVersion(this.newest ?? version, version);
  }

  version(): string | null {
    return this.newest;
  }
}

/** 没有 Codex 样本时用的版本：内置的、Codex 缓存里记的、本机 Codex CLI 的、经中转站见过的，取最新（magpie codexVersion）。 */
export function newestCodexVersion(candidates: (string | null)[]): string {
  return candidates.reduce<string>(
    (newest, candidate) => newerCodexVersion(newest, candidate),
    CODEX_CLIENT_VERSION,
  );
}

/** 两个版本里较新的；other 不是版本时为 known（magpie newerVersion）。 */
export function newerCodexVersion(known: string, other: string | null): string {
  const found = other?.match(SEMVER)?.[0];
  if (found === undefined) return known;
  return compareVersions(found, known) > 0 ? found : known;
}

/** Codex 在 models_cache.json 里记的自己的版本；没有为 null。 */
export function cachedCodexVersion(text: string | null): string | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const version = (parsed as { client_version?: unknown }).client_version;
  return typeof version === "string" ? version : null;
}

export interface CodexSystem {
  // 「Mac OS 26.6.0」「Windows 10.0.26100」「Linux 6.8.0」
  os: string;
  arch: string;
  platform: NodeJS.Platform;
}

const CODEX_ARCH: Record<string, string> = { arm64: "arm64", x64: "x86_64" };
const CODEX_TERMINAL: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "Apple_Terminal/455",
  win32: "WindowsTerminal",
};

/**
 * 没有 Codex 样本时测试带的头：用 ChatGPT 登录的 Codex CLI 发请求时的那几个（magpie codexSign、codexUserAgent）。
 * 认证头不在这里，测试照常带这家的 key。
 */
export function codexSignHeaders(input: { version: string; system: CodexSystem }): CliHeaderSample {
  const { version, system } = input;
  const arch = CODEX_ARCH[system.arch] ?? system.arch;
  const terminal = CODEX_TERMINAL[system.platform] ?? "xterm-256color";
  return {
    "user-agent": `codex_cli_rs/${version} (${system.os}; ${arch}) ${terminal}`,
    originator: "codex_cli_rs",
    version,
  };
}

const VERSION_DIGITS = /\d+(\.\d+)+/;
const SYSTEM_COMMAND_TIMEOUT_MS = 3_000;

/** 跑一个报版本的系统命令，取输出里的版本号；意料之中的失败为 null。 */
export type VersionCommand = (input: { command: string; args: string[] }) => Promise<string | null>;

const runVersionCommand: VersionCommand = ({ command, args }) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: SYSTEM_COMMAND_TIMEOUT_MS }, (error, stdout) => {
      if (error === null) {
        resolve(stdout.match(VERSION_DIGITS)?.[0] ?? null);
        return;
      }
      // 只认三种意料之中的：命令不在（ENOENT）、命令自己报错退出（退出码是数字）、超时被杀。这三种都只是少了版本号，
      // 照 magpie 写不带版本的系统名；别的（权限、资源耗尽等）不是「这台机器没这个命令」，照抛给调用方。
      const isMissing = error.code === "ENOENT";
      const isFailedRun = typeof error.code === "number";
      const isTimedOut = error.killed === true;
      if (isMissing || isFailedRun || isTimedOut) {
        resolve(null);
        return;
      }
      reject(error);
    });
  });

function threeParts(version: string): string {
  let text = version;
  while (text.split(".").length < 3) text += ".0";
  return text;
}

async function codexOsName(input: {
  platform: NodeJS.Platform;
  run: VersionCommand;
}): Promise<string> {
  const { platform, run } = input;
  if (platform === "darwin") {
    const version = await run({ command: "sw_vers", args: ["-productVersion"] });
    return version === null ? "Mac OS" : `Mac OS ${threeParts(version)}`;
  }
  if (platform === "win32") {
    // 「Microsoft Windows [Version 10.0.26100.4652]」取前三段。
    const version = await run({ command: "cmd", args: ["/c", "ver"] });
    return version === null ? "Windows" : `Windows ${version.split(".").slice(0, 3).join(".")}`;
  }
  const version = await run({ command: "uname", args: ["-r"] });
  return version === null ? "Linux" : `Linux ${threeParts(version)}`;
}

/**
 * 本机的系统名与架构，照 Codex CLI 的写法。问成了就一直用；问失败（命令照抛的错）不留下，下次再问。
 */
export class CodexSystemReader {
  private readonly platform: NodeJS.Platform;
  private readonly run: VersionCommand;
  private system: Promise<CodexSystem> | null = null;

  constructor(options: { platform?: NodeJS.Platform; run?: VersionCommand } = {}) {
    this.platform = options.platform ?? process.platform;
    this.run = options.run ?? runVersionCommand;
  }

  read(): Promise<CodexSystem> {
    if (this.system !== null) return this.system;
    const { platform } = this;
    const asked = codexOsName({ platform, run: this.run }).then((name) => ({
      os: name,
      arch: os.arch(),
      platform,
    }));
    this.system = asked;
    const forget = () => {
      if (this.system === asked) this.system = null;
    };
    asked.catch(forget);
    return asked;
  }
}

const sharedCodexSystem = new CodexSystemReader();

/** 本机的系统名与架构（daemon 共用一份）。 */
export function readCodexSystem(): Promise<CodexSystem> {
  return sharedCodexSystem.read();
}
