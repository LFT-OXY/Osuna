/*
 * 版式移植自 t3code `apps/web/src/index.css` 的 `.chat-markdown`，颜色、字体、圆角改为项目主题 token。
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
import { lightHighlightColors } from "@getpaseo/highlight";
import { contentTypeStep, type TextVariant, type Theme } from "@/styles/theme";

export const MARKDOWN_PREVIEW_CLASS_NAME = "paseo-markdown-preview";

// 与原生端 front matter 表格的行高一致。
const FRONT_MATTER_LINE_HEIGHT = 20;
const STYLE_ID = "paseo-markdown-preview-styles";
const ROOT = `.${MARKDOWN_PREVIEW_CLASS_NAME}`;

function px(value: number): string {
  return `${value}px`;
}

function typeStepVariables(
  theme: Theme,
  name: string,
  variant: TextVariant,
): MarkdownPreviewThemeVariables {
  const step = contentTypeStep(theme.fontSize.content, variant);
  return {
    [`--md-${name}-size`]: px(step.fontSize),
    [`--md-${name}-line-height`]: px(step.lineHeight),
  };
}

export type MarkdownPreviewThemeVariables = Record<`--md-${string}`, string>;

const SYNTAX_ROLES = Object.keys(lightHighlightColors);

// 语法色取自 theme.colors.syntax，它已按用户选的语法主题与当前深浅色解析好。
function syntaxVariables(theme: Theme): MarkdownPreviewThemeVariables {
  const variables: MarkdownPreviewThemeVariables = {};
  for (const [role, color] of Object.entries(theme.colors.syntax)) {
    variables[`--md-syntax-${role}`] = color;
  }
  return variables;
}

const SYNTAX_RULES = SYNTAX_ROLES.map(
  (role) => `${ROOT} [data-syntax="${role}"] {\n  color: var(--md-syntax-${role});\n}`,
).join("\n\n");

/** 主题 token 以 CSS 自定义属性挂在预览根节点上，样式表只引用这些变量。 */
export function markdownPreviewThemeVariables(theme: Theme): MarkdownPreviewThemeVariables {
  return {
    "--md-foreground": theme.colors.foregroundProse,
    "--md-foreground-strong": theme.colors.foreground,
    "--md-muted": theme.colors.foregroundMuted,
    "--md-link": theme.colors.accentBright,
    "--md-border": theme.colors.border,
    "--md-code-border": theme.colors.borderCodeBlock,
    "--md-code-background": theme.colors.surface2,
    "--md-code-foreground": theme.colors.foreground,
    "--md-front-matter-key-background": theme.colors.surface2,
    "--md-interaction-highlight": theme.colors.interactionHighlight,
    // 提示块：note 取固定蓝色档（强调色随主题变，会与 caution 撞色或变成近白），
    // 其余四种取状态色族中语义对应的一员。
    "--md-alert-note":
      theme.colorScheme === "dark"
        ? theme.colors.palette.blue[400]
        : theme.colors.palette.blue[600],
    "--md-alert-tip": theme.colors.statusSuccess,
    "--md-alert-important": theme.colors.statusMerged,
    "--md-alert-warning": theme.colors.statusWarning,
    "--md-alert-caution": theme.colors.statusDanger,
    "--md-alert-title-weight": theme.fontWeight.medium,
    "--md-mono": theme.fontFamily.mono,
    "--md-code-size": px(theme.fontSize.code),
    "--md-front-matter-size": px(theme.fontSize.base),
    "--md-front-matter-line-height": px(FRONT_MATTER_LINE_HEIGHT),
    "--md-radius-inline-code": px(theme.radius.sm),
    "--md-radius-code": px(theme.radius.lg),
    "--md-radius-front-matter": px(theme.radius.md),
    "--md-front-matter-gap": px(theme.spacing[6]),
    "--md-front-matter-padding": `${px(theme.spacing[2])} ${px(theme.spacing[3])}`,
    ...typeStepVariables(theme, "body", "prose"),
    ...typeStepVariables(theme, "h1", "title-lg"),
    ...typeStepVariables(theme, "h2", "title"),
    ...typeStepVariables(theme, "h3", "title-sm"),
    ...typeStepVariables(theme, "h4", "body"),
    ...typeStepVariables(theme, "table", "caption"),
    ...typeStepVariables(theme, "code-label", "micro"),
    ...syntaxVariables(theme),
  };
}

