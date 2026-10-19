import { useLayoutEffect, useRef, type RefObject } from "react";
import { SOURCE_LINE_ATTRIBUTE } from "./pipeline";

/** 往上找第一个自己滚动的祖先（文件标签里包着预览的 ScrollView）。 */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return null;
}

/**
 * 起始行不超过 bodyLine 的最后一个顶层块，也就是包含这一行的那块。只看正文的直接子元素：
 * 作者在 HTML 里手写的 data-source-line 会留在嵌套元素上（消毒规则放行了这个属性）。
 */
function blockAtLine(body: HTMLElement, bodyLine: number): HTMLElement | null {
  let found: HTMLElement | null = null;
  for (const block of body.querySelectorAll<HTMLElement>(`:scope > [${SOURCE_LINE_ATTRIBUTE}]`)) {
    const line = Number(block.getAttribute(SOURCE_LINE_ATTRIBUTE));
    if (line > bodyLine) break;
    found = block;
  }
  return found;
}

/**
 * 渲染出来的 Markdown 预览滚到原文件第 lineStart 行所在的块。每次打开（lineStart 或 navigationRevision
 * 变了）只滚一次，文件内容随后更新时不再把用户拉回去。
 */
export function useScrollToSourceLine(input: {
  /** 渲染出的正文容器：它的直接子元素就是一个个顶层块。 */
  bodyRef: RefObject<HTMLElement | null>;
  lineStart: number | undefined;
  /** 正文第一行在原文件里的行号；front matter 不在正文里。 */
  bodyStartLine: number;
  navigationRevision: number;
}) {
  const { bodyRef, lineStart, bodyStartLine, navigationRevision } = input;
  const scrolledRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || lineStart === undefined) return;
    const request = `${lineStart}:${navigationRevision}`;
    if (scrolledRef.current === request) return;
    scrolledRef.current = request;
    const block = blockAtLine(body, lineStart - bodyStartLine + 1);
    const scroller = scrollParent(body);
    if (!scroller) return;
    // 目标行在 front matter 里（或在第一块之前）就停在顶部，front matter 表格就在那里。
    const top = block
      ? block.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop
      : 0;
    scroller.scrollTop = top;
  });
}
