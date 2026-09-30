// 最近的可滚动祖先；设置页正文和弹窗内容都是 overflow 容器。
function scrollContainerOf(element: HTMLElement): HTMLElement | null {
  for (let current = element.parentElement; current; current = current.parentElement) {
    const { overflowY } = getComputedStyle(current);
    const scrollable = overflowY === "auto" || overflowY === "scroll";
    if (scrollable && current.scrollHeight > current.clientHeight) return current;
  }
  return null;
}

const REVEAL_MARGIN = 16;

// 不用 scrollIntoView：它会连带滚动应用外层的 overflow 容器。
// 也不用 scrollTo：RN Web 的 ScrollView 在自己的 DOM 节点上换了一个签名不同的 scrollTo。
export function revealInScrollContainer(node: unknown): void {
  if (!(node instanceof HTMLElement)) return;
  const container = scrollContainerOf(node);
  if (!container) return;
  const offset = node.getBoundingClientRect().top - container.getBoundingClientRect().top;
  container.scrollTop += offset - REVEAL_MARGIN;
}
