import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { selectActiveApiEndpoint } from "@/api-endpoints";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { Text } from "@/components/ui/text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { BORDER_WIDTH, ICON_SIZE, type Theme } from "@/styles/theme";
import { UsageCard } from "@/usage/card";
import { useUsageDisplay } from "@/usage/display";
import { UsageSourceIcon } from "@/usage/source-icon";
import type { UsageTone } from "@/usage/types";
import { renderUsageText } from "@/usage-stats/text";
import { subscribeToRelativeTimeTick } from "@/utils/relative-time-ticker";
import {
  fitPlanUsageStripSegments,
  resolvePlanUsageStrip,
  selectPlanUsageStripReport,
  type PlanUsageStripPlanSegment,
  type PlanUsageStripSegment,
  type PlanUsageStripSpace,
  type PlanUsageStripWindowSegment,
} from "./strip";
import { useStripUsage } from "./use-strip-usage";

const RING_SIZE = ICON_SIZE.xs;
const RING_STROKE = 1.75;
const RING_CENTER = RING_SIZE / 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
// 仪表左右两条外框。
const GAUGE_FRAME_WIDTH = 2 * BORDER_WIDTH[1];
// 悬停卡片的宽度；Tooltip 默认的 280 是给一两行提示用的。
const HOVER_CARD_WIDTH = 300;

// 圆环的进度色，与上游额度卡片里窗口条的四种颜色一致。
const TONE_COLOR_TOKEN = {
  ok: "statusSuccess",
  warning: "statusWarning",
  danger: "statusDanger",
  default: "foregroundMuted",
} as const satisfies Record<UsageTone, keyof Theme["colors"]>;

interface RingColors {
  trackColor: string;
  progressColor: string;
}

function toneRingColors(tone: UsageTone) {
  return function mapRingColors(theme: Theme): RingColors {
    return {
      trackColor: theme.colors.surface3,
      progressColor: theme.colors[TONE_COLOR_TOKEN[tone]],
    };
  };
}

const TONE_RING_COLORS: Record<UsageTone, (theme: Theme) => RingColors> = {
  ok: toneRingColors("ok"),
  warning: toneRingColors("warning"),
  danger: toneRingColors("danger"),
  default: toneRingColors("default"),
};

/**
 * 倒计时跟着全局的分钟时钟走，不为每个窄栏单开定时器；面板隐藏时不订阅，回来时先对一次表。
 */
function useMinuteClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    return subscribeToRelativeTimeTick("minute", () => setNow(Date.now()));
  }, [active]);
  return now;
}

/** 量到的宽度按分段 key 记下；不可见的保留面板量出 0，不覆盖上次的值。 */
function useSegmentWidths() {
  const [widths, setWidths] = useState<Readonly<Record<string, number>>>({});
  const handleMeasure = useCallback((key: string, width: number) => {
    if (width <= 0) return;
    setWidths((current) => (current[key] === width ? current : { ...current, [key]: width }));
  }, []);
  return { widths, handleMeasure };
}

/**
 * 有可用宽度、每段都量过之后才知道放得下哪些段，在此之前一段也不显示，免得先溢出再收回。
 */
function selectVisibleSegments(input: {
  segments: PlanUsageStripSegment[];
  widths: Readonly<Record<string, number>>;
  space: PlanUsageStripSpace | null;
}): PlanUsageStripSegment[] {
  const { segments, widths, space } = input;
  if (!space) return [];
  const measured = [];
  for (const segment of segments) {
    const width = widths[segment.key];
    if (width === undefined) return [];
    measured.push({ key: segment.key, kind: segment.kind, width });
  }
  const shownKeys = new Set(
    fitPlanUsageStripSegments({
      availableWidth: space.availableWidth - GAUGE_FRAME_WIDTH,
      branchReservedWidth: space.branchReservedWidth,
      segments: measured,
    }),
  );
  return segments.filter((segment) => shownKeys.has(segment.key));
}

/**
 * Composer context strip 右侧的套餐仪表：显示当前 Agent 所用账号的额度（草稿按选中的
 * 提供方），窄栏可见时每 5 分钟刷新。取数没就绪或不适用时什么也不渲染，窄栏其余内容
 * 不受影响。放不下时按 `fitPlanUsageStripSegments` 隐藏分段；每段的宽度由一层看不见的
 * 完整副本量出。
 */
