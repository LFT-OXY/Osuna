import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import { readOptionalFile } from "../api-endpoints/config-file.js";
import { readCodexCredentialsStore } from "../api-endpoints/codex-config-patch.js";
import {
  decodeJwtClaims,
  isRecord,
  nonEmptyString,
  planLabel,
  type CliLoginReading,
} from "./cli-login.js";
import type { CliKeychain } from "./keychain.js";

/*
 * Codex 自己存的登录（codex-rs login/src/auth/storage.rs，970111f6）：
 * - cli_auth_credentials_store = "file"（缺省）：$CODEX_HOME/auth.json；
 * - "keyring"：钥匙串服务名 `Codex Auth`、账号 `cli|<CODEX_HOME 规范路径的 sha256 前 16 位>`，内容与 auth.json 同形；
 * - "auto"：钥匙串没有再看文件；
 * - "ephemeral"：只在 Codex 进程的内存里，Osuna 换不了。
 */

const CODEX_KEYRING_SERVICE = "Codex Auth";

export interface CodexLoginLocation {
  codexHome: string;
  keychain: CliKeychain;
}

/** 钥匙串里这个 CODEX_HOME 的那一项的账号名（Codex 的 compute_store_key）。 */
export function codexKeyringAccount(codexHome: string): string {
  let canonical = codexHome;
  try {
    canonical = realpathSync(codexHome);
  } catch {
    // 目录还不存在时 Codex 也用原样的路径。
  }
  const digest = createHash("sha256").update(canonical).digest("hex");
  return `cli|${digest.slice(0, 16)}`;
}

/** 读 Codex 现在登录的号；只解资料，不留 token。 */
export async function readCodexLogin(location: CodexLoginLocation): Promise<CliLoginReading> {
  const { codexHome, keychain } = location;
  const configText =
    readOptionalFile(path.join(codexHome, "config.toml"))?.toString("utf8") ?? null;
  const store = readCodexCredentialsStore(configText);
  switch (store.kind) {
    case "unparsable":
      return {
        kind: "unsupported",
        code: "config_unparsable",
        reason: `Codex's config.toml can't be read: ${store.message}`,
      };
    case "unknown":
      return {
        kind: "unsupported",
        code: "unknown_store",
        reason: `Codex stores its login as "${store.value}", which Osuna doesn't know`,
      };
    case "ephemeral":
      return {
        kind: "unsupported",
        code: "ephemeral",
        reason: "Codex keeps its login in memory only (cli_auth_credentials_store = ephemeral)",
      };
    case "file":
      return readAuthJson(readAuthFile(codexHome));
    case "keyring":
    case "auto": {
      if (!keychain.available) {
        if (store.kind === "auto") {
          return readAuthJson(readAuthFile(codexHome));
        }
        return {
          kind: "unsupported",
          code: "keyring_unavailable",
          reason: "Osuna can't read the system keyring on this platform",
        };
      }
      const stored = await keychain.read(CODEX_KEYRING_SERVICE, codexKeyringAccount(codexHome));
      if (stored !== null || store.kind === "keyring") return readAuthJson(stored ?? undefined);
      return readAuthJson(readAuthFile(codexHome));
    }
  }
}

function readAuthFile(codexHome: string): string | undefined {
  return readOptionalFile(path.join(codexHome, "auth.json"))?.toString("utf8");
}

function readAuthJson(text: string | undefined): CliLoginReading {
  if (text === undefined) return { kind: "signed_out" };
  let auth: unknown;
  try {
    auth = JSON.parse(text);
  } catch {
    return { kind: "unsupported", code: "login_unparsable", reason: "Codex's login can't be read" };
  }
  const profile = codexLoginProfile(auth);
  // 只用 API key 登录的 Codex 没有 ChatGPT 的 tokens：没有可轮换的订阅号。
  if (profile === "no_tokens") return { kind: "signed_out" };
  if (profile === "no_account") {
    return {
      kind: "unsupported",
      code: "login_unparsable",
      reason: "Codex's login names no ChatGPT account",
    };
  }
  return { kind: "signed_in", ...profile };
}

export interface CodexLoginProfile {
  identity: string;
  email?: string;
  plan?: string;
}

/** 一份 auth.json 形状的登录是哪个号：账号 ID（与套餐用量的报告 ID 同口径）、邮箱与套餐，都从 id_token 解出。 */
export function codexLoginProfile(auth: unknown): CodexLoginProfile | "no_tokens" | "no_account" {
  const tokens = isRecord(auth) && isRecord(auth.tokens) ? auth.tokens : null;
  if (!tokens || !nonEmptyString(tokens.id_token)) return "no_tokens";
  const claims = decodeJwtClaims(nonEmptyString(tokens.id_token));
  const openAiAuth =
    claims && isRecord(claims["https://api.openai.com/auth"])
      ? claims["https://api.openai.com/auth"]
      : null;
  const identity =
    nonEmptyString(tokens.account_id) ?? nonEmptyString(openAiAuth?.chatgpt_account_id);
  if (!identity) return "no_account";
  const email = nonEmptyString(claims?.email);
  const plan = planLabel(nonEmptyString(openAiAuth?.chatgpt_plan_type));
  return { identity, ...(email ? { email } : {}), ...(plan ? { plan } : {}) };
}
