// 按模板的改写移植自 magpie（https://github.com/yetone/magpie，internal/gateway/gateway.go 的 passthrough 与翻译后 build 里
// Bedrock、Azure 的几处、asCompletionTokens、withoutFields，betas.go 的 bedrockBetas、bedrockRefuses，codex_backend.go 的
// withoutReasoningText、validatesItemIDs、plainItemIDs）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { isRecord } from "../upstream-http.js";
import { AZURE_TEMPLATE_ID, BEDROCK_TEMPLATE_ID } from "../templates.js";

/*
 * 从 Amazon Bedrock、Azure OpenAI 模板加的接口，请求体按模板改（ADR 0008，2026-10-19 用户定）：
 * - Bedrock 的 Anthropic 格式去掉 metadata：Claude Code 的 metadata.user_id 如今是一段 JSON，不是 Bedrock 要的纯 id（magpie #176）。
 * - Bedrock、Azure 的 Chat 把 max_tokens 换成 max_completion_tokens：Bedrock 的 GPT、Azure 的推理部署都不收 max_tokens。
 * - 直连 Azure 的 Chat 去掉 enable_thinking、thinking（Qwen、Kimi Code 的开关，Azure 当成不认识的参数拒掉）；
 *   直连 Azure 的 Responses 去掉带文字的推理项（只收空的），输入项的 id 只留 [A-Za-z0-9_-]（Azure 像 OpenAI 一样校验）。
 * 没有封存内容的推理项由 passthrough.ts 对每家都去掉，这里不重复。翻译后的请求只做前两条（照 magpie 的翻译路径）。
 */

type Body = Record<string, unknown>;

/** 改写对象：这家从哪个模板加的、发给上游的格式与请求体。 */
export interface TemplateRewriteInput {
  templateId: string | undefined;
  format: ApiEndpointRequestFormat;
  body: Body;
}

/** 翻译后发给上游的请求体按模板改；没有要改的原样交回同一个对象。 */
export function withTemplateTranslatedRewrites(input: TemplateRewriteInput): Body {
  const { templateId, format } = input;
  let body = input.body;
  if (templateId === BEDROCK_TEMPLATE_ID && format === "anthropic_messages") {
    body = withoutKeys(body, ["metadata"]);
  }
  if (takesCompletionTokens(templateId) && format === "openai_chat") {
    body = asCompletionTokens(body);
  }
  return body;
}

/**
 * 直连的请求体按模板改；replaysReasoning 是这次的模型要回放推理（DeepSeek），Azure 不去掉它带文字的推理项。
 * 没有要改的原样交回同一个对象。
 */
export function withTemplatePassthroughRewrites(
  input: TemplateRewriteInput & { replaysReasoning: boolean },
): Body {
  const { templateId, format } = input;
  let body = withTemplateTranslatedRewrites(input);
  if (templateId !== AZURE_TEMPLATE_ID) return body;
  if (format === "openai_chat") body = withoutKeys(body, ["enable_thinking", "thinking"]);
  if (format === "openai_responses") {
    if (!input.replaysReasoning) body = withoutReasoningText(body);
    body = withPlainItemIds(body);
  }
  return body;
}

/** Bedrock、Azure 的 Chat 收 max_completion_tokens、不收 max_tokens（照 magpie tinyBody 与 asCompletionTokens）。 */
export function takesCompletionTokens(templateId: string | undefined): boolean {
  return templateId === BEDROCK_TEMPLATE_ID || templateId === AZURE_TEMPLATE_ID;
}

/** max_tokens 换成 max_completion_tokens；已经有 max_completion_tokens 的只去掉 max_tokens。 */
export function asCompletionTokens(body: Body): Body {
  if (!("max_tokens" in body)) return body;
  const { max_tokens: maxTokens, ...rest } = body;
  return "max_completion_tokens" in rest ? rest : { ...rest, max_completion_tokens: maxTokens };
}

function withoutKeys(body: Body, keys: readonly string[]): Body {
  if (!keys.some((key) => key in body)) return body;
  return Object.fromEntries(Object.entries(body).filter(([key]) => !keys.includes(key)));
}

/** 去掉带文字（content 非空）的推理项：别家模型写的推理，Azure 只收 content 为空的，整个请求会被拒（magpie #1411）。 */
function withoutReasoningText(body: Body): Body {
  const input = body.input;
  if (!Array.isArray(input)) return body;
  const kept = input.filter((item) => !hasReasoningText(item));
  return kept.length === input.length ? body : { ...body, input: kept };
}

function hasReasoningText(item: unknown): boolean {
  if (!isRecord(item) || item.type !== "reasoning") return false;
  return Array.isArray(item.content) && item.content.length > 0;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const UNSAFE_ID_CHAR = /[^A-Za-z0-9_-]/g;

/**
 * 输入项的 id 只留 [A-Za-z0-9_-]：别家回复给 Agent 的项（Muse Spark 的推理 id 是两个用冒号连起来的）会在以后每一轮带回来。
 * 这样的推理项整个去掉（它的封存内容也是别家的）；别的项保留内容，id 里其余字符换成 `_`，call_id 不动。
 */
function withPlainItemIds(body: Body): Body {
  const input = body.input;
  if (!Array.isArray(input)) return body;
  let changed = false;
  const kept = input.flatMap((item): unknown[] => {
    const id = isRecord(item) ? item.id : undefined;
    if (!isRecord(item) || typeof id !== "string" || id === "" || SAFE_ID.test(id)) return [item];
    changed = true;
    if (item.type === "reasoning") return [];
    return [{ ...item, id: id.replace(UNSAFE_ID_CHAR, "_") }];
  });
  return changed ? { ...body, input: kept } : body;
}
