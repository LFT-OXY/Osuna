// 对话太长的判定移植自 magpie（https://github.com/yetone/magpie，internal/gateway/fallback.go 的 unsaidMargin、tooLongUnsaid、roomy、holds 与 withRoom）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import {
  FAILURE_WORDS,
  failure,
  modelRefused,
  readsTooLong,
  saysTooLong,
  wordsOf,
} from "./failure.js";
import type { GatewayCandidate } from "./routing.js";

/*
 * 请求大小用本地估算（estimateInputTokens，UTF-8 字节 ÷ 4），窗口用这家这个模型的资料（ModelFactsLookup）；
 * 窗口不知道的一律当装得下。
 * magpie 只在路由组里换成员；Osuna 没有组，同名模型的下一家就是下一个候选，所以超长被拒时，
 * 后面有已知窗口更大的同名候选就换过去，没有就照旧交给 CLI 去压缩（Osuna 自加）。
 */

// 估算超过窗口这么多倍，才把不说原因的失败认作超长：估算按 4 字节一个 token，多半偏少
// （Devin 数出 173,954 的请求估算是 151,851），超过五分之一就几乎装不下了。
const UNSAID_MARGIN = 1.2;

// 照 magpie：附上厂商原话时最多这么多字。
const SAID_MOST = 200;

/** 候选的这个模型的已知窗口（token）；不知道为 undefined。 */
export type WindowOf = (candidate: GatewayCandidate) => number | undefined;

/** 发出前按窗口筛过的候选，与被跳过的。 */
export interface RoomyPlan<T extends GatewayCandidate> {
  plan: T[];
  skipped: T[];
}

/**
 * 发出前去掉已知窗口装不下这次请求的候选（magpie 的 roomy）。估算不出、一家都没去掉、
 * 或一家都装不下时原样不动：都装不下就问第一家，再按超长告诉 CLI 去压缩。
 */
export function roomyCandidates<T extends GatewayCandidate>(input: {
  plan: T[];
  tokens: number | null;
  windowOf: WindowOf;
}): RoomyPlan<T> {
  const { tokens, windowOf } = input;
  if (tokens === null) return { plan: input.plan, skipped: [] };
  const holding = input.plan.filter((candidate) => holds({ window: windowOf(candidate), tokens }));
  const isUnchanged = holding.length === 0 || holding.length === input.plan.length;
  if (isUnchanged) return { plan: input.plan, skipped: [] };
  const skipped = input.plan.filter((candidate) => !holding.includes(candidate));
  return { plan: holding, skipped };
}

/**
 * 一家说对话太长后还能换去的：后面已知窗口比这家大、也装得下估算的候选（magpie withRoom 只在组里换，
 * 窗口不知道的也留着；这里只认已知更大的）。这家的窗口不知道时比不出大小，一家都不换。
 */
export function largerWindows<T extends GatewayCandidate>(input: {
  left: T[];
  window: number | undefined;
  tokens: number | null;
  windowOf: WindowOf;
}): T[] {
  const { window, tokens, windowOf } = input;
  if (window === undefined) return [];
  return input.left.filter((candidate) => {
    const larger = windowOf(candidate);
    const isLarger = larger !== undefined && larger > window;
    return isLarger && holds({ window: larger, tokens });
  });
}

/** 窗口不知道、或比估算大，就算装得下（magpie holds）。 */
function holds(input: { window: number | undefined; tokens: number | null }): boolean {
  const { window, tokens } = input;
  if (window === undefined) return true;
  if (tokens === null) return true;
  return tokens < window;
}

/** 一家失败是不是因为对话太长：怎么认出来的，以及要交给 CLI 的说法。 */
export type Overflow = { kind: "said" } | { kind: "unsaid"; message: string };

/**
 * 上游说了对话太长，或没说原因、但估算已超过窗口 1.2 倍（magpie tooLongUnsaid）；都不是为 null。
 * 不说原因的：Devin 的 502「capacity issues」、WorkBuddy 的 400「Invalid request parameters」、Qoder 的 400
 * 「Error in upstream response」，换一家照样失败，CLI 当作厂商的错误也不会去压缩。限流、额度、不提供这个模型、
 * 拒收、防火墙、地区不支持的不算。
 */
export function overflowOf(input: {
  status: number;
  // 上游错误体原文。
  text: string;
  // 给 Agent 看的上游原文，key 已打码。
  detail: string;
  tokens: number | null;
  window: number | undefined;
  model: string;
  endpointName: string;
}): Overflow | null {
  const { status, tokens, window } = input;
  if (saysTooLong(status, input.text)) return { kind: "said" };
  const isPastWindow = tokens !== null && window !== undefined && tokens >= window * UNSAID_MARGIN;
  const isUnsaidOverflow = isPastWindow && saysNoReason(status, input.text);
  if (!isUnsaidOverflow) return null;
  const message = `prompt is too long: about ${tokens} tokens, more than ${input.model}'s context window of ${window}`;
  const said = saidBriefly(input.detail);
  // 厂商原话读起来像别的上限（限流、max_tokens）时不附上，免得 CLI 认不出是超长。
  const withSaid = `${message} (${input.endpointName} answered ${status}: ${said})`;
  const keepsSaid = said !== "" && readsTooLong(400, withSaid);
  if (keepsSaid) return { kind: "unsaid", message: withSaid };
  return { kind: "unsaid", message: `${message} (${input.endpointName} answered ${status})` };
}

const UNSAID_STATUSES = new Set([400, 413, 422, 500, 502, 503, 504]);

/** 失败没说别的原因：不是额度、限流、不提供这个模型、拒收、防火墙或地区。 */
function saysNoReason(status: number, rawBody: string): boolean {
  const mayBeUnsaid = UNSAID_STATUSES.has(status) && failure(status, rawBody) === "other";
  if (!mayBeUnsaid) return false;
  const body = wordsOf(rawBody);
  const W = FAILURE_WORDS;
  const saidWhy = [W.quota, W.unserved, W.refused, W.blocked, W.region].some((words) =>
    words.test(body),
  );
  return !saidWhy && !modelRefused(status, rawBody);
}

function saidBriefly(detail: string): string {
  const said = detail.trim();
  if (said.length <= SAID_MOST) return said;
  return `${said.slice(0, SAID_MOST)}…`;
}
