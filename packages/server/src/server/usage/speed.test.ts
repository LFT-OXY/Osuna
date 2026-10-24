import { describe, expect, test } from "vitest";
import { decodeOf, speedSumsOf, type UsageReplyTiming } from "./speed.js";

/*
 * 一次回复的速度照 magpie DecodeOf（用例取自 magpie internal/usage/reasoning_stream_speed_test.go）。
 */

const VISIBLE: UsageReplyTiming = {
  output: 1500,
  reasoning: 1400,
  durationMs: 15000,
  ttftMs: 1000,
  firstTextMs: null,
  firstReasoningMs: 1000,
  flowMs: 12000,
};

function timing(over: Partial<UsageReplyTiming>): UsageReplyTiming {
  return { ...VISIBLE, ...over };
}

describe("a reply's speed", () => {
  test.each<[string, UsageReplyTiming, { tokens: number; ms: number } | null]>([
    [
      "paced visible reasoning with no text counts all its output",
      VISIBLE,
      { tokens: 1500, ms: 14000 },
    ],
    [
      "an answer after reasoning counts only the answer, from its first text",
      timing({ firstTextMs: 14000, flowMs: 1000 }),
      { tokens: 100, ms: 1000 },
    ],
    [
      "reasoning with no text and no visible start tells none",
      timing({ firstReasoningMs: null }),
      null,
    ],
    ["reasoning with no text and an unknown flow tells none", timing({ flowMs: null }), null],
    [
      "content over a quarter of the window counts",
      timing({ flowMs: 3500 }),
      { tokens: 1500, ms: 14000 },
    ],
    ["content in under a quarter of the window was held", timing({ flowMs: 3499 }), null],
    ["more reasoning than output is no count to trust", timing({ reasoning: 1600 }), null],
    [
      "a window under 100 ms tells none",
      timing({ output: 10, reasoning: 5, durationMs: 1099, flowMs: 99 }),
      null,
    ],
    [
      "a window of 100 ms counts",
      timing({ output: 10, reasoning: 5, durationMs: 1100, flowMs: 100 }),
      { tokens: 10, ms: 100 },
    ],
    [
      "over 10,000 tokens a second tells none",
      timing({ output: 1001, reasoning: 5, durationMs: 1100, flowMs: 100 }),
      null,
    ],
    [
      "10,000 tokens a second counts",
      timing({ output: 1000, reasoning: 5, durationMs: 1100, flowMs: 100 }),
      { tokens: 1000, ms: 100 },
    ],
    [
      "sealed reasoning with no text tells none, even with no reasoning count",
      {
        output: 120,
        reasoning: 0,
        durationMs: 9000,
        ttftMs: 1000,
        firstTextMs: null,
        flowMs: 7000,
        reasoningHidden: true,
      },
      null,
    ],
    [
      "late hidden reasoning tells none",
      {
        output: 1500,
        reasoning: 1400,
        durationMs: 9000,
        ttftMs: 8000,
        firstTextMs: null,
        flowMs: 900,
      },
      null,
    ],
    [
      "an answer 20 times faster than its reasoning came was held",
      {
        output: 300,
        reasoning: 10,
        durationMs: 1700,
        ttftMs: 1000,
        firstTextMs: 1500,
        flowMs: 200,
      },
      null,
    ],
    [
      "a plain reply from a row written before flow was kept counts",
      { output: 300, reasoning: 0, durationMs: 4000, ttftMs: 1000, firstTextMs: 1000 },
      { tokens: 300, ms: 3000 },
    ],
    [
      "an unstreamed reply tells none",
      { output: 300, reasoning: 0, durationMs: 4000, ttftMs: null, firstTextMs: null },
      null,
    ],
  ])("%s", (_name, input, expected) => {
    expect(decodeOf(input)).toEqual(expected);
  });

  test("a failed request adds no first-token wait; an answered one adds its wait even without a speed", () => {
    const held = { ...timing({ flowMs: 1000 }), status: "ok" as const };
    expect(speedSumsOf(held)).toEqual({
      ttftCount: 1,
      ttftMs: 1000,
      speedCount: 0,
      speedOutput: 0,
      speedMs: 0,
    });
    expect(speedSumsOf({ ...VISIBLE, status: "failed" })).toBeNull();
    expect(speedSumsOf({ ...VISIBLE, status: "ok" })).toEqual({
      ttftCount: 1,
      ttftMs: 1000,
      speedCount: 1,
      speedOutput: 1500,
      speedMs: 14000,
    });
  });
});
