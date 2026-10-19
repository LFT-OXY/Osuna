import type { IncomingHttpHeaders } from "node:http";

/*
 * 拉取模型与测试连接共用的上游 HTTP 小工具：解析错误体、描述网络错误。
 * 上游信息只截断到 MAX_DETAIL_LENGTH，回显的 key 要在截断前替换掉，否则跨截断点的半截 key 会漏出去。
 */

const MAX_DETAIL_LENGTH = 300;
export const ANTHROPIC_VERSION = "2023-06-01";

/**
 * 上游错误体常见的几种写法：{error:{message}}、{error:"..."}、{message}、{detail}；否则取原文。
 * 其中出现的 apiKey 换成 ***。
 */
export function extractErrorDetail(text: string, apiKey: string | null): string {
  const detail = redactKey(structuredErrorMessage(text) ?? text, apiKey);
  return truncate(detail.replace(/\s+/g, " ").trim());
}

/** 错误体里上游自己写的错误信息；不是这几种 JSON 写法时为 null。 */
export function structuredErrorMessage(text: string): string | null {
  const body = parseJson(text);
  const candidates = isRecord(body)
    ? [isRecord(body.error) ? body.error.message : undefined, body.error, body.message, body.detail]
    : [];
  return candidates.find((candidate): candidate is string => typeof candidate === "string") ?? null;
}

export function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    // undici 把真正的原因（ECONNREFUSED、ENOTFOUND……）放在 cause 里。
    const cause = error.cause instanceof Error ? error.cause.message : null;
    return truncate(cause ? `${error.message}: ${cause}` : error.message);
  }
  return truncate(String(error));
}

function truncate(text: string): string {
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}

/** 文字里出现的 key 换成 ***；没 key 或 key 为空时原样（空串会在每两个字之间插入 ***）。 */
export function redactKey(text: string, apiKey: string | null): string {
  if (apiKey === null || apiKey === "") return text;
  return text.replaceAll(apiKey, "***");
}

/** 把 key 放进 Authorization: Bearer；没 key 的接口不带认证头。 */
export function bearerAuth(apiKey: string | null): Record<string, string> {
  return apiKey === null ? {} : { authorization: `Bearer ${apiKey}` };
}

/** 把 key 同时放进 Authorization: Bearer 与 x-api-key（Anthropic 地址）；没 key 的接口不带认证头。 */
export function bothKeyAuth(apiKey: string | null): Record<string, string> {
  return apiKey === null ? {} : { ...bearerAuth(apiKey), "x-api-key": apiKey };
}

/** 响应头里的 Content-Type，小写；没有为空。 */
export function contentTypeOf(headers: IncomingHttpHeaders): string {
  return String(headers["content-type"] ?? "").toLowerCase();
}

/** 回复压缩过（Content-Encoding 不是空的也不是 identity）：开头的字节看不出它是什么。 */
export function isCompressed(headers: IncomingHttpHeaders): boolean {
  const encoding = headers["content-encoding"] ?? "";
  return encoding !== "" && encoding !== "identity";
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
