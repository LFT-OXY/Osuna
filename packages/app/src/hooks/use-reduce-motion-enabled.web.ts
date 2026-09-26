import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function readServerReducedMotion(): boolean {
  return false;
}

/** 实时跟随系统的减少动态效果设置；Reanimated 的 useReducedMotion 只在启动时采样一次。 */
export function useReduceMotionEnabled(): boolean {
  return useSyncExternalStore(subscribe, readReducedMotion, readServerReducedMotion);
}
