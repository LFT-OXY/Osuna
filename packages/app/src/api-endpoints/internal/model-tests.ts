// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的 modelTests、namedFree、contextTag、ledTook）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { ApiEndpointModelTestResult } from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/*
 * 测试模型在接口详情页的纯计算。结果只在页面内存里（prd 第 29 条，照 magpie modelTests），离开页面就没了。
 * 「只看能用」去掉最近一次测试失败的，没测过的和还在测的都留着；「只看免费」看模型 id 或显示名里的独立单词 free。
 */

export type ModelTestState =
  | { status: "testing" }
  | { status: "done"; result: ApiEndpointModelTestResult };

// 按模型 id；没测过的不在里面。
export type ModelTests = Readonly<Record<string, ModelTestState>>;

/** 开始测这些模型：它们记成「测试中」，别的模型上次的结果留着（magpie testOne 只动那一个）。 */
export function startTests(tests: ModelTests, modelIds: string[]): ModelTests {
  const next: Record<string, ModelTestState> = { ...tests };
  for (const id of modelIds) next[id] = { status: "testing" };
  return next;
}

export function afterProgress(tests: ModelTests, result: ApiEndpointModelTestResult): ModelTests {
  return { ...tests, [result.modelId]: { status: "done", result } };
}

/** 回应到了：带回来的记下；还标着「测试中」却没回来的（被取消、请求失败）回到没测过。 */
export function afterResponse(
  tests: ModelTests,
  results: ApiEndpointModelTestResult[],
): ModelTests {
  const next: Record<string, ModelTestState> = {};
  for (const [id, state] of Object.entries(tests)) {
    if (state.status === "done") next[id] = state;
  }
  for (const result of results) next[result.modelId] = { status: "done", result };
  return next;
}

export function testSummary(results: ApiEndpointModelTestResult[]): {
  failed: number;
  total: number;
} {
  return { failed: results.filter((result) => !result.ok).length, total: results.length };
}

/** 厂商说它免费：id 或名字里的独立单词 free（OpenRouter 的 foo:free），不算 freedom-7b（magpie namedFree）。 */
export function isNamedFree(names: (string | undefined)[]): boolean {
  return names.some((name) => /(^|[^a-z])free($|[^a-z])/i.test(name ?? ""));
}

/** 上下文小标：一百万 token 以上才标，名字里已经写了（如「1M」）不重复（magpie contextTag）。 */
export function contextTag(input: {
  context: number | undefined;
  name: string | undefined;
}): string | null {
  const { context, name } = input;
  if (context === undefined || context < 1_000_000) return null;
  if (/\b\d+M\b/.test(name ?? "")) return null;
  const millions = context / 1_000_000;
  const rounded = Math.round(millions * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}M`;
}

/** 耗时：一秒内按毫秒，十秒内一位小数，再长取整（magpie ledTook）。 */
export function testTook(durationMs: number): { unit: "ms" | "s"; value: string } {
  const ms = Math.round(durationMs);
  if (ms < 1000) return { unit: "ms", value: String(ms) };
  return { unit: "s", value: (ms / 1000).toFixed(ms < 10_000 ? 1 : 0) };
}

function isFree(input: { id: string; nameOf: (id: string) => string | undefined }): boolean {
  return isNamedFree([input.id, input.nameOf(input.id)]);
}

/** 「只看免费」只在清单里既有免费又有不免费的时出现（magpie：全免费或全不免费时它没有意义）。 */
export function offersFreeOnly(input: {
  ids: string[];
  nameOf: (id: string) => string | undefined;
}): boolean {
  const free = input.ids.filter((id) => isFree({ id, nameOf: input.nameOf })).length;
  return free > 0 && free < input.ids.length;
}

/** 「只看能用」只在有测完的结果后出现（magpie drawWorkOn）。 */
export function hasFinishedTests(tests: ModelTests): boolean {
  return Object.values(tests).some((state) => state.status === "done");
}

export function filterModelIds(input: {
  ids: string[];
  nameOf: (id: string) => string | undefined;
  tests: ModelTests;
  isFreeOnly: boolean;
  isWorkingOnly: boolean;
}): string[] {
  const { nameOf, tests } = input;
  return input.ids.filter((id) => {
    if (input.isFreeOnly && !isFree({ id, nameOf })) return false;
    const state = tests[id];
    if (input.isWorkingOnly && state?.status === "done" && !state.result.ok) return false;
    return true;
  });
}

/** 把文字里的模型名的连字符换成不折行的连字符，免得行尾把 bad-model 折成 bad- 与 model。 */
export function keepIdWhole(input: { text: string; id: string }): string {
  if (!input.id.includes("-")) return input.text;
  return input.text.replaceAll(input.id, input.id.replaceAll("-", "\u2011"));
}
