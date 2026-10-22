import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ApiEndpointBalanceReading } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useFetchQuery } from "@/data/query";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { balanceReadFlags, type BalanceReadKind } from "./internal/balance-reads";

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

// 页面开着、「自动刷新余额与套餐用量」开着时多久读一次；daemon 那边每家的读数也留一分钟。
const BALANCE_REFRESH_MS = 60_000;

/**
 * 这几家接口的余额：打开页面（含窗口回到前台）时读，点刷新强制重读；autoRefresh 开着时页面开着每分钟再读一次。
 * 打开页面算用户要求的读取，开关关着时 daemon 也照读（30 秒内重开不算，balance-reads.ts）；每分钟那次不算。
 * 页面看不见时不读（docs：hooks-and-data 的门控）。主机没声明 apiEndpointBalance 时为 off：页面上不出余额，旧视图照旧。
 */
export function useEndpointBalances(input: {
  serverId: string;
  endpointIds: readonly string[] | null;
  autoRefresh: boolean;
}): EndpointBalances {
  const { t } = useTranslation();
  const { serverId, autoRefresh } = input;
  const endpointIds = input.endpointIds ?? NO_IDS;
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isAppVisible = useAppActivelyVisible();
  const isPanelActive = useRetainedPanelActive();
  const isVisible = isAppVisible && isPanelActive;
  // COMPAT(apiEndpointBalance): added in v0.17.0, remove gate after 2027-04-22. 老主机没有 read_balance。
  const hasBalance = useHostFeature(serverId, "apiEndpointBalance");
  const idsKey = endpointIds.join(",");
  const canRead =
    Boolean(client) && isConnected && isVisible && hasBalance && endpointIds.length > 0;
  // 已经为哪组接口读过「打开」那次；挂上时、页面看不见之后为 null，下一次读就算打开。
  const openedFor = useRef<string | null>(null);
  const isForcing = useRef(false);
  useEffect(() => {
    if (!isVisible) openedFor.current = null;
  }, [isVisible]);
  const query = useFetchQuery({
    queryKey: ["api-endpoint-balances", serverId, idsKey],
    dataShape: "value",
    staleTimeMs: 0,
    enabled: canRead,
    retry: false,
    refetchInterval: autoRefresh ? BALANCE_REFRESH_MS : false,
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      let kind: BalanceReadKind = openedFor.current === idsKey ? "timed" : "open";
      if (isForcing.current) kind = "force";
      isForcing.current = false;
      openedFor.current = idsKey;
      const flags = balanceReadFlags({ serverId, endpointIds, kind, now: Date.now() });
      const answer = await client.apiEndpointReadBalance({
        endpointIds: [...endpointIds],
        ...flags,
      });
      if (answer.error !== null) throw new Error(answer.error.message);
      return answer.readings;
    },
  });
  const { refetch } = query;
  const refresh = useCallback(() => {
    isForcing.current = true;
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
