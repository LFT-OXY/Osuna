// 用户请求头的写法与 anthropic-beta 合并、附加请求体的合并与 ${sessionId} 移植自 magpie（https://github.com/yetone/magpie，
// internal/provider/account.go 的 Sign、ListHeader、MergeList，internal/catalog/userheader.go 的 PutUserHeader，
// internal/provider/extrabody.go 的 WithExtraBody、withSession、tested，internal/gateway/gateway.go 的 sessionOf、conversationID）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { createHash, randomBytes } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import {
  EXTRA_BODY_SESSION_PLACEHOLDER,
  cleanRequestHeaders,
  extraBodyFieldName,
  headerProblem,
  isReservedExtraBodyField,
  isThirdPartyAnthropicUrl,
  takesXApiKeyAlone,
  type ApiEndpointKeyHeader,
  type HeaderProblem,
} from "@getpaseo/protocol/api-endpoint/request-extras";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { KeyHeaders } from "./gateway/refusals.js";
import { uncheckedHostsOf } from "./insecure-tls.js";
import type { StoredApiEndpoint } from "./store.js";
import { templateKeyHeaders } from "./templates.js";
import { isRecord } from "./upstream-http.js";

/*
 * 这家每个上游请求都带的、用户自己设的东西（ADR 0008）：中转站转发（直通与翻译后）、测试连接、自动检测（单次与逐个模型）、
 * 拉模型、测试模型（含按 CLI 的样子测）都经这里，一个都不漏。
 * - 请求头写在 Osuna 填的所有头（认证头也算）之后，大小写不同也算同名、换成用户的；anthropic-beta 不换，按逗号合并去重，
 *   原有的在前（照 magpie Sign）。用户自己填了认证头时，「两个认证头被拒就改用一个」不再触发。
 * - 附加请求体只给对话请求（Messages、Chat、Responses），只数 token 的不带；没有的字段补上，`!` 开头的强制覆盖，
 *   保留字段不动；字符串里的 ${sessionId} 换成这段对话的标识（测试与检测用一个 osuna-test- 开头的）。
 * - key 放哪个头只对第三方 Anthropic 地址起作用（keyHeadersAt）。
 * - 不校验证书只对这家自己的 https 主机起作用（insecure-tls.ts）：fetch 走 upstreamFetch，中转站看 skipsCertificateCheck。
 * 头的值可能是密钥：不写日志，报错里和 key 一样打码（secretsOf）。头名、值发不出去的（不合法的头名、值里有换行）
 * 照存，发时这一个请求报 invalid_header（unsendableHeader），不让 Node 抛错。
 */

export interface RequestExtras {
  // 已收拢（名字照用户写的）；没有为空对象。
  headers: Record<string, string>;
  extraBody: Record<string, unknown>;
  keyHeader: ApiEndpointKeyHeader;
  // 不校验证书的主机（insecure-tls.ts 的 uncheckedHostsOf）；没开为空。
  uncheckedHosts: readonly string[];
}

export const NO_REQUEST_EXTRAS: RequestExtras = {
  headers: {},
  extraBody: {},
  keyHeader: "both",
  uncheckedHosts: [],
};

/** 这家存的请求头、附加请求体、key 放哪个头与不校验证书；没有这家时什么都不加。 */
export function storedRequestExtras(
  endpoint:
    | Pick<
        StoredApiEndpoint,
        "headers" | "extraBody" | "keyHeader" | "insecureTls" | "templateId" | "baseUrls"
      >
    | null
    | undefined,
): RequestExtras {
  if (!endpoint) return NO_REQUEST_EXTRAS;
  const headers = cleanRequestHeaders(endpoint.headers) ?? {};
  const extraBody = endpoint.extraBody ?? {};
  const uncheckedHosts = uncheckedHostsOf({
    insecureTls: endpoint.insecureTls,
    templateId: endpoint.templateId,
    urls: endpoint.baseUrls.map(({ url }) => url),
  });
  return { headers, extraBody, keyHeader: endpoint.keyHeader ?? "both", uncheckedHosts };
}

