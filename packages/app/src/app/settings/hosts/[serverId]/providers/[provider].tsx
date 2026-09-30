import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import SettingsScreen from "@/screens/settings-screen";
import { normalizeProjectSettingsRouteId } from "@/utils/host-routes";

export default function SettingsHostProviderDetailRoute() {
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    provider?: string | string[];
  }>();
  const serverId = normalizeProjectSettingsRouteId(params.serverId);
  const provider = normalizeProjectSettingsRouteId(params.provider);
  const view = useMemo(
    () => ({ kind: "provider" as const, serverId, provider }),
    [provider, serverId],
  );

  return (
    <HostRouteBootstrapBoundary>
      <SettingsScreen view={view} />
    </HostRouteBootstrapBoundary>
  );
}
