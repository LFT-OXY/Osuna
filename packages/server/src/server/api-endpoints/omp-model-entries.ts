// models.yml 每个模型的写法移植自 magpie（https://github.com/yetone/magpie，internal/agent/omp.go 的 ompProviderAt、
// ompTakesMax 与 ompModel）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { thinksAdaptivelyOnly } from "./gateway/translation/anthropic.js";
import { publishedOutput } from "./model-facts.js";
import type { PiModelSource } from "./pi-model-entries.js";

/*
 * Osuna 写进 OMP models.yml 的 providers.osuna.models（任务 10-16-pi-omp-endpoints，prd「写进 OMP 配置的内容」）：
 * 清单与每个模型的格式同 Pi（pi-model-entries.ts 的 PiModelSource），思考写成 thinking: {mode, efforts}。
 */

// OMP 认得的思考档位（omp.go 的 ompEfforts，OMP 的 THINKING_EFFORTS），按 OMP 的先后。
export const OMP_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];

// 默认思考档位能设的：auto（OMP 每轮自己挑）与上面几档（OMP 的 defaultThinkingLevel，magpie 的 effort 字段）。
export const OMP_DEFAULT_THINKING_LEVELS = ["auto", ...OMP_EFFORTS];

// 没设默认思考档位时 OMP 新会话起步的档位（OMP 的 cfgDefaultThinkingLevel 缺省）。
export const OMP_START_THINKING = "high";

// models.yml 收 max 的第一个 OMP（pi-ai 16.4.0）；16.3.5 见到 max 整个文件都不认。
const OMP_MAX_SINCE = [16, 4, 0];

export type OmpThinkingMode = "effort" | "budget" | "anthropic-adaptive";

export interface OmpModelThinking {
  mode: OmpThinkingMode;
  efforts: string[];
}

export interface OmpModelEntry {
  id: string;
  name: string;
  api?: "openai-responses" | "anthropic-messages";
  baseUrl?: string;
  reasoning: boolean;
  thinking?: OmpModelThinking;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
}

/** 这个版本的 OMP 收不收 models.yml 里的 max；版本不知道按旧的算（magpie ompTakesMax）。 */
export function ompTakesMax(version: string | null): boolean {
  if (version === null) return false;
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const installed = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let index = 0; index < OMP_MAX_SINCE.length; index += 1) {
    const have = installed[index] ?? 0;
    const need = OMP_MAX_SINCE[index] ?? 0;
    if (have !== need) return have > need;
  }
  return true;
}

/** `gatewayRoot` 是中转站的根地址（走 Anthropic 时 OMP 自己补 /v1）。 */
export interface OmpEntryContext {
  gatewayRoot: string;
  takesMax: boolean;
}

export function ompModelEntry(source: PiModelSource, context: OmpEntryContext): OmpModelEntry {
  const { id, facts } = source;
  const entry: OmpModelEntry = { id, name: source.name, reasoning: false };
  let mode: OmpThinkingMode = "effort";
  if (source.format === "openai_responses") entry.api = "openai-responses";
  if (source.format === "anthropic_messages") {
    entry.api = "anthropic-messages";
    entry.baseUrl = context.gatewayRoot;
    // OMP 的 anthropic-budget-effort 还会带 output_config.effort，Sonnet 4.5、Haiku 4.5 不收，所以用预算。
    mode = thinksAdaptivelyOnly(id) ? "anthropic-adaptive" : "budget";
  }
  const efforts = ompEfforts({ efforts: facts.efforts ?? [], takesMax: context.takesMax });
  if (efforts.length > 0) {
    entry.reasoning = true;
    entry.thinking = { mode, efforts };
  }
  // 不写的话 OMP 按它模糊匹配到的内置模型猜。
  if (facts.context !== undefined && facts.context > 0) entry.contextWindow = facts.context;
  const output = publishedOutput(facts);
  if (output > 0) entry.maxTokens = output;
  if (facts.images === true) entry.input = ["text", "image"];
  if (facts.images === false) entry.input = ["text"];
  return entry;
}

/**
 * 模型在 OMP 里能选的档位，按 OMP 的先后：旧的 OMP 不收 max，最高是 max 的模型给 xhigh，中转站再贴合到 max。
 */
export interface OmpEffortsInput {
  // 模型资料里的档位（模型自己的写法，含 none 等 OMP 不认的）。
  efforts: readonly string[];
  takesMax: boolean;
}

export function ompEfforts(input: OmpEffortsInput): string[] {
  const { efforts, takesMax } = input;
  return OMP_EFFORTS.filter((effort) => {
    if (effort === "max" && !takesMax) return false;
    if (efforts.includes(effort)) return true;
    return effort === "xhigh" && !takesMax && efforts.includes("max");
  });
}

/**
 * 设成 level 时 OMP 让模型跑在哪一档（OMP 的 model-thinking.ts）：有就是它，否则取它下面最近的一档，下面没有取最低的；
 * auto 照旧。`efforts` 为空（不会思考）时为 null。
 */
export function ompClamp(level: string, efforts: readonly string[]): string | null {
  const [lowest] = efforts;
  if (lowest === undefined) return null;
  if (level === "auto" || efforts.includes(level)) return level;
  const at = OMP_EFFORTS.indexOf(level);
  const below = OMP_EFFORTS.slice(0, Math.max(at, 0)).findLast((effort) =>
    efforts.includes(effort),
  );
  return below ?? lowest;
}
