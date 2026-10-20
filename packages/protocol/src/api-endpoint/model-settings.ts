// 取值顺序、整家上下文不超过模型自己的窗口、留下的档位与撞名的显示移植自 magpie（https://github.com/yetone/magpie，
// internal/provider/models.go 的 WindowOf、ReplyLimit，compact.go 的 compactOf，modelprefs.go 的 Levels、effortsKept、Labels）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type {
  ApiEndpointLongConversations,
  ApiEndpointModelDefaults,
  ApiEndpointModelFacts,
  ApiEndpointModelSetting,
  ApiEndpointModelSettings,
} from "./rpc-schemas.js";

/*
 * 模型设置（Model settings）的读法，daemon 写进 CLI 与中转站、app 的模型设置窗口共用一份：
 * 单个模型的设置 → 整家默认 → Osuna 自动取到的（上游清单在前，models.dev 补上）；内置默认由用的地方自己补。
 */

/** 档位不知道的模型可以给的档位，由弱到强（magpie Levels）。 */
export const MODEL_THINKING_LEVELS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

/** 模型显示名最长多少个字符（magpie setModelName）。 */
export const MODEL_NAME_MAX_LENGTH = 80;

/** 按 token 数记的几项；整家默认只有这几项。 */
export const MODEL_TOKEN_FIELDS = ["context", "output", "compact"] as const;
export type ModelTokenField = (typeof MODEL_TOKEN_FIELDS)[number];

/** 没设全局压缩阈值时告诉 Codex、Claude Code 的工作窗口（magpie WorkingWindow：Codex 给 OpenAI 自家大窗口模型的）。 */
export const WORKING_WINDOW = 272_000;

/**
 * 模型和整家都没设压缩阈值时，比它大的窗口说成多少（magpie Settings.Compact）：「完整窗口」开着为 undefined（整个窗口），
 * 否则是全局压缩阈值，没设就是 WORKING_WINDOW。
 */
export function hostCompactAt(
  longConversations: ApiEndpointLongConversations | undefined,
): number | undefined {
  if (longConversations?.fullContext === true) return undefined;
  return longConversations?.compactAt ?? WORKING_WINDOW;
}

export interface ResolvedModelFacts {
  name?: string;
  context?: number;
  output?: number;
  // 给 Agent 的档位：用户留下的，没留按自动取到的。
  efforts?: string[];
  images?: boolean;
  compact?: number;
  // 上下文是用户手填的（这个模型的或整家默认）：照 magpie Entry.WindowSet，不再套 Codex 的 272K 工作窗口。
  contextSet: boolean;
  // 用户一档都没留：中转站不发任何思考参数（magpie Reasonless）。
  noThinking: boolean;
}

export function resolveModelFacts(input: {
  settings: ApiEndpointModelSettings | undefined;
  modelId: string;
  auto: ApiEndpointModelFacts;
}): ResolvedModelFacts {
  const { auto } = input;
  const own = input.settings?.models?.[input.modelId] ?? {};
  const defaults = input.settings?.defaults ?? {};
  const name = own.name ?? auto.name;
  const context = own.context ?? defaultContext(defaults.context, auto.context);
  const output = own.output ?? defaults.output ?? auto.output;
  const noThinking = own.efforts !== undefined && own.efforts.length === 0;
  const efforts = noThinking ? [] : offeredEfforts(auto.efforts, own.efforts);
  const images = own.images ?? auto.images;
  const compact = own.compact ?? defaults.compact;
  return {
    ...(name === undefined ? {} : { name }),
    ...(context === undefined ? {} : { context }),
    ...(output === undefined ? {} : { output }),
    ...(efforts === undefined ? {} : { efforts }),
    ...(images === undefined ? {} : { images }),
    ...(compact === undefined ? {} : { compact }),
    contextSet: isContextSet(own.context, defaults.context),
    noThinking,
  };
}

/** 上下文是用户手填的：这个模型的，或整家默认。 */
function isContextSet(own: number | undefined, endpointWide: number | undefined): boolean {
  return own !== undefined || endpointWide !== undefined;
}

/** 整家的上下文不超过模型自己已知的窗口（magpie WindowOf 的 "*"：设成 512K 省钱，不该把只有 262K 的模型说成 512K）。 */
function defaultContext(set: number | undefined, known: number | undefined): number | undefined {
  if (set === undefined) return known;
  return known !== undefined && known < set ? known : set;
}

/**
 * 留下的档位按模型自己的顺序（magpie effortsKept）：没留就是全部；档位不知道的模型按 MODEL_THINKING_LEVELS 的顺序；
 * 清单换了、留的一个都不在了也给全部。
 */
