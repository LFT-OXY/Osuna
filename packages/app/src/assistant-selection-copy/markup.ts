export const MARKDOWN_COPY_TAG_ATTRIBUTE = "data-osuna-markdown-tag";
export const MARKDOWN_COPY_IGNORE_ATTRIBUTE = "data-osuna-markdown-ignore";
export const MARKDOWN_COPY_LIST_MARKER_ATTRIBUTE = "data-osuna-markdown-list-marker";
export const MARKDOWN_COPY_UNWRAP_ATTRIBUTE = "data-osuna-markdown-unwrap";
export const MARKDOWN_COPY_LIST_START_ATTRIBUTE = "data-osuna-markdown-list-start";
export const MARKDOWN_COPY_LANGUAGE_ATTRIBUTE = "data-osuna-markdown-language";
export const MARKDOWN_COPY_ALIGN_ATTRIBUTE = "data-osuna-markdown-align";

/**
 * Trailing line breaks, with any indentation that followed the last one.
 *
 * Both ways of copying code strip these, for the same reason: pasting a trailing
 * newline into a terminal runs the last line. A fence body always ends in one, and
 * ends in several when the author left blank lines before the closing fence; a
 * selection picks one up whenever it overshoots the end of a rendered line.
 */
export const TRAILING_CODE_LINE_BREAKS = /(\r?\n[ \t]*)+$/;

export const markdownCopyDataSet = {
  blockquote: { osunaMarkdownTag: "blockquote" },
  br: { osunaMarkdownTag: "br" },
  code: { osunaMarkdownTag: "code" },
  h1: { osunaMarkdownTag: "h1" },
  h2: { osunaMarkdownTag: "h2" },
  h3: { osunaMarkdownTag: "h3" },
  h4: { osunaMarkdownTag: "h4" },
  h5: { osunaMarkdownTag: "h5" },
  h6: { osunaMarkdownTag: "h6" },
  hr: { osunaMarkdownTag: "hr" },
  ignore: { osunaMarkdownIgnore: "true" },
  li: { osunaMarkdownTag: "li" },
  listMarker: { osunaMarkdownIgnore: "true", osunaMarkdownListMarker: "true" },
  ol: { osunaMarkdownTag: "ol" },
  p: { osunaMarkdownTag: "p" },
  pre: { osunaMarkdownTag: "pre" },
  s: { osunaMarkdownTag: "s" },
  strong: { osunaMarkdownTag: "strong" },
  em: { osunaMarkdownTag: "em" },
  table: { osunaMarkdownTag: "table" },
  tbody: { osunaMarkdownTag: "tbody" },
  td: { osunaMarkdownTag: "td" },
  th: { osunaMarkdownTag: "th" },
  thead: { osunaMarkdownTag: "thead" },
  tr: { osunaMarkdownTag: "tr" },
  ul: { osunaMarkdownTag: "ul" },
  unwrap: { osunaMarkdownUnwrap: "true" },
} as const;

export type MarkdownCopyInlineTag = "br" | "code" | "em" | "s" | "strong";

export function markdownCopyOrderedListDataSet(start: unknown) {
  return {
    ...markdownCopyDataSet.ol,
    osunaMarkdownListStart: String(start ?? 1),
  } as const;
}

export function markdownCopyCodeBlockDataSet(language: string | null | undefined) {
  const fenceLanguage = language?.trim().split(/\s+/)[0];
  return {
    ...markdownCopyDataSet.pre,
    ...(fenceLanguage ? { osunaMarkdownLanguage: fenceLanguage } : {}),
  } as const;
}

export function markdownCopyTableCellDataSet(tag: "td" | "th", style: unknown) {
  const alignment =
    typeof style === "string"
      ? style.match(/(?:^|;)\s*text-align\s*:\s*(left|right|center)/i)?.[1]
      : null;
  return {
    ...markdownCopyDataSet[tag],
    ...(alignment ? { osunaMarkdownAlign: alignment.toLowerCase() } : {}),
  } as const;
}
