import type { UsageBackfill } from "@getpaseo/protocol/usage/types";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetchQuery } from "@/data/query";
import { getHostRuntimeStore, useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import {
  fetchUsageReport,
  usageQueryBaseKey,
  type UsageHostError,
  type UsageHostInput,
} from "@/usage-stats/aggregated-usage";
import { usageRequestsQueryBaseKey } from "@/usage-stats/aggregated-requests";
import { usageSessionsQueryBaseKey } from "@/usage-stats/aggregated-sessions";
import {
  EMPTY_USAGE_REPORT,
  mergeUsageBackfill,
  type MergedUsageReport,
} from "@/usage-stats/merge";
import type { UsageRange } from "@/usage-stats/period";

/** A burst of `usage.updated` after one turn should cost one refetch, not five. */
const USAGE_UPDATED_DEBOUNCE_MS = 400;
const NO_SERVERS: readonly string[] = [];

export type UsageReportLoadState =
  | { status: "connecting" }
  | { status: "loading" }
  | { status: "loaded"; data: MergedUsageReport };

export interface UseUsageReportInput {
  hosts: readonly UsageHostInput[];
  range: UsageRange;
  timezone: string;
  /** Only these API endpoints' usage (`null` is Official); see `fetchUsageReport`. */
  endpoints?: readonly (string | null)[];
  /** False keeps the query and its live events idle. */
  enabled?: boolean;
}

export interface UseUsageReportResult {
  loadState: UsageReportLoadState;
  hostErrors: UsageHostError[];
  /** Live progress when any host is still backfilling, otherwise the report's own field. */
  backfill: UsageBackfill;
  isError: boolean;
  error: Error | null;
  isRefetching: boolean;
  refetch: () => void;
}

export function usageReportQueryKey(input: {
  serverIds: readonly string[];
  range: UsageRange;
  timezone: string;
  endpoints?: readonly (string | null)[];
}) {
  return [
    ...usageQueryBaseKey,
    [...input.serverIds].sort().join("|"),
    input.range.from ?? "all",
    input.range.to ?? "all",
    input.timezone,
    input.endpoints ? input.endpoints.map((id) => id ?? "").join("|") : "any-endpoint",
  ] as const;
}

export function useUsageReport(input: UseUsageReportInput): UseUsageReportResult {
  const runtime = getHostRuntimeStore();
  const hosts = input.hosts;
  const enabled = input.enabled ?? true;
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  const connectionStatusKey = useMemo(
    () => serverIds.map((serverId) => connectionStatuses.get(serverId) ?? "connecting").join("|"),
    [connectionStatuses, serverIds],
  );

  const query = useFetchQuery({
    queryKey: [
      ...usageReportQueryKey({
        serverIds,
        range: input.range,
        timezone: input.timezone,
        endpoints: input.endpoints,
      }),
      connectionStatusKey,
    ],
    queryFn: () =>
      fetchUsageReport({
        hosts,
        runtime,
        range: input.range,
        timezone: input.timezone,
        endpoints: input.endpoints,
      }),
    enabled,
    dataShape: "list",
    staleTimeMs: 5_000,
  });

  const queryClient = useQueryClient();
  const refetch = useCallback(() => {
    void query.refetch();
    // An expanded day and the Requests tab list the rows the report just recounted, so they go
    // stale with it; the card refetches whatever it shows.
    void queryClient.invalidateQueries({ queryKey: usageSessionsQueryBaseKey });
    void queryClient.invalidateQueries({ queryKey: usageRequestsQueryBaseKey });
  }, [query, queryClient]);

  const liveBackfill = useUsageLiveEvents({
    serverIds: enabled ? serverIds : NO_SERVERS,
    onUsageUpdated: refetch,
  });

  let loadState: UsageReportLoadState;
  if (query.data?.status === "connecting") {
    loadState = { status: "connecting" };
  } else if (query.data?.status === "loaded") {
    loadState = { status: "loaded", data: query.data.data };
  } else {
    loadState = { status: "loading" };
  }

  const reportBackfill =
    query.data?.status === "loaded" ? query.data.data.backfill : EMPTY_USAGE_REPORT.backfill;

  return {
    loadState,
    hostErrors: query.data?.status === "loaded" ? query.data.hostErrors : [],
    backfill: liveBackfill ?? reportBackfill,
    isError: query.isError,
    error: query.error,
    isRefetching: query.isRefetching,
    refetch,
  };
}

/**
 * `usage.updated` means new rows landed, so the report is refetched (debounced).
 * `usage.pricing.updated` leaves the rows alone but changes what they cost, and
 * cost is computed at query time, so it refetches the same way.
 * `usage.backfill.progress` only moves the pill until it reports `done`, which
 * is also new rows.
 */
function useUsageLiveEvents(input: {
  serverIds: readonly string[];
  onUsageUpdated: () => void;
}): UsageBackfill | null {
  const runtime = getHostRuntimeStore();
  const [backfillByServer, setBackfillByServer] = useState<Record<string, UsageBackfill>>({});
  const serverIdKey = useMemo(() => [...input.serverIds].sort().join("|"), [input.serverIds]);
  const onUsageUpdated = input.onUsageUpdated;
  const refreshRef = useRef(onUsageUpdated);
  refreshRef.current = onUsageUpdated;

  useEffect(() => {
    const serverIds = serverIdKey ? serverIdKey.split("|") : [];
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        refreshRef.current();
      }, USAGE_UPDATED_DEBOUNCE_MS);
    };

    const observations = serverIds.flatMap((serverId) => {
      const client = runtime.getClient(serverId);
      if (!client) return [];
      const observation = client.observeEvents([
        "usage.updated",
        "usage.pricing.updated",
        "usage.backfill.progress",
      ]);
      observation.subscribe({
        snapshot: () => {},
        update: (message) => {
          if (message.type === "usage.updated" || message.type === "usage.pricing.updated") {
            scheduleRefetch();
            return;
          }
          if (message.type !== "usage.backfill.progress") return;
          const backfill = message.payload;
          setBackfillByServer((previous) => ({ ...previous, [serverId]: backfill }));
          if (backfill.state === "done") scheduleRefetch();
        },
      });
      return [observation];
    });

    return () => {
      if (debounce) clearTimeout(debounce);
      for (const observation of observations) {
        void observation.release().catch(() => {
          /* The socket is gone; the daemon drops the subscription with it. */
        });
      }
    };
  }, [runtime, serverIdKey]);

  return useMemo(() => {
    const serverIds = serverIdKey ? serverIdKey.split("|") : [];
    const entries = serverIds.flatMap((serverId) => {
      const backfill = backfillByServer[serverId];
      return backfill ? [backfill] : [];
    });
    return entries.length === 0 ? null : mergeUsageBackfill(entries);
  }, [backfillByServer, serverIdKey]);
}
