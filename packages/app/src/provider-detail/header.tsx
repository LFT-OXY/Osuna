import React, { useCallback, useMemo, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
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
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { Text } from "@/components/ui/text";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { ProviderStatusCopy, ProviderStatusDisplay, ProviderStatusTone } from "./status";

/*
 * 设置页里详情的头部块：图标、名称、状态徽章与模型数，右侧「刷新」和 ⋯ 菜单。
 * 手机上这两个操作放到顶栏，头部块不带操作。composer 弹窗把图标框、徽章和这两个操作放进弹窗头部。
 */

export interface ProviderDetailHeaderProps {
  icon: ComponentType<{ size: number; color: string }>;
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
const ThemedFileText = withUnistyles(FileText);
const ThemedTrash2 = withUnistyles(Trash2);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const dangerColorMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });

// 页内头部块是 40 的框；弹窗头部和列表行一样是 28 的框。
const ICON_FRAME_GLYPH = { lg: ICON_SIZE.lg, sm: ICON_SIZE.md } as const;

export function ProviderIconFrame({
  icon,
  size,
}: {
  icon: ComponentType<{ size: number; color: string }>;
  size: keyof typeof ICON_FRAME_GLYPH;
}) {
  const ThemedIcon = useMemo(() => withUnistyles(icon), [icon]);
  return (
    <View style={size === "lg" ? styles.iconFrame : settingsStyles.rowIconFrame}>
      <ThemedIcon size={ICON_FRAME_GLYPH[size]} uniProps={foregroundColorMapping} />
    </View>
  );
}

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
  icon,
  label,
  status,
  modelCount,
  renderActions,
  testID,
}: ProviderDetailHeaderProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.header} testID={testID}>
      <ProviderIconFrame icon={icon} size="lg" />
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

export function ProviderDetailRefreshButton({
  isRefreshing,
  onRefresh,
  iconOnly = false,
}: {
  isRefreshing: boolean;
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
      disabled={isRefreshing}
    >
      {t(refreshKey)}
    </Button>
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
  iconFrame: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
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
