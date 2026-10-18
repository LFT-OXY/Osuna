// 移植自 magpie（https://github.com/yetone/magpie，internal/gateway/gateway.go 的 askedAt、internal/provider/groupeffort.go 的
// MemberEffort 与 MemberEfforts、internal/gateway/decide.go 的 withFixedEffort 与 withEffort）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { applyEdits, modify, type JSONPath } from "jsonc-parser";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { ONE_MILLION_MARK } from "../claude-model-hints.js";
import { isRecord, parseJson } from "../upstream-http.js";
import { budgetOf, effortOf } from "./translation/ir.js";

/*
 * 「模型名:档位」（Claude Code 的 Subagent 模型带了思考档位，[1m] 在档位后面）：中转站按模型名选接口，
 * 不论 Agent 问的是哪一档，都按这一档问（照 magpie #536）。模型自己的 id 也可能带冒号（deepseek-r1:free、qwen:7b），
 * 所以只有最后一段是档位名、且整个名字不是哪家选了的模型时才拆。
 */

// 能固定的档位，由弱到强（magpie MemberEfforts）。
export const FIXED_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type FixedEffort = (typeof FIXED_EFFORTS)[number];

/** 拆出来的模型名（带 [1m] 的照带）与固定的档位；没有档位为 null。 */
export interface AskedAt {
  model: string;
  effort: FixedEffort | null;
}

/** magpie askedAt：拆「模型名:档位」；`isListed` 说整个名字是不是哪家选了的模型，是的话不拆。 */
export function askedAt(input: { id: string; isListed: (id: string) => boolean }): AskedAt {
  const { id } = input;
  const isMarked = id.endsWith(ONE_MILLION_MARK);
  const bare = isMarked ? id.slice(0, -ONE_MILLION_MARK.length) : id;
  const colon = bare.lastIndexOf(":");
  const effort = colon > 0 ? fixedEffortOf(bare.slice(colon + 1)) : null;
  const isWhole = effort === null || input.isListed(bare) || input.isListed(id);
  if (isWhole) return { model: id, effort: null };
  const mark = isMarked ? ONE_MILLION_MARK : "";
  return { model: `${bare.slice(0, colon)}${mark}`, effort };
}

function fixedEffortOf(value: string): FixedEffort | null {
  const lower = value.toLowerCase();
  return FIXED_EFFORTS.find((level) => level === lower) ?? null;
}

/**
 * magpie withFixedEffort：按 Agent 自己的格式把请求改成这一档，不论它问的是什么；没要思考的请求也要上，none 关掉思考。
 * 翻译时再按目标格式和模型自己的档位落定（requestForModel）。
 */
export function withFixedEffort(input: {
  format: ApiEndpointRequestFormat;
  text: string;
  effort: FixedEffort;
}): string {
  const { text, effort } = input;
  const body = parseJson(text);
  if (!isRecord(body)) return text;
  switch (input.format) {
    case "openai_chat":
      return edited(text, ["reasoning_effort"], effort);
    case "openai_responses": {
      const reasoning = isRecord(body.reasoning) ? body.reasoning : {};
      return edited(text, ["reasoning"], { ...reasoning, effort });
    }
    case "anthropic_messages":
      return anthropicAt({ text, body, effort });
  }
}

interface AnthropicAtInput {
  text: string;
  body: Record<string, unknown>;
  effort: FixedEffort;
}

/** Anthropic：none 关思考；要了思考的改力度（自适应改 output_config.effort，预算改预算）；没要的按预算要上。 */
function anthropicAt(input: AnthropicAtInput): string {
  const { text, body } = input;
  if (input.effort === "none") return edited(text, ["thinking"], { type: "disabled" });
  // Anthropic 的说法里 minimal 是 low。
  const level = effortOf(input.effort);
  const thinking = isRecord(body.thinking) ? body.thinking : null;
  const config = isRecord(body.output_config) ? body.output_config : null;
  if (thinking?.type === "adaptive") {
    return edited(text, ["output_config"], { ...config, effort: level });
  }
  const budget = budgetWithin({ body, budget: budgetOf(level) });
  // 预算要给回答留出余地，太小就不要思考。
  if (budget < 1024) return text;
  let out = edited(text, ["thinking"], { type: "enabled", budget_tokens: budget });
  const isEffortSaid = thinking?.type === "enabled" && config?.effort !== undefined;
  if (isEffortSaid) out = edited(out, ["output_config"], { ...config, effort: level });
  return out;
}

/** 预算不超过回答上限减一。 */
function budgetWithin(input: { body: Record<string, unknown>; budget: number }): number {
  const maxTokens = input.body.max_tokens;
  const hasMaxTokens = typeof maxTokens === "number" && maxTokens > 0;
  return hasMaxTokens ? Math.min(input.budget, maxTokens - 1) : input.budget;
}

function edited(text: string, path: JSONPath, value: unknown): string {
  return applyEdits(text, modify(text, path, value, {}));
}
