import { describe, expect, test } from "vitest";
import type { UsageCli } from "@getpaseo/protocol/usage/types";
import { buildUsageReport, type UsageReportPricing, type UsageReportRequest } from "./report.js";
import type { UsageProjectAttribution } from "./project-attribution.js";
import { emptyBucketRow, type UsageBucketRow } from "./types.js";

const NOW = Date.parse("2026-09-19T12:00:00.000Z");
const TODAY = "2026-09-19";

const PROJECTS = new Map<string, UsageProjectAttribution>([
  ["/work/demo", { rootPath: "/work/demo", displayName: "demo", kind: "git" }],
  ["/work/other/pkg", { rootPath: "/work/other", displayName: "other", kind: "non_git" }],
]);

function row(input: {
  bucket: string;
  model?: string;
  cwd?: string;
  sessionId?: string;
  output?: number;
  turns?: number;
  endpointId?: string;
}): UsageBucketRow {
  return {
    ...emptyBucketRow({
      cli: "claude",
      backend: null,
      model: input.model ?? "claude-opus-5",
      sessionId: input.sessionId ?? "sess-1",
      cwd: input.cwd ?? "/work/demo",
      bucket: input.bucket,
      endpointId: input.endpointId,
    }),
    output: input.output ?? 100,
    turns: input.turns ?? 0,
  };
}

/** One dollar per output token for Opus, nothing known about anything else. */
const PRICING: UsageReportPricing = {
  estimateCost: (totals, model) => (model === "claude-opus-5" ? totals.output : 0),
  isPriced: (model) => model === "claude-opus-5",
};

const UNPRICED: UsageReportPricing = {
  estimateCost: () => 0,
  isPriced: () => false,
};

function build(
  rows: UsageBucketRow[],
  request: UsageReportRequest,
  pricing: UsageReportPricing = UNPRICED,
  canonicalSessionId: (cli: UsageCli, sessionId: string) => string = (_cli, sessionId) => sessionId,
) {
  return buildUsageReport({
    rows,
    request,
    projects: PROJECTS,
    endpointNames: new Map([["ep_a", "Relay A"]]),
    pricing,
    canonicalSessionId,
    backfill: { state: "done", filesTotal: 0, filesDone: 0, startedAt: null },
    error: null,
    now: NOW,
  });
}

function outputs(totals: { output: number }): number {
  return totals.output;
}

describe("local day resolution", () => {
  const rows = [
    row({ bucket: "2026-09-18T18:00:00.000Z", output: 10, turns: 1 }),
    row({ bucket: "2026-09-18T20:00:00.000Z", output: 20, turns: 1 }),
  ];

  test("keeps both buckets on one UTC day", () => {
    const report = build(rows, { from: "2026-09-18", to: "2026-09-19", timezone: "UTC" });

    expect(report.days).toEqual([
      {
        day: "2026-09-18",
        totals: { input: 0, cachedInput: 0, cacheWrite: 0, output: 30, reasoning: 0 },
        estimatedCost: 0,
        sessionCount: 1,
        turns: 2,
      },
    ]);
  });

  test("splits them across two days at +05:30", () => {
    const report = build(rows, {
      from: "2026-09-18",
      to: "2026-09-19",
      timezone: "Asia/Kolkata",
    });

    expect(report.days).toEqual([
      {
        day: "2026-09-18",
        totals: { input: 0, cachedInput: 0, cacheWrite: 0, output: 10, reasoning: 0 },
        estimatedCost: 0,
        sessionCount: 1,
        turns: 1,
      },
      {
        day: "2026-09-19",
        totals: { input: 0, cachedInput: 0, cacheWrite: 0, output: 20, reasoning: 0 },
        estimatedCost: 0,
        sessionCount: 1,
        turns: 1,
      },
    ]);
  });
});

