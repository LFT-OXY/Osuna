import React, { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { FileText, MoreHorizontal, RotateCw, Trash2 } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  type DropdownMenuTriggerState,
} from "@/components/ui/dropdown-menu";
import {
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { ProviderIconFrame } from "./icon-frame";
import type { ProviderGlyph } from "@/components/provider-icons";
import type { ProviderStatusCopy, ProviderStatusDisplay, ProviderStatusTone } from "./status";

/*
 * 设置页里详情的头部块：图标、名称、状态徽章与模型数，右侧启用开关、「刷新」和 ⋯ 菜单。
 * 手机上这些操作放到顶栏，头部块不带操作。composer 弹窗把图标框、徽章、「刷新」和 ⋯ 放进弹窗头部，不带开关。
 */

export interface ProviderDetailHeaderProps {
  glyph: ProviderGlyph;
  label: string;
  status: ProviderStatusDisplay;
  // 只在可用时给出。
  modelCount: ProviderStatusCopy | null;
  renderActions?: () => ReactNode;
  testID?: string;
}

const BADGE_VARIANTS: Record<ProviderStatusTone, StatusBadgeVariant> = {
  success: "success",
  warning: "warning",
  danger: "error",
  muted: "muted",
  loading: "muted",
};

const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedFileText = withUnistyles(FileText);
const ThemedTrash2 = withUnistyles(Trash2);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const dangerColorMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });

export function ProviderStatusBadge({ status }: { status: ProviderStatusDisplay }) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      label={t(status.label.key, status.label.params)}
      variant={BADGE_VARIANTS[status.tone]}
    />
  );
}

export function ProviderDetailHeader({
  glyph,
  label,
  status,
  modelCount,
  renderActions,
  testID,
}: ProviderDetailHeaderProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.header} testID={testID}>
      <ProviderIconFrame glyph={glyph} size="lg" />
      <View style={styles.text}>
        <Text variant="title-sm" numberOfLines={1}>
          {label}
        </Text>
        <View style={styles.meta}>
          <ProviderStatusBadge status={status} />
          {modelCount ? (
            <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
              {t(modelCount.key, modelCount.params)}
            </Text>
          ) : null}
        </View>
      </View>
      {renderActions ? <View style={styles.actions}>{renderActions()}</View> : null}
    </View>
  );
}

// 详情页头的启用开关。宽屏在开关左边写当前状态；手机顶栏放不下，只放开关，靠可访问名称说明用途。
export function ProviderDetailEnabledSwitch({
  providerLabel,
  enabled,
  isSaving,
  showStateLabel,
  onValueChange,
}: {
  providerLabel: string;
  enabled: boolean;
  isSaving: boolean;
  showStateLabel: boolean;
  onValueChange: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.enabledSwitch}>
      {showStateLabel ? (
        <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
          {enabled ? t("settings.providers.enablement.on") : t("settings.providers.enablement.off")}
        </Text>
      ) : null}
      <Switch
        value={enabled}
        onValueChange={onValueChange}
        disabled={isSaving}
        accessibilityLabel={t("settings.providers.enableProvider", { name: providerLabel })}
        testID="provider-detail-enabled-switch"
      />
    </View>
  );
}

export function ProviderDetailRefreshButton({
  isRefreshing,
  disabled = false,
  onRefresh,
  iconOnly = false,
}: {
  isRefreshing: boolean;
  // 已停用时 daemon 不探测，刷新没有意义。
  disabled?: boolean;
  onRefresh: () => void;
  // 手机上 composer 弹窗头部放不下文字按钮，改成仅图标，把宽度留给名称。
  iconOnly?: boolean;
}) {
  const { t } = useTranslation();
  if (iconOnly) {
    return (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={RotateCw}
        loading={isRefreshing}
        disabled={disabled}
        onPress={onRefresh}
        accessibilityLabel={t("settings.providers.diagnostic.refresh")}
      />
    );
  }
  const refreshKey = isRefreshing
    ? "settings.providers.diagnostic.refreshing"
    : "settings.providers.diagnostic.refresh";
  return (
    <Button
      variant="secondary"
      size="sm"
      leftIcon={isRefreshing ? undefined : RotateCw}
      onPress={onRefresh}
      disabled={isRefreshing || disabled}
    >
      {t(refreshKey)}
    </Button>
  );
}

