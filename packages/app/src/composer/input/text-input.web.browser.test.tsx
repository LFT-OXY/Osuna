import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from "react-native";
import { cdp, userEvent } from "@vitest/browser/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InlineBlock, InlineSegment } from "@/inline-blocks";
import { ComposerTextInput } from "./text-input.web";
import type { ComposerSelectionChangeEventData, ComposerTextInputHandle } from "./text-input.types";

// 应用源码按经典 JSX 运行时编译，需要全局 React。
beforeEach(() => vi.stubGlobal("React", React));

type KeyPressEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean }
>;

interface Recorder {
  changes: string[];
  selections: { start: number; end: number }[];
  blockBoundaries: number[];
  keys: { key: string; shiftKey: boolean; isComposing: boolean }[];
  /** 宿主拦下的按键，对应 Composer 的 Enter 发送与菜单导航。 */
  claimKeys: readonly string[];
  onChangeText: (text: string) => void;
  onSelectionChange: (event: NativeSyntheticEvent<ComposerSelectionChangeEventData>) => void;
  onKeyPress: (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => void;
}

function createRecorder(): Recorder {
  const recorder: Recorder = {
    changes: [],
    selections: [],
    blockBoundaries: [],
    keys: [],
    claimKeys: [],
    onChangeText: (text) => recorder.changes.push(text),
    onSelectionChange: (event) => {
      const { selection, blockBoundary } = event.nativeEvent;
      recorder.selections.push(selection);
      recorder.blockBoundaries.push(blockBoundary ?? 0);
    },
    onKeyPress: (event) => {
      const { key, shiftKey, isComposing } = (event as KeyPressEvent).nativeEvent;
      recorder.keys.push({ key, shiftKey: Boolean(shiftKey), isComposing: Boolean(isComposing) });
      if (recorder.claimKeys.includes(key) && !shiftKey) event.preventDefault();
    },
  };
  return recorder;
}

interface MountOptions {
  initialValue?: string;
  initialSegments?: readonly InlineSegment[];
  placeholder?: string;
  editable?: boolean;
  claimKeys?: readonly string[];
}

interface Mounted {
  root: Root;
  container: HTMLDivElement;
  editor: HTMLElement;
  handle: ComposerTextInputHandle;
  recorder: Recorder;
  render: (options: MountOptions) => void;
}

const mountedInputs: Mounted[] = [];

function mount(options: MountOptions = {}): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const recorder = createRecorder();
  const ref = React.createRef<ComposerTextInputHandle>();

  const render = (next: MountOptions) => {
    recorder.claimKeys = next.claimKeys ?? [];
    act(() => {
      root.render(
        <ComposerTextInput
          ref={ref}
          initialValue={next.initialValue ?? ""}
          initialSegments={next.initialSegments}
          placeholder={next.placeholder}
          placeholderTextColor="gray"
          accessibilityLabel="Message agent..."
          editable={next.editable ?? true}
          multiline
          onChangeText={recorder.onChangeText}
          onSelectionChange={recorder.onSelectionChange}
          onKeyPress={recorder.onKeyPress}
        />,
      );
    });
  };
  render(options);

  const editor = container.querySelector<HTMLElement>('[role="textbox"]');
  if (!editor || !ref.current) throw new Error("composer text input did not mount");
  const mounted = { root, container, editor, handle: ref.current, recorder, render };
  mountedInputs.push(mounted);
  return mounted;
}

function imagePasteEvent(): ClipboardEvent {
  const clipboardData = new DataTransfer();
  clipboardData.items.add(new File([new Uint8Array([1])], "shot.png", { type: "image/png" }));
  clipboardData.setData("text/plain", "shot.png");
  return new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true });
}

async function focusAtEnd(mounted: Mounted): Promise<void> {
  act(() => mounted.handle.focus());
  await vi.waitFor(() => expect(document.activeElement).toBe(mounted.editor));
}

