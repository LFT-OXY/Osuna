// Claude 模型的档位表移植自 magpie（https://github.com/yetone/magpie，internal/agent/claude.go 的 claudeEffortsFor、claudeEfforts），换模型后的取法照 internal/provider/modelprefs.go 的 nearestEffort。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { AgentSelectOption } from "../agent/agent-sdk-types.js";
import { CLAUDE_ULTRA_CODE, claudeModelName } from "./claude-model-name.js";
import { codexModelLevels, nearestLevel } from "./codex-model-catalog.js";
import type { ModelFacts } from "./model-facts.js";
import type { ApiEndpointProvider } from "./store.js";

/*
 * 默认思考档位（glossary「默认思考档位」，ADR 0012）：终端里新开的会话从哪一档起步，选项来自默认模型的档位。
 * Claude Code 的选项是它能存的 low–xhigh、只能放进环境变量的 max，以及模型支持 xhigh 时的 Ultra Code；
 * Codex 的选项是这个模型收的所有档位。换了默认模型、档位不被新模型支持时改到最近一档。
 */

// Claude Code 收的档位，由弱到强：settings.json 存得下前四档，max 只能写进 CLAUDE_CODE_EFFORT_LEVEL。
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

// 与 Osuna 对话里 Claude 模型的档位显示名一致（agent/providers/claude/model-manifest.ts）。
const CLAUDE_LEVEL_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  [CLAUDE_ULTRA_CODE]: "Ultra Code",
};

export interface DefaultThinkingLevelsInput {
  provider: ApiEndpointProvider;
  modelId: string;
  // 这家这个模型的已知资料（中转站发给哪家就按哪家查）。
  facts: ModelFacts;
}

/** 默认模型是这个模型时，默认思考档位能选的档位，由弱到强。 */
export function defaultThinkingLevels(input: DefaultThinkingLevelsInput): string[] {
  if (input.provider === "codex") return codexModelLevels(input.facts);
  const levels = claudeLevels(input.modelId, input.facts);
  return levels.includes("xhigh") ? [...levels, CLAUDE_ULTRA_CODE] : levels;
}

/**
 * Claude 模型照 magpie 的 claudeEffortsFor（Claude Code 2.1.285 发给它的档位）；别家的模型按已知资料里它收的档位，
 * 能到 max 的也算有 xhigh（中转站把 xhigh 按 max 发出，见 claude-model-hints.ts）；查不到资料时五档都给（magpie 同样）。
 */
function claudeLevels(modelId: string, facts: ModelFacts): string[] {
  switch (claudeModelName(modelId)) {
    case "claude-opus-4-5":
      return ["low", "medium", "high"];
    case "claude-opus-4-6":
    case "claude-sonnet-4-6":
      return ["low", "medium", "high", "max"];
    case "claude-haiku-4-5":
    case "claude-sonnet-4-5":
    case "claude-opus-4":
    case "claude-sonnet-4":
      return [];
    case "":
      break;
    default:
      return [...CLAUDE_EFFORTS];
  }
  if (modelId.toLowerCase().includes("claude-3")) return [];
  const { efforts } = facts;
  if (efforts === undefined) return [...CLAUDE_EFFORTS];
  const reachesMax = efforts.includes("max");
  return CLAUDE_EFFORTS.filter((level) => {
    const isXhighByMax = level === "xhigh" && reachesMax;
    return efforts.includes(level) || isXhighByMax;
  });
}

export interface SettleDefaultThinkingInput {
  // 新默认模型能选的档位（defaultThinkingLevels）。
  levels: readonly string[];
  // 现在的默认思考档位；null 为没设（用 CLI 自己的）。
  chosen: string | null;
}

/** 换了默认模型后的默认思考档位：新模型收就不变，否则取最近的一档（一样近取强的）；附近没有能选的档位时不设。 */
export function settleDefaultThinking(input: SettleDefaultThinkingInput): string | null {
  const { levels, chosen } = input;
  if (chosen === null || levels.includes(chosen)) return chosen;
  const want = chosen === CLAUDE_ULTRA_CODE ? "xhigh" : chosen;
  const effortLevels = levels.filter((level) => level !== CLAUDE_ULTRA_CODE);
  return nearestLevel(want, effortLevels);
}

export interface ThinkingOptionsInput {
  provider: ApiEndpointProvider;
  levels: readonly string[];
}

/** 档位换成 Osuna 对话的思考档位选项：Claude Code 用对话里的显示名，Codex 照它自己的写法。 */
export function thinkingOptionsOf(input: ThinkingOptionsInput): AgentSelectOption[] {
  return input.levels.map((level) => {
    const claudeLabel = CLAUDE_LEVEL_LABELS[level] ?? level;
    return { id: level, label: input.provider === "claude" ? claudeLabel : level };
  });
}
