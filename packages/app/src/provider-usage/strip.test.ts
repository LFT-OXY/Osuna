import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { UsageText } from "@/usage/text";
import { resolvePlanUsageStrip, type PlanUsageStripInput } from "./strip";
import type { ProviderUsage, ProviderUsageView, ProviderUsageWindow } from "./types";

const NOW = Date.parse("2026-10-01T10:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function at(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function claudeUsage(overrides: Partial<ProviderUsage> = {}): ProviderUsage {
  return {
    providerId: "claude",
    displayName: "Claude",
    status: "available",
    planLabel: "Max 20x",
    windows: [
      {
        id: "five_hour",
        label: "Session",
        usedPct: 0,
        resetsAt: at(4 * HOUR_MS),
        tone: "ok",
      },
      { id: "weekly", label: "Weekly", usedPct: 45, resetsAt: at(4 * DAY_MS), tone: "ok" },
      {
        id: "weekly_model_fable",
        label: "Weekly · Fable",
        usedPct: 0,
        resetsAt: at(4 * DAY_MS),
        tone: "ok",
      },
    ],
    balances: [{ id: "extra", label: "Extra usage", unit: "usd", used: 3, limit: 50 }],
    details: [{ id: "extra-state", label: "Extra usage", value: "Disabled" }],
    ...overrides,
  };
}

function ready(providers: ProviderUsage[]): ProviderUsageView {
  return {
    kind: "ready",
    isRefreshing: false,
    payload: { requestId: "req-1", fetchedAt: at(0), providers },
  };
}

function resolve(overrides: Partial<PlanUsageStripInput> = {}) {
  return resolvePlanUsageStrip({
    view: ready([claudeUsage()]),
    providerId: "claude",
    hasActiveApiEndpoint: false,
    now: NOW,
    ...overrides,
  });
}

function firstWindow(segments: ReturnType<typeof resolve>) {
  return segments?.find((segment) => segment.kind === "window");
}

function onlyWindow(window: ProviderUsageWindow) {
  return firstWindow(resolve({ view: ready([claudeUsage({ windows: [window] })]) }));
}

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.init();
  }
});

