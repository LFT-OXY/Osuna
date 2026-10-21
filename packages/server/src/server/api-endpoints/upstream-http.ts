import type { IncomingHttpHeaders } from "node:http";

/*
 * 拉取模型与测试连接共用的上游 HTTP 小工具：解析错误体、描述网络错误。
 * 上游信息只截断到 MAX_DETAIL_LENGTH，回显的 key 要在截断前替换掉，否则跨截断点的半截 key 会漏出去。
 */

const MAX_DETAIL_LENGTH = 300;
export const ANTHROPIC_VERSION = "2023-06-01";

/** 报错里要换成 *** 的：一把 key（没有为 null），或 key 加上用户请求头的值（request-extras.ts 的 secretsOf）。 */
export type Secrets = string | null | readonly string[];

/**
 * 上游错误体常见的几种写法：{error:{message}}、{error:"..."}、{message}、{detail}；否则取原文。
 * 其中出现的 key 与请求头值换成 ***。
 */
export function extractErrorDetail(text: string, secrets: Secrets): string {
  const detail = redactKey(structuredErrorMessage(text) ?? text, secrets);
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

/** 文字里出现的 key（与请求头值）换成 ***，长的先换；空的跳过（空串会在每两个字之间插入 ***）。 */
export function redactKey(text: string, secrets: Secrets): string {
  const list = typeof secrets === "string" ? [secrets] : (secrets ?? []);
  const longestFirst = [...list].sort((a, b) => b.length - a.length);
  let out = text;
  for (const secret of longestFirst) {
    if (secret !== "") out = out.replaceAll(secret, "***");
  }
  return out;
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
