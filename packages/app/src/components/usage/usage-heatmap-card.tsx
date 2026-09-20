import type { UsageHeatmapDay } from "@osuna/protocol/usage/types";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ScrollView } from "@/components/ui/scroll-view";
import { UsageCard } from "@/components/usage/usage-card";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { formatGroupedNumber } from "@/usage/format";
import {
  buildUsageHeatmap,
  formatUsageMonthLabel,
  USAGE_HEATMAP_ROWS,
  USAGE_HEATMAP_WEEKS,
  USAGE_HEATMAP_WEEKS_COMPACT,
  usageHeatmapWeekdayLabels,
  type UsageHeatmapCell,
  type UsageHeatmapLevel,
} from "@/usage/heatmap";
import { formatUsageTimeZoneLabel } from "@/usage/period";
import { formatUsageDay } from "@/usage/range-label";

const CELL_SIZE = 11;
const CELL_GAP = 3;
const CELL_STEP = CELL_SIZE + CELL_GAP;
const MONTH_ROW_HEIGHT = 14;

/** Stable keys for the gutter: two weekday initials can be the same letter. */
const WEEKDAY_IDS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

interface UsageHeatmapCardProps {
  heatmapDays: readonly UsageHeatmapDay[];
  today: string;
  timezone: string;
}

