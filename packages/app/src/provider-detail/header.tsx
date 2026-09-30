import React, { useMemo, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { RotateCw } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { Text } from "@/components/ui/text";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { ProviderStatusCopy, ProviderStatusDisplay, ProviderStatusTone } from "./status";

/*
 * 设置页里详情的头部块：图标、名称、状态徽章与模型数，右侧「刷新」。
 * 手机上「刷新」放到顶栏，头部块不带操作。弹窗外框自己画头部，不用这里。
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

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

export function ProviderDetailHeader({
  icon,
  label,
  status,
  modelCount,
  renderActions,
  testID,
}: ProviderDetailHeaderProps) {
  const { t } = useTranslation();
  const ThemedIcon = useMemo(() => withUnistyles(icon), [icon]);

  return (
    <View style={styles.header} testID={testID}>
      <View style={styles.iconFrame}>
        <ThemedIcon size={ICON_SIZE.lg} uniProps={foregroundColorMapping} />
      </View>
      <View style={styles.text}>
        <Text variant="title-sm" numberOfLines={1}>
          {label}
        </Text>
        <View style={styles.meta}>
          <StatusBadge
            label={t(status.label.key, status.label.params)}
            variant={BADGE_VARIANTS[status.tone]}
          />
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
}: {
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
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
}));
