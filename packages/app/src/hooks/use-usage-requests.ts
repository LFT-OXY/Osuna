import type { UsageRequestFilters } from "@getpaseo/protocol/usage/types";
import { useMemo } from "react";
import { useFetchQuery } from "@/data/query";
import { getHostRuntimeStore, useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import {
  fetchUsageRequests,
  usageRequestsQueryBaseKey,
  type FetchUsageRequestsState,
} from "@/usage-stats/aggregated-requests";
import type { UsageHostError, UsageHostInput } from "@/usage-stats/aggregated-usage";
import type { UsageRange } from "@/usage-stats/period";
import type { MergedUsageRequests } from "@/usage-stats/requests";

export interface UseUsageRequestsInput {
  hosts: readonly UsageHostInput[];
  range: UsageRange;
  timezone: string;
  filters: UsageRequestFilters;
  offset: number;
  limit: number;
}

export type UsageRequestsLoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "loaded";
      data: MergedUsageRequests;
      hostErrors: UsageHostError[];
      isFetching: boolean;
    };

export function usageRequestsQueryKey(input: {
  serverIds: readonly string[];
  range: UsageRange;
  timezone: string;
  filters: UsageRequestFilters;
  offset: number;
  limit: number;
}) {
  return [
    ...usageRequestsQueryBaseKey,
    [...input.serverIds].sort().join("|"),
    input.range.from ?? "all",
    input.range.to ?? "all",
    input.timezone,
    JSON.stringify(input.filters),
    input.offset,
    input.limit,
  ] as const;
}

/**
 * One page of the Requests tab from every counted host. The previous page stays
 * on screen while the next one loads; the skeleton is only for the first load.
 * `usage.updated` refetches it through the report's refetch.
 */
export function useUsageRequests(input: UseUsageRequestsInput): UsageRequestsLoadState {
  const runtime = getHostRuntimeStore();
  const hosts = input.hosts;
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  const connectionStatusKey = useMemo(
    () => serverIds.map((serverId) => connectionStatuses.get(serverId) ?? "connecting").join("|"),
    [connectionStatuses, serverIds],
  );

  const query = useFetchQuery({
    queryKey: [
      ...usageRequestsQueryKey({
        serverIds,
        range: input.range,
        timezone: input.timezone,
        filters: input.filters,
        offset: input.offset,
        limit: input.limit,
      }),
      connectionStatusKey,
    ],
    queryFn: (): Promise<FetchUsageRequestsState> =>
      fetchUsageRequests({
        hosts,
        runtime,
        range: input.range,
        timezone: input.timezone,
        filters: input.filters,
        offset: input.offset,
        limit: input.limit,
      }),
    dataShape: "list",
    staleTimeMs: 5_000,
  });

  if (query.data?.status === "loaded") {
    return {
      status: "loaded",
      data: query.data.data,
      hostErrors: query.data.hostErrors,
      isFetching: query.isFetching,
    };
  }
  if (query.isError) return { status: "error" };
  return { status: "loading" };
}
