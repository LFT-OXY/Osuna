import type {
  UsageHeatmapDay,
  UsageModelBreakdown,
  UsageSummary,
  UsageTokenTotals,
} from "@osuna/protocol/usage/types";
import { describe, expect, it } from "vitest";
import { deriveUsageStats } from "./stats";

const TODAY = "2026-09-19";

function totals(input: Partial<UsageTokenTotals>): UsageTokenTotals {
  return { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0, ...input };
}

function summary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    totals: totals({ input: 800, output: 200 }),
    estimatedCost: 1.5,
    sessionCount: 12,
    last7Days: { totals: totals({ input: 300, output: 100 }), estimatedCost: 0.5 },
    last30Days: { totals: totals({ input: 700, output: 200 }), estimatedCost: 1.2 },
    ...overrides,
  };
}

function model(name: string, tokens: number): UsageModelBreakdown {
  return {
    model: name,
    cli: "claude",
    backend: null,
    totals: totals({ input: tokens }),
    estimatedCost: 0,
    priced: true,
  };
}

function heatmapDay(day: string, tokens: number): UsageHeatmapDay {
  return { day, totals: totals({ input: tokens }) };
}

describe("deriveUsageStats", () => {
  it("reads the tiles, the top three models and the footer off one report", () => {
    const stats = deriveUsageStats({
      summary: summary(),
      models: [
        model("claude-opus-5", 500),
        model("claude-sonnet-5", 300),
        model("claude-haiku-4-5", 150),
        model("claude-fable-5-1", 50),
      ],
      heatmapDays: [
        heatmapDay("2026-09-16", 400),
        heatmapDay("2026-09-17", 0),
        heatmapDay("2026-09-18", 500),
        heatmapDay("2026-09-19", 100),
      ],
      today: TODAY,
    });

    expect(stats).toEqual({
      last7Days: 400,
      last30Days: 900,
      avgPerActiveDay: 300,
      sessionCount: 12,
      topModels: [
        { model: "claude-opus-5", tokens: 500, share: 0.5 },
        { model: "claude-sonnet-5", tokens: 300, share: 0.3 },
        { model: "claude-haiku-4-5", tokens: 150, share: 0.15 },
      ],
      firstActiveDay: "2026-09-16",
      activeDays: 3,
    });
  });

  it("counts only the last thirty days towards the average", () => {
    const stats = deriveUsageStats({
      summary: summary(),
      models: [],
      heatmapDays: [
        // Outside the window: it still counts as an active day in the footer.
        heatmapDay("2026-07-01", 999),
        heatmapDay("2026-08-21", 100),
        heatmapDay("2026-09-19", 100),
      ],
      today: TODAY,
    });

    expect(stats.avgPerActiveDay).toBe(450);
    expect(stats.activeDays).toBe(3);
    expect(stats.firstActiveDay).toBe("2026-07-01");
  });

  it("reports zeroes and no first day when nothing was used", () => {
    const stats = deriveUsageStats({
      summary: summary({
        totals: totals({}),
        sessionCount: 0,
        last7Days: { totals: totals({}), estimatedCost: 0 },
        last30Days: { totals: totals({}), estimatedCost: 0 },
      }),
      models: [],
      heatmapDays: [heatmapDay("2026-09-18", 0), heatmapDay("2026-09-19", 0)],
      today: TODAY,
    });

    expect(stats).toEqual({
      last7Days: 0,
      last30Days: 0,
      avgPerActiveDay: 0,
      sessionCount: 0,
      topModels: [],
      firstActiveDay: null,
      activeDays: 0,
    });
  });

  it("gives every model a zero share when the period holds no tokens", () => {
    const stats = deriveUsageStats({
      summary: summary({ totals: totals({}) }),
      models: [model("claude-opus-5", 0)],
      heatmapDays: [],
      today: TODAY,
    });

    expect(stats.topModels).toEqual([{ model: "claude-opus-5", tokens: 0, share: 0 }]);
  });
});
