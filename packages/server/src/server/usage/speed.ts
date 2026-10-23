// 出字速度与首字等待（窗口下限、速度上限、攒着一次吐出、有推理时按正文或可见推理起点算、封存推理、组内按 token 加权、首字取均值）移植自 magpie
// （https://github.com/yetone/magpie，internal/usage/usage.go 的 DecodeWindow、DecodeOf、Record.Decode、Totals.addFrom、MeanTTFT 与 Speed）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { SPEED_COLUMNS, UsageBucketRow } from "./types.js";

/** A window shorter than this tells no speed: the reply came in one burst at its end. */
const MIN_DECODE_MS = 100;
/** Faster than this a second is no stream anyone writes at: the tokens came whole. */
const MAX_DECODE_SPEED = 10_000;
/** A window this many times longer than its content took to come was mostly a wait. */
const HELD_SHARE = 4;
/** An answer written this many times faster than its reasoning came was held and let go at once. */
const THINK_PACE = 20;

/**
 * What the gateway ledger keeps of one reply's timing, in ms from taking the
 * request. `flowMs` is how long its content took to come from where its speed
 * is counted; `firstReasoningMs` the start of paced visible reasoning;
 * `reasoningHidden` a reply whose reasoning was sealed or only summarised.
 * The three are absent on rows written before they were kept: unknown.
 */
export interface UsageReplyTiming {
  output: number;
  reasoning: number;
  durationMs: number;
  ttftMs: number | null;
  firstTextMs: number | null;
  flowMs?: number | null;
  firstReasoningMs?: number | null;
  reasoningHidden?: boolean;
}

/** The tokens a reply was seen to write and the ms it took to write them. */
export interface DecodedSpeed {
  tokens: number;
  ms: number;
}

/**
 * The tokens a reply was seen to write and the ms it took, or null when it
 * tells no speed. A reply that reasoned counts only its answer, from its first
 * text; with no text, paced visible reasoning times all its output from where
 * the reasoning began. One its vendor held back and let go in a burst — its
 * content came in under a quarter of its window, or its answer over 20 times
 * faster than its reasoning came — tells none.
 */
export function decodeOf(timing: UsageReplyTiming): DecodedSpeed | null {
  const ttft = timing.ttftMs ?? 0;
  const firstText = timing.firstTextMs ?? 0;
  if (timing.reasoningHidden === true && firstText <= 0) return null;
  const counted = countedFrom(timing);
  if (counted === null || ttft <= 0) return null;
  const { tokens, start } = counted;
  const window = timing.durationMs - start;
  if (
    tokens <= 0 ||
    start <= 0 ||
    window < MIN_DECODE_MS ||
    tokens * 1000 > MAX_DECODE_SPEED * window
  ) {
    return null;
  }
  return heldBack({ timing, tokens, window }) ? null : { tokens, ms: window };
}

/** The tokens a speed counts and the ms from the request they are counted from. */
interface CountedTokens {
  tokens: number;
  start: number;
}

/**
 * Which tokens count and from when: all of them from the first content; a
 * reply that reasoned, its answer from its first text, or with no text all of
 * them from where its paced visible reasoning began. Null when it reasoned and
 * neither is known.
 */
function countedFrom(timing: UsageReplyTiming): CountedTokens | null {
  const ttft = timing.ttftMs ?? 0;
  const firstText = timing.firstTextMs ?? 0;
  const firstReasoning = timing.firstReasoningMs ?? 0;
  if (timing.reasoning <= 0) return { tokens: timing.output, start: ttft };
  if (firstText > 0) return { tokens: timing.output - timing.reasoning, start: firstText };
  const visible =
    firstReasoning > 0 &&
    firstReasoning >= ttft &&
    (timing.flowMs ?? 0) > 0 &&
    timing.reasoning <= timing.output;
  return visible ? { tokens: timing.output, start: firstReasoning } : null;
}

/** The vendor held the reply and let it go at once: by its flow, or by an answer far faster than its reasoning. */
function heldBack(input: { timing: UsageReplyTiming; tokens: number; window: number }): boolean {
  const { timing, tokens, window } = input;
  const flow = timing.flowMs ?? 0;
  if (flow > 0 && flow * HELD_SHARE < window) return true;
  const ttft = timing.ttftMs ?? 0;
  const firstText = timing.firstTextMs ?? 0;
  return (
    timing.reasoning > 0 &&
    firstText > 0 &&
    tokens * (firstText - ttft) > THINK_PACE * timing.reasoning * window
  );
}

/** Tokens a second, or null when the reply tells no speed. */
export function outputSpeedOf(timing: UsageReplyTiming): number | null {
  const decoded = decodeOf(timing);
  return decoded ? decoded.tokens / (decoded.ms / 1000) : null;
}

/**
 * What a bucket row sums for speed: of the answered requests whose first
 * content was timed, how many (`ttftCount`) and their waits (`ttftMs`); of
 * those that told a speed, how many (`speedCount`), their tokens and their
 * windows. All are absent on rows that carry none.
 */
export type UsageSpeedSums = Required<Pick<UsageBucketRow, (typeof SPEED_COLUMNS)[number]>>;

/** One answered request's share of the sums, or null when it was not streamed or not answered. */
export function speedSumsOf(
  timing: UsageReplyTiming & { status: "ok" | "failed" | "cancelled" },
): UsageSpeedSums | null {
  const ttft = timing.ttftMs ?? 0;
  if (timing.status !== "ok" || ttft <= 0) return null;
  const decoded = decodeOf(timing);
  return {
    ttftCount: 1,
    ttftMs: ttft,
    speedCount: decoded ? 1 : 0,
    speedOutput: decoded?.tokens ?? 0,
    speedMs: decoded?.ms ?? 0,
  };
}

/** A group's speed, tokens over the summed windows (weighted by tokens); null when none told one. */
export function groupOutputSpeed(
  sums: Pick<UsageSpeedSums, "speedOutput" | "speedMs">,
): number | null {
  return sums.speedMs > 0 ? sums.speedOutput / (sums.speedMs / 1000) : null;
}
