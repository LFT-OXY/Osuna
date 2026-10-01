import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { selectActiveApiEndpoint } from "@/api-endpoints";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { Text } from "@/components/ui/text";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { renderUsageText } from "@/usage/text";
import { subscribeToRelativeTimeTick } from "@/utils/relative-time-ticker";
import { ProviderUsageIcon } from "./card";
import {
  resolvePlanUsageStrip,
  type PlanUsageStripPlanSegment,
  type PlanUsageStripWindowSegment,
} from "./strip";
import { TONE_COLOR_TOKEN } from "./tone";
import type { ProviderUsageTone } from "./types";
import { useProviderUsage } from "./use-provider-usage";

const RING_SIZE = ICON_SIZE.xs;
const RING_STROKE = 1.75;
const RING_CENTER = RING_SIZE / 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const ThemedProviderUsageIcon = withUnistyles(ProviderUsageIcon);

interface RingColors {
  trackColor: string;
  progressColor: string;
}

function toneRingColors(tone: ProviderUsageTone) {
  return function mapRingColors(theme: Theme): RingColors {
    return {
      trackColor: theme.colors.surface3,
      progressColor: theme.colors[TONE_COLOR_TOKEN[tone]],
    };
  };
}

const TONE_RING_COLORS: Record<ProviderUsageTone, (theme: Theme) => RingColors> = {
  ok: toneRingColors("ok"),
  warning: toneRingColors("warning"),
  danger: toneRingColors("danger"),
  default: toneRingColors("default"),
};

function mutedIconColor(theme: Theme) {
  return { color: theme.colors.foregroundMuted };
}

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

/**
 * Composer context strip 右侧的套餐仪表：只显示当前提供方，窄栏可见时每 5 分钟刷新。
 * 取数没就绪或不适用时什么也不渲染，窄栏其余内容不受影响。
 */
export function PlanUsageStripGauge({
  serverId,
  providerId,
}: {
  serverId: string;
  providerId: string;
}) {
  const { t } = useTranslation();
  const retainedPanelActive = useRetainedPanelActive();
  const appVisible = useAppActivelyVisible();
  const isVisible = retainedPanelActive && appVisible;
  const { view } = useProviderUsage(serverId, { enabled: isVisible, autoRefresh: true });
  // 能报套餐用量的主机（v0.1.98+）都有提供方快照（v0.1.48+），所以快照没到就是还在加载。
  const { entries } = useProvidersSnapshot(serverId);
  const now = useMinuteClock(retainedPanelActive);

  let hasActiveApiEndpoint: boolean | null = null;
  if (entries) hasActiveApiEndpoint = selectActiveApiEndpoint(entries, providerId) !== null;
  const segments = resolvePlanUsageStrip({ view, providerId, hasActiveApiEndpoint, now });
  if (!segments) return null;

  return (
    <View
      style={styles.gauge}
      role="group"
      accessibilityLabel={t("usage.planUsage.title")}
      testID="composer-plan-usage"
    >
      {segments.map((segment, index) =>
        segment.kind === "plan" ? (
          <PlanSegment key={segment.key} segment={segment} isFirst={index === 0} />
        ) : (
          <WindowSegment key={segment.key} segment={segment} isFirst={index === 0} />
        ),
      )}
    </View>
  );
}

// 每段的完整描述放在 role="group" 上：Web 上无 role 的 div 带 aria-label 会被读屏丢掉；
// accessible 让原生端把这一段当成一个无障碍元素读出描述。
function PlanSegment({
  segment,
  isFirst,
}: {
  segment: PlanUsageStripPlanSegment;
  isFirst: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View
      style={isFirst ? styles.segment : styles.segmentDivided}
      role="group"
      accessible
      accessibilityLabel={renderUsageText(t, segment.accessibilityLabel)}
      testID="composer-plan-usage-plan"
    >
      <ThemedProviderUsageIcon
        iconKey={segment.providerId}
        size={ICON_SIZE.xs}
        uniProps={mutedIconColor}
      />
      <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
        {segment.label}
      </Text>
    </View>
  );
}

function WindowSegment({
  segment,
  isFirst,
}: {
  segment: PlanUsageStripWindowSegment;
  isFirst: boolean;
}) {
  const { t } = useTranslation();
  const trailing = segment.trailing;
  return (
    <View
      style={isFirst ? styles.segment : styles.segmentDivided}
      role="group"
      accessible
      accessibilityLabel={renderUsageText(t, segment.accessibilityLabel)}
      testID={`composer-plan-usage-window-${segment.key}`}
    >
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
    </View>
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
