// models.json 每个模型的写法移植自 magpie（https://github.com/yetone/magpie，internal/agent/agents.go 的 piModelJSON、
// piThinkingLevels、piPromptCache，internal/agent/route.go 的 magpieModels 与 allResponses、maxTokens）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { ModelPricePerMillion } from "../usage/pricing/service.js";
import { isClaudeModel } from "./gateway/routing.js";
import { thinksAdaptivelyOnly } from "./gateway/translation/anthropic.js";
import { publishedOutput, type EndpointModelFacts } from "./model-facts.js";
import { isOpenAIModel } from "./templates.js";

/*
 * Osuna 写进 Pi models.json 的 providers.osuna.models（任务 10-16-pi-omp-endpoints，prd「写进 Pi 配置的内容」）：
 * 只写已知的资料，不知道的项不出现，Pi 用它自己的缺省。
 * 每个模型问中转站用哪种格式（prd「每个模型的格式」，照 magpie route.go）：默认 Chat，沿用服务商级的 openai-completions；
 * GPT 一类在 Responses 上、Claude 在 Anthropic 上能原样转发时写各自的 api，少翻译一层。
 */

// Pi 的 7 档思考（pi-ai 的 EXTENDED_THINKING_LEVELS，magpie piLevels）。
export const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** 写进 Pi 的 cost：每百万 token 的美元价（价格表的列，不带是不是用户自设）。 */
export type PiModelCost = Omit<ModelPricePerMillion, "isOverride">;

export interface PiModelEntry {
  id: string;
  name: string;
  reasoning: boolean;
  api?: "openai-responses" | "anthropic-messages";
  baseUrl?: string;
  compat?: { forceAdaptiveThinking: true };
  input?: string[];
  thinkingLevelMap?: Record<string, string | null>;
  contextWindow?: number;
  maxTokens?: number;
  cost?: PiModelCost;
  promptCache?: { short: number; long?: number };
}

export interface PiModelSource {
  // 写给 Pi 的模型 id：光秃秃的模型名或「接口标识/模型名」。
  id: string;
  name: string;
  facts: EndpointModelFacts;
  format: ApiEndpointRequestFormat;
  // 每百万 token 的美元价；不知道为 null。
  cost: PiModelCost | null;
}

/**
 * 某一家的一个模型问中转站用的格式：「只用这种格式」钉了就按它；GPT 一类、这家有 Responses 地址走 Responses；
 * Claude、这家有 Anthropic 地址走 Anthropic；其余 Chat。`served` 是这家给这个模型的格式。
 */
export function piEndpointFormat(input: {
  modelId: string;
  served: readonly ApiEndpointRequestFormat[];
  pinned: ApiEndpointRequestFormat | null;
}): ApiEndpointRequestFormat {
  const { modelId, served } = input;
  if (input.pinned !== null) return input.pinned;
  if (isOpenAIModel(modelId) && served.includes("openai_responses")) return "openai_responses";
  if (isClaudeModel(modelId) && served.includes("anthropic_messages")) return "anthropic_messages";
  return "openai_chat";
}

/** 光秃秃的名字：提供它的每一家都走 Responses 才走 Responses（magpie allResponses），否则 Chat。 */
export function piBareFormat(
  memberFormats: readonly ApiEndpointRequestFormat[],
): ApiEndpointRequestFormat {
  const isAllResponses =
    memberFormats.length > 0 && memberFormats.every((format) => format === "openai_responses");
  return isAllResponses ? "openai_responses" : "openai_chat";
}

/** `gatewayRoot` 是中转站的根地址（Anthropic 的 SDK 自己补 /v1）。 */
export function piModelEntry(source: PiModelSource, gatewayRoot: string): PiModelEntry {
  const { id, facts } = source;
  const { reasoning, thinkingLevelMap } = piModelThinking(source);
  const entry: PiModelEntry = { id, name: source.name, reasoning };
  if (source.format === "openai_responses") entry.api = "openai-responses";
  if (source.format === "anthropic_messages") {
    entry.api = "anthropic-messages";
    entry.baseUrl = gatewayRoot;
    // 只认自适应思考的 Claude：不说的话 Pi 会要思考预算，被它拒绝。
    if (thinksAdaptivelyOnly(id)) entry.compat = { forceAdaptiveThinking: true };
  }
  if (facts.images === true) entry.input = ["text", "image"];
  if (thinkingLevelMap !== undefined) entry.thinkingLevelMap = thinkingLevelMap;
  // 不写的话 Pi 把每个模型都当 128K，回复上限 16384。
  if (facts.context !== undefined && facts.context > 0) entry.contextWindow = facts.context;
  const output = publishedOutput(facts);
  if (output > 0) entry.maxTokens = output;
  if (source.cost !== null) entry.cost = source.cost;
  const cache = piPromptCache({ format: source.format, id });
  if (cache !== null) entry.promptCache = cache;
  return entry;
}

