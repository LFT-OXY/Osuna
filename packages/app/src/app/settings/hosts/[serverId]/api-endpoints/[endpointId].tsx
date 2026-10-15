import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import SettingsScreen from "@/screens/settings-screen";
import { normalizeProjectSettingsRouteId } from "@/utils/host-routes";

export default function SettingsHostApiEndpointDetailRoute() {
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    endpointId?: string | string[];
  }>();
  const serverId = normalizeProjectSettingsRouteId(params.serverId);
  const endpointId = normalizeProjectSettingsRouteId(params.endpointId);
  const view = useMemo(
    () => ({ kind: "apiEndpoint" as const, serverId, endpointId }),
    [endpointId, serverId],
  );

  return (
    <HostRouteBootstrapBoundary>
      <SettingsScreen view={view} />
    </HostRouteBootstrapBoundary>
  );
}
