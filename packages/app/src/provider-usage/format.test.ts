import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { renderUsageText, type UsageText } from "@/usage/text";
import {
  describeFetchedAt,
  describeFooterParts,
  describeReset,
  describeRunsOut,
  describeStatus,
  formatAmount,
  formatPct,
  resolveBalanceAmount,
} from "./format";
import type { ProviderUsage } from "./types";

const NOW = Date.parse("2026-06-19T12:00:00.000Z");

function at(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function render(text: UsageText | null): string | null {
  return text ? renderUsageText(i18n.t, text) : null;
}

function usage(overrides: Partial<ProviderUsage>): ProviderUsage {
  return {
    providerId: "glm",
    displayName: "GLM coding plan",
    status: "available",
    planLabel: null,
    windows: [],
    ...overrides,
  };
}

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.init();
  }
  await i18n.changeLanguage("en");
});

describe("plan usage descriptions", () => {
  it("dates a fetch by how long ago it was", () => {
    expect(describeFetchedAt(at(-30_000), NOW)).toEqual({
      key: "usage.planUsage.updated",
      params: { ago: { key: "usage.common.time.justNow" } },
    });
    expect(describeFetchedAt(at(-5 * 60_000), NOW)).toEqual({
      key: "usage.planUsage.updated",
      params: { ago: { key: "usage.common.time.minutesAgo", params: { count: 5 } } },
    });
    expect(describeFetchedAt(at(-3 * 3_600_000), NOW)).toEqual({
      key: "usage.planUsage.updated",
      params: { ago: { key: "usage.common.time.hoursAgo", params: { count: 3 } } },
    });
    expect(describeFetchedAt(at(-2 * 86_400_000), NOW)).toEqual({
      key: "usage.planUsage.updated",
      params: { ago: { key: "usage.common.time.daysAgo", params: { count: 2 } } },
    });
    expect(describeFetchedAt(null, NOW)).toBe(null);
    expect(describeFetchedAt("not-a-date", NOW)).toBe(null);
  });

  it("counts a window down to its reset and says so once it is due", () => {
    expect(describeReset(at(3 * 3_600_000), NOW)).toEqual({
      key: "usage.planUsage.resets",
      params: { duration: "3h" },
    });
    expect(describeReset(at(-1_000), NOW)).toEqual({ key: "usage.planUsage.resettingNow" });
    expect(describeReset(null, NOW)).toBe(null);
  });

  it("switches to the run-out time when the window will empty first", () => {
    expect(describeRunsOut(at(2 * 86_400_000), NOW)).toEqual({
      key: "usage.planUsage.runsOut",
      params: { duration: "2d" },
    });
    // 已经用完的窗口没有倒计时可说，条尾留白。
    expect(describeRunsOut(at(-1_000), NOW)).toBe(null);
  });

  it("names a status only when something is wrong", () => {
    expect(describeStatus("available")).toBe(null);
    expect(describeStatus("error")).toEqual({ key: "usage.planUsage.status.error" });
    expect(describeStatus("unavailable")).toEqual({ key: "usage.planUsage.status.unavailable" });
  });

  it("reads a balance as used-of-limit, as what is left, or as a bare amount", () => {
    expect(
      resolveBalanceAmount({ id: "a", label: "Extra", used: 5, limit: 20, unit: "usd" }),
    ).toEqual({ amount: { text: "$5.00 / $20.00" }, usedPct: 25 });
    expect(
      resolveBalanceAmount({ id: "b", label: "Credits", remaining: 1234, unit: "credits" }),
    ).toEqual({
      amount: { key: "usage.planUsage.balanceLeft", params: { amount: "1,234" } },
      usedPct: null,
    });
    expect(resolveBalanceAmount({ id: "c", label: "Spent", used: 12, unit: "credits" })).toEqual({
      amount: { text: "12" },
      usedPct: null,
    });
    expect(resolveBalanceAmount({ id: "d", label: "Unknown", unit: "credits" })).toEqual({
      amount: { text: "—" },
      usedPct: null,
    });
  });

  it("puts the source label before the fetch time in the footer", () => {
    expect(
      describeFooterParts(
        usage({ sourceLabel: "OpenUsage 0.6.27", fetchedAt: at(-3 * 60_000) }),
        NOW,
      ),
    ).toEqual([
      { text: "OpenUsage 0.6.27" },
      {
        key: "usage.planUsage.updated",
        params: { ago: { key: "usage.common.time.minutesAgo", params: { count: 3 } } },
      },
    ]);
    expect(describeFooterParts(usage({}), NOW)).toEqual([]);
  });
});

/**
 * 这一组是搬迁的守卫：套餐用量的英文是 Playwright spec 的定位锚点，迁到 i18n 后
 * 必须逐字不变。
 */
describe("plan usage English stays what it was", () => {
  it("renders the same words the hardcoded copy rendered", () => {
    expect(render(describeFetchedAt(at(-30_000), NOW))).toBe("Updated just now");
    expect(render(describeFetchedAt(at(-5 * 60_000), NOW))).toBe("Updated 5m ago");
    expect(render(describeFetchedAt(at(-3 * 3_600_000), NOW))).toBe("Updated 3h ago");
    expect(render(describeFetchedAt(at(-2 * 86_400_000), NOW))).toBe("Updated 2d ago");
    expect(render(describeReset(at(3 * 3_600_000), NOW))).toBe("resets 3h");
    expect(render(describeReset(at(-1_000), NOW))).toBe("resetting now");
    expect(render(describeRunsOut(at(3 * 3_600_000), NOW))).toBe("runs out 3h");
    expect(render(describeStatus("error"))).toBe("Error");
    expect(render(describeStatus("unavailable"))).toBe("Unavailable");
    expect(
      render(
        resolveBalanceAmount({ id: "b", label: "Credits", remaining: 1234, unit: "credits" })
          .amount,
      ),
    ).toBe("1,234 left");
    expect(i18n.t("usage.planUsage.title")).toBe("Plan usage");
    expect(i18n.t("usage.planUsage.refresh")).toBe("Refresh");
    expect(i18n.t("usage.planUsage.refreshing")).toBe("Refreshing...");
    expect(i18n.t("usage.planUsage.loading")).toBe("Loading usage...");
    expect(i18n.t("usage.planUsage.empty")).toBe("No usage data");
    expect(i18n.t("usage.planUsage.errorTitle")).toBe("Unable to load usage");
    expect(i18n.t("usage.planUsage.hostUnavailable")).toBe(
      "Connect to this host to see provider usage",
    );
    expect(i18n.t("usage.planUsage.hostUpgradeRequired")).toBe(
      "Update the host to see provider usage",
    );
    expect(i18n.t("usage.planUsage.clientUnavailable")).toBe("Host connection is not ready");
    expect(i18n.t("usage.planUsage.tooltipLoading")).toBe("Loading plan usage…");
  });

  it("formats the numbers the bars show", () => {
    expect(formatPct(23.4)).toBe("23%");
    expect(formatPct(-5)).toBe("0%");
    expect(formatPct(140)).toBe("100%");
    expect(formatAmount(5, "usd")).toBe("$5.00");
    expect(formatAmount(1234, "credits")).toBe("1,234");
  });
});
