import type { ScheduleSummary } from "@osuna/protocol/schedule/types";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  describeCron,
  everyMsToParts,
  formatCadence,
  formatNextRun,
  isNewAgentSchedule,
  scheduleProductName,
  partsToEveryMs,
  renderScheduleDescription,
  resolveScheduleDisplayTitle,
  resolveScheduleTitle,
  validateCron,
  type ScheduleDescription,
} from "./schedule-format";

function createSchedule(input: {
  name?: string | null;
  prompt?: string;
  title?: string | null;
  targetType?: "agent" | "new-agent";
}): ScheduleSummary {
  return {
    id: "schedule-1",
    name: input.name ?? null,
    prompt: input.prompt ?? "Run the task",
    cadence: { type: "every", everyMs: 60_000 },
    target:
      input.targetType === "agent"
        ? { type: "agent", agentId: "00000000-0000-4000-8000-000000000000" }
        : {
            type: "new-agent",
            config: {
              provider: "codex",
              cwd: "/tmp/project",
              title: input.title,
            },
          },
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    nextRunAt: null,
    lastRunAt: null,
    pausedAt: null,
    expiresAt: null,
    maxRuns: null,
  };
}

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.init();
  }
  await i18n.changeLanguage("en");
});

afterEach(() => {
  vi.useRealTimers();
});

function render(description: ScheduleDescription | null): string | null {
  return description ? renderScheduleDescription(i18n.t, description) : null;
}

describe("schedule title helpers", () => {
  it("identifies new-agent schedules", () => {
    expect(isNewAgentSchedule(createSchedule({ targetType: "new-agent" }))).toBe(true);
    expect(isNewAgentSchedule(createSchedule({ targetType: "agent" }))).toBe(false);
  });

  it("labels engine records by product meaning", () => {
    expect(scheduleProductName(createSchedule({ targetType: "new-agent" }))).toBe("schedule");
    expect(scheduleProductName(createSchedule({ targetType: "agent" }))).toBe("heartbeat");
  });

  it("resolves display titles by name, config title, prompt, then null", () => {
    expect(
      resolveScheduleTitle(createSchedule({ name: "Morning run", title: "Config title" })),
    ).toBe("Morning run");
    expect(resolveScheduleTitle(createSchedule({ name: " ", title: "Config title" }))).toBe(
      "Config title",
    );
    expect(
      resolveScheduleTitle(createSchedule({ name: " ", title: " ", prompt: "\nPrompt line" })),
    ).toBe("Prompt line");
    expect(
      resolveScheduleTitle(createSchedule({ name: " ", title: " ", prompt: "\n  " })),
    ).toBeNull();
  });

  it("renders the localized untitled fallback per product", () => {
    const untitled = { name: " ", title: " ", prompt: "\n  " };
    expect(resolveScheduleDisplayTitle(i18n.t, createSchedule(untitled))).toBe("Untitled schedule");
    expect(
      resolveScheduleDisplayTitle(i18n.t, createSchedule({ ...untitled, targetType: "agent" })),
    ).toBe("Untitled heartbeat");
    expect(resolveScheduleDisplayTitle(i18n.t, createSchedule({ name: "Morning run" }))).toBe(
      "Morning run",
    );
  });

  it("keeps every per-product key the components assemble at runtime", () => {
    const families = [
      "schedules.form.editTitle",
      "schedules.row.untitled",
      "schedules.row.editAccessibility",
      "schedules.row.actionsAccessibility",
      "schedules.row.menu.edit",
      "schedules.row.menu.delete",
      "schedules.delete.title",
    ];
    for (const family of families) {
      for (const product of ["schedule", "heartbeat"]) {
        expect(i18n.exists(`${family}.${product}`), `${family}.${product}`).toBe(true);
      }
    }
    for (const state of ["active", "paused", "expired", "finished", "targetGone"]) {
      expect(i18n.exists(`schedules.row.state.${state}`), state).toBe(true);
    }
  });
});

