export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
// daemon 自有：父智能体里那次 create_agent 的 provider tool call id，等于父时间线条目的 callId。
export const PARENT_TOOL_CALL_ID_LABEL = "paseo.parent-tool-call-id";
const OPEN_AGENT_TAB_LABEL_PREFIX = "paseo.open-agent-tab.";
// daemon 自有：这个 Agent 维护的逻辑图（docs/logic-maps/<名字>/）；没有这个标签就是开关关着。
export const LOGIC_MAP_LABEL = "paseo.logic-map";
// daemon 自有：这个 Agent 打开开关后已经收到过说明块的那张图。和 LOGIC_MAP_LABEL 不同时，
// 下一条消息是打开开关后的第一条，说明块要求先给带标记的节点补指向。
export const LOGIC_MAP_BRIEFED_LABEL = "paseo.logic-map.briefed";

export function getOpenAgentTabLabel(clientId: string): string {
  return `${OPEN_AGENT_TAB_LABEL_PREFIX}${clientId}`;
}

export function isOpenAgentTabLabel(label: string): boolean {
  return label.startsWith(OPEN_AGENT_TAB_LABEL_PREFIX);
}

export interface AgentLabelSource {
  labels?: Record<string, unknown> | null;
}

export function getParentAgentIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  const parentAgentId = labels?.[PARENT_AGENT_ID_LABEL];
  return typeof parentAgentId === "string" && parentAgentId.trim().length > 0
    ? parentAgentId.trim()
    : null;
}

export function getLogicMapNameFromLabels(labels: Record<string, unknown> | null | undefined) {
  const mapName = labels?.[LOGIC_MAP_LABEL];
  return typeof mapName === "string" && mapName.trim().length > 0 ? mapName.trim() : null;
}

export function isDelegatedAgent(agent: AgentLabelSource): boolean {
  return getParentAgentIdFromLabels(agent.labels) !== null;
}

export function hasOpenAgentTab(labels: Record<string, unknown> | null | undefined): boolean {
  return Object.entries(labels ?? {}).some(
    ([label, value]) => isOpenAgentTabLabel(label) && value === "true",
  );
}
