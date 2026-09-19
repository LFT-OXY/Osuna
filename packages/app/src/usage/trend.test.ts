import type { UsageTrend, UsageTrendPoint } from "@getpaseo/protocol/usage/types";
import { describe, expect, it } from "vitest";
import type { UsageNow } from "./period";
import { buildUsageTrendSeries, formatUsageTrendKey } from "./trend";

const NOW: UsageNow = { day: "2026-09-19", hour: "2026-09-19T10" };

function point(key: string, groups: Record<string, number>): UsageTrendPoint {
  return {
    key,
    groups: Object.fromEntries(
      Object.entries(groups).map(([group, tokens]) => [
        group,
        {
          totals: { input: tokens, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 },
          estimatedCost: 0,
        },
      ]),
    ),
  };
}

function trend(
  granularity: UsageTrend["granularity"],
  points: UsageTrendPoint[],
  stackBy: UsageTrend["stackBy"] = "source",
): UsageTrend {
  return { granularity, stackBy, points };
}

describe("buildUsageTrendSeries", () => {
  it("fills the quiet days inside the range and stacks the biggest group first", () => {
    const series = buildUsageTrendSeries({
      trend: trend("day", [
        point("2026-09-15", { claude: 100, codex: 40 }),
        point("2026-09-17", { codex: 60 }),
      ]),
      range: { from: "2026-09-15", to: "2026-09-18" },
      now: NOW,
    });

    // Both groups total 100, so the tie falls back to the group name.
    expect(series.groups).toEqual(["claude", "codex"]);
    expect(series.max).toBe(140);
    expect(series.bars).toEqual([
      {
        key: "2026-09-15",
        segments: [
          { group: "claude", tokens: 100 },
          { group: "codex", tokens: 40 },
        ],
        total: 140,
        isFuture: false,
      },
      { key: "2026-09-16", segments: [], total: 0, isFuture: false },
      {
        key: "2026-09-17",
        segments: [{ group: "codex", tokens: 60 }],
        total: 60,
        isFuture: false,
      },
      { key: "2026-09-18", segments: [], total: 0, isFuture: false },
    ]);
  });

  it("marks the days after today as future", () => {
    const series = buildUsageTrendSeries({
      trend: trend("day", [point("2026-09-19", { claude: 10 })]),
      range: { from: "2026-09-18", to: "2026-09-21" },
      now: NOW,
    });

    expect(series.bars.map((bar) => [bar.key, bar.isFuture])).toEqual([
      ["2026-09-18", false],
      ["2026-09-19", false],
      ["2026-09-20", true],
      ["2026-09-21", true],
    ]);
  });

  it("draws a full day of hours and marks the ones still to come", () => {
    const series = buildUsageTrendSeries({
      trend: trend("hour", [point("2026-09-19T09", { claude: 25 })]),
      range: { from: "2026-09-19", to: "2026-09-19" },
      now: NOW,
    });

    expect(series.bars).toHaveLength(24);
    expect(series.bars[0]).toEqual({
      key: "2026-09-19T00",
      segments: [],
      total: 0,
      isFuture: false,
    });
    expect(series.bars[9]).toEqual({
      key: "2026-09-19T09",
      segments: [{ group: "claude", tokens: 25 }],
      total: 25,
      isFuture: false,
    });
    expect(series.bars.filter((bar) => bar.isFuture).map((bar) => bar.key)).toEqual([
      "2026-09-19T11",
      "2026-09-19T12",
      "2026-09-19T13",
      "2026-09-19T14",
      "2026-09-19T15",
      "2026-09-19T16",
      "2026-09-19T17",
      "2026-09-19T18",
      "2026-09-19T19",
      "2026-09-19T20",
      "2026-09-19T21",
      "2026-09-19T22",
      "2026-09-19T23",
    ]);
  });

  it("spans every day of a two-day hourly range", () => {
    const series = buildUsageTrendSeries({
      trend: trend("hour", [
        point("2026-09-18T20", { claude: 10 }),
        point("2026-09-19T08", { claude: 20 }),
      ]),
      range: { from: "2026-09-18", to: "2026-09-19" },
      now: NOW,
    });

    expect(series.bars).toHaveLength(48);
    expect(series.bars[0]?.key).toBe("2026-09-18T00");
    expect(series.bars[47]?.key).toBe("2026-09-19T23");
    expect(series.bars[20]).toEqual({
      key: "2026-09-18T20",
      segments: [{ group: "claude", tokens: 10 }],
      total: 10,
      isFuture: false,
    });
    expect(series.max).toBe(20);
  });

  it("runs an open range of months from the first month with usage to this one", () => {
    const series = buildUsageTrendSeries({
      trend: trend("month", [point("2026-07", { claude: 10 }), point("2026-09", { claude: 30 })]),
      range: { from: null, to: null },
      now: NOW,
    });

    expect(series.bars.map((bar) => bar.key)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(series.max).toBe(30);
  });

  it("crosses a year boundary by month", () => {
    const series = buildUsageTrendSeries({
      trend: trend("month", [point("2025-11", { claude: 10 })]),
      range: { from: "2025-11-01", to: "2026-01-31" },
      now: NOW,
    });

    expect(series.bars.map((bar) => bar.key)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("keeps the most recent bars when a range asks for more than the card can draw", () => {
    const series = buildUsageTrendSeries({
      trend: trend("month", []),
      range: { from: "1900-01-01", to: "2026-09-30" },
      now: NOW,
    });

    expect(series.bars).toHaveLength(372);
    expect(series.bars[series.bars.length - 1]?.key).toBe("2026-09");
  });

  it("falls back to an empty axis when nothing was ever recorded", () => {
    const series = buildUsageTrendSeries({
      trend: trend("month", []),
      range: { from: null, to: null },
      now: NOW,
    });

    expect(series.bars).toEqual([{ key: "2026-09", segments: [], total: 0, isFuture: false }]);
    expect(series.groups).toEqual([]);
    expect(series.max).toBe(1);
  });
});

describe("formatUsageTrendKey", () => {
  it("formats each granularity in the UI language", () => {
    expect(formatUsageTrendKey("2026-09-19T09", "hour", "en")).toBe("09:00");
    expect(formatUsageTrendKey("2026-09-19", "day", "en")).toBe("Sep 19, 2026");
    expect(formatUsageTrendKey("2026-09", "month", "en")).toBe("Sep 2026");
    expect(formatUsageTrendKey("2026-09", "month", "zh-CN")).toBe("2026年9月");
  });
});
