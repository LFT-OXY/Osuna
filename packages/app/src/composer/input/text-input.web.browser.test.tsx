import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
  TextInputSelectionChangeEventData,
} from "react-native";
import { cdp, userEvent } from "@vitest/browser/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerTextInput } from "./text-input.web";
import type { ComposerTextInputHandle } from "./text-input.types";

// 应用源码按经典 JSX 运行时编译，需要全局 React。
beforeEach(() => vi.stubGlobal("React", React));

type KeyPressEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean }
>;

interface Recorder {
  changes: string[];
  selections: { start: number; end: number }[];
  keys: { key: string; shiftKey: boolean; isComposing: boolean }[];
  /** 宿主拦下的按键，对应 Composer 的 Enter 发送与菜单导航。 */
  claimKeys: readonly string[];
  onChangeText: (text: string) => void;
  onSelectionChange: (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => void;
  onKeyPress: (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => void;
}

function createRecorder(): Recorder {
  const recorder: Recorder = {
    changes: [],
    selections: [],
    keys: [],
    claimKeys: [],
    onChangeText: (text) => recorder.changes.push(text),
    onSelectionChange: (event) => recorder.selections.push(event.nativeEvent.selection),
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

    expect(mounted.handle.getSelection?.()).toEqual({ start: 2, end: 2 });
    expect(mounted.recorder.selections.at(-1)).toEqual({ start: 2, end: 2 });
  });

  it("replaces text and selection without reporting a change, then types at the new caret", async () => {
    const mounted = mount({ initialValue: "old" });
    await focusAtEnd(mounted);

    act(() => mounted.handle.replaceText("hello\nworld", { start: 5, end: 5 }));
    expect(mounted.recorder.changes).toEqual([]);
    expect(mounted.handle.getText()).toBe("hello\nworld");
    expect(mounted.handle.getSelection?.()).toEqual({ start: 5, end: 5 });

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
