import type { JSONContent } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { isInlineSegment, serializeInlineBlock, type InlineSegment } from "@/inline-blocks";
import { INLINE_BLOCK_NODE, readInlineBlockNode } from "./inline-block-node.web";

/**
 * Composer 看到的文字就是发出去的文字：块按它的链接写法算长度，换行（hardBreak）占 1。
 * 编辑器里块只占一个位置，所以文字偏移与编辑器位置之间要按块的写法长度换算。
 * 文档固定为一个段落，段落内容从位置 1 开始。
 */

/** 段落里的一个子节点：文字、行内块或换行，以及它在编辑器与文字里各占的范围。 */
interface ParagraphChild {
  kind: "text" | "block" | "lineBreak";
  /** 编辑器位置 [from, to)。 */
  from: number;
  to: number;
  /** 文字偏移 [start, end)。 */
  start: number;
  end: number;
}

function childKind(node: ProseMirrorNode): ParagraphChild["kind"] {
  if (node.isText) return "text";
  return node.type.name === INLINE_BLOCK_NODE ? "block" : "lineBreak";
}

function nodeText(node: ProseMirrorNode): string {
  if (node.isText) return node.text ?? "";
  if (node.type.name === INLINE_BLOCK_NODE) {
    const block = readInlineBlockNode(node);
    return block ? serializeInlineBlock(block) : "";
  }
  return "\n";
}

function paragraphChildren(doc: ProseMirrorNode): ParagraphChild[] {
  const paragraph = doc.firstChild;
  if (!paragraph) return [];
  const children: ParagraphChild[] = [];
  let offset = 0;
  paragraph.forEach((child, childOffset) => {
    const from = 1 + childOffset;
    const length = nodeText(child).length;
    children.push({
      kind: childKind(child),
      from,
      to: from + child.nodeSize,
      start: offset,
      end: offset + length,
    });
    offset += length;
  });
  return children;
}

export function docText(doc: ProseMirrorNode): string {
  const paragraph = doc.firstChild;
  if (!paragraph) return "";
  let text = "";
  paragraph.forEach((child) => {
    text += nodeText(child);
  });
  return text;
}

export function offsetAtPos(doc: ProseMirrorNode, pos: number): number {
  const children = paragraphChildren(doc);
  for (const child of children) {
    if (pos <= child.from) return child.start;
    if (pos >= child.to) continue;
    // 文字按字符对应；块与换行只占一个位置，落在其中取它之后。
    if (child.kind !== "text") return child.end;
    return child.start + (pos - child.from);
  }
  return children[children.length - 1]?.end ?? 0;
}

/**
 * 文字偏移对应的编辑器位置。偏移落在块的写法中间时，`before` 取块前、`after` 取块后。
 */
export function posAtOffset(
  doc: ProseMirrorNode,
  offset: number,
  bias: "before" | "after",
): number {
  for (const child of paragraphChildren(doc)) {
    if (offset <= child.start) return child.from;
    if (offset < child.end) {
      if (child.kind === "text") return child.from + (offset - child.start);
      return bias === "before" ? child.from : child.to;
    }
  }
  return 1 + (doc.firstChild?.content.size ?? 0);
}

/** `pos` 之前最后一个块结束处的文字偏移，没有块时为 0。 */
export function blockBoundaryAt(doc: ProseMirrorNode, pos: number): number {
  let boundary = 0;
  for (const child of paragraphChildren(doc)) {
    if (child.to > pos) break;
    if (child.kind === "block") boundary = child.end;
  }
  return boundary;
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function textToInlineContent(text: string): JSONContent[] {
  const content: JSONContent[] = [];
  normalizeNewlines(text)
    .split("\n")
    .forEach((line, index) => {
      if (index > 0) content.push({ type: "hardBreak" });
      if (line.length > 0) content.push({ type: "text", text: line });
    });
  return content;
}

export function segmentsToInlineContent(segments: readonly InlineSegment[]): JSONContent[] {
  return segments.flatMap((segment) =>
    segment.type === "text"
      ? textToInlineContent(segment.text)
      : [{ type: INLINE_BLOCK_NODE, attrs: { block: segment.block } }],
  );
}

export function textToFragment(schema: Schema, text: string): Fragment {
  return Fragment.fromJSON(schema, textToInlineContent(text));
}

export function segmentsToFragment(schema: Schema, segments: readonly InlineSegment[]): Fragment {
  return Fragment.fromJSON(schema, segmentsToInlineContent(segments));
}

/** 一段编辑器内容（选区、剪贴板切片）的分段结构；相邻文字合并。 */
export function fragmentSegments(fragment: Fragment): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const pushText = (text: string) => {
    const last = segments[segments.length - 1];
    if (last?.type === "text") {
      last.text += text;
      return;
    }
    segments.push({ type: "text", text });
  };
  fragment.descendants((node) => {
    if (!node.isInline) return true;
    const block = readInlineBlockNode(node);
    if (block) segments.push({ type: "block", block });
    else pushText(nodeText(node));
    return false;
  });
  return segments;
}

/** 剪贴板里输入框自己写入的分段结构；不是合法结构时为 null，按纯文字粘贴。 */
export function parseClipboardSegments(raw: string): InlineSegment[] | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  return Array.isArray(value) && value.every(isInlineSegment) ? value : null;
}
