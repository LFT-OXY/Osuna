// 移植自 magpie（https://github.com/yetone/magpie，internal/agent/claude.go 的 claudeNameRe 与 claudeName）。
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