/** 写进 models.json 的那个模型会不会思考、Pi 的档位怎么映射（Pi 按它们给出能选的档位）。 */
export type PiModelThinking = Pick<PiModelEntry, "reasoning" | "thinkingLevelMap">;

export function piModelThinking(source: PiModelSource): PiModelThinking {
  const { id, facts } = source;
  const efforts = facts.efforts ?? [];
  // 会思考的模型档位不知道也让 Pi 给它的思考档位，中转站再贴合模型（magpie 的 m.Reasoning || len(m.Efforts) > 0）。
  const reasoning = facts.thinks === true || efforts.length > 0;
  const isAnthropic = source.format === "anthropic_messages";
  const levels = piThinkingLevels({ efforts, claudeOff: isAnthropic && isClaudeModel(id) });
  return levels === null ? { reasoning } : { reasoning, thinkingLevelMap: levels };
}

/**
 * Pi 给这个模型能选的档位（magpie piSupported，同 pi-ai 的 getSupportedThinkingLevels）：不会思考的只有 off；
 * 会思考的是没映射成 null 的档，xhigh 与 max 要映射了才有。
 */
export function piOfferedLevels(thinking: PiModelThinking): string[] {
  if (!thinking.reasoning) return ["off"];
  const map = thinking.thinkingLevelMap ?? {};
  return PI_THINKING_LEVELS.filter((level) => {
    const isMapped = Object.hasOwn(map, level);
    if (isMapped) return map[level] !== null;
    return level !== "xhigh" && level !== "max";
  });
}

/** 设成 level 时 Pi 让模型跑在哪一档（magpie piClamp，同 pi-ai 的 clampThinkingLevel）：有就是它，否则往上找最近的，再往下找。 */
export function piClamp(level: string, offered: readonly string[]): string {
  if (offered.includes(level)) return level;
  const at = PI_THINKING_LEVELS.indexOf(level);
  if (at < 0) return offered[0] ?? "off";
  const above = PI_THINKING_LEVELS.slice(at).find((candidate) => offered.includes(candidate));
  if (above !== undefined) return above;
  const below = PI_THINKING_LEVELS.slice(0, at).findLast((candidate) =>
    offered.includes(candidate),
  );
  return below ?? "off";
}

/**
 * Pi 的 7 档都列出，模型有的映射成它自己的档位，没有的写 null（Pi 不给选）；Pi 的 off 是模型的 none。
 * 没有 none 的模型 off 也是 null，只有走 Anthropic 的 Claude 不写 off（Pi 发 thinking disabled，Claude 都收）。
 * 不知道档位的模型不写，用 Pi 自己的缺省。
 */
export function piThinkingLevels(input: {
  efforts: readonly string[];
  claudeOff: boolean;
}): Record<string, string | null> | null {
  if (input.efforts.length === 0) return null;
  const levels: Record<string, string | null> = {};
  for (const level of PI_THINKING_LEVELS) {
    const effort = level === "off" ? "none" : level;
    levels[level] = input.efforts.includes(effort) ? effort : null;
  }
  if (levels.off === null && input.claudeOff) delete levels.off;
  return levels;
}

/** 各档提示缓存留多久（秒）：Claude 走 Anthropic 5 分钟与 1 小时，GPT 走 Responses 5 分钟；别的不写。 */
function piPromptCache(input: {
  format: ApiEndpointRequestFormat;
  id: string;
}): PiModelEntry["promptCache"] | null {
  const name = input.id.slice(input.id.lastIndexOf("/") + 1).toLowerCase();
  if (input.format === "anthropic_messages" && name.startsWith("claude")) {
    return { short: 300, long: 3600 };
  }
  if (input.format === "openai_responses" && name.startsWith("gpt")) return { short: 300 };
  return null;
}
