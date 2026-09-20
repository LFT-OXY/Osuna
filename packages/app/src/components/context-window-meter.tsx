import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProviderUsageTooltipSection } from "@/provider-usage/tooltip-section";
import { useProviderUsage } from "@/provider-usage/use-provider-usage";
import { formatSessionCost, formatTokenArrows, formatUsageTokensCompact } from "@/usage/format";
import { isUsageTrackedProvider } from "@/usage/sources";
import { addRunningTurnElapsed, hasAgentUsage, resolveSessionSpanMs } from "@/usage/turn-usage";
import {
  useAgentUsageEvents,
  useAgentUsageSummary,
  type AgentUsageScope,
  type AgentUsageSummaryPayload,
} from "@/usage/use-agent-usage";
import { formatDuration } from "@/utils/time";

interface ContextWindowMeterProps {
  maxTokens: number | null;
  usedTokens: number | null;
  totalCostUsd?: number | null;
  showPercentage?: boolean;
  serverId?: string;
  /** The Paseo provider key, e.g. "claude", "gemini", "codex" */
  provider?: string | null;
  /** Reserve the meter footprint and show a loading ring while usage is pending. */
  pending?: boolean;
  /** Optional glyph envelope for icon-toolbar alignment. */
  glyphSize?: number;
  /** The agent whose session total the popover reports. */
  agentId?: string | null;
  /** `features.usage`; `null` while the host has not said (disconnected, or no `server_info` yet). */
  usageSupport?: boolean | null;
  /** Start of the turn in flight, added to the agent's settled runtime as a stopwatch. */
  runningTurnStartedAt?: Date | null;
  /** `84K / 200K` beside the ring. Phones keep the ring alone. */
  showTokenLabel?: boolean;
}

const SVG_SIZE = 14;
const COMPACT_SVG_SIZE = 12;
const COMPACT_CENTER = COMPACT_SVG_SIZE / 2;
const COMPACT_RADIUS = 5;
const STROKE_WIDTH = 2;
const COMPACT_STROKE_WIDTH = 1.75;
const COMPACT_CIRCUMFERENCE = 2 * Math.PI * COMPACT_RADIUS;

