// 一次回复的出字速度（窗口下限、速度上限、有推理时按正文起点算、正文快于推理 20 倍不计）移植自 magpie
// （https://github.com/yetone/magpie，internal/usage/usage.go 的 DecodeWindow 与 DecodeOf）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

/** A window shorter than this tells no speed: the reply came in one burst at its end. */
const MIN_DECODE_MS = 100;
/** Faster than this a second is no stream anyone writes at: the tokens came whole. */
const MAX_DECODE_SPEED = 10_000;
/** An answer written this many times faster than its reasoning came was held and let go at once. */
const THINK_PACE = 20;

/** What the gateway ledger keeps of one reply's timing, in ms from taking the request. */
export interface UsageReplyTiming {
  output: number;
  reasoning: number;
  durationMs: number;
  ttftMs: number | null;
  firstTextMs: number | null;
}

/**
 * The tokens a reply was seen to write and the ms it took, or null when it
 * tells no speed. A reply that reasoned counts only its answer, from its first
 * text; with no first text its speed is untold.
 */
export function decodeOf(timing: UsageReplyTiming): { tokens: number; ms: number } | null {
  const ttft = timing.ttftMs ?? 0;
  const firstText = timing.firstTextMs ?? 0;
  let tokens = timing.output;
  let start = ttft;
  if (timing.reasoning > 0) {
    if (firstText <= 0) return null;
    tokens = timing.output - timing.reasoning;
    start = firstText;
  }
  if (ttft <= 0) return null;
  const window = timing.durationMs - start;
  if (
    tokens <= 0 ||
    start <= 0 ||
    window < MIN_DECODE_MS ||
    tokens * 1000 > MAX_DECODE_SPEED * window
  ) {
    return null;
  }
  if (
    timing.reasoning > 0 &&
    tokens * (firstText - ttft) > THINK_PACE * timing.reasoning * window
  ) {
    return null;
  }
  return { tokens, ms: window };
}

/** Tokens a second, or null when the reply tells no speed. */
export function outputSpeedOf(timing: UsageReplyTiming): number | null {
  const decoded = decodeOf(timing);
  return decoded ? decoded.tokens / (decoded.ms / 1000) : null;
}
