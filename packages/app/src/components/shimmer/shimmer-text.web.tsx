import React, { useEffect, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Text } from "@/components/ui/text";
import { useReduceMotionEnabled } from "@/hooks/use-reduce-motion-enabled";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { SHIMMER_PLAY_STATE, TEXT_SHIMMER_ANIMATION_NAME } from "./animation-names";
import type { ShimmerTextProps } from "./shimmer-text-props";
import { shimmerSteps, WORKING_SHIMMER_DURATION_SECONDS } from "./timing";
import { useShimmerVisibilityRef } from "./visibility";
import { ensureShimmerKeyframes } from "./web-keyframes";

// 遮罩只读 alpha，#000 是"完全露出"，不是可见颜色。
const PEAK_MASK = "linear-gradient(90deg, transparent 0%, #000 50%, transparent 100%)";
const TABULAR_NUMS: "tabular-nums"[] = ["tabular-nums"];

/**
 * 一行弱色文字，上面叠一份前景色文字，用渐变遮罩只露出峰的位置并从左扫到右。扫光按固定帧率分段，
 * 滚出视口时暂停，开启减少动态效果时不叠这一层。
 */
export function ShimmerText({ text, testID }: ShimmerTextProps) {
  const reduceMotion = useReduceMotionEnabled();
  const visibilityRef = useShimmerVisibilityRef();

  useEffect(() => {
    if (!reduceMotion) ensureShimmerKeyframes();
  }, [reduceMotion]);

  // fontVariant 与遮罩放在同一个对象里：RN 的 TextStyle 没有 mask / animation，对象里得有一个
  // TextStyle 属性才能传给 Text 的 style（与 floating-surface.ts 的 backdropFilter 同理），不用 as 强转。
  const sweepStyle = useMemo(
    () =>
      inlineUnistylesStyle({
        fontVariant: TABULAR_NUMS,
        WebkitMaskImage: PEAK_MASK,
        maskImage: PEAK_MASK,
        WebkitMaskSize: "40% 100%",
        maskSize: "40% 100%",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        animation: `${TEXT_SHIMMER_ANIMATION_NAME} ${WORKING_SHIMMER_DURATION_SECONDS}s steps(${shimmerSteps(WORKING_SHIMMER_DURATION_SECONDS)}) infinite`,
        animationPlayState: SHIMMER_PLAY_STATE,
      }),
    [],
  );

  return (
    <View style={styles.frame}>
      <Text variant="label" color="foregroundMuted" style={styles.text} testID={testID}>
        {text}
      </Text>
      {reduceMotion ? null : (
        <View ref={visibilityRef} style={styles.sweepLayer} pointerEvents="none" aria-hidden>
          <Text variant="label" color="foreground" style={sweepStyle} numberOfLines={1}>
            {text}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: "relative",
  },
  text: {
    fontVariant: TABULAR_NUMS,
  },
  sweepLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    userSelect: "none",
  },
});
