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
  isReservedExtraBodyField,
  isThirdPartyAnthropicUrl,
  keyHeaderOf,
  type ApiEndpointKeyHeader,
} from "@getpaseo/protocol/api-endpoint/request-extras";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { StoredApiEndpoint } from "./store.js";
import { isRecord } from "./upstream-http.js";

/*
 * 这家每个上游请求都带的、用户自己设的东西（ADR 0008）：中转站转发（直通与翻译后）、测试连接、自动检测（单次与逐个模型）、
 * 拉模型、测试模型（含按 CLI 的样子测）都经这里，一个都不漏。
 * - 请求头写在 Osuna 填的所有头（认证头也算）之后，大小写不同也算同名、换成用户的；anthropic-beta 不换，按逗号合并去重，
 *   原有的在前（照 magpie Sign）。用户自己填了认证头时，「两个认证头被拒就改用一个」不再触发。
 * - 附加请求体只给对话请求（Messages、Chat、Responses），只数 token 的不带；没有的字段补上，`!` 开头的强制覆盖，
 *   保留字段不动；字符串里的 ${sessionId} 换成这段对话的标识（测试与检测用一个 osuna-test- 开头的）。
 * - key 放哪个头只对第三方 Anthropic 地址起作用（chosenKeyHeaders）。
 * 头的值可能是密钥：不写日志、不进报错。
 */

export interface RequestExtras {
  // 已收拢（名字照用户写的）；没有为空对象。
  headers: Record<string, string>;
  extraBody: Record<string, unknown>;
  keyHeader: ApiEndpointKeyHeader;
}

export const NO_REQUEST_EXTRAS: RequestExtras = { headers: {}, extraBody: {}, keyHeader: "both" };

/** 这家存的请求头、附加请求体、key 放哪个头；没有这家时什么都不加。 */
export function storedRequestExtras(
  endpoint: Pick<StoredApiEndpoint, "headers" | "extraBody" | "keyHeader"> | null | undefined,
): RequestExtras {
  if (!endpoint) return NO_REQUEST_EXTRAS;
  return {
    headers: cleanRequestHeaders(endpoint.headers) ?? {},
    extraBody: endpoint.extraBody ?? {},
    keyHeader: keyHeaderOf(endpoint.keyHeader),
  };
}

/** 用户选的 key 头（只放 x-api-key、只放 Bearer）；两个都放、不是第三方 Anthropic 地址的为 null，按通常的规则。 */
export function chosenKeyHeaders(input: {
  format: ApiEndpointRequestFormat;
  baseUrl: string;
  keyHeader: ApiEndpointKeyHeader;
}): "xApiKey" | "bearer" | null {
  if (input.format !== "anthropic_messages" || !isThirdPartyAnthropicUrl(input.baseUrl)) {
    return null;
  }
  if (input.keyHeader === "x-api-key") return "xApiKey";
  if (input.keyHeader === "bearer") return "bearer";
  return null;
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
    out[name] = isListHeader(name) ? mergedList([...had, value]) : value;
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
    if (name === "" || isReservedExtraBodyField(name) || seen.has(name)) continue;
    seen.add(name);
    const isPresent = Object.hasOwn(body, name);
    if (isPresent && !isForced) continue;
    out ??= { ...body };
    out[name] = withSession(structuredClone(extraBody[key]), input.session);
  }
  return out ?? body;
}

function withSession(value: unknown, session: string): unknown {
  if (typeof value === "string") return value.replaceAll(EXTRA_BODY_SESSION_PLACEHOLDER, session);
  if (Array.isArray(value)) return value.map((item) => withSession(item, session));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, withSession(item, session)]),
  );
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
  const userItem = items.find(
    (item) => isRecord(item) && (item.role === "user" || (isGemini && item.role === undefined)),
  );
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
