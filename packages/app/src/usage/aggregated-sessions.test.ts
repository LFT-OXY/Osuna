import type { UsageSessionRow } from "@osuna/protocol/usage/types";
import { describe, expect, it } from "vitest";
import {
  ALL_USAGE_SESSION_HOSTS_FAILED_MESSAGE,
  fetchUsageSessions,
  type UsageSessionsRuntime,
} from "./aggregated-sessions";

const DAY = "2026-09-18";

function session(sessionId: string, lastAt: string): UsageSessionRow {
  return {
    day: DAY,
    cli: "claude",
    backend: null,
    sessionId,
    cwd: "/work/demo",
    project: { rootPath: "/work/demo", displayName: "demo", kind: "git" },
    models: [],
    totals: { input: 1, cachedInput: 0, cacheWrite: 0, output: 1, reasoning: 0 },
    estimatedCost: 0,
    turns: 1,
    durationMs: 1000,
    firstAt: `${DAY}T09:00:00.000Z`,
    lastAt,
    handle: { providerId: "claude", providerHandleId: sessionId },
  };
}

interface FakeHost {
  serverId: string;
  connectionStatus: string;
  sessions?: UsageSessionRow[];
  truncated?: boolean;
  failure?: string;
}

function runtimeOf(hosts: readonly FakeHost[]): UsageSessionsRuntime {
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
        usageSessionsList: async () => {
          if (host.failure) throw new Error(host.failure);
          return {
            requestId: "req",
            sessions: host.sessions ?? [],
            truncated: host.truncated ?? false,
          };
        },
      };
    },
  };
}

function fetchFrom(hosts: readonly FakeHost[]) {
  return fetchUsageSessions({
    hosts: hosts.map((host) => ({ serverId: host.serverId, serverName: host.serverId })),
    runtime: runtimeOf(hosts),
    day: DAY,
    timezone: "Europe/Madrid",
  });
}

describe("fetchUsageSessions", () => {
  it("lists every connected host's sessions, newest first", async () => {
    const state = await fetchFrom([
      {
        serverId: "a",
        connectionStatus: "online",
        sessions: [session("old", `${DAY}T08:00:00.000Z`)],
      },
      {
        serverId: "b",
        connectionStatus: "online",
        sessions: [session("new", `${DAY}T10:00:00.000Z`)],
      },
    ]);

    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.sessions.map((row) => [row.serverId, row.sessionId])).toEqual([
      ["b", "new"],
      ["a", "old"],
    ]);
    expect(state.data.truncated).toBe(false);
    expect(state.hostErrors).toEqual([]);
  });

  it("reports the hosts that failed and still lists the rest", async () => {
    const state = await fetchFrom([
      {
        serverId: "a",
        connectionStatus: "online",
        sessions: [session("kept", `${DAY}T08:00:00.000Z`)],
      },
      { serverId: "b", connectionStatus: "online", failure: "socket closed" },
    ]);

    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.sessions.map((row) => row.sessionId)).toEqual(["kept"]);
    expect(state.hostErrors).toEqual([
      { serverId: "b", serverName: "b", message: "socket closed" },
    ]);
  });

  it("carries a host's truncation into the merged list", async () => {
    const state = await fetchFrom([
      { serverId: "a", connectionStatus: "online", sessions: [], truncated: false },
      {
        serverId: "b",
        connectionStatus: "online",
        sessions: [session("kept", `${DAY}T08:00:00.000Z`)],
        truncated: true,
      },
    ]);

    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.truncated).toBe(true);
  });

  it("throws when every asked host failed", async () => {
    await expect(
      fetchFrom([{ serverId: "a", connectionStatus: "online", failure: "socket closed" }]),
    ).rejects.toThrow(ALL_USAGE_SESSION_HOSTS_FAILED_MESSAGE);
  });

  it("stays connecting rather than reporting an empty day when no host can answer", async () => {
    expect(await fetchFrom([{ serverId: "a", connectionStatus: "offline" }])).toEqual({
      status: "connecting",
    });
    expect(await fetchFrom([])).toEqual({ status: "connecting" });
  });
});
