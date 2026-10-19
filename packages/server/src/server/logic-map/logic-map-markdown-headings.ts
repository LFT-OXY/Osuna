const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_OR_QUOTE = /^ {0,3}(?:[-*+>]|\d+[.)])(?:\s|$)/;

/**
 * 标题的纯文字：去掉 ATX 的 `#`、行内代码的反引号和链接 / 图片语法，合并空白。
 * Agent 传来的标题和文件里的标题都按它比较，所以 Agent 照抄带标记的原文也能对上。
 */
export function normalizeHeading(heading: string): string {
  return heading
    .trim()
    .replace(/^#{1,6}(?:\s+|$)/, "")
    .replace(/\s+#+$/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]*?)`+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Markdown 文件里所有标题的纯文字（ATX 与 setext 两种写法），跳过代码块里的行。 */
export function markdownHeadings(markdown: string): string[] {
  const headings: string[] = [];
  let fence: string | null = null;
  let previous: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const fenceMarker = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (fenceMarker && fenceMarker[0] === fence[0] && fenceMarker.length >= fence.length) {
        fence = null;
      }
      previous = null;
      continue;
    }
    if (fenceMarker) {
      fence = fenceMarker;
      previous = null;
      continue;
    }
    const atx = ATX_HEADING.exec(line);
    if (atx) {
      headings.push(normalizeHeading(atx[1] ?? ""));
      previous = null;
      continue;
    }
    if (previous !== null && SETEXT_UNDERLINE.test(line)) {
      headings.push(normalizeHeading(previous));
      previous = null;
      continue;
    }
    // 只有普通段落行下面的 === / --- 才是 setext 标题；空行、列表、引用不算。
    previous = line.trim().length > 0 && !LIST_OR_QUOTE.test(line) ? line : null;
  }
  return headings;
}