// 用户选的只放一个头，换成 KeyHeaders 的叫法。
const CHOSEN_KEY_HEADERS: Record<ApiEndpointKeyHeader, KeyHeaders | null> = {
  both: null,
  "x-api-key": "xApiKey",
  bearer: "bearer",
};

/**
 * 发给这家这种格式时 key 放哪（照 magpie AuthHeaders）：Bedrock、Azure 模板由模板定；OpenAI 格式只放 Bearer；
 * Anthropic 自己与 Bedrock 的地址只放 x-api-key；第三方 Anthropic 地址照用户选的，没选是 anthropicDefault
 * （中转站与测试两个都放，老客户端的测试连接照 Claude Code 只放 Bearer）。
 */
export function keyHeadersAt(input: {
  format: ApiEndpointRequestFormat;
  templateId: string | undefined;
  baseUrl: string;
  keyHeader: ApiEndpointKeyHeader;
  anthropicDefault: KeyHeaders;
}): KeyHeaders {
  const fixed = templateKeyHeaders({ templateId: input.templateId, format: input.format });
  if (fixed !== null) return fixed;
  if (input.format !== "anthropic_messages") return "bearer";
  if (takesXApiKeyAlone(input.baseUrl)) return "xApiKey";
  const chosen = CHOSEN_KEY_HEADERS[input.keyHeader];
  const isChoiceTaken = chosen !== null && isThirdPartyAnthropicUrl(input.baseUrl);
  return isChoiceTaken ? chosen : input.anthropicDefault;
}

/** 这家的请求头里第一个发不出去的（不合法的头名、值里有换行）；都能发为 null。 */
export function unsendableHeader(extras: RequestExtras): HeaderProblem | null {
  return headerProblem(extras.headers);
}

/** 发不出去的头在这一个请求上的原因（英文原文；界面按 invalid_header 与 params.name 用界面语言说）。 */
export function unsendableHeaderMessage(problem: HeaderProblem): string {
  const what =
    problem.reason === "name"
      ? "is not a valid header name"
      : "has a line break, a control character or a character outside Latin-1 (such as Chinese)";
  return `Request header ${JSON.stringify(problem.name)} set on this endpoint ${what}, so the request can't be sent`;
}

// 短于这么多的值（如 "2"）不打码：换掉会把报错里不相干的字也换掉。
const MIN_SECRET_LENGTH = 4;
// 「Bearer xxx」这类值：上游可能只回显后面的凭据。
const SCHEMED_CREDENTIAL = /^\S+\s+(\S+)$/;

/** 报错里要打码的：这家的 key 和用户的每个请求头值（带「Bearer 」这类前缀的，凭据本身也算）。 */
export function secretsOf(input: { apiKey: string | null; extras: RequestExtras }): string[] {
  const secrets: string[] = [];
  if (input.apiKey !== null) secrets.push(input.apiKey);
  for (const value of Object.values(input.extras.headers)) {
    secrets.push(value);
    const credential = SCHEMED_CREDENTIAL.exec(value)?.[1];
    if (credential !== undefined) secrets.push(credential);
  }
  return secrets.filter((secret) => secret.length >= MIN_SECRET_LENGTH);
}

/** 用户自己填了认证头（Authorization 或 x-api-key）：这家的 key 怎么带由用户说了算。 */
export function ownsKeyHeader(extras: RequestExtras): boolean {
  return Object.keys(extras.headers).some((name) => {
    const lower = name.toLowerCase();
    return lower === "authorization" || lower === "x-api-key";
  });
}

function isListHeader(name: string): boolean {
  return name.toLowerCase() === "anthropic-beta";
}

/** 写上用户的请求头：同名（不分大小写）的先去掉再按用户写的名字放；anthropic-beta 合并。 */
export function withUserHeaders<V extends string | string[]>(
  headers: Record<string, V>,
  extras: RequestExtras,
): Record<string, V | string> {
  const out: Record<string, V | string> = { ...headers };
  for (const [name, value] of Object.entries(extras.headers)) {
    const had: string[] = [];
    for (const key of Object.keys(out)) {
      if (key.toLowerCase() !== name.toLowerCase()) continue;
      const existing = out[key];
      if (existing !== undefined) had.push(...[existing].flat());
      delete out[key];
    }
    let written = value;
    if (isListHeader(name)) written = mergedList([...had, value]);
    out[name] = written;
  }
  return out;
}

