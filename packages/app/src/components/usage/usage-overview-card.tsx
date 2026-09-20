import type {
  UsageBackfill,
  UsageModelBreakdown,
  UsageSourceBreakdown,
} from "@getpaseo/protocol/usage/types";
import { ChevronLeft, ChevronRight, Info, Layers, RefreshCw } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { FormTextInput } from "@/components/ui/form-field";
import { UsageCard } from "@/components/usage/usage-card";
import { UsageHostFilter } from "@/components/usage/usage-host-filter";
import {
  formatUsageCost,
  formatUsageShare,
  formatUsageTokensCompact,
  formatGroupedNumber,
} from "@/usage/format";
import type { UsageHostOption, UsageHostSelection } from "@/usage/host-options";
import type { MergedUsageReport } from "@/usage/merge";
import {
  canShiftUsageRangeForward,
  resolveUsageRange,
  usagePeriodIsNavigable,
  USAGE_PERIODS,
  type UsageCustomRange,
  type UsagePeriod,
} from "@/usage/period";
import { describeUsageCustomTab, describeUsageRange } from "@/usage/range-label";
import { usageSourceColor, usageSourceLabel } from "@/usage/sources";
import { totalUsageTokens, usageSourceKey } from "@/usage/totals";

/** `all` is the first source card, not a source, so it needs a key of its own. */
export const ALL_USAGE_SOURCES = "all";

interface UsageOverviewCardProps {
  report: MergedUsageReport;
  backfill: UsageBackfill;
  period: UsagePeriod;
  anchor: string;
  custom: UsageCustomRange;
  today: string;
  selectedSourceKey: string | null;
  isRefreshing: boolean;
  hostOptions: readonly UsageHostOption[];
  hostSelection: UsageHostSelection;
  onPeriodChange: (period: UsagePeriod) => void;
  onShift: (delta: -1 | 1) => void;
  onCustomChange: (custom: UsageCustomRange) => void;
  onSelectSource: (key: string | null) => void;
  onSelectHost: (serverId: string | null) => void;
  onRefresh: () => void;
}

export function UsageOverviewCard(props: UsageOverviewCardProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const range = resolveUsageRange({
    period: props.period,
    anchor: props.anchor,
    custom: props.custom,
  });
  const rangeDescription = describeUsageRange(range, locale);
  const totalTokens = totalUsageTokens(props.report.summary.totals);
  const unpricedModels = props.report.models.filter((model) => !model.priced).length;

  return (
    <UsageCard testID="usage-overview">
      <UsageOverviewHeader
        period={props.period}
        anchor={props.anchor}
        custom={props.custom}
        today={props.today}
        backfill={props.backfill}
        isRefreshing={props.isRefreshing}
        hostOptions={props.hostOptions}
        hostSelection={props.hostSelection}
        onPeriodChange={props.onPeriodChange}
        onShift={props.onShift}
        onSelectHost={props.onSelectHost}
        onRefresh={props.onRefresh}
      />
      {props.period === "custom" ? (
        <UsageCustomRangeInputs custom={props.custom} onChange={props.onCustomChange} />
      ) : null}
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>{t("usage.overview.tokenTotal")}</Text>
        <Text style={styles.heroValue} testID="usage-total-tokens">
          {formatGroupedNumber(totalTokens, locale)}
        </Text>
        <View style={styles.heroCostRow}>
          <Text style={styles.heroCost} testID="usage-total-cost">
            {formatUsageCost(props.report.summary.estimatedCost)}
          </Text>
          <Info size={16} color={styles.heroCost.color} />
        </View>
        <Text style={styles.heroRange} testID="usage-range">
          {t(rangeDescription.key, rangeDescription.params)}
        </Text>
        <Text style={styles.heroNote}>{t("usage.overview.estimatedCostNote")}</Text>
      </View>
      <UsageDistributionBar sources={props.report.sources} total={totalTokens} />
      <UsageSourceCards
        sources={props.report.sources}
        modelCount={new Set(props.report.models.map((model) => model.model)).size}
        selectedKey={props.selectedSourceKey}
        onSelect={props.onSelectSource}
      />
      {unpricedModels > 0 ? (
        <Text style={styles.unpricedSummary} testID="usage-unpriced-summary">
          {unpricedModels === 1
            ? t("usage.overview.unpricedSummaryOne")
            : t("usage.overview.unpricedSummaryMany", { count: unpricedModels })}
        </Text>
      ) : null}
      {props.selectedSourceKey ? (
        <UsageModelList
          models={props.report.models}
          selectedKey={props.selectedSourceKey}
          heading={
            props.selectedSourceKey === ALL_USAGE_SOURCES
              ? t("usage.overview.allSources")
              : sourceLabelForKey(props.report.sources, props.selectedSourceKey)
          }
          locale={locale}
        />
      ) : null}
    </UsageCard>
  );
}

