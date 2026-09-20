import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQueries } from "@/data/query";
import { useHostFeatureMap } from "@/runtime/host-features";
import { getHostRuntimeStore, useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import type { UsageHostInput } from "@/usage/aggregated-usage";
import { PROVIDER_USAGE_STALE_TIME_MS, providerUsageQueryKey } from "./use-provider-usage";
import type { ProviderUsageListPayload, ProviderUsageView } from "./types";
import { PROVIDER_USAGE_CLIENT_UNAVAILABLE_KEY, resolveProviderUsageView } from "./view";

export interface ProviderUsageHostGroup {
  serverId: string;
  serverName: string;
  view: ProviderUsageView;
}

export interface UseProviderUsageHostsResult {
  groups: ProviderUsageHostGroup[];
  /** 最近一次成功取数的时刻，卡片头部按它显示「多久之前」。 */
  fetchedAt: string | null;
  isBusy: boolean;
  refresh: () => void;
}

/**
 * 「用量」页的套餐用量跟随页面的主机筛选：页面把几台主机的数字加在一起，只显示
 * 其中一台的套餐会和上面的大数字自相矛盾。每台主机一条查询，互不影响。
 */
export function useProviderUsageHosts(
  hosts: readonly UsageHostInput[],
): UseProviderUsageHostsResult {
  const runtime = getHostRuntimeStore();
  const queryClient = useQueryClient();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const supported = useHostFeatureMap(serverIds, "providerUsageList");
  const connection = useHostRuntimeConnectionStatuses(serverIds);

  const results = useFetchQueries<ProviderUsageListPayload>(
    hosts.map((host) => ({
      queryKey: providerUsageQueryKey(host.serverId),
      queryFn: async () => {
        const client = runtime.getClient(host.serverId);
        if (!client) throw new Error(PROVIDER_USAGE_CLIENT_UNAVAILABLE_KEY);
        return client.listProviderUsage();
      },
      enabled: supported.get(host.serverId) === true && connection.get(host.serverId) === "online",
      dataShape: "value",
      staleTimeMs: PROVIDER_USAGE_STALE_TIME_MS,
    })),
  );

  const groups = hosts.map((host, index): ProviderUsageHostGroup => {
    const result = results[index];
    return {
      serverId: host.serverId,
      serverName: host.serverName,
      view: resolveProviderUsageView({
        isConnected: connection.get(host.serverId) === "online",
        isSupported: supported.get(host.serverId) === true,
        payload: result?.data,
        isFetching: result?.isFetching === true,
        isError: result?.isError === true,
        error: result?.error,
      }),
    };
  });

  const fetchedAt = results.reduce<string | null>((latest, result) => {
    const candidate = result.data?.fetchedAt ?? null;
    if (!candidate) return latest;
    return latest && latest >= candidate ? latest : candidate;
  }, null);

  const refresh = useCallback(() => {
    for (const serverId of serverIds) {
      void queryClient.invalidateQueries({ queryKey: providerUsageQueryKey(serverId) });
    }
  }, [queryClient, serverIds]);

  return {
    groups,
    fetchedAt,
    isBusy: results.some((result) => result.isFetching),
    refresh,
  };
}
