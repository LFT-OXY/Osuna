import * as Clipboard from "expo-clipboard";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiEndpointsView } from "@/api-endpoints/view";
import {
  resolveProviderDiscoveredModels,
  type ProviderDiscoveredModelsCache,
} from "@/components/provider-diagnostic-models";
import { getProviderIcon } from "@/components/provider-icons";
import { useToast } from "@/contexts/toast-context";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import type { ProviderInstallGuide } from "@/provider-install-guide";
import { ProviderInstallGuideView } from "@/provider-install-guide/view";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { ProviderDetailHeader, ProviderDetailMenu, ProviderDetailRefreshButton } from "./header";
import {
  revealProviderDiagnostic,
  runProviderDiagnostic,
  useProviderDiagnostic,
  useProviderDiagnosticReveal,
} from "./diagnostic";
import { ProviderDetailSurface } from "./index";
import { dismissProviderRemovalError, removeProvider, useProviderRemoval } from "./removal";
import { countSelectableModels, describeProviderModelCount, resolveProviderStatus } from "./status";

/*
 * 运行时接线：快照、daemon 配置、主机能力。安装指引与第三方接口的视图会拉进单测运行器
 * 无法解析的模块，所以只在这里导入；调用方从这里导入。
 */

// 诊断的两种入口：诊断节里就地运行；⋯ 菜单和错误卡先让诊断节滚进视野再运行。
export function useProviderDiagnosticActions(serverId: string, provider: string) {
  const client = useHostRuntimeClient(serverId);
  const run = useCallback(() => {
    void runProviderDiagnostic(serverId, provider, async () => {
      // 没有连接时照样进入失败态，原因为空，诊断节显示「未知错误」。
      if (!client) throw new Error();
      const result = await client.getProviderDiagnostic(provider);
      return result.diagnostic;
    });
  }, [client, provider, serverId]);
  const diagnose = useCallback(() => {
    revealProviderDiagnostic(serverId, provider);
    run();
  }, [provider, run, serverId]);
  return { run, diagnose };
}

export function ProviderDetail({ serverId, provider }: { serverId: string; provider: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { entries, refresh, isRefreshing } = useProvidersSnapshot(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const removal = useProviderRemoval(serverId, provider);
  const diagnostic = useProviderDiagnostic(serverId, provider);
  const diagnosticRevealRequest = useProviderDiagnosticReveal(serverId, provider);
  const { run: runDiagnostic, diagnose } = useProviderDiagnosticActions(serverId, provider);
  const handleCopyDiagnostic = useCallback(
    (output: string) => {
      void Clipboard.setStringAsync(output)
        .then(() => toast.copied(t("settings.providers.diagnostic.copyLabel")))
        .catch(() => toast.error(t("settings.providers.diagnostic.copyFailed")));
    },
    [t, toast],
  );
  const handleDismissRemovalError = useCallback(
    () => dismissProviderRemovalError(serverId, provider),
    [provider, serverId],
  );

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

  // 写入成功即算添加成功，刷新不阻塞添加行收起；新模型经配置先出现在「自定义 Models」里。
  const handleAddCustomModel = useCallback(
    async (modelId: string) => {
      await patchConfig({
        providers: {
          [provider]: {
            additionalModels: [...additionalModels, { id: modelId, label: modelId }],
          },
        },
      });
      void refresh([provider]);
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
      isRefreshing={isRefreshing}
      deletingModelId={deletingModelId}
      removalError={removal.status === "failed" ? removal.message : null}
      diagnostic={diagnostic}
      diagnosticRevealRequest={diagnosticRevealRequest}
      onRefresh={handleRefresh}
      onDiagnose={diagnose}
      onRunDiagnostic={runDiagnostic}
      onCopyDiagnostic={handleCopyDiagnostic}
      onDismissRemovalError={handleDismissRemovalError}
      onDeleteCustomModel={handleDeleteCustomModel}
      onAddCustomModel={handleAddCustomModel}
      renderInstallGuide={renderInstallGuide}
      renderApiEndpoints={renderApiEndpoints}
    />
  );
}

// 详情头部要的数据：设置页的头部块和手机顶栏共用。
export function useProviderDetailHeader(serverId: string, provider: string) {
  const { t } = useTranslation();
  const { entries, refresh, isRefreshing } = useProvidersSnapshot(serverId);
  const { patchConfig } = useDaemonConfig(serverId);
  const supportsProviderRemoval = useHostFeature(serverId, "providerRemoval");
  const removal = useProviderRemoval(serverId, provider);
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
  const icon = getProviderIcon(provider, serverId);
  const label = resolveProviderLabel(provider, entries);

  const handleRefresh = useCallback(() => {
    void refresh([provider]);
  }, [provider, refresh]);
  const providerSource = providerEntry?.source;
  const isRemoving = removal.status === "removing";

  // 删除成功后提供方从快照里消失，由页面的地址修正回到第一个提供方或列表。
  const handleRemove = useCallback(() => {
    void removeProvider(serverId, provider, {
      confirm: () =>
        confirmDialog({
          title: t("settings.providers.remove.confirmTitle", { name: label }),
          message: t("settings.providers.remove.confirmMessage"),
          confirmLabel: t("settings.providers.remove.confirm"),
          destructive: true,
        }),
      remove: () => patchConfig({ removeProviders: [provider] }),
    });
  }, [label, patchConfig, provider, serverId, t]);

  return {
    icon,
    label,
    status,
    modelCount,
    isRefreshing: isProviderRefreshing,
    onRefresh: handleRefresh,
    providerSource,
    hostSupportsRemoval: supportsProviderRemoval,
    isRemoving,
    onRemove: handleRemove,
  };
}

// 设置页的页面外框：头部块加详情内容。
export function ProviderDetailPage({
  serverId,
  provider,
  hasScreenHeaderActions,
}: {
  serverId: string;
  provider: string;
  // 手机上「刷新」和 ⋯ 在顶栏，头部块只留图标、名称、徽章和模型数。
  hasScreenHeaderActions: boolean;
}) {
  const header = useProviderDetailHeader(serverId, provider);
  const { diagnose } = useProviderDiagnosticActions(serverId, provider);
  const {
    label,
    isRefreshing,
    onRefresh,
    providerSource,
    hostSupportsRemoval,
    isRemoving,
    onRemove,
  } = header;
  const renderActions = useCallback(
    () => (
      <>
        <ProviderDetailRefreshButton isRefreshing={isRefreshing} onRefresh={onRefresh} />
        <ProviderDetailMenu
          provider={provider}
          providerLabel={label}
          providerSource={providerSource}
          hostSupportsRemoval={hostSupportsRemoval}
          isRemoving={isRemoving}
          onDiagnose={diagnose}
          onRemove={onRemove}
          placement="inline"
        />
      </>
    ),
    [
      diagnose,
      hostSupportsRemoval,
      isRefreshing,
      isRemoving,
      label,
      onRefresh,
      onRemove,
      provider,
      providerSource,
    ],
  );

  return (
    <>
      <ProviderDetailHeader
        icon={header.icon}
        label={header.label}
        status={header.status}
        modelCount={header.modelCount}
        renderActions={hasScreenHeaderActions ? undefined : renderActions}
        testID={`provider-detail-header-${provider}`}
      />
      <ProviderDetail serverId={serverId} provider={provider} />
    </>
  );
}
