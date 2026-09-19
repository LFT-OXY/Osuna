import { useMemo } from "react";
import { useHostFeatureMap } from "@/runtime/host-features";
import { useHosts } from "@/runtime/host-runtime";
import type { UsageHostInput } from "./aggregated-usage";

export interface UseUsageHostsResult {
  /** Saved hosts that advertise `features.usage`; the only ones worth asking. */
  hosts: UsageHostInput[];
  /** True once any connected host advertises the feature. */
  isAvailable: boolean;
}

// COMPAT(usage): added in v0.8.2, remove gate after 2027-09-19.
export function useUsageHosts(): UseUsageHostsResult {
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const supported = useHostFeatureMap(serverIds, "usage");

  return useMemo(() => {
    const supportedHosts = hosts
      .filter((host) => supported.get(host.serverId) === true)
      .map((host) => ({ serverId: host.serverId, serverName: host.label }));
    return { hosts: supportedHosts, isAvailable: supportedHosts.length > 0 };
  }, [hosts, supported]);
}
