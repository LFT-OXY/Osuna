import React, { createContext, useContext } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Extension, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
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

interface InlineBlockTooltip {
  title: string;
  titleWeight: "normal" | "medium";
  detail?: string;
}

/** 悬停提示：File mention 显示相对路径（目录带末尾 `/`），Skill block 显示全名与描述。 */
function resolveTooltip(block: InlineBlock): InlineBlockTooltip | null {
  switch (block.kind) {
    case "file":
      return {
        title: block.entryKind === "directory" ? `${block.path}/` : block.path,
        titleWeight: "normal",
      };
    case "skill":
      return block.description
        ? { title: block.name, titleWeight: "medium", detail: block.description }
        : { title: block.name, titleWeight: "medium" };
    case "agent":
      return null;
  }
}

function ComposerInlineBlockNodeView({ node }: ReactNodeViewProps) {
  const serverId = useContext(InlineBlockServerIdContext);
  const block = readInlineBlockNode(node);
  if (!block) return null;
  const tooltip = resolveTooltip(block);
  return (
    <NodeViewWrapper as="span" style={WRAPPER_STYLE}>
      {tooltip ? (
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild>
            <View style={styles.envelope}>
              <InlineBlockView block={block} serverId={serverId} />
            </View>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" offset={8} testID="inline-block-tooltip">
            <View style={styles.tooltipBody}>
              <Text variant="label" weight={tooltip.titleWeight}>
                {tooltip.title}
              </Text>
              {tooltip.detail ? (
                <Text variant="label" color="foregroundMuted">
                  {tooltip.detail}
                </Text>
              ) : null}
            </View>
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

function isSkillBlockNode(node: ProseMirrorNode | null | undefined): boolean {
  return Boolean(node && readInlineBlockNode(node)?.kind === "skill");
}

/** 开头连续 Skill block（块之间是一个空格）中最后一个块的结束位置；开头不是 Skill block 时为 null。 */
function leadingSkillBlocksEnd(doc: ProseMirrorNode): number | null {
  const paragraph = doc.firstChild;
  if (!paragraph) return null;
  let end: number | null = null;
  let pos = 1;
  for (let index = 0; index < paragraph.childCount; index += 1) {
    const child = paragraph.child(index);
    if (isSkillBlockNode(child)) {
      end = pos + child.nodeSize;
    } else if (!(child.text === " " && isSkillBlockNode(paragraph.maybeChild(index + 1)))) {
      break;
    }
    pos += child.nodeSize;
  }
  return end;
}

// Skill block 固定在开头：光标落到开头 Skill block 之前或之间（点击、Home、方向键）时移到最后一个
// 开头块后面，免得在 skill 前写出正文。只管空选区，全选删除照常。
export const LeadingSkillBlockCaret = Extension.create({
  name: "leadingSkillBlockCaret",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("leadingSkillBlockCaret"),
        appendTransaction: (_transactions, _oldState, state) => {
          const { selection } = state;
          if (!selection.empty) return null;
          const end = leadingSkillBlocksEnd(state.doc);
          if (end === null || selection.from >= end) return null;
          return state.tr.setSelection(TextSelection.create(state.doc, end));
        },
      }),
    ];
  },
});

const styles = StyleSheet.create((theme) => ({
  envelope: {
    position: "relative",
    minWidth: 0,
  },
  tooltipBody: {
    gap: theme.spacing[0.5],
  },
}));
