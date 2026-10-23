import React from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { Text } from "@/components/ui/text";
import { TooltipContent } from "@/components/ui/tooltip";
import { ICON_SIZE } from "@/styles/theme";
import {
  formatSessionCost,
  formatUsageTokens,
  type UsageMoney,
  type UsageTokenUnits,
} from "@/usage-stats/format";
import { renderUsageText } from "@/usage-stats/text";
import {
  describeUnpricedWarning,
  type TurnUsageModelRow,
  type TurnUsageModels,
  type TurnUsagePanelModel,
} from "@/usage-stats/turn-usage";
import { formatDuration } from "@/utils/time";

/** The popover sets its own width; the tooltip default (280) is for one-line hints. */
export const TURN_USAGE_PANEL_WIDTH = 300;

const ClockIcon = withUnistyles(Clock, mutedIconColorMapping);

/**
 * The turn usage popover: the turn's estimated cost and token totals on top,
 * the model (or one entry per model) below. Must render inside a `<Tooltip>`.
 */
export function TurnUsagePanel({
  panel,
  durationMs,
  money,
  units,
}: {
  panel: TurnUsagePanelModel;
  durationMs: number;
  money: UsageMoney;
  units: UsageTokenUnits;
}) {
  const { t } = useTranslation();
  const { totals } = panel;
  const stats = [
    { key: "input", label: t("message.turnUsage.stats.input"), value: totals.input },
    { key: "cache", label: t("message.turnUsage.stats.cache"), value: totals.cache },
    { key: "output", label: t("message.turnUsage.stats.output"), value: totals.output },
  ];
  // Reasoning is a subset of output: its own cell, never added to the output figure.
  if (totals.reasoning > 0) {
    stats.push({
      key: "reasoning",
      label: t("message.turnUsage.stats.reasoning"),
      value: totals.reasoning,
    });
  }

  return (
    <TooltipContent
      side="top"
      align="center"
      offset={8}
      maxWidth={TURN_USAGE_PANEL_WIDTH}
      style={styles.frame}
      testID="turn-usage-panel"
    >
      <View style={styles.overview}>
        <View style={styles.header}>
          <Text variant="caption" color="foregroundMuted">
            {t("message.turnUsage.title")}
          </Text>
          <View style={styles.duration}>
            <ClockIcon size={ICON_SIZE.xs} />
            <Text variant="caption" color="foregroundMuted" style={styles.numbers}>
              {formatDuration(durationMs)}
            </Text>
          </View>
        </View>
        <View style={styles.costRow}>
          <Text
            variant="display"
            weight="medium"
            style={totals.priced ? styles.numbers : styles.unpricedCost}
            testID="turn-usage-panel-cost"
          >
            {formatSessionCost(totals.estimatedCost, money)}
          </Text>
          <Text variant="caption" color="foregroundMuted" style={styles.costLabel}>
            {t("message.turnUsage.estimatedCost")}
          </Text>
        </View>
        <View style={styles.stats}>
          {stats.map((stat) => (
            <View key={stat.key} style={styles.stat} testID={`turn-usage-panel-stat-${stat.key}`}>
              <Text variant="micro" color="foregroundMuted" numberOfLines={1}>
                {stat.label}
              </Text>
              <Text
                variant="label"
                style={styles.numbers}
                numberOfLines={1}
                testID="turn-usage-panel-stat-value"
              >
                {formatUsageTokens(stat.value, units)}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <TurnUsageModelList models={panel.models} money={money} units={units} />
      <View style={styles.separator} />
      <View style={styles.footer}>
        {panel.unpricedModels.length > 0 ? <UnpricedWarning models={panel.unpricedModels} /> : null}
        <Text variant="micro" color="foregroundMuted">
          {t("message.turnUsage.note")}
        </Text>
      </View>
    </TooltipContent>
  );
}

function TurnUsageModelList({
  models,
  money,
  units,
}: {
  models: TurnUsageModels;
  money: UsageMoney;
  units: UsageTokenUnits;
}) {
  const { t } = useTranslation();
  if (models.kind === "none") return null;
  if (models.kind === "single") {
    return (
      <>
        <View style={styles.separator} />
        <View style={styles.singleModel}>
          <Text variant="caption" color="foregroundMuted">
            {t("message.turnUsage.model")}
          </Text>
          <Text
            variant="caption"
            numberOfLines={1}
            style={styles.singleModelName}
            testID="turn-usage-panel-model"
          >
            {models.model.model}
          </Text>
        </View>
      </>
    );
  }
  return (
    <>
      <View style={styles.separator} />
      <View style={styles.models}>
        <Text variant="micro" color="foregroundMuted">
          {t("message.turnUsage.byModel")}
        </Text>
        {models.models.map((row) => (
          <TurnUsageModelEntry key={row.model} row={row} money={money} units={units} />
        ))}
      </View>
    </>
  );
}

function UnpricedWarning({ models }: { models: readonly string[] }) {
  const { t } = useTranslation();
  const warning = describeUnpricedWarning(models, t("message.turnUsage.modelSeparator"));
  return (
    <View style={styles.warning} testID="turn-usage-panel-unpriced-warning">
      <View style={styles.warningDotSlot}>
        <View style={styles.warningDot} />
      </View>
      <Text variant="micro" color="statusWarning" style={styles.warningText}>
        {renderUsageText(t, warning)}
      </Text>
    </View>
  );
}

function TurnUsageModelEntry({
  row,
  money,
  units,
}: {
  row: TurnUsageModelRow;
  money: UsageMoney;
  units: UsageTokenUnits;
}) {
  const { t } = useTranslation();
  const amounts = [
    `↑${formatUsageTokens(row.input, units)}`,
    t("message.turnUsage.amounts.cache", { tokens: formatUsageTokens(row.cache, units) }),
    `↓${formatUsageTokens(row.output, units)}`,
  ];
  if (row.reasoning > 0) {
    amounts.push(
      t("message.turnUsage.amounts.reasoning", {
        tokens: formatUsageTokens(row.reasoning, units),
      }),
    );
  }
  return (
    <View>
      <View style={styles.modelLine}>
        <Text
          variant="caption"
          numberOfLines={1}
          style={styles.modelName}
          testID="turn-usage-panel-model"
        >
          {row.model}
        </Text>
        {row.priced ? (
          <Text variant="caption" style={styles.numbers}>
            {formatSessionCost(row.estimatedCost, money)}
          </Text>
        ) : (
          <Text variant="caption" color="statusWarning">
            {t("message.turnUsage.unpriced")}
          </Text>
        )}
      </View>
      <Text variant="micro" color="foregroundMuted" numberOfLines={1} style={styles.numbers}>
        {amounts.join(" · ")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Sections pad themselves so the separators run edge to edge.
  frame: {
    width: TURN_USAGE_PANEL_WIDTH,
    paddingVertical: 0,
    paddingHorizontal: 0,
    borderRadius: theme.radius.lg,
  },
  overview: {
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  duration: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  costRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[1.5],
  },
  costLabel: {
    flexShrink: 1,
  },
  numbers: {
    fontVariant: ["tabular-nums"],
  },
  unpricedCost: {
    fontVariant: ["tabular-nums"],
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
  },
  stats: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  stat: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  separator: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
  singleModel: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  singleModelName: {
    flexShrink: 1,
    minWidth: 0,
  },
  models: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  modelLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  modelName: {
    flex: 1,
    minWidth: 0,
  },
  footer: {
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[3],
  },
  warning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[1.5],
  },
  // One micro line tall, so the dot sits on the first line of a wrapped warning.
  warningDotSlot: {
    height: theme.typeScale.micro.lineHeight,
    justifyContent: "center",
  },
  warningDot: {
    width: 6,
    height: 6,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.statusWarning,
  },
  warningText: {
    flex: 1,
  },
}));