describe("interval formatting", () => {
  it("round-trips interval parts and formats cadence labels", () => {
    expect(everyMsToParts(2 * 24 * 60 * 60_000)).toEqual({ value: 2, unit: "days" });
    expect(everyMsToParts(3 * 60 * 60_000)).toEqual({ value: 3, unit: "hours" });
    expect(everyMsToParts(90_000)).toEqual({ value: 2, unit: "minutes" });
    expect(everyMsToParts(0)).toEqual({ value: 1, unit: "hours" });

    expect(partsToEveryMs(2, "hours")).toBe(2 * 60 * 60_000);
    expect(partsToEveryMs(0, "minutes")).toBe(60_000);
    expect(formatCadence({ type: "every", everyMs: 2 * 60 * 60_000 })).toEqual({
      key: "schedules.cadence.interval.hourMany",
      params: { count: 2 },
    });
    expect(formatCadence({ type: "every", everyMs: 60_000 })).toEqual({
      key: "schedules.cadence.interval.minuteOne",
      params: { count: 1 },
    });
  });

  it("renders interval cadences in English", () => {
    expect(render(formatCadence({ type: "every", everyMs: 2 * 60 * 60_000 }))).toBe(
      "Every 2 hours",
    );
    expect(render(formatCadence({ type: "every", everyMs: 60_000 }))).toBe("Every 1 minute");
    expect(render(formatCadence({ type: "every", everyMs: 3 * 24 * 60 * 60_000 }))).toBe(
      "Every 3 days",
    );
  });
});

describe("describeCron", () => {
  it("humanizes common fixed-time cron shapes", () => {
    expect(describeCron({ type: "cron", expression: "* * * * *" })).toEqual({
      key: "schedules.cadence.everyMinute",
    });
    expect(describeCron({ type: "cron", expression: "0 * * * *" })).toEqual({
      key: "schedules.cadence.everyHour",
    });
    expect(describeCron({ type: "cron", expression: "15 * * * *" })).toEqual({
      key: "schedules.cadence.everyHourAt",
      params: { minute: "15" },
    });
    expect(describeCron({ type: "cron", expression: "0 9 * * *" })).toEqual({
      key: "schedules.cadence.atTime",
      params: { day: { key: "schedules.cadence.daily" }, time: "09:00", timezone: "UTC" },
    });
    expect(describeCron({ type: "cron", expression: "0 9 * * 1-5" })).toEqual({
      key: "schedules.cadence.atTime",
      params: { day: { key: "schedules.cadence.weekdays" }, time: "09:00", timezone: "UTC" },
    });
    expect(describeCron({ type: "cron", expression: "0 9 * * 0,6" })).toEqual({
      key: "schedules.cadence.atTime",
      params: { day: { key: "schedules.cadence.weekends" }, time: "09:00", timezone: "UTC" },
    });
    expect(describeCron({ type: "cron", expression: "0 9 * * 1" })).toEqual({
      key: "schedules.cadence.atTime",
      params: { day: { key: "schedules.cadence.days.monday" }, time: "09:00", timezone: "UTC" },
    });
  });

  it("renders the recognized shapes with the previous English wording", () => {
    const rendered = (expression: string) => render(describeCron({ type: "cron", expression }));
    expect(rendered("* * * * *")).toBe("Every minute");
    expect(rendered("0 * * * *")).toBe("Every hour");
    expect(rendered("15 * * * *")).toBe("Every hour at :15");
    expect(rendered("0 9 * * *")).toBe("Daily at 09:00 UTC");
    expect(rendered("0 9 * * 1-5")).toBe("Weekdays at 09:00 UTC");
    expect(rendered("0 9 * * 0,6")).toBe("Weekends at 09:00 UTC");
    expect(rendered("0 9 * * 1")).toBe("Mondays at 09:00 UTC");
  });

  it("labels fixed-time cron cadences with their stored timezone", () => {
    expect(
      render(
        describeCron({
          type: "cron",
          expression: "0 9 * * *",
          timezone: "America/New_York",
        }),
      ),
    ).toBe("Daily at 09:00 America/New_York");
    expect(
      render(
        formatCadence({
          type: "cron",
          expression: "0 9 * * 1-5",
          timezone: "Europe/Madrid",
        }),
      ),
    ).toBe("Weekdays at 09:00 Europe/Madrid");
  });

  it("keeps timezone-less fixed-time cron cadences labeled as UTC", () => {
    expect(render(formatCadence({ type: "cron", expression: "0 9 * * *" }))).toBe(
      "Daily at 09:00 UTC",
    );
  });

  it("returns null for invalid or unrecognized valid cron expressions", () => {
    expect(describeCron({ type: "cron", expression: "not a cron" })).toBeNull();
    expect(describeCron({ type: "cron", expression: "*/5 * * * *" })).toBeNull();
    expect(formatCadence({ type: "cron", expression: "*/5 * * * *" })).toEqual({
      text: "*/5 * * * *",
    });
    expect(render(formatCadence({ type: "cron", expression: "*/5 * * * *" }))).toBe("*/5 * * * *");
  });
});

