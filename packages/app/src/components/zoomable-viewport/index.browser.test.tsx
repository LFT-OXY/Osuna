import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Pressable, Text, View } from "react-native";
import { cdp, page, userEvent } from "@vitest/browser/context";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewportRect } from "./geometry";
import { ZoomableViewport } from "./index";

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

beforeAll(async () => {
  await page.viewport(1280, 900);
});

const CONTENT_SIZE = { width: 400, height: 1200 };
const FIT_WIDTH = { mode: "width", maxFitScale: 1 } as const;
const CONTENT_STYLE = { width: CONTENT_SIZE.width, height: CONTENT_SIZE.height };
const BUTTON_STYLE = { width: 160, height: 80 };

const mounted: { root: Root; container: HTMLElement }[] = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

/** 400×1200 的内容放在 200×300 的视口里，左上角有一个可点的东西。 */
function mountViewport(onPress: () => void): void {
  const container = document.createElement("div");
  container.style.cssText =
    "position: absolute; top: 100px; left: 100px; width: 200px; height: 300px; display: flex;";
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ZoomableViewport
        contentSize={CONTENT_SIZE}
        fit={FIT_WIDTH}
        initialPosition="top"
        renderAtContentSize
        panWithinViewport
        controls="zoom-bar"
        testID="viewport"
      >
        <View style={CONTENT_STYLE}>
          <Pressable
            onPress={onPress}
            style={BUTTON_STYLE}
            accessibilityRole="button"
            testID="content-button"
          >
            <Text>Open</Text>
          </Pressable>
        </View>
      </ZoomableViewport>,
    ),
  );
  mounted.push({ root, container });
}

function contentButton(): DOMRect {
  const element = document.querySelector('[data-testid="content-button"]');
  if (!(element instanceof HTMLElement)) throw new Error("content button did not render");
  return element.getBoundingClientRect();
}

/** 等视口量好尺寸、内容按宽度缩到一半。 */
async function fitted(): Promise<void> {
  await expect.poll(() => contentButton().width).toBe(80);
}

/** 测试页在 iframe 里、可能被缩放；CDP 的坐标是外层页面的，换算一下。 */
function toScreen(x: number, y: number): { x: number; y: number } {
  const frame = window.frameElement?.getBoundingClientRect();
  if (!frame) return { x, y };
  const scale = frame.width / window.innerWidth;
  return { x: frame.left + x * scale, y: frame.top + y * scale };
}

async function mouse(
  type: "mouseMoved" | "mousePressed" | "mouseReleased",
  x: number,
  y: number,
  buttons: 0 | 1 = 0,
): Promise<void> {
  const pressed = type === "mousePressed" || type === "mouseReleased";
  await cdp().send("Input.dispatchMouseEvent", {
    type,
    ...toScreen(x, y),
    ...(pressed ? { button: "left", clickCount: 1 } : {}),
    ...(buttons ? { button: "left", buttons } : {}),
  });
}

async function drag(from: { x: number; y: number }, by: { x: number; y: number }) {
  await mouse("mouseMoved", from.x, from.y);
  await mouse("mousePressed", from.x, from.y);
  for (const step of [0.25, 0.5, 1]) {
    await mouse("mouseMoved", from.x + by.x * step, from.y + by.y * step, 1);
  }
  await mouse("mouseReleased", from.x + by.x, from.y + by.y);
}

describe("ZoomableViewport on the web", () => {
  it("lets a click reach something pressable inside the content", async () => {
    const onPress = vi.fn();
    mountViewport(onPress);
    await fitted();

    await userEvent.click(page.getByTestId("content-button"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("pans instead of pressing when a drag starts on something pressable", async () => {
    const onPress = vi.fn();
    mountViewport(onPress);
    await fitted();
    const before = contentButton();

    await drag({ x: before.left + 20, y: before.top + 20 }, { x: 0, y: -40 });

    await expect.poll(() => contentButton().top).toBe(before.top - 40);
    expect(contentButton().width).toBe(before.width);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("forgets a press released outside the viewport before it became a drag", async () => {
    mountViewport(vi.fn());
    await fitted();
    const before = contentButton();
    const viewport = document
      .querySelector('[data-testid="viewport-canvas"]')!
      .getBoundingClientRect();

    // 在视口右缘按下，一步移出视口再松开：视口既收不到移动也收不到抬起。
    const edge = { x: viewport.right - 2, y: viewport.top + 150 };
    await mouse("mouseMoved", edge.x, edge.y);
    await mouse("mousePressed", edge.x, edge.y);
    await mouse("mouseMoved", edge.x + 60, edge.y, 1);
    await mouse("mouseReleased", edge.x + 60, edge.y);

    // 不按键移回视口里，内容不该跟着走。
    await mouse("mouseMoved", edge.x - 40, edge.y - 40);
    await mouse("mouseMoved", edge.x - 60, edge.y - 80);
    expect(contentButton().top).toBe(before.top);

    // 下一次拖动是普通的单指平移，不是缩放。
    await drag({ x: viewport.left + 100, y: viewport.top + 200 }, { x: 0, y: -50 });
    await expect.poll(() => contentButton().top).toBe(before.top - 50);
    expect(contentButton().width).toBe(before.width);
  });
});

const MARKER_STYLE = { position: "absolute", left: 40, top: 1000, width: 160, height: 80 } as const;

/** 同样的视口，内容里 y=1000 处有一个标记；返回的函数换一块要保持可见的区域重新渲染。 */
function mountWithReveal(): (rect: ViewportRect | null) => void {
  const container = document.createElement("div");
  container.style.cssText =
    "position: absolute; top: 100px; left: 100px; width: 200px; height: 300px; display: flex;";
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (rect: ViewportRect | null) =>
    act(() =>
      root.render(
        <ZoomableViewport
          contentSize={CONTENT_SIZE}
          fit={FIT_WIDTH}
          initialPosition="top"
          renderAtContentSize
          panWithinViewport
          controls="zoom-bar"
          revealRect={rect}
          testID="viewport"
        >
          <View style={CONTENT_STYLE}>
            <View style={MARKER_STYLE} testID="marker" />
          </View>
        </ZoomableViewport>,
      ),
    );
  render(null);
  mounted.push({ root, container });
  return render;
}

function marker(): DOMRect {
  const element = document.querySelector('[data-testid="marker"]');
  if (!(element instanceof HTMLElement)) throw new Error("marker did not render");
  return element.getBoundingClientRect();
}

function markerWidth(): number {
  return marker().width;
}

function markerInView(): boolean {
  const box = marker();
  return box.top >= 100 && box.bottom <= 400 && box.left >= 100 && box.right <= 300;
}

describe("ZoomableViewport with a part to keep in view", () => {
  it("pans an out-of-view part into view and leaves it be once it is visible", async () => {
    const reveal = mountWithReveal();
    // 按宽度缩到一半：内容 y=1000 的标记在视口下面。
    await expect.poll(markerWidth).toBe(80);
    expect(markerInView()).toBe(false);

    reveal({ x: 40, y: 1000, width: 160, height: 80 });
    await expect.poll(markerInView).toBe(true);

    const shown = marker();
    reveal({ x: 40, y: 1020, width: 160, height: 40 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(marker().top).toBe(shown.top);
  });
});
