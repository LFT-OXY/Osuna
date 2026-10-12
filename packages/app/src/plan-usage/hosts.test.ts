import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { UsageHost, UsageQueryState } from "@/usage/model";
import type { UsageReportEntry } from "@/usage/types";
import { resolvePlanUsageHosts } from "./hosts";

function report(id: string, fetchedAt: string): UsageReportEntry {
  return {
    id,
    sourceId: "claude",
    sourceLabel: "Claude",
    account: {},
    fetchedAt,
    report: { status: "available", windows: [] },
  };
}

const REPORTS = [report("claude:work", "2026-06-19T09:00:00.000Z")];

function host(overrides: Partial<UsageHost> = {}): UsageHost {
  return {
    serverId: "laptop",
    label: "Laptop",
    isConnected: true,
    supportsUsage: true,
    ...overrides,
  };
}

function query(overrides: Partial<UsageQueryState> = {}): UsageQueryState {
  return { data: undefined, error: null, isFetching: false, ...overrides };
}

// 页面上只筛出一台主机时卡片看到的状态。
function resolveOne(input: { host?: Partial<UsageHost>; query?: Partial<UsageQueryState> }) {
  const usageHost = host(input.host);
  return resolvePlanUsageHosts({
    hosts: [{ serverId: usageHost.serverId, serverName: usageHost.label }],
    usageHosts: [usageHost],
    queries: [query(input.query)],
  }).groups[0]?.view;
}

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.init();
  }
  await i18n.changeLanguage("en");
});

describe("the plan usage card's state for each host on the usage page", () => {
  it("asks for a connection before it asks for an update", () => {
    // 未连接的主机没有 server_info，能不能报套餐用量读出来也是 false；先说
    // 「这台机器太旧」是一个还给不出的判断。
    expect(resolveOne({ host: { isConnected: false, supportsUsage: false } })).toEqual({
      kind: "unavailable",
      message: "Connect to Laptop to see plan usage",
    });
    expect(resolveOne({ host: { supportsUsage: false } })).toEqual({
      kind: "unavailable",
      message: "Update Laptop to see plan usage",
    });
  });

  it("stays ready while a refresh is in flight, and says so", () => {
    expect(resolveOne({ query: { data: REPORTS, isFetching: true } })).toEqual({
      kind: "ready",
      reports: REPORTS,
      isRefreshing: true,
    });
    expect(resolveOne({ query: { data: REPORTS } })).toEqual({
      kind: "ready",
      reports: REPORTS,
      isRefreshing: false,
    });
  });

  it("keeps the last answer rather than dropping to an error on a failed refetch", () => {
    expect(resolveOne({ query: { data: REPORTS, error: new Error("boom") } })).toEqual({
      kind: "ready",
      reports: REPORTS,
      isRefreshing: false,
    });
  });

  it("passes a failure through as its own words", () => {
    expect(resolveOne({ query: { error: new Error("socket closed") } })).toEqual({
      kind: "error",
      message: "socket closed",
    });
  });

  it("is loading before the first answer arrives", () => {
    expect(resolveOne({})).toEqual({ kind: "loading" });
  });

  it("treats a host the app no longer knows as disconnected", () => {
    const resolved = resolvePlanUsageHosts({
      hosts: [{ serverId: "gone", serverName: "Old desktop" }],
      usageHosts: [],
      queries: [undefined],
    });
    expect(resolved.groups).toEqual([
      {
        serverId: "gone",
        serverName: "Old desktop",
        view: { kind: "unavailable", message: "Connect to Old desktop to see plan usage" },
      },
    ]);
  });
});

describe("the plan usage card across the hosts the page counts", () => {
  const laptop = host();
  const desktop = host({ serverId: "desktop", label: "Desktop" });
  const offline = host({ serverId: "offline", label: "Offline", isConnected: false });
  const hosts = [
    { serverId: "desktop", serverName: "Desktop" },
    { serverId: "laptop", serverName: "Laptop" },
    { serverId: "offline", serverName: "Offline" },
  ];
  const usageHosts = [laptop, offline, desktop];

  it("groups by host in the page's order, each under the page's name for it", () => {
    const resolved = resolvePlanUsageHosts({
      hosts,
      usageHosts,
      queries: [query({ data: REPORTS }), query(), undefined],
    });
    expect(resolved.groups.map((group) => [group.serverName, group.view.kind])).toEqual([
      ["Desktop", "ready"],
      ["Laptop", "loading"],
      ["Offline", "unavailable"],
    ]);
  });

  it("dates the card by the newest report on any host", () => {
    const resolved = resolvePlanUsageHosts({
      hosts,
      usageHosts,
      queries: [
        query({ data: [report("claude:work", "2026-06-19T09:00:00.000Z")] }),
        query({
          data: [
            report("claude:home", "2026-06-19T09:05:00.000Z"),
            report("codex:home", "2026-06-19T08:00:00.000Z"),
          ],
        }),
        undefined,
      ],
    });
    expect(resolved.fetchedAt).toBe("2026-06-19T09:05:00.000Z");
  });

  it("has no date before any host has answered", () => {
    const resolved = resolvePlanUsageHosts({
      hosts,
      usageHosts,
      queries: [query(), query({ data: [] }), undefined],
    });
    expect(resolved.fetchedAt).toBeNull();
  });

  it("is busy while any host is fetching", () => {
    const idle = [query({ data: REPORTS }), query({ data: REPORTS }), undefined];
    const fetching = [query({ data: REPORTS }), query({ isFetching: true }), undefined];
    expect(resolvePlanUsageHosts({ hosts, usageHosts, queries: idle }).isBusy).toBe(false);
    expect(resolvePlanUsageHosts({ hosts, usageHosts, queries: fetching }).isBusy).toBe(true);
  });
});
