import { describe, expect, it } from "vitest";
import { isUsageTrackedProvider, usageBackendLabel, usageSourceLabel } from "./sources";

describe("isUsageTrackedProvider", () => {
  it("names the four CLIs whose logs the scanner reads", () => {
    expect(["claude", "codex", "pi", "omp"].map(isUsageTrackedProvider)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("leaves out every provider that produces no usage rows", () => {
    expect(["opencode", "copilot", "kiro", "zai", ""].map(isUsageTrackedProvider)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(isUsageTrackedProvider(null)).toBe(false);
    expect(isUsageTrackedProvider(undefined)).toBe(false);
  });
});

describe("usageSourceLabel", () => {
  it("names the CLI, and the backend when there is one", () => {
    expect([
      usageSourceLabel({ cli: "claude", backend: null }),
      usageSourceLabel({ cli: "pi", backend: "anthropic" }),
      usageSourceLabel({ cli: "omp", backend: "3oxy-openai" }),
    ]).toEqual(["Claude Code", "Pi · Anthropic", "OMP · 3oxy-openai"]);
  });
});

describe("usageBackendLabel", () => {
  it("spells a known vendor its own way and capitalises anything else", () => {
    expect([
      usageBackendLabel("openai"),
      usageBackendLabel("xai"),
      usageBackendLabel("homelab"),
    ]).toEqual(["OpenAI", "xAI", "Homelab"]);
  });
});
