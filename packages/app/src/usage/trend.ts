import type {
  UsageTrend,
  UsageTrendGranularity,
  UsageTrendStackBy,
} from "@getpaseo/protocol/usage/types";
import { addUsageDays, type UsageNow, type UsageRange } from "./period";
import { formatUsageDay } from "./range-label";
import { totalUsageTokens } from "./totals";

/**
 * A custom range can ask for decades of months. The card keeps the most recent
 * bars rather than drawing a few thousand of them a phone cannot render.
 */
const MAX_TREND_BARS = 372;

const HOURS_PER_DAY = 24;

export interface UsageTrendSegment {
  group: string;
  tokens: number;
}

export interface UsageTrendBar {
  key: string;
  /** In `groups` order, so a group keeps the same band across every bar. */
  segments: UsageTrendSegment[];
  total: number;
  isFuture: boolean;
}

export interface UsageTrendSeries {
  granularity: UsageTrendGranularity;
  stackBy: UsageTrendStackBy;
  /** Stacking order, largest contributor first. */
  groups: string[];
  bars: UsageTrendBar[];
  /** Tallest bar, never zero, so a bar height is always a safe division. */
  max: number;
}

export interface UsageTrendSeriesInput {
  trend: UsageTrend;
  range: UsageRange;
  now: UsageNow;
}

function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, "0")}`;
}

function maxKey(a: string, b: string): string {
  return a > b ? a : b;
}

/**
 * The daemon only sends the periods that had usage, so the axis is rebuilt from
 * the selected range: a quiet Tuesday has to be a gap in the chart, not a
 * missing column that shifts every bar after it.
 */
function buildKeys(input: UsageTrendSeriesInput): string[] {
  const points = input.trend.points;
  const firstPoint = points[0]?.key;
  const lastPoint = points[points.length - 1]?.key;
  const keys: string[] = [];

  if (input.trend.granularity === "hour") {
    const day = input.range.from ?? firstPoint?.slice(0, 10) ?? input.now.day;
    for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
      keys.push(`${day}T${String(hour).padStart(2, "0")}`);
    }
    return keys;
  }

  if (input.trend.granularity === "day") {
    const from = input.range.from ?? firstPoint ?? input.now.day;
    const to = input.range.to ?? maxKey(lastPoint ?? input.now.day, input.now.day);
    for (let day = from; day <= to; day = addUsageDays(day, 1)) keys.push(day);
    return keys;
  }

  const from = (input.range.from ?? firstPoint ?? input.now.day).slice(0, 7);
  const to = (input.range.to ?? maxKey(lastPoint ?? input.now.day, input.now.day)).slice(0, 7);
  for (let month = from; month <= to; month = nextMonth(month)) keys.push(month);
  return keys;
}

function isFutureKey(key: string, granularity: UsageTrendGranularity, now: UsageNow): boolean {
  if (granularity === "hour") return key > now.hour;
  if (granularity === "day") return key > now.day;
  return key > now.day.slice(0, 7);
}

export function buildUsageTrendSeries(input: UsageTrendSeriesInput): UsageTrendSeries {
  const keys = buildKeys(input).slice(-MAX_TREND_BARS);
  const tokensByKey = new Map<string, Map<string, number>>();
  const groupTotals = new Map<string, number>();

  for (const point of input.trend.points) {
    const byGroup = new Map<string, number>();
    for (const [group, amount] of Object.entries(point.groups)) {
      const tokens = totalUsageTokens(amount.totals);
      if (tokens === 0) continue;
      byGroup.set(group, tokens);
      groupTotals.set(group, (groupTotals.get(group) ?? 0) + tokens);
    }
    tokensByKey.set(point.key, byGroup);
  }

  const groups = [...groupTotals.entries()]
    .sort(([aGroup, aTokens], [bGroup, bTokens]) =>
      aTokens === bTokens ? aGroup.localeCompare(bGroup) : bTokens - aTokens,
    )
    .map(([group]) => group);

  let max = 0;
  const bars = keys.map((key) => {
    const byGroup = tokensByKey.get(key);
    const segments: UsageTrendSegment[] = [];
    let total = 0;
    for (const group of groups) {
      const tokens = byGroup?.get(group) ?? 0;
      if (tokens === 0) continue;
      segments.push({ group, tokens });
      total += tokens;
    }
    if (total > max) max = total;
    return {
      key,
      segments,
      total,
      isFuture: isFutureKey(key, input.trend.granularity, input.now),
    };
  });

  return {
    granularity: input.trend.granularity,
    stackBy: input.trend.stackBy,
    groups,
    bars,
    max: max === 0 ? 1 : max,
  };
}

/** The axis footer: the first and last bar, read in the UI language. */
export function formatUsageTrendKey(
  key: string,
  granularity: UsageTrendGranularity,
  locale: string,
): string {
  if (granularity === "hour") {
    return new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(`${key}:00:00.000Z`));
  }
  if (granularity === "day") return formatUsageDay(key, locale);
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
  }).format(new Date(`${key}-01T00:00:00.000Z`));
}