describe("trend granularity", () => {
  const rows = [row({ bucket: "2026-09-19T09:00:00.000Z" })];

  test.each([
    { from: null, to: null, expected: "month" },
    { from: TODAY, to: TODAY, expected: "hour" },
    { from: "2026-09-18", to: TODAY, expected: "hour" },
    { from: "2026-09-01", to: TODAY, expected: "day" },
    { from: "2026-01-01", to: TODAY, expected: "month" },
  ])("$from..$to defaults to $expected", ({ from, to, expected }) => {
    expect(build(rows, { from, to, timezone: "UTC" }).trend.granularity).toBe(expected);
  });

  test("an explicit granularity and stack wins", () => {
    const report = build(rows, {
      from: TODAY,
      to: TODAY,
      timezone: "UTC",
      trend: { granularity: "month", stackBy: "model" },
    });

    expect(report.trend).toEqual({
      granularity: "month",
      stackBy: "model",
      points: [
        {
          key: "2026-09",
          groups: {
            "claude-opus-5": {
              totals: { input: 0, cachedInput: 0, cacheWrite: 0, output: 100, reasoning: 0 },
              estimatedCost: 0,
            },
          },
        },
      ],
    });
  });
});

describe("windows that ignore the selected range", () => {
  const rows = [
    row({ bucket: "2026-09-19T09:00:00.000Z", output: 1 }),
    row({ bucket: "2026-09-09T09:00:00.000Z", output: 10 }),
    row({ bucket: "2026-01-09T09:00:00.000Z", output: 100 }),
  ];
  const request: UsageReportRequest = { from: TODAY, to: TODAY, timezone: "UTC" };

  test("the trailing windows count days outside from/to", () => {
    const report = build(rows, request);

    expect(outputs(report.summary.totals)).toBe(1);
    expect(outputs(report.summary.last7Days.totals)).toBe(1);
    expect(outputs(report.summary.last30Days.totals)).toBe(11);
  });

  test("the heatmap is always the same 182 days ending today", () => {
    const report = build(rows, request);

    expect(report.heatmapDays).toHaveLength(182);
    expect(report.heatmapDays[0]?.day).toBe("2026-03-22");
    expect(report.heatmapDays[181]).toEqual({
      day: TODAY,
      totals: { input: 0, cachedInput: 0, cacheWrite: 0, output: 1, reasoning: 0 },
    });
    // 2026-01-09 falls before the window and contributes nowhere.
    expect(report.heatmapDays.reduce((sum, entry) => sum + entry.totals.output, 0)).toBe(11);
  });
});

describe("filters", () => {
  const rows = [
    row({ bucket: "2026-09-19T09:00:00.000Z", model: "claude-opus-5", output: 1 }),
    row({ bucket: "2026-09-19T09:00:00.000Z", model: "claude-haiku-4-5", output: 2 }),
    row({ bucket: "2026-09-19T09:00:00.000Z", cwd: "/work/other/pkg", output: 4 }),
  ];
  const range = { from: TODAY, to: TODAY, timezone: "UTC" };

  test("a model filter narrows the totals", () => {
    const report = build(rows, { ...range, filters: { models: ["claude-haiku-4-5"] } });

    expect(outputs(report.summary.totals)).toBe(2);
    expect(report.models.map((entry) => entry.model)).toEqual(["claude-haiku-4-5"]);
  });

  test("a project filter matches the attributed root, not the cwd", () => {
    const report = build(rows, { ...range, filters: { projects: ["/work/other"] } });

    expect(report.projects).toEqual([
      {
        rootPath: "/work/other",
        displayName: "other",
        kind: "non_git",
        totals: { input: 0, cachedInput: 0, cacheWrite: 0, output: 4, reasoning: 0 },
        estimatedCost: 0,
        sources: [{ cli: "claude", backend: null }],
        cwds: [
          {
            cwd: "/work/other/pkg",
            totals: { input: 0, cachedInput: 0, cacheWrite: 0, output: 4, reasoning: 0 },
            estimatedCost: 0,
          },
        ],
      },
    ]);
  });
});