afterEach(() => {
  for (const mounted of mountedInputs.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
});

describe("Composer text input on web", () => {
  it("exposes an accessible multiline textbox and starts with the caret after the draft", async () => {
    const mounted = mount({ initialValue: "draft" });

    expect(mounted.editor.getAttribute("aria-label")).toBe("Message agent...");
    expect(mounted.editor.getAttribute("aria-multiline")).toBe("true");
    await focusAtEnd(mounted);
    await userEvent.keyboard("!");

    expect(mounted.handle.getText()).toBe("draft!");
    expect(mounted.recorder.changes).toEqual(["draft!"]);
  });

  it("inserts a line break on Shift+Enter and leaves a claimed Enter to the host", async () => {
    const mounted = mount({ claimKeys: ["Enter"] });
    await focusAtEnd(mounted);

    await userEvent.keyboard("one{Shift>}{Enter}{/Shift}two{Enter}");

    expect(mounted.handle.getText()).toBe("one\ntwo");
    expect(mounted.recorder.keys.filter((key) => key.key === "Enter")).toEqual([
      { key: "Enter", shiftKey: true, isComposing: false },
      { key: "Enter", shiftKey: false, isComposing: false },
    ]);
  });

  it("inserts a line break on an Enter the host lets through", async () => {
    const mounted = mount();
    await focusAtEnd(mounted);

    await userEvent.keyboard("one{Enter}two");

    expect(mounted.handle.getText()).toBe("one\ntwo");
  });

  it("keeps line breaks in text inserted in one go, as Playwright fill and text services do", async () => {
    const mounted = mount({ initialValue: "old" });

    await focusAtEnd(mounted);
    await userEvent.fill(mounted.editor, "alpha\nbeta\n\nx");

    expect(mounted.handle.getText()).toBe("alpha\nbeta\n\nx");
    expect(mounted.recorder.changes.at(-1)).toBe("alpha\nbeta\n\nx");

    await userEvent.fill(mounted.editor, "one\ntwo");
    expect(mounted.handle.getText()).toBe("one\ntwo");
  });

  it("reports the caret in text offsets across line breaks", async () => {
    const mounted = mount({ initialValue: "ab\ncd" });
    await focusAtEnd(mounted);

    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");

    expect(mounted.handle.getSelection?.()).toEqual({ start: 2, end: 2, blockBoundary: 0 });
    expect(mounted.recorder.selections.at(-1)).toEqual({ start: 2, end: 2 });
  });

  it("replaces text and selection without reporting a change, then types at the new caret", async () => {
    const mounted = mount({ initialValue: "old" });
    await focusAtEnd(mounted);

    act(() => mounted.handle.replaceText("hello\nworld", { start: 5, end: 5 }));
    expect(mounted.recorder.changes).toEqual([]);
    expect(mounted.handle.getText()).toBe("hello\nworld");
    expect(mounted.handle.getSelection?.()).toEqual({ start: 5, end: 5, blockBoundary: 0 });

    await userEvent.keyboard("!");
    expect(mounted.handle.getText()).toBe("hello!\nworld");
    expect(mounted.recorder.changes).toEqual(["hello!\nworld"]);
  });

  it("does not undo past a programmatic replacement", async () => {
    const mounted = mount();
    await focusAtEnd(mounted);
    await userEvent.keyboard("sent");

    act(() => mounted.handle.reset());
    await userEvent.keyboard("{ControlOrMeta>}z{/ControlOrMeta}");

    expect(mounted.handle.getText()).toBe("");
  });

  it("clears on reset and keeps focus", async () => {
    const mounted = mount({ initialValue: "line one\nline two" });
    await focusAtEnd(mounted);

    act(() => mounted.handle.reset());

    expect(mounted.handle.getText()).toBe("");
    expect(document.activeElement).toBe(mounted.editor);
  });

  it("keeps locally typed text when its parent rerenders with a stale value", async () => {
    const mounted = mount();
    await focusAtEnd(mounted);
    await userEvent.keyboard("locally typed");

    mounted.render({ initialValue: "", placeholder: "rerender with stale publication" });

    expect(mounted.handle.getText()).toBe("locally typed");
  });

  it("shows the placeholder only while empty", async () => {
    const mounted = mount({ placeholder: "Message the agent" });
    const placeholder = () =>
      Array.from(mounted.container.querySelectorAll('[aria-hidden="true"]')).find(
        (node) => node.textContent === "Message the agent",
      );
    expect(placeholder()).toBeDefined();

    await focusAtEnd(mounted);
    await userEvent.keyboard("x");
    expect(placeholder()).toBeUndefined();

    act(() => mounted.handle.reset());
    expect(placeholder()).toBeDefined();
  });

  it("is read-only while not editable", () => {
    const mounted = mount({ initialValue: "locked" });
    mounted.render({ initialValue: "locked", editable: false });

    expect(mounted.editor.getAttribute("contenteditable")).toBe("false");
    expect(mounted.editor.getAttribute("aria-readonly")).toBe("true");
  });

  it("pastes clipboard text as plain text with line breaks", async () => {
    const mounted = mount({ initialValue: "a" });
    await focusAtEnd(mounted);

    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "x\r\ny");
    clipboardData.setData("text/html", "<p><b>x</b></p><p>y</p>");
    act(() => {
      mounted.editor.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
      );
    });

    expect(mounted.handle.getText()).toBe("ax\ny");
  });

  it("inserts nothing once the Composer has taken a pasted image", async () => {
    const mounted = mount({ initialValue: "a" });
    await focusAtEnd(mounted);
    // 与 Composer 一样在捕获阶段收走图片
    const takeImage = (event: Event) => event.preventDefault();
    mounted.editor.addEventListener("paste", takeImage, true);

    act(() => {
      mounted.editor.dispatchEvent(imagePasteEvent());
    });

    mounted.editor.removeEventListener("paste", takeImage, true);
    expect(mounted.handle.getText()).toBe("a");
  });

  it("pastes the clipboard text when the Composer does not take the image", async () => {
    const mounted = mount({ initialValue: "a" });
    await focusAtEnd(mounted);

    const event = imagePasteEvent();
    act(() => {
      mounted.editor.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(mounted.handle.getText()).toBe("ashot.png");
  });

  it("reports IME text once the composition commits", async () => {
    const mounted = mount({ initialValue: "old" });
    await focusAtEnd(mounted);

    await cdp().send("Input.imeSetComposition", {
      text: "ni",
      selectionStart: 2,
      selectionEnd: 2,
    });
    await cdp().send("Input.imeSetComposition", {
      text: "你",
      selectionStart: 1,
      selectionEnd: 1,
    });
    expect(mounted.recorder.changes).toEqual([]);
    expect(mounted.handle.getText()).toBe("old你");

    await cdp().send("Input.insertText", { text: "你好" });

    await vi.waitFor(() => expect(mounted.recorder.changes).toEqual(["old你好"]));
    expect(mounted.handle.getText()).toBe("old你好");
    expect(mounted.recorder.selections.at(-1)).toEqual({ start: 5, end: 5 });
  });
});

const componentsDir: InlineBlock = { kind: "file", path: "src/components", entryKind: "directory" };
const xFile: InlineBlock = { kind: "file", path: "src/x.ts", entryKind: "file" };
const X_LINK = "[x.ts](src/x.ts)";

function blockElements(mounted: Mounted): HTMLElement[] {
  return Array.from(mounted.editor.querySelectorAll<HTMLElement>("[data-inline-block]"));
}

/** 块的节点视图由 React 异步渲染。 */
async function expectBlockCount(mounted: Mounted, count: number): Promise<HTMLElement[]> {
  await vi.waitFor(() => expect(blockElements(mounted)).toHaveLength(count));
  return blockElements(mounted);
}

function pasteEvent(clipboardData: DataTransfer): ClipboardEvent {
  return new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true });
}

