import { describe, expect, test } from "vitest";
import { windowPace } from "./window-pace.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("windowPace", () => {
  test("more used than an even pace is a positive pace: 60% used halfway through is +10", () => {
    expect(
      windowPace({
        usedPct: 60,
        resetsAt: "2026-10-22T10:00:00.000Z",
        span: 4 * HOUR,
        now: Date.parse("2026-10-22T08:00:00.000Z"),
      }),
    ).toBe(10);
  });

  test("less used than an even pace is negative", () => {
    // 7 天窗口过了 1 天（约 14.29%），用了 5%。
    const pace = windowPace({
      usedPct: 5,
      resetsAt: "2026-10-28T00:00:00.000Z",
      span: 7 * DAY,
      now: Date.parse("2026-10-22T00:00:00.000Z"),
    });
    expect(pace).toBeCloseTo(-9.2857, 3);
  });

  test("a month's window began on the same day a month before, not 30 days before", () => {
    // 11-01 重置的月窗口从 10-01 起，共 31 天；10-16 12:00 过了一半。
    expect(
      windowPace({
        usedPct: 50,
        resetsAt: "2026-11-01T00:00:00.000Z",
        span: "month",
        now: Date.parse("2026-10-16T12:00:00.000Z"),
      }),
    ).toBe(0);
  });

  test("a share above 100 counts as 100", () => {
    expect(
      windowPace({
        usedPct: 130,
        resetsAt: "2026-10-22T10:00:00.000Z",
        span: 4 * HOUR,
        now: Date.parse("2026-10-22T08:00:00.000Z"),
      }),
    ).toBe(50);
  });

  test("no reset, no length, or now outside the window has no pace", () => {
    const now = Date.parse("2026-10-22T08:00:00.000Z");
    expect(windowPace({ usedPct: 10, resetsAt: null, span: 5 * HOUR, now })).toBeNull();
    expect(
      windowPace({ usedPct: 10, resetsAt: "2026-10-22T10:00:00.000Z", span: null, now }),
    ).toBeNull();
    // 已经过了重置时间。
    expect(
      windowPace({ usedPct: 10, resetsAt: "2026-10-22T07:00:00.000Z", span: 5 * HOUR, now }),
    ).toBeNull();
    // 还没开始。
    expect(
      windowPace({ usedPct: 10, resetsAt: "2026-10-22T20:00:00.000Z", span: 5 * HOUR, now }),
    ).toBeNull();
  });
});
