import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { ProviderUsageListPayload, ProviderUsageView } from "./types";
import { PROVIDER_USAGE_CLIENT_UNAVAILABLE_KEY, resolveProviderUsageView } from "./view";

export const PROVIDER_USAGE_STALE_TIME_MS = 5 * 60 * 1000;
// 与 daemon 的 5 分钟缓存对齐：常驻显示的自动刷新不会多打提供方的账户接口。
export const PROVIDER_USAGE_AUTO_REFRESH_MS = PROVIDER_USAGE_STALE_TIME_MS;

export type ProviderUsageClient = Pick<DaemonClient, "listProviderUsage">;

export function providerUsageQueryKey(serverId: string | null | undefined) {
  return ["providerUsage", serverId ?? ""] as const;
}

interface ProviderUsageQueryInput {
  serverId: string | null | undefined;
  client: ProviderUsageClient | null;
  enabled: boolean;
  /** 常驻显示（窄栏）定时刷新；弹层只在打开时取数。 */
  autoRefresh: boolean;
}

/** 窄栏、圆环弹层和「用量」页共用一个查询键，数据只存一份。 */
export function providerUsageQueryInput(input: ProviderUsageQueryInput) {
  const { client, enabled } = input;
  const shouldPoll = enabled && input.autoRefresh;
  const refetchInterval = shouldPoll ? PROVIDER_USAGE_AUTO_REFRESH_MS : (false as const);
  const queryKey = providerUsageQueryKey(input.serverId);
  async function queryFn(): Promise<ProviderUsageListPayload> {
    if (!client) {
      throw new Error(PROVIDER_USAGE_CLIENT_UNAVAILABLE_KEY);
    }
    return client.listProviderUsage();
  }
  return {
    queryKey,
    queryFn,
    enabled,
    dataShape: "value" as const,
    staleTimeMs: PROVIDER_USAGE_STALE_TIME_MS,
    refetchInterval,
  };
}

interface UseProviderUsageOptions {
  enabled?: boolean;
  autoRefresh?: boolean;
}

export function useProviderUsage(
  serverId: string | null | undefined,
  options: UseProviderUsageOptions = {},
): {
  view: ProviderUsageView;
  refresh: () => Promise<void>;
  canFetch: boolean;
} {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supportsProviderUsage = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.providerUsageList === true,
  );
  const canFetch = Boolean(serverId && client && isConnected && supportsProviderUsage);
  const enabled = Boolean((options.enabled ?? true) && canFetch);
  const autoRefresh = options.autoRefresh ?? false;
  const queryInput = useMemo(
    () => providerUsageQueryInput({ serverId, client, enabled, autoRefresh }),
    [autoRefresh, client, enabled, serverId],
  );
  const query = useFetchQuery(queryInput);
  const { queryKey, queryFn } = queryInput;

  const refresh = useCallback(async () => {
    if (!canFetch) return;
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.fetchQuery({
      queryKey,
      queryFn,
      staleTime: PROVIDER_USAGE_STALE_TIME_MS,
    });
  }, [canFetch, queryClient, queryFn, queryKey]);

  const view = useMemo<ProviderUsageView>(
    () =>
      resolveProviderUsageView({
        isConnected: Boolean(serverId && client && isConnected),
        isSupported: supportsProviderUsage,
        payload: query.data,
        isFetching: query.isFetching,
        isError: query.isError,
        error: query.error,
      }),
    [
      client,
      isConnected,
      query.data,
      query.error,
      query.isError,
      query.isFetching,
      serverId,
      supportsProviderUsage,
    ],
  );

  return { view, refresh, canFetch };
}