/** "see " 后面跟一个选中的文件块，光标在块后补的空格之后。 */
async function mountWithFileBlock(): Promise<Mounted> {
  const mounted = mount({ initialValue: "see @x" });
  await focusAtEnd(mounted);
  act(() => mounted.handle.insertInlineBlock?.(xFile, { start: 4, end: 6 }));
  return mounted;
}

describe("Inline blocks in the Composer text input", () => {
  it("replaces the @query with a block and a space, reporting the text the agent receives", async () => {
    const mounted = mount({ initialValue: "open @src/co" });
    await focusAtEnd(mounted);

    act(() => mounted.handle.insertInlineBlock?.(componentsDir, { start: 5, end: 12 }));

    const text = "open [components](src/components/) ";
    const caret = "open [components](src/components/) ".length;
    expect(mounted.handle.getText()).toBe(text);
    expect(mounted.recorder.changes.at(-1)).toBe(text);
    expect(mounted.recorder.selections.at(-1)).toEqual({ start: caret, end: caret });
    expect(mounted.recorder.blockBoundaries.at(-1)).toBe(caret - 1);
    const [block] = await expectBlockCount(mounted, 1);
    expect(block?.dataset.inlineBlock).toBe("directory");
    expect(block?.textContent).toBe("components");

    await userEvent.keyboard("!");
    expect(mounted.handle.getText()).toBe("open [components](src/components/) !");
  });

  it("reuses the space that already follows the @query", async () => {
    const mounted = mount({ initialValue: "open @src/co next" });
    await focusAtEnd(mounted);

    act(() => mounted.handle.insertInlineBlock?.(componentsDir, { start: 5, end: 12 }));

    const caret = "open [components](src/components/) ".length;
    expect(mounted.handle.getText()).toBe("open [components](src/components/) next");
    expect(mounted.handle.getSelection?.()).toEqual({
      start: caret,
      end: caret,
      blockBoundary: caret - 1,
    });
  });

  it("undoes a pick back to the @query", async () => {
    const mounted = mount({ initialValue: "open @src/co" });
    await focusAtEnd(mounted);
    act(() => mounted.handle.insertInlineBlock?.(componentsDir, { start: 5, end: 12 }));
    await expectBlockCount(mounted, 1);

    await userEvent.keyboard("{ControlOrMeta>}z{/ControlOrMeta}");

    expect(mounted.handle.getText()).toBe("open @src/co");
    await expectBlockCount(mounted, 0);
  });

  it("steps over a block with the arrow keys", async () => {
    const mounted = await mountWithFileBlock();
    await expectBlockCount(mounted, 1);
    const afterBlock = `see ${X_LINK}`.length;

    await userEvent.keyboard("{ArrowLeft}");
    expect(mounted.handle.getSelection?.()).toEqual({
      start: afterBlock,
      end: afterBlock,
      blockBoundary: afterBlock,
    });
    await userEvent.keyboard("{ArrowLeft}");
    expect(mounted.handle.getSelection?.()).toEqual({ start: 4, end: 4, blockBoundary: 0 });
    await userEvent.keyboard("{ArrowRight}");
    expect(mounted.handle.getSelection?.()).toEqual({
      start: afterBlock,
      end: afterBlock,
      blockBoundary: afterBlock,
    });
  });

  it("deletes the whole block with one Backspace right after it", async () => {
    const mounted = await mountWithFileBlock();

    await expectBlockCount(mounted, 1);
    await userEvent.keyboard("{Backspace}");
    await userEvent.keyboard("{Backspace}");

    expect(mounted.handle.getText()).toBe("see ");
    await expectBlockCount(mounted, 0);
  });

  it("deletes the whole block with one Delete right before it", async () => {
    const mounted = await mountWithFileBlock();

    await expectBlockCount(mounted, 1);
    await userEvent.keyboard("{ArrowLeft}");
    await userEvent.keyboard("{ArrowLeft}");
    await userEvent.keyboard("{Delete}");

    expect(mounted.handle.getText()).toBe("see  ");
    await expectBlockCount(mounted, 0);
  });

  it("keeps blocks outside the range a text replacement changes", async () => {
    const mounted = await mountWithFileBlock();

    act(() => mounted.handle.replaceText(`see ${X_LINK} /compact `));
    await expectBlockCount(mounted, 1);
    expect(mounted.handle.getText()).toBe(`see ${X_LINK} /compact `);

    // 变化范围碰到块时，块整块换成新文字。
    act(() => mounted.handle.replaceText("see [x.ts](src/y.ts) "));
    await expectBlockCount(mounted, 0);
    expect(mounted.handle.getText()).toBe("see [x.ts](src/y.ts) ");

    act(() => mounted.handle.reset());
    expect(mounted.handle.getText()).toBe("");
  });

  it("pastes link text from outside as text", async () => {
    const mounted = mount({ initialValue: "" });
    await focusAtEnd(mounted);

    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", X_LINK);
    act(() => {
      mounted.editor.dispatchEvent(pasteEvent(clipboardData));
    });

    expect(mounted.handle.getText()).toBe(X_LINK);
    expect(blockElements(mounted)).toHaveLength(0);
  });

  it("copies blocks as link text and pastes them back inside as blocks", async () => {
    const mounted = await mountWithFileBlock();
    await expectBlockCount(mounted, 1);
    await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}");

    const clipboardData = new DataTransfer();
    const copy = new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true });
    act(() => {
      mounted.editor.dispatchEvent(copy);
    });
    expect(copy.defaultPrevented).toBe(true);
    expect(clipboardData.getData("text/plain")).toBe(`see ${X_LINK} `);

    await userEvent.keyboard("{ArrowRight}");
    act(() => {
      mounted.editor.dispatchEvent(pasteEvent(clipboardData));
    });

    expect(mounted.handle.getText()).toBe(`see ${X_LINK} see ${X_LINK} `);
    await expectBlockCount(mounted, 2);
  });

  it("pastes at the caret the browser just moved, before the editor reads the selection", async () => {
    const mounted = await mountWithFileBlock();
    await expectBlockCount(mounted, 1);
    await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}");
    const clipboardData = new DataTransfer();
    act(() => {
      mounted.editor.dispatchEvent(
        new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true }),
      );
    });

    // 浏览器的方向键已把光标收到末尾，编辑器要等异步的 selectionchange 才知道。
    act(() => {
      document
        .getSelection()
        ?.collapse(mounted.editor.firstChild, mounted.editor.firstChild?.childNodes.length ?? 0);
      mounted.editor.dispatchEvent(pasteEvent(clipboardData));
    });

    expect(mounted.handle.getText()).toBe(`see ${X_LINK} see ${X_LINK} `);
    await expectBlockCount(mounted, 2);
  });

  it("does not paste a forged block structure", async () => {
    const mounted = mount({ initialValue: "" });
    await focusAtEnd(mounted);

    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "plain");
    clipboardData.setData(
      "application/x-paseo-inline-segments",
      JSON.stringify([{ type: "block", block: { kind: "file", path: "" } }]),
    );
    act(() => {
      mounted.editor.dispatchEvent(pasteEvent(clipboardData));
    });

    expect(mounted.handle.getText()).toBe("plain");
  });
});

