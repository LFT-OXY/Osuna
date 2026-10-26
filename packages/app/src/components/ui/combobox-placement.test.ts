import { describe, expect, it } from "vitest";

import { shouldFlipDesktopUp } from "./combobox-placement";

describe("shouldFlipDesktopUp", () => {
  it("opens upward when the trigger sits at the bottom edge and the list lands off screen", () => {
    // 1280×900 窗口里「固定登录到」选择框在 y=878，下方可用高度是负的。
    expect(
      shouldFlipDesktopUp({
        contentHeight: 100,
        availableBelow: -15,
        referenceTop: 878,
        collisionPadding: 16,
      }),
    ).toBe(true);
  });

  it("opens upward when the list is squeezed below and there is more room above", () => {
    expect(
      shouldFlipDesktopUp({
        contentHeight: 120,
        availableBelow: 120,
        referenceTop: 600,
        collisionPadding: 16,
      }),
    ).toBe(true);
  });

  it("stays below when the whole list fits below", () => {
    expect(
      shouldFlipDesktopUp({
        contentHeight: 100,
        availableBelow: 300,
        referenceTop: 500,
        collisionPadding: 16,
      }),
    ).toBe(false);
  });

  it("stays below when the list is squeezed but there is even less room above", () => {
    expect(
      shouldFlipDesktopUp({
        contentHeight: 200,
        availableBelow: 200,
        referenceTop: 120,
        collisionPadding: 16,
      }),
    ).toBe(false);
  });
});
