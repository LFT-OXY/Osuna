import { describe, expect, it } from "vitest";
import type { CheckoutStatusPayload } from "@/git/use-status-query";
import {
  resolveBranchSwitch,
  resolveComposerContext,
  resolvePlanUsageSpace,
  type PlanUsageSpaceInput,
} from "./model";

const common = { cwd: "/repo", error: null, requestId: "req" };

const localCheckout: CheckoutStatusPayload = {
  ...common,
  isGit: true,
  isOsunaOwnedWorktree: false,
  repoRoot: "/repo",
  mainRepoRoot: null,
  currentBranch: "main",
  isDirty: false,
  baseRef: null,
  aheadBehind: null,
  aheadOfOrigin: null,
  behindOfOrigin: null,
  hasRemote: false,
  remoteUrl: null,
};

const osunaWorktree: CheckoutStatusPayload = {
  ...common,
  isGit: true,
  isOsunaOwnedWorktree: true,
  repoRoot: "/worktrees/ui",
  mainRepoRoot: "/repo",
  currentBranch: "feat/ui",
  isDirty: false,
  baseRef: "main",
  aheadBehind: null,
  aheadOfOrigin: null,
  behindOfOrigin: null,
  hasRemote: false,
  remoteUrl: null,
};

const plainDirectory: CheckoutStatusPayload = {
  ...common,
  isGit: false,
  isOsunaOwnedWorktree: false,
  repoRoot: null,
  currentBranch: null,
  isDirty: null,
  baseRef: null,
  aheadBehind: null,
  aheadOfOrigin: null,
  behindOfOrigin: null,
  hasRemote: false,
  remoteUrl: null,
};

describe("resolveComposerContext", () => {
  it("shows nothing until the git status has loaded", () => {
    expect(resolveComposerContext(null)).toEqual({ workspaceKind: null, branch: null });
  });

  it("names a Osuna worktree and its branch", () => {
    expect(resolveComposerContext(osunaWorktree)).toEqual({
      workspaceKind: "worktree",
      branch: "feat/ui",
    });
  });

  it("counts any linked git worktree as a worktree, as the daemon does", () => {
    expect(resolveComposerContext({ ...localCheckout, mainRepoRoot: "/main" })).toEqual({
      workspaceKind: "worktree",
      branch: "main",
    });
  });

  it("names the main checkout a local checkout", () => {
    expect(resolveComposerContext(localCheckout)).toEqual({
      workspaceKind: "local_checkout",
      branch: "main",
    });
  });

  it("drops the branch on a detached HEAD", () => {
    expect(resolveComposerContext({ ...localCheckout, currentBranch: null })).toEqual({
      workspaceKind: "local_checkout",
      branch: null,
    });
  });

  it("calls a plain directory a directory with no branch", () => {
    expect(resolveComposerContext(plainDirectory)).toEqual({
      workspaceKind: "directory",
      branch: null,
    });
  });
});

describe("resolveBranchSwitch", () => {
  const idleAgent = { agent: "idle", isHostConnected: true } as const;

  it("offers the switcher on a git checkout with a branch", () => {
    expect(resolveBranchSwitch(resolveComposerContext(localCheckout), idleAgent)).toEqual({
      kind: "enabled",
    });
  });

  it("offers the switcher in a worktree too", () => {
    expect(resolveBranchSwitch(resolveComposerContext(osunaWorktree), idleAgent)).toEqual({
      kind: "enabled",
    });
  });

  it("disables the switcher while the current agent is running", () => {
    expect(
      resolveBranchSwitch(resolveComposerContext(localCheckout), {
        ...idleAgent,
        agent: "running",
      }),
    ).toEqual({ kind: "disabled", reason: "agent-running" });
  });

  it("keeps the switcher available in a draft", () => {
    expect(
      resolveBranchSwitch(resolveComposerContext(localCheckout), { ...idleAgent, agent: "draft" }),
    ).toEqual({ kind: "enabled" });
  });

  it("disables the switcher while the host is disconnected, draft or not", () => {
    for (const agent of ["idle", "draft"] as const) {
      expect(
        resolveBranchSwitch(resolveComposerContext(localCheckout), {
          agent,
          isHostConnected: false,
        }),
      ).toEqual({ kind: "disabled", reason: "host-disconnected" });
    }
  });

  it("hides the switcher on a detached HEAD, a plain directory, or before git status loads", () => {
    for (const gitStatus of [{ ...localCheckout, currentBranch: null }, plainDirectory, null]) {
      expect(resolveBranchSwitch(resolveComposerContext(gitStatus), idleAgent)).toEqual({
        kind: "hidden",
      });
    }
  });
});

describe("resolvePlanUsageSpace", () => {
  function space(overrides: Partial<PlanUsageSpaceInput>) {
    return resolvePlanUsageSpace({
      regionWidth: 500,
      branchNaturalWidth: 140,
      hasBranch: true,
      itemGap: 12,
      branchMinWidth: 80,
      ...overrides,
    });
  }

  it("waits until the region is measured", () => {
    expect(space({ regionWidth: null })).toBeNull();
  });

  it("waits for the branch measurement while a branch is shown", () => {
    expect(space({ branchNaturalWidth: null })).toBeNull();
  });

  it("subtracts the gap before the plan usage and reserves the branch minimum", () => {
    expect(space({})).toEqual({ availableWidth: 488, branchReservedWidth: 80 });
  });

  it("reserves only the branch's own width when it is shorter than the minimum", () => {
    expect(space({ branchNaturalWidth: 51 })).toEqual({
      availableWidth: 488,
      branchReservedWidth: 51,
    });
  });

  it("reserves nothing when there is no branch", () => {
    expect(space({ hasBranch: false, branchNaturalWidth: null })).toEqual({
      availableWidth: 488,
      branchReservedWidth: 0,
    });
  });
});
