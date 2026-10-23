import type {
  UsageAmount,
  UsageBackfill,
  UsageCli,
  UsageDayBreakdown,
  UsageEndpointBreakdown,
  UsageHeatmapDay,
  UsageModelBreakdown,
  UsageMonthBreakdown,
  UsageProjectBreakdown,
  UsageReport,
  UsageReportFilters,
  UsageSourceBreakdown,
  UsageSourceRef,
  UsageSpeed,
  UsageSpeedGroup,
  UsageSpeedGroupBy,
  UsageTokenTotals,
  UsageTrend,
  UsageTrendGranularity,
  UsageTrendStackBy,
} from "@getpaseo/protocol/usage/types";
import {
  createLocalTimeResolver,
  dayDifference,
  shiftDay,
  type LocalTimeResolver,
} from "./local-time.js";
import type { UsageProjectAttribution } from "./project-attribution.js";
import { groupOutputSpeed } from "./speed.js";
import {
  KEY_SEPARATOR,
  SPEED_COLUMNS,
  addTotals,
  carriesNothing,
  emptyTotals,
  modelRowKey,
  type UsageBucketRow,
  type UsageEndpointIdentity,
} from "./types.js";

const HEATMAP_DAYS = 182;
const PROJECT_LIMIT = 200;

export interface UsageReportRequest {
  from: string | null;
  to: string | null;
  timezone: string;
  filters?: UsageReportFilters;
  trend?: { granularity?: UsageTrendGranularity; stackBy: UsageTrendStackBy };
  speed?: { groupBy: UsageSpeedGroupBy };
}

/**
 * What one model costs and whether the table knows it. The price is memoized
 * per model behind this port; `endpointId` scales it by that endpoint's price
 * multiplier, and an Official row (no endpoint) is not scaled.
 */
export interface UsageReportPricing {
  estimateCost(totals: UsageTokenTotals, model: string, endpointId?: string): number;
  isPriced(model: string): boolean;
}

export interface BuildUsageReportInput {
  rows: UsageBucketRow[];
  request: UsageReportRequest;
  projects: Map<string, UsageProjectAttribution>;
  /** The last name of each endpoint the rows name, and whether it has been deleted. */
  endpointIdentities: ReadonlyMap<string, UsageEndpointIdentity>;
  pricing: UsageReportPricing;
  /**
   * The id a session is counted under. A Claude resume chain is one session in
   * every count on the page, which is also how the session listing rows it.
   */
  canonicalSessionId: (cli: UsageCli, sessionId: string) => string;
  backfill: UsageBackfill;
  error: string | null;
  now: number;
}

/**
 * Cost is summed per row, not derived from a block's totals: two models in one
 * block have two prices, and adding their dollars is the only way to get one
 * number for both.
 */
type PricedRow = UsageBucketRow & { cost: number; canonicalSessionId: string };

export function buildUsageReport(input: BuildUsageReportInput): UsageReport {
  const { request } = input;
  const local = createLocalTimeResolver(request.timezone);
  const today = local.day(input.now);
  const filtered: PricedRow[] = [];
  for (const row of input.rows) {
    if (carriesNothing(row)) continue;
    if (!matchesUsageFilters(row, request.filters, input.projects)) continue;
    filtered.push({
      ...row,
      cost: input.pricing.estimateCost(row, row.model, row.endpointId),
      canonicalSessionId: input.canonicalSessionId(row.cli, row.sessionId),
    });
  }

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
    models: buildModels(inRange, input.pricing),
    trend: buildTrend(inRange, local, granularity, stackBy),
    days: buildDays(inRange, local),
    months: buildMonths(inRange, local),
    heatmapDays: buildHeatmap(filtered, local, today),
    projects: buildProjects(inRange, input.projects),
    endpoints: buildEndpoints(inRange, input.endpointIdentities),
    ...(request.speed
      ? {
          speed: buildSpeed({
            rows: inRange,
            groupBy: request.speed.groupBy,
            identities: input.endpointIdentities,
          }),
        }
      : {}),
    backfill: input.backfill,
    error: input.error,
  };
}

