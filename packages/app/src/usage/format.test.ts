import { describe, expect, it } from "vitest";
import {
  formatUsageCost,
  formatUsageShare,
  formatUsageTokensCompact,
  formatGroupedNumber,
} from "./format";
import { totalUsageTokens, usageSourceKey } from "./totals";
import { usageBackendLabel, usageSourceColor, usageSourceLabel } from "./sources";

describe("formatGroupedNumber", () => {
  it("groups digits by the UI language", () => {
    expect(formatGroupedNumber(1234567, "en")).toBe("1,234,567");
    expect(formatGroupedNumber(1234567, "de")).toBe("1.234.567");
  });

  it("rounds to whole tokens", () => {
    expect(formatGroupedNumber(1234.6, "en")).toBe("1,235");
  });
});

describe("formatUsageTokensCompact", () => {
  it("keeps one decimal at every magnitude", () => {
    expect(formatUsageTokensCompact(999)).toBe("999");
    expect(formatUsageTokensCompact(1200)).toBe("1.2K");
    expect(formatUsageTokensCompact(3_450_000)).toBe("3.5M");
    expect(formatUsageTokensCompact(5_600_000_000)).toBe("5.6B");
  });

  it("keeps the sign", () => {
    expect(formatUsageTokensCompact(-1500)).toBe("-1.5K");
  });
});

describe("formatUsageCost", () => {
  it("always shows two decimals", () => {
    expect(formatUsageCost(0)).toBe("$0.00");
    expect(formatUsageCost(0.174)).toBe("$0.17");
    expect(formatUsageCost(1234.5)).toBe("$1234.50");
  });
});

describe("formatUsageShare", () => {
  it("formats a share as a two-decimal percent", () => {
    expect(formatUsageShare(0.5234, "en")).toBe("52.34%");
    expect(formatUsageShare(1, "en")).toBe("100.00%");
  });

  it("marks a share too small to show", () => {
    expect(formatUsageShare(0.00001, "en")).toBe("<0.01%");
    expect(formatUsageShare(0, "en")).toBe("0.00%");
  });
});

describe("totals", () => {
  it("leaves reasoning out of the token total", () => {
    expect(
      totalUsageTokens({ input: 1, cachedInput: 2, cacheWrite: 4, output: 8, reasoning: 3 }),
    ).toBe(15);
  });

  it("keys a source by cli and backend", () => {
    expect(usageSourceKey({ cli: "claude", backend: null })).toBe("claude");
    expect(usageSourceKey({ cli: "pi", backend: "anthropic" })).toBe("pi:anthropic");
  });
});

describe("source labels and colours", () => {
  it("names a CLI and its backend", () => {
    expect(usageSourceLabel({ cli: "claude", backend: null })).toBe("Claude Code");
    expect(usageSourceLabel({ cli: "pi", backend: "anthropic" })).toBe("Pi · Anthropic");
    expect(usageSourceLabel({ cli: "omp", backend: "github" })).toBe("OMP · GitHub Copilot");
  });

  it("capitalises a backend the user named themselves", () => {
    expect(usageBackendLabel("3oxy-openai")).toBe("3oxy-openai");
    expect(usageBackendLabel("homelab")).toBe("Homelab");
  });

  it("gives one backend the same colour under both CLIs", () => {
    expect(usageSourceColor({ cli: "pi", backend: "openai" })).toBe(
      usageSourceColor({ cli: "omp", backend: "openai" }),
    );
  });

  it("gives Claude Code and Codex their brand colours", () => {
    expect(usageSourceColor({ cli: "claude", backend: null })).toBe("#d97757");
    expect(usageSourceColor({ cli: "codex", backend: null })).toBe("#3b82f6");
  });

  it("gives an unknown backend a stable fallback hue", () => {
    expect(usageSourceColor({ cli: "omp", backend: "homelab" })).toBe(
      usageSourceColor({ cli: "omp", backend: "homelab" }),
    );
    expect(usageSourceColor({ cli: "omp", backend: "homelab" })).not.toBe(
      usageSourceColor({ cli: "omp", backend: "other" }),
    );
  });
});
