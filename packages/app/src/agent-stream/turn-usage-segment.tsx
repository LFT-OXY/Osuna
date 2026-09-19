import React, { memo, useMemo, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { STREAM_METADATA_FONT_SIZE } from "@/components/message";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentUsageScope } from "@/usage/agent-scope";
import { formatSessionCost, formatTokenArrows, formatUsageTokensCompact } from "@/usage/format";
import {
  buildTurnUsageBreakdown,
  isTurnUsagePending,
  matchTurnUsage,
  summarizeTurnUsage,
  type TurnUsageAmounts,
  type TurnUsageIdentity,
} from "@/usage/turn-usage";
import { useAgentUsageTurns, type AgentUsageScope } from "@/usage/use-agent-usage";
import { formatDuration } from "@/utils/time";

/** The one place hover styles a Pressable: the segment tints its own background. */
function segmentStyle({ hovered }: PressableStateCallbackType) {
  return [styles.segment, hovered ? styles.segmentHovered : null];
}

/**
 * The `· ↑14.3K ↓4.6K · $0.17` tail of a completed turn's footer, with the
 * per-model breakdown behind hover (tap on mobile). A host without
 * `features.usage` renders nothing at all, which leaves the footer exactly as
 * it was before this existed.
 */
export const TurnUsageSegment = memo(function TurnUsageSegment({
  turnId,
  userMessageId,
}: TurnUsageIdentity) {
  const scope = useAgentUsageScope();
  if (!scope) return null;
  return <ScopedTurnUsageSegment scope={scope} turnId={turnId} userMessageId={userMessageId} />;
});

function ScopedTurnUsageSegment({
  scope,
  turnId,
  userMessageId,
}: TurnUsageIdentity & { scope: AgentUsageScope }) {
  const { t } = useTranslation();
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const { payload } = useAgentUsageTurns(scope);
  const turn = useMemo(
    () => (payload ? matchTurnUsage(payload.turns, { turnId, userMessageId }) : null),
    [payload, turnId, userMessageId],
  );

  if (!turn) {
    // The turn is over but its row has not been parsed yet; a bar holds the
    // space so the footer does not jump when it lands.
    return isTurnUsagePending(payload) ? <View style={styles.skeleton} /> : null;
  }

  const segment = summarizeTurnUsage(turn);
  const breakdown = buildTurnUsageBreakdown(turn);
  const tokenText = formatTokenArrows(segment.input, segment.output);
  const costText = formatSessionCost(segment.estimatedCost);

  return (
    <Tooltip
      open={isTooltipOpen}
      onOpenChange={setIsTooltipOpen}
      delayDuration={0}
      enabledOnDesktop
      enabledOnMobile
    >
      <TooltipTrigger asChild triggerRefProp="ref">
        <Pressable
          style={segmentStyle}
          testID="turn-usage-segment"
          accessibilityRole="button"
          accessibilityLabel={t("message.turnUsage.accessibility", {
            input: formatUsageTokensCompact(segment.input),
            output: formatUsageTokensCompact(segment.output),
            cost: costText,
          })}
        >
          <Text style={styles.segmentText}>{`· ${tokenText} · `}</Text>
          <Text style={segment.priced ? styles.segmentText : styles.unpricedCost}>{costText}</Text>
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <View style={styles.tooltip}>
          <Text style={styles.tooltipTitle}>{t("message.turnUsage.title")}</Text>
          <View style={styles.row}>
            <Text style={[styles.headerCell, styles.modelCell]}>
              {t("message.turnUsage.columns.model")}
            </Text>
            <Text style={[styles.headerCell, styles.numberCell]}>
              {t("message.turnUsage.columns.input")}
            </Text>
            <Text style={[styles.headerCell, styles.numberCell]}>
              {t("message.turnUsage.columns.cache")}
            </Text>
            <Text style={[styles.headerCell, styles.numberCell]}>
              {t("message.turnUsage.columns.output")}
            </Text>
            <Text style={[styles.headerCell, styles.numberCell]}>
              {t("message.turnUsage.columns.cost")}
            </Text>
          </View>
          {breakdown.rows.map((row) => (
            <View key={row.model} style={styles.row}>
              <View style={styles.modelCell}>
                <Text style={styles.modelName} numberOfLines={1}>
                  {row.model}
                </Text>
                {row.priced ? null : (
                  <Text style={styles.unpricedPill}>{t("message.turnUsage.unpriced")}</Text>
                )}
              </View>
              <TurnUsageAmountCells amounts={row} />
            </View>
          ))}
          {breakdown.total ? (
            <View style={styles.row}>
              <Text style={[styles.totalCell, styles.modelCell]}>
                {t("message.turnUsage.total")}
              </Text>
              <TurnUsageAmountCells amounts={breakdown.total} emphasis />
            </View>
          ) : null}
          <View style={styles.durationRow}>
            <Text style={styles.detail}>{t("message.turnUsage.duration")}</Text>
            <Text style={styles.detailValue}>{formatDuration(turn.durationMs)}</Text>
          </View>
          <Text style={styles.note}>{t("message.turnUsage.note")}</Text>
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Reasoning is a subset of output, so it is annotated beside the output column
 * rather than added to it or given a column of its own.
 */
function TurnUsageAmountCells({
  amounts,
  emphasis = false,
}: {
  amounts: TurnUsageAmounts;
  emphasis?: boolean;
}) {
  const { t } = useTranslation();
  const cellStyle = emphasis ? styles.totalCell : styles.bodyCell;
  return (
    <>
      <Text style={[cellStyle, styles.numberCell]}>{formatUsageTokensCompact(amounts.input)}</Text>
      <Text style={[cellStyle, styles.numberCell]}>{formatUsageTokensCompact(amounts.cache)}</Text>
      <Text style={[cellStyle, styles.numberCell]}>
        {amounts.reasoning > 0
          ? `${formatUsageTokensCompact(amounts.output)} ${t("message.turnUsage.reasoning", {
              tokens: formatUsageTokensCompact(amounts.reasoning),
            })}`
          : formatUsageTokensCompact(amounts.output)}
      </Text>
      <Text style={[cellStyle, styles.numberCell]}>{formatSessionCost(amounts.estimatedCost)}</Text>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  segment: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: theme.borderRadius.base,
    paddingHorizontal: theme.spacing[0.5],
  },
  segmentHovered: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  segmentText: {
    color: theme.colors.foregroundMuted,
    fontSize: STREAM_METADATA_FONT_SIZE,
    fontVariant: ["tabular-nums"],
  },
  unpricedCost: {
    color: theme.colors.foregroundMuted,
    fontSize: STREAM_METADATA_FONT_SIZE,
    fontVariant: ["tabular-nums"],
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
  },
  // Same height as the text it stands in for, so the row does not resize when
  // the real numbers arrive.
  skeleton: {
    width: 64,
    height: 12,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  tooltip: {
    gap: theme.spacing[1],
    minWidth: 280,
  },
  tooltipTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    marginBottom: theme.spacing[0.5],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  modelCell: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
  },
  numberCell: {
    minWidth: 56,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  headerCell: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  bodyCell: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  totalCell: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  modelName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  unpricedPill: {
    color: theme.colors.palette.amber[500],
    fontSize: theme.fontSize.sm,
  },
  durationRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  detail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  detailValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  note: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
