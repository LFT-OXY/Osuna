// 移植自 magpie（https://github.com/yetone/magpie，internal/agent/claude.go 的 claudeNameRe、claudeName、claudeEfforts 与 claudeEffortsFor）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { claudeDashed } from "./claude-spelling.js";

/** Ultra Code 在思考档位里的 id，与 Osuna 对话的思考档位一致。 */
export const CLAUDE_ULTRA_CODE = "ultracode";

// Claude Code 按它认模型的方式找出 id 里的 Claude 模型：带 [1m]、带日期、带接口前缀的都算。
const CLAUDE_NAME = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:[^0-9]|$)/;

/** id 里的 Claude 模型名（modelSettings 的键）；别家的模型、档位名为空串。带点的版本按连字符认。 */
export function claudeModelName(modelId: string): string {
  const match = CLAUDE_NAME.exec(claudeDashed(modelId).toLowerCase());
  if (!match) return "";
  const [, family, major, minor] = match;
  return minor === undefined ? `claude-${family}-${major}` : `claude-${family}-${major}-${minor}`;
}

// Claude Code 收的档位，由弱到强：settings.json 存得下前四档，max 只能写进 CLAUDE_CODE_EFFORT_LEVEL。
export const CLAUDE_EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * magpie claudeEffortsFor：Claude Code 2.1.285 发给这个模型的档位。Opus 4.5 到 high，Opus / Sonnet 4.6 没有 xhigh，
 * Haiku 和更老的 Claude 没有档位；它不认识的模型（经中转站的别家模型、比它新的 Claude）五档都给，照设的发。
 */
export function claudeEffortsFor(modelId: string): string[] {
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
