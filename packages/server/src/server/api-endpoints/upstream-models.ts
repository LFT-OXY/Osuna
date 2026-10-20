// 从清单的 modalities.input 读能否看图移植自 magpie（https://github.com/yetone/magpie，internal/catalog/live.go 的 liveModel）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointModel } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { knownWindow, positiveInteger, takesImages, type ModelFacts } from "./model-facts.js";
import type { ApiEndpointProvider } from "./store.js";
import {
  ANTHROPIC_VERSION,
  describeNetworkError,
  extractErrorDetail,
  isRecord,
  parseJson,
  redactKey,
  type Secrets,
} from "./upstream-http.js";
import { signedHeaders } from "./gateway/refusals.js";
import {
  keyHeadersAt,
  secretsOf,
  unsendableHeader,
  unsendableHeaderMessage,
  type RequestExtras,
} from "./request-extras.js";
import { templateModelListUrls } from "./templates.js";

/*
 * 从第三方接口列出模型。daemon 在主机上发请求，key 不经过客户端。
 * 先试 <base>/v1/models，失败再试 <base>/models；兼容 OpenAI/Anthropic 的 data[] 和 Codex 的 models[].slug。
 * Codex 的 base 通常已经以 /v1 结尾，第一次会落空，第二次命中。Azure 模板先问部署名、再问 /models（templateModelListUrls）。
 */

export type UpstreamFailureCode =
  | "upstream_error"
  | "upstream_unreachable"
  | "upstream_timeout"
  | "models_unsupported"
  | "cancelled"
  // 这家的请求头发不出去（params.name）。
  | "invalid_header";

export interface UpstreamFailure {
  code: UpstreamFailureCode;
  message: string;
  params?: Record<string, string>;
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
  // 没 key 的接口为 null，不带认证头。
  apiKey: string | null;
  // 这家从哪个模板加的：Bedrock、Azure 的认证头与 Azure 列模型的地址由它定；「自定义」的没有。
  templateId: string | undefined;
  // 这家的请求头与 key 放哪个头（request-extras.ts）。
  extras: RequestExtras;
  // 调用方取消（客户端取消或断开）。
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<UpstreamModelsResult> {
  const unsendable = unsendableHeader(input.extras);
  if (unsendable !== null) {
    const message = unsendableHeaderMessage(unsendable);
    return { ok: false, error: { code: "invalid_header", message, params: { ...unsendable } } };
  }
  const timeout = AbortSignal.timeout(input.timeoutMs);
  const signal = AbortSignal.any([input.signal, timeout]);
  const base = input.baseUrl.trim().replace(/\/+$/, "");
  const headers = buildHeaders(input);
  const secrets = secretsOf(input);
  const redact = (text: string) => redactKey(text, secrets);
  const urls = templateModelListUrls({ templateId: input.templateId, baseUrl: base }) ?? [
    `${base}/v1/models`,
    `${base}/models`,
  ];

  const attempts: FailedAttempt[] = [];
  for (const url of urls) {
    try {
      const attempt = await listModels({ url, headers, signal, secrets });
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

function buildHeaders(input: {
  provider: ApiEndpointProvider;
  baseUrl: string;
  apiKey: string | null;
  templateId: string | undefined;
  extras: RequestExtras;
}): Record<string, string> {
  const anthropic = input.provider === "claude";
  const format = anthropic ? "anthropic_messages" : "openai_chat";
  // Claude 接口可能是 Anthropic 兼容网关，只认 x-api-key；两种都带上，用户选了只放一个的照用户的。
  const keyHeader = input.extras.keyHeader;
  const keys = keyHeadersAt({ ...input, format, keyHeader, anthropicDefault: "both" });
  const headers: Record<string, string> = { accept: "application/json" };
  if (anthropic) headers["anthropic-version"] = ANTHROPIC_VERSION;
  return signedHeaders({ headers, apiKey: input.apiKey, keys, extras: input.extras });
}

async function listModels(input: {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  secrets: Secrets;
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
        detail: extractErrorDetail(text, input.secrets),
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
 * 能不能看图：modalities.input（magpie 读的形状）、OpenRouter 的 architecture.input_modalities、Codex 的 input_modalities；
 * 都没给的不算知道。
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
  const images = listedImages(entry);
  if (images !== undefined) facts.images = images;
  return facts;
}

function listedImages(entry: Record<string, unknown>): boolean | undefined {
  if (isRecord(entry.modalities) && Array.isArray(entry.modalities.input)) {
    return takesImages(entry.modalities);
  }
  const architecture = isRecord(entry.architecture) ? entry.architecture : {};
  const input = [architecture.input_modalities, entry.input_modalities].find(Array.isArray);
  return input === undefined ? undefined : takesImages({ input });
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
