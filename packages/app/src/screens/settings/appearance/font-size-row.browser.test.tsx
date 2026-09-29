import React, { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { userEvent } from "@vitest/browser/context";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { FontSizeRow } from "./font-size-row";

// 应用源码在 Vitest 下按经典 JSX 运行时编译，需要全局的 React。
beforeEach(() => vi.stubGlobal("React", React));

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

const MIN_SIZE = 9;
const MAX_SIZE = 22;

// 设置页的提交规则：空值按 allowEmpty 决定是跟随还是退回已提交的值，数字 clamp 到 9–22。
function normalizeDraft(draft: string, committed: string, allowEmpty: boolean): string {
  if (draft.length === 0) return allowEmpty ? "" : committed;
  const parsed = Number.parseInt(draft, 10);
  if (!Number.isFinite(parsed)) return committed;
  return String(Math.min(MAX_SIZE, Math.max(MIN_SIZE, parsed)));
}

interface HarnessProps {
  initial: string;
  defaultValue: string;
  allowEmpty: boolean;
  placeholder?: string;
}

function Harness({ initial, defaultValue, allowEmpty, placeholder }: HarnessProps) {
  const [committed, setCommitted] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const changeDraft = useCallback((value: string) => setDraft(value.replace(/[^\d]/g, "")), []);
  const commit = useCallback(() => {
    const next = normalizeDraft(draft, committed, allowEmpty);
    setDraft(next);
    setCommitted(next);
  }, [allowEmpty, committed, draft]);
  const reset = useCallback(() => {
    setDraft(defaultValue);
    setCommitted(defaultValue);
  }, [defaultValue]);
  return (
    <FontSizeRow
      title="Code size"
      hint="Used for code"
      accessibilityLabel="Code font size"
      draft={draft}
      placeholder={placeholder}
      showReset={committed !== defaultValue}
      onChangeDraft={changeDraft}
      onCommit={commit}
      onReset={reset}
    />
  );
}

const mounted: { root: Root; container: HTMLDivElement }[] = [];

function mountRow(props: HarnessProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Harness {...props} />));
  mounted.push({ root, container });
}

function sizeInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Code font size"]');
  if (!input) throw new Error("Size input did not render");
  return input;
}

function resetButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="font-size-reset"]');
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  document.body.replaceChildren();
});

describe("FontSizeRow", () => {
  it("shows the clamped value after an out-of-range size is submitted or blurred", async () => {
    mountRow({ initial: "12", defaultValue: "12", allowEmpty: false });

    await userEvent.fill(sizeInput(), "30");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(sizeInput().value).toBe("22"));

    await userEvent.fill(sizeInput(), "3");
    act(() => sizeInput().blur());
    await vi.waitFor(() => expect(sizeInput().value).toBe("9"));
  });

  it("offers reset only while the size differs from the default", async () => {
    mountRow({ initial: "12", defaultValue: "12", allowEmpty: false });
    expect(resetButton()).toBeNull();

    await userEvent.fill(sizeInput(), "16");
    await userEvent.keyboard("{Enter}");
    const button = await vi.waitFor(() => {
      const element = resetButton();
      if (!element) throw new Error("Reset button did not appear");
      return element;
    });
    expect(button.getAttribute("aria-label")).toBe("Reset Code size");

    await userEvent.click(button);
    await vi.waitFor(() => expect(sizeInput().value).toBe("12"));
    expect(resetButton()).toBeNull();
  });

  it("empties a follow-style size on reset and keeps its placeholder", async () => {
    mountRow({ initial: "18", defaultValue: "", allowEmpty: true, placeholder: "12" });
    expect(sizeInput().value).toBe("18");

    await userEvent.click(resetButton()!);
    await vi.waitFor(() => expect(sizeInput().value).toBe(""));
    expect(sizeInput().placeholder).toBe("12");
    expect(resetButton()).toBeNull();
  });
});