describe("Restoring inline blocks in the Composer text input", () => {
  const segments: InlineSegment[] = [
    { type: "text", text: "see " },
    { type: "block", block: xFile },
    { type: "text", text: " typed [y.ts](y.ts)\nnext" },
  ];
  const text = `see ${X_LINK} typed [y.ts](y.ts)\nnext`;

  it("mounts saved segments with blocks as blocks and typed link text as text", async () => {
    const mounted = mount({ initialValue: text, initialSegments: segments });

    await expectBlockCount(mounted, 1);
    expect(mounted.handle.getText()).toBe(text);
    expect(mounted.handle.getSegments?.()).toEqual(segments);
  });

  it("mounts the text when the saved segments no longer match it", async () => {
    const mounted = mount({ initialValue: `${text}!`, initialSegments: segments });

    expect(mounted.handle.getText()).toBe(`${text}!`);
    expect(mounted.handle.getSegments?.()).toEqual([{ type: "text", text: `${text}!` }]);
    await expectBlockCount(mounted, 0);
  });

  it("swaps in segments with the caret at the end, without reporting a change", async () => {
    const mounted = mount({ initialValue: "draft" });
    await focusAtEnd(mounted);
    const changesBefore = mounted.recorder.changes.length;

    act(() => mounted.handle.replaceSegments?.(segments));

    await expectBlockCount(mounted, 1);
    expect(mounted.handle.getText()).toBe(text);
    expect(mounted.handle.getSelection?.()).toMatchObject({ start: text.length, end: text.length });
    expect(mounted.recorder.changes).toHaveLength(changesBefore);

    await userEvent.keyboard("!");
    expect(mounted.handle.getSegments?.()).toEqual([
      ...segments.slice(0, 2),
      { type: "text", text: " typed [y.ts](y.ts)\nnext!" },
    ]);
  });
});

