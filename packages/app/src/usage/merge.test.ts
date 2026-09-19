import type { UsageReport, UsageTokenTotals } from "@getpaseo/protocol/usage/types";
import { describe, expect, it } from "vitest";
import { mergeUsageBackfill, mergeUsageReports } from "./merge";

function totals(input: number, output: number): UsageTokenTotals {
  return { input, cachedInput: 0, cacheWrite: 0, output, reasoning: 0 };
}

function report(overrides: Partial<UsageReport>): UsageReport {
  return {
    summary: {
      totals: totals(0, 0),
      estimatedCost: 0,
      sessionCount: 0,
      last7Days: { totals: totals(0, 0), estimatedCost: 0 },
      last30Days: { totals: totals(0, 0), estimatedCost: 0 },
    },
    sources: [],
    models: [],
    trend: { granularity: "day", stackBy: "source", points: [] },
    days: [],
    months: [],
    heatmapDays: [],
    projects: [],
    backfill: { state: "idle", filesTotal: 0, filesDone: 0, startedAt: null },
    error: null,
    ...overrides,
  };
}

const HOST_A = report({
  summary: {
    totals: totals(100, 10),
    estimatedCost: 1,
    sessionCount: 2,
    last7Days: { totals: totals(50, 5), estimatedCost: 0.5 },
    last30Days: { totals: totals(90, 9), estimatedCost: 0.9 },
  },
  sources: [
    {
      cli: "claude",
      backend: null,
      totals: totals(100, 10),
      estimatedCost: 1,
      modelCount: 1,
      share: 1,
    },
  ],
  models: [
    {
      model: "claude-opus-5",
      cli: "claude",
      backend: null,
      totals: totals(100, 10),
      estimatedCost: 1,
      priced: true,
    },
  ],
  trend: {
    granularity: "day",
    stackBy: "source",
    points: [
      { key: "2026-09-18", groups: { claude: { totals: totals(100, 10), estimatedCost: 1 } } },
    ],
  },
  days: [
    { day: "2026-09-18", totals: totals(100, 10), estimatedCost: 1, sessionCount: 2, turns: 4 },
  ],
  months: [
    { month: "2026-09", totals: totals(100, 10), estimatedCost: 1, sessionCount: 2, turns: 4 },
  ],
  heatmapDays: [{ day: "2026-09-18", totals: totals(100, 10) }],
  projects: [
    {
      rootPath: "/work/osuna",
      displayName: "osuna",
      kind: "git",
      totals: totals(100, 10),
      estimatedCost: 1,
      cwds: [{ cwd: "/work/osuna", totals: totals(100, 10), estimatedCost: 1 }],
    },
  ],
  backfill: { state: "running", filesTotal: 10, filesDone: 4, startedAt: "2026-09-19T01:00:00Z" },
});

const HOST_B = report({
  summary: {
    totals: totals(200, 20),
    estimatedCost: 2,
    sessionCount: 3,
    last7Days: { totals: totals(60, 6), estimatedCost: 0.6 },
    last30Days: { totals: totals(180, 18), estimatedCost: 1.8 },
  },
  sources: [
    {
      cli: "claude",
      backend: null,
      totals: totals(120, 12),
      estimatedCost: 1.2,
      modelCount: 1,
      share: 0.6,
    },
    {
      cli: "pi",
      backend: "anthropic",
      totals: totals(80, 8),
      estimatedCost: 0.8,
      modelCount: 1,
      share: 0.4,
    },
  ],
  models: [
    {
      model: "claude-opus-5",
      cli: "claude",
      backend: null,
      totals: totals(120, 12),
      estimatedCost: 1.2,
      priced: true,
    },
    {
      model: "qwen3-coder",
      cli: "pi",
      backend: "anthropic",
      totals: totals(80, 8),
      estimatedCost: 0,
      priced: false,
    },
  ],
  trend: {
    granularity: "day",
    stackBy: "source",
    points: [
      { key: "2026-09-18", groups: { claude: { totals: totals(120, 12), estimatedCost: 1.2 } } },
      {
        key: "2026-09-17",
        groups: { "pi:anthropic": { totals: totals(80, 8), estimatedCost: 0.8 } },
      },
    ],
  },
  days: [
    { day: "2026-09-18", totals: totals(120, 12), estimatedCost: 1.2, sessionCount: 2, turns: 5 },
    { day: "2026-09-17", totals: totals(80, 8), estimatedCost: 0.8, sessionCount: 1, turns: 1 },
  ],
  months: [
    { month: "2026-09", totals: totals(200, 20), estimatedCost: 2, sessionCount: 3, turns: 6 },
  ],
  heatmapDays: [
    { day: "2026-09-18", totals: totals(120, 12) },
    { day: "2026-09-17", totals: totals(80, 8) },
  ],
  projects: [
    {
      rootPath: "/work/osuna",
      displayName: "osuna",
      kind: "git",
      totals: totals(200, 20),
      estimatedCost: 2,
      cwds: [{ cwd: "/work/osuna", totals: totals(200, 20), estimatedCost: 2 }],
    },
  ],
  backfill: { state: "done", filesTotal: 6, filesDone: 6, startedAt: "2026-09-19T00:30:00Z" },
});