describe("the plan usage gauge in the composer context strip", () => {
  it("leads with the plan and follows with one segment per window, in the daemon's order", () => {
    expect(resolve()).toEqual([
      {
        kind: "plan",
        key: "plan",
        providerId: "claude",
        label: "Max 20x",
        accessibilityLabel: {
          key: "usage.planUsage.strip.planA11y",
          params: { provider: "Claude", plan: "Max 20x" },
        },
      },
      {
        kind: "window",
        key: "five_hour",
        shortName: { key: "usage.planUsage.strip.windows.fiveHour" },
        ringPct: 0,
        percentText: "0%",
        tone: "ok",
        trailing: { text: { text: "4h" }, atRisk: false },
        accessibilityLabel: {
          key: "usage.planUsage.strip.windowA11y",
          params: {
            label: "Session",
            percent: "0%",
            trailing: { key: "usage.planUsage.resets", params: { duration: "4h" } },
          },
        },
      },
      {
        kind: "window",
        key: "weekly",
        shortName: { key: "usage.planUsage.strip.windows.weekly" },
        ringPct: 45,
        percentText: "45%",
        tone: "ok",
        trailing: { text: { text: "4d" }, atRisk: false },
        accessibilityLabel: {
          key: "usage.planUsage.strip.windowA11y",
          params: {
            label: "Weekly",
            percent: "45%",
            trailing: { key: "usage.planUsage.resets", params: { duration: "4d" } },
          },
        },
      },
      {
        kind: "window",
        key: "weekly_model_fable",
        shortName: { text: "Fable" },
        ringPct: 0,
        percentText: "0%",
        tone: "ok",
        trailing: { text: { text: "4d" }, atRisk: false },
        accessibilityLabel: {
          key: "usage.planUsage.strip.windowA11y",
          params: {
            label: "Weekly · Fable",
            percent: "0%",
            trailing: { key: "usage.planUsage.resets", params: { duration: "4d" } },
          },
        },
      },
    ]);
  });

  it("matches the provider regardless of case", () => {
    expect(resolve({ providerId: "Claude" })?.[0]).toMatchObject({ kind: "plan" });
  });

  it("drops the plan segment when the provider reports no plan name", () => {
    const segments = resolve({ view: ready([claudeUsage({ planLabel: null })]) });
    expect(segments?.map((segment) => segment.key)).toEqual([
      "five_hour",
      "weekly",
      "weekly_model_fable",
    ]);
  });

  describe("stays quiet", () => {
    it("while the first fetch is loading", () => {
      expect(resolve({ view: { kind: "loading" } })).toBeNull();
    });

    it("when the fetch failed, the host is offline, or the host is too old", () => {
      for (const key of [
        "usage.planUsage.hostUnavailable",
        "usage.planUsage.hostUpgradeRequired",
        "usage.planUsage.clientUnavailable",
      ]) {
        expect(resolve({ view: { kind: "error", message: { key } } })).toBeNull();
      }
      expect(resolve({ view: { kind: "error", message: { text: "boom" } } })).toBeNull();
    });

    it("when the provider has no entry in the list", () => {
      expect(resolve({ providerId: "opencode" })).toBeNull();
    });

    it("when the provider's entry is not available", () => {
      expect(resolve({ view: ready([claudeUsage({ status: "error" })]) })).toBeNull();
      expect(resolve({ view: ready([claudeUsage({ status: "unavailable" })]) })).toBeNull();
    });

    it("when the provider has only balances and no windows", () => {
      expect(resolve({ view: ready([claudeUsage({ windows: [] })]) })).toBeNull();
    });

    it("when the provider runs through a third-party API endpoint", () => {
      expect(resolve({ hasActiveApiEndpoint: true })).toBeNull();
    });

    it("until it is known whether the provider runs through a third-party API endpoint", () => {
      expect(resolve({ hasActiveApiEndpoint: null })).toBeNull();
    });
  });

  it("keeps showing the last answer while a refresh is in flight", () => {
    const view = ready([claudeUsage()]);
    if (view.kind !== "ready") throw new Error("expected a ready view");
    const refreshing: ProviderUsageView = { ...view, isRefreshing: true };
    expect(resolve({ view: refreshing })).toEqual(resolve());
  });

  describe("short names", () => {
    it("shares one name between Claude's five-hour window and Codex's session window", () => {
      expect(onlyWindow({ id: "five_hour", label: "Session" })?.shortName).toEqual({
        key: "usage.planUsage.strip.windows.fiveHour",
      });
      expect(onlyWindow({ id: "session", label: "Session" })?.shortName).toEqual({
        key: "usage.planUsage.strip.windows.fiveHour",
      });
    });

    it("names the code review window", () => {
      expect(onlyWindow({ id: "code_review", label: "Code review" })?.shortName).toEqual({
        key: "usage.planUsage.strip.windows.codeReview",
      });
    });

    it("keeps only the model name of a scoped weekly window", () => {
      expect(onlyWindow({ id: "weekly_model_opus", label: "Weekly · Opus" })?.shortName).toEqual({
        text: "Opus",
      });
    });

    it("falls back to the daemon's label for a window it does not know", () => {
      expect(
        onlyWindow({ id: "interval_MiniMax-M2", label: "MiniMax-M2 · 5h" })?.shortName,
      ).toEqual({ text: "MiniMax-M2 · 5h" });
    });
  });

  describe("tone", () => {
    it("uses the daemon's tone when it sends one", () => {
      expect(onlyWindow({ id: "weekly", label: "Weekly", usedPct: 20, tone: "danger" })?.tone).toBe(
        "danger",
      );
    });

    it("derives the tone on the client when the daemon sends none", () => {
      expect(onlyWindow({ id: "weekly", label: "Weekly", usedPct: 82 })?.tone).toBe("warning");
      expect(onlyWindow({ id: "weekly", label: "Weekly", usedPct: 93 })?.tone).toBe("danger");
      expect(onlyWindow({ id: "weekly", label: "Weekly", usedPct: 20 })?.tone).toBe("default");
    });
  });

  describe("percent", () => {
    it("reads remaining percent when used percent is missing", () => {
      expect(onlyWindow({ id: "weekly", label: "Weekly", remainingPct: 30 })).toMatchObject({
        ringPct: 70,
        percentText: "70%",
      });
    });

    it("draws an empty ring and a dash when the window has no percent at all", () => {
      expect(onlyWindow({ id: "weekly", label: "Weekly" })).toMatchObject({
        ringPct: 0,
        percentText: "—",
      });
    });

    it("clamps percent to the ring", () => {
      expect(onlyWindow({ id: "weekly", label: "Weekly", usedPct: 130 })).toMatchObject({
        ringPct: 100,
        percentText: "100%",
      });
    });
  });

  describe("trailing text", () => {
    it("says when the window runs out instead of when it resets, when it will run out first", () => {
      const window = onlyWindow({
        id: "five_hour",
        label: "Session",
        usedPct: 82,
        resetsAt: at(3 * HOUR_MS),
        runsOutAt: at(HOUR_MS + 5 * 60_000),
        shortfallPct: 18,
      });
      expect(window?.trailing).toEqual({
        text: { key: "usage.planUsage.strip.runsOut", params: { duration: "1h" } },
        atRisk: true,
      });
      expect(window?.accessibilityLabel).toEqual({
        key: "usage.planUsage.strip.windowA11y",
        params: {
          label: "Session",
          percent: "82%",
          trailing: { key: "usage.planUsage.runsOut", params: { duration: "1h" } },
        },
      });
    });

    it("keeps the reset time when a run-out time comes without a shortfall", () => {
      expect(
        onlyWindow({
          id: "five_hour",
          label: "Session",
          resetsAt: at(3 * HOUR_MS),
          runsOutAt: at(HOUR_MS),
        })?.trailing,
      ).toEqual({ text: { text: "3h" }, atRisk: false });
    });

    it("says the window is resetting once the reset time has passed", () => {
      const window = onlyWindow({ id: "weekly", label: "Weekly", resetsAt: at(-60_000) });
      expect(window?.trailing).toEqual({
        text: { key: "usage.planUsage.resettingNow" },
        atRisk: false,
      });
    });

    it("has no trailing text when the window has no reset time", () => {
      const window = onlyWindow({ id: "weekly", label: "Weekly", usedPct: 10 });
      expect(window?.trailing).toBeNull();
      expect(window?.accessibilityLabel).toEqual({
        key: "usage.planUsage.strip.windowA11yNoTrailing",
        params: { label: "Weekly", percent: "10%" },
      });
    });

    it("counts down from the clock it is given", () => {
      const window: ProviderUsageWindow = {
        id: "weekly",
        label: "Weekly",
        resetsAt: at(2 * HOUR_MS),
      };
      const segments = resolve({
        view: ready([claudeUsage({ windows: [window] })]),
        now: NOW + HOUR_MS + 30 * 60_000,
      });
      expect(firstWindow(segments)?.trailing).toEqual({
        text: { text: "30m" },
        atRisk: false,
      });
    });
  });

  it("only emits translation keys that exist", () => {
    const keys = new Set<string>();
    const collect = (text: UsageText) => {
      if ("text" in text) return;
      keys.add(text.key);
      for (const param of Object.values(text.params ?? {})) {
        if (typeof param === "object") collect(param);
      }
    };
    const windows: ProviderUsageWindow[] = [
      { id: "five_hour", label: "Session", resetsAt: at(HOUR_MS) },
      { id: "session", label: "Session", resetsAt: at(-HOUR_MS) },
      { id: "weekly", label: "Weekly", runsOutAt: at(HOUR_MS), shortfallPct: 5 },
      { id: "code_review", label: "Code review" },
    ];
    for (const segment of resolve({ view: ready([claudeUsage({ windows })]) }) ?? []) {
      collect(segment.accessibilityLabel);
      if (segment.kind === "window") {
        collect(segment.shortName);
        if (segment.trailing) collect(segment.trailing.text);
      }
    }
    expect(keys.size).toBeGreaterThan(8);
    for (const key of keys) {
      expect(i18n.exists(key), key).toBe(true);
    }
  });
});
