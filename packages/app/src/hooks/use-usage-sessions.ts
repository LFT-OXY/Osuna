import { useMemo } from "react";
import { useFetchQuery } from "@/data/query";
import { getHostRuntimeStore, useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import {
  fetchUsageSessions,
  usageSessionsQueryBaseKey,
  type FetchUsageSessionsState,
} from "@/usage/aggregated-sessions";
import type { UsageHostError, UsageHostInput } from "@/usage/aggregated-usage";
import type { MergedUsageSession } from "@/usage/sessions";

export interface UseUsageSessionsInput {
  hosts: readonly UsageHostInput[];
  /** The local day to list; one expanded row of the daily table. */
  day: string;
  timezone: string;
}

export interface UseUsageSessionsResult {
  sessions: MergedUsageSession[];
  /** A host left rows out of this day, so the list is not the whole day. */
  truncated: boolean;
  hostErrors: UsageHostError[];
  isPending: boolean;
  isError: boolean;
}

export function usageSessionsQueryKey(input: {
  serverIds: readonly string[];
  day: string;
  timezone: string;
}) {
  return [
    ...usageSessionsQueryBaseKey,
    [...input.serverIds].sort().join("|"),
    input.day,
    input.timezone,
  ] as const;
}

/** One day's sessions from every counted host, added together. */
export function useUsageSessions(input: UseUsageSessionsInput): UseUsageSessionsResult {
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
      ...usageSessionsQueryKey({ serverIds, day: input.day, timezone: input.timezone }),
      connectionStatusKey,
    ],
    queryFn: (): Promise<FetchUsageSessionsState> =>
      fetchUsageSessions({
        hosts,
        runtime,
        day: input.day,
        timezone: input.timezone,
      }),
    dataShape: "list",
    staleTimeMs: 5_000,
  });

  const loaded = query.data?.status === "loaded" ? query.data : null;
  return {
    sessions: loaded?.data.sessions ?? [],
    truncated: loaded?.data.truncated ?? false,
    hostErrors: loaded?.hostErrors ?? [],
    isPending: loaded === null && !query.isError,
    isError: query.isError,
  };
}
