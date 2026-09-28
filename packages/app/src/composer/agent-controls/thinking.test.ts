import { describe, expect, it } from "vitest";
import { mixHexColor } from "@/utils/color";
import {
  THINKING_BRAND_TINT,
  resolveThinkingControlState,
  resolveThinkingGradient,
  resolveThinkingParticleIntensity,
  resolveThinkingParticleLayout,
  resolveThinkingParticles,
  resolveThinkingStopPositions,
  snapThinkingPosition,
  stepThinkingIndex,
} from "./thinking";

describe("resolveThinkingControlState", () => {
  it("hides the control without options, locks a single option, and slides two or more", () => {
    expect([0, 1, 2, 7, 12].map(resolveThinkingControlState)).toEqual([
      "hidden",
      "locked",
      "slider",
      "slider",
      "slider",
    ]);
  });
});

describe("resolveThinkingStopPositions", () => {
  it("spreads the stops evenly from the start to the end of the track", () => {
    expect(resolveThinkingStopPositions(2)).toEqual([0, 1]);
    expect(resolveThinkingStopPositions(3)).toEqual([0, 0.5, 1]);
    expect(resolveThinkingStopPositions(5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("puts a single option at the start", () => {
    expect(resolveThinkingStopPositions(1)).toEqual([0]);
  });
});

describe("snapThinkingPosition", () => {
  it("snaps to the nearest stop", () => {
    expect(snapThinkingPosition(0.1, 4)).toBe(0);
    expect(snapThinkingPosition(0.3, 4)).toBe(1);
    expect(snapThinkingPosition(0.62, 4)).toBe(2);
    expect(snapThinkingPosition(0.9, 4)).toBe(3);
  });

  it("clamps positions past either end of the track", () => {
    expect(snapThinkingPosition(-0.4, 4)).toBe(0);
    expect(snapThinkingPosition(1.7, 4)).toBe(3);
  });

  it("lands exactly on the ends", () => {
    expect(snapThinkingPosition(0, 3)).toBe(0);
    expect(snapThinkingPosition(1, 3)).toBe(2);
  });

  it("rounds a midpoint between two stops up to the higher one", () => {
    expect(snapThinkingPosition(0.5, 2)).toBe(1);
    expect(snapThinkingPosition(0.25, 3)).toBe(1);
  });

  it("always picks the only stop of a single option", () => {
    expect(snapThinkingPosition(0.8, 1)).toBe(0);
  });
});

describe("stepThinkingIndex", () => {
  it("moves one stop and stops at either end", () => {
    expect(stepThinkingIndex(1, 1, 4)).toBe(2);
    expect(stepThinkingIndex(1, -1, 4)).toBe(0);
    expect(stepThinkingIndex(3, 1, 4)).toBe(3);
    expect(stepThinkingIndex(0, -1, 4)).toBe(0);
  });
});

describe("resolveThinkingParticleIntensity", () => {
  it("rises linearly from the lowest stop to the highest", () => {
    expect([0, 1, 2, 3, 4].map((index) => resolveThinkingParticleIntensity(index, 5))).toEqual([
      0, 0.25, 0.5, 0.75, 1,
    ]);
  });

  it("clamps an index outside the options", () => {
    expect(resolveThinkingParticleIntensity(-1, 3)).toBe(0);
    expect(resolveThinkingParticleIntensity(9, 3)).toBe(1);
  });
});

describe("resolveThinkingParticles", () => {
  it("sends more particles, faster, as intensity rises", () => {
    const levels = [0, 0.25, 0.5, 0.75, 1].map(resolveThinkingParticles);
    for (let index = 1; index < levels.length; index += 1) {
      const previous = levels[index - 1]!;
      const current = levels[index]!;
      expect(current.count).toBeGreaterThan(previous.count);
      expect(current.travelMs).toBeLessThan(previous.travelMs);
    }
  });

  it("keeps a few particles flowing at the lowest stop", () => {
    expect(resolveThinkingParticles(0).count).toBeGreaterThan(0);
  });
});

describe("resolveThinkingParticleLayout", () => {
  it("starts particles at different heights inside the fill and staggers them across the cycle", () => {
    const layouts = Array.from({ length: 8 }, (_, index) => resolveThinkingParticleLayout(index));
    for (const layout of layouts) {
      expect(layout.top).toBeGreaterThan(0);
      expect(layout.top).toBeLessThan(1);
      expect(layout.phase).toBeGreaterThanOrEqual(0);
      expect(layout.phase).toBeLessThan(1);
    }
    expect(new Set(layouts.map((layout) => layout.top)).size).toBe(layouts.length);
    expect(new Set(layouts.map((layout) => layout.phase)).size).toBe(layouts.length);
  });
});

describe("resolveThinkingGradient", () => {
  const fallback = { from: "#60a5fa", to: "#a855f7" };

  it("runs from a light tint of the brand color to the brand color", () => {
    expect(resolveThinkingGradient("#d97757", fallback)).toEqual({
      from: mixHexColor("#d97757", "#ffffff", THINKING_BRAND_TINT),
      to: "#d97757",
    });
  });

  it("uses the fallback gradient when the provider has no brand color", () => {
    expect(resolveThinkingGradient(null, fallback)).toEqual(fallback);
  });
});
