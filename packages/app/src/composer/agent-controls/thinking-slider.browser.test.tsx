import React, { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { cdp, userEvent } from "@vitest/browser/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThinkingSlider, type ThinkingSliderOption } from "./thinking-slider";

const OPTIONS: ThinkingSliderOption[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
];

// 应用源码在 Vitest 下按经典 JSX 运行时编译，需要全局的 React。
beforeEach(() => vi.stubGlobal("React", React));

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

async function emulateReducedMotion(value: "reduce" | "no-preference"): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value }],
  });
}

// 受控用法：选中后父级把新 id 传回来，和 Composer 里一样。
function Harness({
  initialId,
  disabled,
  onSelect,
}: {
  initialId: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(initialId);
  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      setSelectedId(id);
    },
    [onSelect],
  );
  return (
    <ThinkingSlider
      options={OPTIONS}
      selectedId={selectedId}
      provider="pi"
      disabled={disabled}
      onSelect={handleSelect}
    />
  );
}

function mountSlider({
  initialId = "low",
  disabled = false,
}: { initialId?: string; disabled?: boolean } = {}) {
  const onSelect = vi.fn<(id: string) => void>();
  const container = document.createElement("div");
  container.style.width = "240px";
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Harness initialId={initialId} disabled={disabled} onSelect={onSelect} />));
  mounted.push({ root, container });

  const track = container.querySelector<HTMLElement>('[data-testid="agent-thinking-slider-track"]');
  const value = container.querySelector<HTMLElement>('[data-testid="agent-thinking-slider-value"]');
  if (!track || !value) throw new Error("ThinkingSlider did not render its track and value");
  return { container, track, value, onSelect };
}

type MouseEventType = "mousePressed" | "mouseMoved" | "mouseReleased";

// 真实的鼠标输入（CDP），Gesture Handler 收到的是和用户操作一样的 pointer 事件。
// 坐标要换算到顶层页面：测试跑在 iframe 里，iframe 可能被缩放。
async function mouse(track: HTMLElement, type: MouseEventType, fraction: number): Promise<void> {
  const rect = track.getBoundingClientRect();
  const frame = window.frameElement?.getBoundingClientRect();
  const scale = frame ? frame.width / window.innerWidth : 1;
  await cdp().send("Input.dispatchMouseEvent", {
    type,
    x: (frame?.left ?? 0) + (rect.left + rect.width * fraction) * scale,
    y: (frame?.top ?? 0) + (rect.top + rect.height / 2) * scale,
    button: "left",
    buttons: type === "mouseReleased" ? 0 : 1,
    clickCount: 1,
  });
}

function particleCount(container: HTMLElement): number {
  return container.querySelectorAll('[data-testid="thinking-slider-particle"]').length;
}

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  await emulateReducedMotion("no-preference");
});

