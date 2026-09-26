import { useCallback, useLayoutEffect, useRef, type RefCallback } from "react";
import type { View as NativeView } from "react-native";
import { STATUS_RING_PERIOD_MS, STATUS_RING_STEPS } from "@/components/status-ring/geometry";

const STATUS_RING_KEYFRAMES: PropertyIndexedKeyframes = {
  transform: ["rotate(0deg)", "rotate(360deg)"],
};
const STATUS_RING_TIMING: KeyframeAnimationOptions = {
  duration: STATUS_RING_PERIOD_MS,
  easing: `steps(${STATUS_RING_STEPS})`,
  iterations: Number.POSITIVE_INFINITY,
};
const STATUS_RING_TIMELINE_START_MS = 0;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function useStatusRingAnimationRef(): RefCallback<NativeView> {
  const arcElement = useRef<HTMLElement | null>(null);
  const setArcElement = useCallback((instance: NativeView | null) => {
    arcElement.current = instance instanceof HTMLElement ? instance : null;
  }, []);

  useLayoutEffect(() => {
    const element = arcElement.current;
    if (!element) {
      return;
    }

    // 实时读媒体查询，不用 Reanimated 的 useReducedMotion（只在启动时采样一次）：用户一打开
    // 减少动态效果，旋转环就该停。
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    let animation: Animation | null = null;
    const sync = () => {
      if (reducedMotion.matches) {
        animation?.cancel();
        animation = null;
        return;
      }
      if (animation) {
        return;
      }
      animation = element.animate(STATUS_RING_KEYFRAMES, STATUS_RING_TIMING);
      animation.startTime = STATUS_RING_TIMELINE_START_MS;
    };

    sync();
    reducedMotion.addEventListener("change", sync);
    return () => {
      reducedMotion.removeEventListener("change", sync);
      animation?.cancel();
    };
  }, []);

  return setArcElement;
}
