import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { useShallow } from "zustand/shallow";
import type { CreateAgentsVerdict } from "@/hooks/use-agent-autocomplete";
import { useSessionStore } from "@/stores/session-store";

/** 逻辑图读写靠的 Osuna 工具没送到会话的原因；与 daemon 不发说明块的判定一致。 */
export type LogicMapToolsUnavailableReason =
  | "tools_not_injected"
  | "mcp_disabled"
  | "tools_not_delivered";

const TOOLS_UNAVAILABLE_REASONS: readonly string[] = [
  "tools_not_injected",
  "mcp_disabled",
  "tools_not_delivered",
] satisfies readonly LogicMapToolsUnavailableReason[];

function isToolsUnavailableReason(
  reason: string | undefined,
): reason is LogicMapToolsUnavailableReason {
  return reason !== undefined && TOOLS_UNAVAILABLE_REASONS.includes(reason);
}

/**
 * 从 create_agent 的判定里读出整套 Osuna 工具是否可用：create_agent_not_allowed 只管 create_agent，
 * 认不出的原因码和还没判定的都按可用处理，由 daemon 发送时再判。
 */
export function resolveLogicMapToolsUnavailableReason(
  verdict: CreateAgentsVerdict,
): LogicMapToolsUnavailableReason | null {
  if (verdict.canCreateAgents !== false) return null;
  return isToolsUnavailableReason(verdict.unavailableReason) ? verdict.unavailableReason : null;
}

const NO_VERDICT: CreateAgentsVerdict = {
  canCreateAgents: undefined,
  unavailableReason: undefined,
};

/** 运行中的 Agent 按 daemon 对会话的判定；草稿按所选 provider 在快照里的预测。 */
export type LogicMapToolsTarget =
  | { kind: "agent"; serverId: string; agentId: string }
  | {
      kind: "draft";
      providerEntries: readonly ProviderSnapshotEntry[];
      selectedProvider: string | null;
    };

export function useLogicMapToolsUnavailableReason(
  target: LogicMapToolsTarget,
): LogicMapToolsUnavailableReason | null {
  const agentServerId = target.kind === "agent" ? target.serverId : null;
  const agentId = target.kind === "agent" ? target.agentId : null;
  const agentVerdict = useSessionStore(
    useShallow((state): CreateAgentsVerdict => {
      if (agentServerId === null || agentId === null) return NO_VERDICT;
      const agent = state.sessions[agentServerId]?.agents?.get(agentId);
      return {
        canCreateAgents: agent?.canCreateAgents,
        unavailableReason: agent?.createAgentsUnavailableReason,
      };
    }),
  );
  if (target.kind === "agent") return resolveLogicMapToolsUnavailableReason(agentVerdict);
  const entry = target.providerEntries.find(
    (candidate) => candidate.provider === target.selectedProvider,
  );
  return resolveLogicMapToolsUnavailableReason({
    canCreateAgents: entry?.canCreateAgents,
    unavailableReason: entry?.createAgentsUnavailableReason,
  });
}
