import { memo } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import {
  StatusRingFrame,
  type StatusRingProps,
  rotatorStyles,
  styles,
} from "@/components/status-ring/frame";
import { useReduceMotionEnabled, useStatusRingRotation } from "@/components/status-ring/clock";

/**
 * Native running indicator. The rotation is published by one shared UI-thread clock rather than
 * per-instance timing, so a ring that mounts mid-flight is already in phase — see `clock.ts`.
 * 开启减少动态效果时，四分之一弧停在顶部不动。
 *
 * The rotated view carries no theme-tracked style; the coloured arc is nested inside it. Putting
 * a Unistyles style on a Reanimated view crashes on theme change (docs/unistyles.md).
 */
export const StatusRing = memo(function StatusRing({ backdrop }: StatusRingProps) {
  const reduceMotion = useReduceMotionEnabled();
  const rotation = useStatusRingRotation({ enabled: !reduceMotion });
  const rotatorStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${reduceMotion ? 0 : rotation.value}deg` }],
  }));

  return (
    <StatusRingFrame backdrop={backdrop}>
      <Animated.View style={[rotatorStyles.rotator, rotatorStyle]}>
        <View style={styles.arc} />
      </Animated.View>
    </StatusRingFrame>
  );
});
