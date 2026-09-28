import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  StyleSheet as RNStyleSheet,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Text } from "@/components/ui/text";
import { getProviderBrandColor } from "@/components/provider-icons";
import { useReduceMotionEnabled } from "@/hooks/use-reduce-motion-enabled";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { baseColors, type Theme } from "@/styles/theme";
import { thinkingSliderKeyboardProps } from "@/composer/agent-controls/thinking-slider-keyboard";
import {
  resolveThinkingGradient,
  resolveThinkingParticleIntensity,
  resolveThinkingParticleLayout,
  resolveThinkingParticles,
  resolveThinkingStopPositions,
  snapThinkingPosition,
  stepThinkingIndex,
  type ThinkingParticleLayout,
} from "@/composer/agent-controls/thinking";

export interface ThinkingSliderOption {
  id: string;
  label: string;
}

export interface ThinkingSliderProps {
  options: ThinkingSliderOption[];
  selectedId: string | undefined;
  provider: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}

const TRACK_HEIGHT = 24;
const THUMB_SIZE = 18;
const TRACK_PADDING = (TRACK_HEIGHT - THUMB_SIZE) / 2;
const STOP_DOT_SIZE = 4;
const THUMB_TRAVEL_MS = 160;
const PARTICLE_DRIFT_X = 6;
const PARTICLE_DRIFT_Y = 3;

const ADJUSTABLE_ACTIONS = [{ name: "increment" }, { name: "decrement" }] as const;

interface PendingSelection {
  id: string;
  // 提交时的选中 id；父级把选中换掉之后，这条待定记录就不再作数。
  baseSelectedId: string | undefined;
}

function toProgress(index: number, optionCount: number): number {
  return resolveThinkingStopPositions(optionCount)[index] ?? 0;
}

function toRailWidth(trackWidth: number): number {
  return Math.max(0, trackWidth - TRACK_PADDING * 2 - THUMB_SIZE);
}

