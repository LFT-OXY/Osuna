// Gemini 地址的模型清单移植自 magpie（https://github.com/yetone/magpie，internal/catalog/gemini_list.go 的 FetchGemini）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { signedHeaders } from "./gateway/refusals.js";
import { upstreamFetch } from "./insecure-tls.js";
import { knownWindow, positiveInteger, type ModelFacts } from "./model-facts.js";
import {
  secretsOf,
  unsendableHeader,
  unsendableHeaderMessage,
  type RequestExtras,
} from "./request-extras.js";
import {
  describeNetworkError,
  extractErrorDetail,
  isRecord,
  parseJson,
  redactKey,
} from "./upstream-http.js";
import type { ListedModel, UpstreamFailure, UpstreamModelsResult } from "./upstream-models.js";

/*
 * 照 Google 的 Gemini API 列模型：GET {base}/models，key 只放 x-goog-api-key，按 nextPageToken 一页页拉（最多 20 页、每页 8 秒，整次不另设上限）。
 * 名字去掉 models/ 前缀；清单里还有向量（embedContent）、Imagen（predict）、Veo（predictLongRunning）这类 Agent 用不了的，
 * 给了 supportedGenerationMethods 又不含 generateContent 的丢掉。一个都没列出算失败（magpie 同样）。
 */

const MAX_PAGES = 20;
const PAGE_TIMEOUT_MS = 8_000;
const LIST_PATH = "/models";

export async function fetchGeminiModels(input: {
  baseUrl: string;
  // 没 key 的接口为 null，不带认证头。
  apiKey: string | null;
  // 这家的请求头（request-extras.ts）；Gemini 地址不看 key 放哪个头的选项。
  extras: RequestExtras;
  signal: AbortSignal;
}): Promise<UpstreamModelsResult> {
  const unsendable = unsendableHeader(input.extras);
  if (unsendable !== null) {
    const message = unsendableHeaderMessage(unsendable);
    return { ok: false, error: { code: "invalid_header", message, params: { ...unsendable } } };
  }
  const secrets = secretsOf(input);
  const redact = (text: string) => redactKey(text, secrets);
  const at = `${input.baseUrl.trim().replace(/\/+$/, "")}${LIST_PATH}`;
  const headers = signedHeaders({
    headers: { accept: "application/json" },
    apiKey: input.apiKey,
    keys: "googApiKey",
    extras: input.extras,
  });
  const models: ListedModel[] = [];
  let token = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = `${at}?pageSize=1000${token === "" ? "" : `&pageToken=${encodeURIComponent(token)}`}`;
    const pageTimeout = AbortSignal.timeout(PAGE_TIMEOUT_MS);
    let status: number;
    let text: string;
    try {
      const response = await upstreamFetch({
        url,
        init: { headers, signal: AbortSignal.any([input.signal, pageTimeout]) },
        uncheckedHosts: input.extras.uncheckedHosts,
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      if (input.signal.aborted) {
        return { ok: false, error: { code: "cancelled", message: "Request cancelled" } };
      }
      if (pageTimeout.aborted) {
        const seconds = Math.round(PAGE_TIMEOUT_MS / 1000);
        return {
          ok: false,
          error: { code: "upstream_timeout", message: `No response within ${seconds}s` },
        };
      }
      const detail = describeNetworkError(error);
      return { ok: false, error: { code: "upstream_unreachable", message: redact(detail) } };
    }
    if (status < 200 || status >= 300)
      return { ok: false, error: httpFailure({ status, text, secrets }) };
    const body = parseJson(text);
    if (!isRecord(body) || (body.models !== undefined && !Array.isArray(body.models))) {
      return { ok: false, error: listFailure("the response is not a model list") };
    }
    const entries = Array.isArray(body.models) ? body.models : [];
    for (const model of entries.flatMap(chatModelOf)) {
      if (!models.some((existing) => existing.id === model.id)) models.push(model);
    }
    token = typeof body.nextPageToken === "string" ? body.nextPageToken : "";
    if (token === "") break;
  }
  if (models.length === 0) {
    return {
      ok: false,
      error: { code: "models_empty", message: `no models listed · ${LIST_PATH}` },
    };
  }
  return { ok: true, models };
}

/** 清单里的一个模型：能对话的才留，带显示名、上下文与回复上限。 */
function chatModelOf(entry: unknown): ListedModel[] {
  if (!isRecord(entry) || typeof entry.name !== "string") return [];
  const id = entry.name.trim().replace(/^models\//, "");
  const methods = Array.isArray(entry.supportedGenerationMethods)
    ? entry.supportedGenerationMethods
    : [];
  if (id === "" || (methods.length > 0 && !methods.includes("generateContent"))) return [];
  const facts: ModelFacts = {};
  const context = knownWindow(entry.inputTokenLimit);
  if (context !== undefined) facts.context = context;
  const output = positiveInteger(entry.outputTokenLimit);
  if (output !== undefined) facts.output = output;
  const label =
    typeof entry.displayName === "string" && entry.displayName.trim() !== ""
      ? entry.displayName.trim()
      : null;
  return [
    {
      id,
      ...(label !== null && label !== id ? { label } : {}),
      ...(Object.keys(facts).length > 0 ? { facts } : {}),
    },
  ];
}

/** 写法与别的格式的清单报错一样：原因后接问的路径（upstream-models.ts describeAttempt）。 */
function listFailure(reason: string): UpstreamFailure {
  return { code: "models_unsupported", message: `${reason} · ${LIST_PATH}` };
}

function httpFailure(input: { status: number; text: string; secrets: string[] }): UpstreamFailure {
  const { status } = input;
  const detail = extractErrorDetail(input.text, input.secrets);
  const reason = detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
  if (status === 404 || status === 405) return listFailure(reason);
  return { code: "upstream_error", message: `${reason} · ${LIST_PATH}`, status };
}