function isValidMaxTokens(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isValidUsedTokens(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function getUsagePercentage(maxTokens: number, usedTokens: number): number | null {
  if (!isValidMaxTokens(maxTokens) || !isValidUsedTokens(usedTokens)) {
    return null;
  }
  return (usedTokens / maxTokens) * 100;
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function getMeterColors(
  percentage: number,
  theme: ReturnType<typeof useUnistyles>["theme"],
): { progress: string; track: string } {
  const track = theme.colors.surface3;
  if (percentage > 90) {
    return { progress: theme.colors.destructive, track };
  }
  if (percentage >= 70) {
    return { progress: theme.colors.palette.amber[500], track };
  }
  return { progress: theme.colors.foregroundMuted, track };
}

/** No cost yet means no cost line: `$0.00` there would read as "this was free". */
function resolveSessionCostLabel(totalCostUsd: number | null | undefined): string | null {
  if (typeof totalCostUsd !== "number" || !Number.isFinite(totalCostUsd) || totalCostUsd <= 0) {
    return null;
  }
  return formatSessionCost(totalCostUsd);
}

interface MeterGeometryInput {
  showPercentage: boolean;
  showTokenLabel: boolean;
  glyphSize?: number;
}

function getMeterGeometry({ showPercentage, showTokenLabel, glyphSize }: MeterGeometryInput) {
  if (showPercentage) {
    return {
      svgSize: COMPACT_SVG_SIZE,
      center: COMPACT_CENTER,
      radius: COMPACT_RADIUS,
      strokeWidth: COMPACT_STROKE_WIDTH,
      circumference: COMPACT_CIRCUMFERENCE,
      containerStyle: styles.containerWithLabel,
    };
  }
  const resolvedSize = glyphSize ?? SVG_SIZE;
  const resolvedStrokeWidth = glyphSize ? 2 : STROKE_WIDTH;
  return {
    svgSize: resolvedSize,
    center: resolvedSize / 2,
    radius: (resolvedSize - resolvedStrokeWidth) / 2,
    strokeWidth: resolvedStrokeWidth,
    circumference: Math.PI * (resolvedSize - resolvedStrokeWidth),
    containerStyle: showTokenLabel ? styles.containerWithLabel : styles.container,
  };
}

export function ContextWindowMeter({
  maxTokens,
  usedTokens,
  totalCostUsd,
  showPercentage = false,
  serverId,
  provider,
  pending = false,
  glyphSize,
  agentId,
  usageSupport = null,
  runningTurnStartedAt = null,
  showTokenLabel = false,
}: ContextWindowMeterProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const { view: providerUsageView, refresh: refreshProviderUsage } = useProviderUsage(
    serverId ?? null,
    { enabled: isTooltipOpen },
  );
  const usageScope = useMemo<AgentUsageScope | null>(
    () => (usageSupport === true && serverId && agentId ? { serverId, agentId } : null),
    [agentId, serverId, usageSupport],
  );
  // The meter owns its own refetch: the stream view's subscription covers the
  // turn footers, and the composer is its sibling, not its descendant.
  useAgentUsageEvents(usageScope);
  const { payload: agentUsage } = useAgentUsageSummary(usageScope, { enabled: isTooltipOpen });
  const percentage =
    maxTokens !== null && usedTokens !== null ? getUsagePercentage(maxTokens, usedTokens) : null;
  const handleTooltipOpenChange = useCallback(
    (nextOpen: boolean) => {
      setIsTooltipOpen(nextOpen);
      if (nextOpen) {
        void refreshProviderUsage().catch(() => {});
      }
    },
    [refreshProviderUsage],
  );

  const geometry = getMeterGeometry({ showPercentage, showTokenLabel, glyphSize });

  // No usage yet: reserve the footprint with a track-only ring while a session is
  // active so the real ring fades in without shifting siblings. Render nothing when
  // no usage is expected.
  if (percentage === null || maxTokens === null || usedTokens === null) {
    if (!pending) {
      return null;
    }
    return (
      <PendingContextWindowMeter
        geometry={geometry}
        trackColor={theme.colors.surface3}
        showLabel={showPercentage || showTokenLabel}
      />
    );
  }

  const clampedPercentage = clampPercentage(percentage);
  const roundedPercentage = Math.round(percentage);
  const { svgSize, center, radius, strokeWidth, circumference, containerStyle } = geometry;
  const dashOffset = circumference - (clampedPercentage / 100) * circumference;
  const colors = getMeterColors(clampedPercentage, theme);
  const formattedUsedTokens = formatUsageTokensCompact(usedTokens);
  const formattedMaxTokens = formatUsageTokensCompact(maxTokens);
  const formattedSessionCost = resolveSessionCostLabel(totalCostUsd);

  return (
    <Tooltip
      open={isTooltipOpen}
      onOpenChange={handleTooltipOpenChange}
      delayDuration={0}
      enabledOnDesktop
      enabledOnMobile
    >
      <TooltipTrigger asChild triggerRefProp="ref">
        <Pressable
          style={containerStyle}
          testID="context-window-meter"
          accessibilityRole="image"
          accessibilityLabel={t("contextWindow.accessibility", {
            percentage: roundedPercentage,
            used: formattedUsedTokens,
            max: formattedMaxTokens,
          })}
        >
          {({ hovered }) => (
            <>
              <Svg
                width={svgSize}
                height={svgSize}
                viewBox={`0 0 ${svgSize} ${svgSize}`}
                style={styles.svg}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Circle
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke={colors.track}
                  strokeWidth={strokeWidth}
                />
                <Circle
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke={colors.progress}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                />
              </Svg>
              {showPercentage ? (
                <Text style={styles.percentageLabel}>{`${roundedPercentage}%`}</Text>
              ) : null}
              {showTokenLabel && !showPercentage ? (
                <Text
                  style={[styles.tokenLabel, hovered ? styles.tokenLabelHovered : null]}
                  testID="context-window-token-label"
                >{`${formattedUsedTokens} / ${formattedMaxTokens}`}</Text>
              ) : null}
            </>
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <View style={styles.tooltipContent}>
          <Text style={styles.tooltipTitle}>{t("contextWindow.title")}</Text>
          <Text style={styles.tooltipText}>
            {t("contextWindow.used", { percentage: roundedPercentage })}
          </Text>
          <Text style={styles.tooltipDetail}>
            {t("contextWindow.tokens", {
              used: formattedUsedTokens,
              max: formattedMaxTokens,
            })}
          </Text>
          {formattedSessionCost ? (
            <Text style={styles.tooltipDetail}>
              {t("contextWindow.sessionCost", { cost: formattedSessionCost })}
            </Text>
          ) : null}
          <SessionTotalSection
            usageSupport={usageSupport}
            summary={agentUsage}
            provider={provider}
            runningTurnStartedAt={runningTurnStartedAt}
          />
          <ProviderUsageTooltipSection view={providerUsageView} activeProviderId={provider} />
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

/** A track-only ring holding the footprint until the first usage report lands. */
function PendingContextWindowMeter({
  geometry,
  trackColor,
  showLabel,
}: {
  geometry: ReturnType<typeof getMeterGeometry>;
  trackColor: string;
  showLabel: boolean;
}) {
  return (
    <View style={geometry.containerStyle}>
      <Svg
        width={geometry.svgSize}
        height={geometry.svgSize}
        viewBox={`0 0 ${geometry.svgSize} ${geometry.svgSize}`}
        style={styles.svg}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Circle
          cx={geometry.center}
          cy={geometry.center}
          r={geometry.radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={geometry.strokeWidth}
        />
      </Svg>
      {showLabel ? <View style={styles.skeletonLabel} /> : null}
    </View>
  );
}

/**
 * What this agent has spent across every provider session it ran in. A host
 * that predates `features.usage` says so instead of showing nothing, so the
 * missing numbers read as an old daemon rather than as a zero.
 */
function SessionTotalSection({
  usageSupport,
  summary,
  provider,
  runningTurnStartedAt,
}: {
  usageSupport: boolean | null;
  summary: AgentUsageSummaryPayload | undefined;
  provider: string | null | undefined;
  runningTurnStartedAt: Date | null;
}) {
  const { t } = useTranslation();
  if (usageSupport === null) return null;
  if (usageSupport === false) {
    return (
      <View style={styles.sessionTotalSection} testID="context-window-session-total">
        <Text style={styles.tooltipTitle}>{t("contextWindow.sessionTotal.title")}</Text>
        <Text style={styles.updatePill}>{t("contextWindow.sessionTotal.hostUpgradeRequired")}</Text>
      </View>
    );
  }
  // Zero for a CLI the scanner reads means the scan has not reached this agent —
  // the section shows and marks itself incomplete. Zero for any other provider
  // means there is nothing to read, and a row of zeroes would read as "free".
  if (!summary || !(hasAgentUsage(summary) || isUsageTrackedProvider(provider))) return null;

  const spanMs = resolveSessionSpanMs(summary);
  return (
    <View style={styles.sessionTotalSection} testID="context-window-session-total">
      <View style={styles.sessionTotalHeader}>
        <Text style={styles.tooltipTitle}>{t("contextWindow.sessionTotal.title")}</Text>
        {summary.complete ? null : (
          <Text style={styles.incompletePill}>{t("contextWindow.sessionTotal.incomplete")}</Text>
        )}
      </View>
      <View style={styles.sessionTotalRow}>
        <Text style={styles.tooltipDetail}>{t("contextWindow.sessionTotal.tokens")}</Text>
        <Text style={styles.sessionTotalValue}>
          {formatTokenArrows(summary.totals.input, summary.totals.output)}
        </Text>
      </View>
      <View style={styles.sessionTotalRow}>
        <Text style={styles.tooltipDetail}>{t("contextWindow.sessionTotal.estimatedCost")}</Text>
        <Text style={styles.sessionTotalValue}>{formatSessionCost(summary.estimatedCost)}</Text>
      </View>
      <View style={styles.sessionTotalRow}>
        <Text style={styles.tooltipDetail}>{t("contextWindow.sessionTotal.turns")}</Text>
        <Text style={styles.sessionTotalValue}>
          {runningTurnStartedAt
            ? t("contextWindow.sessionTotal.turnsRunning", { turns: summary.turns })
            : String(summary.turns)}
        </Text>
      </View>
      <View style={styles.sessionTotalRow}>
        <Text style={styles.tooltipDetail}>{t("contextWindow.sessionTotal.agentRuntime")}</Text>
        <AgentRuntimeValue
          durationMs={summary.durationMs}
          runningTurnStartedAt={runningTurnStartedAt}
        />
      </View>
      {spanMs === null ? null : (
        <View style={styles.sessionTotalRow}>
          <Text style={styles.tooltipDetail}>{t("contextWindow.sessionTotal.sessionSpan")}</Text>
          <Text style={styles.sessionTotalValue}>{formatDuration(spanMs)}</Text>
        </View>
      )}
    </View>
  );
}

/** Ticks only while a turn is in flight; a settled agent renders one string. */
function AgentRuntimeValue({
  durationMs,
  runningTurnStartedAt,
}: {
  durationMs: number;
  runningTurnStartedAt: Date | null;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const runningStartedAtMs = runningTurnStartedAt ? runningTurnStartedAt.getTime() : null;

  useEffect(() => {
    if (runningStartedAtMs === null) return;
    setNowMs(Date.now());
    const handle = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [runningStartedAtMs]);

  return (
    <Text style={styles.sessionTotalValue}>
      {formatDuration(addRunningTurnElapsed(durationMs, runningStartedAtMs, nowMs))}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  containerWithLabel: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
  },
  svg: {
    transform: [{ rotate: "-90deg" }],
  },
  percentageLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  tokenLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  tokenLabelHovered: {
    color: theme.colors.foreground,
  },
  skeletonLabel: {
    width: 22,
    height: theme.fontSize.base,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  tooltipContent: {
    gap: theme.spacing[1.5],
    minWidth: 200,
  },
  tooltipTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
  tooltipDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  sessionTotalSection: {
    gap: theme.spacing[1],
    paddingTop: theme.spacing[1.5],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  sessionTotalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  sessionTotalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  sessionTotalValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  incompletePill: {
    color: theme.colors.palette.amber[500],
    fontSize: theme.fontSize.sm,
  },
  updatePill: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
