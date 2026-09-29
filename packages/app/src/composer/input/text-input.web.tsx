import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  NativeSyntheticEvent,
  TextInputFocusEventData,
  TextInputKeyPressEventData,
} from "react-native";
import { Extension } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { HardBreak } from "@tiptap/extension-hard-break";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";
import { EditorContent, useEditor, type Editor, type UseEditorOptions } from "@tiptap/react";
import { Fragment } from "@tiptap/pm/model";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  addLeadingSkillBlocks,
  extractSkillBlocks,
  inlineSegmentsText,
  needsSpaceAfterInlineBlock,
  pickSkillBlock,
  serializeInlineSegments,
  type InlineBlock,
  type InlineSegment,
  type SkillBlock,
} from "@/inline-blocks";
import {
  blockBoundaryAt,
  docText,
  fragmentSegments,
  normalizeNewlines,
  offsetAtPos,
  parseClipboardSegments,
  posAtOffset,
  segmentsToFragment,
  segmentsToInlineContent,
  textToFragment,
} from "./editor-text.web";
import {
  INLINE_BLOCK_NODE,
  InlineBlockKeys,
  InlineBlockNode,
  InlineBlockServerIdContext,
  LeadingSkillBlockCaret,
} from "./inline-block-node.web";
import type {
  ComposerLiveSelection,
  ComposerSelectionChangeEventData,
  ComposerTextInputHandle,
  ComposerTextInputProps,
  ComposerTextSelection,
} from "./text-input.types";

/**
 * Composer 的 Web / Electron 文字输入：Tiptap 编辑器，对外沿用共享文本输入的 handle 与回调。
 *
 * 文档固定为一个段落，换行是 hardBreak，选中的文件等是行内块节点。对外的文字是发出去的文字
 * （块按链接写法），偏移与编辑器位置的换算见 editor-text.web.ts。
 *
 * 样式来自 Composer 的 `withUnistyles`：它把 `style` 编译成 `.hash > *` 规则，落到这里的根 div 上，
 * 字体、颜色、行高再继承给可编辑区。`style` prop 本身在 Web 上已被清空，这里不读。
 */

const SingleParagraphDocument = Document.extend({ content: "paragraph" });

// 自带的 Mod-Enter 不要：textarea 上 Cmd/Ctrl+Enter 不换行，由 Composer 决定排队或发送。
const ComposerHardBreak = HardBreak.extend({
  addKeyboardShortcuts() {
    return {};
  },
});

// Composer 没拦下的 Enter / Shift+Enter 都是换行，与 textarea 一致；段落不可拆分。
const ComposerNewline = Extension.create({
  name: "composerNewline",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.setHardBreak(),
      "Shift-Enter": () => this.editor.commands.setHardBreak(),
    };
  },
});

const EXTENSIONS = [
  SingleParagraphDocument,
  // 浏览器给 <p> 默认上下 1em 外边距，会让文字比 placeholder 低一截、输入框多高两截。
  Paragraph.configure({ HTMLAttributes: { style: "margin: 0" } }),
  Text,
  ComposerHardBreak,
  ComposerNewline,
  InlineBlockNode,
  InlineBlockKeys,
  LeadingSkillBlockCaret,
  UndoRedo,
];

// 输入框内部复制时连同块的结构一起写进剪贴板；外部只看得到 text/plain 的序列化文字。
const INLINE_SEGMENTS_MIME = "application/x-paseo-inline-segments";

function clampOffset(offset: number, length: number): number {
  return Math.max(0, Math.min(length, offset));
}

function readSelection(state: EditorState): ComposerLiveSelection {
  const { from, to } = state.selection;
  return {
    start: offsetAtPos(state.doc, from),
    end: offsetAtPos(state.doc, to),
    blockBoundary: blockBoundaryAt(state.doc, from),
  };
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let length = 0;
  while (length < limit && a[length] === b[length]) length += 1;
  return length;
}

function commonSuffixLength(a: string, b: string, limit: number): number {
  let length = 0;
  while (length < limit && a[a.length - 1 - length] === b[b.length - 1 - length]) length += 1;
  return length;
}

function setTextSelection(
  tr: EditorState["tr"],
  selection: ComposerTextSelection,
  length: number,
): void {
  const anchor = posAtOffset(tr.doc, clampOffset(selection.start, length), "after");
  const head = posAtOffset(tr.doc, clampOffset(selection.end, length), "after");
  tr.setSelection(TextSelection.create(tr.doc, anchor, head));
}

