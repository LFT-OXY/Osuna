import React, { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { FileText, RotateCw } from "lucide-react-native";
import type { AgentModelDefinition, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { ProviderProfileModel } from "@getpaseo/protocol/provider-config";
import { selectInheritedApiEndpoint, supportsApiEndpoints } from "@/api-endpoints";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Text as UiText } from "@/components/ui/text";
import { resolveProviderInstallGuide, type ProviderInstallGuide } from "@/provider-install-guide";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { settingsStyles } from "@/styles/settings";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import type { ProviderDiagnosticState } from "./diagnostic";
import { ProviderDiagnosticSection } from "./diagnostic-section";
import { ProviderModelsSection } from "./models";

/*
 * 提供方详情的内容区，区块顺序固定：删除失败 → 错误卡 → 继承接口提示 → 安装指引 → 第三方接口 → Models → 诊断。
 * 外框（弹窗或页面）由调用方决定。
 * 这里只收 props，方便 jsdom 测试；运行时接线在 view.tsx。
 * 安装指引与第三方接口的运行时视图在单测运行器里无法加载，所以由调用方经 render 插槽注入。
 */

export interface ProviderDetailSurfaceProps {
  provider: string;
  entries: ProviderSnapshotEntry[] | undefined;
  // daemon 配置里该提供方的 extends 原值，未收窄，交给安装指引解析。
  extendsProvider: unknown;
  hostPlatform: string | undefined;
  hostSupportsApiEndpoints: boolean;
  discoveredModels: AgentModelDefinition[];
  additionalModels: ProviderProfileModel[];
  isRefreshing: boolean;
  deletingModelId: string | null;
  // 删除这个提供方失败的原因；从 ⋯ 菜单删除，失败提示显示在详情顶部。
  removalError: string | null;
  diagnostic: ProviderDiagnosticState;
  // ⋯ 菜单或错误卡要看诊断时加一，诊断节随之滚进视野。
  diagnosticRevealRequest: number;
  onRefresh: () => void;
  // 错误卡的「运行诊断」：同 ⋯ 菜单，滚到诊断节再运行。
  onDiagnose: () => void;
  // 诊断节里的运行、重新运行、重试。
  onRunDiagnostic: () => void;
  onCopyDiagnostic: (output: string) => void;
  onDismissRemovalError: () => void;
  onDeleteCustomModel: (modelId: string) => void;
  onAddCustomModel: (modelId: string) => Promise<void>;
  renderInstallGuide: (guide: ProviderInstallGuide, cliLabel: string) => ReactNode;
  renderApiEndpoints: (providerLabel: string) => ReactNode;
}

function ProviderStartErrorAlert({
  providerLabel,
  message,
  isRefreshing,
  onRefresh,
  onDiagnose,
}: {
  providerLabel: string;
  message: string;
  isRefreshing: boolean;
  onRefresh: () => void;
  onDiagnose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={settingsStyles.section}>
      <Alert
        variant="error"
        title={t("settings.providers.startErrorTitle", { name: providerLabel })}
        testID="provider-start-error"
      >
        {/* 原文要等宽，description 只收字符串，所以原文和按钮一起放进 children。 */}
        <View style={styles.startErrorBody}>
          <UiText
            variant="caption"
            color="foregroundMuted"
            style={styles.errorOutput}
            selectable
            dataSet={CODE_SURFACE_DATASET}
          >
            {message}
          </UiText>
          <View style={styles.startErrorActions}>
            <Button
              variant="outline"
              size="sm"
              leftIcon={isRefreshing ? undefined : RotateCw}
              onPress={onRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing
                ? t("settings.providers.diagnostic.refreshing")
                : t("settings.providers.diagnostic.refresh")}
            </Button>
            <Button variant="outline" size="sm" leftIcon={FileText} onPress={onDiagnose}>
              {t("settings.providers.diagnostic.run")}
            </Button>
          </View>
        </View>
      </Alert>
    </View>
  );
}

export function ProviderDetailSurface({
  provider,
  entries,
  extendsProvider,
  hostPlatform,
  hostSupportsApiEndpoints,
  discoveredModels,
  additionalModels,
  isRefreshing,
  deletingModelId,
  removalError,
  diagnostic,
  diagnosticRevealRequest,
  onRefresh,
  onDiagnose,
  onRunDiagnostic,
  onCopyDiagnostic,
  onDismissRemovalError,
  onDeleteCustomModel,
  onAddCustomModel,
  renderInstallGuide,
  renderApiEndpoints,
}: ProviderDetailSurfaceProps) {
  const { t } = useTranslation();
  const providerLabel = resolveProviderLabel(provider, entries);
  const providerEntry = useMemo(
    () => entries?.find((entry) => entry.provider === provider),
    [entries, provider],
  );
  const isNotInstalled = providerEntry?.status === "unavailable";
  const installGuide = useMemo(() => {
    if (!isNotInstalled) return null;
    return resolveProviderInstallGuide({ provider, extendsProvider, hostPlatform });
  }, [extendsProvider, hostPlatform, isNotInstalled, provider]);
  // COMPAT(apiEndpoints): added in v0.13.0, remove gate after 2027-03-30.
  const showApiEndpoints = hostSupportsApiEndpoints && supportsApiEndpoints(provider);
  const providerSnapshotRefreshing = providerEntry?.status === "loading";
  const providerErrorMessage =
    providerEntry?.status === "error"
      ? (providerEntry.error ?? t("settings.providers.diagnostic.unknownError"))
      : null;
  const modelsRefreshing = isRefreshing || providerSnapshotRefreshing;
  const startErrorMessage = providerEntry?.enabled === false ? null : providerErrorMessage;
  const inheritedApiEndpoint = selectInheritedApiEndpoint({ provider, extendsProvider, entries });

  let installGuideContent: ReactNode = null;
  if (installGuide) {
    const cliLabel = resolveProviderLabel(installGuide.provider, entries);
    installGuideContent = renderInstallGuide(installGuide, cliLabel);
  }
  let apiEndpointsContent: ReactNode = null;
  if (showApiEndpoints) {
    apiEndpointsContent = renderApiEndpoints(providerLabel);
  }

  return (
    <>
      {removalError ? (
        <View style={settingsStyles.section}>
          <Alert
            variant="error"
            title={t("settings.providers.remove.errorTitle")}
            description={removalError}
            testID="provider-removal-error"
          >
            <Button variant="outline" size="sm" onPress={onDismissRemovalError}>
              {t("common.actions.dismiss")}
            </Button>
          </Alert>
        </View>
      ) : null}
      {startErrorMessage ? (
        <ProviderStartErrorAlert
          providerLabel={providerLabel}
          message={startErrorMessage}
          isRefreshing={modelsRefreshing}
          onRefresh={onRefresh}
          onDiagnose={onDiagnose}
        />
      ) : null}
      {inheritedApiEndpoint ? (
        <View style={settingsStyles.section}>
          <Alert
            variant="warning"
            title={t("settings.providers.apiEndpoints.inheritedTitle", {
              name: inheritedApiEndpoint.name,
            })}
            description={t("settings.providers.apiEndpoints.inheritedDescription")}
            testID="provider-inherited-api-endpoint"
          />
        </View>
      ) : null}
      {installGuideContent}
      {apiEndpointsContent}
      <ProviderModelsSection
        key={provider}
        providerEnabled={providerEntry?.enabled !== false}
        providerLoading={providerSnapshotRefreshing}
        providerFailed={providerErrorMessage !== null}
        fetchedAt={providerEntry?.fetchedAt}
        discoveredModels={discoveredModels}
        additionalModels={additionalModels}
        deletingModelId={deletingModelId}
        onDeleteCustomModel={onDeleteCustomModel}
        onAddCustomModel={onAddCustomModel}
      />
      <ProviderDiagnosticSection
        providerLabel={providerLabel}
        diagnostic={diagnostic}
        revealRequest={diagnosticRevealRequest}
        onRun={onRunDiagnostic}
        onCopy={onCopyDiagnostic}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Alert 的 children 槽自带 8 的上间距，抵掉它，原文就和 description 一样离标题 4。
  startErrorBody: {
    flex: 1,
    minWidth: 0,
    marginTop: -theme.spacing[2],
    gap: theme.spacing[2],
  },
  startErrorActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  errorOutput: {
    fontFamily: theme.fontFamily.mono,
  },
}));