/** 逗号分隔的各项，去掉空白与空的，每项只留第一次。 */
function mergedList(values: string[]): string {
  const items: string[] = [];
  for (const value of values) {
    for (const item of value.split(",")) {
      const trimmed = item.trim();
      if (trimmed !== "" && !items.includes(trimmed)) items.push(trimmed);
    }
  }
  return items.join(",");
}

/**
 * 补上附加请求体：按字段名排序逐个看，同名（去掉 `!`）只算第一个；没名字的、保留字段不动；请求体已有的字段除非 `!` 不动。
 * 没改动时原样返回同一个对象。
 */
export function withExtraBody(input: {
  body: Record<string, unknown>;
  extraBody: Record<string, unknown>;
  session: string;
}): Record<string, unknown> {
  const { body, extraBody } = input;
  let out: Record<string, unknown> | null = null;
  const seen = new Set<string>();
  for (const key of Object.keys(extraBody).sort()) {
    const { name, isForced } = extraBodyFieldName(key);
    const isSkipped = name === "" || isReservedExtraBodyField(name) || seen.has(name);
    if (isSkipped) continue;
    seen.add(name);
    const keepsOwn = Object.hasOwn(body, name) && !isForced;
    if (keepsOwn) continue;
    out ??= { ...body };
    // 拷一份再换：存的附加请求体不能被改。
    const copied = structuredClone(extraBody[key]);
    out[name] = withSession(copied, input.session);
  }
  return out ?? body;
}

function withSession(value: unknown, session: string): unknown {
  if (typeof value === "string") return value.replaceAll(EXTRA_BODY_SESSION_PLACEHOLDER, session);
  if (Array.isArray(value)) return value.map((item) => withSession(item, session));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = withSession(item, session);
  return out;
}

// 各家 Agent 说自己是哪段对话的请求头（magpie sessionHeaders）。
const SESSION_HEADERS = [
  "x-opencode-session",
  "x-session-affinity",
  "x-session-id",
  "session_id",
  "session-id",
  "x-claude-code-session-id",
  "x-conversation-id",
];
const MAX_SESSION_LENGTH = 128;

/**
 * ${sessionId} 换成的对话标识：Agent 发的会话头（最长 128 个字符）；没有就由对话第一条用户消息推导，
 * 同一段对话每轮相同（magpie sessionOf、conversationID）。
 */
export function extraBodySession(headers: IncomingHttpHeaders, body: unknown): string {
  for (const name of SESSION_HEADERS) {
    const raw = headers[name];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value) return value.slice(0, MAX_SESSION_LENGTH);
  }
  const request = isRecord(body) ? body : {};
  const items = conversationItems(request);
  const isGemini = !Array.isArray(request.messages) && Array.isArray(request.contents);
  const userItem = items.find((item) => {
    if (!isRecord(item)) return false;
    // Gemini 省略 role 时算用户说的；Chat 与 Responses 不算。
    const isUnnamedGeminiTurn = isGemini && item.role === undefined;
    return item.role === "user" || isUnnamedGeminiTurn;
  });
  const first = userItem ?? items[0] ?? request.input ?? body;
  const digest = createHash("sha256").update(JSON.stringify(first)).digest("hex");
  return `osuna-${digest.slice(0, 24)}`;
}

function conversationItems(request: Record<string, unknown>): unknown[] {
  if (Array.isArray(request.messages)) return request.messages;
  if (Array.isArray(request.contents)) return request.contents;
  return Array.isArray(request.input) ? request.input : [];
}

/** 测试与检测自己的一段对话（magpie tested 的 magpie-test-）。 */
export function testSession(): string {
  return `osuna-test-${randomBytes(6).toString("hex")}`;
}
