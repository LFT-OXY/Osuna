// Claude 模型的档位表移植自 magpie（https://github.com/yetone/magpie，internal/agent/claude.go 的 claudeEffortsFor、claudeEfforts），claudeClamp；Codex 换模型后的取法照 internal/agent/codex.go 的 settle 与 internal/codexcat/codexcat.go 的 ModelDefault。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { AgentSelectOption } from "../agent/agent-sdk-types.js";
import { CLAUDE_ULTRA_CODE, claudeModelName } from "./claude-model-name.js";
import { codexDefaultLevel, codexModelLevels } from "./codex-model-catalog.js";
import type { ModelFacts } from "./model-facts.js";
import type { ApiEndpointProvider } from "./store.js";

/*
 * 默认思考档位（glossary「默认思考档位」，ADR 0012）：终端里新开的会话从哪一档起步，选项来自默认模型的档位。
 * Claude Code 照 magpie 的 effort 字段：选项是 claudeEffortsFor 给的档位（别家模型五档都给），换了默认模型不改设置，
 * 只在显示时按 claudeClamp 取模型跑得到的那一档（Claude Code 自己也这样降）；Ultra Code 是另一个开关（ultracode 字段），
 * 只在模型支持 xhigh 时提供。Codex 照 magpie 的 settle：选项是模型收的档位，新模型不收时改到 ModelDefault。
 */

// Claude Code 收的档位，由弱到强：settings.json 存得下前四档，max 只能写进 CLAUDE_CODE_EFFORT_LEVEL。
const CLAUDE_EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

// 档位的显示名，两个 CLI 一致；与 Osuna 对话里 Claude 模型的显示名相同（agent/providers/claude/model-manifest.ts）。
const LEVEL_LABELS: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  ultra: "Ultra",
  [CLAUDE_ULTRA_CODE]: "Ultra Code",
};

export interface DefaultThinkingLevelsInput {
  provider: ApiEndpointProvider;
  modelId: string;
  // 这家这个模型的已知资料（中转站发给哪家就按哪家查）；Claude Code 不看它（magpie 同样）。
  facts: ModelFacts;
}

/** 默认模型是这个模型时，默认思考档位能选的档位，由弱到强（不含 Ultra Code）。 */
export function defaultThinkingLevels(input: DefaultThinkingLevelsInput): string[] {
  if (input.provider === "codex") return codexModelLevels(input.facts);
  return claudeEffortsFor(input.modelId);
}

/** 模型支持 xhigh 才有 Ultra Code（Claude Code 2.1.284 起的门槛）。 */
export function takesUltraCode(levels: readonly string[]): boolean {
  return levels.includes("xhigh");
}

/**
 * magpie claudeEffortsFor：Claude Code 2.1.285 发给这个模型的档位。Opus 4.5 到 high，Opus / Sonnet 4.6 没有 xhigh，
 * Haiku 和更老的 Claude 没有档位；它不认识的模型（经中转站的别家模型、比它新的 Claude）五档都给，照设的发。
 */
function claudeEffortsFor(modelId: string): string[] {
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
  return [...CLAUDE_EFFORTS];
}

/**
 * magpie claudeClamp：设成 value 时 Claude Code 让这个模型跑在哪一档——模型收的档位里不高于它的最高一档，
 * 都比它高就取最低的；模型没有档位时为 null。只用来显示，设置本身不改。
 */
export function claudeClamp(value: string, levels: readonly string[]): string | null {
  if (levels.length === 0) return null;
  if (levels.includes(value)) return value;
  const at = CLAUDE_EFFORTS.indexOf(value);
  if (at < 0) return value;
  let clamped = levels[0] ?? null;
  for (const level of levels) {
    const rank = CLAUDE_EFFORTS.indexOf(level);
    if (rank >= 0 && rank <= at) clamped = level;
  }
  return clamped;
}

export interface SettleCodexThinkingInput {
  // 新默认模型收的档位；空的是不知道（不改）。
  levels: readonly string[];
  // 现在的默认思考档位；null 为没设（用 Codex 自己的）。
  chosen: string | null;
}

/** magpie Codex 的 settle：新模型收就不变，否则取 ModelDefault（最近一档，没有就 medium、high、第一档）；不知道档位时不改。 */
export function settleCodexThinking(input: SettleCodexThinkingInput): string | null {
  const { levels, chosen } = input;
  const isKept = chosen === null || levels.length === 0 || levels.includes(chosen);
  if (isKept) return chosen;
  return codexDefaultLevel(levels, chosen);
}

export interface ThinkingOptionsInput {
  levels: readonly string[];
}

/** 档位换成思考档位选项，显示名两个 CLI 一致（认不出的首字母大写）。 */
export function thinkingOptionsOf(input: ThinkingOptionsInput): AgentSelectOption[] {
  return input.levels.map((level) => ({ id: level, label: levelLabel(level) }));
}

function levelLabel(level: string): string {
  return LEVEL_LABELS[level] ?? `${level.charAt(0).toUpperCase()}${level.slice(1)}`;
}
