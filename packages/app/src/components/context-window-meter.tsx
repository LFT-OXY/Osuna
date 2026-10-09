import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Text as UiText } from "@/components/ui/text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ApiEndpointRef } from "@osuna/protocol/api-endpoint/rpc-schemas";
import { selectActiveApiEndpoint } from "@/api-endpoints";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { ProviderUsageTooltipSection } from "@/provider-usage/tooltip-section";
import type { ProviderUsageView } from "@/provider-usage/types";
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
  showPercentage?: boolean;
  serverId?: string;
  /** The Osuna provider key, e.g. "claude", "gemini", "codex" */
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
  /** 弹层末尾是否接套餐用量卡片；所在输入框的窄栏可见时由窄栏承担，弹层不再重复。 */
  showPlanUsage: boolean;
  popoverLayout: ContextWindowPopoverLayout;
}

/** 宽屏左右两栏（上下文 | 本会话合计），紧凑布局单栏叠放。 */
export type ContextWindowPopoverLayout = "columns" | "stacked";

const SVG_SIZE = 14;
const COMPACT_SVG_SIZE = 12;
const COMPACT_CENTER = COMPACT_SVG_SIZE / 2;
const COMPACT_RADIUS = 5;
const STROKE_WIDTH = 2;
const COMPACT_STROKE_WIDTH = 1.75;
const COMPACT_CIRCUMFERENCE = 2 * Math.PI * COMPACT_RADIUS;
// 两栏各 192，加上间距、竖线和内边距约 440。
const POPOVER_COLUMN_WIDTH = 192;
const COLUMNS_POPOVER_MAX_WIDTH = 440;
// 单栏与「用量」页、窄栏悬停卡片的套餐卡片同宽。
const STACKED_POPOVER_WIDTH = 300;

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

type SessionTotalState =
  | { kind: "hostUpgradeRequired" }
  | { kind: "summary"; summary: AgentUsageSummaryPayload };

/**
 * What this agent has spent across every provider session it ran in. A host
 * that predates `features.usage` says so instead of showing nothing, so the
 * missing numbers read as an old daemon rather than as a zero.
 */
function resolveSessionTotal(
  usageSupport: boolean | null,
  summary: AgentUsageSummaryPayload | undefined,
  provider: string | null | undefined,
): SessionTotalState | null {
  if (usageSupport === null) return null;
  if (usageSupport === false) return { kind: "hostUpgradeRequired" };
  // Zero for a CLI the scanner reads means the scan has not reached this agent —
  // the section shows and marks itself incomplete. Zero for any other provider
  // means there is nothing to read, and a row of zeroes would read as "free".
  if (!summary || !(hasAgentUsage(summary) || isUsageTrackedProvider(provider))) return null;
  return { kind: "summary", summary };
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
  showPercentage = false,
  serverId,
  provider,
  pending = false,
  glyphSize,
  agentId,
  usageSupport = null,
  runningTurnStartedAt = null,
  showTokenLabel = false,
  showPlanUsage,
  popoverLayout,
}: ContextWindowMeterProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const isPlanUsageShown = isTooltipOpen && showPlanUsage;
  const { view: providerUsageView, refresh: refreshProviderUsage } = useProviderUsage(
    serverId ?? null,
    { enabled: isPlanUsageShown },
  );
  const { entries: providerEntries } = useProvidersSnapshot(serverId ?? null, {
    enabled: isPlanUsageShown,
  });
  const activeApiEndpoint = selectActiveApiEndpoint(providerEntries, provider);
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
      if (nextOpen && showPlanUsage) {
        void refreshProviderUsage().catch(() => {});
      }
    },
    [refreshProviderUsage, showPlanUsage],
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
  const sessionTotal = resolveSessionTotal(usageSupport, agentUsage, provider);

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
      <ContextWindowPopover
        layout={popoverLayout}
        roundedPercentage={roundedPercentage}
        clampedPercentage={clampedPercentage}
        progressColor={colors.progress}
        usedTokensLabel={formattedUsedTokens}
        maxTokensLabel={formattedMaxTokens}
        sessionTotal={sessionTotal}
        runningTurnStartedAt={runningTurnStartedAt}
        showPlanUsage={showPlanUsage}
        providerUsageView={providerUsageView}
        provider={provider}
        activeApiEndpoint={activeApiEndpoint}
      />
    </Tooltip>
  );
}

