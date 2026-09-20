import { useMemo } from "react";
import { useHostFeatureAvailabilityMap } from "@/runtime/host-features";
import { useHostRuntimeConnectionStatuses, useHosts } from "@/runtime/host-runtime";
import {
  buildUsageHostOptions,
  resolveUsageHostSelection,
  type UsageHostOption,
  type UsageHostSelection,
} from "./host-options";

export interface UseUsageHostsResult {
  /** Every saved host and why it does or does not count, for the filter menu. */
  options: UsageHostOption[];
  /** Which hosts to ask, once the filter has been applied. */
  selection: UsageHostSelection;
  /** True once any host advertises `features.usage`; gates the sidebar row. */
  isAvailable: boolean;
}

// COMPAT(usage): added in v0.8.2, remove gate after 2027-09-19.
export function useUsageHosts(selectedServerId: string | null = null): UseUsageHostsResult {
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const supported = useHostFeatureAvailabilityMap(serverIds, "usage");
  const connection = useHostRuntimeConnectionStatuses(serverIds);

  const options = useMemo(
    () => buildUsageHostOptions({ hosts, supported, connection }),
    [connection, hosts, supported],
  );
  const selection = useMemo(
    () => resolveUsageHostSelection({ options, selectedServerId }),
    [options, selectedServerId],
  );
  const isAvailable = useMemo(
    () => [...supported.values()].some((value) => value === true),
    [supported],
  );

  return { options, selection, isAvailable };
}
