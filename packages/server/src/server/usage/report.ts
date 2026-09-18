import type {
  UsageAmount,
  UsageBackfill,
  UsageCli,
  UsageDayBreakdown,
  UsageHeatmapDay,
  UsageModelBreakdown,
  UsageMonthBreakdown,
  UsageProjectBreakdown,
  UsageReport,
  UsageReportFilters,
  UsageSourceBreakdown,
  UsageTokenTotals,
  UsageTrend,
  UsageTrendGranularity,
  UsageTrendStackBy,
} from "@getpaseo/protocol/usage/types";
import type { UsageProjectAttribution } from "./project-attribution.js";
import type { UsageBucketRow } from "./types.js";

/** Estimated cost lands with the price table; until then every amount is unpriced. */
const UNPRICED_COST = 0;
const HEATMAP_DAYS = 182;
const PROJECT_LIMIT = 200;

export interface UsageReportRequest {
  from: string | null;
  to: string | null;
  timezone: string;
  filters?: UsageReportFilters;
  trend?: { granularity?: UsageTrendGranularity; stackBy: UsageTrendStackBy };
}

export interface BuildUsageReportInput {
  rows: UsageBucketRow[];
  request: UsageReportRequest;
  projects: Map<string, UsageProjectAttribution>;
  backfill: UsageBackfill;
  error: string | null;
  now: number;
}

export function buildUsageReport(input: BuildUsageReportInput): UsageReport {
  const { request } = input;
  const local = createLocalTimeResolver(request.timezone);
  const today = local.day(input.now);
  const filtered = input.rows.filter((row) => matchesFilters(row, request.filters, input.projects));

  const inRange = filtered.filter((row) => {
    const day = local.day(Date.parse(row.bucket));
    if (request.from && day < request.from) return false;
    if (request.to && day > request.to) return false;
    return true;
  });

  const stackBy = request.trend?.stackBy ?? "source";
  const granularity =
    request.trend?.granularity ?? defaultGranularity(request.from, request.to, today);

  return {
    summary: buildSummary(inRange, filtered, local, today),
    sources: buildSources(inRange),
    models: buildModels(inRange),
    trend: buildTrend(inRange, local, granularity, stackBy),
    days: buildDays(inRange, local),
    months: buildMonths(inRange, local),
    heatmapDays: buildHeatmap(filtered, local, today),
    projects: buildProjects(inRange, input.projects),
    backfill: input.backfill,
    error: input.error,
  };
}

function buildSummary(
  inRange: UsageBucketRow[],
  filtered: UsageBucketRow[],
  local: LocalTimeResolver,
  today: string,
): UsageReport["summary"] {
  const totals = emptyTotals();
  const sessions = new Set<string>();
  for (const row of inRange) {
    addTotals(totals, row);
    sessions.add(row.sessionId);
  }
  return {
    totals,
    estimatedCost: UNPRICED_COST,
    sessionCount: sessions.size,
    last7Days: trailingDays(filtered, local, today, 7),
    last30Days: trailingDays(filtered, local, today, 30),
  };
}

function trailingDays(
  rows: UsageBucketRow[],
  local: LocalTimeResolver,
  today: string,
  days: number,
): UsageAmount {
  const from = shiftDay(today, -(days - 1));
  const totals = emptyTotals();
  for (const row of rows) {
    const day = local.day(Date.parse(row.bucket));
    if (day < from || day > today) continue;
    addTotals(totals, row);
  }
  return { totals, estimatedCost: UNPRICED_COST };
}

function buildSources(rows: UsageBucketRow[]): UsageSourceBreakdown[] {
  const bySource = new Map<
    string,
    { cli: UsageCli; backend: string | null; totals: UsageTokenTotals; models: Set<string> }
  >();
  for (const row of rows) {
    const key = `${row.cli}\u0000${row.backend ?? ""}`;
    let entry = bySource.get(key);
    if (!entry) {
      entry = { cli: row.cli, backend: row.backend, totals: emptyTotals(), models: new Set() };
      bySource.set(key, entry);
    }
    addTotals(entry.totals, row);
    entry.models.add(row.model);
  }

  const grandTotal = Array.from(bySource.values()).reduce(
    (sum, entry) => sum + billableTokens(entry.totals),
    0,
  );
  return Array.from(bySource.values())
    .map((entry) => ({
      cli: entry.cli,
      backend: entry.backend,
      totals: entry.totals,
      estimatedCost: UNPRICED_COST,
      modelCount: entry.models.size,
      share: grandTotal > 0 ? billableTokens(entry.totals) / grandTotal : 0,
    }))
    .sort(byTokensDescending);
}

