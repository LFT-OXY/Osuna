import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import { readOptionalFile, writeConfigFileGuarded } from "../api-endpoints/config-file.js";
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

/** Codex 的登录放在哪：auth.json 或钥匙串里这个 CODEX_HOME 的那一项。 */
export type CodexLoginWhere = "file" | "keyring";

/**
 * CLI 里现在的整份登录，换号与续期当前号用；text 是读到的原文，写回前比对它（写前重读）。
 * 只在 Osuna 的进程里经过，从不进账号存储（一个登录只有一个持有者）。
 */
export type CodexCliLogin =
  | {
      kind: "signed_in";
      where: CodexLoginWhere;
      text: string;
      login: Record<string, unknown>;
      profile: CodexLoginProfile;
    }
  // text：只用 API key 登录时 CLI 里那份登录的原文（没有订阅号，但有东西不能盖掉）。
  | { kind: "signed_out"; where: CodexLoginWhere; text?: string }
  | Extract<CliLoginReading, { kind: "unsupported" }>;

/** 读 Codex 现在登录的号；只解资料，不留 token。 */
export async function readCodexLogin(location: CodexLoginLocation): Promise<CliLoginReading> {
  const cli = await readCodexCliLogin(location);
  if (cli.kind !== "signed_in") return cli.kind === "signed_out" ? { kind: "signed_out" } : cli;
  return { kind: "signed_in", ...cli.profile };
}

/** 按 cli_auth_credentials_store 读 CLI 里的整份登录。 */
export async function readCodexCliLogin(location: CodexLoginLocation): Promise<CodexCliLogin> {
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
      return parseCliLogin({ text: readAuthFile(codexHome), where: "file" });
    case "keyring":
    case "auto": {
      if (!keychain.available) {
        if (store.kind === "auto") {
          return parseCliLogin({ text: readAuthFile(codexHome), where: "file" });
        }
        return {
          kind: "unsupported",
          code: "keyring_unavailable",
          reason: "Osuna can't read the system keyring on this platform",
        };
      }
      const stored = await keychain.read(CODEX_KEYRING_SERVICE, codexKeyringAccount(codexHome));
      if (stored !== null || store.kind === "keyring") {
        return parseCliLogin({ text: stored ?? undefined, where: "keyring" });
      }
      // auto：钥匙串没有这一项时 Codex 用文件。
      return parseCliLogin({ text: readAuthFile(codexHome), where: "file" });
    }
  }
}

/** 写回时 CLI 的登录与读到时不一样了（Codex 自己续了或换了号）；什么都没写。 */
export class CodexLoginChangedError extends Error {
  constructor() {
    super("Codex's login changed while Osuna was writing it");
    this.name = "CodexLoginChangedError";
  }
}

/**
 * 把一份登录写进 CLI 读到它的那个地方，守 ADR 0004 的改写规则：写前重读、与 expected（读到的原文，
 * 没登录时为 null）不同就不写；文件原子替换、保留权限；钥匙串那一项写成一行，与 Codex 自己写的一样。
 */
export async function writeCodexCliLogin(input: {
  location: CodexLoginLocation;
  where: CodexLoginWhere;
  expected: string | null;
  login: Record<string, unknown>;
}): Promise<void> {
  const { location, where, expected, login } = input;
  const { codexHome, keychain } = location;
  if (where === "keyring") {
    const account = codexKeyringAccount(codexHome);
    if ((await keychain.read(CODEX_KEYRING_SERVICE, account)) !== expected) {
      throw new CodexLoginChangedError();
    }
    await keychain.write(CODEX_KEYRING_SERVICE, account, JSON.stringify(login));
    return;
  }
  const result = writeConfigFileGuarded({
    filePath: path.join(codexHome, "auth.json"),
    compute: (current) => {
      if ((current?.toString("utf8") ?? null) !== expected) throw new CodexLoginChangedError();
      return {
        change: { kind: "write", text: `${JSON.stringify(login, null, 2)}\n` },
        value: null,
      };
    },
    commit: () => undefined,
    rollback: () => undefined,
  });
  if (result.kind === "conflict") throw new CodexLoginChangedError();
}

function readAuthFile(codexHome: string): string | undefined {
  return readOptionalFile(path.join(codexHome, "auth.json"))?.toString("utf8");
}

function parseCliLogin(input: { text: string | undefined; where: CodexLoginWhere }): CodexCliLogin {
  const { text, where } = input;
  if (text === undefined) return { kind: "signed_out", where };
  let auth: unknown;
  try {
    auth = JSON.parse(text);
  } catch {
    return { kind: "unsupported", code: "login_unparsable", reason: "Codex's login can't be read" };
  }
  const profile = codexLoginProfile(auth);
  // 只用 API key 登录的 Codex 没有 ChatGPT 的 tokens：没有可轮换的订阅号。
  if (profile === "no_tokens" || !isRecord(auth)) return { kind: "signed_out", where, text };
  if (profile === "no_account") {
    return {
      kind: "unsupported",
      code: "login_unparsable",
      reason: "Codex's login names no ChatGPT account",
    };
  }
  return { kind: "signed_in", where, text, login: auth, profile };
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
