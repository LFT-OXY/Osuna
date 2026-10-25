/**
 * 读 CLI 自己存的登录得到的答案。只带资料，不带 token：当前在用的号的登录只在 CLI 那里（一个登录只有一个持有者）。
 * - signed_in：identity 是账号的稳定标识（Codex 的 ChatGPT 账号 ID、Claude 的账号 UUID.组织 UUID），
 *   与套餐用量来源的报告 ID 同一个口径；
 * - signed_out：没有订阅登录（含只用 API key 的 Codex）；
 * - unsupported：Osuna 换不了这种登录，code 与 reason 见 protocol 的 ProviderAccountBlock。
 */
export type CliLoginReading =
  | { kind: "signed_in"; identity: string; email?: string; plan?: string }
  | { kind: "signed_out" }
  | { kind: "unsupported"; code: CliLoginUnsupportedCode; reason: string };

export type CliLoginUnsupportedCode =
  | "ephemeral"
  | "unknown_store"
  | "config_unparsable"
  | "keyring_unavailable"
  | "login_unparsable"
  | "account_unknown";

/** 解开 JWT 的第二段；读不懂为 null。只在本机解，不校验签名。 */
export function decodeJwtClaims(token: string | undefined): Record<string, unknown> | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 套餐名首字母大写（plus → Plus、max → Max），照 claude-usage-source 的写法，两家显示一致。 */
export function planLabel(plan: string | undefined): string | undefined {
  if (!plan) return undefined;
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}
