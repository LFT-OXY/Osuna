import type { UsagePricingModel, UsagePricingTableInfo } from "@getpaseo/protocol/usage/types";
import { ChevronRight, RefreshCw } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { ICON_SIZE } from "@/styles/theme";
import { settingsStyles } from "@/styles/settings";
import { describeTimeAgo } from "@/usage/relative-time";
import { renderUsageText } from "@/usage/text";
import { PRICE_COLUMN_GAP, priceColumns, type PriceTableLayout } from "./price-columns";
import { ModelIdText, PriceTableHeader, PriceValue } from "./price-row";
import {
  PRICE_COLUMNS,
  describeLiteLLMSubtitle,
  describeLiteLLMSummary,
  formatPriceCell,
} from "./pricing";

const ThemedChevronRight = withUnistyles(ChevronRight, mutedIconColorMapping);

export interface LiteLLMControlsProps {
  autoUpdate: boolean;
  isRefreshing: boolean;
  onAutoUpdateChange: (next: boolean) => void;
  onRefresh: () => void;
}

interface LiteLLMPriceGroupProps extends LiteLLMControlsProps {
  models: readonly UsagePricingModel[];
  table: UsagePricingTableInfo;
  layout: PriceTableLayout;
  /** 自动更新或立即刷新失败的原因；这两个控件只作用于这一组。 */
  controlError: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
}

/**
 * 「LiteLLM 价格」组：参考数据，默认折叠成一行。自动更新与立即刷新只影响这一组的
 * 价格，所以放在它的标题上；窄屏的标题放不下，挪到组底部单独一张卡片。
 */
export function LiteLLMPriceGroup({
  models,
  table,
  layout,
  controlError,
  expanded,
  onToggleExpanded,
  ...controls
}: LiteLLMPriceGroupProps) {
  const { t } = useTranslation();
  const stacked = layout === "stacked";
  const subtitle = renderUsageText(
    t,
    describeLiteLLMSubtitle({
      source: table.source,
      fetchedAgo: describeTimeAgo(table.fetchedAt, Date.now()),
    }),
  );
  const { autoUpdate, isRefreshing, onAutoUpdateChange, onRefresh } = controls;
  const trailing = useMemo(
    () =>
      stacked ? null : (
        <View style={styles.controls}>
          <Text variant="caption" color="foregroundMuted">
            {t("settings.host.priceTable.autoUpdate")}
          </Text>
          <AutoUpdateSwitch
            value={autoUpdate}
            label={t("settings.host.priceTable.autoUpdate")}
            onValueChange={onAutoUpdateChange}
          />
          <RefreshButton isRefreshing={isRefreshing} onPress={onRefresh} showLabel />
        </View>
      ),
    [autoUpdate, isRefreshing, onAutoUpdateChange, onRefresh, stacked, t],
  );

  return (
    <SettingsSection
      title={t("settings.host.priceTable.litellmGroup.title")}
      count={models.length}
      trailing={trailing}
      testID="price-table-litellm-group"
    >
      <View style={settingsStyles.card}>
        {/*
          控件失败时错误换下副标题，占同一块预留两行的位置：出错与恢复都不挪动下面的行。
          错误是用户下一步唯一的线索，副标题在下一次操作后回来。
        */}
        <View style={styles.subtitleSlot}>
          {controlError ? (
            <Text
              variant="caption"
              color="statusDanger"
              numberOfLines={2}
              testID="price-table-control-error"
            >
              {controlError}
            </Text>
          ) : (
            <Text
              variant="caption"
              color="foregroundMuted"
              numberOfLines={2}
              testID="price-table-litellm-subtitle"
            >
              {subtitle}
            </Text>
          )}
        </View>
        <LiteLLMToggleRow count={models.length} expanded={expanded} onPress={onToggleExpanded} />
        {expanded ? (
          <>
            {/* 窄屏的行把四个价格压成一行小字，列头对不上任何东西。 */}
            {stacked ? null : (
              <View style={styles.headerBorder}>
                <PriceTableHeader layout={layout} />
              </View>
            )}
            {models.map((model) => (
              <LiteLLMPriceRow key={model.model} model={model} layout={layout} />
            ))}
          </>
        ) : null}
      </View>
      {stacked ? <LiteLLMControlsCard {...controls} /> : null}
    </SettingsSection>
  );
}

