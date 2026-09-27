/*
 * 移植自 t3code `apps/web/src/markdown-github-alerts.ts`。
 *
 * MIT License
 *
 * Copyright (c) 2026 T3 Tools Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * GitHub 提示块：引用的第一行是 `[!NOTE]`（或 TIP / IMPORTANT / WARNING / CAUTION）时渲染为
 * 带标题的提示块。这是 GitHub 自己的扩展而非 GFM，remark-gfm 会把标记当普通文字留在引用里。
 * 本插件把标记从 mdast 上摘下来，写成 blockquote 的 `data-alert` 属性，并删掉标记行。
 *
 * 与 GitHub 规则一致，标记必须独占一行：`> [!NOTE] aside` 仍是普通引用。
 */

const GITHUB_ALERT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
export type GithubAlertKind = (typeof GITHUB_ALERT_KINDS)[number];
const GITHUB_ALERT_KIND_SET: ReadonlySet<unknown> = new Set(GITHUB_ALERT_KINDS);

export function isGithubAlertKind(value: unknown): value is GithubAlertKind {
  return GITHUB_ALERT_KIND_SET.has(value);
}

interface MarkdownAstNode {
  type?: string;
  value?: unknown;
  data?: {
    hProperties?: Record<string, unknown>;
  };
  children?: MarkdownAstNode[];
}

const GITHUB_ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\r?\n|$)/i;

interface LeadingText {
  paragraph: MarkdownAstNode;
  text: MarkdownAstNode;
  value: string;
}

function readLeadingText(blockquote: MarkdownAstNode): LeadingText | null {
  const paragraph = blockquote.children?.[0];
  const text = paragraph?.children?.[0];
  if (paragraph?.type !== "paragraph" || text?.type !== "text" || typeof text.value !== "string") {
    return null;
  }
  return { paragraph, text, value: text.value };
}

/** 去掉标记行；标记同一行还有别的内容时返回 false，表示这不是提示块。 */
function stripMarkerLine(
  blockquote: MarkdownAstNode,
  { paragraph, text, value }: LeadingText,
  marker: string,
): boolean {
  const remainder = value.slice(marker.length);
  if (remainder.length > 0) {
    // 下一行内容还在同一个文本节点里：保留段落，只去掉标记行。
    text.value = remainder;
    return true;
  }
  // 标记行是否在这个文本节点内结束。`[!NOTE]\n**bold**` 解析为 [text "[!NOTE]\n", strong]，
  // 而 `[!NOTE]*aside*` 只少一个换行，余下为空时只能靠它区分。
  if (!marker.endsWith("\n") && paragraph.children?.length !== 1) {
    // `[!NOTE]*aside*`：GitHub 不视为提示块。
    return false;
  }
  // 整个文本节点就是标记：删掉它，段落空了就连段落一起删。
  paragraph.children?.shift();
  if (paragraph.children?.length === 0) {
    blockquote.children?.shift();
  }
  return true;
}

function readGithubAlert(node: MarkdownAstNode): void {
  if (node.type !== "blockquote") return;
  const leading = readLeadingText(node);
  if (!leading) return;
  const match = GITHUB_ALERT_MARKER.exec(leading.value);
  if (!match?.[1] || !stripMarkerLine(node, leading, match[0])) return;

  node.data = {
    ...node.data,
    hProperties: {
      ...node.data?.hProperties,
      dataAlert: match[1].toLowerCase(),
    },
  };
}

export function remarkGithubAlerts() {
  return (tree: MarkdownAstNode) => {
    const visit = (node: MarkdownAstNode) => {
      node.children?.forEach(visit);
      readGithubAlert(node);
    };
    visit(tree);
  };
}
