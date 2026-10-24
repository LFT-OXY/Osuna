import { describe, expect, it } from "vitest";
import {
  formatGroupedTokens,
  formatSessionCost,
  formatTokenArrows,
  formatUsageCost,
  formatUsageShare,
  formatUsageTokens,
  formatUsageTokensCompact,
  formatGroupedNumber,
  USD_MONEY,
} from "./format";

const CNY_AT_7_12 = { currency: "cny", cnyPerUsd: 7.12 } as const;
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

describe("formatUsageTokens in 万 / 亿", () => {
  it("writes 万 with one decimal and 亿 with two, dropping trailing zeros", () => {
    expect(formatUsageTokens(9_999, "wanYi")).toBe("9999");
    expect(formatUsageTokens(12_000, "wanYi")).toBe("1.2 万");
    expect(formatUsageTokens(50_000, "wanYi")).toBe("5 万");
    expect(formatUsageTokens(681_234, "wanYi")).toBe("68.1 万");
    expect(formatUsageTokens(80_000_000, "wanYi")).toBe("8000 万");
    expect(formatUsageTokens(340_000_000, "wanYi")).toBe("3.4 亿");
    expect(formatUsageTokens(133_456_789, "wanYi")).toBe("1.33 亿");
    expect(formatUsageTokens(1_540_000_000, "wanYi")).toBe("15.4 亿");
  });

  it("keeps K / M / B otherwise", () => {
    expect(formatUsageTokens(12_000, "kmb")).toBe("12.0K");
    expect(formatUsageTokens(340_000_000, "kmb")).toBe("340.0M");
  });
});

describe("formatGroupedTokens", () => {
  it("groups digits in K / M / B and abbreviates in 万 / 亿", () => {
    expect(formatGroupedTokens({ value: 1_234_567, locale: "zh-CN", units: "kmb" })).toBe(
      "1,234,567",
    );
    expect(formatGroupedTokens({ value: 1_234_567, locale: "zh-CN", units: "wanYi" })).toBe(
      "123.5 万",
    );
  });
});

describe("formatUsageCost", () => {
  it("always shows two decimals", () => {
    expect(formatUsageCost(0, USD_MONEY)).toBe("$0.00");
    expect(formatUsageCost(0.174, USD_MONEY)).toBe("$0.17");
    expect(formatUsageCost(1234.5, USD_MONEY)).toBe("$1234.50");
  });

  it("converts to yuan at the rate", () => {
    expect(formatUsageCost(10, CNY_AT_7_12)).toBe("¥71.20");
    expect(formatUsageCost(0, CNY_AT_7_12)).toBe("¥0.00");
  });
});

describe("formatTokenArrows", () => {
  it("reads as uncached input in, output out", () => {
    expect(formatTokenArrows({ input: 14_300, output: 4_600, units: "kmb" })).toBe("↑14.3K ↓4.6K");
    expect(formatTokenArrows({ input: 0, output: 0, units: "kmb" })).toBe("↑0 ↓0");
  });

  it("uses 万 / 亿 when asked", () => {
    expect(formatTokenArrows({ input: 143_000, output: 4_600, units: "wanYi" })).toBe(
      "↑14.3 万 ↓4600",
    );
  });
});

describe("formatSessionCost", () => {
  it("keeps four decimals under a cent so a real cost is never $0.00", () => {
    expect(formatSessionCost(0.0004, USD_MONEY)).toBe("$0.0004");
    expect(formatSessionCost(0.0099, USD_MONEY)).toBe("$0.0099");
  });

  it("shows two decimals from a cent up", () => {
    expect(formatSessionCost(0.01, USD_MONEY)).toBe("$0.01");
    expect(formatSessionCost(0.174, USD_MONEY)).toBe("$0.17");
  });

  it("reads an unpriced turn as zero rather than blank", () => {
    expect(formatSessionCost(0, USD_MONEY)).toBe("$0.00");
    expect(formatSessionCost(Number.NaN, USD_MONEY)).toBe("$0.00");
    expect(formatSessionCost(0, CNY_AT_7_12)).toBe("¥0.00");
  });

  it("converts to yuan before picking the decimals", () => {
    expect(formatSessionCost(0.0005, CNY_AT_7_12)).toBe("¥0.0036");
    expect(formatSessionCost(0.174, CNY_AT_7_12)).toBe("¥1.24");
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
