import { useEffect } from "react";

/**
 * 数 Tiptap 段落实际排出的行数：手机宽度下超过两行才给全屏按钮。可编辑区会被 flex 撑满输入框，
 * 所以量的是里面那个段落；编辑与宽度变化都会触发，同一帧只量一次。
 */
export function useComposerRenderedLines(
  element: HTMLElement | null,
  enabled: boolean,
  onLinesChange: (lines: number) => void,
): void {
  useEffect(() => {
    if (!element || !enabled) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const target = (element.firstElementChild as HTMLElement | null) ?? element;
      const lineHeight = parseFloat(window.getComputedStyle(target).lineHeight);
      if (!(lineHeight > 0)) return;
      onLinesChange(Math.max(1, Math.round(target.getBoundingClientRect().height / lineHeight)));
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(measure);
    };
    schedule();
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(element);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(element, { childList: true, subtree: true, characterData: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [element, enabled, onLinesChange]);
}
