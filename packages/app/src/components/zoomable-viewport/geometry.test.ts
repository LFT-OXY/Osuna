import { describe, expect, it } from "vitest";
import {
  FIT_TRANSFORM,
  clampTransform,
  fitContentSize,
  isActivePinchUpdate,
  isPointInsideTransformedContent,
  panContent,
  topAlignedTransform,
  zoomContentAtPoint,
} from "./geometry";

const viewport = { width: 800, height: 600 };
const fittedContent = { width: 800, height: 400 };

describe("zoomable viewport geometry", () => {
  it("rejects Android's terminal pinch update after a touch has lifted", () => {
    expect(isActivePinchUpdate(1, 2)).toBe(false);
    expect(isActivePinchUpdate(2, 2)).toBe(true);
  });

  it("fits content inside the viewport without changing its aspect ratio", () => {
    expect(fitContentSize({ width: 1600, height: 800 }, viewport)).toEqual(fittedContent);
    expect(fitContentSize({ width: 400, height: 800 }, viewport)).toEqual({
      width: 300,
      height: 600,
    });
  });

  it("fits within presentation padding and caps without shrinking the zoom viewport", () => {
    expect(
      fitContentSize({ width: 1600, height: 800 }, viewport, {
        padding: 20,
        maxWidth: 600,
        maxHeight: 500,
      }),
    ).toEqual({ width: 600, height: 300 });
  });

  it("distinguishes backdrop taps from taps on transformed content", () => {
    expect(
      isPointInsideTransformedContent({
        point: { x: 400, y: 300 },
        transform: FIT_TRANSFORM,
        fittedContent,
        viewport,
      }),
    ).toBe(true);
    expect(
      isPointInsideTransformedContent({
        point: { x: 400, y: 50 },
        transform: FIT_TRANSFORM,
        fittedContent,
        viewport,
      }),
    ).toBe(false);
    expect(
      isPointInsideTransformedContent({
        point: { x: 10, y: 10 },
        transform: { scale: 2, x: 0, y: 0 },
        fittedContent,
        viewport,
      }),
    ).toBe(true);
  });

  it("returns to the centered fit transform at the minimum scale", () => {
    expect(
      clampTransform({ scale: 0.5, x: 200, y: -200 }, fittedContent, viewport, {
        minScale: 1,
        maxScale: 8,
      }),
    ).toEqual(FIT_TRANSFORM);
  });

  it("keeps the focal content point under the cursor while zooming", () => {
    expect(
      zoomContentAtPoint({
        transform: FIT_TRANSFORM,
        scale: 2,
        focalPoint: { x: 600, y: 300 },
        fittedContent,
        viewport,
        limits: { minScale: 1, maxScale: 8 },
      }),
    ).toEqual({ scale: 2, x: -200, y: 0 });
  });

  it("clamps panning to the scaled content edges", () => {
    expect(
      panContent({
        transform: { scale: 2, x: 0, y: 0 },
        delta: { x: 900, y: -900 },
        fittedContent,
        viewport,
        limits: { minScale: 1, maxScale: 8 },
      }),
    ).toEqual({ scale: 2, x: 400, y: -100 });
  });

  it("allows Mermaid consumers to zoom below fit without inventing translation", () => {
    expect(
      clampTransform({ scale: 0.25, x: 100, y: 100 }, fittedContent, viewport, {
        minScale: 0.25,
        maxScale: 8,
      }),
    ).toEqual({ scale: 0.25, x: 0, y: 0 });
  });

  it("fits only the width when asked, never enlarging past the cap", () => {
    expect(
      fitContentSize({ width: 600, height: 1200 }, { width: 300, height: 400 }, { mode: "width" }),
    ).toEqual({ width: 300, height: 600 });
    expect(
      fitContentSize(
        { width: 200, height: 100 },
        { width: 300, height: 400 },
        { mode: "width", maxFitScale: 1 },
      ),
    ).toEqual({ width: 200, height: 100 });
  });

  it("stops shrinking at the floor and lets the wider content overflow", () => {
    expect(
      fitContentSize(
        { width: 600, height: 800 },
        { width: 300, height: 400 },
        { mode: "width", minFitScale: 0.7, maxFitScale: 1 },
      ),
    ).toEqual({ width: 420, height: 560 });
  });

  it("opens wide content at its top-left corner and narrow content centred at the top", () => {
    const limits = { minScale: 0.25, maxScale: 8 };
    const panel = { width: 300, height: 400 };

    expect(
      topAlignedTransform({ fittedContent: { width: 420, height: 560 }, viewport: panel, limits }),
    ).toEqual({ scale: 1, x: 60, y: 80 });
    expect(
      topAlignedTransform({ fittedContent: { width: 200, height: 560 }, viewport: panel, limits }),
    ).toEqual({ scale: 1, x: 0, y: 80 });
  });

  it("lets content smaller than the viewport sit anywhere inside it when asked", () => {
    const limits = { minScale: 0.25, maxScale: 8, panWithinViewport: true };
    const panel = { width: 300, height: 400 };

    // 高度只有 200 的内容贴到视口顶边，而不是被拉回正中。
    expect(
      topAlignedTransform({ fittedContent: { width: 300, height: 200 }, viewport: panel, limits }),
    ).toEqual({ scale: 1, x: 0, y: -100 });
    // 但不能拖出视口。
    expect(
      clampTransform({ scale: 1, x: 0, y: -500 }, { width: 300, height: 200 }, panel, limits),
    ).toEqual({ scale: 1, x: 0, y: -100 });
  });
});
