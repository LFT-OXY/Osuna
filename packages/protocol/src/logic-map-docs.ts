// 逻辑图文档的规则，daemon（写入时校验指向的标题）和 app（打开时换算行号）共用，两边才对得上。

/** 逻辑图存放的目录（相对 workspace）：每张图一个子文件夹。 */
export const LOGIC_MAPS_DIRECTORY = "docs/logic-maps";

/** 自有节点文档相对 workspace 的路径；file 是相对图文件夹的文件名。 */
export function logicMapOwnDocPath(mapName: string, file: string): string {
  return `${LOGIC_MAPS_DIRECTORY}/${mapName}/${file}`;
}

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

export interface MarkdownHeadingLine {
  /** 标题的纯文字（normalizeHeading 之后）。 */
  text: string;
  /** 标题所在的行号，从 1 起；setext 标题是文字那一行。 */
  line: number;
}

/** Markdown 文件里所有标题（ATX 与 setext 两种写法）及其行号，跳过代码块里的行。 */
export function markdownHeadingLines(markdown: string): MarkdownHeadingLine[] {
  const headings: MarkdownHeadingLine[] = [];
  let fence: string | null = null;
  let previous: { text: string; line: number } | null = null;
  const lines = markdown.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
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
      headings.push({ text: normalizeHeading(atx[1] ?? ""), line: index + 1 });
      previous = null;
      continue;
    }
    if (previous !== null && SETEXT_UNDERLINE.test(line)) {
      headings.push({ text: normalizeHeading(previous.text), line: previous.line });
      previous = null;
      continue;
    }
    // 只有普通段落行下面的 === / --- 才是 setext 标题；空行、列表、引用不算。
    previous =
      line.trim().length > 0 && !LIST_OR_QUOTE.test(line) ? { text: line, line: index + 1 } : null;
  }
  return headings;
}

/** Markdown 文件里所有标题的纯文字。 */
export function markdownHeadings(markdown: string): string[] {
  return markdownHeadingLines(markdown).map((heading) => heading.text);
}

/**
 * 某个标题所在的行号（从 1 起），按 normalizeHeading 比较；标题重复时取第一个，找不到为 null。
 */
export function findMarkdownHeadingLine(markdown: string, heading: string): number | null {
  const target = normalizeHeading(heading);
  return markdownHeadingLines(markdown).find((entry) => entry.text === target)?.line ?? null;
}