function buildModels(rows: UsageBucketRow[]): UsageModelBreakdown[] {
  const byModel = new Map<
    string,
    { model: string; cli: UsageCli; backend: string | null; totals: UsageTokenTotals }
  >();
  for (const row of rows) {
    const key = `${row.cli}\u0000${row.backend ?? ""}\u0000${row.model}`;
    let entry = byModel.get(key);
    if (!entry) {
      entry = { model: row.model, cli: row.cli, backend: row.backend, totals: emptyTotals() };
      byModel.set(key, entry);
    }
    addTotals(entry.totals, row);
  }
  return Array.from(byModel.values())
    .map(
      (entry): UsageModelBreakdown => ({
        model: entry.model,
        cli: entry.cli,
        backend: entry.backend,
        totals: entry.totals,
        estimatedCost: UNPRICED_COST,
        priced: false,
      }),
    )
    .sort(byTokensDescending);
}

function buildTrend(
  rows: UsageBucketRow[],
  local: LocalTimeResolver,
  granularity: UsageTrendGranularity,
  stackBy: UsageTrendStackBy,
): UsageTrend {
  const points = new Map<string, Map<string, UsageTokenTotals>>();
  const periodOf = periodResolver(local, granularity);
  for (const row of rows) {
    const key = periodOf(Date.parse(row.bucket));
    const group = stackBy === "model" ? row.model : sourceKey(row);
    let groups = points.get(key);
    if (!groups) {
      groups = new Map();
      points.set(key, groups);
    }
    let totals = groups.get(group);
    if (!totals) {
      totals = emptyTotals();
      groups.set(group, totals);
    }
    addTotals(totals, row);
  }

  return {
    granularity,
    stackBy,
    points: Array.from(points.entries())
      .sort(([a], [b]) => compareKeys(a, b))
      .map(([key, groups]) => ({
        key,
        groups: Object.fromEntries(
          Array.from(groups.entries()).map(([group, totals]) => [
            group,
            { totals, estimatedCost: UNPRICED_COST },
          ]),
        ),
      })),
  };
}

function buildDays(rows: UsageBucketRow[], local: LocalTimeResolver): UsageDayBreakdown[] {
  return groupByPeriod(rows, (row) => local.day(Date.parse(row.bucket))).map(
    ([day, bucket]): UsageDayBreakdown => ({
      day,
      totals: bucket.totals,
      estimatedCost: UNPRICED_COST,
      sessionCount: bucket.sessions.size,
      turns: bucket.turns,
    }),
  );
}

function buildMonths(rows: UsageBucketRow[], local: LocalTimeResolver): UsageMonthBreakdown[] {
  return groupByPeriod(rows, (row) => local.month(Date.parse(row.bucket))).map(
    ([month, bucket]): UsageMonthBreakdown => ({
      month,
      totals: bucket.totals,
      estimatedCost: UNPRICED_COST,
      sessionCount: bucket.sessions.size,
      turns: bucket.turns,
    }),
  );
}

interface PeriodBucket {
  totals: UsageTokenTotals;
  sessions: Set<string>;
  turns: number;
}

function groupByPeriod(
  rows: UsageBucketRow[],
  keyOf: (row: UsageBucketRow) => string,
): Array<[string, PeriodBucket]> {
  const periods = new Map<string, PeriodBucket>();
  for (const row of rows) {
    const key = keyOf(row);
    let bucket = periods.get(key);
    if (!bucket) {
      bucket = { totals: emptyTotals(), sessions: new Set(), turns: 0 };
      periods.set(key, bucket);
    }
    addTotals(bucket.totals, row);
    bucket.sessions.add(row.sessionId);
    bucket.turns += row.turns;
  }
  return Array.from(periods.entries()).sort(([a], [b]) => compareKeys(a, b));
}

/** The heatmap always shows the same trailing window, whatever range is selected. */
function buildHeatmap(
  rows: UsageBucketRow[],
  local: LocalTimeResolver,
  today: string,
): UsageHeatmapDay[] {
  const byDay = new Map<string, UsageTokenTotals>();
  const from = shiftDay(today, -(HEATMAP_DAYS - 1));
  for (const row of rows) {
    const day = local.day(Date.parse(row.bucket));
    if (day < from || day > today) continue;
    let totals = byDay.get(day);
    if (!totals) {
      totals = emptyTotals();
      byDay.set(day, totals);
    }
    addTotals(totals, row);
  }

  const days: UsageHeatmapDay[] = [];
  for (let offset = HEATMAP_DAYS - 1; offset >= 0; offset -= 1) {
    const day = shiftDay(today, -offset);
    days.push({ day, totals: byDay.get(day) ?? emptyTotals() });
  }
  return days;
}

