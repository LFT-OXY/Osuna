import type { UsageHeatmapDay } from "@osuna/protocol/usage/types";
import { addUsageDays, startOfUsageWeek } from "./period";
import { totalUsageTokens } from "./totals";

/** The window is fixed: it never follows the period tabs. */
export const USAGE_HEATMAP_WEEKS = 26;
export const USAGE_HEATMAP_WEEKS_COMPACT = 20;

export const USAGE_HEATMAP_ROWS = 7;

export type UsageHeatmapLevel = 0 | 1 | 2 | 3 | 4;

export interface UsageHeatmapCell {
  day: string;
  tokens: number;
  level: UsageHeatmapLevel;
  /** Column, oldest week first. */
  week: number;
  /** Row, 0 = Monday. */
  weekday: number;
}

export interface UsageHeatmapMonthLabel {
  week: number;
  /** `YYYY-MM`, formatted by the card in the UI language. */
  month: string;
}

export interface UsageHeatmapMatrix {
  /** The Monday the first column opens on. */
  startDay: string;
  cells: UsageHeatmapCell[];
  monthLabels: UsageHeatmapMonthLabel[];
}

export interface UsageHeatmapInput {
  days: readonly UsageHeatmapDay[];
  weeks: number;
  today: string;
}

/**
 * Quartiles of the days that had any usage, so a week of light days still
 * separates into steps instead of collapsing onto one shade. A day the report
 * does not mention is a zero, not a gap.
 */
function resolveLevel(tokens: number, positiveAscending: readonly number[]): UsageHeatmapLevel {
  if (tokens === 0) return 0;
  const quantile = (fraction: number): number =>
    positiveAscending[Math.floor(fraction * (positiveAscending.length - 1))] ?? 1;
  if (tokens < quantile(0.25)) return 1;
  if (tokens < quantile(0.5)) return 2;
  if (tokens < quantile(0.75)) return 3;
  return 4;
}

/**
 * Lays the trailing `weeks` weeks out as columns of seven days starting on
 * Monday. Days after today get no cell at all, which leaves the current week
 * short instead of drawing empty squares for a future that cannot have usage.
 */
export function buildUsageHeatmap(input: UsageHeatmapInput): UsageHeatmapMatrix {
  const startDay = addUsageDays(startOfUsageWeek(input.today), -7 * (input.weeks - 1));
  const tokensByDay = new Map<string, number>();
  for (const day of input.days) tokensByDay.set(day.day, totalUsageTokens(day.totals));

  const placed: { day: string; tokens: number; week: number; weekday: number }[] = [];
  const monthLabels: UsageHeatmapMonthLabel[] = [];
  let lastLabelledMonth = "";
  for (let week = 0; week < input.weeks; week += 1) {
    for (let weekday = 0; weekday < USAGE_HEATMAP_ROWS; weekday += 1) {
      const day = addUsageDays(startDay, week * USAGE_HEATMAP_ROWS + weekday);
      if (day > input.today) continue;
      if (weekday === 0 && day.slice(0, 7) !== lastLabelledMonth) {
        lastLabelledMonth = day.slice(0, 7);
        monthLabels.push({ week, month: lastLabelledMonth });
      }
      placed.push({ day, tokens: tokensByDay.get(day) ?? 0, week, weekday });
    }
  }

  const positiveAscending = placed
    .map((cell) => cell.tokens)
    .filter((tokens) => tokens > 0)
    .sort((a, b) => a - b);

  return {
    startDay,
    cells: placed.map((cell) => ({
      day: cell.day,
      tokens: cell.tokens,
      level: resolveLevel(cell.tokens, positiveAscending),
      week: cell.week,
      weekday: cell.weekday,
    })),
    monthLabels,
  };
}

/** Monday-first weekday names in the UI language, for the row gutter. */
export function usageHeatmapWeekdayLabels(locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "narrow" });
  // 2026-09-14 is a Monday, so the seven days after it are one full row set.
  return Array.from({ length: USAGE_HEATMAP_ROWS }, (_, index) =>
    formatter.format(new Date(Date.UTC(2026, 8, 14 + index))),
  );
}

export function formatUsageMonthLabel(month: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "short" }).format(
    new Date(`${month}-01T00:00:00.000Z`),
  );
}
