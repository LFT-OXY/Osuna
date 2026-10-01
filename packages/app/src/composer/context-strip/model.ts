import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { CheckoutStatusPayload } from "@/git/use-status-query";
import type { PlanUsageStripSpace } from "@/provider-usage/strip";

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

export interface PlanUsageSpaceInput {
  /** 分支名和套餐用量所在区域的宽度；还没量到时为 null。 */
  regionWidth: number | null;
  hasBranch: boolean;
  /** 分支名不截断时的宽度；还没量到时为 null。 */
  branchNaturalWidth: number | null;
  itemGap: number;
  /** 空间不够时分支名至少保留的宽度。 */
  branchMinWidth: number;
}

/**
 * 套餐用量做宽度取舍前要知道的空间。比最小值短的分支名只保留它自己的宽度。
 * 区域或分支名还没量到时返回 null，套餐用量先不显示，免得按猜的宽度显示出来又收回。
 */
export function resolvePlanUsageSpace(input: PlanUsageSpaceInput): PlanUsageStripSpace | null {
  if (input.regionWidth === null) return null;
  // 区域里分支名（或没有分支名时的占位）与套餐用量之间一个间距。
  const availableWidth = input.regionWidth - input.itemGap;
  if (!input.hasBranch) return { availableWidth, branchReservedWidth: 0 };
  if (input.branchNaturalWidth === null) return null;
  return {
    availableWidth,
    branchReservedWidth: Math.min(input.branchMinWidth, input.branchNaturalWidth),
  };
}
