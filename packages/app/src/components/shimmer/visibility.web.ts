import { useCallback, useEffect, useRef, type RefCallback } from "react";
import type { View } from "react-native";
import { SHIMMER_PLAY_STATE_VAR } from "./animation-names";

interface ObservedShimmer {
  element: HTMLElement;
  intersecting: boolean;
}

const observed = new Map<Element, ObservedShimmer>();
let observer: IntersectionObserver | null = null;

function applyPlayState(entry: ObservedShimmer): void {
  const running = entry.intersecting && document.visibilityState === "visible";
  entry.element.style.setProperty(SHIMMER_PLAY_STATE_VAR, running ? "running" : "paused");
}

function applyAllPlayStates(): void {
  for (const entry of observed.values()) applyPlayState(entry);
}

function ensureObserver(): IntersectionObserver {
  if (observer) return observer;
  document.addEventListener("visibilitychange", applyAllPlayStates);
  const created = new IntersectionObserver((entries) => {
    for (const change of entries) {
      const entry = observed.get(change.target);
      if (!entry) continue;
      entry.intersecting = change.isIntersecting;
      applyPlayState(entry);
    }
  });
  observer = created;
  return created;
}

function observe(element: HTMLElement): () => void {
  // 同一元素重复登记时沿用已有状态：IntersectionObserver 对已观察的元素不会再回调，
  // 这里若重置为 paused，扫光就再也不会恢复。
  let entry = observed.get(element);
  if (!entry) {
    element.style.setProperty(SHIMMER_PLAY_STATE_VAR, "paused");
    entry = { element, intersecting: false };
    observed.set(element, entry);
    ensureObserver().observe(element);
  }
  const registered = entry;
  return () => {
    if (observed.get(element) !== registered) return;
    observed.delete(element);
    observer?.unobserve(element);
    if (observed.size === 0) {
      observer?.disconnect();
      observer = null;
      document.removeEventListener("visibilitychange", applyAllPlayStates);
    }
  };
}

interface ObservedHandle {
  element: HTMLElement;
  release: () => void;
}

/**
 * 挂在扫光容器上：滚出视口、所在面板隐藏或窗口切到后台时暂停扫光，回到可见再继续。
 * 所有扫光共用一个 IntersectionObserver。react-native-web 合并 ref 时会以 null / 元素反复调用
 * 回调，所以这里自己记住当前元素，只在元素变化或卸载时释放。
 */
export function useShimmerVisibilityRef(): RefCallback<View> | undefined {
  const handle = useRef<ObservedHandle | null>(null);
  useEffect(
    () => () => {
      handle.current?.release();
      handle.current = null;
    },
    [],
  );
  return useCallback((instance: View | null) => {
    const candidate: unknown = instance;
    const element = candidate instanceof HTMLElement ? candidate : null;
    if (handle.current?.element === element) return;
    handle.current?.release();
    handle.current = element ? { element, release: observe(element) } : null;
  }, []);
}
