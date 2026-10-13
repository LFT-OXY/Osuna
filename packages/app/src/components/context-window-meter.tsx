import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { useHostReportsUsage } from "@/usage";
import { formatUsageTokensCompact } from "@/usage-stats/format";
import { useAgentUsageEvents, type AgentUsageScope } from "@/usage-stats/use-agent-usage";
import { popoverSurfaceStyle } from "@/styles/floating-surface";
import type { Theme } from "@/styles/theme";
import { ContextWindowDetails } from "./context-window-details";
import { ContextWindowSheet } from "./context-window-sheet";

interface ContextWindowMeterProps {
  serverId: string;
  agentId: string;
  maxTokens: number | null;
  usedTokens: number | null;
  showPercentage?: boolean;
  /** Optional glyph envelope for icon-toolbar alignment. */
  glyphSize?: number;
  /** The Paseo provider key, e.g. "claude", "codex"; names the API endpoint the agent runs on. */
  provider?: string | null;
  /** `features.usage`; `null` while the host has not said (disconnected, or no `server_info` yet). */
  usageSupport?: boolean | null;
  /** Start of the turn in flight, added to the agent's settled runtime as a stopwatch. */
  runningTurnStartedAt?: Date | null;
  /** `84K / 200K` beside the ring. Phones keep the ring alone. */
  showTokenLabel?: boolean;
}

const SVG_SIZE = 14;
const USAGE_POPOVER_WIDTH = 300;
const COMPACT_SVG_SIZE = 12;
const COMPACT_RADIUS = 5;
const STROKE_WIDTH = 2;
const COMPACT_STROKE_WIDTH = 1.75;

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

function getProgressColor(percentage: number, theme: Theme): string {
  if (percentage > 90) {
    return theme.colors.destructive;
  }
  if (percentage >= 70) {
    return theme.colors.palette.amber[500];
  }
  return theme.colors.foregroundMuted;
}

function getMeterGeometry(showPercentage: boolean, glyphSize?: number) {
  if (showPercentage) {
    return {
      svgSize: COMPACT_SVG_SIZE,
      radius: COMPACT_RADIUS,
      strokeWidth: COMPACT_STROKE_WIDTH,
      containerStyle: styles.containerWithLabel,
    };
  }
  const resolvedSize = glyphSize ?? SVG_SIZE;
  const resolvedStrokeWidth = glyphSize ? 2 : STROKE_WIDTH;
  return {
    svgSize: resolvedSize,
    radius: (resolvedSize - resolvedStrokeWidth) / 2,
    strokeWidth: resolvedStrokeWidth,
    containerStyle: styles.container,
  };
}

// Wrap the whole SVG: withUnistyles adds a div on web, which cannot sit inside an SVG.
const ContextWindowRing = withUnistyles(function ContextWindowRing({
  size,
  radius,
  strokeWidth,
  percentage,
  trackColor,
  progressColor,
}: {
  size: number;
  radius: number;
  strokeWidth: number;
  percentage: number | null;
  trackColor: string;
  progressColor: string;
}) {
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={trackColor}
        strokeWidth={strokeWidth}
      />
      {percentage !== null ? (
        <Circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={progressColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (clampPercentage(percentage) / 100) * circumference}
          // SVG strokes start at three o'clock; the ring reads clockwise from twelve.
          transform={`rotate(-90 ${center} ${center})`}
        />
      ) : null}
    </Svg>
  );
});

/** `84K / 200K` beside the ring; darkens while the pointer is on the meter. */
function ContextWindowTokenLabel({
  usedTokens,
  maxTokens,
  hovered,
}: {
  usedTokens: number;
  maxTokens: number;
  hovered: boolean;
}) {
  return (
    <Text
      style={[styles.tokenLabel, hovered && styles.tokenLabelHovered]}
      testID="context-window-token-label"
    >
      {`${formatUsageTokensCompact(usedTokens)} / ${formatUsageTokensCompact(maxTokens)}`}
    </Text>
  );
}

