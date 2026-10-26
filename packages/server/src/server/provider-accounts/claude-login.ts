// 写 Claude Code 的登录、换下的号收回私有目录与清目录移植自 magpie（https://github.com/yetone/magpie，d5805372）：
// internal/provider/logins.go 的 putClaudeLogin，claude_dirs.go 的 claudeSavedDir、clearClaudeDir、forgetClaudeDir。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { readOptionalFile, writeConfigFileGuarded } from "../api-endpoints/config-file.js";
import { detectFormatting, edit, splitBom } from "../api-endpoints/jsonc-edit.js";
import { writePrivateFileAtomicSync } from "../private-files.js";
import { isRecord, nonEmptyString, planLabel, type CliLoginReading } from "./cli-login.js";
import type { CliKeychain } from "./keychain.js";

/*
 * Claude Code 自己存的登录（官方文档 authentication#credential-management，与 claude-usage-source 同一套推导）：
 * - macOS：钥匙串服务名 `Claude Code-credentials`，设了 CLAUDE_CONFIG_DIR 时加 `-<该目录 NFC 后 sha256 前 8 位>`，
 *   账号是 $USER（不合规时 claude-code-user）；钥匙串没有时退回文件；
 * - 其他系统：<配置目录>/.credentials.json 的 claudeAiOauth；
 * - 登录的是哪个号记在 .claude.json 的 oauthAccount：设了 CLAUDE_CONFIG_DIR 在该目录里，否则在 home 下。
 */

const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
const KEYCHAIN_ACCOUNT_PATTERN = /^[a-zA-Z0-9._-]+$/;
const KEYCHAIN_FALLBACK_ACCOUNT = "claude-code-user";

export interface ClaudeLoginLocation {
  // 提供方环境里的 CLAUDE_CONFIG_DIR；没设为 null。
  configDir: string | null;
  homeDir: string;
  user: string | undefined;
  platform: NodeJS.Platform;
  keychain: CliKeychain;
}

export function claudeKeychainService(configDir: string | null): string {
  if (configDir === null) return CLAUDE_KEYCHAIN_SERVICE;
  const digest = createHash("sha256").update(configDir.normalize("NFC")).digest("hex");
  return `${CLAUDE_KEYCHAIN_SERVICE}-${digest.slice(0, 8)}`;
}

export function claudeKeychainAccount(user: string | undefined): string {
  return user && KEYCHAIN_ACCOUNT_PATTERN.test(user) ? user : KEYCHAIN_FALLBACK_ACCOUNT;
}

/** Claude Code 的登录放在哪：钥匙串里这个配置目录的那一项，或配置目录下的 .credentials.json。 */
export type ClaudeLoginWhere = "keychain" | "file";

/**
 * Claude Code 现在存着的整份登录，换号时用；text 是读到的原文（整份凭证 JSON，含 refresh token），
 * 写回前比对它（写前重读）。只在 Osuna 的进程里经过，从不进账号存储。
 */
export type ClaudeCliLogin =
  | {
      kind: "signed_in";
      where: ClaudeLoginWhere;
      text: string;
      identity: string;
      email?: string;
      plan?: string;
      // .claude.json 的 oauthAccount：换下这个号时随登录收回。
      oauthAccount: Record<string, unknown>;
    }
  // text：存着的那一项读得懂但没有 token（登出后留下的空登录），写入时比对它。
  | { kind: "signed_out"; where: ClaudeLoginWhere; text?: string }
  | Extract<CliLoginReading, { kind: "unsupported" }>;

/** 读 Claude Code 现在登录的号；只解资料，不留 token。 */
export async function readClaudeLogin(location: ClaudeLoginLocation): Promise<CliLoginReading> {
  const cli = await readClaudeCliLogin(location);
  if (cli.kind !== "signed_in") return cli.kind === "signed_out" ? { kind: "signed_out" } : cli;
  return {
    kind: "signed_in",
    identity: cli.identity,
    ...(cli.email ? { email: cli.email } : {}),
    ...(cli.plan ? { plan: cli.plan } : {}),
  };
}

