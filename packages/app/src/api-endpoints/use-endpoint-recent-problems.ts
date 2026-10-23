import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { ApiEndpointRecentProblem } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useFetchQuery } from "@/data/query";
import { extractFailureReason } from "@/price-table/pricing";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export type EndpointRecentProblems =
  | { status: "off" }
  | { status: "loading" }
  | { status: "error"; message: string; isRetrying: boolean; retry: () => void }
  | { status: "ready"; problems: readonly ApiEndpointRecentProblem[] };

// 一轮里接连几条 usage.updated 只重读一次（同用量页）。
const USAGE_UPDATED_DEBOUNCE_MS = 400;

function recentProblemsQueryKey(serverId: string, endpointId: string) {
  return ["api-endpoint-recent-problems", serverId, endpointId] as const;
}

/**
 * 这家接口的「最近异常」：页面看得见时读，开着时随 usage.updated 重读（账本写入后 daemon 发它）。
 * 主机没声明 gatewayLedger 时为 off：页面上不出这一区。
 */
export function useEndpointRecentProblems(input: {
  serverId: string;
  endpointId: string;
}): EndpointRecentProblems {
  const { t } = useTranslation();
  const { serverId, endpointId } = input;
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isAppVisible = useAppActivelyVisible();
  const isPanelActive = useRetainedPanelActive();
  const isVisible = isAppVisible && isPanelActive;
  // COMPAT(gatewayLedger): added in v0.17.0, remove gate after 2027-04-23. 老主机没有 recent_problems。
  const hasLedger = useHostFeature(serverId, "gatewayLedger");
  const canRead = Boolean(client) && isConnected && isVisible && hasLedger;
  const query = useFetchQuery({
    queryKey: recentProblemsQueryKey(serverId, endpointId),
    dataShape: "list",
    staleTimeMs: 5_000,
    enabled: canRead,
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return (await client.apiEndpointRecentProblems(endpointId)).problems;
    },
  });

  const queryClient = useQueryClient();
  useEffect(() => {
    if (!client || !canRead) return;
    const observation = client.observeEvents(["usage.updated"]);
    let debounce: ReturnType<typeof setTimeout> | null = null;
    observation.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type !== "usage.updated") return;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          debounce = null;
          void queryClient.invalidateQueries({
            queryKey: recentProblemsQueryKey(serverId, endpointId),
          });
        }, USAGE_UPDATED_DEBOUNCE_MS);
      },
    });
    return () => {
      if (debounce) clearTimeout(debounce);
      void observation.release().catch(() => {
        /* The socket is gone; the daemon drops the subscription with it. */
      });
    };
  }, [canRead, client, endpointId, queryClient, serverId]);

  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  if (!hasLedger) return { status: "off" };
  if (query.error) {
    // daemon 的报错去掉日志用的 requestType= / code= 再给人看。
    const message = extractFailureReason(query.error) || query.error.message;
    return { status: "error", message, isRetrying: query.isFetching, retry };
  }
  if (!query.data) return { status: "loading" };
  return { status: "ready", problems: query.data };
}
