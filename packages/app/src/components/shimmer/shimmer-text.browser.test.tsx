import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { cdp } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import { ShimmerText } from "./shimmer-text";
import { shimmerSteps, WORKING_SHIMMER_DURATION_SECONDS } from "./timing";

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

function mountShimmer(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ShimmerText text="Working for 12s" testID="shimmer-label" />));
  mounted.push({ root, container });
  return container;
}

function onlyAnimation(container: HTMLElement): Animation {
  const animations = container.getAnimations({ subtree: true });
  expect(animations).toHaveLength(1);
  const [animation] = animations;
  if (!animation) throw new Error("Expected one running shimmer");
  return animation;
}

function animationTarget(animation: Animation): Element {
  const { effect } = animation;
  if (!(effect instanceof KeyframeEffect) || !(effect.target instanceof Element)) {
    throw new Error("Expected a keyframe effect on an element");
  }
  return effect.target;
}

function latestRoot(): Root {
  const entry = mounted.at(-1);
  if (!entry) throw new Error("Expected a mounted shimmer");
  return entry.root;
}

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  await emulateReducedMotion("no-preference");
});

describe("ShimmerText", () => {
  it("sweeps in low-frequency steps while on screen", async () => {
    await emulateReducedMotion("no-preference");
    const container = mountShimmer();

    const animation = onlyAnimation(container);
    expect(animation.effect?.getTiming().duration).toBe(WORKING_SHIMMER_DURATION_SECONDS * 1000);
    // CSS 动画的 timing function 落在关键帧上，effect 自身的 easing 恒为 linear。
    expect(getComputedStyle(animationTarget(animation)).animationTimingFunction).toBe(
      `steps(${shimmerSteps(WORKING_SHIMMER_DURATION_SECONDS)})`,
    );
    await expect.poll(() => onlyAnimation(container).playState).toBe("running");
  });

  it("keeps sweeping while the label text changes every tick", async () => {
    await emulateReducedMotion("no-preference");
    const container = mountShimmer();
    await expect.poll(() => onlyAnimation(container).playState).toBe("running");

    const root = latestRoot();
    act(() => root.render(<ShimmerText text="Working for 13s" testID="shimmer-label" />));
    act(() => root.render(<ShimmerText text="Working for 14s" testID="shimmer-label" />));

    await expect.poll(() => onlyAnimation(container).playState).toBe("running");
  });

  it("pauses once scrolled out of view and resumes when it comes back", async () => {
    await emulateReducedMotion("no-preference");
    const container = mountShimmer();
    await expect.poll(() => onlyAnimation(container).playState).toBe("running");

    container.style.transform = "translateY(200vh)";
    await expect.poll(() => onlyAnimation(container).playState).toBe("paused");

    container.style.transform = "";
    await expect.poll(() => onlyAnimation(container).playState).toBe("running");
  });

  it("drops the sweep and keeps the label when the system asks for reduced motion", async () => {
    await emulateReducedMotion("reduce");
    const container = mountShimmer();

    expect(container.getAnimations({ subtree: true })).toHaveLength(0);
    expect(container.querySelector('[data-testid="shimmer-label"]')?.textContent).toBe(
      "Working for 12s",
    );
  });

  it("stops and restarts when the reduced-motion preference changes while mounted", async () => {
    await emulateReducedMotion("no-preference");
    const container = mountShimmer();
    expect(container.getAnimations({ subtree: true })).toHaveLength(1);

    await emulateReducedMotion("reduce");
    await expect.poll(() => container.getAnimations({ subtree: true }).length).toBe(0);

    await emulateReducedMotion("no-preference");
    await expect.poll(() => container.getAnimations({ subtree: true }).length).toBe(1);
  });
});