function LiteLLMToggleRow({
  count,
  expanded,
  onPress,
}: {
  count: number;
  expanded: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const rowStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.toggle,
      hovered && styles.toggleHovered,
      pressed && styles.togglePressed,
    ],
    [],
  );

  return (
    <Pressable
      style={rowStyle}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      testID="price-table-litellm-toggle"
    >
      <View style={expanded ? styles.chevronOpen : undefined}>
        <ThemedChevronRight size={ICON_SIZE.sm} />
      </View>
      <Text variant="label" color="foregroundMuted" numberOfLines={1} style={styles.toggleLabel}>
        {renderUsageText(t, describeLiteLLMSummary(count))}
      </Text>
      <Text variant="label" color="foregroundMuted">
        {expanded
          ? t("settings.host.priceTable.litellmGroup.collapse")
          : t("settings.host.priceTable.litellmGroup.expand")}
      </Text>
    </Pressable>
  );
}

function LiteLLMPriceRow({
  model,
  layout,
}: {
  model: UsagePricingModel;
  layout: PriceTableLayout;
}) {
  const { t } = useTranslation();
  const price = model.pricePerMillion;
  if (layout === "stacked") {
    const cells = PRICE_COLUMNS.map((column) => {
      const value = price ? formatPriceCell(price[column.field]) : "—";
      return t(column.shortLabelKey, { price: value });
    });
    return (
      <View style={styles.row} testID={`price-table-row-${model.model}`}>
        <View style={priceColumns.model}>
          <ModelIdText modelId={model.model} />
          <Text variant="caption" color="foregroundMuted" numberOfLines={1} style={styles.tabular}>
            {cells.join(" · ")}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.row, styles.rowTable]} testID={`price-table-row-${model.model}`}>
      <View style={priceColumns.model}>
        <ModelIdText modelId={model.model} />
      </View>
      {PRICE_COLUMNS.map((column) => (
        <View key={column.field} style={priceColumns.price}>
          <PriceValue value={price?.[column.field] ?? null} />
        </View>
      ))}
      <View style={priceColumns.actions} />
    </View>
  );
}

/** 窄屏上两个控件的位置：组标题放不下它们。 */
function LiteLLMControlsCard({
  autoUpdate,
  isRefreshing,
  onAutoUpdateChange,
  onRefresh,
}: LiteLLMControlsProps) {
  const { t } = useTranslation();
  return (
    <View style={settingsStyles.card}>
      <View style={settingsStyles.row}>
        <Text style={settingsStyles.rowContent}>
          {t("settings.host.priceTable.litellmGroup.autoUpdate")}
        </Text>
        <AutoUpdateSwitch
          value={autoUpdate}
          label={t("settings.host.priceTable.litellmGroup.autoUpdate")}
          onValueChange={onAutoUpdateChange}
        />
      </View>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <Text style={settingsStyles.rowContent}>{t("settings.host.priceTable.refresh")}</Text>
        <RefreshButton isRefreshing={isRefreshing} onPress={onRefresh} showLabel={false} />
      </View>
    </View>
  );
}

/** 两处摆放（组标题右侧、窄屏底部卡片）同一时间只出现一处，testID 因此可以相同。 */
function AutoUpdateSwitch({
  value,
  label,
  onValueChange,
}: {
  value: boolean;
  label: string;
  onValueChange: (next: boolean) => void;
}) {
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      accessibilityLabel={label}
      testID="price-table-auto-update-switch"
    />
  );
}

function RefreshButton({
  isRefreshing,
  onPress,
  showLabel,
}: {
  isRefreshing: boolean;
  onPress: () => void;
  /** 窄屏卡片里行标题已经写了「立即刷新」，按钮只留图标。 */
  showLabel: boolean;
}) {
  const { t } = useTranslation();
  const label = isRefreshing
    ? t("settings.host.priceTable.refreshing")
    : t("settings.host.priceTable.refresh");
  return (
    <Button
      variant="ghost"
      size="sm"
      leftIcon={RefreshCw}
      loading={isRefreshing}
      onPress={onPress}
      accessibilityLabel={t("settings.host.priceTable.refresh")}
      testID="price-table-refresh"
    >
      {showLabel ? label : null}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  subtitleSlot: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    // 两行 caption：窄屏上副标题本来就折成两行，错误加上 daemon 原因也常是两行。
    minHeight: theme.spacing[3] + theme.typeScale.caption.lineHeight * 2,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  toggleHovered: {
    backgroundColor: theme.colors.surface2,
  },
  togglePressed: {
    backgroundColor: theme.colors.surface3,
  },
  toggleLabel: {
    flex: 1,
    minWidth: 0,
  },
  chevronOpen: {
    transform: [{ rotate: "90deg" }],
  },
  headerBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderCardRow,
  },
  row: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderCardRow,
  },
  rowTable: {
    flexDirection: "row",
    alignItems: "center",
    gap: PRICE_COLUMN_GAP,
  },
  tabular: {
    fontVariant: ["tabular-nums"],
  },
}));
