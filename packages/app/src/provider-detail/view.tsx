import React, { useCallback, useMemo, useRef, useState } from "react";
import { ApiEndpointsView } from "@/api-endpoints/view";
import {
  resolveProviderDiscoveredModels,
  type ProviderDiscoveredModelsCache,
} from "@/components/provider-diagnostic-models";
import { getProviderIcon } from "@/components/provider-icons";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import type { ProviderInstallGuide } from "@/provider-install-guide";
import { ProviderInstallGuideView } from "@/provider-install-guide/view";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { ProviderDetailHeader } from "./header";
import { ProviderDetailSurface } from "./index";
import { countSelectableModels, describeProviderModelCount, resolveProviderStatus } from "./status";

/*
 * 运行时接线：快照、daemon 配置、主机能力。安装指引与第三方接口的视图会拉进单测运行器
 * 无法解析的模块，所以只在这里导入；调用方从这里导入。
 */

export function ProviderDetail({
  serverId,
  provider,
  modelQuery,
}: {
  serverId: string;
  provider: string;
  // 弹窗外框把模型搜索放在自己的头部，查询从外框传进来。
  modelQuery: string;
}) {
  const { entries, refresh, isRefreshing } = useProvidersSnapshot(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);

  const providerEntry = useMemo(
    () => entries?.find((entry) => entry.provider === provider),
    [entries, provider],
  );
  const additionalModels = useMemo(
    () => config?.providers?.[provider]?.additionalModels ?? [],
    [config?.providers, provider],
  );
  const hostPlatform = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.hostPlatform,
  );
  const hostSupportsApiEndpoints = useHostFeature(serverId, "apiEndpoints");

  const stableDiscoveredRef = useRef<ProviderDiscoveredModelsCache | null>(null);
  const currentModels = providerEntry?.models;
  const providerSnapshotRefreshing = providerEntry?.status === "loading";
  const { models: discoveredModels, cache: nextDiscoveredCache } = resolveProviderDiscoveredModels({
    serverId,
    provider,
    currentModels,
    providerSnapshotRefreshing,
    previousCache: stableDiscoveredRef.current,
  });
  stableDiscoveredRef.current = nextDiscoveredCache;

  const handleRefresh = useCallback(() => {
    void refresh([provider]);
  }, [provider, refresh]);

  const handleDeleteCustomModel = useCallback(
    (modelId: string) => {
      setDeletingModelId(modelId);
      void patchConfig({
        providers: {
          [provider]: {
            additionalModels: additionalModels.filter((model) => model.id !== modelId),
          },
        },
      })
        .then(() => refresh([provider]))
        .finally(() => {
          setDeletingModelId((current) => (current === modelId ? null : current));
        });
    },
    [additionalModels, patchConfig, provider, refresh],
  );

  const renderInstallGuide = useCallback(
    (guide: ProviderInstallGuide, cliLabel: string) => (
      <ProviderInstallGuideView guide={guide} cliLabel={cliLabel} />
    ),
    [],
  );

  const renderApiEndpoints = useCallback(
    (providerLabel: string) => (
      <ApiEndpointsView serverId={serverId} provider={provider} providerLabel={providerLabel} />
    ),
    [provider, serverId],
  );

  const extendsProvider = config?.providers?.[provider]?.extends;

  return (
    <ProviderDetailSurface
      provider={provider}
      entries={entries}
      extendsProvider={extendsProvider}
      hostPlatform={hostPlatform}
      hostSupportsApiEndpoints={hostSupportsApiEndpoints}
      discoveredModels={discoveredModels}
      additionalModels={additionalModels}
      modelQuery={modelQuery}
      isRefreshing={isRefreshing}
      deletingModelId={deletingModelId}
      onRefresh={handleRefresh}
      onDeleteCustomModel={handleDeleteCustomModel}
      renderInstallGuide={renderInstallGuide}
      renderApiEndpoints={renderApiEndpoints}
    />
  );
}

// 设置页的页面外框：头部块加详情内容。
export function ProviderDetailPage({ serverId, provider }: { serverId: string; provider: string }) {
  const { entries, refresh, isRefreshing } = useProvidersSnapshot(serverId);
  const providerEntry = useMemo(
    () => entries?.find((entry) => entry.provider === provider),
    [entries, provider],
  );
  const snapshotStatus = providerEntry?.status ?? "loading";
  const enabled = providerEntry?.enabled ?? true;
  const status = resolveProviderStatus({ status: snapshotStatus, enabled });
  const isAvailable = status.tone === "success";
  const modelCount = isAvailable
    ? describeProviderModelCount(countSelectableModels(providerEntry?.models))
    : null;
  const isProviderRefreshing = isRefreshing || status.tone === "loading";

  const handleRefresh = useCallback(() => {
    void refresh([provider]);
  }, [provider, refresh]);

  return (
    <>
      <ProviderDetailHeader
        icon={getProviderIcon(provider, serverId)}
        label={resolveProviderLabel(provider, entries)}
        status={status}
        modelCount={modelCount}
        isRefreshing={isProviderRefreshing}
        onRefresh={handleRefresh}
        testID={`provider-detail-header-${provider}`}
      />
      <ProviderDetail serverId={serverId} provider={provider} modelQuery="" />
    </>
  );
}