export function PlanUsageStripGauge({
  serverId,
  providerId,
  agentId,
  space,
}: {
  serverId: string;
  providerId: string;
  /** 草稿还没有 Agent 时为 null。 */
  agentId: string | null;
  /** 窄栏量出的可用空间；还没量到时为 null，先不显示。 */
  space: PlanUsageStripSpace | null;
}) {
  const { t } = useTranslation();
  const retainedPanelActive = useRetainedPanelActive();
  const appVisible = useAppActivelyVisible();
  const isVisible = retainedPanelActive && appVisible;
  const { agentReports, hostReports, refresh } = useStripUsage({ serverId, agentId, isVisible });
  // 能报套餐用量的主机（v0.1.98+）都有提供方快照（v0.1.48+），所以快照没到就是还在加载。
  const { entries } = useProvidersSnapshot(serverId);
  const now = useMinuteClock(retainedPanelActive);
  const entry = selectPlanUsageStripReport({ providerId, agentReports, hostReports });
  const shownReports = useMemo(() => (entry ? [entry] : []), [entry]);
  const { preferences, display } = useUsageDisplay(shownReports);
  const { widths, handleMeasure } = useSegmentWidths();
  const [isCardOpen, setIsCardOpen] = useState(false);
  const isCardOpenRef = useRef(false);
  // 每次打开都再取一次；daemon 的缓存挡住了对来源接口的重复请求。
  // 普通 View 上 pointerenter 和 mouseenter 都会报「打开」，只在从关到开时取数。
  const handleCardOpenChange = useCallback(
    (nextOpen: boolean) => {
      const wasOpen = isCardOpenRef.current;
      isCardOpenRef.current = nextOpen;
      setIsCardOpen(nextOpen);
      if (nextOpen && !wasOpen) refresh();
    },
    [refresh],
  );

  let hasActiveApiEndpoint: boolean | null = null;
  if (entries) hasActiveApiEndpoint = selectActiveApiEndpoint(entries, providerId) !== null;
  const segments = resolvePlanUsageStrip({
    entry,
    hasActiveApiEndpoint,
    displayAs: preferences.displayAs,
    now,
  });
  // 没有账号时 `resolvePlanUsageStrip` 也是 null；这里先收窄，下面的悬停卡片要用它。
  if (!entry) return null;
  if (!segments) return null;
  const visibleSegments = selectVisibleSegments({
    segments,
    widths,
    space,
  });

  return (
    <>
      <View
        style={styles.measureLayer}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {segments.map((segment, index) => (
          <MeasuredSegment
            key={segment.key}
            segment={segment}
            isFirst={index === 0}
            onMeasure={handleMeasure}
          />
        ))}
      </View>
      {visibleSegments.length > 0 ? (
        <Tooltip
          open={isCardOpen}
          onOpenChange={handleCardOpenChange}
          delayDuration={0}
          enabledOnDesktop
        >
          {/* 仪表本身就是悬停外框：Tooltip 在这个普通 View 上挂 pointerenter / pointerleave。 */}
          <TooltipTrigger asChild triggerRefProp="ref">
            <View
              collapsable={false}
              style={styles.gauge}
              role="group"
              accessibilityLabel={t("usage.planUsage.title")}
              testID="composer-plan-usage"
            >
              {visibleSegments.map((segment, index) => (
                <VisibleSegment key={segment.key} segment={segment} isFirst={index === 0} />
              ))}
            </View>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="end"
            offset={8}
            maxWidth={HOVER_CARD_WIDTH}
            style={styles.hoverCard}
            testID="composer-plan-usage-card"
          >
            {/* 悬停卡片不接受点按，所以不带刷新按钮；卡片底部写着多久前更新。 */}
            <UsageCard
              serverId={serverId}
              entry={entry}
              display={display}
              compact
              pinnable={false}
              refreshable={false}
            />
          </TooltipContent>
        </Tooltip>
      ) : null}
    </>
  );
}

function segmentTestID(segment: PlanUsageStripSegment): string {
  if (segment.kind === "plan") return "composer-plan-usage-plan";
  return `composer-plan-usage-window-${segment.key}`;
}

