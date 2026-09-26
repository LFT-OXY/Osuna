import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

// Reanimated 的 useReducedMotion 只在启动时采样一次；这里以它为初值，再订阅系统变化，
// 运行中打开减少动态效果时旋转环、扫光立即停下。
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