describe("mergeUsageReports", () => {
  it("returns an empty report for no hosts", () => {
    expect(mergeUsageReports([])).toEqual({
      summary: {
        totals: totals(0, 0),
        estimatedCost: 0,
        sessionCount: 0,
        last7Days: { totals: totals(0, 0), estimatedCost: 0 },
        last30Days: { totals: totals(0, 0), estimatedCost: 0 },
      },
      sources: [],
      models: [],
      trend: { granularity: "day", stackBy: "source", points: [] },
      days: [],
      months: [],
      heatmapDays: [],
      projects: [],
      backfill: { state: "idle", filesTotal: 0, filesDone: 0, startedAt: null },
      error: null,
    });
  });

  it("adds two hosts into one report and keeps projects apart", () => {
    expect(
      mergeUsageReports([
        { serverId: "a", report: HOST_A },
        { serverId: "b", report: HOST_B },
      ]),
    ).toEqual({
      summary: {
        totals: totals(300, 30),
        estimatedCost: 3,
        sessionCount: 5,
        last7Days: { totals: totals(110, 11), estimatedCost: 1.1 },
        last30Days: { totals: totals(270, 27), estimatedCost: 2.7 },
      },
      sources: [
        {
          cli: "claude",
          backend: null,
          totals: totals(220, 22),
          estimatedCost: 2.2,
          modelCount: 1,
          share: 242 / 330,
        },
        {
          cli: "pi",
          backend: "anthropic",
          totals: totals(80, 8),
          estimatedCost: 0.8,
          modelCount: 1,
          share: 88 / 330,
        },
      ],
      models: [
        {
          model: "claude-opus-5",
          cli: "claude",
          backend: null,
          totals: totals(220, 22),
          estimatedCost: 2.2,
          priced: true,
        },
        {
          model: "qwen3-coder",
          cli: "pi",
          backend: "anthropic",
          totals: totals(80, 8),
          estimatedCost: 0,
          priced: false,
        },
      ],
      trend: {
        granularity: "day",
        stackBy: "source",
        points: [
          {
            key: "2026-09-17",
            groups: { "pi:anthropic": { totals: totals(80, 8), estimatedCost: 0.8 } },
          },
          {
            key: "2026-09-18",
            groups: { claude: { totals: totals(220, 22), estimatedCost: 2.2 } },
          },
        ],
      },
      days: [
        { day: "2026-09-17", totals: totals(80, 8), estimatedCost: 0.8, sessionCount: 1, turns: 1 },
        {
          day: "2026-09-18",
          totals: totals(220, 22),
          estimatedCost: 2.2,
          sessionCount: 4,
          turns: 9,
        },
      ],
      months: [
        {
          month: "2026-09",
          totals: totals(300, 30),
          estimatedCost: 3,
          sessionCount: 5,
          turns: 10,
        },
      ],
      heatmapDays: [
        { day: "2026-09-17", totals: totals(80, 8) },
        { day: "2026-09-18", totals: totals(220, 22) },
      ],
      projects: [
        {
          rootPath: "/work/osuna",
          displayName: "osuna",
          kind: "git",
          totals: totals(200, 20),
          estimatedCost: 2,
          cwds: [{ cwd: "/work/osuna", totals: totals(200, 20), estimatedCost: 2 }],
          serverId: "b",
        },
        {
          rootPath: "/work/osuna",
          displayName: "osuna",
          kind: "git",
          totals: totals(100, 10),
          estimatedCost: 1,
          cwds: [{ cwd: "/work/osuna", totals: totals(100, 10), estimatedCost: 1 }],
          serverId: "a",
        },
      ],
      backfill: {
        state: "running",
        filesTotal: 16,
        filesDone: 10,
        startedAt: "2026-09-19T00:30:00Z",
      },
      error: null,
    });
  });

  it("keeps a model unpriced when any host could not price it", () => {
    const priced = report({
      models: [
        {
          model: "gpt-5.3",
          cli: "codex",
          backend: null,
          totals: totals(10, 1),
          estimatedCost: 0.5,
          priced: true,
        },
      ],
    });
    const unpriced = report({
      models: [
        {
          model: "gpt-5.3",
          cli: "codex",
          backend: null,
          totals: totals(20, 2),
          estimatedCost: 0,
          priced: false,
        },
      ],
    });

    expect(
      mergeUsageReports([
        { serverId: "a", report: priced },
        { serverId: "b", report: unpriced },
      ]).models,
    ).toEqual([
      {
        model: "gpt-5.3",
        cli: "codex",
        backend: null,
        totals: totals(30, 3),
        estimatedCost: 0.5,
        priced: false,
      },
    ]);
  });
});

describe("mergeUsageBackfill", () => {
  it("stays running while one host still reads files", () => {
    expect(
      mergeUsageBackfill([
        { state: "done", filesTotal: 4, filesDone: 4, startedAt: "2026-09-19T00:00:00Z" },
        { state: "running", filesTotal: 6, filesDone: 1, startedAt: "2026-09-19T01:00:00Z" },
      ]),
    ).toEqual({
      state: "running",
      filesTotal: 10,
      filesDone: 5,
      startedAt: "2026-09-19T00:00:00Z",
    });
  });

  it("is idle only when no host has started", () => {
    expect(
      mergeUsageBackfill([{ state: "idle", filesTotal: 0, filesDone: 0, startedAt: null }]),
    ).toEqual({ state: "idle", filesTotal: 0, filesDone: 0, startedAt: null });
  });
});
