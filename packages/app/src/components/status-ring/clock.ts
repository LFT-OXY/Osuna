import { useEffect, useLayoutEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import {
  makeMutable,
  type SharedValue,
  useReducedMotion,
  useSharedValue,
} from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";
import { getStatusRingRotation } from "@/components/status-ring/geometry";

const sharedRotation = makeMutable(getStatusRingRotation(Date.now()));
const activeRingCount = makeMutable(0);
const clockRunning = makeMutable(false);

function advanceSharedRotation(): void {
  "worklet";
  if (activeRingCount.value === 0) {
    clockRunning.value = false;
    return;
  }

  sharedRotation.value = getStatusRingRotation(Date.now());
  requestAnimationFrame(advanceSharedRotation);
}

function registerStatusRing(registered: SharedValue<boolean>): void {
  "worklet";
  if (registered.value) {
    return;
  }

  registered.value = true;
  activeRingCount.value += 1;

  if (!clockRunning.value) {
    clockRunning.value = true;
    sharedRotation.value = getStatusRingRotation(Date.now());
    requestAnimationFrame(advanceSharedRotation);
  }
}

function unregisterStatusRing(registered: SharedValue<boolean>): void {
  "worklet";
  if (!registered.value) {
    return;
  }

  registered.value = false;
  activeRingCount.value -= 1;
}

// Reanimated 的 useReducedMotion 只在启动时采样一次；这里以它为初值，再订阅系统变化，
// 运行中打开减少动态效果时旋转环立即停下。
export function useReduceMotionEnabled(): boolean {
  const startupValue = useReducedMotion();
  const [enabled, setEnabled] = useState(startupValue);
  useEffect(() => {
    let cancelled = false;
    const readCurrent = async () => {
      const value = await AccessibilityInfo.isReduceMotionEnabled();
      if (!cancelled) setEnabled(value);
    };
    void readCurrent();
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setEnabled);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
  return enabled;
}

/** `enabled: false`（减少动态效果）时这个环完全不接入共享时钟。 */
export function useStatusRingRotation({ enabled }: { enabled: boolean }): SharedValue<number> {
  const registered = useSharedValue(false);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }
    scheduleOnUI(registerStatusRing, registered);
    return () => {
      scheduleOnUI(unregisterStatusRing, registered);
    };
  }, [enabled, registered]);

  return sharedRotation;
}
