import type { UsageReport, UsageTokenTotals } from "@osuna/protocol/usage/types";
import { describe, expect, it } from "vitest";
import {
  ALL_USAGE_HOSTS_FAILED_MESSAGE,
  fetchUsageReport,
  type UsageRuntime,
} from "./aggregated-usage";
import { totalUsageTokens } from "./totals";

function totals(input: number): UsageTokenTotals {
  return { input, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 };
}

function report(input: number): UsageReport {
  return {
    summary: {
      totals: totals(input),
      estimatedCost: 0,
      sessionCount: 1,
      last7Days: { totals: totals(input), estimatedCost: 0 },
      last30Days: { totals: totals(input), estimatedCost: 0 },
    },
    sources: [],
    models: [],
    trend: { granularity: "day", stackBy: "source", points: [] },
    days: [],
    months: [],
    heatmapDays: [],
    projects: [],
    backfill: { state: "done", filesTotal: 1, filesDone: 1, startedAt: null },
    error: null,
  };
}

interface FakeHost {
  serverId: string;
  connectionStatus: string;
  answer?: number;
  failure?: string;
}

function runtimeOf(hosts: readonly FakeHost[]): UsageRuntime {
  const byId = new Map(hosts.map((host) => [host.serverId, host] as const));
  return {
    getSnapshot: (serverId) => {
      const host = byId.get(serverId);
      return host ? { connectionStatus: host.connectionStatus } : null;
    },
    getClient: (serverId) => {
      const host = byId.get(serverId);
      if (!host || host.connectionStatus !== "online") return null;
      return {
        usageReportGet: async () => {
          if (host.failure) throw new Error(host.failure);
          return { ...report(host.answer ?? 0), requestId: "req" };
        },
      };
    },
  };
}

const RANGE = { from: "2026-09-01", to: "2026-09-30" };

function fetchFrom(hosts: readonly FakeHost[]) {
  return fetchUsageReport({
    hosts: hosts.map((host) => ({ serverId: host.serverId, serverName: host.serverId })),
    runtime: runtimeOf(hosts),
    range: RANGE,
    timezone: "Europe/Madrid",
  });
}

describe("fetchUsageReport", () => {
  it("adds every connected host into one report", async () => {
    const state = await fetchFrom([
      { serverId: "a", connectionStatus: "online", answer: 100 },
      { serverId: "b", connectionStatus: "online", answer: 20 },
    ]);

    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(totalUsageTokens(state.data.summary.totals)).toBe(120);
    expect(state.data.summary.sessionCount).toBe(2);
    expect(state.hostErrors).toEqual([]);
  });

  it("reports the hosts that failed and still totals the rest", async () => {
    const state = await fetchFrom([
      { serverId: "a", connectionStatus: "online", answer: 100 },
      { serverId: "b", connectionStatus: "online", failure: "socket closed" },
    ]);

    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(totalUsageTokens(state.data.summary.totals)).toBe(100);
    expect(state.hostErrors).toEqual([
      { serverId: "b", serverName: "b", message: "socket closed" },
    ]);
  });

  it("throws when every asked host failed", async () => {
    await expect(
      fetchFrom([{ serverId: "a", connectionStatus: "online", failure: "socket closed" }]),
    ).rejects.toThrow(ALL_USAGE_HOSTS_FAILED_MESSAGE);
  });

  it("skips a host that is not online", async () => {
    const state = await fetchFrom([
      { serverId: "a", connectionStatus: "online", answer: 7 },
      { serverId: "b", connectionStatus: "offline", answer: 900 },
    ]);

    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(totalUsageTokens(state.data.summary.totals)).toBe(7);
  });

  it("stays connecting rather than reporting zero when no host can answer", async () => {
    expect(await fetchFrom([{ serverId: "a", connectionStatus: "offline" }])).toEqual({
      status: "connecting",
    });
    expect(await fetchFrom([])).toEqual({ status: "connecting" });
  });
});
