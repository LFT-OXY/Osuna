import React, { createContext, useContext, useMemo, type ReactNode } from "react";
import { useHostFeature } from "@/runtime/host-features";
import { useAgentUsageEvents, type AgentUsageScope } from "./use-agent-usage";

const AgentUsageScopeContext = createContext<AgentUsageScope | null>(null);

/**
 * Which agent the turn footers below belong to, plus the `usage.updated`
 * subscription that keeps them fresh. The stream view mounts it, so every
 * surface that renders turn footers gets usage without wiring of its own. The
 * composer's context meter is a sibling, not a descendant, and subscribes for
 * itself.
 *
 * The scope is `null` — and the footers show nothing — when the host cannot
 * answer at all.
 */
export function AgentUsageScopeProvider({
  serverId,
  agentId,
  children,
}: {
  serverId: string;
  agentId: string;
  children: ReactNode;
}) {
  // COMPAT(usage): added in v0.8.2, remove gate after 2027-09-19.
  const isSupported = useHostFeature(serverId, "usage");
  const scope = useMemo<AgentUsageScope | null>(
    () => (isSupported && serverId && agentId ? { serverId, agentId } : null),
    [agentId, isSupported, serverId],
  );
  useAgentUsageEvents(scope);
  return (
    <AgentUsageScopeContext.Provider value={scope}>{children}</AgentUsageScopeContext.Provider>
  );
}

export function useAgentUsageScope(): AgentUsageScope | null {
  return useContext(AgentUsageScopeContext);
}
