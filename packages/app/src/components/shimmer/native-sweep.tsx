import React, { memo, useEffect, useMemo, useState, type ReactElement } from "react";
import { View, type ViewStyle } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from "react-native-svg";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useReduceMotionEnabled } from "@/hooks/use-reduce-motion-enabled";
import { quantizeShimmerProgress, shimmerSteps } from "./timing";

// 扫光层不读主题，全部是定位用的静态样式，可以直接放在 Animated.View 上（docs/unistyles.md）。
const OVERLAY_STYLE: ViewStyle = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  overflow: "hidden",
};
const PEAK_BASE_STYLE: ViewStyle = { position: "absolute", top: 0, bottom: 0, left: 0 };

// 峰是叠在文字上的白色高光，与主题无关；它只在文字遮罩内可见。
function ShimmerPeak({ gradientId }: { gradientId: string }) {
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <SvgLinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor="#ffffff" stopOpacity={0} />
          <Stop offset="50%" stopColor="#ffffff" stopOpacity={1} />
          <Stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

interface NativeShimmerSweepProps {
  width: number;
  height: number;
  peakWidth: number;
  durationSeconds: number;
  /** 遮罩：与底下文字同样排版的一份不透明文字，扫光只在文字笔画里可见。 */
  renderMask: () => ReactElement;
}

/**
 * 原生端扫光：一道白色渐变峰在文字遮罩里从左扫到右。按固定帧率分段前进，所在面板隐藏时停下，
 * 开启减少动态效果时整层不渲染。
 */
export const NativeShimmerSweep = memo(function NativeShimmerSweep({
  width,
  height,
  peakWidth,
  durationSeconds,
  renderMask,
}: NativeShimmerSweepProps) {
  const isPanelActive = useRetainedPanelActive();
  const reduceMotion = useReduceMotionEnabled();
  const running = isPanelActive && !reduceMotion;
  const steps = shimmerSteps(durationSeconds);
  const progress = useSharedValue(0);
  const [gradientId] = useState(() => `shimmer-gradient-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    if (!running) {
      cancelAnimation(progress);
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: durationSeconds * 1000, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [durationSeconds, progress, running]);

  const peakAnimatedStyle = useAnimatedStyle(() => {
    const start = -peakWidth;
    const end = width + peakWidth;
    const stepped = quantizeShimmerProgress(progress.value, steps);
    return { transform: [{ translateX: start + stepped * (end - start) }] };
  });

  const trackStyle = useMemo(() => [OVERLAY_STYLE, { width, height }], [height, width]);
  const peakStyle = useMemo(
    () => [PEAK_BASE_STYLE, peakAnimatedStyle, { width: peakWidth, height }],
    [height, peakAnimatedStyle, peakWidth],
  );

  if (reduceMotion || width <= 0 || height <= 0) {
    return null;
  }

  return (
    <View style={OVERLAY_STYLE} pointerEvents="none">
      <MaskedView pointerEvents="none" style={trackStyle} maskElement={renderMask()}>
        <View pointerEvents="none" style={trackStyle}>
          <Animated.View pointerEvents="none" style={peakStyle}>
            <ShimmerPeak gradientId={gradientId} />
          </Animated.View>
        </View>
      </MaskedView>
    </View>
  );
});
