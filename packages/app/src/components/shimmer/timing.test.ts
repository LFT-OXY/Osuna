import { describe, expect, it } from "vitest";
import { quantizeShimmerProgress, shimmerSteps } from "./timing";

describe("shimmerSteps", () => {
  it("advances ten frames per second instead of every display frame", () => {
    expect(shimmerSteps(2.4)).toBe(24);
    expect(shimmerSteps(1.25)).toBe(13);
  });

  it("never drops below one step", () => {
    expect(shimmerSteps(0)).toBe(1);
  });
});

describe("quantizeShimmerProgress", () => {
  it("holds each step until the next one starts", () => {
    expect(quantizeShimmerProgress(0, 4)).toBe(0);
    expect(quantizeShimmerProgress(0.24, 4)).toBe(0);
    expect(quantizeShimmerProgress(0.25, 4)).toBe(0.25);
    expect(quantizeShimmerProgress(0.99, 4)).toBe(0.75);
  });
});
