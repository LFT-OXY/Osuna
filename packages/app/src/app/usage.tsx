import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { UsageScreen } from "@/screens/usage-screen";

export default function UsageRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <UsageScreen />
    </HostRouteBootstrapBoundary>
  );
}
