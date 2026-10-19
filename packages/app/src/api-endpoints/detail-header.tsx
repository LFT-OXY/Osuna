import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Pencil, Trash2 } from "lucide-react-native";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { RowActionsMenuTrigger } from "@/components/ui/row-actions-menu-trigger";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { endpointRowStatus, endpointSummary, type EndpointRowStatus } from "./internal/host-list";

/*
 * 接口详情页头部：照提供方详情页（provider-detail/header.tsx）——头像、名称、状态徽标与「格式 · 已选数」，
 * 右侧接口开关、「测试连接」与 ⋯ 菜单（编辑连接 / 删除）；冷却中时徽标旁有「立刻恢复」。
 */

const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash2 = withUnistyles(Trash2);
const dangerColorMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });

const BADGE_VARIANTS: Record<EndpointRowStatus["tone"], StatusBadgeVariant> = {
  success: "success",
  warning: "warning",
  danger: "error",
  muted: "muted",
};

interface ApiEndpointDetailHeaderProps {
  endpoint: ApiEndpoint;
  now: Date;
  isPending: boolean;
  isTesting: boolean;
  isDeleting: boolean;
  onToggle: (endpoint: ApiEndpoint, enabled: boolean) => void;
  onResume: (endpoint: ApiEndpoint) => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ApiEndpointDetailHeader({
  endpoint,
  now,
  isPending,
  isTesting,
  isDeleting,
  onToggle,
  onResume,
  onTest,
  onEdit,
  onDelete,
}: ApiEndpointDetailHeaderProps) {
  const { t } = useTranslation();
  const enabled = endpoint.enabled !== false;
  const status = endpointRowStatus(endpoint, now);
  const summary = endpointSummary(endpoint);
  const meta = [
    summary.formats
      .map((format) => t(`settings.apiEndpoints.formats.${format}`))
      .join(t("settings.apiEndpoints.listSeparator")),
    t("settings.apiEndpoints.status.modelCount", { count: summary.modelCount }),
  ]
    .filter(Boolean)
    .join(" · ");
  const handleToggle = useCallback(
    (value: boolean) => onToggle(endpoint, value),
    [endpoint, onToggle],
  );
  const handleResume = useCallback(() => onResume(endpoint), [endpoint, onResume]);
  // 窄窗口里名称、状态与右侧的开关和按钮放不进一行：开关与按钮换到下一行，名称和说明不截断。
  const isCompact = useIsCompactFormFactor();
  const textLines = isCompact ? undefined : 1;

  return (
    <View
      style={isCompact ? styles.headerCompact : styles.header}
      testID="api-endpoint-detail-header"
    >
      <View style={styles.identity}>
        <View style={[styles.avatar, !enabled && styles.avatarOff]}>
          <Text variant="title-sm">{initialOf(endpoint.name)}</Text>
        </View>
        <View style={styles.text}>
          <Text variant="title-sm" numberOfLines={textLines}>
            {endpoint.name}
          </Text>
          <View style={styles.meta}>
            <StatusBadge label={statusLabel(status, t)} variant={BADGE_VARIANTS[status.tone]} />
            {status.kind === "cooling" ? (
              <Button
                variant="outline"
                size="sm"
                onPress={handleResume}
                loading={isPending}
                testID="api-endpoint-detail-resume"
              >
                {t("settings.apiEndpoints.resumeNow")}
              </Button>
            ) : null}
            <Text
              variant="caption"
              color="foregroundMuted"
              numberOfLines={textLines}
              style={styles.metaText}
            >
              {meta}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.actions}>
        <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
          {enabled
            ? t("settings.apiEndpoints.groups.enabled")
            : t("settings.apiEndpoints.groups.disabled")}
        </Text>
        <Switch
          value={enabled}
          onValueChange={handleToggle}
          disabled={isPending}
          accessibilityLabel={t("settings.apiEndpoints.endpointSwitch", { name: endpoint.name })}
          testID="api-endpoint-detail-switch"
        />
        <Button
          variant="secondary"
          size="sm"
          onPress={onTest}
          loading={isTesting}
          disabled={isTesting}
          testID="api-endpoint-test-connection"
        >
          {isTesting
            ? t("settings.apiEndpoints.detail.test.testing")
            : t("settings.apiEndpoints.detail.testConnection")}
        </Button>
        <DetailMenu
          name={endpoint.name}
          isDeleting={isDeleting}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </View>
    </View>
  );
}

function DetailMenu({
  name,
  isDeleting,
  onEdit,
  onDelete,
}: {
  name: string;
  isDeleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const editLeading = useMemo(
    () => <ThemedPencil size={ICON_SIZE.md} uniProps={mutedIconColorMapping} />,
    [],
  );
  const deleteLeading = useMemo(
    () => <ThemedTrash2 size={ICON_SIZE.md} uniProps={dangerColorMapping} />,
    [],
  );
  return (
    <DropdownMenu>
      <RowActionsMenuTrigger
        accessibilityLabel={t("settings.apiEndpoints.detail.menu", { name })}
        testID="api-endpoint-detail-menu"
      />
      <DropdownMenuContent align="end" width={200}>
        <DropdownMenuItem
          leading={editLeading}
          onSelect={onEdit}
          testID="api-endpoint-detail-edit-connection"
        >
          {t("settings.apiEndpoints.form.editTitle")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          leading={deleteLeading}
          onSelect={onDelete}
          status={isDeleting ? "pending" : "idle"}
          pendingLabel={t("settings.apiEndpoints.detail.deleting")}
          testID="api-endpoint-detail-delete"
        >
          {t("settings.apiEndpoints.detail.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function statusLabel(
  status: EndpointRowStatus,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  if (status.kind === "cooling") {
    return t(`settings.apiEndpoints.status.cooling_${status.remaining.unit}`, {
      count: status.remaining.value,
    });
  }
  if (status.kind === "needsCheck") return t("settings.apiEndpoints.status.needsCheck");
  if (status.kind === "disabled") return t("settings.apiEndpoints.status.disabled");
  return t("settings.apiEndpoints.status.available");
}

function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minHeight: 40,
    marginBottom: theme.spacing[6],
  },
  headerCompact: {
    gap: theme.spacing[3],
    marginBottom: theme.spacing[6],
  },
  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarOff: {
    opacity: theme.opacity[50],
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginTop: theme.spacing[0.5],
  },
  metaText: {
    flexShrink: 1,
    minWidth: 0,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
