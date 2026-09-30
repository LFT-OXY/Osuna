import React, { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AlertTriangle, FileText, RotateCw, Trash2 } from "lucide-react-native";
import { compareMatchScores, scoreTextFields } from "@getpaseo/protocol/search/text-match";
import type { AgentModelDefinition, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { ProviderProfileModel } from "@getpaseo/protocol/provider-config";
import { selectInheritedApiEndpoint, supportsApiEndpoints } from "@/api-endpoints";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Text as UiText } from "@/components/ui/text";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { resolveProviderInstallGuide, type ProviderInstallGuide } from "@/provider-install-guide";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { resolveProviderLabel } from "@/utils/provider-definitions";

/*
 * 提供方详情的内容区，区块顺序固定：删除失败 → 错误卡 → 继承接口提示 → 安装指引 → 第三方接口 → 模型。
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
  modelQuery: string;
  isRefreshing: boolean;
  deletingModelId: string | null;
  // 删除这个提供方失败的原因；从 ⋯ 菜单删除，失败提示显示在详情顶部。
  removalError: string | null;
  onRefresh: () => void;
  onRunDiagnostic: () => void;
  onDismissRemovalError: () => void;
  onDeleteCustomModel: (modelId: string) => void;
  renderInstallGuide: (guide: ProviderInstallGuide, cliLabel: string) => ReactNode;
  renderApiEndpoints: (providerLabel: string) => ReactNode;
}

const ThemedAlertTriangle = withUnistyles(AlertTriangle);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const destructiveIconColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });

function rankModels<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  if (!query.trim()) return items;
  const scored = items
    .map((item) => ({ item, score: scoreTextFields(query, fields(item)) }))
    .filter(
      (entry): entry is { item: T; score: NonNullable<typeof entry.score> } => entry.score !== null,
    );
  scored.sort((a, b) => compareMatchScores(a.score, b.score));
  return scored.map((entry) => entry.item);
}

function DiscoveredModelRow({ model }: { model: AgentModelDefinition }) {
  return (
    <View style={styles.modelRow}>
      <Text style={styles.modelTitle} numberOfLines={1}>
        {model.label}
      </Text>
      <Text style={styles.monoHint} numberOfLines={1} selectable dataSet={CODE_SURFACE_DATASET}>
        {model.id}
      </Text>
      {model.description ? (
        <Text style={styles.descriptionInline} numberOfLines={1}>
          {model.description}
        </Text>
      ) : null}
    </View>
  );
}

function CustomModelRow({
  model,
  deleting,
  onDelete,
}: {
  model: ProviderProfileModel;
  deleting: boolean;
  onDelete: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const handleDelete = useCallback(() => onDelete(model.id), [model.id, onDelete]);
  const deleteButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.iconButton,
      (Boolean(hovered) || pressed) && styles.iconButtonHovered,
      deleting ? styles.disabled : null,
    ],
    [deleting],
  );

  return (
    <View style={styles.modelRow}>
      <Text style={styles.modelTitle} numberOfLines={1}>
        {model.label}
      </Text>
      <Text style={styles.monoHint} numberOfLines={1} selectable dataSet={CODE_SURFACE_DATASET}>
        {model.id}
      </Text>
      <View style={styles.modelRowFiller} />
      <Pressable
        onPress={handleDelete}
        disabled={deleting}
        hitSlop={8}
        style={deleteButtonStyle}
        accessibilityRole="button"
        accessibilityLabel={t("settings.providers.models.removeModel", { id: model.id })}
      >
        <ThemedTrash2 size={ICON_SIZE.sm} uniProps={destructiveIconColorMapping} />
      </Pressable>
    </View>
  );
}

function ProviderStartErrorAlert({
  providerLabel,
  message,
  isRefreshing,
  onRefresh,
  onRunDiagnostic,
}: {
  providerLabel: string;
  message: string;
  isRefreshing: boolean;
  onRefresh: () => void;
  onRunDiagnostic: () => void;
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
            <Button variant="outline" size="sm" leftIcon={FileText} onPress={onRunDiagnostic}>
              {t("settings.providers.diagnostic.run")}
            </Button>
          </View>
        </View>
      </Alert>
    </View>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={settingsStyles.sectionHeaderTitle}>{title}</Text>
      <View style={styles.sectionHeaderMeta}>
        <Text style={settingsStyles.sectionHeaderTitle}>{count}</Text>
      </View>
    </View>
  );
}

interface ProviderModelsBodyProps {
  discoveredCount: number;
  additionalCount: number;
  providerSnapshotRefreshing: boolean;
  providerErrorMessage: string | null;
  modelsRefreshing: boolean;
  searchActive: boolean;
  filteredDiscovered: AgentModelDefinition[];
  filteredCustom: ProviderProfileModel[];
  deletingModelId: string | null;
  onRefresh: () => void;
  onDeleteCustom: (modelId: string) => void;
}

function ProviderModelsBody(props: ProviderModelsBodyProps) {
  const { t } = useTranslation();
  const {
    discoveredCount,
    additionalCount,
    providerSnapshotRefreshing,
    providerErrorMessage,
    modelsRefreshing,
    searchActive,
    filteredDiscovered,
    filteredCustom,
    deletingModelId,
    onRefresh,
    onDeleteCustom,
  } = props;

  if (discoveredCount === 0 && additionalCount === 0 && providerSnapshotRefreshing) {
    return (
      <View style={styles.emptyState}>
        <ThemedLoadingSpinner size="small" uniProps={mutedIconColorMapping} />
        <Text style={styles.mutedText}>{t("settings.providers.models.loading")}</Text>
      </View>
    );
  }
  if (discoveredCount === 0 && additionalCount === 0 && providerErrorMessage) {
    return (
      <View style={styles.emptyState}>
        <ThemedAlertTriangle size={ICON_SIZE.md} uniProps={mutedIconColorMapping} />
        <Text style={styles.mutedText}>{providerErrorMessage}</Text>
        <Button variant="default" size="sm" onPress={onRefresh} disabled={modelsRefreshing}>
          {modelsRefreshing
            ? t("settings.providers.models.retrying")
            : t("settings.providers.models.retry")}
        </Button>
      </View>
    );
  }
  if (filteredDiscovered.length === 0 && filteredCustom.length === 0 && searchActive) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.mutedText}>{t("settings.providers.models.noSearchMatches")}</Text>
      </View>
    );
  }
  if (discoveredCount === 0 && additionalCount === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.mutedText}>{t("settings.providers.models.noneDetected")}</Text>
      </View>
    );
  }
  return (
    <>
      {filteredDiscovered.length > 0 ? (
        <View style={styles.section} testID="provider-models-discovered">
          <SectionHeader
            title={t("settings.providers.models.discovered")}
            count={filteredDiscovered.length}
          />
          <View style={settingsStyles.card}>
            {filteredDiscovered.map((model) => (
              <DiscoveredModelRow key={model.id} model={model} />
            ))}
          </View>
        </View>
      ) : null}
      {filteredCustom.length > 0 ? (
        <View style={styles.section} testID="provider-models-custom">
          <SectionHeader
            title={t("settings.providers.models.custom")}
            count={filteredCustom.length}
          />
          <View style={settingsStyles.card}>
            {filteredCustom.map((model) => (
              <CustomModelRow
                key={model.id}
                model={model}
                deleting={deletingModelId === model.id}
                onDelete={onDeleteCustom}
              />
            ))}
          </View>
        </View>
      ) : null}
    </>
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
  modelQuery,
  isRefreshing,
  deletingModelId,
  removalError,
  onRefresh,
  onRunDiagnostic,
  onDismissRemovalError,
  onDeleteCustomModel,
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
  // COMPAT(apiEndpoints): added in v0.12.1, remove gate after 2027-03-30.
  const showApiEndpoints = hostSupportsApiEndpoints && supportsApiEndpoints(provider);
  const providerSnapshotRefreshing = providerEntry?.status === "loading";
  const providerErrorMessage =
    providerEntry?.status === "error"
      ? (providerEntry.error ?? t("settings.providers.diagnostic.unknownError"))
      : null;
  const modelsRefreshing = isRefreshing || providerSnapshotRefreshing;
  const startErrorMessage = providerEntry?.enabled === false ? null : providerErrorMessage;
  const inheritedApiEndpoint = selectInheritedApiEndpoint({ provider, extendsProvider, entries });

  const q = modelQuery.trim();
  const filteredDiscovered = useMemo(
    () => rankModels(discoveredModels, q, (m) => [m.label, m.id, m.description ?? ""]),
    [discoveredModels, q],
  );
  const filteredCustom = useMemo(
    () => rankModels(additionalModels, q, (m) => [m.label, m.id]),
    [additionalModels, q],
  );

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
          onRunDiagnostic={onRunDiagnostic}
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
      <ProviderModelsBody
        discoveredCount={discoveredModels.length}
        additionalCount={additionalModels.length}
        providerSnapshotRefreshing={providerSnapshotRefreshing}
        providerErrorMessage={providerErrorMessage}
        modelsRefreshing={modelsRefreshing}
        searchActive={Boolean(q)}
        filteredDiscovered={filteredDiscovered}
        filteredCustom={filteredCustom}
        deletingModelId={deletingModelId}
        onRefresh={onRefresh}
        onDeleteCustom={onDeleteCustomModel}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  mutedText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  monoHint: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
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
  descriptionInline: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  disabled: {
    opacity: 0.5,
  },
  section: {
    marginBottom: theme.spacing[4],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
    marginLeft: theme.spacing[1],
  },
  sectionHeaderMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderCardRow,
  },
  modelTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    flexShrink: 0,
  },
  modelRowFiller: {
    flex: 1,
  },
  emptyState: {
    paddingVertical: theme.spacing[8],
    alignItems: "center",
    gap: theme.spacing[3],
  },
}));
