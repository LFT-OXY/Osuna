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

/**
 * 当前这个 Composer 背后的 agent：草稿（还没创建，切分支就是在选起点）、空闲或运行中。
 * 只看当前这个 agent，不汇总同目录下的其他 agent。
 */
export type ComposerAgentPhase = "draft" | "idle" | "running";

export interface BranchSwitchConditions {
  agent: ComposerAgentPhase;
  isHostConnected: boolean;
}

export type BranchSwitchState =
  | { kind: "hidden" }
  | { kind: "enabled" }
  | { kind: "disabled"; reason: "agent-running" | "host-disconnected" };

/**
 * 上下文条上的分支切换触发器：没有分支名（detached HEAD、非 git、状态未到）时不显示；
 * 当前 agent 运行中时置灰，避免它读写到一半工作区被换掉；草稿没有运行中的 agent，始终可用。
 */
export function resolveBranchSwitch(
  context: ComposerContext,
  conditions: BranchSwitchConditions,
): BranchSwitchState {
  if (!context.branch) {
    return { kind: "hidden" };
  }
  if (!conditions.isHostConnected) {
    return { kind: "disabled", reason: "host-disconnected" };
  }
  if (conditions.agent === "running") {
    return { kind: "disabled", reason: "agent-running" };
  }
  return { kind: "enabled" };
}
