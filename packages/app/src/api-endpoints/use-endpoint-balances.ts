import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ApiEndpointBalanceReading } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export type EndpointBalances =
  | { status: "off" }
  | { status: "loading" }
  | { status: "error"; message: string; isRefreshing: boolean; refresh: () => void }
  | {
      status: "ready";
      readings: ReadonlyMap<string, ApiEndpointBalanceReading>;
      isRefreshing: boolean;
      refresh: () => void;
    };

const NO_IDS: readonly string[] = [];

/**
 * 这几家接口的余额：挂着这个 hook 的页面打开时读一次，点刷新再读。
 * 主机没声明 apiEndpointBalance 时为 off：页面上不出余额，旧视图照旧。
 */
export function useEndpointBalances(input: {
  serverId: string;
  endpointIds: readonly string[] | null;
}): EndpointBalances {
  const { t } = useTranslation();
  const { serverId } = input;
  const endpointIds = input.endpointIds ?? NO_IDS;
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  // COMPAT(apiEndpointBalance): added in v0.17.0, remove gate after 2027-04-22. 老主机没有 read_balance。
  const hasBalance = useHostFeature(serverId, "apiEndpointBalance");
  const idsKey = endpointIds.join(",");
  const canRead = Boolean(client) && isConnected && hasBalance && endpointIds.length > 0;
  const query = useFetchQuery({
    queryKey: ["api-endpoint-balances", serverId, idsKey],
    dataShape: "value",
    staleTimeMs: 0,
    enabled: canRead,
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const answer = await client.apiEndpointReadBalance({ endpointIds: [...endpointIds] });
      if (answer.error !== null) throw new Error(answer.error.message);
      return answer.readings;
    },
  });
  const { refetch } = query;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const readings = useMemo(
    () => new Map((query.data ?? []).map((reading) => [reading.endpointId, reading])),
    [query.data],
  );
  if (!hasBalance) return { status: "off" };
  if (query.error) {
    return {
      status: "error",
      message: query.error.message,
      isRefreshing: query.isFetching,
      refresh,
    };
  }
  if (!query.data) return { status: "loading" };
  return { status: "ready", readings, isRefreshing: query.isFetching, refresh };
}
