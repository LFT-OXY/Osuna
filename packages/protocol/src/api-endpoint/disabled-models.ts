// 已禁用的模型的名单与匹配移植自 magpie（https://github.com/yetone/magpie，internal/provider/disabled.go 的
// matchDisabled、globMatch、namesOf、IDDisabled 与 normalDisabled）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { compileGlob, type AutoPickRuleMatcher } from "./auto-pick-rules.js";

/*
 * 已禁用的模型（Disabled models，整台主机共用）：每条是完整 id 或 glob（* 任意一段字符、跨过斜杠，? 任意一个字符），
 * 不分大小写。daemon 拿它从在服务的模型里去掉、中转站拒收；app 拿它去掉默认模型候选、算每条现在命中谁。
 * 用户写的式子一律经 re2js 编译（auto-pick-rules.ts 的 compileGlob），不会卡住。
 */

function matcherOf(pattern: string): AutoPickRuleMatcher | null {
  const glob = pattern.trim();
  if (glob === "") return null;
  return compileGlob({ glob, isQuestionMarkAnyOne: true });
}

/** names 里任一个被哪条命中，回那条（照存的样子）；都没命中为 null。 */
function disabledBy(input: {
  patterns: readonly string[];
  names: readonly string[];
}): string | null {
  const names = input.names.filter((name) => name !== "");
  for (const pattern of input.patterns) {
    const matcher = matcherOf(pattern);
    if (matcher !== null && names.some((name) => matcher.matches(name))) return pattern;
  }
  return null;
}

/** 斜杠后的最后一段（openrouter 的 anthropic/claude-fable-5 是 claude-fable-5）；没有斜杠为 null。 */
function lastSegment(id: string): string | null {
  const at = id.lastIndexOf("/");
  return at >= 0 && at + 1 < id.length ? id.slice(at + 1) : null;
}

/** 一家接口的一个模型被哪条禁了：认它的 id、「接口标识/id」与 id 的最后一段（magpie namesOf）。 */
export function endpointModelDisabledBy(input: {
  patterns: readonly string[];
  slug: string;
  model: string;
}): string | null {
  const model = input.model.trim();
  const names = [model, `${input.slug}/${model}`, lastSegment(model) ?? ""];
  return disabledBy({ patterns: input.patterns, names });
}

/**
 * Agent 请求的模型名被哪条禁了：认整个名字、最后一段与第一个斜杠后的部分（magpie IDDisabled）。
 * 「接口标识/模型」因此和那家的模型本身一样被认出。
 */
export function askedModelDisabledBy(input: {
  patterns: readonly string[];
  model: string;
}): string | null {
  const model = input.model.trim();
  const slash = model.indexOf("/");
  const afterSlug = slash > 0 && slash + 1 < model.length ? model.slice(slash + 1) : "";
  const names = [model, lastSegment(model) ?? "", afterSlug];
  return disabledBy({ patterns: input.patterns, names });
}

/** 存下的样子：去掉首尾空白、空的与只差大小写的重复，保持原来的顺序（magpie normalDisabled）。 */
export function cleanDisabledModels(patterns: readonly string[]): string[] {
  const kept: string[] = [];
  for (const raw of patterns) {
    const pattern = raw.trim();
    const isRepeat = kept.some((known) => known.toLowerCase() === pattern.toLowerCase());
    if (pattern !== "" && !isRepeat) kept.push(pattern);
  }
  return kept;
}