function UsageOverviewHeader({
  period,
  anchor,
  custom,
  today,
  backfill,
  isRefreshing,
  hostOptions,
  hostSelection,
  onPeriodChange,
  onShift,
  onSelectHost,
  onRefresh,
}: Pick<
  UsageOverviewCardProps,
  | "period"
  | "anchor"
  | "custom"
  | "today"
  | "backfill"
  | "isRefreshing"
  | "hostOptions"
  | "hostSelection"
  | "onPeriodChange"
  | "onShift"
  | "onSelectHost"
  | "onRefresh"
>) {
  const { t, i18n } = useTranslation();
  const customTab = describeUsageCustomTab(custom, i18n.language);
  const canGoForward = canShiftUsageRangeForward({ period, anchor, today });
  const shiftBack = useCallback(() => onShift(-1), [onShift]);
  const shiftForward = useCallback(() => onShift(1), [onShift]);

  return (
    <View style={styles.header}>
      <View style={styles.tabs}>
        {USAGE_PERIODS.map((value) => (
          <UsagePeriodTab
            key={value}
            value={value}
            label={
              value === "custom" && period === "custom"
                ? t(customTab.key, customTab.params)
                : t(`usage.overview.period.${value}`)
            }
            isSelected={period === value}
            onPress={onPeriodChange}
          />
        ))}
      </View>
      <View style={styles.headerActions}>
        {usagePeriodIsNavigable(period) ? (
          <>
            <UsageIconButton
              accessibilityLabel={t("usage.overview.period.previous")}
              onPress={shiftBack}
              testID="usage-period-prev"
            >
              {(color) => <ChevronLeft size={14} color={color} />}
            </UsageIconButton>
            <UsageIconButton
              accessibilityLabel={t("usage.overview.period.next")}
              onPress={shiftForward}
              isDisabled={!canGoForward}
              testID="usage-period-next"
            >
              {(color) => <ChevronRight size={14} color={color} />}
            </UsageIconButton>
          </>
        ) : null}
        <UsageBackfillPill backfill={backfill} />
        <UsageHostFilter options={hostOptions} selection={hostSelection} onSelect={onSelectHost} />
        <UsageIconButton
          accessibilityLabel={t("usage.overview.refresh")}
          onPress={onRefresh}
          isDisabled={isRefreshing}
          isOutlined
          testID="usage-refresh"
        >
          {(color) => <RefreshCw size={14} color={color} />}
        </UsageIconButton>
      </View>
    </View>
  );
}