function buildSummary(
  inRange: PricedRow[],
  filtered: PricedRow[],
  local: LocalTimeResolver,
  today: string,
): UsageReport["summary"] {
  const amount = emptyAmount();
  const sessions = new Set<string>();
  for (const row of inRange) {
    addRow(amount, row);
    // 只在账本里的调用没有会话。
    if (row.sessionId !== "") sessions.add(row.canonicalSessionId);
  }
  return {
    totals: amount.totals,
    estimatedCost: amount.estimatedCost,
    sessionCount: sessions.size,
    last7Days: trailingDays(filtered, local, today, 7),
    last30Days: trailingDays(filtered, local, today, 30),
  };
}

function trailingDays(
  rows: PricedRow[],
  local: LocalTimeResolver,
  today: string,
  days: number,
): UsageAmount {
  const from = shiftDay(today, -(days - 1));
  const amount = emptyAmount();
  for (const row of rows) {
    const day = local.day(Date.parse(row.bucket));
    if (day < from || day > today) continue;
    addRow(amount, row);
  }
  return amount;
}

function buildSources(rows: PricedRow[]): UsageSourceBreakdown[] {
  const bySource = new Map<
    string,
    { cli: UsageCli; backend: string | null; amount: UsageAmount; models: Set<string> }
  >();
  for (const row of rows) {
    const key = `${row.cli}\u0000${row.backend ?? ""}`;
    let entry = bySource.get(key);
    if (!entry) {
      entry = { cli: row.cli, backend: row.backend, amount: emptyAmount(), models: new Set() };
      bySource.set(key, entry);
    }
    addRow(entry.amount, row);
    entry.models.add(row.model);
  }

  const grandTotal = Array.from(bySource.values()).reduce(
    (sum, entry) => sum + billableTokens(entry.amount.totals),
    0,
  );
  return Array.from(bySource.values())
    .map((entry) => ({
      cli: entry.cli,
      backend: entry.backend,
      totals: entry.amount.totals,
      estimatedCost: entry.amount.estimatedCost,
      modelCount: entry.models.size,
      share: grandTotal > 0 ? billableTokens(entry.amount.totals) / grandTotal : 0,
    }))
    .sort(byTokensDescending);
}

function buildModels(rows: PricedRow[], pricing: UsageReportPricing): UsageModelBreakdown[] {
  const byModel = new Map<
    string,
    { model: string; cli: UsageCli; backend: string | null; amount: UsageAmount }
  >();
  for (const row of rows) {
    const key = modelRowKey(row);
    let entry = byModel.get(key);
    if (!entry) {
      entry = { model: row.model, cli: row.cli, backend: row.backend, amount: emptyAmount() };
      byModel.set(key, entry);
    }
    addRow(entry.amount, row);
  }
  return (
    Array.from(byModel.values())
      .map(
        (entry): UsageModelBreakdown => ({
          model: entry.model,
          cli: entry.cli,
          backend: entry.backend,
          totals: entry.amount.totals,
          estimatedCost: entry.amount.estimatedCost,
          priced: pricing.isPriced(entry.model),
        }),
      )
      // 同上：调用都被账本挪到接口那边后，只剩轮次的模型不成一行。
      .filter((entry) => hasTokens(entry.totals))
      .sort(byTokensDescending)
  );
}

function buildTrend(
  rows: PricedRow[],
  local: LocalTimeResolver,
  granularity: UsageTrendGranularity,
  stackBy: UsageTrendStackBy,
): UsageTrend {
  const points = new Map<string, Map<string, UsageAmount>>();
  const periodOf = periodResolver(local, granularity);
  for (const row of rows) {
    const key = periodOf(Date.parse(row.bucket));
    const group = stackBy === "model" ? row.model : sourceKey(row);
    let groups = points.get(key);
    if (!groups) {
      groups = new Map();
      points.set(key, groups);
    }
    let amount = groups.get(group);
    if (!amount) {
      amount = emptyAmount();
      groups.set(group, amount);
    }
    addRow(amount, row);
  }

  return {
    granularity,
    stackBy,
    points: Array.from(points.entries())
      .sort(([a], [b]) => compareKeys(a, b))
      .map(([key, groups]) => ({ key, groups: Object.fromEntries(groups) })),
  };
}

function buildDays(rows: PricedRow[], local: LocalTimeResolver): UsageDayBreakdown[] {
  return groupByPeriod(rows, (row) => local.day(Date.parse(row.bucket))).map(
    ([day, bucket]): UsageDayBreakdown => ({
      day,
      totals: bucket.amount.totals,
      estimatedCost: bucket.amount.estimatedCost,
      sessionCount: bucket.sessions.size,
      turns: bucket.turns,
    }),
  );
}