export function ContextWindowMeter({
  serverId,
  agentId,
  maxTokens,
  usedTokens,
  showPercentage = false,
  glyphSize,
  provider = null,
  usageSupport = null,
  runningTurnStartedAt = null,
  showTokenLabel = false,
}: ContextWindowMeterProps) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  // Usage cards need a fixed width; without them the card is as wide as its rows.
  const showsUsage = useHostReportsUsage(serverId);
  const popoverWidth = Math.min(USAGE_POPOVER_WIDTH, width - 24);
  const usageWidthStyle = useMemo(() => ({ width: popoverWidth }), [popoverWidth]);
  // Compact screens open the details in a sheet, which can hold a pressable Refresh.
  const isCompact = useIsCompactFormFactor();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const openSheet = useCallback(() => setIsSheetOpen(true), []);
  const closeSheet = useCallback(() => setIsSheetOpen(false), []);
  // 圆环旁的 token 标签随悬停变深；悬停只在 Web 上有（docs/hover.md）。
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const percentage =
    maxTokens !== null && usedTokens !== null ? getUsagePercentage(maxTokens, usedTokens) : null;
  const geometry = getMeterGeometry(showPercentage, glyphSize);
  // Osuna 的本会话合计：圆环常驻，由它订阅用量事件刷新；详情只在打开时读汇总。
  // The meter owns its own refetch: the stream view's subscription covers the
  // turn footers, and the composer is its sibling, not its descendant.
  const usageScope = useMemo<AgentUsageScope | null>(
    () => (usageSupport === true ? { serverId, agentId } : null),
    [agentId, serverId, usageSupport],
  );
  useAgentUsageEvents(usageScope);

  const context = useMemo(
    () =>
      percentage !== null && maxTokens !== null && usedTokens !== null
        ? { percentage: Math.round(percentage), maxTokens, usedTokens }
        : null,
    [percentage, maxTokens, usedTokens],
  );
  const meterColors = useCallback(
    (theme: Theme) => ({
      progressColor: getProgressColor(percentage ?? 0, theme),
      trackColor: theme.colors.surface3,
    }),
    [percentage],
  );
  const hasTokenLabel = showTokenLabel && !showPercentage && context !== null;
  const containerStyle = hasTokenLabel ? styles.containerWithLabel : geometry.containerStyle;
  const ring = (
    <ContextWindowRing
      size={geometry.svgSize}
      radius={geometry.radius}
      strokeWidth={geometry.strokeWidth}
      percentage={percentage}
      uniProps={meterColors}
    />
  );
  const percentageLabel =
    showPercentage && context ? (
      <Text style={styles.percentageLabel}>{`${context.percentage}%`}</Text>
    ) : null;
  const tokenLabel =
    hasTokenLabel && context ? (
      <ContextWindowTokenLabel
        usedTokens={context.usedTokens}
        maxTokens={context.maxTokens}
        hovered={isHovered}
      />
    ) : null;
  const accessibilityLabel = context
    ? t("contextWindow.accessibility", { percentage: context.percentage })
    : t("contextWindow.accessibilityNoData");
  const details = (refreshable: boolean, showTitle: boolean) => (
    <ContextWindowDetails
      serverId={serverId}
      agentId={agentId}
      context={context}
      provider={provider}
      usageSupport={usageSupport}
      runningTurnStartedAt={runningTurnStartedAt}
      showTitle={showTitle}
      refreshable={refreshable}
    />
  );

  if (isCompact) {
    return (
      <>
        <Pressable
          style={containerStyle}
          testID="context-window-meter"
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          onPress={openSheet}
        >
          {ring}
          {percentageLabel}
          {tokenLabel}
        </Pressable>
        <ContextWindowSheet open={isSheetOpen} onClose={closeSheet}>
          {details(true, false)}
        </ContextWindowSheet>
      </>
    );
  }

  const popoverStyle = [styles.popover, showsUsage && usageWidthStyle];

  // Native wide screens have no hover, so the details open in a tooltip on press. The tooltip
  // takes no presses, so its usage cards have no Refresh.
  if (isNative) {
    return (
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile>
        <TooltipTrigger asChild triggerRefProp="ref">
          <Pressable
            style={containerStyle}
            testID="context-window-meter"
            accessibilityRole="image"
            accessibilityLabel={accessibilityLabel}
          >
            {ring}
            {percentageLabel}
            {tokenLabel}
          </Pressable>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="center"
          offset={8}
          maxWidth={showsUsage ? popoverWidth : undefined}
          style={popoverStyle}
          testID="context-window-meter-tooltip"
        >
          {details(false, true)}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <HoverCard>
      <HoverCardTrigger focusable accessibilityLabel={accessibilityLabel}>
        <View
          style={containerStyle}
          testID="context-window-meter"
          accessibilityRole="image"
          accessibilityLabel={accessibilityLabel}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
        >
          {ring}
          {percentageLabel}
          {tokenLabel}
        </View>
      </HoverCardTrigger>
      <HoverCardContent
        placement="top"
        // 右缘对齐圆环：圆环靠近输入框右端，居中会让卡片伸出输入框。
        alignment="end"
        offset={8}
        role="dialog"
        accessibilityLabel={t("contextWindow.title")}
        testID="context-window-details"
        style={popoverStyle}
      >
        {details(true, true)}
      </HoverCardContent>
    </HoverCard>
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
  // 与菜单、提示同一套浮层外框（docs/design.md §6），不透明：卡里是成排的数字。
  popover: {
    ...popoverSurfaceStyle(theme, { glass: false }),
    padding: theme.spacing[3],
    gap: theme.spacing[3],
  },
}));
