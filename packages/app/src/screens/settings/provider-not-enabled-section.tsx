import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight } from "lucide-react-native";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { resolveProviderGlyph } from "@/components/provider-icons";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { ProviderIconFrame } from "@/provider-detail/icon-frame";
import type { ProviderStatusDisplay } from "@/provider-detail/status";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { resolveProviderPlacement, type NotEnabledMark } from "./provider-placement";
import { ProviderStatusLine } from "./provider-status-line";

const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// 色调与详情页状态徽章一致：停用灰，未安装黄。
const MARK_DISPLAY: Record<NotEnabledMark, ProviderStatusDisplay> = {
  turnedOff: { tone: "muted", label: { key: "providerCatalog.marks.turnedOff" } },
  notInstalled: { tone: "warning", label: { key: "providerCatalog.marks.notInstalled" } },
};

export interface NotEnabledItem {
  entry: ProviderSnapshotEntry;
  mark: NotEnabledMark;
}

function matchesSearch(entry: ProviderSnapshotEntry, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [entry.label ?? "", entry.provider, entry.description ?? ""].some((value) =>
    value.toLowerCase().includes(normalized),
  );
}

interface NotEnabledRowProps {
  serverId: string;
  item: NotEnabledItem;
  isOpening: boolean;
  isFirst: boolean;
  onOpen: (item: NotEnabledItem) => void;
}

function NotEnabledRow({ serverId, item, isOpening, isFirst, onOpen }: NotEnabledRowProps) {
  const { t } = useTranslation();
  const { entry, mark } = item;
  const label = entry.label ?? entry.provider;
  const glyph = resolveProviderGlyph({ provider: entry.provider, serverId, tone: "brand" });

  const handlePress = useCallback(() => {
    onOpen(item);
  }, [item, onOpen]);
  const rowStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      !isFirst && settingsStyles.rowBorder,
      hovered && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isFirst],
  );

  return (
    <Pressable
      style={rowStyle}
      onPress={handlePress}
      disabled={isOpening}
      accessibilityRole="button"
      accessibilityLabel={t("providerCatalog.actions.open", { name: label })}
      testID={`enable-provider-${entry.provider}`}
    >
      {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
        <>
          <View style={styles.rowContent}>
            <ProviderIconFrame glyph={glyph} size="sm" />
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle} numberOfLines={1}>
                {label}
              </Text>
              <ProviderStatusLine status={MARK_DISPLAY[mark]} />
            </View>
          </View>
          {isOpening ? (
            <ThemedLoadingSpinner size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
          ) : (
            <ThemedChevronRight
              size={ICON_SIZE.sm}
              uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
            />
          )}
        </>
      )}
    </Pressable>
  );
}

interface ProviderNotEnabledSectionProps {
  serverId: string;
  // 搜索框在弹窗头部，和 ACP 目录一组共用同一个查询。
  query: string;
  openingProviderId: string | null;
  onOpen: (item: NotEnabledItem) => void;
}

// 「添加提供方」弹窗的"未启用"组：没有可列出的项时整组不显示。
export function ProviderNotEnabledSection({
  serverId,
  query,
  openingProviderId,
  onOpen,
}: ProviderNotEnabledSectionProps) {
  const { t } = useTranslation();
  const { entries } = useProvidersSnapshot(serverId);

  const items = useMemo(() => {
    const result: NotEnabledItem[] = [];
    for (const entry of entries ?? []) {
      const placement = resolveProviderPlacement(entry);
      if (placement.kind !== "notEnabled" || !matchesSearch(entry, query)) continue;
      result.push({ entry, mark: placement.mark });
    }
    return result;
  }, [entries, query]);

  if (items.length === 0) return null;

  return (
    <SettingsSection
      title={t("providerCatalog.groups.notEnabled")}
      testID="provider-catalog-not-enabled"
    >
      <View style={settingsStyles.card}>
        {items.map((item, index) => (
          <NotEnabledRow
            key={item.entry.provider}
            serverId={serverId}
            item={item}
            isOpening={openingProviderId === item.entry.provider}
            isFirst={index === 0}
            onOpen={onOpen}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface3,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
}));