function ThinkingFillGradient({
  gradientId,
  from,
  to,
}: {
  gradientId: string;
  from: string;
  to: string;
}) {
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <SvgLinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor={from} stopOpacity={1} />
          <Stop offset="100%" stopColor={to} stopOpacity={1} />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

const ThemedThinkingFillGradient = withUnistyles(ThinkingFillGradient);

function ThinkingParticle({
  layout,
  driftMs,
}: {
  layout: ThinkingParticleLayout;
  driftMs: number;
}) {
  const cycle = useSharedValue(0);

  useEffect(() => {
    cycle.value = 0;
    cycle.value = withDelay(
      Math.round(layout.phase * driftMs),
      withRepeat(withTiming(1, { duration: driftMs, easing: Easing.linear }), -1, false),
    );
    return () => cancelAnimation(cycle);
  }, [cycle, driftMs, layout.phase]);

  const animatedStyle = useAnimatedStyle(() => {
    const turn = cycle.value * Math.PI * 2;
    return {
      opacity: 0.2 + 0.8 * Math.sin(cycle.value * Math.PI),
      transform: [
        { translateX: (cycle.value - 0.5) * PARTICLE_DRIFT_X },
        { translateY: Math.sin(turn) * PARTICLE_DRIFT_Y },
      ],
    };
  });

  const placement = useMemo(
    () => ({
      left: `${layout.left * 100}%` as const,
      top: `${layout.top * 100}%` as const,
      width: layout.size,
      height: layout.size,
      borderRadius: layout.size / 2,
    }),
    [layout],
  );

  return (
    <Animated.View
      testID="thinking-slider-particle"
      pointerEvents="none"
      style={[motionStyles.particle, placement, animatedStyle]}
    />
  );
}

function ThinkingParticles({ index, optionCount }: { index: number; optionCount: number }) {
  const { count, driftMs } = resolveThinkingParticles(
    resolveThinkingParticleIntensity(index, optionCount),
  );
  // 光点的序号就是它的身份：位置由序号算出，数量变化时只增删末尾。
  const particles = useMemo(
    () =>
      Array.from({ length: count }, (_, ordinal) => ({
        id: `particle-${ordinal}`,
        layout: resolveThinkingParticleLayout(ordinal),
      })),
    [count],
  );
  return (
    <>
      {particles.map((particle) => (
        <ThinkingParticle key={particle.id} layout={particle.layout} driftMs={driftMs} />
      ))}
    </>
  );
}

export function ThinkingSlider({
  options,
  selectedId,
  provider,
  disabled,
  onSelect,
}: ThinkingSliderProps) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotionEnabled();
  const gradientId = `thinking-slider-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const optionCount = options.length;
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === selectedId),
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  // 运行中的 Agent 要等 daemon 回写后选中才变；这之前先显示刚提交的档，滑块不会先弹回去。
  const pendingIndex =
    pending && pending.baseSelectedId === selectedId
      ? options.findIndex((option) => option.id === pending.id)
      : -1;
  const committedIndex = pendingIndex >= 0 ? pendingIndex : selectedIndex;
  const displayIndex = dragIndex ?? committedIndex;
  const displayLabel = options[displayIndex]?.label ?? "";
  const railWidth = toRailWidth(trackWidth);

  const progress = useSharedValue(toProgress(displayIndex, optionCount));
  const rail = useSharedValue(railWidth);

  useEffect(() => {
    const target = toProgress(displayIndex, optionCount);
    progress.value = reduceMotion
      ? target
      : withTiming(target, { duration: THUMB_TRAVEL_MS, easing: Easing.out(Easing.cubic) });
  }, [displayIndex, optionCount, progress, reduceMotion]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * rail.value }],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    width: TRACK_PADDING * 2 + THUMB_SIZE + progress.value * rail.value,
  }));

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || index === committedIndex) return;
      // 回写前退回原档：清掉待定，并照常提交，覆盖还在路上的那次设置。
      setPending(option.id === selectedId ? null : { id: option.id, baseSelectedId: selectedId });
      onSelect(option.id);
    },
    [committedIndex, onSelect, options, selectedId],
  );

  const step = useCallback(
    (delta: 1 | -1) => {
      if (disabled) return;
      const next = stepThinkingIndex(displayIndex, delta, optionCount);
      if (next !== displayIndex) commit(next);
    },
    [commit, disabled, displayIndex, optionCount],
  );

  const gesture = useMemo(() => {
    const snapAt = (x: number) =>
      snapThinkingPosition(
        railWidth > 0 ? (x - TRACK_PADDING - THUMB_SIZE / 2) / railWidth : 0,
        optionCount,
      );
    // 拖动只预览吸附后的档，松手才提交；点击在抬起时直接提交最近一档。
    const pan = Gesture.Pan()
      .runOnJS(true)
      .enabled(!disabled)
      .minDistance(1)
      .onStart((event) => setDragIndex(snapAt(event.x)))
      .onUpdate((event) => setDragIndex(snapAt(event.x)))
      .onEnd((event, success) => {
        if (success) commit(snapAt(event.x));
      })
      .onFinalize(() => setDragIndex(null));
    const tap = Gesture.Tap()
      .runOnJS(true)
      .enabled(!disabled)
      .onEnd((event, success) => {
        if (success) commit(snapAt(event.x));
      });
    return Gesture.Race(pan, tap);
  }, [commit, disabled, optionCount, railWidth]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const width = event.nativeEvent.layout.width;
      rail.value = toRailWidth(width);
      setTrackWidth(width);
    },
    [rail],
  );

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === "increment") step(1);
      if (event.nativeEvent.actionName === "decrement") step(-1);
    },
    [step],
  );

  const keyboardProps = useMemo(() => thinkingSliderKeyboardProps(step), [step]);

  const gradientMapping = useCallback(
    (theme: Theme) =>
      resolveThinkingGradient(getProviderBrandColor(provider), {
        from: theme.colors.thinkingGradientFrom,
        to: theme.colors.thinkingGradientTo,
      }),
    [provider],
  );

  const particleFieldStyle = useMemo(() => ({ width: trackWidth }), [trackWidth]);
  const stopPositions = resolveThinkingStopPositions(optionCount);

  return (
    <View style={[styles.panel, disabled && styles.panelDisabled]} testID="agent-thinking-slider">
      <Text variant="body" weight="medium" testID="agent-thinking-slider-value">
        {displayLabel}
      </Text>
      <GestureDetector gesture={gesture}>
        <View
          style={styles.track}
          onLayout={handleLayout}
          accessible
          role="slider"
          aria-label={t("agentControls.thinking.title")}
          aria-valuemin={0}
          aria-valuemax={Math.max(optionCount - 1, 0)}
          aria-valuenow={displayIndex}
          aria-valuetext={displayLabel}
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          accessibilityActions={ADJUSTABLE_ACTIONS}
          onAccessibilityAction={handleAccessibilityAction}
          testID="agent-thinking-slider-track"
          {...keyboardProps}
        >
          <Animated.View pointerEvents="none" style={[motionStyles.fill, fillStyle]}>
            <View style={motionStyles.fillContent}>
              <ThemedThinkingFillGradient gradientId={gradientId} uniProps={gradientMapping} />
            </View>
            {reduceMotion ? null : (
              <View style={[motionStyles.particleField, particleFieldStyle]}>
                <ThinkingParticles index={displayIndex} optionCount={optionCount} />
              </View>
            )}
          </Animated.View>
          {stopPositions.map((position, index) =>
            index === displayIndex ? null : (
              <View
                key={options[index]?.id ?? `stop-${position}`}
                pointerEvents="none"
                testID="agent-thinking-slider-stop"
                style={[
                  styles.stopDot,
                  index < displayIndex ? styles.stopDotFilled : styles.stopDotEmpty,
                  inlineUnistylesStyle({
                    left: TRACK_PADDING + THUMB_SIZE / 2 + position * railWidth - STOP_DOT_SIZE / 2,
                  }),
                ]}
              />
            ),
          )}
          <Animated.View pointerEvents="none" style={[motionStyles.thumbFrame, thumbStyle]}>
            <View style={styles.thumb} />
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

// 带动画的节点只用 React Native 静态样式；主题色放在里面的普通 View 上（docs/unistyles.md）。
const motionStyles = RNStyleSheet.create({
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: TRACK_HEIGHT / 2,
    overflow: "hidden",
  },
  fillContent: {
    ...RNStyleSheet.absoluteFillObject,
  },
  particleField: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
  },
  particle: {
    position: "absolute",
    backgroundColor: baseColors.white,
  },
  thumbFrame: {
    position: "absolute",
    left: TRACK_PADDING,
    top: TRACK_PADDING,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
  },
});

const styles = StyleSheet.create((theme) => ({
  panel: {
    gap: theme.spacing[2],
  },
  panelDisabled: {
    opacity: theme.opacity[50],
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surface3,
    justifyContent: "center",
  },
  stopDot: {
    position: "absolute",
    top: (TRACK_HEIGHT - STOP_DOT_SIZE) / 2,
    width: STOP_DOT_SIZE,
    height: STOP_DOT_SIZE,
    borderRadius: theme.radius.full,
  },
  stopDotFilled: {
    backgroundColor: theme.colors.palette.white,
    opacity: theme.opacity[50],
  },
  stopDotEmpty: {
    backgroundColor: theme.colors.foregroundMuted,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.palette.white,
    boxShadow: `0 1px 3px ${theme.colors.shadowPopover}`,
  },
}));
