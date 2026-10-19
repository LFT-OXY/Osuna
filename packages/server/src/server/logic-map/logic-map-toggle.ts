import {
  getLogicMapNameFromLabels,
  LOGIC_MAP_BRIEFED_LABEL,
  LOGIC_MAP_LABEL,
} from "@getpaseo/protocol/agent-labels";
import type { AgentLogicMapTarget } from "@getpaseo/protocol/messages";

import type { AgentManager, WriteLabelsResult } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";
import {
  LogicMapAgentNotFoundError,
  LogicMapNotFoundError,
  LogicMapToContinueMissingError,
  LogicMapWorkspaceNotFoundError,
} from "./logic-map-errors.js";
import {
  assertLogicMapExists,
  createEmptyLogicMap,
  discardUnwrittenLogicMap,
  type DiscardUnwrittenLogicMapResult,
} from "./logic-map-store.js";

export interface LogicMapToggleDependencies {
  agentManager: Pick<AgentManager, "getAgent" | "patchLabels" | "listAgents">;
  agentStorage: Pick<AgentStorage, "get" | "list">;
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
}

export interface SetLogicMapEnabledInput {
  target: AgentLogicMapTarget;
  enabled: boolean;
  /** 打开时接着这张已有的图；undefined 表示新建（Agent 已开着时沿用当前那张）。 */
  mapName: string | undefined;
}

/** 要接着的图得在 cwd 下；不在时报给用户能看懂的错误。 */
async function confirmMapToContinue(cwd: string, mapName: string): Promise<string> {
  try {
    await assertLogicMapExists({ cwd, mapName });
  } catch (error) {
    if (error instanceof LogicMapNotFoundError) throw new LogicMapToContinueMissingError(mapName);
    throw error;
  }
  return mapName;
}

export interface SetLogicMapEnabledResult {
  mapName: string | null;
  /** 改了 labels 时的写入结果；Agent 没加载时调用方要自己推送这条记录。 */
  labelWrite: WriteLabelsResult | null;
}

async function setForAgent(
  deps: LogicMapToggleDependencies,
  agentId: string,
  input: SetLogicMapEnabledInput,
): Promise<SetLogicMapEnabledResult> {
  const live = deps.agentManager.getAgent(agentId);
  const agent = live ?? (await deps.agentStorage.get(agentId));
  if (!agent) {
    throw new LogicMapAgentNotFoundError(agentId);
  }
  const current = getLogicMapNameFromLabels(agent.labels);
  if (!input.enabled) {
    if (!current) return { mapName: null, labelWrite: null };
    // 只摘标签，已有的图原样留在磁盘上。
    const labelWrite = await deps.agentManager.patchLabels(agentId, {
      [LOGIC_MAP_LABEL]: null,
      [LOGIC_MAP_BRIEFED_LABEL]: null,
    });
    return { mapName: null, labelWrite };
  }
  const mapName =
    input.mapName !== undefined
      ? await confirmMapToContinue(agent.cwd, input.mapName)
      : (current ?? (await createEmptyLogicMap(agent.cwd)));
  if (mapName === current) return { mapName, labelWrite: null };
  // 换了图或重新打开：下一条消息是打开后的第一条。
  const labelWrite = await deps.agentManager.patchLabels(agentId, {
    [LOGIC_MAP_LABEL]: mapName,
    [LOGIC_MAP_BRIEFED_LABEL]: null,
  });
  return { mapName, labelWrite };
}

/** 这个目录下有没有 Agent（运行中或存着的）把这张图记在标签里。 */
async function isLogicMapInUse(
  deps: LogicMapToggleDependencies,
  location: { cwd: string; mapName: string },
): Promise<boolean> {
  const agents = [...deps.agentManager.listAgents(), ...(await deps.agentStorage.list())];
  return agents.some(
    (agent) =>
      agent.cwd === location.cwd && getLogicMapNameFromLabels(agent.labels) === location.mapName,
  );
}

/** 草稿改为接着别的图：它之前新建的那张还空着、也没有 Agent 在用时删掉，不留空文件夹。 */
async function discardDraftCreatedMap(
  deps: LogicMapToggleDependencies,
  location: { cwd: string; mapName: string },
): Promise<DiscardUnwrittenLogicMapResult> {
  if (await isLogicMapInUse(deps, location)) return { kind: "kept", reason: "in_use" };
  return discardUnwrittenLogicMap(location);
}

async function setForDraft(
  deps: LogicMapToggleDependencies,
  workspaceId: string,
  input: SetLogicMapEnabledInput,
): Promise<SetLogicMapEnabledResult> {
  const workspace = await deps.workspaceRegistry.get(workspaceId);
  if (!workspace || workspace.archivedAt) {
    throw new LogicMapWorkspaceNotFoundError(workspaceId);
  }
  if (!input.enabled) return { mapName: null, labelWrite: null };
  if (input.mapName === undefined) {
    return { mapName: await createEmptyLogicMap(workspace.cwd), labelWrite: null };
  }
  const mapName = await confirmMapToContinue(workspace.cwd, input.mapName);
  const createdMapName = input.target.kind === "draft" ? input.target.createdMapName : undefined;
  if (createdMapName !== undefined && createdMapName !== mapName) {
    await discardDraftCreatedMap(deps, { cwd: workspace.cwd, mapName: createdMapName });
  }
  return { mapName, labelWrite: null };
}

/**
 * 打开逻辑图：接着指定的已有图，或给 Agent / 草稿新建一张空图（Agent 已有图时沿用）；
 * 关闭：Agent 摘掉标签，草稿什么都不做。
 * 草稿拿回图名后，在新建 Agent 的 labels 里带上它。
 */
export async function setLogicMapEnabled(
  deps: LogicMapToggleDependencies,
  input: SetLogicMapEnabledInput,
): Promise<SetLogicMapEnabledResult> {
  return input.target.kind === "agent"
    ? setForAgent(deps, input.target.agentId, input)
    : setForDraft(deps, input.target.workspaceId, input);
}
