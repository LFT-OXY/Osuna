// 按模型名查 models.dev 的规则移植自 magpie（https://github.com/yetone/magpie，internal/catalog/catalog.go 的
// bareID / found / mostGiven / mostListed / window）。Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { z } from "zod";
import { isRecord } from "./upstream-http.js";

/*
 * 接口模型的已知数据：一次请求能装多少（上下文）、一次回复最多多长、能调哪些思考档位。
 * 不知道的字段不出现；Claude Code 的模型提示只写知道的。
 */

export const ModelFactsSchema = z.object({
  context: z.number().optional(),
  output: z.number().optional(),
  efforts: z.array(z.string()).optional(),
});
export type ModelFacts = z.infer<typeof ModelFactsSchema>;

/** 按去掉前缀的小写模型名索引的 models.dev 数据。 */
export type ModelsDevIndex = Record<string, ModelFacts>;

// 比这小的窗口装不下 Agent 的系统提示，是列表写错了（magpie 遇到过把 512 当窗口的免费模型）。
const LEAST_WINDOW = 2048;

interface Votes {
  context: Map<number, number>;
  output: Map<number, number>;
  efforts: Map<string, number>;
}

/** 同一个模型各家给的数可能不同：取给得最多的那个，打平取小的；档位打平取少的。 */
export function indexModelsDev(raw: unknown): ModelsDevIndex {
  const votes = new Map<string, Votes>();
  if (!isRecord(raw)) return {};
  for (const provider of Object.values(raw)) {
    if (!isRecord(provider) || !isRecord(provider.models)) continue;
    for (const [id, model] of Object.entries(provider.models)) {
      if (!isRecord(model)) continue;
      const key = bareModelId(id);
      const entry = votes.get(key) ?? { context: new Map(), output: new Map(), efforts: new Map() };
      votes.set(key, entry);
      const limit = isRecord(model.limit) ? model.limit : {};
      const context = windowOf(limit);
      if (context !== undefined) count(entry.context, context);
      const output = positiveInteger(limit.output);
      if (output !== undefined) count(entry.output, output);
      const efforts = effortsOf(model.reasoning_options);
      if (efforts.length > 0) count(entry.efforts, efforts.join(","));
    }
  }
  const index: ModelsDevIndex = {};
  for (const [id, entry] of votes) {
    const facts: ModelFacts = {};
    const context = mostGiven(entry.context);
    if (context !== undefined) facts.context = context;
    const output = mostGiven(entry.output);
    if (output !== undefined) facts.output = output;
    const efforts = mostListed(entry.efforts);
    if (efforts !== undefined) facts.efforts = efforts.split(",");
    index[id] = facts;
  }
  return index;
}

/** 按模型名查：先整名，再去掉 `:thinking` 这类后缀。查不到是空对象。 */
export function lookupModelFacts(index: ModelsDevIndex, id: string): ModelFacts {
  const bare = bareModelId(id);
  const found = index[bare];
  if (found) return found;
  const colon = bare.indexOf(":");
  return (colon > 0 ? index[bare.slice(0, colon)] : undefined) ?? {};
}

/** 逐项取先知道的：接口自己列表里给的在前，models.dev 补上没给的。 */
export function mergeModelFacts(listed: ModelFacts | undefined, known: ModelFacts): ModelFacts {
  const context = listed?.context ?? known.context;
  const output = listed?.output ?? known.output;
  const efforts = listed?.efforts ?? known.efforts;
  return {
    ...(context === undefined ? {} : { context }),
    ...(output === undefined ? {} : { output }),
    ...(efforts === undefined ? {} : { efforts }),
  };
}

/** 模型名去掉最后一个斜杠前的部分，转小写。 */
export function bareModelId(id: string): string {
  const lower = id.toLowerCase();
  return lower.slice(lower.lastIndexOf("/") + 1);
}

/** 窗口小于 2048 的不算知道。 */
export function knownWindow(value: unknown): number | undefined {
  const n = positiveInteger(value);
  return n !== undefined && n >= LEAST_WINDOW ? n : undefined;
}

// 输入上限优先（gpt-5 系列 40 万窗口里只能输入 27.2 万）；输入上限比窗口还大时取窗口。
function windowOf(limit: Record<string, unknown>): number | undefined {
  const input = knownWindow(limit.input);
  const context = knownWindow(limit.context);
  if (input === undefined) return context;
  return context !== undefined && context < input ? context : input;
}

function effortsOf(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  let efforts: string[] = [];
  for (const option of options) {
    if (!isRecord(option) || option.type !== "effort" || !Array.isArray(option.values)) continue;
    efforts = option.values.filter((value): value is string => typeof value === "string");
  }
  return efforts;
}

function count<T>(tally: Map<T, number>, value: T): void {
  tally.set(value, (tally.get(value) ?? 0) + 1);
}

function mostGiven(tally: Map<number, number>): number | undefined {
  let best: number | undefined;
  let bestCount = 0;
  for (const [value, n] of tally) {
    const isTieWin = n === bestCount && best !== undefined && value < best;
    if (n > bestCount || isTieWin) {
      best = value;
      bestCount = n;
    }
  }
  return best;
}

function mostListed(tally: Map<string, number>): string | undefined {
  const levels = (value: string) => value.split(",").length;
  let best: string | undefined;
  let bestCount = 0;
  for (const [value, n] of tally) {
    const isTieWin =
      n === bestCount &&
      best !== undefined &&
      (levels(value) < levels(best) || (levels(value) === levels(best) && value < best));
    if (n > bestCount || isTieWin) {
      best = value;
      bestCount = n;
    }
  }
  return best;
}

export function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}