describe("estimated cost", () => {
  const rows = [
    row({ bucket: "2026-09-19T10:00:00.000Z", model: "claude-opus-5", output: 40, turns: 1 }),
    row({ bucket: "2026-09-19T10:00:00.000Z", model: "mystery-model", output: 25, turns: 1 }),
  ];

  test("sums the priced model and leaves the unknown one at zero", () => {
    const report = build(rows, { from: TODAY, to: TODAY, timezone: "UTC" }, PRICING);

    expect(report.summary.estimatedCost).toBe(40);
    expect(report.models).toEqual([
      {
        model: "claude-opus-5",
        cli: "claude",
        backend: null,
        totals: { input: 0, cachedInput: 0, cacheWrite: 0, output: 40, reasoning: 0 },
        estimatedCost: 40,
        priced: true,
      },
      {
        model: "mystery-model",
        cli: "claude",
        backend: null,
        totals: { input: 0, cachedInput: 0, cacheWrite: 0, output: 25, reasoning: 0 },
        estimatedCost: 0,
        priced: false,
      },
    ]);
    expect(report.days).toEqual([
      {
        day: TODAY,
        totals: { input: 0, cachedInput: 0, cacheWrite: 0, output: 65, reasoning: 0 },
        estimatedCost: 40,
        sessionCount: 1,
        turns: 2,
      },
    ]);
    expect(report.projects).toEqual([
      {
        rootPath: "/work/demo",
        displayName: "demo",
        kind: "git",
        totals: { input: 0, cachedInput: 0, cacheWrite: 0, output: 65, reasoning: 0 },
        estimatedCost: 40,
        sources: [{ cli: "claude", backend: null }],
        cwds: [
          {
            cwd: "/work/demo",
            totals: { input: 0, cachedInput: 0, cacheWrite: 0, output: 65, reasoning: 0 },
            estimatedCost: 40,
          },
        ],
      },
    ]);
  });
});

describe("by endpoint", () => {
  const range = { from: TODAY, to: TODAY, timezone: "UTC" };
  const rows = [
    // 走接口 A 的一次调用：会话记录里的轮次留在官方那行，token 在接口那行。
    row({ bucket: "2026-09-19T09:00:00.000Z", output: 0, turns: 1 }),
    row({ bucket: "2026-09-19T09:00:00.000Z", output: 30, endpointId: "ep_a" }),
    // 只在账本里的一次调用：没有会话、没有项目。
    row({
      bucket: "2026-09-19T09:00:00.000Z",
      output: 50,
      endpointId: "ep_a",
      sessionId: "",
      cwd: "",
    }),
    // 一家不知道名字的接口，和一次直连。
    row({ bucket: "2026-09-19T10:00:00.000Z", output: 15, endpointId: "ep_gone" }),
    row({ bucket: "2026-09-19T10:00:00.000Z", model: "claude-haiku-4-5", output: 5 }),
  ];

  test("one group per endpoint and one for Official, priced, with its share, largest first", () => {
    const report = build(rows, range, PRICING);
    const tokens = (output: number) => ({
      input: 0,
      cachedInput: 0,
      cacheWrite: 0,
      output,
      reasoning: 0,
    });

    expect(report.endpoints).toEqual([
      {
        endpointId: "ep_a",
        name: "Relay A",
        deleted: false,
        totals: tokens(80),
        estimatedCost: 80,
        share: 0.8,
      },
      {
        endpointId: "ep_gone",
        name: "ep_gone",
        deleted: false,
        totals: tokens(15),
        estimatedCost: 15,
        share: 0.15,
      },
      {
        endpointId: null,
        name: null,
        deleted: false,
        totals: tokens(5),
        estimatedCost: 0,
        share: 0.05,
      },
    ]);
    // 只在账本里的调用不算会话，也不归任何项目。
    expect(report.summary.sessionCount).toBe(1);
    expect(report.projects.map((project) => outputs(project.totals))).toEqual([50]);
  });

  test("the endpoint filter keeps one endpoint, or Official alone", () => {
    const onlyA = build(rows, { ...range, filters: { endpoints: ["ep_a"] } });
    expect(outputs(onlyA.summary.totals)).toBe(80);
    expect(onlyA.endpoints?.map((group) => group.endpointId)).toEqual(["ep_a"]);

    const official = build(rows, { ...range, filters: { endpoints: [null] } });
    expect(outputs(official.summary.totals)).toBe(5);
    // 调用都挪去接口后只剩轮次的那个模型不成一行。
    expect(official.models.map((entry) => entry.model)).toEqual(["claude-haiku-4-5"]);
    expect(official.days.map((day) => day.turns)).toEqual([1]);
  });
});