describe("validateCron", () => {
  it("accepts structurally valid cron expressions", () => {
    expect(validateCron("*/5 9-17 * 1,6 1-5")).toBeNull();
  });

  it("rejects step fields with extra slash tokens", () => {
    expect(validateCron("*/5/2 * * * *")).toEqual({
      key: "schedules.cadence.errors.invalid",
      params: { detail: "Invalid minute step" },
    });
  });

  it("rejects malformed fields with targeted messages", () => {
    expect(validateCron("")).toEqual({ key: "schedules.cadence.errors.empty" });
    expect(render(validateCron(""))).toBe("Enter a cron expression");
    expect(render(validateCron("* * *"))).toBe("Cron expressions must have 5 fields");
    expect(render(validateCron("60 * * * *"))).toBe("Invalid minute value");
    expect(render(validateCron("* 24 * * *"))).toBe("Invalid hour value");
    expect(render(validateCron("* * 31-1 * *"))).toBe("Invalid day-of-month range");
    expect(render(validateCron("* * * */0 *"))).toBe("Invalid month step");
    expect(render(validateCron("* * * * mon"))).toBe("Invalid day-of-week value");
  });
});

describe("formatNextRun", () => {
  it("formats next-run distance from the current clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    expect(formatNextRun(null)).toBeNull();
    expect(formatNextRun("not-a-date")).toBeNull();
    expect(formatNextRun("2025-12-31T23:00:00.000Z")).toEqual({
      key: "schedules.row.nextRunIn.soon",
    });
    expect(formatNextRun("2026-01-01T00:00:15.000Z")).toEqual({
      key: "schedules.row.nextRunIn.soon",
    });
    expect(formatNextRun("2026-01-01T00:30:00.000Z")).toEqual({
      key: "schedules.row.nextRunIn.minutes",
      params: { count: 30 },
    });
    expect(formatNextRun("2026-01-01T03:00:00.000Z")).toEqual({
      key: "schedules.row.nextRunIn.hours",
      params: { count: 3 },
    });
    expect(formatNextRun("2026-01-03T00:00:00.000Z")).toEqual({
      key: "schedules.row.nextRunIn.days",
      params: { count: 2 },
    });
  });

  it("renders next-run distance in English", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    expect(render(formatNextRun("2026-01-01T00:00:15.000Z"))).toBe("soon");
    expect(render(formatNextRun("2026-01-01T00:30:00.000Z"))).toBe("in 30m");
    expect(render(formatNextRun("2026-01-01T03:00:00.000Z"))).toBe("in 3h");
    expect(render(formatNextRun("2026-01-03T00:00:00.000Z"))).toBe("in 2d");
  });
});