export function UsageHeatmapCard({ heatmapDays, today, timezone }: UsageHeatmapCardProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const isCompact = useIsCompactFormFactor();
  const weeks = isCompact ? USAGE_HEATMAP_WEEKS_COMPACT : USAGE_HEATMAP_WEEKS;
  const [hovered, setHovered] = useState<UsageHeatmapCell | null>(null);

  const matrix = useMemo(
    () => buildUsageHeatmap({ days: heatmapDays, weeks, today }),
    [heatmapDays, today, weeks],
  );
  const weekdayLabels = useMemo(() => usageHeatmapWeekdayLabels(locale), [locale]);
  const gridSize = useMemo(
    () => ({
      width: weeks * CELL_STEP - CELL_GAP,
      height: USAGE_HEATMAP_ROWS * CELL_STEP - CELL_GAP,
    }),
    [weeks],
  );

  const timezoneLabel = useMemo(() => formatUsageTimeZoneLabel(timezone), [timezone]);
  const renderTimezone = useCallback(
    () => <Text style={styles.timezone}>{timezoneLabel}</Text>,
    [timezoneLabel],
  );
  const describeCell = useCallback(
    (cell: UsageHeatmapCell) =>
      t("usage.heatmap.cell", {
        day: formatUsageDay(cell.day, locale),
        tokens: formatGroupedNumber(cell.tokens, locale),
      }),
    [locale, t],
  );
  // Every cell carries its own accessible name, and the pointer crossing the
  // grid re-renders the card on each square. Building 182 of them per hover
  // would mean 364 `Intl` formatters for a caption that changed one line.
  const cellLabels = useMemo(
    () => new Map(matrix.cells.map((cell) => [cell.day, describeCell(cell)])),
    [describeCell, matrix.cells],
  );

  return (
    <UsageCard
      title={t("usage.heatmap.title")}
      renderHeaderRight={renderTimezone}
      testID="usage-heatmap-card"
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={[styles.monthRow, { width: gridSize.width }]}>
            {matrix.monthLabels.map((label) => (
              <Text
                key={label.month}
                style={[styles.monthLabel, { left: label.week * CELL_STEP }]}
                numberOfLines={1}
              >
                {formatUsageMonthLabel(label.month, locale)}
              </Text>
            ))}
          </View>
          <View style={styles.gridRow}>
            <View style={[styles.weekdayColumn, { height: gridSize.height }]}>
              {weekdayLabels.map((label, index) => (
                <Text
                  key={WEEKDAY_IDS[index]}
                  style={[styles.weekdayLabel, { top: index * CELL_STEP }]}
                >
                  {label}
                </Text>
              ))}
            </View>
            <View style={[styles.grid, gridSize]}>
              {matrix.cells.map((cell) => (
                <UsageHeatmapSquare
                  key={cell.day}
                  cell={cell}
                  label={cellLabels.get(cell.day) ?? ""}
                  onHover={setHovered}
                />
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
      {isWeb ? (
        <View style={styles.captionRow}>
          <Text style={styles.caption} numberOfLines={1} testID="usage-heatmap-caption">
            {hovered ? describeCell(hovered) : " "}
          </Text>
        </View>
      ) : null}
      <View style={styles.legend}>
        <Text style={styles.legendLabel}>{t("usage.heatmap.less")}</Text>
        <View style={styles.legendSwatches}>
          <View style={[styles.legendSwatch, styles.heat0]} />
          <View style={[styles.legendSwatch, styles.heat1]} />
          <View style={[styles.legendSwatch, styles.heat2]} />
          <View style={[styles.legendSwatch, styles.heat3]} />
          <View style={[styles.legendSwatch, styles.heat4]} />
        </View>
        <Text style={styles.legendLabel}>{t("usage.heatmap.more")}</Text>
      </View>
    </UsageCard>
  );
}

/** Declared as a function so it reads `styles` at render, after the sheet exists. */
function heatLevelStyle(level: UsageHeatmapLevel) {
  switch (level) {
    case 0:
      return styles.heat0;
    case 1:
      return styles.heat1;
    case 2:
      return styles.heat2;
    case 3:
      return styles.heat3;
    case 4:
      return styles.heat4;
  }
}

function UsageHeatmapSquare({
  cell,
  label,
  onHover,
}: {
  cell: UsageHeatmapCell;
  label: string;
  onHover: (cell: UsageHeatmapCell | null) => void;
}) {
  const handleEnter = useCallback(() => onHover(cell), [cell, onHover]);
  const handleLeave = useCallback(() => onHover(null), [onHover]);

  return (
    <View
      accessible
      accessibilityLabel={label}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      style={[
        styles.cell,
        heatLevelStyle(cell.level),
        { left: cell.week * CELL_STEP, top: cell.weekday * CELL_STEP },
      ]}
      testID={`usage-heatmap-cell-${cell.day}`}
    />
  );
}

const styles = StyleSheet.create((theme) => {
  const palette = theme.colors.usage;
  return {
    timezone: {
      fontSize: 10,
      color: palette.inkFaint,
    },
    monthRow: {
      height: MONTH_ROW_HEIGHT,
      marginLeft: CELL_STEP,
    },
    monthLabel: {
      position: "absolute",
      fontSize: 10,
      color: palette.inkFaint,
    },
    gridRow: {
      flexDirection: "row",
    },
    weekdayColumn: {
      width: CELL_STEP,
    },
    weekdayLabel: {
      position: "absolute",
      height: CELL_SIZE,
      lineHeight: CELL_SIZE,
      fontSize: 9,
      color: palette.inkFaint,
    },
    grid: {
      position: "relative",
    },
    cell: {
      position: "absolute",
      width: CELL_SIZE,
      height: CELL_SIZE,
      borderRadius: 2,
    },
    heat0: { backgroundColor: palette.heat[0] },
    heat1: { backgroundColor: palette.heat[1] },
    heat2: { backgroundColor: palette.heat[2] },
    heat3: { backgroundColor: palette.heat[3] },
    heat4: { backgroundColor: palette.heat[4] },
    // The caption keeps its box whether or not a day is hovered: an empty line
    // that collapses would move every card below it as the pointer crosses the
    // grid, and a click aimed at one of them would miss.
    captionRow: {
      flexDirection: "row",
      marginTop: theme.spacing[2],
      height: 14,
      minWidth: 0,
    },
    caption: {
      flex: 1,
      minWidth: 0,
      fontSize: 10,
      lineHeight: 14,
      color: palette.inkMuted,
    },
    legend: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing[2],
      marginTop: theme.spacing[3],
    },
    legendLabel: {
      fontSize: 10,
      color: palette.inkFaint,
    },
    legendSwatches: {
      flexDirection: "row",
      gap: 2,
    },
    legendSwatch: {
      width: 10,
      height: 10,
      borderRadius: 1,
    },
  };
});
