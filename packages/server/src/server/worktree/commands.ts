import { join } from "node:path";

import { getOsunaWorktreesRoot, isOsunaOwnedWorktreeCwd } from "../../utils/worktree.js";
import {
  archiveByScope,
  resolveWorkspaceIdAtPath,
  type ArchiveDependencies,
  type ArchiveScope,
} from "../workspace-archive-service.js";
import type {
  CreateOsunaWorktreeInput,
  CreateOsunaWorktreeResult,
} from "../osuna-worktree-service.js";
import { toWorktreeWireError, type WorktreeWireError } from "../worktree-errors.js";
import type { WorkspaceGitService, WorkspaceGitWorktreeInfo } from "../workspace-git-service.js";

export interface ListOsunaWorktreesCommandDependencies {
  workspaceGitService: Pick<WorkspaceGitService, "listWorktrees">;
}

export interface ListOsunaWorktreesCommandInput {
  cwd: string;
  reason?: string;
}

export async function listOsunaWorktreesCommand(
  dependencies: ListOsunaWorktreesCommandDependencies,
  input: ListOsunaWorktreesCommandInput,
): Promise<WorkspaceGitWorktreeInfo[]> {
  if (input.reason) {
    return dependencies.workspaceGitService.listWorktrees(input.cwd, { reason: input.reason });
  }
  return dependencies.workspaceGitService.listWorktrees(input.cwd);
}

type CreateOsunaWorktreeWorkflow<Result extends CreateOsunaWorktreeResult> = (
  input: CreateOsunaWorktreeInput,
) => Promise<Result>;

export interface CreateOsunaWorktreeCommandDependencies<
  Result extends CreateOsunaWorktreeResult = CreateOsunaWorktreeResult,
> {
  osunaHome?: string;
  worktreesRoot?: string;
  createOsunaWorktreeWorkflow?: CreateOsunaWorktreeWorkflow<Result>;
}

export type CreateOsunaWorktreeCommandInput = Omit<
  CreateOsunaWorktreeInput,
  "osunaHome" | "runSetup"
> & {
  osunaHome?: string;
  worktreesRoot?: string;
};

export type CreateOsunaWorktreeCommandResult<Result extends CreateOsunaWorktreeResult> =
  | {
      ok: true;
      createdWorktree: Result;
    }
  | {
      ok: false;
      error: WorktreeWireError;
      cause: unknown;
    };

export async function createOsunaWorktreeCommand<Result extends CreateOsunaWorktreeResult>(
  dependencies: CreateOsunaWorktreeCommandDependencies<Result>,
  input: CreateOsunaWorktreeCommandInput,
): Promise<CreateOsunaWorktreeCommandResult<Result>> {
  try {
    if (!dependencies.createOsunaWorktreeWorkflow) {
      throw new Error("Osuna worktree service is not configured");
    }

    const createdWorktree = await dependencies.createOsunaWorktreeWorkflow({
      ...input,
      runSetup: false,
      osunaHome: input.osunaHome ?? dependencies.osunaHome,
      worktreesRoot: input.worktreesRoot ?? dependencies.worktreesRoot,
    });
    return { ok: true, createdWorktree };
  } catch (error) {
    return {
      ok: false,
      error: toWorktreeWireError(error),
      cause: error,
    };
  }
}

export interface ArchiveCommandDependencies extends Omit<
  ArchiveDependencies,
  "workspaceGitService"
> {
  workspaceGitService: Pick<WorkspaceGitService, "getSnapshot" | "listWorktrees">;
}

export interface ArchiveCommandInput {
  requestId: string;
  repoRoot?: string | null;
  worktreePath?: string;
  worktreeSlug?: string;
  branchName?: string;
  workspaceId?: string;
  scope?: ArchiveScope["kind"];
}

export type ArchiveCommandResult =
  | {
      ok: true;
      removedAgents: string[];
    }
  | {
      ok: false;
      code: "NOT_ALLOWED";
      message: string;
      removedAgents: [];
    };

export async function archiveCommand(
  dependencies: ArchiveCommandDependencies,
  input: ArchiveCommandInput,
): Promise<ArchiveCommandResult> {
  const targetPath = await resolveArchiveTarget(dependencies, input);
  const scope = input.scope ?? "workspace";
  const ownership = await isOsunaOwnedWorktreeCwd(targetPath, {
    osunaHome: dependencies.osunaHome,
    worktreesRoot: dependencies.osunaWorktreesBaseRoot,
  });

  if (scope === "worktree") {
    if (!ownership.allowed) {
      return {
        ok: false,
        code: "NOT_ALLOWED",
        message: "Worktree is not an Osuna-owned worktree",
        removedAgents: [],
      };
    }

    const result = await archiveByScope(dependencies, {
      scope: { kind: "worktree", targetPath },
      requestId: input.requestId,
    });

    return {
      ok: true,
      removedAgents: result.archivedAgentIds,
    };
  }

  const workspaceId =
    input.workspaceId ?? (await resolveWorkspaceIdAtPath(dependencies, targetPath));

  if (!workspaceId) {
    dependencies.sessionLogger?.warn(
      { targetPath },
      "Could not resolve workspace for archive; skipping",
    );
    return {
      ok: true,
      removedAgents: [],
    };
  }

  const result = await archiveByScope(dependencies, {
    scope: { kind: "workspace", workspaceId },
    requestId: input.requestId,
  });

  return {
    ok: true,
    removedAgents: result.archivedAgentIds,
  };
}

async function resolveArchiveTarget(
  dependencies: ArchiveCommandDependencies,
  input: ArchiveCommandInput,
): Promise<string> {
  const repoRoot = input.repoRoot ?? null;
  if (input.worktreePath) {
    return input.worktreePath;
  }

  if (input.worktreeSlug) {
    if (!repoRoot) {
      throw new Error("repoRoot is required when worktreeSlug is supplied");
    }
    return resolveWorktreeSlugPath(dependencies, repoRoot, input.worktreeSlug);
  }

  if (repoRoot && input.branchName) {
    const worktrees = await dependencies.workspaceGitService.listWorktrees(repoRoot);
    const match = worktrees.find((entry) => entry.branchName === input.branchName);
    if (!match) {
      throw new Error(`Osuna worktree not found for branch ${input.branchName}`);
    }
    return match.path;
  }

  throw new Error("worktreePath, worktreeSlug, or repoRoot+branchName is required");
}

async function resolveWorktreeSlugPath(
  dependencies: ArchiveCommandDependencies,
  repoRoot: string,
  worktreeSlug: string,
): Promise<string> {
  const worktreesRoot = await getOsunaWorktreesRoot(
    repoRoot,
    dependencies.osunaHome,
    dependencies.osunaWorktreesBaseRoot,
  );
  return join(worktreesRoot, worktreeSlug);
}
