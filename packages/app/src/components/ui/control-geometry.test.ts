import { describe, expect, it } from "vitest";
import {
  buttonControlHeight,
  createControlGeometry,
  getControlInteractionPhase,
  switchGeometry,
} from "@/components/ui/control-geometry";
import type { Theme } from "@/styles/theme";

const theme = {
  borderRadius: {
    md: 6,
    lg: 8,
    xl: 12,
    full: 9999,
  },
  radius: { sm: 6, md: 8, lg: 10, xl: 14, "2xl": 18, "3xl": 22, full: 9999 },
  controlHeight: { sm: 24, md: 28, lg: 32 },
  borderWidth: {
    1: 1,
  },
  colors: {
    accent: "#20744A",
    borderAccent: "#2F3534",
    borderInput: "#d4d4d8",
  },
  fontSize: {
    xs: 10,
    sm: 12,
    base: 14,
  },
  opacity: {
    50: 0.5,
  },
  spacing: {
    0: 0,
    2: 8,
    3: 12,
    4: 16,
    6: 24,
  },
} as unknown as Theme;

describe("control geometry", () => {
  it("outlines resting fields with the input border while preserving border geometry", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.controlRest).toMatchObject({
      borderWidth: 1,
      borderColor: "#d4d4d8",
      outlineColor: "transparent",
      outlineWidth: 0,
    });
  });

  it("uses the shared hover border and active focus ring values", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.controlHover).toEqual({
      borderColor: "#2F3534",
    });
    expect(geometry.controlActive).toEqual({
      borderColor: "#2F3534",
      outlineColor: "#20744A",
      outlineOffset: 1,
      outlineStyle: "solid",
      outlineWidth: 2,
    });
  });

  it("resolves disabled, focus, open, pressed, and hover into one interaction phase", () => {
    expect(getControlInteractionPhase({ disabled: true, focused: true })).toBe("rest");
    expect(getControlInteractionPhase({ focused: true })).toBe("active");
    expect(getControlInteractionPhase({ open: true })).toBe("active");
    expect(getControlInteractionPhase({ pressed: true })).toBe("active");
    expect(getControlInteractionPhase({ hovered: true })).toBe("hover");
    expect(getControlInteractionPhase({})).toBe("rest");
  });

  it("keeps field text sizing tied to control size", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.fieldTextSm.fontSize).toBe(14);
    expect(geometry.fieldTextSm.lineHeight).toBe(20);
    expect(geometry.fieldTextMd.fontSize).toBe(14);
    expect(geometry.fieldTextMd.lineHeight).toBe(20);
    expect(geometry.formTextInputSm.fontSize).toBe(14);
    expect(geometry.formTextInputSm.lineHeight).toBe(20);
    expect(geometry.formTextInputMd.fontSize).toBe(14);
    expect(geometry.formTextInputMd.lineHeight).toBe(20);
  });

  // 紧凑布局（xs 断点，手指操作）保留触控高度；md 断点起（桌面、平板）收到 24 / 28 / 32 三档。
  it("gives buttons touch heights on compact layouts and the three dense tiers on desktop", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.buttonXs.minHeight).toEqual({ xs: 28, md: 24 });
    expect(geometry.buttonSm.minHeight).toEqual({ xs: 32, md: 28 });
    expect(geometry.buttonMd.minHeight).toEqual({ xs: 44, md: 32 });
    expect(geometry.buttonLg.minHeight).toEqual({ xs: 44, md: 32 });
    expect(buttonControlHeight).toEqual({ xs: 28, sm: 32, md: 44, lg: 44 });
  });

  it("rounds buttons from the redesign radius ladder", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.buttonXs.borderRadius).toBe(6);
    expect(geometry.buttonSm.borderRadius).toBe(8);
    expect(geometry.buttonMd.borderRadius).toBe(8);
    expect(geometry.buttonLg.borderRadius).toBe(10);
  });

  it("derives field padding from content and border without changing the control height", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.fieldControlSm.minHeight).toEqual({ xs: 32, md: 28 });
    expect(geometry.fieldControlSm.paddingVertical).toEqual({ xs: 5, md: 3 });
    expect(geometry.fieldControlMd.minHeight).toEqual({ xs: 44, md: 32 });
    expect(geometry.fieldControlMd.paddingVertical).toEqual({ xs: 11, md: 5 });
    expect(geometry.fieldControlSm.borderRadius).toBe(8);
    expect(geometry.fieldControlMd.borderRadius).toBe(8);
    expect(geometry.formTextInputSm.paddingVertical).toEqual({ xs: 5, md: 3 });
    expect(geometry.formTextInputMd.paddingVertical).toEqual({ xs: 11, md: 5 });
  });

  it("sets segments in a button-sized track, two points in, with concentric corners", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.segmentedContainerXs.minHeight).toEqual(geometry.buttonXs.minHeight);
    expect(geometry.segmentedContainerSm.minHeight).toEqual(geometry.buttonSm.minHeight);
    expect(geometry.segmentedContainerMd.minHeight).toEqual(geometry.buttonMd.minHeight);
    expect(geometry.segmentedContainerXs.padding).toBe(2);
    expect(geometry.segmentedContainerSm.padding).toBe(2);
    expect(geometry.segmentedContainerMd.padding).toBe(2);
    expect(geometry.segmentedContainerXs.borderRadius).toBe(geometry.buttonXs.borderRadius);
    expect(geometry.segmentedContainerSm.borderRadius).toBe(geometry.buttonSm.borderRadius);
    expect(geometry.segmentedContainerMd.borderRadius).toBe(geometry.buttonMd.borderRadius);
    expect(geometry.segmentedSegmentXs.minHeight).toEqual({ xs: 24, md: 20 });
    expect(geometry.segmentedSegmentSm.minHeight).toEqual({ xs: 28, md: 24 });
    expect(geometry.segmentedSegmentMd.minHeight).toEqual({ xs: 40, md: 28 });
    expect(geometry.segmentedSegmentXs.borderRadius).toBe(4);
    expect(geometry.segmentedSegmentSm.borderRadius).toBe(6);
    expect(geometry.segmentedSegmentMd.borderRadius).toBe(6);
  });

  it("keeps one label size and padding contract across buttons and segmented controls", () => {
    const geometry = createControlGeometry(theme);

    // Same size name means the same label size on every control kind.
    expect(geometry.segmentedLabelXs.fontSize).toBe(12);
    expect(geometry.segmentedLabelXs.fontSize).toBe(geometry.buttonTextXs.fontSize);
    expect(geometry.segmentedLabelSm.fontSize).toBe(14);
    expect(geometry.segmentedLabelSm.fontSize).toBe(geometry.buttonText.fontSize);
    expect(geometry.segmentedLabelMd.fontSize).toBe(geometry.buttonText.fontSize);

    // Segments sit inside a track, so they run one padding step tighter than a
    // standalone button of the same size — the gap between segments reads as the padding.
    expect(geometry.segmentedSegmentXs.paddingHorizontal).toBeLessThan(
      geometry.buttonXs.paddingHorizontal,
    );
    expect(geometry.segmentedSegmentSm.paddingHorizontal).toBeLessThan(
      geometry.buttonSm.paddingHorizontal,
    );
    expect(geometry.segmentedSegmentMd.paddingHorizontal).toBeLessThan(
      geometry.buttonMd.paddingHorizontal,
    );
  });

  it("draws the switch as a 32 × 18 track with a 14pt thumb", () => {
    expect(switchGeometry).toEqual({
      trackWidth: 32,
      trackHeight: 18,
      thumbSize: 14,
      thumbTravel: 14,
    });
  });
});