interface ContextWindowPopoverProps {
  layout: ContextWindowPopoverLayout;
  roundedPercentage: number;
  clampedPercentage: number;
  progressColor: string;
  usedTokensLabel: string;
  maxTokensLabel: string;
  sessionTotal: SessionTotalState | null;
  runningTurnStartedAt: Date | null;
  showPlanUsage: boolean;
  providerUsageView: ProviderUsageView;
  provider: string | null | undefined;
  activeApiEndpoint: ApiEndpointRef | null;
}

/**
 * 上下文圆环的弹层：上下文窗口和本会话合计，宽屏左右两栏、紧凑布局单栏叠放；
 * 没有窄栏的输入框在末尾接套餐用量卡片。
 */
function ContextWindowPopover({
  layout,
  roundedPercentage,
  clampedPercentage,
  progressColor,
  usedTokensLabel,
  maxTokensLabel,
  sessionTotal,
  runningTurnStartedAt,
  showPlanUsage,
  providerUsageView,
  provider,
  activeApiEndpoint,
}: ContextWindowPopoverProps) {
  const { t } = useTranslation();
  const isColumns = layout === "columns";
  // 宽屏但没有窄栏时，套餐卡片接在两栏下面。
  const hasPlanUsageBelowColumns = isColumns && showPlanUsage;
  return (
    <TooltipContent
      side="top"
      align="end"
      offset={8}
      maxWidth={isColumns ? COLUMNS_POPOVER_MAX_WIDTH : STACKED_POPOVER_WIDTH}
      style={[
        styles.popover,
        isColumns ? null : styles.popoverStacked,
        hasPlanUsageBelowColumns ? styles.popoverColumnsWithPlanUsage : null,
      ]}
      testID="context-window-popover"
    >
      <View style={isColumns ? styles.popoverColumns : styles.popoverStack}>
        <View style={isColumns ? styles.popoverColumn : null}>
          <View style={styles.popoverSection} testID="context-window-context">
            <UiText variant="micro" weight="medium" color="foregroundExtraMuted">
              {t("contextWindow.title")}
            </UiText>
            <View style={styles.heroRow}>
              <UiText variant="display" style={styles.number}>
                {`${roundedPercentage}%`}
              </UiText>
              <UiText variant="label" color="foregroundMuted">
                {t("contextWindow.usedLabel")}
              </UiText>
            </View>
            <View style={styles.contextTrack}>
              <View
                style={[
                  styles.contextFill,
                  { width: `${clampedPercentage}%`, backgroundColor: progressColor },
                ]}
              />
            </View>
            <PopoverKeyValueRow label={t("contextWindow.tokens")}>
              {`${usedTokensLabel} / ${maxTokensLabel}`}
            </PopoverKeyValueRow>
          </View>
        </View>
        {sessionTotal ? (
          <>
            <View style={isColumns ? styles.columnDivider : styles.stackDivider} />
            <View style={isColumns ? styles.popoverColumn : null}>
              <SessionTotalSection
                state={sessionTotal}
                runningTurnStartedAt={runningTurnStartedAt}
              />
            </View>
          </>
        ) : null}
      </View>
      {showPlanUsage ? (
        <ProviderUsageTooltipSection
          view={providerUsageView}
          activeProviderId={provider}
          activeApiEndpoint={activeApiEndpoint}
        />
      ) : null}
    </TooltipContent>
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

function SessionTotalSection({
  state,
  runningTurnStartedAt,
}: {
  state: SessionTotalState;
  runningTurnStartedAt: Date | null;
}) {
  const { t } = useTranslation();
  if (state.kind === "hostUpgradeRequired") {
    return (
      <View style={styles.popoverSection} testID="context-window-session-total">
        <UiText variant="micro" weight="medium" color="foregroundExtraMuted">
          {t("contextWindow.sessionTotal.title")}
        </UiText>
        <UiText variant="caption" color="foregroundMuted">
          {t("contextWindow.sessionTotal.hostUpgradeRequired")}
        </UiText>
      </View>
    );
  }

  const { summary } = state;
  const spanMs = resolveSessionSpanMs(summary);
  const turnsValue = runningTurnStartedAt
    ? t("contextWindow.sessionTotal.turnsRunning", { turns: summary.turns })
    : String(summary.turns);
  return (
    <View style={styles.popoverSection} testID="context-window-session-total">
      <View style={styles.sessionTotalHeader}>
        <UiText variant="micro" weight="medium" color="foregroundExtraMuted">
          {t("contextWindow.sessionTotal.title")}
        </UiText>
        {summary.complete ? null : (
          <UiText variant="micro" color="statusWarning">
            {t("contextWindow.sessionTotal.incomplete")}
          </UiText>
        )}
      </View>
      <PopoverKeyValueRow label={t("contextWindow.sessionTotal.tokens")}>
        {formatTokenArrows(summary.totals.input, summary.totals.output)}
      </PopoverKeyValueRow>
      <PopoverKeyValueRow label={t("contextWindow.sessionTotal.estimatedCost")}>
        {formatSessionCost(summary.estimatedCost)}
      </PopoverKeyValueRow>
      <PopoverKeyValueRow label={t("contextWindow.sessionTotal.turns")}>
        {turnsValue}
      </PopoverKeyValueRow>
      <PopoverKeyValueRow label={t("contextWindow.sessionTotal.agentRuntime")}>
        <AgentRuntimeValue
          durationMs={summary.durationMs}
          runningTurnStartedAt={runningTurnStartedAt}
        />
      </PopoverKeyValueRow>
      {spanMs === null ? null : (
        <PopoverKeyValueRow label={t("contextWindow.sessionTotal.sessionSpan")}>
          {formatDuration(spanMs)}
        </PopoverKeyValueRow>
      )}
    </View>
  );
}

/** 文字值按等宽数字排；组件值（如跳动的运行时长）自己负责排版。 */
function PopoverKeyValueRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.keyValueRow}>
      <UiText variant="caption" color="foregroundMuted" numberOfLines={1} style={styles.keyLabel}>
        {label}
      </UiText>
      {typeof children === "string" ? (
        <UiText variant="caption" numberOfLines={1} style={styles.number}>
          {children}
        </UiText>
      ) : (
        children
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
    <UiText variant="caption" numberOfLines={1} style={styles.number}>
      {formatDuration(addRunningTurnElapsed(durationMs, runningStartedAtMs, nowMs))}
    </UiText>
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
  popover: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.radius.lg,
  },
  popoverStacked: {
    width: STACKED_POPOVER_WIDTH,
  },
  // 宽屏但没有窄栏时套餐卡片接在两栏下面，卡片的表格需要这么宽。
  popoverColumnsWithPlanUsage: {
    minWidth: STACKED_POPOVER_WIDTH,
  },
  popoverColumns: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  popoverStack: {
    gap: theme.spacing[3],
  },
  popoverColumn: {
    width: POPOVER_COLUMN_WIDTH,
  },
  popoverSection: {
    gap: theme.spacing[1.5],
  },
  // 浮层描边用的就是 borderAccent；`border` 与浮层底色相同，画出来看不见。
  columnDivider: {
    width: theme.borderWidth[1],
    backgroundColor: theme.colors.borderAccent,
  },
  stackDivider: {
    height: theme.borderWidth[1],
    backgroundColor: theme.colors.borderAccent,
    // 抵消浮层的左右内边距，分隔线横贯整个弹层。
    marginHorizontal: -theme.spacing[3],
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[1.5],
  },
  contextTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  contextFill: {
    height: 4,
    borderRadius: 2,
  },
  sessionTotalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  keyValueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  keyLabel: {
    flexShrink: 1,
  },
  number: {
    fontVariant: ["tabular-nums"],
  },
}));