/** 按 Claude Code 自己的存法读整份登录与 .claude.json 里记下的号。 */
export async function readClaudeCliLogin(location: ClaudeLoginLocation): Promise<ClaudeCliLogin> {
  const stored = await readCredentials(location);
  const credentials = oauthOf(stored.text);
  if (credentials === "unparsable") {
    return {
      kind: "unsupported",
      code: "login_unparsable",
      reason: "Claude Code's login can't be read",
    };
  }
  if (credentials === null || stored.text === null) {
    return {
      kind: "signed_out",
      where: stored.where,
      ...(stored.text !== null ? { text: stored.text } : {}),
    };
  }
  const account = readOauthAccount(location);
  if (account === "unparsable") {
    return {
      kind: "unsupported",
      code: "login_unparsable",
      reason: "Claude Code's .claude.json can't be read",
    };
  }
  const accountUuid = nonEmptyString(account?.accountUuid);
  const organizationUuid = nonEmptyString(account?.organizationUuid);
  if (!account || !accountUuid || !organizationUuid) {
    return {
      kind: "unsupported",
      code: "account_unknown",
      reason: "Claude Code hasn't recorded which account is signed in",
    };
  }
  const email = nonEmptyString(account.emailAddress);
  const plan = planLabel(nonEmptyString(credentials.subscriptionType));
  return {
    kind: "signed_in",
    where: stored.where,
    text: stored.text,
    // 与 claude-usage-source 的账号键同一个口径：账号 UUID.组织 UUID。
    identity: `${accountUuid}.${organizationUuid}`,
    ...(email ? { email } : {}),
    ...(plan ? { plan } : {}),
    oauthAccount: account,
  };
}

type ClaudeOauth = Record<string, unknown>;

/**
 * 登录原文与它所在的地方。macOS 上钥匙串里有这一项就以它为准（读得懂但空了也算登出，Claude Code 不再看文件）；
 * 没有就看文件。两处都没有时 where 是 Claude Code 在这个系统上新存登录的地方。
 */
async function readCredentials(
  location: ClaudeLoginLocation,
): Promise<{ where: ClaudeLoginWhere; text: string | null }> {
  const keychain = location.platform === "darwin" && location.keychain.available;
  if (keychain) {
    const stored = await location.keychain.read(
      claudeKeychainService(location.configDir),
      claudeKeychainAccount(location.user),
    );
    if (stored !== null) return { where: "keychain", text: stored };
  }
  const file = readOptionalFile(credentialsPath(location));
  if (file !== null) return { where: "file", text: file.toString("utf8") };
  return { where: keychain ? "keychain" : "file", text: null };
}

function credentialsPath(location: ClaudeLoginLocation): string {
  const configDir = location.configDir ?? path.join(location.homeDir, ".claude");
  return path.join(configDir, ".credentials.json");
}

function oauthOf(text: string | null): ClaudeOauth | "unparsable" | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "unparsable";
  }
  if (!isRecord(parsed)) return "unparsable";
  const oauth = parsed.claudeAiOauth;
  if (!isRecord(oauth) || !nonEmptyString(oauth.accessToken)) return null;
  return oauth;
}

/** 写回时 Claude Code 的登录或 .claude.json 与读到时不一样了（它自己续了或换了号）；什么都没写。 */
export class ClaudeLoginChangedError extends Error {
  constructor() {
    super("Claude Code's login changed while Osuna was writing it");
    this.name = "ClaudeLoginChangedError";
  }
}

/**
 * 把一份登录写进 Claude Code 读到它的那个地方（照 magpie 的 putClaudeLogin）：写前重读、与 expected
 * （读到的原文，没有时为 null）不同就不写。钥匙串那一项写成一行（多行的会被 `security -w` 印成十六进制，
 * Claude Code 当作没登录）；文件原子替换、保留权限。text 为 null 是删掉这份登录（换号失败时撤回）。
 * 返回写下的原文（撤回时比对它）。
 */
