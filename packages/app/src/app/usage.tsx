import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { UsageScreen } from "@/screens/usage-screen";
import type { UsageRequestsEndpointIntent } from "@/usage-stats/requests";

export default function UsageRoute() {
  const params = useLocalSearchParams<{
    tab?: string;
    endpoint?: string;
    endpointName?: string;
  }>();
  const endpointId = typeof params.endpoint === "string" ? params.endpoint : "";
  const endpointName = typeof params.endpointName === "string" ? params.endpointName : "";
  // 只有「请求」标签带接口时才是从接口页跳来的；其余地址照常打开用量页。
  const requestsIntent = useMemo<UsageRequestsEndpointIntent | null>(
    () => (params.tab === "requests" && endpointId !== "" ? { endpointId, endpointName } : null),
    [endpointId, endpointName, params.tab],
  );

  return (
    <HostRouteBootstrapBoundary>
      {/* 换了跳转目标就重新挂上，筛选与标签从这次的目标开始。 */}
      <UsageScreen key={JSON.stringify(requestsIntent)} requestsIntent={requestsIntent} />
    </HostRouteBootstrapBoundary>
  );
}
