import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { cdp } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import { StatusRing } from "./index";
import { STATUS_RING_PERIOD_MS, STATUS_RING_STEPS } from "./geometry";

interface MountedRing {
  root: Root;
  container: HTMLDivElement;
}

const mounted: MountedRing[] = [];

async function emulateReducedMotion(value: "reduce" | "no-preference"): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value }],
  });
}

function mountRing(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<StatusRing />));
  mounted.push({ root, container });
  return container;
}

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  await emulateReducedMotion("no-preference");
});

describe("StatusRing", () => {
  it("turns in low-frequency steps", async () => {
    await emulateReducedMotion("no-preference");
    const container = mountRing();

    const animations = container.getAnimations({ subtree: true });
    expect(animations).toHaveLength(1);
    const timing = animations[0]!.effect!.getTiming();
    expect(timing.duration).toBe(STATUS_RING_PERIOD_MS);
    expect(timing.easing).toBe(`steps(${STATUS_RING_STEPS})`);
  });

  it("holds still when the system asks for reduced motion", async () => {
    await emulateReducedMotion("reduce");
    const container = mountRing();

    expect(container.getAnimations({ subtree: true })).toHaveLength(0);
  });

  it("stops and resumes when the reduced-motion preference changes while mounted", async () => {
    await emulateReducedMotion("no-preference");
    const container = mountRing();
    expect(container.getAnimations({ subtree: true })).toHaveLength(1);

    await emulateReducedMotion("reduce");
    await expect.poll(() => container.getAnimations({ subtree: true }).length).toBe(0);

    await emulateReducedMotion("no-preference");
    await expect.poll(() => container.getAnimations({ subtree: true }).length).toBe(1);
  });
});
