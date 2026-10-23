import type {
  UsageEndpointBreakdown,
  UsageReport,
  UsageTokenTotals,
} from "@getpaseo/protocol/usage/types";
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
      sources: [{ cli: "claude", backend: null }],
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
      sources: [{ cli: "codex", backend: null }],
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
          sources: [{ cli: "codex", backend: null }],
          cwds: [{ cwd: "/work/osuna", totals: totals(200, 20), estimatedCost: 2 }],
          serverId: "b",
        },
        {
          rootPath: "/work/osuna",
          displayName: "osuna",
          kind: "git",
          totals: totals(100, 10),
          estimatedCost: 1,
          sources: [{ cli: "claude", backend: null }],
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

function memberId(member: { endpointId: string | null }): string | null {
  return member.endpointId;
}

describe("mergeUsageReports endpoints", () => {
  const group = (
    endpointId: string | null,
    name: string | null,
    input: number,
    deleted = false,
  ): UsageEndpointBreakdown => ({
    endpointId,
    name,
    deleted,
    totals: totals(input, 0),
    estimatedCost: input / 100,
    share: 1,
  });

  it("adds Official across hosts and keeps each endpoint, sharing over the sum", () => {
    const merged = mergeUsageReports([
      {
        serverId: "a",
        report: report({ endpoints: [group("ep_a", "Relay A", 30), group(null, null, 10)] }),
      },
      { serverId: "b", report: report({ endpoints: [group(null, null, 60)] }) },
    ]);

    expect(merged.endpoints).toEqual([
      {
        key: null,
        name: null,
        deleted: false,
        totals: totals(70, 0),
        estimatedCost: 0.7,
        share: 0.7,
        members: [
          { serverId: "a", endpointId: null },
          { serverId: "b", endpointId: null },
        ],
      },
      {
        key: "live:Relay A:0",
        name: "Relay A",
        deleted: false,
        totals: totals(30, 0),
        estimatedCost: 0.3,
        share: 0.3,
        members: [{ serverId: "a", endpointId: "ep_a" }],
      },
    ]);
  });

  it("puts endpoints of one name on different hosts on one card", () => {
    const merged = mergeUsageReports([
      { serverId: "a", report: report({ endpoints: [group("ep_a", "Relay", 30)] }) },
      { serverId: "b", report: report({ endpoints: [group("ep_b", "Relay", 10)] }) },
    ]);

    expect(merged.endpoints).toEqual([
      {
        key: "live:Relay:0",
        name: "Relay",
        deleted: false,
        totals: totals(40, 0),
        estimatedCost: 0.4,
        share: 1,
        members: [
          { serverId: "a", endpointId: "ep_a" },
          { serverId: "b", endpointId: "ep_b" },
        ],
      },
    ]);
  });

  it("keeps two endpoints of one name on the same host apart, and a deleted one apart from a live one", () => {
    const merged = mergeUsageReports([
      {
        serverId: "a",
        report: report({
          endpoints: [
            group("ep_1", "Relay", 30),
            group("ep_2", "Relay", 20),
            group("ep_3", "Relay", 10, true),
          ],
        }),
      },
      { serverId: "b", report: report({ endpoints: [group("ep_4", "Relay", 40)] }) },
    ]);

    expect(
      merged.endpoints?.map((endpoint) => [
        endpoint.key,
        endpoint.deleted,
        endpoint.members.map(memberId),
      ]),
    ).toEqual([
      ["live:Relay:0", false, ["ep_1", "ep_4"]],
      ["live:Relay:1", false, ["ep_2"]],
      ["deleted:Relay:0", true, ["ep_3"]],
    ]);
  });

  it("has no endpoints when no host reports them", () => {
    const merged = mergeUsageReports([{ serverId: "a", report: report({}) }]);
    expect(merged.endpoints).toBeUndefined();
  });
});
