import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Text, type TextColor, type TextWeight } from "./text";
import type { TextVariant } from "@/styles/theme";

interface MountedText {
  root: Root;
  container: HTMLDivElement;
}

const mounted: MountedText[] = [];

function mountText(props: {
  variant?: TextVariant;
  color?: TextColor;
  weight?: TextWeight;
}): CSSStyleDeclaration {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => root.render(<Text {...props}>Workspace</Text>));
  mounted.push({ root, container });

  const element = container.firstElementChild;
  if (!(element instanceof HTMLElement)) {
    throw new Error("Text did not render an element");
  }
  return getComputedStyle(element);
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

describe("Text", () => {
  // 取值来自测试主题的 typeScale（14px 界面字号下的原值）。
  it.each([
    ["micro", "11px", "15px"],
    ["caption", "12px", "16px"],
    ["label", "13px", "18px"],
    ["body", "14px", "20px"],
    ["body-lg", "15px", "22px"],
    ["title-sm", "16px", "24px"],
    ["title", "18px", "28px"],
    ["title-lg", "20px", "28px"],
    ["display", "24px", "32px"],
    ["prose", "14px", "22px"],
  ] as const)("renders the %s variant at its size and line height", (variant, size, leading) => {
    const style = mountText({ variant });

    expect(style.fontSize).toBe(size);
    expect(style.lineHeight).toBe(leading);
  });

  it("defaults to the body variant in the primary text color at normal weight", () => {
    const style = mountText({});

    expect(style.fontSize).toBe("14px");
    expect(style.lineHeight).toBe("20px");
    expect(style.color).toBe("rgb(17, 17, 17)");
    expect(style.fontWeight).toBe("400");
  });

  it.each([
    ["foreground", "rgb(17, 17, 17)"],
    ["foregroundMuted", "rgb(102, 102, 102)"],
    ["foregroundExtraMuted", "rgb(161, 161, 170)"],
    ["statusSuccess", "rgb(21, 128, 61)"],
    ["statusDanger", "rgb(185, 28, 28)"],
    ["statusWarning", "rgb(217, 119, 6)"],
    ["statusMerged", "rgb(124, 58, 237)"],
    ["accentBright", "rgb(49, 96, 219)"],
  ] as const)("paints the %s color", (color, expected) => {
    expect(mountText({ color }).color).toBe(expected);
  });

  it.each([
    ["normal", "400"],
    ["medium", "500"],
    ["semibold", "600"],
  ] as const)("renders the %s weight", (weight, expected) => {
    expect(mountText({ weight }).fontWeight).toBe(expected);
  });
});
