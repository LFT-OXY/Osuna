import type { UsageTrend, UsageTrendStackBy } from "@getpaseo/protocol/usage/types";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import Svg, { Line, Rect } from "react-native-svg";
import { UsageCard } from "@/components/usage/usage-card";
import { UsageSegmentedControl } from "@/components/usage/usage-segmented-control";
import { formatGroupedNumber } from "@/usage/format";
import type { UsageNow, UsageRange } from "@/usage/period";
import { usageTrendGroupColor } from "@/usage/sources";
import { buildUsageTrendSeries, formatUsageTrendKey, type UsageTrendBar } from "@/usage/trend";

/**
 * `stroke` and `fill` are not `style`, so Unistyles does not track them: without
 * the wrapper these two keep the colour they were first painted with when the
 * theme changes under a card that does not re-render.
 */
const ThemedGridLine = withUnistyles(Line, (theme) => ({ stroke: theme.colors.usage.divider }));
const ThemedFutureBar = withUnistyles(Rect, (theme) => ({ fill: theme.colors.usage.track }));

const CHART_HEIGHT = 160;
const BAR_GAP = 2;
const GRID_LINES = 4;

/** A period still to come gets a stub bar so the axis keeps its full width. */
const FUTURE_BAR_RATIO = 0.22;

interface UsageTrendCardProps {
  trend: UsageTrend;
  range: UsageRange;
  now: UsageNow;
  stackBy: UsageTrendStackBy;
  onStackByChange: (stackBy: UsageTrendStackBy) => void;
}

export function UsageTrendCard({
  trend,
  range,
  now,
  stackBy,
  onStackByChange,
}: UsageTrendCardProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [width, setWidth] = useState(0);

  const series = useMemo(() => buildUsageTrendSeries({ trend, range, now }), [now, range, trend]);
  const stackOptions = useMemo(
    () => [
      {
        value: "source" as const,
        label: t("usage.trend.stackBy.source"),
        testID: "usage-trend-stack-source",
      },
      {
        value: "model" as const,
        label: t("usage.trend.stackBy.model"),
        testID: "usage-trend-stack-model",
      },
    ],
    [t],
  );

  const renderStackBy = useCallback(
    () => (
      <UsageSegmentedControl
        options={stackOptions}
        value={stackBy}
        accessibilityLabel={t("usage.trend.stackBy.label")}
        onChange={onStackByChange}
        testID="usage-trend-stack-by"
      />
    ),
    [onStackByChange, stackBy, stackOptions, t],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  const firstBar = series.bars[0];
  const lastBar = series.bars[series.bars.length - 1];

  return (
    <UsageCard
      title={t("usage.trend.title")}
      renderHeaderRight={renderStackBy}
      testID="usage-trend-card"
    >
      <View style={styles.chart} onLayout={handleLayout}>
        {width > 0 ? (
          <Svg width={width} height={CHART_HEIGHT}>
            {Array.from({ length: GRID_LINES }, (_, index) => {
              const y = (CHART_HEIGHT - 1) * (index / (GRID_LINES - 1)) + 0.5;
              return (
                <ThemedGridLine
                  key={`grid-${index}`}
                  x1={0}
                  y1={y}
                  x2={width}
                  y2={y}
                  strokeWidth={1}
                />
              );
            })}
            {series.bars.map((bar, index) => (
              <UsageTrendColumn
                key={bar.key}
                bar={bar}
                index={index}
                total={series.bars.length}
                max={series.max}
                width={width}
                stackBy={series.stackBy}
                label={t("usage.trend.bar", {
                  period: formatUsageTrendKey(bar.key, series.granularity, locale),
                  tokens: formatGroupedNumber(bar.total, locale),
                })}
              />
            ))}
          </Svg>
        ) : null}
      </View>
      <View style={styles.legend}>
        <View style={styles.legendSwatch} />
        <Text style={styles.legendLabel}>{t("usage.trend.future")}</Text>
      </View>
      <View style={styles.footer}>
        <Text style={styles.footerLabel} testID="usage-trend-first">
          {firstBar ? formatUsageTrendKey(firstBar.key, series.granularity, locale) : ""}
        </Text>
        <Text style={styles.footerLabel} testID="usage-trend-last">
          {lastBar ? formatUsageTrendKey(lastBar.key, series.granularity, locale) : ""}
        </Text>
      </View>
    </UsageCard>
  );
}

function UsageTrendColumn({
  bar,
  index,
  total,
  max,
  width,
  stackBy,
  label,
}: {
  bar: UsageTrendBar;
  index: number;
  total: number;
  max: number;
  width: number;
  /** The report's own stacking, not the tab: the two differ while a switch is in flight. */
  stackBy: UsageTrendStackBy;
  label: string;
}) {
  const barWidth = Math.max(1, (width - BAR_GAP * (total - 1)) / total);
  const x = index * (barWidth + BAR_GAP);

  if (bar.isFuture) {
    const height = CHART_HEIGHT * FUTURE_BAR_RATIO;
    return (
      <ThemedFutureBar
        x={x}
        y={CHART_HEIGHT - height}
        width={barWidth}
        height={height}
        rx={2}
        opacity={0.5}
        accessibilityLabel={label}
      />
    );
  }

  let offset = 0;
  return (
    <>
      {bar.segments.map((segment) => {
        const height = (segment.tokens / max) * CHART_HEIGHT;
        const y = CHART_HEIGHT - offset - height;
        offset += height;
        return (
          <Rect
            key={segment.group}
            x={x}
            y={y}
            width={barWidth}
            height={height}
            fill={usageTrendGroupColor(segment.group, stackBy)}
            testID={`usage-trend-segment-${bar.key}-${segment.group}`}
          />
        );
      })}
      <Rect
        x={x}
        y={0}
        width={barWidth}
        height={CHART_HEIGHT}
        fill="transparent"
        accessibilityLabel={label}
        testID={`usage-trend-bar-${bar.key}`}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => {
  const palette = theme.colors.usage;
  return {
    chart: {
      height: CHART_HEIGHT,
    },
    legend: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: theme.spacing[2],
      marginTop: theme.spacing[2],
    },
    legendSwatch: {
      width: 12,
      height: 10,
      borderRadius: 2,
      opacity: 0.5,
      backgroundColor: palette.track,
    },
    legendLabel: {
      fontSize: 10,
      fontWeight: theme.fontWeight.medium,
      color: palette.inkFaint,
    },
    footer: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: theme.spacing[2],
      paddingTop: theme.spacing[2],
      borderTopWidth: 1,
      borderTopColor: palette.divider,
    },
    footerLabel: {
      fontSize: 12,
      fontWeight: theme.fontWeight.medium,
      color: palette.inkMuted,
      fontVariant: ["tabular-nums"],
    },
  };
});