/**
 * Composer 以整段文字替换内容（补全命令、语音、清空、草稿恢复）。只替换与当前文字不同的那一段，
 * 前后没变的块原样保留；变化范围碰到的块整块换成新文字。
 */
function replaceDocumentText(
  editor: Editor,
  text: string,
  selection: ComposerTextSelection | undefined,
): void {
  const { state } = editor;
  const paragraph = state.doc.firstChild;
  if (!paragraph) return;
  const current = docText(state.doc);
  const prefix = commonPrefixLength(current, text);
  const suffixLimit = Math.min(current.length, text.length) - prefix;
  const suffix = commonSuffixLength(current, text, suffixLimit);
  const from = posAtOffset(state.doc, prefix, "before");
  const to = posAtOffset(state.doc, current.length - suffix, "after");
  const keptStart = offsetAtPos(state.doc, from);
  const keptEnd = current.length - offsetAtPos(state.doc, to);
  const tr = state.tr.replaceWith(
    from,
    to,
    textToFragment(state.schema, text.slice(keptStart, text.length - keptEnd)),
  );
  setTextSelection(tr, selection ?? { start: text.length, end: text.length }, text.length);
  // 与 textarea 赋值一致：程序替换不进撤销栈。
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

/** 草稿、排队项、Rewind 写回：整体换成分段结构，块仍是块。与 replaceDocumentText 一样不进撤销栈。 */
function replaceDocumentSegments(
  editor: Editor,
  segments: readonly InlineSegment[],
  selection: ComposerTextSelection | undefined,
): void {
  const { state } = editor;
  const paragraph = state.doc.firstChild;
  if (!paragraph) return;
  const tr = state.tr.replaceWith(
    1,
    1 + paragraph.content.size,
    segmentsToFragment(state.schema, segments),
  );
  const length = docText(tr.doc).length;
  setTextSelection(tr, selection ?? { start: length, end: length }, length);
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

/**
 * 把 range 换成块，块后跟一个空格（range 后面已是空格时沿用），光标停在空格后。
 * 这是用户的一次选择，进撤销栈：撤销回到原来的 `@query`。
 */
function insertInlineBlock(editor: Editor, block: InlineBlock, range: ComposerTextSelection): void {
  const { state } = editor;
  const from = posAtOffset(state.doc, range.start, "before");
  const to = posAtOffset(state.doc, range.end, "after");
  const textAfter = docText(state.doc).slice(range.end);
  const nodes = [state.schema.nodes[INLINE_BLOCK_NODE].create({ block })];
  if (needsSpaceAfterInlineBlock(textAfter)) nodes.push(state.schema.text(" "));
  const content = Fragment.from(nodes);
  const tr = state.tr.replaceWith(from, to, content);
  // 块占 1 个位置，空格占 1 个位置。
  tr.setSelection(TextSelection.create(tr.doc, from + 2));
  editor.view.dispatch(tr.scrollIntoView());
}

/**
 * 选中 skill：块追加到开头块串末尾，`/query` 从原处去掉，光标回到原处。这是用户的一次选择，
 * 进撤销栈：撤销回到原来的 `/query`。
 */
function applySkillPick(
  editor: Editor,
  block: SkillBlock,
  command: ComposerTextSelection | null,
): void {
  const { state } = editor;
  const paragraph = state.doc.firstChild;
  if (!paragraph) return;
  const picked = pickSkillBlock({ segments: fragmentSegments(paragraph.content), command, block });
  const tr = state.tr.replaceWith(
    1,
    1 + paragraph.content.size,
    segmentsToFragment(state.schema, picked.segments),
  );
  const length = docText(tr.doc).length;
  setTextSelection(tr, { start: picked.cursor, end: picked.cursor }, length);
  editor.view.dispatch(tr.scrollIntoView());
}

// beforeinput 与 paste 早于 ProseMirror 从 DOM 同步选区（selectionchange 是异步的）：方向键刚移动光标、
// Playwright fill 刚设好选区时，编辑器的选区还是旧的。替换范围以 DOM 选区为准。
interface EditorRange {
  from: number;
  to: number;
}

function liveSelectionRange(view: EditorView): EditorRange {
  const selection = view.dom.ownerDocument.getSelection();
  const anchorNode = selection?.anchorNode;
  const focusNode = selection?.focusNode;
  if (!selection || !anchorNode || !focusNode) return view.state.selection;
  if (!view.dom.contains(anchorNode) || !view.dom.contains(focusNode)) return view.state.selection;
  const anchor = view.posAtDOM(anchorNode, selection.anchorOffset);
  const head = view.posAtDOM(focusNode, selection.focusOffset);
  return { from: Math.min(anchor, head), to: Math.max(anchor, head) };
}

function insertionRange(view: EditorView): EditorRange {
  const { from, to } = liveSelectionRange(view);
  // 全选（AllSelection）覆盖段落本身，替换只在段落内容里进行。
  return { from: Math.max(1, from), to: Math.min(view.state.doc.content.size - 1, to) };
}

function insertSegments(view: EditorView, segments: readonly InlineSegment[]): void {
  const { from, to } = insertionRange(view);
  const fragment = segmentsToFragment(view.state.schema, segments);
  const tr = view.state.tr.replaceWith(from, to, fragment);
  tr.setSelection(TextSelection.create(tr.doc, from + fragment.size));
  view.dispatch(tr.scrollIntoView());
}

/** 输入框内部粘贴：Skill block 只能在开头，粘贴进来的移到开头块串末尾，其余照原位插入。 */
function pasteSegments(view: EditorView, segments: readonly InlineSegment[]): void {
  const { blocks, rest } = extractSkillBlocks(segments);
  if (blocks.length === 0) {
    insertSegments(view, segments);
    return;
  }
  const { from, to } = insertionRange(view);
  const fragment = segmentsToFragment(view.state.schema, rest);
  const tr = view.state.tr.replaceWith(from, to, fragment);
  const paragraph = tr.doc.firstChild;
  if (!paragraph) return;
  const moved = addLeadingSkillBlocks({
    segments: fragmentSegments(paragraph.content),
    blocks,
    cursor: offsetAtPos(tr.doc, from + fragment.size),
  });
  tr.replaceWith(
    1,
    1 + paragraph.content.size,
    segmentsToFragment(tr.doc.type.schema, moved.segments),
  );
  setTextSelection(tr, { start: moved.cursor, end: moved.cursor }, docText(tr.doc).length);
  view.dispatch(tr.scrollIntoView());
}

function insertPlainText(view: EditorView, text: string): void {
  insertSegments(view, [{ type: "text", text }]);
}

/**
 * 选区含块时接管复制与剪切：text/plain 是序列化文字，另写一份分段结构，粘贴回输入框时块仍是块。
 * 粘贴只读 text/plain（外部内容不转块），所以编辑器默认写的 HTML 用不上。不含块时照旧交给编辑器。
 */
function writeSelectionToClipboard(view: EditorView, event: ClipboardEvent): boolean {
  const { selection } = view.state;
  if (selection.empty || !event.clipboardData) return false;
  const segments = fragmentSegments(selection.content().content);
  if (!segments.some((segment) => segment.type === "block")) return false;
  event.clipboardData.clearData();
  event.clipboardData.setData("text/plain", serializeInlineSegments(segments));
  event.clipboardData.setData(INLINE_SEGMENTS_MIME, JSON.stringify(segments));
  event.preventDefault();
  return true;
}

/** 分段结构与文字对不上（文字在别处改过）时以文字为准。 */
function resolveInitialSegments(
  text: string,
  segments: readonly InlineSegment[] | undefined,
): readonly InlineSegment[] {
  if (segments && inlineSegmentsText(segments) === text) return segments;
  return [{ type: "text", text }];
}

// 回调契约沿用 RN TextInput 的事件形状。Composer 只读 nativeEvent 上的 key / 修饰键 /
// isComposing / keyCode / selection 与 preventDefault，其余字段 Web 上没有对应物，
// 所以只在这一处把 DOM 事件桥成 RN 事件类型。
function toSyntheticEvent<T>(
  nativeEvent: Partial<T> | Event,
  domEvent?: Event,
): NativeSyntheticEvent<T> {
  return {
    nativeEvent,
    preventDefault: () => domEvent?.preventDefault(),
  } as unknown as NativeSyntheticEvent<T>;
}

function toDataAttributes(dataSet: ComposerTextInputProps["dataSet"]): Record<string, string> {
  if (!dataSet) return {};
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(dataSet)) {
    const name = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    attributes[`data-${name}`] = value;
  }
  return attributes;
}

const ROOT_STYLE: React.CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  overflowY: "auto",
  overflowX: "hidden",
};
const CONTENT_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flexGrow: 1,
};
const PLACEHOLDER_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  pointerEvents: "none",
  whiteSpace: "pre-wrap",
  overflow: "hidden",
};