export async function writeClaudeCliLogin(input: {
  location: ClaudeLoginLocation;
  where: ClaudeLoginWhere;
  expected: string | null;
  text: string | null;
}): Promise<string | null> {
  const { location, where, expected, text } = input;
  if (where === "keychain") {
    const service = claudeKeychainService(location.configDir);
    const account = claudeKeychainAccount(location.user);
    if ((await location.keychain.read(service, account)) !== expected) {
      throw new ClaudeLoginChangedError();
    }
    if (text === null) {
      await location.keychain.delete(service, account);
      return null;
    }
    const line = JSON.stringify(JSON.parse(text));
    await location.keychain.write(service, account, line);
    return line;
  }
  const written = text === null ? null : withNewline(text);
  const result = writeConfigFileGuarded({
    filePath: credentialsPath(location),
    compute: (current) => {
      if ((current?.toString("utf8") ?? null) !== expected) throw new ClaudeLoginChangedError();
      return {
        change: written === null ? { kind: "delete" } : { kind: "write", text: written },
        value: null,
      };
    },
    commit: () => undefined,
    rollback: () => undefined,
  });
  if (result.kind === "conflict") throw new ClaudeLoginChangedError();
  return written;
}

/**
 * 把 .claude.json 的 oauthAccount 换成这个号的资料，别的键原样不动（按 JSONC 只改这一键）；写前重读，
 * 原子替换、保留权限。文件还不存在时新建。
 */
export function writeClaudeOauthAccount(input: {
  location: ClaudeLoginLocation;
  oauthAccount: Record<string, unknown>;
}): void {
  const filePath = profilePath(input.location);
  const result = writeConfigFileGuarded({
    filePath,
    compute: (current) => {
      const text = current?.toString("utf8") ?? null;
      if (text === null) {
        return {
          change: {
            kind: "write",
            text: withNewline(JSON.stringify({ oauthAccount: input.oauthAccount }, null, 2)),
          },
          value: null,
        };
      }
      const { bom, body } = splitBom(text);
      const parsed: unknown = parseJsonc(body);
      // 换号前在锁里读它时还读得懂：现在读不懂就是被改过了。
      if (!isRecord(parsed)) throw new ClaudeLoginChangedError();
      const edited = edit(body, ["oauthAccount"], input.oauthAccount, detectFormatting(body));
      return { change: { kind: "write", text: `${bom}${edited}` }, value: null };
    },
    commit: () => undefined,
    rollback: () => undefined,
  });
  if (result.kind === "conflict") throw new ClaudeLoginChangedError();
}

/**
 * 把一份登录放进存着的号的私有配置目录（换下的号从 Claude Code 收回到这里）：.credentials.json 与
 * 记着是哪个号的 .claude.json（照 magpie 的 claudeSavedDir）。macOS 上 Claude Code 在这个目录没有钥匙串项时读这个文件。
 */
export function putClaudeConfigDir(input: {
  configDir: string;
  text: string;
  oauthAccount: Record<string, unknown>;
}): void {
  const { configDir, text, oauthAccount } = input;
  writePrivateFileAtomicSync(path.join(configDir, ".credentials.json"), withNewline(text));
  writePrivateFileAtomicSync(
    path.join(configDir, ".claude.json"),
    withNewline(JSON.stringify({ oauthAccount, hasCompletedOnboarding: true }, null, 2)),
  );
}

function withNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function profilePath(location: ClaudeLoginLocation): string {
  return path.join(location.configDir ?? location.homeDir, ".claude.json");
}

/** .claude.json 的 oauthAccount；没有这个文件或这一键为 null，读不懂为 "unparsable"。 */
export function readOauthAccount(
  location: ClaudeLoginLocation,
): Record<string, unknown> | "unparsable" | null {
  const file = readOptionalFile(profilePath(location));
  if (file === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.toString("utf8"));
  } catch {
    return "unparsable";
  }
  if (!isRecord(parsed)) return "unparsable";
  return isRecord(parsed.oauthAccount) ? parsed.oauthAccount : null;
}

/**
 * 清掉存着的 Claude 号的私有配置目录：macOS 上 Claude Code 把这个目录的登录存在按目录取后缀的钥匙串项里，
 * 先删那一项，再删整个目录（照 magpie 的 clearClaudeDir、forgetClaudeDir）。
 */
export async function removeClaudeConfigDir(
  location: Omit<ClaudeLoginLocation, "configDir" | "homeDir"> & { configDir: string },
): Promise<void> {
  if (location.platform === "darwin" && location.keychain.available) {
    await location.keychain.delete(
      claudeKeychainService(location.configDir),
      claudeKeychainAccount(location.user),
    );
  }
  await rm(location.configDir, { recursive: true, force: true });
}