function buildProjects(
  rows: UsageBucketRow[],
  attributions: Map<string, UsageProjectAttribution>,
): UsageProjectBreakdown[] {
  const byProject = new Map<
    string,
    {
      attribution: UsageProjectAttribution;
      totals: UsageTokenTotals;
      cwds: Map<string, UsageTokenTotals>;
    }
  >();
  for (const row of rows) {
    const attribution = attributions.get(row.cwd);
    if (!attribution) continue;
    let entry = byProject.get(attribution.rootPath);
    if (!entry) {
      entry = { attribution, totals: emptyTotals(), cwds: new Map() };
      byProject.set(attribution.rootPath, entry);
    }
    addTotals(entry.totals, row);
    let cwdTotals = entry.cwds.get(row.cwd);
    if (!cwdTotals) {
      cwdTotals = emptyTotals();
      entry.cwds.set(row.cwd, cwdTotals);
    }
    addTotals(cwdTotals, row);
  }

  return Array.from(byProject.values())
    .map((entry) => ({
      rootPath: entry.attribution.rootPath,
      displayName: entry.attribution.displayName,
      kind: entry.attribution.kind,
      totals: entry.totals,
      estimatedCost: UNPRICED_COST,
      cwds: Array.from(entry.cwds.entries())
        .map(([cwd, totals]) => ({ cwd, totals, estimatedCost: UNPRICED_COST }))
        .sort(byTokensDescending),
    }))
    .sort(byTokensDescending)
    .slice(0, PROJECT_LIMIT);
}

function matchesFilters(
  row: UsageBucketRow,
  filters: UsageReportFilters | undefined,
  attributions: Map<string, UsageProjectAttribution>,
): boolean {
  if (!filters) return true;
  if (
    filters.sources &&
    !filters.sources.some((source) => source.cli === row.cli && source.backend === row.backend)
  ) {
    return false;
  }
  if (filters.models && !filters.models.includes(row.model)) return false;
  if (filters.projects) {
    const attribution = attributions.get(row.cwd);
    if (!attribution || !filters.projects.includes(attribution.rootPath)) return false;
  }
  return true;
}

function defaultGranularity(
  from: string | null,
  to: string | null,
  today: string,
): UsageTrendGranularity {
  if (!from) return "month";
  const spanDays = dayDifference(from, to ?? today) + 1;
  if (spanDays <= 2) return "hour";
  if (spanDays <= 92) return "day";
  return "month";
}

function periodResolver(
  local: LocalTimeResolver,
  granularity: UsageTrendGranularity,
): (at: number) => string {
  if (granularity === "hour") return (at) => local.hour(at);
  if (granularity === "day") return (at) => local.day(at);
  return (at) => local.month(at);
}

function compareKeys(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function sourceKey(row: UsageBucketRow): string {
  return row.backend ? `${row.cli}:${row.backend}` : row.cli;
}

function billableTokens(totals: UsageTokenTotals): number {
  // Reasoning is a subset of output, so counting it again would double it.
  return totals.input + totals.cachedInput + totals.cacheWrite + totals.output;
}

function byTokensDescending(
  a: { totals: UsageTokenTotals },
  b: { totals: UsageTokenTotals },
): number {
  return billableTokens(b.totals) - billableTokens(a.totals);
}

function emptyTotals(): UsageTokenTotals {
  return { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 };
}

function addTotals(target: UsageTokenTotals, row: UsageTokenTotals): void {
  target.input += row.input;
  target.cachedInput += row.cachedInput;
  target.cacheWrite += row.cacheWrite;
  target.output += row.output;
  target.reasoning += row.reasoning;
}

interface LocalTimeResolver {
  day(at: number): string;
  hour(at: number): string;
  month(at: number): string;
}

/**
 * Buckets are stored in UTC and reported in the client's zone, so every bucket
 * is formatted once per report and reused across the blocks.
 */
function createLocalTimeResolver(timezone: string): LocalTimeResolver {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const cache = new Map<number, string>();
  const hourKey = (at: number): string => {
    const cached = cache.get(at);
    if (cached !== undefined) return cached;
    const parts = formatter.formatToParts(new Date(at));
    const find = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? "";
    const key = `${find("year")}-${find("month")}-${find("day")}T${find("hour")}`;
    cache.set(at, key);
    return key;
  };
  return {
    hour: hourKey,
    day: (at) => hourKey(at).slice(0, 10),
    month: (at) => hourKey(at).slice(0, 7),
  };
}

function shiftDay(day: string, offset: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (date ?? 1) + offset));
  return shifted.toISOString().slice(0, 10);
}

function dayDifference(from: string, to: string): number {
  const parse = (day: string): number => {
    const [year, month, date] = day.split("-").map(Number);
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}
