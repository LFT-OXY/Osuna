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
  TextInputSelectionChangeEventData,
} from "react-native";
import { Extension, type JSONContent } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { HardBreak } from "@tiptap/extension-hard-break";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";
import { EditorContent, useEditor, type Editor, type UseEditorOptions } from "@tiptap/react";
import { Fragment, Slice, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type {
  ComposerTextInputHandle,
  ComposerTextInputProps,
  ComposerTextSelection,
} from "./text-input.types";

/**
 * Composer 的 Web / Electron 文字输入：Tiptap 编辑器，对外沿用共享文本输入的 handle 与回调。
 *
 * 文档固定为一个段落，换行是 hardBreak。段落内每个字符与 hardBreak 都占一个位置，
 * 所以文字偏移 = 编辑器位置 - 1。
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
  Paragraph,
  Text,
  ComposerHardBreak,
  ComposerNewline,
  UndoRedo,
];

function normalizeNewlines(text: string): string {
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

function textToFragment(schema: Schema, text: string): Fragment {
  return Fragment.fromJSON(schema, textToInlineContent(text));
}

function docText(doc: ProseMirrorNode): string {
  return doc.textBetween(0, doc.content.size, "\n", (leaf) =>
    leaf.type.name === "hardBreak" ? "\n" : "",
  );
}

function clampOffset(offset: number, length: number): number {
  return Math.max(0, Math.min(length, offset));
}

function readSelection(state: EditorState): ComposerTextSelection {
  const { from, to } = state.selection;
  const length = state.doc.firstChild?.content.size ?? 0;
  return { start: clampOffset(from - 1, length), end: clampOffset(to - 1, length) };
}

function replaceDocumentText(
  editor: Editor,
  text: string,
  selection: ComposerTextSelection | undefined,
): void {
  const { state } = editor;
  const paragraph = state.doc.firstChild;
  if (!paragraph) return;
  const content = textToFragment(state.schema, text);
  const tr = state.tr.replaceWith(1, 1 + paragraph.content.size, content);
  const length = content.size;
  const target = selection ?? { start: length, end: length };
  tr.setSelection(
    TextSelection.create(
      tr.doc,
      1 + clampOffset(target.start, length),
      1 + clampOffset(target.end, length),
    ),
  );
  // 与 textarea 赋值一致：程序替换不进撤销栈。
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

function insertPlainText(view: EditorView, text: string): void {
  const fragment = textToFragment(view.state.schema, text);
  view.dispatch(view.state.tr.replaceSelection(new Slice(fragment, 0, 0)).scrollIntoView());
}

// beforeinput 早于 ProseMirror 从 DOM 同步选区（selectionchange 是异步的），替换范围以 DOM 选区为准。
function insertPlainTextAtDomSelection(view: EditorView, text: string): void {
  const selection = view.dom.ownerDocument.getSelection();
  const anchorNode = selection?.anchorNode;
  const focusNode = selection?.focusNode;
  const selectionInEditor =
    anchorNode != null &&
    focusNode != null &&
    view.dom.contains(anchorNode) &&
    view.dom.contains(focusNode);
  if (!selection || !selectionInEditor) {
    insertPlainText(view, text);
    return;
  }
  const anchor = view.posAtDOM(anchorNode, selection.anchorOffset);
  const head = view.posAtDOM(focusNode, selection.focusOffset);
  const from = Math.max(1, Math.min(anchor, head));
  const to = Math.min(view.state.doc.content.size - 1, Math.max(anchor, head));
  const fragment = textToFragment(view.state.schema, text);
  const tr = view.state.tr.replaceWith(from, to, fragment);
  tr.setSelection(TextSelection.create(tr.doc, from + fragment.size));
  view.dispatch(tr.scrollIntoView());
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
    } = props;

    const callbacksRef = useRef({ onChangeText, onKeyPress, onSelectionChange, onFocus, onBlur });
    callbacksRef.current = { onChangeText, onKeyPress, onSelectionChange, onFocus, onBlur };
    const accessibilityLabelRef = useRef(accessibilityLabel);
    accessibilityLabelRef.current = accessibilityLabel;
    const editableRef = useRef(editable);
    editableRef.current = editable;

    const initialTextRef = useRef(normalizeNewlines(initialValue));
    const publishedTextRef = useRef(initialTextRef.current);
    const publishedSelectionRef = useRef<ComposerTextSelection | null>(null);
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
          previous !== null && previous.start === selection.start && previous.end === selection.end;
        if (selectionUnchanged) return;
        publishedSelectionRef.current = selection;
        callbacksRef.current.onSelectionChange?.(
          toSyntheticEvent<TextInputSelectionChangeEventData>({ selection }),
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
          content: [{ type: "paragraph", content: textToInlineContent(initialTextRef.current) }],
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
              insertPlainTextAtDomSelection(view, data);
              return true;
            },
            compositionend: (view) => {
              publishAfterComposition(view);
              return false;
            },
          },
          // 与 textarea 一致只取纯文字。Composer 在捕获阶段先收走图片（进 Attachment tray）并
          // preventDefault；它不收（断连、禁用等）时照常插入剪贴板里的文字。
          handlePaste: (view, event) => {
            if (event.defaultPrevented) return true;
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
        getNativeRef: () => editor.view.dom,
      }),
      [editor, replaceText],
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
        <EditorContent editor={editor} style={CONTENT_STYLE} />
      </div>
    );
  },
);
