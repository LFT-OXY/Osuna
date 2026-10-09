import { describe, expect, it } from "vitest";
import type { DaemonClient } from "@osuna/client/internal/daemon-client";
import {
  createBranchSwitcherOperations,
  parseBranchCheckedOutElsewhere,
} from "./branch-switcher-operations";

function createRecordingClient() {
  const cwds: string[] = [];
  const client = {
    getBranchSuggestions: async (options: { cwd: string; limit?: number }) => {
      cwds.push(options.cwd);
      return { branches: [], error: null };
    },
    stashList: async (cwd: string) => {
      cwds.push(cwd);
      return { entries: [] };
    },
    stashSave: async (cwd: string) => {
      cwds.push(cwd);
      return { error: null };
    },
    stashPop: async (cwd: string) => {
      cwds.push(cwd);
      return { error: null };
    },
    checkoutSwitchBranch: async (cwd: string) => {
      cwds.push(cwd);
      return { error: null };
    },
  } as unknown as DaemonClient;
  return { client, cwds };
}

describe("createBranchSwitcherOperations", () => {
  it("sends the workspace directory as cwd to every git operation, never the workspace id", async () => {
    const workspaceDirectory = "/Users/dev/project";
    const workspaceId = "wks_3f9a2b1c";
    const { client, cwds } = createRecordingClient();

    const operations = createBranchSwitcherOperations(client, workspaceDirectory);
    await operations.getBranchSuggestions(200);
    await operations.listOsunaStashes();
    await operations.saveStash("main");
    await operations.popStash(0);
    await operations.switchBranch("feature");

    expect(cwds).toEqual([
      workspaceDirectory,
      workspaceDirectory,
      workspaceDirectory,
      workspaceDirectory,
      workspaceDirectory,
    ]);
    expect(cwds).not.toContain(workspaceId);
  });
});

describe("parseBranchCheckedOutElsewhere", () => {
  // 与 daemon 的 runGitCommand 报错同形：命令行 + 退出码，下一行是 git 的 stderr。
  const gitFailure = (stderr: string) =>
    `Git command failed: git checkout feat (exit code: 128, signal: none)\n${stderr}`;

  it("recognises the current git wording and pulls out the worktree path", () => {
    expect(
      parseBranchCheckedOutElsewhere(
        gitFailure("fatal: 'feat' is already used by worktree at '/Users/dev/wt/feat'"),
      ),
    ).toEqual({ worktreePath: "/Users/dev/wt/feat" });
  });

  it("recognises the older git wording", () => {
    expect(
      parseBranchCheckedOutElsewhere(
        gitFailure("fatal: 'feat' is already checked out at '/Users/dev/wt/feat'"),
      ),
    ).toEqual({ worktreePath: "/Users/dev/wt/feat" });
  });

  it("still recognises the conflict when no path can be read", () => {
    expect(
      parseBranchCheckedOutElsewhere(gitFailure("fatal: 'feat' is already checked out")),
    ).toEqual({
      worktreePath: null,
    });
  });

  it("leaves unrelated errors alone", () => {
    expect(
      parseBranchCheckedOutElsewhere(
        gitFailure("error: pathspec 'feat' did not match any file(s) known to git"),
      ),
    ).toBeNull();
    expect(
      parseBranchCheckedOutElsewhere(
        "Working directory has uncommitted changes. Commit or stash before switching branches.",
      ),
    ).toBeNull();
  });
});
