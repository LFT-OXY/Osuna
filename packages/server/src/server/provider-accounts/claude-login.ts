import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { readOptionalFile } from "../api-endpoints/config-file.js";
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

/** 读 Claude Code 现在登录的号；只解资料，不留 token。 */
export async function readClaudeLogin(location: ClaudeLoginLocation): Promise<CliLoginReading> {
  const credentials = await readCredentials(location);
  if (credentials === "unparsable") {
    return {
      kind: "unsupported",
      code: "login_unparsable",
      reason: "Claude Code's login can't be read",
    };
  }
  if (credentials === null) return { kind: "signed_out" };
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
  if (!accountUuid || !organizationUuid) {
    return {
      kind: "unsupported",
      code: "account_unknown",
      reason: "Claude Code hasn't recorded which account is signed in",
    };
  }
  const email = nonEmptyString(account?.emailAddress);
  const plan = planLabel(nonEmptyString(credentials.subscriptionType));
  return {
    kind: "signed_in",
    // 与 claude-usage-source 的账号键同一个口径：账号 UUID.组织 UUID。
    identity: `${accountUuid}.${organizationUuid}`,
    ...(email ? { email } : {}),
    ...(plan ? { plan } : {}),
  };
}

type ClaudeOauth = Record<string, unknown>;

async function readCredentials(
  location: ClaudeLoginLocation,
): Promise<ClaudeOauth | "unparsable" | null> {
  if (location.platform === "darwin" && location.keychain.available) {
    const stored = await location.keychain.read(
      claudeKeychainService(location.configDir),
      claudeKeychainAccount(location.user),
    );
    if (stored !== null) return oauthOf(stored);
  }
  const configDir = location.configDir ?? path.join(location.homeDir, ".claude");
  const file = readOptionalFile(path.join(configDir, ".credentials.json"));
  return file === null ? null : oauthOf(file.toString("utf8"));
}

function oauthOf(text: string): ClaudeOauth | "unparsable" | null {
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

/** .claude.json 的 oauthAccount；没有这个文件或这一键为 null，读不懂为 "unparsable"。 */
export function readOauthAccount(
  location: ClaudeLoginLocation,
): Record<string, unknown> | "unparsable" | null {
  const filePath = path.join(location.configDir ?? location.homeDir, ".claude.json");
  const file = readOptionalFile(filePath);
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
