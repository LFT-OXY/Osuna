import React, { createContext, useContext } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Extension, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Text } from "@/components/ui/text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  inlineBlockName,
  isInlineBlock,
  resolveInlineBlockVariant,
  serializeInlineBlock,
  type InlineBlock,
} from "@/inline-blocks";
import { InlineBlockView } from "@/inline-blocks/block-view";

export const INLINE_BLOCK_NODE = "inlineBlock";

/** 节点属性在 ProseMirror 里没有类型，块节点的 `block` 属性在这一处确认形状。 */
export function readInlineBlockNode(node: ProseMirrorNode): InlineBlock | null {
  if (node.type.name !== INLINE_BLOCK_NODE) return null;
  const block: unknown = node.attrs.block;
  return isInlineBlock(block) ? block : null;
}

/** 输入框所属的 host；Agent mention 的 profile 与自定义 provider 按它取图标。 */
export const InlineBlockServerIdContext = createContext<string | null>(null);

/** 悬停提示：File mention 显示相对路径，目录带末尾 `/`。 */
function resolveTooltipText(block: InlineBlock): string | null {
  if (block.kind !== "file") return null;
  return block.entryKind === "directory" ? `${block.path}/` : block.path;
}

function ComposerInlineBlockNodeView({ node }: ReactNodeViewProps) {
  const serverId = useContext(InlineBlockServerIdContext);
  const block = readInlineBlockNode(node);
  if (!block) return null;
  const tooltipText = resolveTooltipText(block);
  return (
    <NodeViewWrapper as="span" style={WRAPPER_STYLE}>
      {tooltipText ? (
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild>
            <View style={styles.envelope}>
              <InlineBlockView block={block} serverId={serverId} />
            </View>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" offset={8} testID="inline-block-tooltip">
            <Text variant="label">{tooltipText}</Text>
          </TooltipContent>
        </Tooltip>
      ) : (
        <InlineBlockView block={block} serverId={serverId} />
      )}
    </NodeViewWrapper>
  );
}

// 块跟正文同一行排版：行内 flex，底边对齐文字基线附近，名字过长时由块自己截断。
const WRAPPER_STYLE: React.CSSProperties = {
  display: "inline-flex",
  verticalAlign: "bottom",
  maxWidth: "100%",
  userSelect: "none",
};

/**
 * 行内块：inline、atom、不可选中为 NodeSelection，光标只停在块前后。块的全部数据存在 `block` 属性里，
 * 文字形式（发送、复制到外部）是 serializeInlineBlock 的链接写法。
 */
export const InlineBlockNode = Node.create({
  name: INLINE_BLOCK_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return { block: { default: null, rendered: false } };
  },
  renderHTML({ node }) {
    const block = readInlineBlockNode(node);
    if (!block) return ["span"];
    return [
      "span",
      { "data-inline-block": resolveInlineBlockVariant(block) },
      inlineBlockName(block),
    ];
  },
  renderText({ node }) {
    const block = readInlineBlockNode(node);
    return block ? serializeInlineBlock(block) : "";
  },
  addNodeView() {
    return ReactNodeViewRenderer(ComposerInlineBlockNodeView, { as: "span" });
  },
});

interface AdjacentBlock {
  from: number;
  to: number;
}

// 光标紧挨着块时，方向键整块跳过、退格 / Delete 整块删除。浏览器对 contenteditable=false 的
// 行内元素各有各的光标停靠点，这里不交给浏览器。
function findAdjacentBlock(view: EditorView, direction: -1 | 1): AdjacentBlock | null {
  const { selection } = view.state;
  if (view.composing || !selection.empty) return null;
  const $head = selection.$head;
  const node = direction < 0 ? $head.nodeBefore : $head.nodeAfter;
  if (!node || node.type.name !== INLINE_BLOCK_NODE) return null;
  const from = direction < 0 ? $head.pos - node.nodeSize : $head.pos;
  return { from, to: from + node.nodeSize };
}

function moveOverBlock(view: EditorView, direction: -1 | 1): boolean {
  const block = findAdjacentBlock(view, direction);
  if (!block) return false;
  const target = direction < 0 ? block.from : block.to;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)));
  return true;
}

function deleteBlock(view: EditorView, direction: -1 | 1): boolean {
  const block = findAdjacentBlock(view, direction);
  if (!block) return false;
  view.dispatch(view.state.tr.delete(block.from, block.to).scrollIntoView());
  return true;
}

export const InlineBlockKeys = Extension.create({
  name: "inlineBlockKeys",
  addKeyboardShortcuts() {
    return {
      ArrowLeft: () => moveOverBlock(this.editor.view, -1),
      ArrowRight: () => moveOverBlock(this.editor.view, 1),
      Backspace: () => deleteBlock(this.editor.view, -1),
      Delete: () => deleteBlock(this.editor.view, 1),
    };
  },
});

const styles = StyleSheet.create({
  envelope: {
    position: "relative",
    minWidth: 0,
  },
});
