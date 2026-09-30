import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { ProviderDetailPage } from "@/provider-detail/view";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { buildProviderSettingsRoute, buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { resolveProvidersView, type ProvidersView } from "./providers-view";
import { ProvidersSection } from "./providers-section";

export interface ProvidersPageProps {
  serverId: string;
  // 地址里的提供方；Providers 分区本身为 null。
  requestedProvider: string | null;
}

// 地址对应的内容；页头与正文共用，保证两边判断一致。
export function useProvidersView(
  serverId: string,
  requestedProvider: string | null,
): ProvidersView {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { entries } = useProvidersSnapshot(serverId);
  const knownProviderIds = useMemo(() => {
    if (!isConnected || !entries) return null;
    return entries.map((entry) => entry.provider);
  }, [entries, isConnected]);
  return resolveProvidersView({
    requested: requestedProvider,
    providerIds: knownProviderIds,
  });
}

// 所有宽度都一样：分区地址显示列表，带提供方的地址显示它的详情。
export function ProvidersPage({ serverId, requestedProvider }: ProvidersPageProps) {
  const router = useRouter();
  // Stack 下层被盖住的设置页仍然挂载；地址只由当前页改，免得下层页按它的状态 replace 掉当前页。
  const isFocused = useIsFocused();
  const isCompact = useIsCompactFormFactor();
  const providersView = useProvidersView(serverId, requestedProvider);
  const addressNamesMissingProvider = providersView.kind === "missing";

  useEffect(() => {
    if (!isFocused || !addressNamesMissingProvider) return;
    router.replace(buildSettingsHostSectionRoute(serverId, "providers"));
  }, [addressNamesMissingProvider, isFocused, router, serverId]);

  const handleSelectProvider = useCallback(
    (providerId: string) => {
      router.push(buildProviderSettingsRoute(serverId, providerId));
    },
    [router, serverId],
  );

  if (providersView.kind === "detail") {
    return (
      <ProviderDetailPage
        key={providersView.provider}
        serverId={serverId}
        provider={providersView.provider}
        hasScreenHeaderActions={isCompact}
      />
    );
  }
  return <ProvidersSection serverId={serverId} onSelectProvider={handleSelectProvider} />;
}
