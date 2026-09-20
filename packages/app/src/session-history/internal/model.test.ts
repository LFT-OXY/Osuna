import { describe, expect, it } from "vitest";
import type { FetchRecentProviderSessionEntry } from "@getpaseo/client/internal/daemon-client";
import {
  buildResumeCommand,
  buildResumeTerminalLaunch,
  buildSessionHistoryQueryKey,
  buildSessionHistoryRows,
  filterSessionHistoryRows,
  formatSessionHistoryDirectory,
  mergeSessionHistoryPayloads,
  resolveSessionHistoryCwds,
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

  it("carries the owning Paseo agent id through to the row", () => {
    const rows = buildSessionHistoryRows([
      entry({
        providerHandleId: "owned",
        importedAgentId: "agent-1",
        importedAgentWorkspaceId: "ws-1",
      }),
      entry({ providerHandleId: "legacy", importedAgentId: "agent-2" }),
      entry({ providerHandleId: "external" }),
    ]);

    expect(rows.map((row) => [row.importedAgentId, row.importedAgentWorkspaceId])).toEqual([
      ["agent-1", "ws-1"],
      ["agent-2", null],
      [null, null],
    ]);
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

describe("buildResumeCommand", () => {
  it("renders the provider's resume command as one line", () => {
    const [row] = buildSessionHistoryRows([
      entry({ providerId: "copilot", providerLabel: "Copilot" }),
    ]);
    expect(row && buildResumeCommand(row)).toBe("copilot --resume=handle-1");
  });
});

describe("buildSessionHistoryQueryKey", () => {
  it("keys on host, scope and the directories asked for", () => {
    expect(
      buildSessionHistoryQueryKey({ serverId: "s1", scope: "workspace", cwds: ["/repo/app"] }),
    ).toEqual(["session-history", "s1", "workspace", ["/repo/app"]]);
  });
});

describe("resolveSessionHistoryCwds", () => {
  const input = {
    workspaceDirectory: "/repo/app",
    projectWorkspaceDirectories: ["/repo/wt-b", "/repo/app", "/repo/wt-a", "/repo/wt-b"],
  };

  it("asks for the workspace directory alone in workspace scope", () => {
    expect(resolveSessionHistoryCwds("workspace", input)).toEqual(["/repo/app"]);
  });

  it("asks for every active project workspace once, sorted, in project scope", () => {
    expect(resolveSessionHistoryCwds("project", input)).toEqual([
      "/repo/app",
      "/repo/wt-a",
      "/repo/wt-b",
    ]);
  });

  it("includes the current workspace in project scope even before the store lists it", () => {
    expect(
      resolveSessionHistoryCwds("project", { ...input, projectWorkspaceDirectories: [] }),
    ).toEqual(["/repo/app"]);
  });

  it("asks for the whole host with no directory in host scope", () => {
    expect(resolveSessionHistoryCwds("host", input)).toEqual([]);
  });
});

describe("mergeSessionHistoryPayloads", () => {
  it("concatenates entries and keeps one copy of each provider error", () => {
    const merged = mergeSessionHistoryPayloads([
      {
        entries: [entry({ providerHandleId: "a" })],
        providerErrors: [{ provider: "codex", message: "timed out" }],
      },
      {
        entries: [entry({ providerHandleId: "b" })],
        providerErrors: [
          { provider: "codex", message: "timed out" },
          { provider: "opencode", message: "not installed" },
        ],
      },
      { entries: [] },
    ]);

    expect(merged.entries.map((item) => item.providerHandleId)).toEqual(["a", "b"]);
    expect(merged.providerErrors).toEqual([
      { provider: "codex", message: "timed out" },
      { provider: "opencode", message: "not installed" },
    ]);
  });
});

describe("filterSessionHistoryRows", () => {
  const rows = buildSessionHistoryRows([
    entry({ providerHandleId: "1", title: "Fix Login", firstPromptPreview: "auth bug" }),
    entry({ providerHandleId: "2", title: "Refactor", lastPromptPreview: "rename LOGIN helper" }),
    entry({ providerHandleId: "3", title: "Docs" }),
  ]);

  it("returns every row for a blank query", () => {
    expect(filterSessionHistoryRows(rows, "   ")).toBe(rows);
  });

  it("matches title, first prompt and last prompt case-insensitively", () => {
    expect(filterSessionHistoryRows(rows, "login").map((row) => row.providerHandleId)).toEqual([
      "1",
      "2",
    ]);
    expect(filterSessionHistoryRows(rows, "AUTH").map((row) => row.providerHandleId)).toEqual([
      "1",
    ]);
    expect(filterSessionHistoryRows(rows, "nothing")).toEqual([]);
  });
});

describe("formatSessionHistoryDirectory", () => {
  it("shows the path under the project root, nothing at the root, the full path outside", () => {
    expect(formatSessionHistoryDirectory("/repo/app/packages/web", "/repo/app")).toBe(
      "packages/web",
    );
    expect(formatSessionHistoryDirectory("/repo/app", "/repo/app/")).toBeNull();
    expect(formatSessionHistoryDirectory("/repo/app-other", "/repo/app")).toBe("/repo/app-other");
    expect(formatSessionHistoryDirectory("/tmp/wt", "/repo/app")).toBe("/tmp/wt");
    expect(formatSessionHistoryDirectory("/tmp/wt", null)).toBeNull();
  });
});
