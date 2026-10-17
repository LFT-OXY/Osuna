import type { ApiEndpointModel } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { knownWindow, positiveInteger, type ModelFacts } from "./model-facts.js";
import type { ApiEndpointProvider } from "./store.js";
import {
  ANTHROPIC_VERSION,
  describeNetworkError,
  extractErrorDetail,
  isRecord,
  parseJson,
  redactKey,
} from "./upstream-http.js";

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
  // 上游回了非 404 / 405 的错误状态码时带上，自动检测据此认出 key 无效。
  status?: number;
}

/** 列表里给了上下文、回复上限或思考档位的模型带 facts；只存在 daemon 里，不发给客户端。 */
export interface ListedModel extends ApiEndpointModel {
  facts?: ModelFacts;
}

export type UpstreamModelsResult =
  | { ok: true; models: ListedModel[] }
  | { ok: false; error: UpstreamFailure };

type Attempt =
  | { kind: "ok"; models: ListedModel[] }
  | { kind: "http"; url: string; status: number; detail: string }
  | { kind: "format"; url: string; detail: string }
  | { kind: "network"; url: string; detail: string };
type FailedAttempt = Exclude<Attempt, { kind: "ok" }>;

const MAX_PAGES = 20;

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
  const redact = (text: string) => redactKey(text, input.apiKey);

  const attempts: FailedAttempt[] = [];
  for (const url of [`${base}/v1/models`, `${base}/models`]) {
    try {
      const attempt = await listModels({ url, headers, signal, apiKey: input.apiKey });
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

async function listModels(input: {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  apiKey: string;
}): Promise<Attempt> {
  const { url, headers, signal } = input;
  const models: ListedModel[] = [];
  let pageUrl = url;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await fetch(pageUrl, { headers, signal });
    const text = await response.text();
    if (!response.ok) {
      return {
        kind: "http",
        url,
        status: response.status,
        detail: extractErrorDetail(text, input.apiKey),
      };
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

function readModels(body: unknown): ListedModel[] | null {
  if (!isRecord(body)) return null;
  if (Array.isArray(body.data)) return collect(body.data, "id");
  if (Array.isArray(body.models)) return collect(body.models, "slug");
  return null;
}

function collect(entries: unknown[], idField: "id" | "slug"): ListedModel[] {
  const models: ListedModel[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const id = entry[idField];
    if (typeof id !== "string" || id.trim() === "") continue;
    const label = [entry.display_name, entry.name].find(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.trim() !== "" && candidate !== id,
    );
    const facts = readFacts(entry);
    models.push({
      id: id.trim(),
      ...(label ? { label: label.trim() } : {}),
      ...(Object.keys(facts).length > 0 ? { facts } : {}),
    });
  }
  return models;
}

/**
 * 各家列表给的上下文、回复上限与思考档位：Anthropic 的 max_input_tokens / max_tokens / capabilities.effort，
 * OpenRouter 的 context_length / top_provider.max_completion_tokens，Codex 的 context_window，
 * 网关类的 max_output_tokens / supported_reasoning_levels。max_tokens 只在 Anthropic 形状里才是回复上限。
 */
function readFacts(entry: Record<string, unknown>): ModelFacts {
  const facts: ModelFacts = {};
  const context =
    knownWindow(entry.max_input_tokens) ??
    knownWindow(entry.context_length) ??
    knownWindow(entry.context_window);
  if (context !== undefined) facts.context = context;
  const topProvider = isRecord(entry.top_provider) ? entry.top_provider : {};
  const output =
    positiveInteger(entry.max_output_tokens) ??
    (entry.max_input_tokens === undefined ? undefined : positiveInteger(entry.max_tokens)) ??
    positiveInteger(topProvider.max_completion_tokens);
  if (output !== undefined) facts.output = output;
  const efforts = listedEfforts(entry);
  if (efforts.length > 0) facts.efforts = efforts;
  return facts;
}

const ANTHROPIC_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

function listedEfforts(entry: Record<string, unknown>): string[] {
  if (Array.isArray(entry.supported_reasoning_levels)) {
    const efforts: string[] = [];
    for (const level of entry.supported_reasoning_levels) {
      const effort = isRecord(level) ? level.effort : level;
      if (typeof effort === "string" && effort !== "" && !efforts.includes(effort)) {
        efforts.push(effort);
      }
    }
    return efforts;
  }
  const capabilities = isRecord(entry.capabilities) ? entry.capabilities : {};
  const effort = isRecord(capabilities.effort) ? capabilities.effort : {};
  return ANTHROPIC_EFFORTS.filter((level) => {
    const support = effort[level];
    return isRecord(support) && support.supported === true;
  });
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
    return {
      code: "upstream_error",
      message: redact(describeAttempt(httpError)),
      status: httpError.status,
    };
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
