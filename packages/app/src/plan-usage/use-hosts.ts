import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQueries } from "@/data/query";
import {
  cliSignInsOffQueryInput,
  listHostUsageReports,
  refreshHostUsageReports,
  usageReportsQueryKey,
  USAGE_REPORTS_STALE_TIME_MS,
  useUsageHosts,
} from "@/usage/queries";
import type { UsageQueryState } from "@/usage/model";
import type { UsageReportEntry } from "@/usage/types";
import type { UsageHostInput } from "@/usage-stats/aggregated-usage";
import { resolvePlanUsageHosts, type PlanUsageHosts } from "./hosts";

export interface PlanUsageHostsState extends PlanUsageHosts {
  refresh: () => void;
  /** 没有一台主机能报套餐用量时没有可刷新的东西。 */
  canRefresh: boolean;
}

/**
 * 「用量」页套餐卡片的数据：页面计入的每台主机一条查询，与套餐用量弹窗读的是同一条，
 * 互不影响。刷新绕过 daemon 的缓存，和弹窗的「全部刷新」一样。
 */
export function usePlanUsageHosts(hosts: readonly UsageHostInput[]): PlanUsageHostsState {
  const queryClient = useQueryClient();
  const usageHosts = useUsageHosts();
  const reportingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const host of usageHosts) {
      if (host.isConnected && host.supportsUsage) ids.add(host.serverId);
    }
    return ids;
  }, [usageHosts]);

  const queries = useFetchQueries<UsageReportEntry[]>(
    hosts.map(({ serverId }) => {
      const queryKey = usageReportsQueryKey(serverId);
      const enabled = reportingIds.has(serverId);
      return {
        queryKey,
        queryFn: () => listHostUsageReports(queryClient, serverId),
        enabled,
        dataShape: "list",
        staleTimeMs: USAGE_REPORTS_STALE_TIME_MS,
      };
    }),
  );
  const offAnswers = useFetchQueries<boolean>(
    hosts.map(({ serverId }) => cliSignInsOffQueryInput(serverId)),
  );
  const queryStates = queries.map(
    (query, index): UsageQueryState => ({
      data: query.data,
      error: query.error,
      isFetching: query.isFetching,
      cliSignInsOff: offAnswers[index]?.data === true,
    }),
  );
  const resolved = resolvePlanUsageHosts({ hosts, usageHosts, queries: queryStates });

  const refresh = useCallback(() => {
    for (const host of hosts) {
      if (!reportingIds.has(host.serverId)) continue;
      void refreshHostUsageReports(queryClient, host.serverId).catch(() => undefined);
    }
  }, [hosts, queryClient, reportingIds]);

  const canRefresh = hosts.some((host) => reportingIds.has(host.serverId));
  return { ...resolved, refresh, canRefresh };
}