// 手机顶栏的「刷新」：仅图标，用顶栏图标按钮的尺寸。
export function ProviderDetailScreenRefreshButton({
  isRefreshing,
  disabled,
  onRefresh,
}: {
  isRefreshing: boolean;
  disabled: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const isBlocked = isRefreshing || disabled;
  const refreshStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) =>
      iconButtonChromeStyle({
        size: "large",
        state: { hovered: Boolean(hovered), pressed },
        disabled: isBlocked,
      }),
    [isBlocked],
  );
  const accessibilityState = useMemo(
    () => ({ busy: isRefreshing, disabled: isBlocked }),
    [isBlocked, isRefreshing],
  );
  return (
    <Pressable
      style={refreshStyle}
      onPress={onRefresh}
      disabled={isBlocked}
      accessibilityRole="button"
      accessibilityLabel={t("settings.providers.diagnostic.refresh")}
      accessibilityState={accessibilityState}
      testID="provider-detail-refresh"
    >
      {isRefreshing ? (
        <ThemedLoadingSpinner uniProps={mutedIconColorMapping} />
      ) : (
        <ThemedRotateCw
          size={iconButtonChromeGlyphSize("large")}
          uniProps={mutedIconColorMapping}
        />
      )}
    </Pressable>
  );
}

export interface ProviderDetailMenuProps {
  provider: string;
  providerLabel: string;
  providerSource: ProviderSnapshotEntry["source"];
  hostSupportsRemoval: boolean;
  isRemoving: boolean;
  onDiagnose: () => void;
  onRemove: () => void;
  // 页内头部块是 28 的按钮；手机顶栏用顶栏图标按钮的尺寸。
  placement: "inline" | "screenHeader";
}

export function ProviderDetailMenu({
  provider,
  providerLabel,
  providerSource,
  hostSupportsRemoval,
  isRemoving,
  onDiagnose,
  onRemove,
  placement,
}: ProviderDetailMenuProps) {
  const { t } = useTranslation();
  // 只有自定义提供方能删；主机不支持删除时不给入口。
  const canRemove = hostSupportsRemoval && providerSource === "custom";
  const triggerStyle = useCallback(
    ({ pressed, hovered, open }: DropdownMenuTriggerState) => {
      if (placement === "screenHeader") {
        return iconButtonChromeStyle({ size: "large", state: { hovered, pressed, open } });
      }
      return [
        styles.menuButton,
        (hovered || open) && styles.menuButtonHovered,
        pressed && styles.menuButtonPressed,
      ];
    },
    [placement],
  );
  const renderTriggerIcon = useCallback(
    ({ hovered, open }: DropdownMenuTriggerState) => {
      if (placement === "screenHeader") {
        return (
          <ThemedMoreHorizontal
            size={iconButtonChromeGlyphSize("large")}
            uniProps={mutedIconColorMapping}
          />
        );
      }
      return (
        <ThemedMoreHorizontal
          size={ICON_SIZE.sm}
          uniProps={hovered || open ? foregroundColorMapping : mutedIconColorMapping}
        />
      );
    },
    [placement],
  );
  const diagnoseLeading = useMemo(
    () => <ThemedFileText size={ICON_SIZE.md} uniProps={mutedIconColorMapping} />,
    [],
  );
  const removeLeading = useMemo(
    () => <ThemedTrash2 size={ICON_SIZE.md} uniProps={dangerColorMapping} />,
    [],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        hitSlop={8}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("settings.providers.actions.menu", { name: providerLabel })}
        testID={`provider-actions-${provider}`}
      >
        {renderTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        <DropdownMenuItem
          leading={diagnoseLeading}
          onSelect={onDiagnose}
          testID={`provider-diagnose-${provider}`}
        >
          {t("settings.providers.diagnostic.title")}
        </DropdownMenuItem>
        {canRemove ? <DropdownMenuSeparator /> : null}
        {canRemove ? (
          <DropdownMenuItem
            destructive
            leading={removeLeading}
            onSelect={onRemove}
            status={isRemoving ? "pending" : "idle"}
            pendingLabel={t("settings.providers.actions.removing")}
            testID={`provider-remove-${provider}`}
          >
            {t("settings.providers.actions.remove")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minHeight: 40,
    marginBottom: theme.spacing[6],
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[0.5],
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  enabledSwitch: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  menuButton: {
    width: 28,
    height: 28,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  menuButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  menuButtonPressed: {
    backgroundColor: theme.colors.surface3,
  },
}));
