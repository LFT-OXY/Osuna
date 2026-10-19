import { getLogicMapNameFromLabels, LOGIC_MAP_LABEL } from "@getpaseo/protocol/agent-labels";

import type { AgentManager, WriteLabelsResult } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import { createEmptyLogicMap } from "./logic-map-store.js";

export interface LogicMapToggleDependencies {
  agentManager: Pick<AgentManager, "getAgent" | "patchLabels">;
  agentStorage: Pick<AgentStorage, "get">;
}

export interface SetLogicMapEnabledInput {
  /** 运行中或已存储的 Agent；草稿不带。 */
  agentId?: string;
  /** 草稿所在 workspace 的目录；带 agentId 时用 Agent 自己的 cwd。 */
  cwd?: string;
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
  const stored = live ? null : await deps.agentStorage.get(agentId);
  const agent = live ?? stored;
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
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

/**
 * 打开逻辑图：给 Agent 或草稿新建一张空图；关闭：Agent 摘掉标签，草稿什么都不做。
 * 草稿拿回图名后，在新建 Agent 的 labels 里带上它。
 */
export async function setLogicMapEnabled(
  deps: LogicMapToggleDependencies,
  input: SetLogicMapEnabledInput,
): Promise<SetLogicMapEnabledResult> {
  if (input.agentId) {
    return setForAgent(deps, input.agentId, input.enabled);
  }
  if (!input.cwd) {
    throw new Error("A logic map toggle needs an agentId or a cwd");
  }
  if (!input.enabled) return { mapName: null, labelWrite: null };
  return { mapName: await createEmptyLogicMap(input.cwd), labelWrite: null };
}
