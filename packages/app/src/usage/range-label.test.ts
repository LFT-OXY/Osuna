import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { USAGE_PERIODS } from "./period";
import { describeUsageCustomTab, describeUsageRange, formatUsageDay } from "./range-label";

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.init();
  }
});

describe("describeUsageRange", () => {
  it("names all time when either end is open", () => {
    expect(describeUsageRange({ from: null, to: null }, "en")).toEqual({
      key: "usage.overview.rangeAll",
      params: {},
    });
  });

  it("uses the single-day key when both ends are the same day", () => {
    expect(describeUsageRange({ from: "2026-09-19", to: "2026-09-19" }, "en")).toEqual({
      key: "usage.overview.rangeSingle",
      params: { day: "Sep 19, 2026" },
    });
  });

  it("formats both ends and joins them with the range key", () => {
    expect(describeUsageRange({ from: "2026-09-14", to: "2026-09-20" }, "en")).toEqual({
      key: "usage.overview.range",
      params: { from: "Sep 14, 2026", to: "Sep 20, 2026" },
    });
  });

  it("formats a day by the UI language, not the daemon's", () => {
    expect(formatUsageDay("2026-09-19", "ja")).toBe("2026年9月19日");
  });
});

describe("describeUsageCustomTab", () => {
  it("joins two short dates on the same key as the hero line", () => {
    expect(describeUsageCustomTab({ from: "2026-09-01", to: "2026-09-10" }, "en")).toEqual({
      key: "usage.overview.range",
      params: { from: "9/1", to: "9/10" },
    });
  });
});

describe("runtime-assembled usage keys", () => {
  it("has a label for every period tab", () => {
    for (const period of USAGE_PERIODS) {
      expect(i18n.exists(`usage.overview.period.${period}`), period).toBe(true);
    }
  });

  it("has every key the overview assembles at runtime", () => {
    const keys = [
      "usage.overview.range",
      "usage.overview.rangeSingle",
      "usage.overview.rangeAll",
      "usage.overview.modelCountOne",
      "usage.overview.modelCountMany",
      "usage.overview.unpricedSummaryOne",
      "usage.overview.unpricedSummaryMany",
    ];
    for (const key of keys) {
      expect(i18n.exists(key), key).toBe(true);
    }
  });
});