function UsagePeriodTab({
  value,
  label,
  isSelected,
  onPress,
}: {
  value: UsagePeriod;
  label: string;
  isSelected: boolean;
  onPress: (period: UsagePeriod) => void;
}) {
  const handlePress = useCallback(() => onPress(value), [onPress, value]);
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  return (
    <Pressable
      onPress={handlePress}
      style={[styles.tab, isSelected && styles.tabSelected]}
      testID={`usage-period-tab-${value}`}
      accessibilityRole="tab"
      accessibilityState={accessibilityState}
    >
      <Text style={[styles.tabLabel, isSelected && styles.tabLabelSelected]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function UsageIconButton({
  children,
  accessibilityLabel,
  onPress,
  isDisabled = false,
  isOutlined = false,
  testID,
}: {
  children: (color: string) => ReactNode;
  accessibilityLabel: string;
  onPress: () => void;
  isDisabled?: boolean;
  isOutlined?: boolean;
  testID?: string;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);
  const color = isHovered && !isDisabled ? styles.iconGlyphHovered.color : styles.iconGlyph.color;
  const accessibilityState = useMemo(() => ({ disabled: isDisabled }), [isDisabled]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      disabled={isDisabled}
      onPress={onPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={[
        styles.iconButton,
        isOutlined && styles.iconButtonOutlined,
        isHovered && !isDisabled && styles.iconButtonHovered,
        isDisabled && styles.iconButtonDisabled,
      ]}
      testID={testID}
    >
      {children(color)}
    </Pressable>
  );
}

function UsageBackfillPill({ backfill }: { backfill: UsageBackfill }) {
  const { t, i18n } = useTranslation();
  if (backfill.state !== "running") return null;
  return (
    <View
      style={styles.backfillPill}
      testID="usage-backfill-pill"
      accessibilityLabel={t("usage.backfill.hint")}
    >
      <View style={styles.backfillDot} />
      <Text style={styles.backfillText}>
        {t("usage.backfill.pill", {
          done: formatGroupedNumber(backfill.filesDone, i18n.language),
          total: formatGroupedNumber(backfill.filesTotal, i18n.language),
        })}
      </Text>
    </View>
  );
}

function UsageCustomRangeInputs({
  custom,
  onChange,
}: {
  custom: UsageCustomRange;
  onChange: (custom: UsageCustomRange) => void;
}) {
  const { t } = useTranslation();
  const handleFrom = useCallback(
    (value: string) => onChange({ from: value, to: custom.to }),
    [custom.to, onChange],
  );
  const handleTo = useCallback(
    (value: string) => onChange({ from: custom.from, to: value }),
    [custom.from, onChange],
  );

  return (
    <View style={styles.customRow}>
      <FormTextInput
        size="sm"
        initialValue={custom.from}
        onChangeText={handleFrom}
        placeholder="YYYY-MM-DD"
        accessibilityLabel={t("usage.overview.customFrom")}
        style={styles.customInput}
        testID="usage-custom-from"
      />
      <FormTextInput
        size="sm"
        initialValue={custom.to}
        onChangeText={handleTo}
        placeholder="YYYY-MM-DD"
        accessibilityLabel={t("usage.overview.customTo")}
        style={styles.customInput}
        testID="usage-custom-to"
      />
    </View>
  );
}

function UsageDistributionBar({
  sources,
  total,
}: {
  sources: readonly UsageSourceBreakdown[];
  total: number;
}) {
  const { t } = useTranslation();
  if (total === 0) return <View style={styles.distribution} />;
  return (
    <View
      style={styles.distribution}
      accessibilityLabel={t("usage.overview.accessibility.distribution")}
      testID="usage-distribution"
    >
      {sources.map((source) => (
        <View
          key={usageSourceKey(source)}
          style={[
            styles.distributionSegment,
            {
              flexGrow: totalUsageTokens(source.totals),
              backgroundColor: usageSourceColor(source),
            },
          ]}
        />
      ))}
    </View>
  );
}

function UsageSourceCards({
  sources,
  modelCount,
  selectedKey,
  onSelect,
}: {
  sources: readonly UsageSourceBreakdown[];
  modelCount: number;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <View style={styles.sourceGrid}>
      <UsageSourceCard
        cardKey={ALL_USAGE_SOURCES}
        label={t("usage.overview.allSources")}
        color={styles.allSourcesIcon.color}
        share={formatUsageShare(sources.length === 0 ? 0 : 1, i18n.language)}
        modelCount={modelCount}
        isSelected={selectedKey === ALL_USAGE_SOURCES}
        onSelect={onSelect}
        isAll
      />
      {sources.map((source) => {
        const key = usageSourceKey(source);
        return (
          <UsageSourceCard
            key={key}
            cardKey={key}
            label={usageSourceLabel(source)}
            color={usageSourceColor(source)}
            share={formatUsageShare(source.share, i18n.language)}
            modelCount={source.modelCount}
            isSelected={selectedKey === key}
            onSelect={onSelect}
          />
        );
      })}
    </View>
  );
}

function UsageSourceCard({
  cardKey,
  label,
  color,
  share,
  modelCount,
  isSelected,
  onSelect,
  isAll = false,
}: {
  cardKey: string;
  label: string;
  color: string;
  share: string;
  modelCount: number;
  isSelected: boolean;
  onSelect: (key: string | null) => void;
  isAll?: boolean;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(
    () => onSelect(isSelected ? null : cardKey),
    [cardKey, isSelected, onSelect],
  );
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("usage.overview.accessibility.sourceCard", { source: label, share })}
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={[styles.sourceCard, isSelected && styles.sourceCardSelected]}
      testID={`usage-source-card-${cardKey}`}
    >
      <View style={styles.sourceCardHead}>
        {isAll ? (
          <Layers size={15} color={styles.allSourcesIcon.color} />
        ) : (
          <View style={[styles.sourceDot, { backgroundColor: color }]} />
        )}
        <Text style={styles.sourceCardLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={styles.sourceCardShare}>{share}</Text>
      <Text style={styles.sourceCardModels}>
        {modelCount === 1
          ? t("usage.overview.modelCountOne")
          : t("usage.overview.modelCountMany", { count: modelCount })}
      </Text>
    </Pressable>
  );
}

/** The selected card's own name, so an empty breakdown still says whose it is. */
function sourceLabelForKey(sources: readonly UsageSourceBreakdown[], key: string): string {
  const source = sources.find((candidate) => usageSourceKey(candidate) === key);
  return source ? usageSourceLabel(source) : key;
}

function UsageModelList({
  models,
  selectedKey,
  heading,
  locale,
}: {
  models: readonly UsageModelBreakdown[];
  selectedKey: string;
  heading: string;
  locale: string;
}) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      selectedKey === ALL_USAGE_SOURCES
        ? models
        : models.filter((model) => usageSourceKey(model) === selectedKey),
    [models, selectedKey],
  );
  const denominator = rows.reduce((sum, model) => sum + totalUsageTokens(model.totals), 0) || 1;
  const largest = rows.length === 0 ? 1 : totalUsageTokens(rows[0].totals) || 1;

  return (
    <View style={styles.models} testID="usage-model-breakdown">
      <Text style={styles.modelsHeading}>
        {t("usage.overview.modelBreakdown", { source: heading })}
      </Text>
      {rows.map((model) => {
        const tokens = totalUsageTokens(model.totals);
        return (
          <View key={`${usageSourceKey(model)} ${model.model}`} style={styles.modelRow}>
            <View style={styles.modelRowLabels}>
              <Text style={styles.modelName} numberOfLines={1}>
                {model.model}
              </Text>
              {model.priced ? null : (
                <Text style={styles.modelUnpriced}>{t("usage.overview.unpriced")}</Text>
              )}
              <Text style={styles.modelTokens}>{formatUsageTokensCompact(tokens)}</Text>
              <Text style={styles.modelCost}>{formatUsageCost(model.estimatedCost)}</Text>
              <Text style={styles.modelShare}>
                {formatUsageShare(tokens / denominator, locale)}
              </Text>
            </View>
            <View style={styles.modelBarTrack}>
              <View
                style={[
                  styles.modelBarFill,
                  { flexGrow: tokens, backgroundColor: usageSourceColor(model) },
                ]}
              />
              <View style={[styles.modelBarRest, { flexGrow: Math.max(0, largest - tokens) }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const palette = theme.colors.usage;
  return {
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      marginBottom: theme.spacing[6],
      flexWrap: "wrap",
    },
    tabs: {
      flexDirection: "row",
      gap: theme.spacing[1],
      flexShrink: 1,
      flexWrap: "wrap",
    },
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    tab: {
      paddingVertical: theme.spacing[2],
      paddingHorizontal: theme.spacing[3],
      borderRadius: theme.borderRadius.md,
    },
    tabSelected: {
      backgroundColor: palette.segBg,
    },
    tabLabel: {
      fontSize: 12,
      fontWeight: theme.fontWeight.medium,
      color: palette.inkMuted,
    },
    tabLabelSelected: {
      color: palette.ink,
    },
    iconButton: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.borderRadius.md,
    },
    iconGlyph: {
      color: palette.inkFaint,
    },
    iconGlyphHovered: {
      color: palette.brand,
    },
    iconButtonOutlined: {
      borderWidth: 1,
      borderColor: palette.controlBorder,
    },
    iconButtonHovered: {
      borderColor: palette.brand,
    },
    iconButtonDisabled: {
      opacity: theme.opacity[50],
    },
    backfillPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      borderRadius: theme.borderRadius.full,
      borderWidth: 1,
      borderColor: palette.amberBorder,
      backgroundColor: palette.amberBg,
      paddingVertical: theme.spacing[1],
      paddingHorizontal: theme.spacing[3],
    },
    backfillDot: {
      width: 6,
      height: 6,
      borderRadius: theme.borderRadius.full,
      backgroundColor: palette.amberDot,
    },
    backfillText: {
      fontSize: 12,
      color: palette.amberFg,
    },
    customRow: {
      flexDirection: "row",
      justifyContent: "center",
      gap: theme.spacing[2],
      marginBottom: theme.spacing[4],
    },
    customInput: {
      width: 140,
    },
    hero: {
      alignItems: "center",
      marginBottom: theme.spacing[8],
    },
    heroLabel: {
      fontSize: 12,
      color: palette.inkMuted,
      letterSpacing: 0.6,
      textTransform: "uppercase",
      marginBottom: theme.spacing[3],
    },
    heroValue: {
      fontSize: { xs: 48, md: 72 },
      lineHeight: { xs: 52, md: 76 },
      fontWeight: theme.fontWeight.bold,
      color: palette.ink,
      fontVariant: ["tabular-nums"],
    },
    heroCostRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      marginTop: theme.spacing[4],
    },
    heroCost: {
      fontSize: 20,
      fontWeight: theme.fontWeight.bold,
      color: palette.brand,
      fontVariant: ["tabular-nums"],
    },
    heroRange: {
      marginTop: theme.spacing[3],
      fontSize: 11,
      color: palette.inkFaint,
    },
    heroNote: {
      marginTop: theme.spacing[1],
      fontSize: 11,
      color: palette.inkFaint,
    },
    distribution: {
      flexDirection: "row",
      height: 6,
      borderRadius: theme.borderRadius.full,
      overflow: "hidden",
      backgroundColor: palette.track,
      marginBottom: theme.spacing[6],
    },
    distributionSegment: {
      flexBasis: 0,
      height: "100%",
    },
    sourceGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing[3],
    },
    sourceCard: {
      minWidth: 140,
      flexGrow: 1,
      flexBasis: 140,
      padding: theme.spacing[3],
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: palette.cardBorder,
    },
    sourceCardSelected: {
      borderColor: palette.cardBorderHover,
      backgroundColor: palette.tile,
    },
    sourceCardHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      marginBottom: theme.spacing[1],
    },
    sourceDot: {
      width: 10,
      height: 10,
      borderRadius: theme.borderRadius.full,
    },
    allSourcesIcon: {
      color: palette.inkFaint,
    },
    sourceCardLabel: {
      flexShrink: 1,
      fontSize: 14,
      fontWeight: theme.fontWeight.medium,
      color: palette.ink,
    },
    sourceCardShare: {
      fontSize: 18,
      fontWeight: theme.fontWeight.semibold,
      color: palette.ink,
      fontVariant: ["tabular-nums"],
    },
    sourceCardModels: {
      marginTop: 2,
      fontSize: 11,
      color: palette.inkFaint,
    },
    unpricedSummary: {
      marginTop: theme.spacing[3],
      fontSize: 12,
      color: palette.amberFg,
    },
    models: {
      marginTop: theme.spacing[6],
      paddingTop: theme.spacing[4],
      borderTopWidth: 1,
      borderTopColor: palette.divider2,
    },
    modelsHeading: {
      fontSize: 14,
      fontWeight: theme.fontWeight.medium,
      color: palette.ink,
      marginBottom: theme.spacing[3],
    },
    modelRow: {
      marginBottom: theme.spacing[3],
    },
    modelRowLabels: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[3],
      marginBottom: theme.spacing[1],
    },
    modelName: {
      flexShrink: 1,
      flexGrow: 1,
      fontSize: 14,
      color: palette.ink3,
    },
    modelUnpriced: {
      fontSize: 11,
      color: palette.amberFg,
      borderWidth: 1,
      borderColor: palette.amberBorder,
      backgroundColor: palette.amberBg,
      borderRadius: theme.borderRadius.full,
      paddingHorizontal: theme.spacing[2],
    },
    modelTokens: {
      fontSize: 14,
      color: palette.inkFaint,
      fontVariant: ["tabular-nums"],
    },
    modelCost: {
      fontSize: 14,
      color: palette.inkFaint,
      fontVariant: ["tabular-nums"],
    },
    modelShare: {
      width: 64,
      textAlign: "right",
      fontSize: 14,
      color: palette.ink,
      fontVariant: ["tabular-nums"],
    },
    modelBarTrack: {
      flexDirection: "row",
      height: 3,
      borderRadius: theme.borderRadius.full,
      overflow: "hidden",
      backgroundColor: palette.track,
    },
    modelBarFill: {
      flexBasis: 0,
      height: "100%",
    },
    modelBarRest: {
      flexBasis: 0,
    },
  };
});