const STYLESHEET = `
${ROOT} {
  width: 100%;
  min-width: 0;
  color: var(--md-foreground);
  font-size: var(--md-body-size);
  line-height: var(--md-body-line-height);
  overflow-wrap: anywhere;
  word-break: break-word;
  user-select: text;
  cursor: auto;
}

${ROOT} .md-body > :first-child {
  margin-top: 0;
}

${ROOT} .md-body > :last-child {
  margin-bottom: 0;
}

${ROOT} p,
${ROOT} ul,
${ROOT} ol,
${ROOT} dl,
${ROOT} blockquote,
${ROOT} pre,
${ROOT} details,
${ROOT} figure,
${ROOT} .md-table-scroll {
  margin: 0.65rem 0;
}

${ROOT} h1,
${ROOT} h2,
${ROOT} h3,
${ROOT} h4,
${ROOT} h5,
${ROOT} h6 {
  margin: 1.25rem 0 0.5rem;
  font-weight: 600;
  color: var(--md-foreground-strong);
}

${ROOT} h1 {
  font-size: var(--md-h1-size);
  line-height: var(--md-h1-line-height);
}

${ROOT} h2 {
  font-size: var(--md-h2-size);
  line-height: var(--md-h2-line-height);
}

${ROOT} h3 {
  font-size: var(--md-h3-size);
  line-height: var(--md-h3-line-height);
}

${ROOT} h4,
${ROOT} h5,
${ROOT} h6 {
  font-size: var(--md-h4-size);
  line-height: var(--md-h4-line-height);
}

${ROOT} h6 {
  color: var(--md-muted);
}

${ROOT} ul {
  --list-gutter: 1.25rem;
  padding-left: 1.25rem;
  list-style-type: disc;
}

${ROOT} ol {
  --list-gutter: 1.25rem;
  padding-left: var(--list-gutter, 1.25rem);
  list-style-type: decimal;
}

${ROOT} ol > li::marker {
  font-variant-numeric: tabular-nums;
}

${ROOT} ul ul {
  list-style-type: circle;
}

${ROOT} ul ul ul {
  list-style-type: square;
}

${ROOT} ol ol {
  list-style-type: lower-alpha;
}

${ROOT} ol ol ol {
  list-style-type: lower-roman;
}

${ROOT} li + li {
  margin-top: 0.25rem;
}

${ROOT} li.task-list-item {
  list-style-type: none;
}

${ROOT} li.task-list-item input[type="checkbox"] {
  margin: 0 0.35em 0.15em calc(-1 * var(--list-gutter, 1.25rem));
  vertical-align: middle;
}

/* 徽章横排的关键：图片保持行内，一排放不下时随文字换行。 */
${ROOT} img {
  display: inline-block;
  max-width: 100%;
  border-style: none;
}

${ROOT} a {
  color: var(--md-link);
  text-decoration: none;
  cursor: pointer;
}

${ROOT} a:hover,
${ROOT} a:focus-visible {
  background-image: radial-gradient(circle, currentcolor 0.75px, transparent 1px);
  background-position: left bottom;
  background-repeat: repeat-x;
  background-size: 4px 2px;
}

${ROOT} blockquote {
  border-left: 2px solid var(--md-border);
  padding-left: 0.8rem;
  margin-left: 0;
  margin-right: 0;
  color: var(--md-muted);
}

/* 提示块只给左边线与标题着色，正文保持普通文字颜色（与 GitHub 一致）。 */
${ROOT} .md-alert {
  margin: 0.25rem 0;
  border-left: 2px solid var(--md-alert-color);
  padding-left: 0.75rem;
}

${ROOT} .md-alert[data-alert="note"] {
  --md-alert-color: var(--md-alert-note);
}

${ROOT} .md-alert[data-alert="tip"] {
  --md-alert-color: var(--md-alert-tip);
}

${ROOT} .md-alert[data-alert="important"] {
  --md-alert-color: var(--md-alert-important);
}

${ROOT} .md-alert[data-alert="warning"] {
  --md-alert-color: var(--md-alert-warning);
}

${ROOT} .md-alert[data-alert="caution"] {
  --md-alert-color: var(--md-alert-caution);
}

${ROOT} .md-alert-title {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  color: var(--md-alert-color);
  font-weight: var(--md-alert-title-weight);
}

${ROOT} .md-alert-title > svg {
  flex-shrink: 0;
}

${ROOT} hr {
  margin: 1.25rem 0;
  border: 0;
  border-top: 1px solid var(--md-border);
}

${ROOT} a[data-footnote-ref],
${ROOT} a[data-footnote-backref] {
  display: inline-flex;
  min-width: 1rem;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  font-weight: 600;
}

${ROOT} section[data-footnotes] {
  margin-top: 1.25rem;
  border-top: 1px solid var(--md-border);
  padding-top: 0.75rem;
  color: var(--md-muted);
  font-size: var(--md-table-size);
  line-height: var(--md-table-line-height);
}

${ROOT} section[data-footnotes] ol {
  margin: 0;
}

${ROOT} section[data-footnotes] li + li {
  margin-top: 0.35rem;
}

${ROOT} code,
${ROOT} pre {
  font-family: var(--md-mono);
}

${ROOT} :not(pre) > code {
  border: 1px solid var(--md-border);
  border-radius: var(--md-radius-inline-code);
  background: var(--md-code-background);
  padding: 0.1rem 0.35rem;
  color: var(--md-code-foreground);
  font-size: var(--md-code-size);
}

${ROOT} pre {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--md-code-border);
  border-radius: var(--md-radius-code);
  background: var(--md-code-background);
  padding: 0.8rem 0.9rem;
  color: var(--md-code-foreground);
  font-size: var(--md-code-size);
  line-height: 1.6;
  white-space: pre;
  overflow-wrap: normal;
  word-break: normal;
}

${ROOT} pre code {
  border: none;
  background: transparent;
  padding: 0;
  font-size: inherit;
}

/* 代码块外框画在 .md-code-block 上，头部与代码同在框内；内部 pre 去掉自己的框。 */
${ROOT} .md-code-block {
  margin: 0.65rem 0;
  overflow: hidden;
  border: 1px solid var(--md-code-border);
  border-radius: var(--md-radius-code);
  background: var(--md-code-background);
}

${ROOT} .md-code-block-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.375rem 0 0.9rem;
  color: var(--md-muted);
  user-select: none;
}

${ROOT} .md-code-block-language {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  font-family: var(--md-mono);
  font-size: var(--md-code-label-size);
  line-height: var(--md-code-label-line-height);
}

${ROOT} .md-code-block-language > svg {
  flex-shrink: 0;
}

${ROOT} .md-code-block-language-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

${ROOT} .md-code-block-actions {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  margin-left: auto;
}

${ROOT} .md-code-block-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: var(--md-radius-inline-code);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

${ROOT} .md-code-block-button:hover,
${ROOT} .md-code-block-button:focus-visible,
${ROOT} .md-code-block-button[aria-pressed="true"] {
  background: var(--md-interaction-highlight);
  color: var(--md-foreground-strong);
}

${ROOT} .md-code-block pre {
  margin: 0;
  border: none;
  border-radius: 0;
  background: transparent;
}

${ROOT} .md-code-block[data-wrap="true"] pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

${SYNTAX_RULES}

${ROOT} .md-table-scroll {
  max-width: 100%;
  overflow-x: auto;
}

/* 根节点的 overflow-wrap: anywhere 会把列挤成单字宽，表格内恢复按词换行。
   t3code 另有 min-width: max-content 配合单元格截断；预览不截断，改为按词换行，放不下再横向滚动。 */
${ROOT} table {
  width: 100%;
  border-collapse: collapse;
  overflow-wrap: normal;
  word-break: normal;
  font-size: var(--md-table-size);
  line-height: var(--md-table-line-height);
}

${ROOT} th,
${ROOT} td {
  padding: 0.45rem 0.75rem;
}

/* 只给未指定 align 的单元格设左对齐：作者样式会盖过 GFM 列对齐生成的 align 属性。 */
${ROOT} th:not([align]),
${ROOT} td:not([align]) {
  text-align: left;
}

${ROOT} thead th {
  border-bottom: 1px solid var(--md-border);
  padding-block: 0.55rem;
  font-weight: 600;
  white-space: nowrap;
}

${ROOT} tbody td {
  border-bottom: 1px solid var(--md-border);
}

${ROOT} .md-front-matter {
  margin-bottom: var(--md-front-matter-gap);
  border: 1px solid var(--md-border);
  border-radius: var(--md-radius-front-matter);
  overflow: hidden;
  font-size: var(--md-front-matter-size);
  line-height: var(--md-front-matter-line-height);
}

${ROOT} .md-front-matter-row {
  display: flex;
  align-items: stretch;
}

${ROOT} .md-front-matter-row + .md-front-matter-row {
  border-top: 1px solid var(--md-border);
}

${ROOT} .md-front-matter-key {
  flex: 0 1 30%;
  max-width: 180px;
  padding: var(--md-front-matter-padding);
  background: var(--md-front-matter-key-background);
  color: var(--md-muted);
  font-family: var(--md-mono);
}

${ROOT} .md-front-matter-value {
  flex: 1 1 0;
  min-width: 0;
  padding: var(--md-front-matter-padding);
  color: var(--md-foreground-strong);
  white-space: pre-wrap;
}
`;

export function installMarkdownPreviewStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLESHEET;
  document.head.append(style);
}
