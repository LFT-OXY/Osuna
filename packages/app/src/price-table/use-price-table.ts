import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useReplicaQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  PRICE_TABLE_CLIENT_UNAVAILABLE_KEY,
  resolvePriceTableView,
  type PriceTablePayload,
  type PriceTableView,
} from "./view";

export type { PriceTablePayload, PriceTableView };

export function priceTableQueryKey(serverId: string) {
  return ["usagePricing", serverId] as const;
}

export interface UsePriceTableResult {
  view: PriceTableView;
  refetch: () => void;
}

/**
 * 价格表按主机读：每台主机有自己的快照和自己的覆盖表，两台机器之间不同步。
 * `usage.pricing.updated` 是它唯一的失效信号——自己保存覆盖价也会经由 daemon
 * 广播回来，所以保存后不用手动重拉。
 */
export function usePriceTable(serverId: string): UsePriceTableResult {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  // COMPAT(usage): added in v0.8.2, remove gate after 2027-09-19.
  const isSupported = useHostFeature(serverId, "usage");
  const queryClient = useQueryClient();

  const query = useReplicaQuery<PriceTablePayload>({
    queryKey: priceTableQueryKey(serverId),
    enabled: Boolean(client && isConnected && isSupported),
    pushEvent: "usage.pricing.updated",
    queryFn: async () => {
      if (!client) throw new Error(PRICE_TABLE_CLIENT_UNAVAILABLE_KEY);
      return client.usagePricingList();
    },
  });

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: priceTableQueryKey(serverId) });
  }, [queryClient, serverId]);

  useEffect(() => {
    if (!client || !isConnected || !isSupported) return;
    const observation = client.observeEvents(["usage.pricing.updated"]);
    observation.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type !== "usage.pricing.updated") return;
        void queryClient.invalidateQueries({ queryKey: priceTableQueryKey(serverId) });
      },
    });
    return () => {
      void observation.release().catch(() => {
        /* The socket is gone; the daemon drops the subscription with it. */
      });
    };
  }, [client, isConnected, isSupported, queryClient, serverId]);

  return {
    view: resolvePriceTableView({
      isConnected,
      isSupported,
      payload: query.data,
      isError: query.isError,
      error: query.error,
    }),
    refetch,
  };
}
