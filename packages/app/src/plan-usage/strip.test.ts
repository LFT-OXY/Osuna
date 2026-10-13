import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { UsageText } from "@/usage-stats/text";
import type { AvailableUsageReport, UsageReportEntry, UsageWindow } from "@/usage/types";
import {
  fitPlanUsageStripSegments,
  resolvePlanUsageStrip,
  selectPlanUsageStripReport,
  type PlanUsageStripInput,
  type PlanUsageStripMeasuredSegment,
  type PlanUsageStripReportInput,
} from "./strip";

const NOW = Date.parse("2026-10-01T10:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function at(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

const CLAUDE_ICON = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';

function claudeUsage(overrides: Partial<AvailableUsageReport> = {}): UsageReportEntry {
  return {
    id: "claude:work",
    sourceId: "claude",
    sourceLabel: "Claude",
    icon: CLAUDE_ICON,
    account: { label: "work@example.com" },
    fetchedAt: at(0),
    report: {
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
    },
  };
}

function report(
  id: string,
  sourceId: string,
  overrides: Partial<UsageReportEntry> = {},
): UsageReportEntry {
  return { ...claudeUsage(), id, sourceId, sourceLabel: sourceId, ...overrides };
}

type ResolveOverrides = Partial<Omit<PlanUsageStripInput, "entry"> & PlanUsageStripReportInput>;

// 草稿的情形：没有可问的 Agent，账号从主机的列表里按提供方找。
function resolve(overrides: ResolveOverrides = {}) {
  const { providerId, agentReports, hostReports, ...strip } = {
    providerId: "claude",
    agentReports: null,
    hostReports: [claudeUsage()],
    hasActiveApiEndpoint: false,
    displayAs: "used" as const,
    now: NOW,
    ...overrides,
  };
  const entry = selectPlanUsageStripReport({ providerId, agentReports, hostReports });
  return resolvePlanUsageStrip({ entry, ...strip });
}

function firstWindow(segments: ReturnType<typeof resolve>) {
  return segments?.find((segment) => segment.kind === "window");
}

function onlyWindow(window: UsageWindow, overrides: ResolveOverrides = {}) {
  return firstWindow(resolve({ hostReports: [claudeUsage({ windows: [window] })], ...overrides }));
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
        icon: CLAUDE_ICON,
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
    const segments = resolve({ hostReports: [claudeUsage({ planLabel: undefined })] });
    expect(segments?.map((segment) => segment.key)).toEqual([
      "five_hour",
      "weekly",
      "weekly_model_fable",
    ]);
  });

  describe("stays quiet", () => {
    it("while the first fetch is loading, and when it failed, the host is offline, or too old", () => {
      expect(resolve({ hostReports: null })).toBeNull();
    });

    it("when the provider has no entry in the list", () => {
      expect(resolve({ providerId: "opencode" })).toBeNull();
    });

    it("when the provider's entry is not available", () => {
      const failed = report("claude:work", "claude", {
        report: { status: "error", error: "boom" },
      });
      const signedOut = report("claude:work", "claude", {
        report: { status: "unavailable", problem: { kind: "no_quota", detail: "No plan" } },
      });
      expect(resolve({ hostReports: [failed] })).toBeNull();
      expect(resolve({ hostReports: [signedOut] })).toBeNull();
    });

    it("when the provider has only balances and no windows", () => {
      expect(resolve({ hostReports: [claudeUsage({ windows: [] })] })).toBeNull();
    });

    it("when the provider runs through a third-party API endpoint", () => {
      expect(resolve({ hasActiveApiEndpoint: true })).toBeNull();
    });

    it("until it is known whether the provider runs through a third-party API endpoint", () => {
      expect(resolve({ hasActiveApiEndpoint: null })).toBeNull();
    });
  });

  describe("which account it shows", () => {
    const personal = report("claude:personal", "claude", {
      account: { label: "personal@example.com" },
    });
    const work = report("claude:work", "claude", { account: { label: "work@example.com" } });
    const codex = report("codex:work", "codex");

    function select(overrides: Partial<PlanUsageStripReportInput>) {
      return selectPlanUsageStripReport({
        providerId: "claude",
        agentReports: null,
        hostReports: [codex, personal, work],
        ...overrides,
      })?.id;
    }

    it("is the account the daemon says the agent runs under, not the host's first", () => {
      expect(select({ agentReports: [work] })).toBe("claude:work");
    });

    it("follows the agent's account even when another provider's login backs it", () => {
      expect(select({ providerId: "pi", agentReports: [work] })).toBe("claude:work");
    });

    it("is the provider's first account on the host for a draft, which has no agent to ask", () => {
      expect(select({ agentReports: null })).toBe("claude:personal");
    });

    it("falls back to the host's list when the daemon knows no account for the agent", () => {
      expect(select({ agentReports: [] })).toBe("claude:personal");
    });

    it("shows OpenCode Go for OpenCode, whose subscription is a source of another name", () => {
      const go = report("opencode-go:key", "opencode-go");
      expect(select({ providerId: "opencode", hostReports: [codex, go] })).toBe("opencode-go:key");
    });

    it("shows nothing for a provider with no account on the host", () => {
      expect(select({ providerId: "pi" })).toBeUndefined();
      expect(select({ hostReports: null })).toBeUndefined();
    });
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

    it("shows the share left when plan usage is set to read as remaining", () => {
      const window = onlyWindow(
        { id: "weekly", label: "Weekly", usedPct: 31, tone: "warning" },
        { displayAs: "remaining" },
      );
      expect(window).toMatchObject({ ringPct: 69, percentText: "69%", tone: "warning" });
      expect(window?.accessibilityLabel).toEqual({
        key: "usage.planUsage.strip.windowA11yLeftNoTrailing",
        params: { label: "Weekly", percent: "69%" },
      });
      const resetting = onlyWindow(
        { id: "weekly", label: "Weekly", usedPct: 31, resetsAt: at(4 * DAY_MS) },
        { displayAs: "remaining" },
      );
      expect(resetting?.accessibilityLabel).toEqual({
        key: "usage.planUsage.strip.windowA11yLeft",
        params: {
          label: "Weekly",
          percent: "69%",
          trailing: { key: "usage.planUsage.resets", params: { duration: "4d" } },
        },
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
      const window: UsageWindow = {
        id: "weekly",
        label: "Weekly",
        resetsAt: at(2 * HOUR_MS),
      };
      const segments = resolve({
        hostReports: [claudeUsage({ windows: [window] })],
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
    const windows: UsageWindow[] = [
      { id: "five_hour", label: "Session", resetsAt: at(HOUR_MS) },
      { id: "session", label: "Session", resetsAt: at(-HOUR_MS) },
      { id: "weekly", label: "Weekly", runsOutAt: at(HOUR_MS), shortfallPct: 5 },
      { id: "code_review", label: "Code review" },
    ];
    const segments = [
      ...(resolve({ hostReports: [claudeUsage({ windows })] }) ?? []),
      ...(resolve({ hostReports: [claudeUsage({ windows })], displayAs: "remaining" }) ?? []),
    ];
    for (const segment of segments) {
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

describe("fitPlanUsageStripSegments", () => {
  // 套餐名段 80，三个窗口段各 100：仪表全宽 380。
  const MEASURED: PlanUsageStripMeasuredSegment[] = [
    { key: "plan", kind: "plan", width: 80 },
    { key: "five_hour", kind: "window", width: 100 },
    { key: "weekly", kind: "window", width: 100 },
    { key: "weekly_model_fable", kind: "window", width: 100 },
  ];

  function fit(availableWidth: number, segments = MEASURED, branchReservedWidth = 80) {
    return fitPlanUsageStripSegments({ availableWidth, branchReservedWidth, segments });
  }

  it("shows every segment when they fit beside the branch", () => {
    expect(fit(460)).toEqual(["plan", "five_hour", "weekly", "weekly_model_fable"]);
  });

  it("hides the last window first", () => {
    expect(fit(459)).toEqual(["plan", "five_hour", "weekly"]);
  });

  it("hides every later window before the plan", () => {
    expect(fit(359)).toEqual(["plan", "five_hour"]);
    expect(fit(260)).toEqual(["plan", "five_hour"]);
  });

  it("hides the plan once only the first window is left", () => {
    expect(fit(259)).toEqual(["five_hour"]);
  });

  it("keeps the first window however narrow the strip gets", () => {
    expect(fit(120)).toEqual(["five_hour"]);
    expect(fit(0)).toEqual(["five_hour"]);
  });

  it("leaves the branch its reserved width, and nothing when there is no branch", () => {
    expect(fit(380)).toEqual(["plan", "five_hour", "weekly"]);
    expect(fit(380, MEASURED, 0)).toEqual(["plan", "five_hour", "weekly", "weekly_model_fable"]);
  });

  it("drops windows down to the first when there is no plan segment", () => {
    const windows = MEASURED.slice(1);
    expect(fit(380, windows)).toEqual(["five_hour", "weekly", "weekly_model_fable"]);
    expect(fit(379, windows)).toEqual(["five_hour", "weekly"]);
    expect(fit(100, windows)).toEqual(["five_hour"]);
  });
});
