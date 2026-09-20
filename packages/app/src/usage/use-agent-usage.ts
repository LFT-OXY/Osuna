import type {
  UsageAgentGetResponse,
  UsageAgentTurnsListResponse,
} from "@osuna/protocol/usage/rpc-schemas";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useReplicaQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export type AgentUsageSummaryPayload = UsageAgentGetResponse["payload"];
export type AgentUsageTurnsPayload = UsageAgentTurnsListResponse["payload"];

/**
 * An agent whose usage the daemon can be asked about. `null` wherever there is
 * no such agent — no host, no agent, or a host without `features.usage` — so
 * "do not ask" is one decision the caller makes, not a sentinel id.
 */
export interface AgentUsageScope {
  serverId: string;
  agentId: string;
}

export function agentUsageSummaryQueryKey(serverId: string, agentId: string) {
  return ["usageAgentSummary", serverId, agentId] as const;
}

export function agentUsageTurnsQueryKey(serverId: string, agentId: string) {
  return ["usageAgentTurns", serverId, agentId] as const;
}

/**
 * What one agent spent across every provider session it ran in, for the context
 * meter popover. Pushed by `usage.updated`, so the query never polls.
 */
// COMPAT(usage): added in v0.8.2, remove gate after 2027-09-19.
export function useAgentUsageSummary(
  scope: AgentUsageScope | null,
  options: { enabled?: boolean } = {},
): { payload: AgentUsageSummaryPayload | undefined } {
  const serverId = scope?.serverId ?? "";
  const agentId = scope?.agentId ?? "";
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const query = useReplicaQuery<AgentUsageSummaryPayload>({
    queryKey: agentUsageSummaryQueryKey(serverId, agentId),
    enabled: (options.enabled ?? true) && isConnected,
    pushEvent: "usage.updated",
    queryFn: client && scope ? () => client.usageAgentGet(scope.agentId) : skipToken,
  });
  return { payload: query.data };
}

/**
 * Every turn the agent ran, for the turn footers. One query per agent: each
 * footer reads the same cache entry and matches its own row out of it, so a
 * hundred turns still cost one request.
 */
// COMPAT(usage): added in v0.8.2, remove gate after 2027-09-19.
export function useAgentUsageTurns(scope: AgentUsageScope): {
  payload: AgentUsageTurnsPayload | undefined;
} {
  const client = useHostRuntimeClient(scope.serverId);
  const isConnected = useHostRuntimeIsConnected(scope.serverId);
  const query = useReplicaQuery<AgentUsageTurnsPayload>({
    queryKey: agentUsageTurnsQueryKey(scope.serverId, scope.agentId),
    enabled: isConnected,
    pushEvent: "usage.updated",
    queryFn: client ? () => client.usageAgentTurnsList(scope.agentId) : skipToken,
  });
  return { payload: query.data };
}

/**
 * Invalidates both agent queries when the daemon reports new rows for this
 * agent, or when a price change makes the costs it already returned wrong.
 * Owned by the surface that mounts the queries, once per surface.
 */
export function useAgentUsageEvents(scope: AgentUsageScope | null): void {
  const client = useHostRuntimeClient(scope?.serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(scope?.serverId ?? "");
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!scope || !client || !isConnected) return;
    const { serverId, agentId } = scope;
    const observation = client.observeEvents(["usage.updated", "usage.pricing.updated"]);
    const invalidate = () => {
      void queryClient.invalidateQueries({
        queryKey: agentUsageSummaryQueryKey(serverId, agentId),
      });
      void queryClient.invalidateQueries({ queryKey: agentUsageTurnsQueryKey(serverId, agentId) });
    };
    observation.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type === "usage.pricing.updated") {
          invalidate();
          return;
        }
        // A session that backs no agent still broadcasts; only this agent's own
        // rows are worth a refetch here.
        if (message.type !== "usage.updated" || message.payload.agentId !== scope.agentId) return;
        invalidate();
      },
    });
    return () => {
      void observation.release().catch(() => {
        /* The socket is gone; the daemon drops the subscription with it. */
      });
    };
  }, [client, isConnected, queryClient, scope]);
}