function buildMonths(rows: PricedRow[], local: LocalTimeResolver): UsageMonthBreakdown[] {
  return groupByPeriod(rows, (row) => local.month(Date.parse(row.bucket))).map(
    ([month, bucket]): UsageMonthBreakdown => ({
      month,
      totals: bucket.amount.totals,
      estimatedCost: bucket.amount.estimatedCost,
      sessionCount: bucket.sessions.size,
      turns: bucket.turns,
    }),
  );
}

interface PeriodBucket {
  amount: UsageAmount;
  sessions: Set<string>;
  turns: number;
}

function groupByPeriod(
  rows: PricedRow[],
  keyOf: (row: PricedRow) => string,
): Array<[string, PeriodBucket]> {
  const periods = new Map<string, PeriodBucket>();
  for (const row of rows) {
    const key = keyOf(row);
    let bucket = periods.get(key);
    if (!bucket) {
      bucket = { amount: emptyAmount(), sessions: new Set(), turns: 0 };
      periods.set(key, bucket);
    }
    addRow(bucket.amount, row);
    if (row.sessionId !== "") bucket.sessions.add(row.canonicalSessionId);
    bucket.turns += row.turns;
  }
  return Array.from(periods.entries()).sort(([a], [b]) => compareKeys(a, b));
}

/** The heatmap always shows the same trailing window, whatever range is selected. */
function buildHeatmap(
  rows: PricedRow[],
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
  rows: PricedRow[],
  attributions: Map<string, UsageProjectAttribution>,
): UsageProjectBreakdown[] {
  const byProject = new Map<
    string,
    {
      attribution: UsageProjectAttribution;
      amount: UsageAmount;
      cwds: Map<string, UsageAmount>;
      sources: Map<string, { source: UsageSourceRef; tokens: number }>;
    }
  >();
  for (const row of rows) {
    const attribution = attributions.get(row.cwd);
    if (!attribution) continue;
    let entry = byProject.get(attribution.rootPath);
    if (!entry) {
      entry = { attribution, amount: emptyAmount(), cwds: new Map(), sources: new Map() };
      byProject.set(attribution.rootPath, entry);
    }
    addRow(entry.amount, row);
    let cwdAmount = entry.cwds.get(row.cwd);
    if (!cwdAmount) {
      cwdAmount = emptyAmount();
      entry.cwds.set(row.cwd, cwdAmount);
    }
    addRow(cwdAmount, row);
    const key = `${row.cli}\u0000${row.backend ?? ""}`;
    const source = entry.sources.get(key) ?? {
      source: { cli: row.cli, backend: row.backend },
      tokens: 0,
    };
    source.tokens += billableTokens(row);
    entry.sources.set(key, source);
  }

  return Array.from(byProject.values())
    .map((entry) => ({
      rootPath: entry.attribution.rootPath,
      displayName: entry.attribution.displayName,
      kind: entry.attribution.kind,
      unknown: entry.attribution.unknown,
      totals: entry.amount.totals,
      estimatedCost: entry.amount.estimatedCost,
      sources: Array.from(entry.sources.values())
        .sort((a, b) => b.tokens - a.tokens)
        .map((source) => source.source),
      cwds: Array.from(entry.cwds.entries())
        .map(([cwd, amount]) => ({
          cwd,
          totals: amount.totals,
          estimatedCost: amount.estimatedCost,
        }))
        .sort(byTokensDescending),
    }))
    .sort(byTokensDescending)
    .slice(0, PROJECT_LIMIT);
}

/**
 * One group per endpoint the range ran through, and Official for the calls that
 * went through none. The turn a call ran in stays counted on the log's own row,
 * so a group left with turns and no tokens — every call of it moved to an
 * endpoint — is not one.
 */
