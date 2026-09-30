import type { ApiEndpointModel } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { ApiEndpointProvider } from "./store.js";

/*
 * 从第三方接口列出模型。daemon 在主机上发请求，key 不经过客户端。
 * 先试 <base>/v1/models，失败再试 <base>/models；兼容 OpenAI/Anthropic 的 data[] 和 Codex 的 models[].slug。
 * Codex 的 base 通常已经以 /v1 结尾，第一次会落空，第二次命中。
 */

export type UpstreamFailureCode =
  | "upstream_error"
  | "upstream_unreachable"
  | "upstream_timeout"
  | "models_unsupported"
  | "cancelled";

export interface UpstreamFailure {
  code: UpstreamFailureCode;
  message: string;
}

export type UpstreamModelsResult =
  | { ok: true; models: ApiEndpointModel[] }
  | { ok: false; error: UpstreamFailure };

type Attempt =
  | { kind: "ok"; models: ApiEndpointModel[] }
  | { kind: "http"; url: string; status: number; detail: string }
  | { kind: "format"; url: string; detail: string }
  | { kind: "network"; url: string; detail: string };
type FailedAttempt = Exclude<Attempt, { kind: "ok" }>;

const MAX_PAGES = 20;
const MAX_DETAIL_LENGTH = 300;
const ANTHROPIC_VERSION = "2023-06-01";

export async function fetchUpstreamModels(input: {
  provider: ApiEndpointProvider;
  baseUrl: string;
  apiKey: string;
  // 调用方取消（客户端取消或断开）。
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<UpstreamModelsResult> {
  const timeout = AbortSignal.timeout(input.timeoutMs);
  const signal = AbortSignal.any([input.signal, timeout]);
  const base = input.baseUrl.trim().replace(/\/+$/, "");
  const headers = buildHeaders(input.provider, input.apiKey);
  const redact = (text: string) => text.replaceAll(input.apiKey, "***");

  const attempts: FailedAttempt[] = [];
  for (const url of [`${base}/v1/models`, `${base}/models`]) {
    try {
      const attempt = await listModels(url, headers, signal);
      if (attempt.kind === "ok") return { ok: true, models: attempt.models };
      attempts.push(attempt);
    } catch (error) {
      if (input.signal.aborted) {
        return { ok: false, error: { code: "cancelled", message: "Request cancelled" } };
      }
      if (timeout.aborted) {
        return {
          ok: false,
          error: {
            code: "upstream_timeout",
            message: `No response from ${url} within ${Math.round(input.timeoutMs / 1000)}s`,
          },
        };
      }
      attempts.push({ kind: "network", url, detail: describeNetworkError(error) });
    }
  }
  return { ok: false, error: summarize(attempts, redact) };
}

function buildHeaders(provider: ApiEndpointProvider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  // Claude 接口可能是 Anthropic 兼容网关，只认 x-api-key；两种都带上。
  if (provider === "claude") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = ANTHROPIC_VERSION;
  }
  return headers;
}

async function listModels(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Attempt> {
  const models: ApiEndpointModel[] = [];
  let pageUrl = url;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await fetch(pageUrl, { headers, signal });
    const text = await response.text();
    if (!response.ok) {
      return { kind: "http", url, status: response.status, detail: extractErrorDetail(text) };
    }
    const body = parseJson(text);
    const pageModels = body === undefined ? null : readModels(body);
    if (pageModels === null) {
      return { kind: "format", url, detail: "the response is not a model list" };
    }
    for (const model of pageModels) {
      if (!models.some((existing) => existing.id === model.id)) models.push(model);
    }
    // Anthropic 的 /v1/models 分页：has_more + last_id。
    const nextAfter = isRecord(body) && body.has_more === true ? body.last_id : undefined;
    if (typeof nextAfter !== "string" || nextAfter === "") break;
    pageUrl = `${url}?after_id=${encodeURIComponent(nextAfter)}`;
  }
  return { kind: "ok", models };
}

function readModels(body: unknown): ApiEndpointModel[] | null {
  if (!isRecord(body)) return null;
  if (Array.isArray(body.data)) return collect(body.data, "id");
  if (Array.isArray(body.models)) return collect(body.models, "slug");
  return null;
}

function collect(entries: unknown[], idField: "id" | "slug"): ApiEndpointModel[] {
  const models: ApiEndpointModel[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const id = entry[idField];
    if (typeof id !== "string" || id.trim() === "") continue;
    const label = [entry.display_name, entry.name].find(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.trim() !== "" && candidate !== id,
    );
    models.push(label ? { id: id.trim(), label: label.trim() } : { id: id.trim() });
  }
  return models;
}

/**
 * 两个地址都失败时挑最有用的原因：鉴权、服务端错误这类非 404/405 的状态码优先；
 * 都连不上是 unreachable；其余（404、不是模型列表）视为不支持列出模型。
 */
function summarize(attempts: FailedAttempt[], redact: (text: string) => string): UpstreamFailure {
  const httpError = attempts.find(
    (attempt): attempt is Extract<FailedAttempt, { kind: "http" }> =>
      attempt.kind === "http" && attempt.status !== 404 && attempt.status !== 405,
  );
  if (httpError) {
    return { code: "upstream_error", message: redact(describeAttempt(httpError)) };
  }
  if (attempts.every((attempt) => attempt.kind === "network")) {
    return {
      code: "upstream_unreachable",
      message: redact(attempts.map(describeAttempt).join("\n")),
    };
  }
  return { code: "models_unsupported", message: redact(attempts.map(describeAttempt).join("\n")) };
}

function describeAttempt(attempt: FailedAttempt): string {
  const prefix = `GET ${attempt.url}:`;
  if (attempt.kind === "http") {
    return attempt.detail
      ? `${prefix} HTTP ${attempt.status}: ${attempt.detail}`
      : `${prefix} HTTP ${attempt.status}`;
  }
  return `${prefix} ${attempt.detail}`;
}

/** 上游错误体常见的几种写法：{error:{message}}、{error:"..."}、{message}、{detail}；否则取原文。 */
function extractErrorDetail(text: string): string {
  const body = parseJson(text);
  const candidates = isRecord(body)
    ? [isRecord(body.error) ? body.error.message : undefined, body.error, body.message, body.detail]
    : [];
  const message = candidates.find(
    (candidate): candidate is string => typeof candidate === "string",
  );
  return truncate((message ?? text).replace(/\s+/g, " ").trim());
}

function describeNetworkError(error: unknown): string {
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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
