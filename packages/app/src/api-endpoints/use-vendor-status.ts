import { useTranslation } from "react-i18next";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { VendorStatusAnswer } from "./internal/vendor-status";

// 只在「第三方接口」页或用量页开着时每 5 分钟问一次（页面在后台时不问）；daemon 每页 5 分钟最多读一次。
const VENDOR_STATUS_REFRESH_MS = 5 * 60_000;
const NO_EXTRA_VENDORS: readonly string[] = [];

/**
 * 主机上各厂商官方状态页的读数；挂着这个 hook 的页面开着时才轮询。
 * 主机不支持、还没答、或答失败时为 null：提示只是不出，接口列表照常。
 */
export function useVendorStatus(input: {
  serverId: string;
  // 除了接口对上的厂商，另外要看的（用量页的订阅卡片）。
  vendors?: readonly string[];
}): VendorStatusAnswer | null {
  const { t } = useTranslation();
  const { serverId } = input;
  const vendors = input.vendors ?? NO_EXTRA_VENDORS;
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  // COMPAT(apiEndpointManagement): added in v0.17.0, remove gate after 2027-04-19. 老主机没有 vendor_status。
  const hasManagement = useHostFeature(serverId, "apiEndpointManagement");
  const query = useFetchQuery({
    queryKey: ["api-endpoint-vendor-status", serverId, vendors.join(",")],
    dataShape: "value",
    staleTimeMs: 0,
    enabled: Boolean(client) && isConnected && hasManagement,
    retry: false,
    refetchInterval: VENDOR_STATUS_REFRESH_MS,
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.apiEndpointVendorStatus({ vendors: [...vendors] });
    },
  });
  const answer = query.data;
  if (!answer || answer.error !== null) return null;
  return answer;
}
