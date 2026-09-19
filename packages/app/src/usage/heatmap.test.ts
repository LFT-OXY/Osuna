import type { UsageHeatmapDay, UsageTokenTotals } from "@getpaseo/protocol/usage/types";
import { describe, expect, it } from "vitest";
import { buildUsageHeatmap, formatUsageMonthLabel, usageHeatmapWeekdayLabels } from "./heatmap";

/** A Saturday, so the last column stops six days in. */
const TODAY = "2026-09-19";

function day(dayString: string, tokens: number): UsageHeatmapDay {
  const totals: UsageTokenTotals = {
    input: tokens,
    cachedInput: 0,
    cacheWrite: 0,
    output: 0,
    reasoning: 0,
  };
  return { day: dayString, totals };
}

describe("buildUsageHeatmap", () => {
  it("lays weeks out as Monday-first columns and grades the days that had usage", () => {
    const matrix = buildUsageHeatmap({
      days: [
        day("2026-09-08", 10),
        day("2026-09-10", 20),
        day("2026-09-12", 30),
        day("2026-09-15", 40),
        day("2026-09-18", 50),
      ],
      weeks: 2,
      today: TODAY,
    });

    expect(matrix.startDay).toBe("2026-09-07");
    expect(matrix.weeks).toBe(2);
    expect(matrix.monthLabels).toEqual([{ week: 0, month: "2026-09" }]);
    expect(matrix.cells).toEqual([
      { day: "2026-09-07", tokens: 0, level: 0, week: 0, weekday: 0 },
      { day: "2026-09-08", tokens: 10, level: 1, week: 0, weekday: 1 },
      { day: "2026-09-09", tokens: 0, level: 0, week: 0, weekday: 2 },
      { day: "2026-09-10", tokens: 20, level: 2, week: 0, weekday: 3 },
      { day: "2026-09-11", tokens: 0, level: 0, week: 0, weekday: 4 },
      { day: "2026-09-12", tokens: 30, level: 3, week: 0, weekday: 5 },
      { day: "2026-09-13", tokens: 0, level: 0, week: 0, weekday: 6 },
      { day: "2026-09-14", tokens: 0, level: 0, week: 1, weekday: 0 },
      { day: "2026-09-15", tokens: 40, level: 4, week: 1, weekday: 1 },
      { day: "2026-09-16", tokens: 0, level: 0, week: 1, weekday: 2 },
      { day: "2026-09-17", tokens: 0, level: 0, week: 1, weekday: 3 },
      { day: "2026-09-18", tokens: 50, level: 4, week: 1, weekday: 4 },
      { day: "2026-09-19", tokens: 0, level: 0, week: 1, weekday: 5 },
    ]);
  });

  it("labels a column whose Monday opens a new month", () => {
    const matrix = buildUsageHeatmap({ days: [], weeks: 3, today: "2026-10-05" });

    expect(matrix.startDay).toBe("2026-09-21");
    expect(matrix.monthLabels).toEqual([
      { week: 0, month: "2026-09" },
      { week: 2, month: "2026-10" },
    ]);
    expect(matrix.cells).toHaveLength(15);
  });

  it("puts every day at level 4 when a single day carries all the usage", () => {
    const matrix = buildUsageHeatmap({
      days: [day("2026-09-18", 1_000)],
      weeks: 1,
      today: TODAY,
    });

    expect(matrix.cells.map((cell) => cell.level)).toEqual([0, 0, 0, 0, 4, 0]);
  });

  it("treats a day the report never mentions as zero", () => {
    const matrix = buildUsageHeatmap({ days: [], weeks: 1, today: TODAY });

    expect(matrix.cells).toEqual([
      { day: "2026-09-14", tokens: 0, level: 0, week: 0, weekday: 0 },
      { day: "2026-09-15", tokens: 0, level: 0, week: 0, weekday: 1 },
      { day: "2026-09-16", tokens: 0, level: 0, week: 0, weekday: 2 },
      { day: "2026-09-17", tokens: 0, level: 0, week: 0, weekday: 3 },
      { day: "2026-09-18", tokens: 0, level: 0, week: 0, weekday: 4 },
      { day: "2026-09-19", tokens: 0, level: 0, week: 0, weekday: 5 },
    ]);
  });
});

describe("usageHeatmapWeekdayLabels", () => {
  it("starts on Monday in the UI language", () => {
    expect(usageHeatmapWeekdayLabels("en")).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    expect(usageHeatmapWeekdayLabels("zh-CN")).toEqual(["一", "二", "三", "四", "五", "六", "日"]);
  });
});

describe("formatUsageMonthLabel", () => {
  it("follows the UI language", () => {
    expect(formatUsageMonthLabel("2026-09", "en")).toBe("Sep");
    expect(formatUsageMonthLabel("2026-09", "zh-CN")).toBe("9月");
  });
});
