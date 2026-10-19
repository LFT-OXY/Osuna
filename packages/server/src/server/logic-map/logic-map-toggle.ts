import { getLogicMapNameFromLabels, LOGIC_MAP_LABEL } from "@getpaseo/protocol/agent-labels";
import type { AgentLogicMapTarget } from "@getpaseo/protocol/messages";

import type { AgentManager, WriteLabelsResult } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";
import { LogicMapAgentNotFoundError, LogicMapWorkspaceNotFoundError } from "./logic-map-errors.js";
import { createEmptyLogicMap } from "./logic-map-store.js";

export interface LogicMapToggleDependencies {
  agentManager: Pick<AgentManager, "getAgent" | "patchLabels">;
  agentStorage: Pick<AgentStorage, "get">;
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
}

export interface SetLogicMapEnabledInput {
  target: AgentLogicMapTarget;
  enabled: boolean;
}

export interface SetLogicMapEnabledResult {
  mapName: string | null;
  /** 改了 labels 时的写入结果；Agent 没加载时调用方要自己推送这条记录。 */
  labelWrite: WriteLabelsResult | null;
}

async function setForAgent(
  deps: LogicMapToggleDependencies,
  agentId: string,
  enabled: boolean,
): Promise<SetLogicMapEnabledResult> {
  const live = deps.agentManager.getAgent(agentId);
  const agent = live ?? (await deps.agentStorage.get(agentId));
  if (!agent) {
    throw new LogicMapAgentNotFoundError(agentId);
  }
  const current = getLogicMapNameFromLabels(agent.labels);
  if (!enabled) {
    if (!current) return { mapName: null, labelWrite: null };
    // 只摘标签，已有的图原样留在磁盘上。
    const labelWrite = await deps.agentManager.patchLabels(agentId, { [LOGIC_MAP_LABEL]: null });
    return { mapName: null, labelWrite };
  }
  if (current) return { mapName: current, labelWrite: null };
  const mapName = await createEmptyLogicMap(agent.cwd);
  const labelWrite = await deps.agentManager.patchLabels(agentId, { [LOGIC_MAP_LABEL]: mapName });
  return { mapName, labelWrite };
}

async function setForDraft(
  deps: LogicMapToggleDependencies,
  workspaceId: string,
  enabled: boolean,
): Promise<SetLogicMapEnabledResult> {
  const workspace = await deps.workspaceRegistry.get(workspaceId);
  if (!workspace || workspace.archivedAt) {
    throw new LogicMapWorkspaceNotFoundError(workspaceId);
  }
  if (!enabled) return { mapName: null, labelWrite: null };
  return { mapName: await createEmptyLogicMap(workspace.cwd), labelWrite: null };
}

/**
 * 打开逻辑图：给 Agent 或草稿新建一张空图（Agent 已有图时沿用）；关闭：Agent 摘掉标签，草稿什么都不做。
 * 草稿拿回图名后，在新建 Agent 的 labels 里带上它。
 */
export async function setLogicMapEnabled(
  deps: LogicMapToggleDependencies,
  input: SetLogicMapEnabledInput,
): Promise<SetLogicMapEnabledResult> {
  return input.target.kind === "agent"
    ? setForAgent(deps, input.target.agentId, input.enabled)
    : setForDraft(deps, input.target.workspaceId, input.enabled);
}
