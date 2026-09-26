import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { CheckoutStatusPayload } from "@/git/use-status-query";

type WorkspaceKind = Exclude<WorkspaceDescriptor["workspaceKind"], "checkout">;

export interface ComposerContext {
  /** null 表示 git 状态还没到。 */
  workspaceKind: WorkspaceKind | null;
  branch: string | null;
}

/**
 * Composer 底部上下文条的内容：工作区类型（术语见 docs/glossary.md "Workspace kind"）与当前分支，
 * 按 daemon 的 `deriveWorkspaceKind` 同一规则从 git 状态推出；detached HEAD 与非 git 目录没有分支。
 */
export function resolveComposerContext(gitStatus: CheckoutStatusPayload | null): ComposerContext {
  if (!gitStatus) {
    return { workspaceKind: null, branch: null };
  }
  if (!gitStatus.isGit) {
    return { workspaceKind: "directory", branch: null };
  }
  return {
    workspaceKind: gitStatus.mainRepoRoot ? "worktree" : "local_checkout",
    branch: gitStatus.currentBranch,
  };
}
