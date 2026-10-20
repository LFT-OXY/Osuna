import type {
  WorkspaceLogicMapReadResult,
  WorkspaceLogicMapSummary,
} from "@getpaseo/protocol/messages";

import type { WorkspaceRegistry } from "../workspace-registry.js";
import {
  LogicMapCorruptError,
  LogicMapNotFoundError,
  LogicMapWorkspaceNotFoundError,
} from "./logic-map-errors.js";
import { listLogicMaps, readLogicMap } from "./logic-map-store.js";

export interface LogicMapWorkspaceReadDependencies {
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
}

/** 客户端只给 workspaceId，目录由 daemon 自己查，不信任客户端传来的路径。 */
async function resolveWorkspaceCwd(
  deps: LogicMapWorkspaceReadDependencies,
  workspaceId: string,
): Promise<string> {
  const workspace = await deps.workspaceRegistry.get(workspaceId);
  if (!workspace || workspace.archivedAt) {
    throw new LogicMapWorkspaceNotFoundError(workspaceId);
  }
  return workspace.cwd;
}

export async function listWorkspaceLogicMaps(
  deps: LogicMapWorkspaceReadDependencies,
  workspaceId: string,
): Promise<WorkspaceLogicMapSummary[]> {
  return listLogicMaps(await resolveWorkspaceCwd(deps, workspaceId));
}

export async function readWorkspaceLogicMap(
  deps: LogicMapWorkspaceReadDependencies,
  input: { workspaceId: string; mapName: string },
): Promise<WorkspaceLogicMapReadResult> {
  try {
    const cwd = await resolveWorkspaceCwd(deps, input.workspaceId);
    return { kind: "ok", map: await readLogicMap({ cwd, mapName: input.mapName }) };
  } catch (error) {
    if (error instanceof LogicMapCorruptError) {
      return { kind: "corrupt", file: error.file, problem: error.problem };
    }
    if (error instanceof LogicMapNotFoundError || error instanceof LogicMapWorkspaceNotFoundError) {
      return { kind: "error", message: error.message };
    }
    throw error;
  }
}
