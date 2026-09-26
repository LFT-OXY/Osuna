import { describe, expect, it } from "vitest";
import type { CheckoutStatusPayload } from "@/git/use-status-query";
import { resolveComposerContext } from "./model";

const common = { cwd: "/repo", error: null, requestId: "req" };

const localCheckout: CheckoutStatusPayload = {
  ...common,
  isGit: true,
  isPaseoOwnedWorktree: false,
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

const paseoWorktree: CheckoutStatusPayload = {
  ...common,
  isGit: true,
  isPaseoOwnedWorktree: true,
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
  isPaseoOwnedWorktree: false,
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

  it("names a Paseo worktree and its branch", () => {
    expect(resolveComposerContext(paseoWorktree)).toEqual({
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
