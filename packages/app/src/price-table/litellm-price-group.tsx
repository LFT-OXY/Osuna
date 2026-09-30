import type { UsagePricingModel, UsagePricingTableInfo } from "@getpaseo/protocol/usage/types";
import { ChevronRight, RefreshCw } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { SearchField } from "@/components/ui/search-field";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
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
  filterPricingModels,
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
  /** 搜索词只过滤这一组，和折叠状态一样只在这一页里。 */
  query: string;
  onQueryChange: (query: string) => void;
  onCustomize: (model: string) => void;
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
  query,
  onQueryChange,
  onCustomize,
  ...controls
}: LiteLLMPriceGroupProps) {
  const { t } = useTranslation();
  const stacked = layout === "stacked";
  // 手机上没有悬停，「自定义」一直露着。
  const alwaysShowCustomize = useIsCompactFormFactor() || isNative;
  const matches = useMemo(() => filterPricingModels(models, query), [models, query]);
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
            <View style={styles.search}>
              <SearchField
                value={query}
                onChangeText={onQueryChange}
                placeholder={t("settings.host.priceTable.litellmGroup.search")}
                clearAccessibilityLabel={t("settings.host.priceTable.litellmGroup.clearSearch")}
                testID="price-table-litellm-search"
                clearTestID="price-table-litellm-search-clear"
              />
            </View>
            {matches.length === 0 && query.trim() !== "" ? (
              <Text
                color="foregroundMuted"
                style={styles.noMatches}
                testID="price-table-litellm-no-matches"
              >
                {t("settings.host.priceTable.litellmGroup.noMatches", { query: query.trim() })}
              </Text>
            ) : null}
            {/* 窄屏的行把四个价格压成一行小字，列头对不上任何东西。 */}
            {stacked || matches.length === 0 ? null : (
              <View style={styles.headerBorder}>
                <PriceTableHeader layout={layout} />
              </View>
            )}
            {matches.map((model) => (
              <LiteLLMPriceRow
                key={model.model}
                model={model}
                layout={layout}
                alwaysShowCustomize={alwaysShowCustomize}
                onCustomize={onCustomize}
              />
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

/**
 * 只读的一行，悬停时露出「自定义」。悬停按 docs/hover.md：外层普通 View 只管
 * pointerenter/leave，按钮用 opacity + pointerEvents 藏起来而不是卸载，行高不变。
 */
function LiteLLMPriceRow({
  model,
  layout,
  alwaysShowCustomize,
  onCustomize,
}: {
  model: UsagePricingModel;
  layout: PriceTableLayout;
  alwaysShowCustomize: boolean;
  onCustomize: (model: string) => void;
}) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const modelId = model.model;
  const handleCustomize = useCallback(() => onCustomize(modelId), [modelId, onCustomize]);
  const price = model.pricePerMillion;
  const stacked = layout === "stacked";
  const customizeVisible = isHovered || alwaysShowCustomize;
  const customize = (
    <View
      style={customizeVisible ? null : styles.customizeHidden}
      pointerEvents={customizeVisible ? "auto" : "none"}
    >
      <Button
        variant="ghost"
        size="xs"
        onPress={handleCustomize}
        accessibilityLabel={t("settings.host.priceTable.customizeAccessibility", {
          model: modelId,
        })}
        testID={`price-table-customize-${modelId}`}
      >
        {t("settings.host.priceTable.customize")}
      </Button>
    </View>
  );

  let content;
  if (stacked) {
    const cells = PRICE_COLUMNS.map((column) => {
      const value = price ? formatPriceCell(price[column.field]) : "—";
      return t(column.shortLabelKey, { price: value });
    });
    content = (
      <>
        <View style={priceColumns.model}>
          <ModelIdText modelId={modelId} />
          <Text variant="caption" color="foregroundMuted" numberOfLines={1} style={styles.tabular}>
            {cells.join(" · ")}
          </Text>
        </View>
        {customize}
      </>
    );
  } else {
    content = (
      <>
        <View style={priceColumns.model}>
          <ModelIdText modelId={modelId} />
        </View>
        {PRICE_COLUMNS.map((column) => (
          <View key={column.field} style={priceColumns.price}>
            <PriceValue value={price?.[column.field] ?? null} />
          </View>
        ))}
        <View style={styles.actions}>{customize}</View>
      </>
    );
  }

  return (
    <View
      style={styles.rowEnvelope}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      testID={`price-table-row-${modelId}`}
    >
      <View style={styles.row}>{content}</View>
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
  search: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderCardRow,
  },
  noMatches: {
    padding: theme.spacing[4],
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderCardRow,
  },
  rowEnvelope: {
    position: "relative",
  },
  row: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: PRICE_COLUMN_GAP,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderCardRow,
  },
  actions: {
    ...priceColumns.actions,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  customizeHidden: {
    opacity: 0,
  },
  tabular: {
    fontVariant: ["tabular-nums"],
  },
}));
