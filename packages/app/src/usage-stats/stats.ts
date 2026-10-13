import type {
  UsageHeatmapDay,
  UsageModelBreakdown,
  UsageSummary,
} from "@getpaseo/protocol/usage/types";
import { addUsageDays } from "./period";
import { totalUsageTokens } from "./totals";

/** The panel shows three models; a fourth would push the footer off the card. */
const TOP_MODEL_COUNT = 3;

const AVERAGE_WINDOW_DAYS = 30;

export interface UsageTopModel {
  model: string;
  tokens: number;
  share: number;
}

export interface UsageStats {
  last7Days: number;
  last30Days: number;
  /** Tokens per day counting only the days inside the 30-day window that had any. */
  avgPerActiveDay: number;
  sessionCount: number;
  topModels: UsageTopModel[];
  firstActiveDay: string | null;
  activeDays: number;
}

export interface UsageStatsInput {
  summary: UsageSummary;
  /** Already sorted by tokens descending, which is the order the daemon sends. */
  models: readonly UsageModelBreakdown[];
  heatmapDays: readonly UsageHeatmapDay[];
  today: string;
}

/**
 * The four tiles and the footer of the statistics panel.
 *
 * `firstActiveDay` and `activeDays` count the heatmap window only, because that
 * is the one day series the report sends independently of the selected period —
 * everything else in the payload would make the footer jump when the user
 * switches tabs. A host with usage older than the window reports the oldest day
 * inside it.
 */
export function deriveUsageStats(input: UsageStatsInput): UsageStats {
  const grandTotal = totalUsageTokens(input.summary.totals);
  const averageWindowStart = addUsageDays(input.today, -(AVERAGE_WINDOW_DAYS - 1));

  let activeDays = 0;
  let activeDaysInWindow = 0;
  let firstActiveDay: string | null = null;
  for (const day of input.heatmapDays) {
    if (totalUsageTokens(day.totals) === 0) continue;
    activeDays += 1;
    if (firstActiveDay === null || day.day < firstActiveDay) firstActiveDay = day.day;
    if (day.day >= averageWindowStart && day.day <= input.today) activeDaysInWindow += 1;
  }

  const last30Days = totalUsageTokens(input.summary.last30Days.totals);

  return {
    last7Days: totalUsageTokens(input.summary.last7Days.totals),
    last30Days,
    avgPerActiveDay: activeDaysInWindow === 0 ? 0 : last30Days / activeDaysInWindow,
    sessionCount: input.summary.sessionCount,
    topModels: input.models.slice(0, TOP_MODEL_COUNT).map((model) => {
      const tokens = totalUsageTokens(model.totals);
      return { model: model.model, tokens, share: grandTotal === 0 ? 0 : tokens / grandTotal };
    }),
    firstActiveDay,
    activeDays,
  };
}