function buildEndpoints(
  rows: PricedRow[],
  identities: ReadonlyMap<string, UsageEndpointIdentity>,
): UsageEndpointBreakdown[] {
  const byEndpoint = new Map<string | null, UsageAmount>();
  for (const row of rows) {
    const endpointId = row.endpointId ?? null;
    let amount = byEndpoint.get(endpointId);
    if (!amount) {
      amount = emptyAmount();
      byEndpoint.set(endpointId, amount);
    }
    addRow(amount, row);
  }
  const grandTotal = Array.from(byEndpoint.values()).reduce(
    (total, amount) => total + billableTokens(amount.totals),
    0,
  );
  return Array.from(byEndpoint, ([endpointId, amount]) => {
    const identity = endpointId === null ? null : identities.get(endpointId);
    return {
      endpointId,
      name: endpointId === null ? null : (identity?.name ?? endpointId),
      deleted: identity?.deleted ?? false,
      totals: amount.totals,
      estimatedCost: amount.estimatedCost,
      share: grandTotal > 0 ? billableTokens(amount.totals) / grandTotal : 0,
    };
  })
    .filter((group) => hasTokens(group.totals))
    .sort(byTokensDescending);
}

/**
 * The Speed card's groups: the bucket rows' speed sums added up by the chosen
 * grouping, the fastest first and, at the same speed, the one of more tokens
 * (magpie's ledCategories). A group none of whose requests was timed is not
 * one: only gateway requests that streamed carry timing.
 */
function buildSpeed(input: {
  rows: PricedRow[];
  groupBy: UsageSpeedGroupBy;
  identities: ReadonlyMap<string, UsageEndpointIdentity>;
}): UsageSpeed {
  const { rows, groupBy, identities } = input;
  const groups = new Map<string, UsageSpeedGroup>();
  for (const row of rows) {
    const key = speedKeyOf(row, groupBy);
    let group = groups.get(key);
    if (!group) {
      group = emptySpeedGroup({ row, groupBy, identities });
      groups.set(key, group);
    }
    group.tokens += billableTokens(row);
    for (const column of SPEED_COLUMNS) group[column] += row[column] ?? 0;
  }
  return {
    groupBy,
    groups: Array.from(groups.values())
      .filter((group) => group.ttftCount > 0 || group.speedCount > 0)
      .sort(
        (a, b) => (groupOutputSpeed(b) ?? 0) - (groupOutputSpeed(a) ?? 0) || b.tokens - a.tokens,
      ),
  };
}

function speedKeyOf(row: UsageBucketRow, groupBy: UsageSpeedGroupBy): string {
  const endpointId = row.endpointId ?? "";
  switch (groupBy) {
    case "endpoint":
      return endpointId;
    case "model":
      return row.model;
    case "model_endpoint":
      return `${row.model}${KEY_SEPARATOR}${endpointId}`;
    case "agent":
      return row.cli;
  }
}

function emptySpeedGroup(input: {
  row: UsageBucketRow;
  groupBy: UsageSpeedGroupBy;
  identities: ReadonlyMap<string, UsageEndpointIdentity>;
}): UsageSpeedGroup {
  const { row, groupBy, identities } = input;
  const byAgent = groupBy === "agent";
  const byEndpoint = groupBy === "endpoint" || groupBy === "model_endpoint";
  const byModel = groupBy === "model" || groupBy === "model_endpoint";
  const cli = byAgent ? row.cli : null;
  const model = byModel ? row.model : null;
  const endpoint = byEndpoint ? speedEndpointOf(row.endpointId ?? null, identities) : null;
  return {
    cli,
    model,
    endpoint,
    tokens: 0,
    ttftCount: 0,
    ttftMs: 0,
    speedCount: 0,
    speedOutput: 0,
    speedMs: 0,
  };
}

function speedEndpointOf(
  endpointId: string | null,
  identities: ReadonlyMap<string, UsageEndpointIdentity>,
): NonNullable<UsageSpeedGroup["endpoint"]> {
  if (endpointId === null) return { endpointId, name: null, deleted: false };
  const identity = identities.get(endpointId);
  return { endpointId, name: identity?.name ?? endpointId, deleted: identity?.deleted ?? false };
}

/** The same source / model / project narrowing the session listing applies. */
export function matchesUsageFilters(
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
  if (filters.endpoints && !filters.endpoints.includes(row.endpointId ?? null)) return false;
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

function hasTokens(totals: UsageTokenTotals): boolean {
  return billableTokens(totals) !== 0 || totals.reasoning !== 0;
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

function emptyAmount(): UsageAmount {
  return { totals: emptyTotals(), estimatedCost: 0 };
}

function addRow(target: UsageAmount, row: PricedRow): void {
  addTotals(target.totals, row);
  target.estimatedCost += row.cost;
}
