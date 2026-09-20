import type { UsageProjectKind, UsageTokenTotals } from "@getpaseo/protocol/usage/types";
import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { topUsageProjects, USAGE_DETAILS_TABS } from "./details";
import type { MergedUsageProject } from "./merge";

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.init();
  }
});

function totals(output: number): UsageTokenTotals {
  return { input: 0, cachedInput: 0, cacheWrite: 0, output, reasoning: 0 };
}

function project(
  overrides: Partial<MergedUsageProject> & Pick<MergedUsageProject, "rootPath">,
): MergedUsageProject {
  return {
    displayName: overrides.rootPath.slice(1),
    kind: "git",
    totals: totals(10),
    estimatedCost: 0,
    sources: [{ cli: "claude", backend: null }],
    cwds: [],
    serverId: "host-a",
    ...overrides,
  };
}

describe("topUsageProjects", () => {
  it("cuts the merged order and reports the largest project's tokens", () => {
    const projects = [
      project({ rootPath: "/a", totals: totals(100) }),
      project({ rootPath: "/b", totals: totals(50), serverId: "host-b" }),
      project({ rootPath: "/c", totals: totals(10) }),
      project({ rootPath: "/d", totals: totals(1) }),
    ];

    expect(topUsageProjects(projects, 3)).toEqual({
      projects: [projects[0], projects[1], projects[2]],
      maxTokens: 100,
    });
    expect(topUsageProjects(projects, 10).projects).toHaveLength(4);
  });

  it("has no bar scale when nothing was used", () => {
    expect(topUsageProjects([], 3)).toEqual({ projects: [], maxTokens: 0 });
  });
});

describe("runtime-assembled data details keys", () => {
  it("has a label for every tab", () => {
    for (const tab of USAGE_DETAILS_TABS) {
      expect(i18n.exists(`usage.details.tabs.${tab}`), tab).toBe(true);
    }
  });

  it("has a badge for every project kind that wears one", () => {
    const badged: UsageProjectKind[] = ["non_git", "directory"];
    for (const kind of badged) {
      expect(i18n.exists(`usage.details.projectKind.${kind}`), kind).toBe(true);
    }
  });
});
