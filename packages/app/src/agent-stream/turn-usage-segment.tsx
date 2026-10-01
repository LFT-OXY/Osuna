import React, { memo, useMemo, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { STREAM_METADATA_FONT_SIZE } from "@/components/message";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentUsageScope } from "@/usage/agent-scope";
import { formatSessionCost, formatTokenArrows, formatUsageTokensCompact } from "@/usage/format";
import {
  buildTurnUsagePanel,
  isTurnUsagePending,
  matchTurnUsage,
  summarizeTurnUsage,
  type TurnUsageIdentity,
} from "@/usage/turn-usage";
import { useAgentUsageTurns, type AgentUsageScope } from "@/usage/use-agent-usage";
import { TurnUsagePanel } from "./turn-usage-panel";

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
      <TurnUsagePanel panel={buildTurnUsagePanel(turn)} durationMs={turn.durationMs} />
    </Tooltip>
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
}));