describe("Skill blocks in the Composer text input", () => {
  const tddSkill = { kind: "skill", name: "atw-tdd" } as const;
  const askmeSkill = { kind: "skill", name: "atw-askme", description: "Ask me first" } as const;

  it("moves a skill picked mid-text to the start and leaves the caret where the /query was", async () => {
    const mounted = mount({ initialValue: "use /tdd now" });
    await focusAtEnd(mounted);

    act(() => mounted.handle.pickSkillBlock?.(tddSkill, { start: 4, end: 8 }));

    const caret = "/atw-tdd use ".length;
    expect(mounted.handle.getText()).toBe("/atw-tdd use now");
    expect(mounted.recorder.changes.at(-1)).toBe("/atw-tdd use now");
    expect(mounted.handle.getSelection?.()).toMatchObject({ start: caret, end: caret });
    const [block] = await expectBlockCount(mounted, 1);
    expect(block?.dataset.inlineBlock).toBe("skill");
    expect(block?.textContent).toBe("atw-tdd");

    await userEvent.keyboard("x");
    expect(mounted.handle.getText()).toBe("/atw-tdd use xnow");
  });

  it("appends a second skill after the first and keeps one block per name", async () => {
    const mounted = mount({ initialValue: "/tdd" });
    await focusAtEnd(mounted);
    act(() => mounted.handle.pickSkillBlock?.(tddSkill, { start: 0, end: 4 }));
    await userEvent.keyboard("fix /ask");

    act(() => mounted.handle.pickSkillBlock?.(askmeSkill, { start: 13, end: 17 }));
    await userEvent.keyboard("/atw-tdd");
    act(() => mounted.handle.pickSkillBlock?.(tddSkill, { start: 24, end: 32 }));

    expect(mounted.handle.getText()).toBe("/atw-tdd /atw-askme fix ");
    expect(mounted.handle.getSegments?.()).toEqual([
      { type: "block", block: tddSkill },
      { type: "text", text: " " },
      { type: "block", block: askmeSkill },
      { type: "text", text: " fix " },
    ]);
    await expectBlockCount(mounted, 2);
  });

  it("undoes a pick back to the /query", async () => {
    const mounted = mount({ initialValue: "use /tdd" });
    await focusAtEnd(mounted);
    act(() => mounted.handle.pickSkillBlock?.(tddSkill, { start: 4, end: 8 }));
    await expectBlockCount(mounted, 1);

    await userEvent.keyboard("{ControlOrMeta>}z{/ControlOrMeta}");

    expect(mounted.handle.getText()).toBe("use /tdd");
    await expectBlockCount(mounted, 0);
  });

  it("keeps the caret after a leading skill block", async () => {
    const mounted = mount({
      initialValue: "/atw-tdd go",
      initialSegments: [
        { type: "block", block: tddSkill },
        { type: "text", text: " go" },
      ],
    });
    await focusAtEnd(mounted);
    await expectBlockCount(mounted, 1);
    const afterBlock = "/atw-tdd".length;

    for (let press = 0; press < 4; press += 1) await userEvent.keyboard("{ArrowLeft}");
    expect(mounted.handle.getSelection?.()).toMatchObject({ start: afterBlock, end: afterBlock });
    await userEvent.keyboard("{Home}");
    expect(mounted.handle.getSelection?.()).toMatchObject({ start: afterBlock, end: afterBlock });

    await userEvent.keyboard("{Backspace}");
    expect(mounted.handle.getText()).toBe(" go");
    await expectBlockCount(mounted, 0);
  });

  it("keeps the caret after the last of several leading skill blocks", async () => {
    const mounted = mount({
      initialValue: "/atw-tdd /atw-askme go",
      initialSegments: [
        { type: "block", block: tddSkill },
        { type: "text", text: " " },
        { type: "block", block: askmeSkill },
        { type: "text", text: " go" },
      ],
    });
    await focusAtEnd(mounted);
    await expectBlockCount(mounted, 2);
    const afterBlocks = "/atw-tdd /atw-askme".length;

    for (let press = 0; press < 6; press += 1) await userEvent.keyboard("{ArrowLeft}");
    expect(mounted.handle.getSelection?.()).toMatchObject({ start: afterBlocks, end: afterBlocks });
    await userEvent.keyboard("{Home}");
    expect(mounted.handle.getSelection?.()).toMatchObject({ start: afterBlocks, end: afterBlocks });
  });

  it("moves skill blocks pasted from inside the composer to the start", async () => {
    const mounted = mount({ initialValue: "see " });
    await focusAtEnd(mounted);
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "/atw-tdd x");
    clipboardData.setData(
      "application/x-paseo-inline-segments",
      JSON.stringify([
        { type: "block", block: tddSkill },
        { type: "text", text: " x" },
      ]),
    );

    act(() => {
      mounted.editor.dispatchEvent(pasteEvent(clipboardData));
    });

    expect(mounted.handle.getSegments?.()).toEqual([
      { type: "block", block: tddSkill },
      { type: "text", text: " see x" },
    ]);
    expect(mounted.handle.getSelection?.()).toMatchObject({
      start: "/atw-tdd see x".length,
      end: "/atw-tdd see x".length,
    });
    await expectBlockCount(mounted, 1);
  });
});