function offeredEfforts(
  known: string[] | undefined,
  kept: string[] | undefined,
): string[] | undefined {
  if (kept === undefined) return known;
  const all = known !== undefined && known.length > 0 ? known : [...MODEL_THINKING_LEVELS];
  const offered = all.filter((level) => kept.includes(level));
  return offered.length === 0 ? known : offered;
}

/** 这个模型可以留哪些档位：知道的就是它自己的，不知道就是 MODEL_THINKING_LEVELS。 */
export function choosableEfforts(known: string[] | undefined): string[] {
  return known !== undefined && known.length > 0 ? known : [...MODEL_THINKING_LEVELS];
}

/**
 * 要存的档位：去空白、转小写、去重、按 choosableEfforts 的顺序；留了全部（不是一档不留）就是没设，为 undefined。
 * 有不在 choosableEfforts 里的返回 { invalid }。
 */
export function keptEfforts(input: {
  picked: string[];
  known: string[] | undefined;
}): { kind: "kept"; efforts: string[] | undefined } | { kind: "invalid"; level: string } {
  const all = choosableEfforts(input.known);
  const picked = input.picked.map((level) => level.trim().toLowerCase()).filter(Boolean);
  const invalid = picked.find((level) => !all.includes(level));
  if (invalid !== undefined) return { kind: "invalid", level: invalid };
  const efforts = all.filter((level) => picked.includes(level));
  const isKnown = input.known !== undefined && input.known.length > 0;
  const keepsAll = isKnown && efforts.length === all.length;
  return { kind: "kept", efforts: keepsAll ? undefined : efforts };
}

/** 同一个选单里显示名撞了（不分大小写）的改显示模型 id，其余照名字（magpie Labels 的 same）。 */
export function distinctModelLabels(
  entries: ReadonlyArray<{ id: string; label: string }>,
): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.label.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return entries.map((entry) =>
    (counts.get(entry.label.toLowerCase()) ?? 0) > 1 ? entry.id : entry.label,
  );
}

/** 存模型设置时不收的：token 数不是大于零的整数、显示名太长、档位不是这个模型的。 */
export type ModelSettingProblem =
  | { kind: "tokens"; field: ModelTokenField; value: number }
  | { kind: "name_too_long" }
  | { kind: "effort"; level: string };

export type ModelSettingSettled<T> =
  | { kind: "settled"; setting: T }
  | { kind: "invalid"; problem: ModelSettingProblem };

/** token 数只留大于零的整数（magpie SetModelOutput、SetModelCompacts）。 */
export function settleModelDefaults(
  setting: ApiEndpointModelDefaults,
): ModelSettingSettled<ApiEndpointModelDefaults> {
  const out: ApiEndpointModelDefaults = {};
  for (const field of MODEL_TOKEN_FIELDS) {
    const value = setting[field];
    if (value === undefined) continue;
    const isTokenCount = Number.isInteger(value) && value > 0;
    if (!isTokenCount) return { kind: "invalid", problem: { kind: "tokens", field, value } };
    out[field] = value;
  }
  return { kind: "settled", setting: out };
}

/**
 * daemon 存、app 判断有没有改动都按这一份收拢一个模型的设置：token 数同 settleModelDefaults；显示名收拢空白，
 * 空的去掉（magpie setModelName）；档位按 keptEfforts；看图答案和上游清单明说的一样就不记（magpie setModelImage 的 vendorSees，
 * 只认清单明说的，不认 models.dev 补的）。
 */
export function settleModelSetting(input: {
  setting: ApiEndpointModelSetting;
  knownEfforts: string[] | undefined;
  listedImages: boolean | undefined;
}): ModelSettingSettled<ApiEndpointModelSetting> {
  const { setting } = input;
  const tokens = settleModelDefaults(setting);
  if (tokens.kind === "invalid") return tokens;
  const out: ApiEndpointModelSetting = { ...tokens.setting };
  const name = (setting.name ?? "").split(/\s+/).filter(Boolean).join(" ");
  if ([...name].length > MODEL_NAME_MAX_LENGTH) {
    return { kind: "invalid", problem: { kind: "name_too_long" } };
  }
  if (name !== "") out.name = name;
  if (setting.efforts !== undefined) {
    const kept = keptEfforts({ picked: setting.efforts, known: input.knownEfforts });
    if (kept.kind === "invalid") {
      return { kind: "invalid", problem: { kind: "effort", level: kept.level } };
    }
    if (kept.efforts !== undefined) out.efforts = kept.efforts;
  }
  const isListedAnswer = setting.images === input.listedImages;
  if (setting.images !== undefined && !isListedAnswer) out.images = setting.images;
  return { kind: "settled", setting: out };
}

/** 只设了档位：照 magpie setModelEfforts，不要求这家列着这个模型（只对着已知的档位查）。 */
export function setsOnlyEfforts(setting: ApiEndpointModelSetting): boolean {
  return Object.keys(setting).every((field) => field === "efforts");
}
