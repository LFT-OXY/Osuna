/** The period tabs in the overview header. `all` asks the daemon for everything. */
export type UsagePeriod = "day" | "week" | "month" | "all" | "custom";

export const USAGE_PERIODS: readonly UsagePeriod[] = ["day", "week", "month", "all", "custom"];

export interface UsageCustomRange {
  from: string;
  to: string;
}

/** A client-local `YYYY-MM-DD` closed interval; `null` on both ends means all time. */
export interface UsageRange {
  from: string | null;
  to: string | null;
}

export interface UsageRangeInput {
  period: UsagePeriod;
  /** Any day inside the period being shown. Ignored by `all` and `custom`. */
  anchor: string;
  custom: UsageCustomRange;
}

const MS_PER_DAY = 86_400_000;

/** "Now" in the viewer's own zone, which is the zone the report is bucketed by. */
export interface UsageNow {
  /** `YYYY-MM-DD`. */
  day: string;
  /** `YYYY-MM-DDTHH`, the same shape the daemon uses for hourly trend keys. */
  hour: string;
}

export function resolveUsageNow(timezone: string, at: Date = new Date()): UsageNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const find = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const day = `${find("year")}-${find("month")}-${find("day")}`;
  return { day, hour: `${day}T${find("hour")}` };
}

/**
 * The heatmap header names the zone the grid is bucketed by as an offset
 * (`UTC+08:00`), not as an IANA id: the id says nothing about how far the day
 * boundary is from the reader's own.
 */
export function formatUsageTimeZoneLabel(timezone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  }).formatToParts(at);
  const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  if (offset === "GMT") return "UTC+00:00";
  return offset.startsWith("GMT") ? `UTC${offset.slice(3)}` : offset;
}

function toUtc(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addUsageDays(day: string, delta: number): string {
  return toDay(new Date(toUtc(day).getTime() + delta * MS_PER_DAY));
}

/** Weeks start on Monday (`docs` decision Q16), so Sunday belongs to the week before it. */
export function startOfUsageWeek(day: string): string {
  const date = toUtc(day);
  const mondayIndex = (date.getUTCDay() + 6) % 7;
  return addUsageDays(day, -mondayIndex);
}

export function startOfUsageMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function endOfUsageMonth(day: string): string {
  const date = toUtc(startOfUsageMonth(day));
  date.setUTCMonth(date.getUTCMonth() + 1);
  return addUsageDays(toDay(date), -1);
}

/** Shifts by whole months and clamps, so 01-31 stepped forward lands on 02-28. */
export function addUsageMonths(day: string, delta: number): string {
  const date = toUtc(startOfUsageMonth(day));
  date.setUTCMonth(date.getUTCMonth() + delta);
  const lastDay = Number(endOfUsageMonth(toDay(date)).slice(8));
  const dayOfMonth = Math.min(Number(day.slice(8)), lastDay);
  return `${toDay(date).slice(0, 8)}${String(dayOfMonth).padStart(2, "0")}`;
}

export function resolveUsageRange(input: UsageRangeInput): UsageRange {
  switch (input.period) {
    case "day":
      return { from: input.anchor, to: input.anchor };
    case "week": {
      const from = startOfUsageWeek(input.anchor);
      return { from, to: addUsageDays(from, 6) };
    }
    case "month":
      return { from: startOfUsageMonth(input.anchor), to: endOfUsageMonth(input.anchor) };
    case "all":
      return { from: null, to: null };
    case "custom":
      return input.custom.from <= input.custom.to
        ? { from: input.custom.from, to: input.custom.to }
        : { from: input.custom.to, to: input.custom.from };
  }
}

/** `all` and `custom` have no neighbouring period, so their arrows are hidden, not disabled. */
export function usagePeriodIsNavigable(period: UsagePeriod): boolean {
  return period === "day" || period === "week" || period === "month";
}

export function shiftUsageAnchor(input: { period: UsagePeriod; anchor: string; delta: number }) {
  switch (input.period) {
    case "day":
      return addUsageDays(input.anchor, input.delta);
    case "week":
      return addUsageDays(startOfUsageWeek(input.anchor), input.delta * 7);
    case "month":
      return addUsageMonths(startOfUsageMonth(input.anchor), input.delta);
    default:
      return input.anchor;
  }
}

/** Forward is dead once the shown period already contains today. */
export function canShiftUsageRangeForward(input: {
  period: UsagePeriod;
  anchor: string;
  today: string;
}): boolean {
  if (!usagePeriodIsNavigable(input.period)) return false;
  const range = resolveUsageRange({
    period: input.period,
    anchor: input.anchor,
    custom: { from: input.today, to: input.today },
  });
  return range.to !== null && range.to < input.today;
}
