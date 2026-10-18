// 移植自 magpie（https://github.com/yetone/magpie，internal/provider/claudedash.go 的 ClaudeDashed / claudeSplit /
// undashIn / ClaudeSpelled）。Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

/*
 * Claude Code 认 Claude 模型时要求版本号用连字符（claude-opus-4-6）。带点的写法（claude-opus-4.6）会被它的子串匹配
 * 认成老模型（Opus 4：退役警告、按预算思考、回复 32000、没有档位）。所以写进 settings.json 时，只有连字符写法能
 * 唯一对回一个在售 id 才改写；中转站再按 sameModel 把它认回这家自己的写法。别家的 id 一律不动。
 */

import { ONE_MILLION_MARK } from "./claude-model-hints.js";

const CLAUDE_DOTTED = /claude-(?:opus|sonnet|haiku|fable|mythos)-\d+(?:\.\d+)+/gi;
// 模型名后可以带的档位（Subagent 模型写成 `<模型>:<档位>`）。
const FIXED_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

export interface ClaudeSpelledInput {
  // 要写给 Claude Code 的模型：可带接口标识前缀、`:档位` 与 [1m]。
  model: string;
  // 经中转站在售的所有 id：光秃秃的模型名和 `接口标识/模型名`。
  served: readonly string[];
}

/** 写给 Claude Code 的写法：连字符写法能唯一对回这个 id 时用它，否则原样。 */
export function claudeSpelled(input: ClaudeSpelledInput): string {
  const { id, rest } = splitClaudeRef(input.model);
  const dashed = claudeDashed(id);
  if (dashed === id) return input.model;
  const isUniquelyBack = undashIn(input.served, dashed) === id;
  if (!isUniquelyBack) return input.model;
  return `${dashed}${rest}`;
}

/** Claude 模型版本号里的点都换成连字符；别的 id 原样。 */
export function claudeDashed(id: string): string {
  if (!id.includes(".")) return id;
  return id.replace(CLAUDE_DOTTED, (match) => match.replaceAll(".", "-"));
}

/** 拆出 id 和后面跟着的 `:档位`、[1m]。 */
function splitClaudeRef(ref: string): { id: string; rest: string } {
  let unmarked = ref;
  if (ref.endsWith(ONE_MILLION_MARK)) unmarked = ref.slice(0, -ONE_MILLION_MARK.length);
  const mark = ref.slice(unmarked.length);
  const colon = unmarked.lastIndexOf(":");
  const hasFixedEffort = colon > 0 && FIXED_EFFORTS.has(unmarked.slice(colon + 1).toLowerCase());
  let id = unmarked;
  let effort = "";
  if (hasFixedEffort) {
    id = unmarked.slice(0, colon);
    effort = unmarked.slice(colon);
  }
  return { id, rest: `${effort}${mark}` };
}

/** 连字符化后是 dashed 的唯一在售 id；dashed 本身在售、或有两个对得上时为 null。 */
function undashIn(served: readonly string[], dashed: string): string | null {
  let found: string | null = null;
  for (const id of served) {
    if (id === dashed) return null;
    if (id === found || claudeDashed(id) !== dashed) continue;
    if (found !== null) return null;
    found = id;
  }
  return found;
}