// 每段的完整描述放在 role="group" 上：Web 上无 role 的 div 带 aria-label 会被读屏丢掉；
// accessible 让原生端把这一段当成一个无障碍元素读出描述。
function VisibleSegment({
  segment,
  isFirst,
}: {
  segment: PlanUsageStripSegment;
  isFirst: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View
      style={isFirst ? styles.segment : styles.segmentDivided}
      role="group"
      accessible
      accessibilityLabel={renderUsageText(t, segment.accessibilityLabel)}
      testID={segmentTestID(segment)}
    >
      <SegmentContent segment={segment} />
    </View>
  );
}

// 测量用的副本不带 testID 和无障碍描述，外框与可见段一致，量出来的就是可见段的宽度。
function MeasuredSegment({
  segment,
  isFirst,
  onMeasure,
}: {
  segment: PlanUsageStripSegment;
  isFirst: boolean;
  onMeasure: (key: string, width: number) => void;
}) {
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => onMeasure(segment.key, Math.ceil(event.nativeEvent.layout.width)),
    [onMeasure, segment.key],
  );
  return (
    <View style={isFirst ? styles.segment : styles.segmentDivided} onLayout={handleLayout}>
      <SegmentContent segment={segment} />
    </View>
  );
}

function SegmentContent({ segment }: { segment: PlanUsageStripSegment }) {
  if (segment.kind === "plan") return <PlanSegmentContent segment={segment} />;
  return <WindowSegmentContent segment={segment} />;
}

function PlanSegmentContent({ segment }: { segment: PlanUsageStripPlanSegment }) {
  return (
    <>
      <UsageSourceIcon svg={segment.icon} size={ICON_SIZE.xs} />
      <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
        {segment.label}
      </Text>
    </>
  );
}

function WindowSegmentContent({ segment }: { segment: PlanUsageStripWindowSegment }) {
  const { t } = useTranslation();
  const trailing = segment.trailing;
  return (
    <>
      <ThemedUsageRing ringPct={segment.ringPct} uniProps={TONE_RING_COLORS[segment.tone]} />
      <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
        {renderUsageText(t, segment.shortName)}
      </Text>
      <Text variant="caption" style={styles.number} numberOfLines={1}>
        {segment.percentText}
      </Text>
      {trailing ? (
        <Text
          variant="caption"
          color={trailing.atRisk ? "statusDanger" : "foregroundMuted"}
          numberOfLines={1}
        >
          {renderUsageText(t, trailing.text)}
        </Text>
      ) : null}
    </>
  );
}

// 主题色从外面整体传进来：withUnistyles 包 SVG 子元素时会在 <svg> 里插一层 <div>，Web 上圆就画不出来。
function UsageRingGlyph({
  ringPct,
  trackColor = "",
  progressColor = "",
}: { ringPct: number } & Partial<RingColors>) {
  const dashOffset = RING_CIRCUMFERENCE - (ringPct / 100) * RING_CIRCUMFERENCE;
  return (
    <View style={styles.ring}>
      <Svg width={RING_SIZE} height={RING_SIZE}>
        <Circle
          cx={RING_CENTER}
          cy={RING_CENTER}
          r={RING_RADIUS}
          fill="none"
          stroke={trackColor}
          strokeWidth={RING_STROKE}
        />
        {ringPct > 0 ? (
          <Circle
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS}
            fill="none"
            stroke={progressColor}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
            strokeDashoffset={dashOffset}
          />
        ) : null}
      </Svg>
    </View>
  );
}

const ThemedUsageRing = withUnistyles(UsageRingGlyph);

const styles = StyleSheet.create((theme) => ({
  // 一整块分段控件：高 20、外框沿用 Composer 的描边色，段间用更轻的 border 分隔。
  gauge: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "stretch",
    height: 20,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderComposer,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
  },
  // 面板式浮层：外框定宽，内边距给在这里，卡片自己不带。Tooltip 默认样式写的是
  // paddingVertical / paddingHorizontal，单写 padding 会被它们盖掉。
  hoverCard: {
    width: HOVER_CARD_WIDTH,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.radius.lg,
  },
  // 看不见的完整副本，竖着排让每段都按内容取宽，不受可用宽度挤压。
  measureLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    opacity: 0,
    alignItems: "flex-start",
    pointerEvents: "none",
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  segmentDivided: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
  },
  number: {
    fontVariant: ["tabular-nums"],
  },
  // 从 12 点方向开始画。
  ring: {
    transform: [{ rotate: "-90deg" }],
  },
}));
