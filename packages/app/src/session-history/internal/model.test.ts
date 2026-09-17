import { describe, expect, it } from "vitest";
import type { FetchRecentProviderSessionEntry } from "@getpaseo/client/internal/daemon-client";
import {
  buildResumeTerminalLaunch,
  buildSessionHistoryQueryKey,
  buildSessionHistoryRows,
  resolveSessionHistoryTitle,
} from "./model";

function entry(
  overrides: Partial<FetchRecentProviderSessionEntry>,
): FetchRecentProviderSessionEntry {
  return {
    providerId: "claude",
    providerLabel: "Claude Code",
    providerHandleId: "handle-1",
    cwd: "/repo/app",
    title: null,
    firstPromptPreview: null,
    lastPromptPreview: null,
    lastActivityAt: "2026-09-17T10:00:00.000Z",
    ...overrides,
  };
}

describe("resolveSessionHistoryTitle", () => {
  it("falls back from title to first prompt to provider label", () => {
    expect(resolveSessionHistoryTitle(entry({ title: " Fix login " }))).toBe("Fix login");
    expect(resolveSessionHistoryTitle(entry({ firstPromptPreview: "add tests" }))).toBe(
      "add tests",
    );
    expect(resolveSessionHistoryTitle(entry({ title: "  " }))).toBe("Claude Code");
  });
});

describe("buildSessionHistoryRows", () => {
  it("keeps only resumable providers, newest first, one row per session", () => {
    const rows = buildSessionHistoryRows([
      entry({ providerHandleId: "old", lastActivityAt: "2026-09-16T10:00:00.000Z" }),
      entry({
        providerId: "gemini",
        providerLabel: "Gemini",
        providerHandleId: "no-template",
        lastActivityAt: "2026-09-18T10:00:00.000Z",
      }),
      entry({ providerHandleId: "new", lastActivityAt: "2026-09-17T10:00:00.000Z" }),
      entry({ providerHandleId: "new", lastActivityAt: "2026-09-17T10:00:00.000Z" }),
    ]);

    expect(rows.map((row) => row.key)).toEqual(["claude:new", "claude:old"]);
  });
});

describe("buildResumeTerminalLaunch", () => {
  it("turns a row into the terminal argv for the provider's resume command", () => {
    const [row] = buildSessionHistoryRows([
      entry({ providerId: "codex", providerLabel: "Codex", title: "Ship it", cwd: "/repo/wt" }),
    ]);
    expect(row && buildResumeTerminalLaunch(row)).toEqual({
      cwd: "/repo/wt",
      name: "Ship it",
      command: "codex",
      args: ["resume", "handle-1"],
    });
  });
});

describe("buildSessionHistoryQueryKey", () => {
  it("keys on host, scope and the directories asked for", () => {
    expect(
      buildSessionHistoryQueryKey({ serverId: "s1", scope: "workspace", cwds: ["/repo/app"] }),
    ).toEqual(["session-history", "s1", "workspace", ["/repo/app"]]);
  });
});
