import type { UsageSessionRow, UsageTokenTotals } from "@osuna/protocol/usage/types";
import { describe, expect, it } from "vitest";
import { mergeUsageSessions, usageSessionKey } from "./sessions";

function totals(output: number): UsageTokenTotals {
  return { input: 0, cachedInput: 0, cacheWrite: 0, output, reasoning: 0 };
}

function session(overrides: Partial<UsageSessionRow> & Pick<UsageSessionRow, "sessionId">) {
  return {
    day: "2026-09-18",
    cli: "claude" as const,
    backend: null,
    cwd: "/work/demo",
    project: { rootPath: "/work/demo", displayName: "demo", kind: "git" as const },
    models: [],
    totals: totals(1),
    estimatedCost: 0,
    turns: 1,
    durationMs: 1000,
    firstAt: "2026-09-18T09:00:00.000Z",
    lastAt: "2026-09-18T09:00:10.000Z",
    handle: { providerId: "claude", providerHandleId: overrides.sessionId },
    ...overrides,
  } satisfies UsageSessionRow;
}

describe("mergeUsageSessions", () => {
  it("lists every host's rows newest first and keeps the host on each row", () => {
    const merged = mergeUsageSessions([
      {
        serverId: "host-a",
        sessions: [session({ sessionId: "older", lastAt: "2026-09-18T08:00:00.000Z" })],
        truncated: false,
      },
      {
        serverId: "host-b",
        sessions: [session({ sessionId: "newer", lastAt: "2026-09-18T10:00:00.000Z" })],
        truncated: false,
      },
    ]);

    expect(merged.sessions.map((row) => [row.serverId, row.sessionId, row.key])).toEqual([
      ["host-b", "newer", "host-b:claude:newer:2026-09-18"],
      ["host-a", "older", "host-a:claude:older:2026-09-18"],
    ]);
    expect(merged.truncated).toBe(false);
  });

  it("two hosts holding the same session id keep two rows", () => {
    const merged = mergeUsageSessions([
      { serverId: "host-a", sessions: [session({ sessionId: "sess-1" })], truncated: false },
      { serverId: "host-b", sessions: [session({ sessionId: "sess-1" })], truncated: false },
    ]);

    expect(merged.sessions.map((row) => row.key)).toEqual([
      "host-a:claude:sess-1:2026-09-18",
      "host-b:claude:sess-1:2026-09-18",
    ]);
  });

  it("one host leaving rows out truncates the merged list", () => {
    const merged = mergeUsageSessions([
      { serverId: "host-a", sessions: [], truncated: false },
      { serverId: "host-b", sessions: [session({ sessionId: "sess-1" })], truncated: true },
    ]);

    expect(merged.truncated).toBe(true);
  });

  it("keys a row by host, session and day", () => {
    expect(usageSessionKey("host-a", session({ sessionId: "sess-1", day: "2026-09-19" }))).toBe(
      "host-a:claude:sess-1:2026-09-19",
    );
  });
});
