import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { userEvent } from "@vitest/browser/context";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { FontProbe, LocalFontFamilies } from "@/appearance/font-probe";
import { FontPickerRow, type FontPickerKind } from "./font-picker-row";

// 应用源码在 Vitest 下按经典 JSX 运行时编译，需要全局的 React。
beforeEach(() => vi.stubGlobal("React", React));

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

const MONOSPACE = new Set(["Fira Code", "Menlo"]);
const INSTALLED = new Set(["Arial", "Fira Code", "Menlo"]);

function fakeProbe(families: LocalFontFamilies): FontProbe {
  return {
    listFamilies: async () => families,
    isInstalled: (family) => INSTALLED.has(family),
    isMonospace: (family) => MONOSPACE.has(family),
  };
}

const AVAILABLE = fakeProbe({ status: "available", families: ["Arial", "Fira Code", "Menlo"] });
const UNAVAILABLE = fakeProbe({ status: "unavailable" });

const ACCESSIBILITY_LABEL: Record<FontPickerKind, string> = {
  interface: "Interface font family",
  code: "Code font family",
  terminal: "Terminal font family",
};

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

function mountPicker(props: { kind: FontPickerKind; value: string; probe: FontProbe }) {
  const onChange = vi.fn<(value: string) => void>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <FontPickerRow
        kind={props.kind}
        title="Font"
        hint="Pick a font"
        accessibilityLabel={ACCESSIBILITY_LABEL[props.kind]}
        value={props.value}
        withBorder={false}
        probe={props.probe}
        onChange={onChange}
      />,
    ),
  );
  mounted.push({ root, container });
  return { container, onChange };
}

function trigger(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-testid="font-picker-trigger"]');
  if (!element) throw new Error("Font picker trigger did not render");
  return element;
}

function familyOptionLabels(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-testid^="font-family-option-"]')].map(
    (element) => element.textContent ?? "",
  );
}

async function openPicker() {
  await userEvent.click(trigger());
  await vi.waitFor(() => {
    expect(document.querySelector('[data-testid="font-picker-default-option"]')).not.toBeNull();
  });
}

function searchInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[placeholder="Search fonts"]');
  if (!input) throw new Error("Font search input did not render");
  return input;
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  document.body.replaceChildren();
});

describe("FontPickerRow", () => {
  it("lists the installed fonts in their own face once opened, and filters them by search", async () => {
    mountPicker({ kind: "interface", value: "", probe: AVAILABLE });
    expect(trigger().getAttribute("aria-label")).toBe("Interface font family: System default");

    await openPicker();
    await vi.waitFor(() => expect(familyOptionLabels()).toEqual(["Arial", "Fira Code", "Menlo"]));
    const menlo = document.querySelector<HTMLElement>('[data-testid="font-family-option-Menlo"]');
    const menloLabel = [...(menlo?.querySelectorAll<HTMLElement>("div") ?? [])].find(
      (element) => element.textContent === "Menlo" && element.children.length === 0,
    );
    expect(menloLabel && getComputedStyle(menloLabel).fontFamily.startsWith("Menlo,")).toBe(true);

    await userEvent.fill(searchInput(), "fira");
    await vi.waitFor(() => expect(familyOptionLabels()).toEqual(["Fira Code"]));
  });

  it("lists only monospace fonts for the code and terminal fonts", async () => {
    mountPicker({ kind: "code", value: "", probe: AVAILABLE });
    await openPicker();
    await vi.waitFor(() => expect(familyOptionLabels()).toEqual(["Fira Code", "Menlo"]));
  });

  it("still saves a typed font name when the fonts cannot be listed", async () => {
    const { onChange } = mountPicker({ kind: "code", value: "", probe: UNAVAILABLE });
    await openPicker();
    expect(familyOptionLabels()).toEqual([]);

    await userEvent.fill(searchInput(), "Maple Mono");
    const custom = await vi.waitFor(() => {
      const element = document.querySelector<HTMLElement>(
        '[data-testid="font-picker-custom-option"]',
      );
      if (!element) throw new Error("Custom option did not render");
      return element;
    });
    expect(custom.textContent).toBe('Use "Maple Mono"');
    await userEvent.click(custom);

    expect(onChange).toHaveBeenCalledExactlyOnceWith("Maple Mono");
  });

  it("shows a stored font stack verbatim, in its own face", () => {
    const stack = '"Maple Mono", Menlo, monospace';
    mountPicker({ kind: "code", value: stack, probe: AVAILABLE });

    expect(trigger().textContent).toBe(stack);
    expect(trigger().getAttribute("aria-label")).toBe(`Code font family: ${stack}`);
    const label = [...trigger().querySelectorAll<HTMLElement>("div")].find(
      (element) => element.textContent === stack && element.children.length === 0,
    );
    expect(label && getComputedStyle(label).fontFamily.startsWith('"Maple Mono", Menlo')).toBe(
      true,
    );
  });

  it("writes an empty value when Default is picked", async () => {
    const { onChange } = mountPicker({ kind: "interface", value: "Arial", probe: AVAILABLE });
    await openPicker();
    const option = document.querySelector<HTMLElement>(
      '[data-testid="font-picker-default-option"]',
    );
    expect(option?.textContent).toBe("System default");
    await userEvent.click(option!);

    expect(onChange).toHaveBeenCalledExactlyOnceWith("");
  });

  it("offers Follow code font as the terminal default", async () => {
    const { onChange } = mountPicker({ kind: "terminal", value: "Menlo", probe: AVAILABLE });
    await openPicker();
    const option = document.querySelector<HTMLElement>(
      '[data-testid="font-picker-default-option"]',
    );
    expect(option?.textContent).toBe("Follow code font");
    await userEvent.click(option!);

    expect(onChange).toHaveBeenCalledExactlyOnceWith("");
  });

  it("warns under the row when the first font is not installed", () => {
    const { container } = mountPicker({
      kind: "interface",
      value: '"Missing Font", Arial',
      probe: AVAILABLE,
    });

    expect(container.textContent).toContain(
      "This font was not found on this device; a fallback font will be used",
    );
  });

  it("warns when the code or terminal font is not monospace", () => {
    const code = mountPicker({ kind: "code", value: "Arial", probe: AVAILABLE });
    const terminal = mountPicker({ kind: "terminal", value: "Arial", probe: AVAILABLE });
    const ui = mountPicker({ kind: "interface", value: "Arial", probe: AVAILABLE });
    const warning = "Not a monospace font; text may misalign";

    expect(code.container.textContent).toContain(warning);
    expect(terminal.container.textContent).toContain(warning);
    expect(ui.container.textContent).not.toContain(warning);
  });

  it("does not warn for the default or an installed monospace font", () => {
    const empty = mountPicker({ kind: "code", value: "", probe: AVAILABLE });
    const menlo = mountPicker({ kind: "code", value: "Menlo", probe: AVAILABLE });

    for (const { container } of [empty, menlo]) {
      expect(container.textContent).not.toContain("fallback font");
      expect(container.textContent).not.toContain("monospace font");
    }
  });
});
