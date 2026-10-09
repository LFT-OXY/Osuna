import type { DaemonClient } from "@osuna/client/internal/daemon-client";

// Binds the branch switcher's git operations to a single workspace directory, so a
// workspace id can never be passed where a cwd is expected. `cwd` is set once here;
// callers choose the operation, never the directory.
export function createBranchSwitcherOperations(client: DaemonClient, cwd: string) {
  return {
    getBranchSuggestions: (limit: number) => client.getBranchSuggestions({ cwd, limit }),
    listOsunaStashes: () => client.stashList(cwd, { osunaOnly: true }),
    saveStash: (branch: string | undefined) => client.stashSave(cwd, { branch }),
    popStash: (stashIndex: number) => client.stashPop(cwd, stashIndex),
    switchBranch: (branch: string) => client.checkoutSwitchBranch(cwd, branch),
  };
}

export type BranchSwitcherOperations = ReturnType<typeof createBranchSwitcherOperations>;

export interface BranchCheckedOutElsewhere {
  /** 占用该分支的 worktree 路径；报错里取不到时为 null。 */
  worktreePath: string | null;
}

// git ≥ 2.42 写作 "is already used by worktree at '<path>'"，更早的版本写作
// "is already checked out at '<path>'"。
const CHECKED_OUT_ELSEWHERE = /is already (?:used by worktree|checked out)(?: at '([^']+)')?/;

/** 识别「目标分支已被别的 worktree 检出」的 git 报错。 */
export function parseBranchCheckedOutElsewhere(message: string): BranchCheckedOutElsewhere | null {
  const match = CHECKED_OUT_ELSEWHERE.exec(message);
  if (!match) {
    return null;
  }
  return { worktreePath: match[1] ?? null };
}