export const ComposerTextInput = forwardRef<ComposerTextInputHandle, ComposerTextInputProps>(
  function ComposerTextInputWeb(props, ref) {
    const {
      initialValue = "",
      onChangeText,
      onKeyPress,
      onSelectionChange,
      onFocus,
      onBlur,
      placeholder,
      placeholderTextColor,
      accessibilityLabel,
      editable = true,
      dataSet,
      initialSegments,
      inlineBlockServerId = null,
    } = props;

    const callbacksRef = useRef({ onChangeText, onKeyPress, onSelectionChange, onFocus, onBlur });
    callbacksRef.current = { onChangeText, onKeyPress, onSelectionChange, onFocus, onBlur };
    const accessibilityLabelRef = useRef(accessibilityLabel);
    accessibilityLabelRef.current = accessibilityLabel;
    const editableRef = useRef(editable);
    editableRef.current = editable;

    const initialTextRef = useRef(normalizeNewlines(initialValue));
    const initialSegmentsRef = useRef(
      resolveInitialSegments(initialTextRef.current, initialSegments),
    );
    const publishedTextRef = useRef(initialTextRef.current);
    const publishedSelectionRef = useRef<ComposerLiveSelection | null>(null);
    const [isEmpty, setIsEmpty] = useState(initialTextRef.current.length === 0);

    const syncEmpty = useCallback((text: string) => setIsEmpty(text.length === 0), []);

    // 组字期间只更新 placeholder，不上报：候选字交给输入法，Composer 的补全与草稿等组字结束再看文字。
    const publish = useCallback(
      (view: EditorView) => {
        const text = docText(view.state.doc);
        syncEmpty(text);
        if (view.composing) return;
        if (text !== publishedTextRef.current) {
          publishedTextRef.current = text;
          callbacksRef.current.onChangeText?.(text);
        }
        const selection = readSelection(view.state);
        const previous = publishedSelectionRef.current;
        const selectionUnchanged =
          previous !== null &&
          previous.start === selection.start &&
          previous.end === selection.end &&
          previous.blockBoundary === selection.blockBoundary;
        if (selectionUnchanged) return;
        publishedSelectionRef.current = selection;
        callbacksRef.current.onSelectionChange?.(
          toSyntheticEvent<ComposerSelectionChangeEventData>({
            selection: { start: selection.start, end: selection.end },
            blockBoundary: selection.blockBoundary,
          }),
        );
      },
      [syncEmpty],
    );

    // ProseMirror 在自己的 compositionend 里才清掉 composing，之后再上报最终文字。
    const publishAfterComposition = useCallback(
      (view: EditorView) => {
        setTimeout(() => {
          if (!view.isDestroyed) publish(view);
        }, 0);
      },
      [publish],
    );

    // 选项只在创建时用；useEditor 每次渲染比较选项，保持同一对象免得每次重设。
    const editorOptions = useMemo<UseEditorOptions>(
      () => ({
        extensions: EXTENSIONS,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: segmentsToInlineContent(initialSegmentsRef.current),
            },
          ],
        },
        editable: editableRef.current,
        autofocus: false,
        // 恢复的草稿光标在末尾，与 textarea 一致。挂载是同步的，早于 Composer 的 effect 改文字；
        // `onCreate` 延后一拍，会盖掉那之前设好的选区。
        onMount: ({ editor: mounted }) => {
          const end = mounted.state.doc.content.size - 1;
          mounted.view.dispatch(
            mounted.state.tr
              .setSelection(TextSelection.create(mounted.state.doc, end))
              .setMeta("addToHistory", false),
          );
        },
        onUpdate: ({ editor: updated }) => publish(updated.view),
        onSelectionUpdate: ({ editor: updated }) => publish(updated.view),
        onFocus: ({ event }) =>
          callbacksRef.current.onFocus?.(toSyntheticEvent<TextInputFocusEventData>(event, event)),
        onBlur: ({ event }) =>
          callbacksRef.current.onBlur?.(toSyntheticEvent<TextInputFocusEventData>(event, event)),
        editorProps: {
          attributes: () => ({
            role: "textbox",
            "aria-multiline": "true",
            "aria-label": accessibilityLabelRef.current ?? "",
            "aria-readonly": editableRef.current ? "false" : "true",
            autocapitalize: "sentences",
            style: "outline: none; flex-grow: 1;",
          }),
          handleKeyDown: (_view, event) => {
            callbacksRef.current.onKeyPress?.(
              toSyntheticEvent<TextInputKeyPressEventData>(event, event),
            );
            return event.defaultPrevented;
          },
          handleDOMEvents: {
            // 一次插入的多行文字（Playwright fill、系统文本替换）交给浏览器会把换行折成空格。
            beforeinput: (view, event) => {
              const data = event.data ?? "";
              const insertsMultilineText =
                !view.composing && event.inputType === "insertText" && /[\r\n]/.test(data);
              if (!insertsMultilineText) return false;
              event.preventDefault();
              insertPlainText(view, data);
              return true;
            },
            compositionend: (view) => {
              publishAfterComposition(view);
              return false;
            },
            copy: (view, event) => writeSelectionToClipboard(view, event),
            cut: (view, event) => {
              if (!writeSelectionToClipboard(view, event)) return false;
              if (view.editable) view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
              return true;
            },
          },
          // 外部粘贴只取纯文字，链接写法不转成块；输入框自己复制的内容带分段结构，块仍是块。
          // Composer 在捕获阶段先收走图片（进 Attachment tray）并 preventDefault；它不收
          // （断连、禁用等）时照常插入剪贴板里的文字。
          handlePaste: (view, event) => {
            if (event.defaultPrevented) return true;
            const segments = parseClipboardSegments(
              event.clipboardData?.getData(INLINE_SEGMENTS_MIME) ?? "",
            );
            if (segments) {
              pasteSegments(view, segments);
              return true;
            }
            const text = event.clipboardData?.getData("text/plain") ?? "";
            if (text) insertPlainText(view, text);
            return true;
          },
          // 拖进来的内容交给外层的 file drop（Attachment tray），不插入编辑器；textarea 时也是如此。
          handleDrop: () => true,
        },
      }),
      [publish, publishAfterComposition],
    );
    const editor = useEditor(editorOptions);

    useEffect(() => {
      if (editor.isEditable === editable) return;
      editor.setEditable(editable, false);
    }, [editor, editable]);

    const replaceText = useCallback(
      (nextText: string, selection?: ComposerTextSelection) => {
        const text = normalizeNewlines(nextText);
        publishedTextRef.current = text;
        replaceDocumentText(editor, text, selection);
        syncEmpty(text);
      },
      [editor, syncEmpty],
    );

    const replaceSegments = useCallback(
      (segments: readonly InlineSegment[], selection?: ComposerTextSelection) => {
        const text = normalizeNewlines(inlineSegmentsText(segments));
        publishedTextRef.current = text;
        replaceDocumentSegments(editor, segments, selection);
        syncEmpty(text);
      },
      [editor, syncEmpty],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editor.view.focus(),
        blur: () => editor.view.dom.blur(),
        isFocused: () => editor.view.hasFocus(),
        getText: () => docText(editor.state.doc),
        getSelection: () => readSelection(editor.state),
        replaceText,
        reset: () => replaceText(""),
        insertInlineBlock: (block, range) => insertInlineBlock(editor, block, range),
        pickSkillBlock: (block, command) => applySkillPick(editor, block, command),
        getSegments: () => fragmentSegments(editor.state.doc.firstChild?.content ?? Fragment.empty),
        replaceSegments,
        getNativeRef: () => editor.view.dom,
      }),
      [editor, replaceSegments, replaceText],
    );

    const placeholderStyle = useMemo(
      () => ({
        ...PLACEHOLDER_STYLE,
        color: typeof placeholderTextColor === "string" ? placeholderTextColor : undefined,
      }),
      [placeholderTextColor],
    );

    return (
      <div style={ROOT_STYLE} {...toDataAttributes(dataSet)}>
        {isEmpty && placeholder ? (
          <div aria-hidden style={placeholderStyle}>
            {placeholder}
          </div>
        ) : null}
        <InlineBlockServerIdContext.Provider value={inlineBlockServerId}>
          <EditorContent editor={editor} style={CONTENT_STYLE} />
        </InlineBlockServerIdContext.Provider>
      </div>
    );
  },
);
