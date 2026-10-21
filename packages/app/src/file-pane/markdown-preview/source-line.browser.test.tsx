import React, { act, useMemo, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import { page } from "@vitest/browser/context";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMarkdownPreviewDocument } from "./document";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "./pipeline";
import { useScrollToSourceLine } from "./source-line.web";

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

beforeAll(async () => {
  await page.viewport(1280, 900);
});

interface PreviewProps {
  source: string;
  lineStart?: number;
  navigationRevision: number;
}

/**
 * 和 FileMarkdownPreview（index.web.tsx）一样拆出 front matter、用同一套插件渲染、接上滚动；
 * 不带代码块等自定义组件，它们引用的原生模块在 browser 项目里加载不了。
 */
function PreviewHarness({ source, lineStart, navigationRevision }: PreviewProps) {
  const document = useMemo(() => parseMarkdownPreviewDocument(source), [source]);
  const bodyRef = useRef<HTMLDivElement>(null);
  useScrollToSourceLine({
    bodyRef,
    lineStart,
    bodyStartLine: document.bodyStartLine,
    navigationRevision,
  });
  return (
    <div>
      {document.frontMatter.map((row) => (
        <p key={row.key}>{`${row.key}: ${row.value}`}</p>
      ))}
      <div ref={bodyRef}>
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
          {document.body}
        </ReactMarkdown>
      </div>
    </div>
  );
}

const FILLER = Array.from({ length: 40 }, (_, index) => `Paragraph ${index + 1}.\n`).join("\n");

/** 前面一大段正文，第 81 行起是"锁定账户"一节。 */
const SPEC = `${FILLER}\n## 锁定账户\n\n连续 5 次密码错误后锁定 30 分钟。\n\n${FILLER}`;
const LOCK_HEADING_LINE = 81;

interface Mounted {
  root: Root;
  scroller: HTMLElement;
}

const mounted: Mounted[] = [];

/** 把预览放进一个 300 高、自己滚动的容器里（和文件标签里的 ScrollView 一样）。 */
function mountPreview(props: PreviewProps): {
  scroller: HTMLElement;
  update: (next: PreviewProps) => void;
} {
  const scroller = document.createElement("div");
  scroller.style.cssText =
    "position: absolute; top: 0; left: 0; width: 640px; height: 300px; overflow-y: auto;";
  document.body.appendChild(scroller);
  const root = createRoot(scroller);
  const render = (next: PreviewProps) =>
    act(() =>
      root.render(
        <PreviewHarness
          source={next.source}
          lineStart={next.lineStart}
          navigationRevision={next.navigationRevision}
        />,
      ),
    );
  render(props);
  mounted.push({ root, scroller });
  return { scroller, update: render };
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.scroller.remove();
  }
});

function heading(scroller: HTMLElement, name: string): HTMLElement {
  const element = [...scroller.querySelectorAll("h2")].find((h) => h.textContent === name);
  if (!(element instanceof HTMLElement)) throw new Error(`no heading ${name}`);
  return element;
}

/** 标题离滚动容器顶边多远；贴着顶边（允许一点亚像素误差）就是"定位到了"。 */
function offsetFromTop(scroller: HTMLElement, element: HTMLElement): number {
  return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}

describe("the rendered Markdown preview", () => {
  it("scrolls to the block that holds the target line", async () => {
    const { scroller } = mountPreview({
      source: SPEC,
      lineStart: LOCK_HEADING_LINE,
      navigationRevision: 1,
    });

    await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0);
    const offset = offsetFromTop(scroller, heading(scroller, "锁定账户"));
    expect(offset).toBeGreaterThan(-1);
    expect(offset).toBeLessThan(40);
  });

  it("counts lines from the top of the file when front matter is shown as a table", async () => {
    const frontMatter = "---\ntitle: 登录\nowner: auth\n---\n";
    const { scroller } = mountPreview({
      source: `${frontMatter}${SPEC}`,
      lineStart: LOCK_HEADING_LINE + 4,
      navigationRevision: 1,
    });

    await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0);
    const offset = offsetFromTop(scroller, heading(scroller, "锁定账户"));
    expect(offset).toBeGreaterThan(-1);
    expect(offset).toBeLessThan(40);
  });

  it("ignores line marks the author wrote inside the document", async () => {
    // 正文里手写的 data-source-line（嵌套在别的块里）不能当成块的行号。
    const authored = '<div>\n<p data-source-line="999">手写的标记</p>\n</div>\n\n';
    const { scroller } = mountPreview({
      source: `${authored}${SPEC}`,
      lineStart: LOCK_HEADING_LINE + 4,
      navigationRevision: 1,
    });

    await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0);
    const offset = offsetFromTop(scroller, heading(scroller, "锁定账户"));
    expect(offset).toBeGreaterThan(-1);
    expect(offset).toBeLessThan(40);
  });

  it("stays at the top without a target line", async () => {
    const { scroller } = mountPreview({ source: SPEC, navigationRevision: 0 });

    await expect.poll(() => scroller.querySelector("h2")).not.toBeNull();
    expect(scroller.scrollTop).toBe(0);
  });

  it("does not jump back when the file changes, only when the line is opened again", async () => {
    const { scroller, update } = mountPreview({
      source: SPEC,
      lineStart: LOCK_HEADING_LINE,
      navigationRevision: 1,
    });
    await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0);

    scroller.scrollTop = 0;
    update({ source: `${SPEC}\nAppended.\n`, lineStart: LOCK_HEADING_LINE, navigationRevision: 1 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(scroller.scrollTop).toBe(0);

    update({ source: `${SPEC}\nAppended.\n`, lineStart: LOCK_HEADING_LINE, navigationRevision: 2 });
    await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0);
  });
});