describe("ThinkingSlider", () => {
  it("shows the selected option's name above an adjustable track", () => {
    const { track, value } = mountSlider({ initialId: "high" });

    expect(value.textContent).toBe("High");
    expect(track.getAttribute("role")).toBe("slider");
    expect(track.getAttribute("aria-valuetext")).toBe("High");
    expect(track.getAttribute("aria-valuenow")).toBe("2");
  });

  it("selects the nearest stop as soon as the track is clicked", async () => {
    const { track, value, onSelect } = mountSlider();

    const { width, height } = track.getBoundingClientRect();
    await userEvent.click(track, { position: { x: width * 0.7, y: height / 2 } });

    await expect.poll(() => onSelect.mock.calls).toEqual([["high"]]);
    expect(value.textContent).toBe("High");
  });

  it("previews the snapped stop while dragging and selects only on release", async () => {
    const { track, value, onSelect } = mountSlider();

    await mouse(track, "mouseMoved", 0.05);
    await mouse(track, "mousePressed", 0.05);
    await mouse(track, "mouseMoved", 0.2);
    await mouse(track, "mouseMoved", 0.45);
    await mouse(track, "mouseMoved", 0.72);

    await expect.poll(() => value.textContent).toBe("High");
    expect(onSelect).not.toHaveBeenCalled();

    await mouse(track, "mouseMoved", 0.97);
    await expect.poll(() => value.textContent).toBe("Extra high");
    expect(onSelect).not.toHaveBeenCalled();

    await mouse(track, "mouseReleased", 0.97);
    await expect.poll(() => onSelect.mock.calls).toEqual([["xhigh"]]);
  });

  it("steps one stop per arrow key and selects each step", async () => {
    const { track, value, onSelect } = mountSlider({ initialId: "medium" });

    act(() => track.focus());
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowLeft}");

    await expect.poll(() => onSelect.mock.calls).toEqual([["high"], ["xhigh"], ["high"]]);
    expect(value.textContent).toBe("High");
  });

  it("holds a committed stop until the parent confirms, then follows the new model", async () => {
    // 运行中的 Agent：选中要等 daemon 回写，父级在那之前一直传旧的 id。
    const onSelect = vi.fn<(id: string) => void>();
    const container = document.createElement("div");
    container.style.width = "240px";
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = (options: ThinkingSliderOption[], selectedId: string) =>
      act(() =>
        root.render(
          <ThinkingSlider
            options={options}
            selectedId={selectedId}
            provider="pi"
            disabled={false}
            onSelect={onSelect}
          />,
        ),
      );
    render(OPTIONS, "low");
    mounted.push({ root, container });
    const track = container.querySelector<HTMLElement>(
      '[data-testid="agent-thinking-slider-track"]',
    )!;
    const value = container.querySelector<HTMLElement>(
      '[data-testid="agent-thinking-slider-value"]',
    )!;

    act(() => track.focus());
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => onSelect.mock.calls).toEqual([["medium"]]);
    expect(value.textContent).toBe("Medium");

    // 回写前退回原档：这一步也要提交，否则最终生效的仍是 medium。
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(() => onSelect.mock.calls).toEqual([["medium"], ["low"]]);
    expect(value.textContent).toBe("Low");
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => onSelect.mock.calls).toEqual([["medium"], ["low"], ["medium"]]);

    // 换到另一个模型，选中 id 碰巧没变：待定的 medium 不在新模型里，显示回到父级给的选中。
    render(
      [
        { id: "low", label: "Low" },
        { id: "max", label: "Max" },
      ],
      "low",
    );
    await expect.poll(() => value.textContent).toBe("Low");
  });

  it("ignores clicks, drags, and keys while disabled", async () => {
    const { track, value, onSelect } = mountSlider({ disabled: true });

    const { width, height } = track.getBoundingClientRect();
    // aria-disabled 让 Playwright 认为元素不可点；强制点击才能证明是滑条自己忽略了它。
    await userEvent.click(track, { position: { x: width * 0.95, y: height / 2 }, force: true });
    await mouse(track, "mouseMoved", 0.05);
    await mouse(track, "mousePressed", 0.05);
    await mouse(track, "mouseMoved", 0.6);
    await mouse(track, "mouseReleased", 0.6);
    act(() => track.focus());
    await userEvent.keyboard("{ArrowRight}");

    expect(onSelect).not.toHaveBeenCalled();
    expect(value.textContent).toBe("Low");
    expect(track.getAttribute("aria-disabled")).toBe("true");
  });

  it("streams particles through the fill, more of them at higher stops", () => {
    const low = mountSlider({ initialId: "low" });
    const high = mountSlider({ initialId: "xhigh" });

    expect(particleCount(low.container)).toBeGreaterThan(0);
    expect(particleCount(high.container)).toBeGreaterThan(particleCount(low.container));
  });

  it("draws no particles when the system asks for reduced motion", async () => {
    await emulateReducedMotion("reduce");
    const { container } = mountSlider({ initialId: "xhigh" });

    expect(particleCount(container)).toBe(0);
  });

  it("follows a reduced-motion change while mounted", async () => {
    const { container } = mountSlider({ initialId: "high" });
    expect(particleCount(container)).toBeGreaterThan(0);

    await emulateReducedMotion("reduce");
    await expect.poll(() => particleCount(container)).toBe(0);

    await emulateReducedMotion("no-preference");
    await expect.poll(() => particleCount(container)).toBeGreaterThan(0);
  });
});
