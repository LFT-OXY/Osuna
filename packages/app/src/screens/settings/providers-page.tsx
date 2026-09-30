import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { ProviderDetailPage } from "@/provider-detail/view";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";
import { buildProviderSettingsRoute } from "@/utils/host-routes";
import {
  PROVIDERS_COLUMN_GAP,
  PROVIDERS_DETAIL_MAX_WIDTH,
  PROVIDERS_LIST_WIDTH,
  resolveSelectedProvider,
  type ProvidersLayout,
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

export function ProvidersPage({ serverId, requestedProvider, layout }: ProvidersPageProps) {
  const router = useRouter();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { entries } = useProvidersSnapshot(serverId);
  const openProviderSettings = useProviderSettingsStore((state) => state.open);

  const providerIds = useMemo(() => entries?.map((entry) => entry.provider) ?? [], [entries]);
  const selectableProviderIds = isConnected ? providerIds : NO_PROVIDERS;
  const selectedProvider = resolveSelectedProvider({
    requested: requestedProvider,
    providerIds: selectableProviderIds,
  });
  const addressLagsSelection =
    layout === "split" && selectedProvider !== null && selectedProvider !== requestedProvider;

  // 两列布局下地址始终指向右侧显示的提供方；replace 让返回键不逐个回退选中项。
  useEffect(() => {
    if (!addressLagsSelection || !selectedProvider) return;
    router.replace(buildProviderSettingsRoute(serverId, selectedProvider));
  }, [addressLagsSelection, router, selectedProvider, serverId]);

  const handleSelectProvider = useCallback(
    (providerId: string) => {
      if (layout === "split") {
        router.replace(buildProviderSettingsRoute(serverId, providerId));
        return;
      }
      openProviderSettings({ serverId, provider: providerId });
    },
    [layout, openProviderSettings, router, serverId],
  );

  if (layout === null) return null;

  if (layout === "stacked") {
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
