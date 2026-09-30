import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { ProviderDetailPage } from "@/provider-detail/view";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { buildProviderSettingsRoute, buildSettingsHostSectionRoute } from "@/utils/host-routes";
import {
  PROVIDERS_COLUMN_GAP,
  PROVIDERS_DETAIL_MAX_WIDTH,
  PROVIDERS_LIST_WIDTH,
  resolveSelectedProvider,
  resolveStackedProvidersView,
  type ProvidersLayout,
  type StackedProvidersView,
} from "./providers-layout";
import { ProvidersSection } from "./providers-section";

const NO_PROVIDERS: readonly string[] = [];

export interface ProvidersPageProps {
  serverId: string;
  // 地址里的提供方；Providers 分区本身为 null。
  requestedProvider: string | null;
  // 设置页量到详情区宽度前为 null，此时什么都不渲染，也不 redirect。
  layout: ProvidersLayout | null;
}

// 栈式下地址对应的内容；页头与正文共用，保证两边判断一致。
export function useStackedProvidersView(
  serverId: string,
  requestedProvider: string | null,
): StackedProvidersView {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { entries } = useProvidersSnapshot(serverId);
  const knownProviderIds = useMemo(() => {
    if (!isConnected || !entries) return null;
    return entries.map((entry) => entry.provider);
  }, [entries, isConnected]);
  return resolveStackedProvidersView({
    requested: requestedProvider,
    providerIds: knownProviderIds,
  });
}

export function ProvidersPage({ serverId, requestedProvider, layout }: ProvidersPageProps) {
  const router = useRouter();
  // Stack 下层被盖住的设置页仍然挂载；地址只由当前页改，免得下层页按它的状态 replace 掉当前页。
  const isFocused = useIsFocused();
  const isCompact = useIsCompactFormFactor();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { entries } = useProvidersSnapshot(serverId);

  const providerIds = useMemo(() => entries?.map((entry) => entry.provider) ?? [], [entries]);
  const selectableProviderIds = isConnected ? providerIds : NO_PROVIDERS;
  const selectedProvider = resolveSelectedProvider({
    requested: requestedProvider,
    providerIds: selectableProviderIds,
  });
  const stackedView = useStackedProvidersView(serverId, requestedProvider);
  const addressLagsSelection =
    layout === "split" && selectedProvider !== null && selectedProvider !== requestedProvider;
  const addressNamesMissingProvider = layout === "stacked" && stackedView.kind === "missing";

  // 两列布局下地址始终指向右侧显示的提供方；replace 让返回键不逐个回退选中项。
  useEffect(() => {
    if (!isFocused || !addressLagsSelection || !selectedProvider) return;
    router.replace(buildProviderSettingsRoute(serverId, selectedProvider));
  }, [addressLagsSelection, isFocused, router, selectedProvider, serverId]);

  useEffect(() => {
    if (!isFocused || !addressNamesMissingProvider) return;
    router.replace(buildSettingsHostSectionRoute(serverId, "providers"));
  }, [addressNamesMissingProvider, isFocused, router, serverId]);

  const handleSelectProvider = useCallback(
    (providerId: string) => {
      const route = buildProviderSettingsRoute(serverId, providerId);
      if (layout === "split") {
        router.replace(route);
        return;
      }
      router.push(route);
    },
    [layout, router, serverId],
  );

  if (layout === null) return null;

  if (layout === "stacked") {
    if (stackedView.kind === "detail") {
      return (
        <ProviderDetailPage
          key={stackedView.provider}
          serverId={serverId}
          provider={stackedView.provider}
          hasScreenHeaderActions={isCompact}
        />
      );
    }
    return (
      <ProvidersSection
        serverId={serverId}
        layout={layout}
        selectedProvider={null}
        onSelectProvider={handleSelectProvider}
      />
    );
  }

  return (
    <View style={styles.split}>
      <View style={styles.listColumn}>
        <ProvidersSection
          serverId={serverId}
          layout={layout}
          selectedProvider={selectedProvider}
          onSelectProvider={handleSelectProvider}
        />
      </View>
      <View style={styles.detailColumn} testID="provider-detail-pane">
        {selectedProvider ? (
          <ProviderDetailPage
            key={selectedProvider}
            serverId={serverId}
            provider={selectedProvider}
            hasScreenHeaderActions={false}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  split: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: PROVIDERS_COLUMN_GAP,
  },
  listColumn: {
    width: PROVIDERS_LIST_WIDTH,
    flexShrink: 0,
    // 列表跟着页面滚动时停在顶部，右侧详情再长也能随时切换。
    _web: {
      position: "sticky",
      top: theme.spacing[6],
    },
  },
  detailColumn: {
    flex: 1,
    minWidth: 0,
    maxWidth: PROVIDERS_DETAIL_MAX_WIDTH,
  },
}));
