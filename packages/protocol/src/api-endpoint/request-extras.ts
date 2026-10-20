// 附加请求体的保留字段、`!` 与校验、key 放哪个头的取值移植自 magpie（https://github.com/yetone/magpie，
// internal/provider/extrabody.go 的 ExtraBodyReserved、extraName、ExtraBodyOK，authheader.go 的 AuthChoices，
// internal/gui/assets/app.js 的 twoKeyHeaders）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

/*
 * 接口自己加给每个请求的东西（Headers，ADR 0008）：请求头、附加请求体、key 放哪个头。
 * daemon 保存时拿它校验、发请求时拿它取值；app 在表单里拿它当场提示。
 */

/** key 放哪个头：两个都放（缺省）、只放 x-api-key、只放 Authorization: Bearer。只对第三方 Anthropic 地址起作用。 */
export const API_ENDPOINT_KEY_HEADERS = ["both", "x-api-key", "bearer"] as const;
export type ApiEndpointKeyHeader = (typeof API_ENDPOINT_KEY_HEADERS)[number];

/** 线上与文件里是字符串：不认识的、没有的都当两个都放（照 magpie normalize）。 */
export function keyHeaderOf(raw: string | undefined): ApiEndpointKeyHeader {
  return API_ENDPOINT_KEY_HEADERS.find((choice) => choice === raw) ?? "both";
}

/** 地址的主机名（小写）；空的为 ""，读不出的为 null。 */
function hostOf(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed === "") return "";
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

/**
 * Anthropic 自己或 Bedrock 的 Anthropic 地址：key 只放 x-api-key，两个都带会被拒（照 magpie AuthHeaders 的
 * `HasSuffix(Host, "anthropic.com") || IsBedrock`）。
 */
export function takesXApiKeyAlone(url: string): boolean {
  const host = hostOf(url) ?? "";
  const isAnthropic = host.endsWith("anthropic.com");
  const isBedrock = /^bedrock-runtime\..*\.amazonaws\.com$/.test(host);
  return isAnthropic || isBedrock;
}

/**
 * 地址是第三方 Anthropic 地址：key 默认两个头都放、能改成只放一个的那种。Anthropic 自己、Bedrock、Azure 的只收一种，
 * 不算（照 magpie twoKeyHeaders）。读不出主机的按第三方算。
 */
export function isThirdPartyAnthropicUrl(url: string): boolean {
  const host = hostOf(url);
  if (host === "") return false;
  if (host === null) return true;
  const isAzure = host.endsWith(".azure.com");
  return !takesXApiKeyAlone(url) && !isAzure;
}

/** 附加请求体不能设的字段：模型与要不要流式（路由与读回复靠它们），以及对话本身。 */
export const EXTRA_BODY_RESERVED = [
  "model",
  "stream",
  "messages",
  "input",
  "contents",
  "system",
  "systemInstruction",
  "system_instruction",
  "instructions",
  "tools",
] as const;

/** 字符串值里写它，发出去时换成这段对话的标识。 */
export const EXTRA_BODY_SESSION_PLACEHOLDER = "${sessionId}";

/** 附加请求体一个字段的名字（去掉开头的 `!` 与空白）与它是不是强制覆盖。 */
export interface ExtraBodyFieldName {
  name: string;
  isForced: boolean;
}

export function extraBodyFieldName(key: string): ExtraBodyFieldName {
  const trimmed = key.trim();
  const isForced = trimmed.startsWith("!");
  const name = (isForced ? trimmed.slice(1) : trimmed).trim();
  return { name, isForced };
}

export function isReservedExtraBodyField(name: string): boolean {
  return EXTRA_BODY_RESERVED.some((reserved) => reserved === name);
}

/** 附加请求体哪里不对：字段没名字、是保留字段、同一个名字写了两次（带不带 `!` 都算）。 */
export type ExtraBodyProblem =
  | { reason: "unnamed" }
  | { reason: "reserved"; field: string }
  | { reason: "duplicate"; field: string };

/** 按字段名排好序逐个看（照 magpie ExtraBodyOK），第一处不对的；都对为 null。 */
export function extraBodyProblem(extraBody: Record<string, unknown>): ExtraBodyProblem | null {
  const seen = new Set<string>();
  for (const key of Object.keys(extraBody).sort()) {
    const { name } = extraBodyFieldName(key);
    if (name === "") return { reason: "unnamed" };
    if (isReservedExtraBodyField(name)) return { reason: "reserved", field: name };
    if (seen.has(name)) return { reason: "duplicate", field: name };
    seen.add(name);
  }
  return null;
}

// RFC 9110 的 token；值里不能有换行、控制字符或 Latin-1 以外的字符（如中文），Node 发请求时会拒绝整个请求。
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const BAD_HEADER_VALUE = /[^\t\x20-\x7e\x80-\xff]/;

/** 请求头哪里不对：名字不是合法的头名、值里有换行等字符。 */
export type HeaderProblem = { reason: "name"; name: string } | { reason: "value"; name: string };

export function headerProblem(headers: Record<string, string>): HeaderProblem | null {
  for (const [name, value] of Object.entries(headers)) {
    if (!HEADER_NAME.test(name)) return { reason: "name", name };
    if (BAD_HEADER_VALUE.test(value)) return { reason: "value", name };
  }
  return null;
}

/**
 * 收拢请求头（照 magpie cleanHeaders）：名字与值去掉首尾空白，名字空的不要，值空的照留；大小写不同的同名头只留后写的
 * （照 magpie app.js headersOf）。一个都不剩为 null。表单另把值空的行去掉再交给它。
 */
export function cleanRequestHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers ?? {})) {
    const name = rawName.trim();
    const value = rawValue.trim();
    if (name === "") continue;
    for (const had of Object.keys(out)) {
      if (had.toLowerCase() === name.toLowerCase()) delete out[had];
    }
    out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}
