import type {
  UsageAmount,
  UsageBackfill,
  UsageDayBreakdown,
  UsageEndpointBreakdown,
  UsageHeatmapDay,
  UsageModelBreakdown,
  UsageMonthBreakdown,
  UsageProjectBreakdown,
  UsageReport,
  UsageSourceBreakdown,
  UsageSummary,
  UsageTokenTotals,
} from "@getpaseo/protocol/usage/types";
import { mergeUsageSpeed, type MergedUsageSpeed, type UsageHostSpeed } from "./speed";
import { totalUsageTokens, usageSourceKey } from "./totals";

/** A project row never merges across hosts, so it carries the host it came from. */
export interface MergedUsageProject extends UsageProjectBreakdown {
  serverId: string;
}

/** Which host's endpoint a card counts; `endpointId: null` is Official. */
export interface UsageEndpointMember {
  serverId: string;
  endpointId: string | null;
  deleted: boolean;
}

/**
 * One endpoint card. Hosts are told apart by name, not id: the same relay set
 * up on two machines has two ids. `key` is null for Official, which adds up
 * across every host.
 */
export interface MergedUsageEndpoint extends Omit<UsageEndpointBreakdown, "endpointId"> {
  key: string | null;
  members: UsageEndpointMember[];
}

export interface MergedUsageReport extends Omit<
  UsageReport,
  "projects" | "trend" | "endpoints" | "speed"
> {
  projects: MergedUsageProject[];
  endpoints?: MergedUsageEndpoint[];
  /** Only when it was asked for and a host with the gateway ledger answered. */
  speed?: MergedUsageSpeed;
}

export interface UsageHostReport {
  serverId: string;
  report: UsageReport;
}

const ZERO_TOTALS: UsageTokenTotals = {
  input: 0,
  cachedInput: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
};

const ZERO_AMOUNT: UsageAmount = { totals: ZERO_TOTALS, estimatedCost: 0 };

export function addUsageTotals(a: UsageTokenTotals, b: UsageTokenTotals): UsageTokenTotals {
  return {
    input: a.input + b.input,
    cachedInput: a.cachedInput + b.cachedInput,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
  };
}

function addAmounts(a: UsageAmount, b: UsageAmount): UsageAmount {
  return {
    totals: addUsageTotals(a.totals, b.totals),
    estimatedCost: a.estimatedCost + b.estimatedCost,
  };
}

function byTokensDesc<T extends { totals: UsageTokenTotals }>(a: T, b: T): number {
  return totalUsageTokens(b.totals) - totalUsageTokens(a.totals);
}

function byKeyAsc(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Folds rows from one more host into an accumulator keyed by something host-independent. */
function foldRows<T>(
  accumulator: Map<string, T>,
  rows: readonly T[],
  keyOf: (row: T) => string,
  combine: (previous: T, next: T) => T,
): void {
  for (const row of rows) {
    const key = keyOf(row);
    const previous = accumulator.get(key);
    accumulator.set(key, previous ? combine(previous, row) : row);
  }
}

function combineSummaries(a: UsageSummary, b: UsageSummary): UsageSummary {
  return {
    totals: addUsageTotals(a.totals, b.totals),
    estimatedCost: a.estimatedCost + b.estimatedCost,
    sessionCount: a.sessionCount + b.sessionCount,
    last7Days: addAmounts(a.last7Days, b.last7Days),
    last30Days: addAmounts(a.last30Days, b.last30Days),
  };
}

function combineModels(a: UsageModelBreakdown, b: UsageModelBreakdown): UsageModelBreakdown {
  return {
    ...a,
    totals: addUsageTotals(a.totals, b.totals),
    estimatedCost: a.estimatedCost + b.estimatedCost,
    // One host without a price for this model makes the merged cost partial.
    priced: a.priced && b.priced,
  };
}

function combineSources(a: UsageSourceBreakdown, b: UsageSourceBreakdown): UsageSourceBreakdown {
  return {
    ...a,
    totals: addUsageTotals(a.totals, b.totals),
    estimatedCost: a.estimatedCost + b.estimatedCost,
  };
}

function combineDays(a: UsageDayBreakdown, b: UsageDayBreakdown): UsageDayBreakdown {
  return {
    day: a.day,
    totals: addUsageTotals(a.totals, b.totals),
    estimatedCost: a.estimatedCost + b.estimatedCost,
    sessionCount: a.sessionCount + b.sessionCount,
    turns: a.turns + b.turns,
  };
}

function combineMonths(a: UsageMonthBreakdown, b: UsageMonthBreakdown): UsageMonthBreakdown {
  return {
    month: a.month,
    totals: addUsageTotals(a.totals, b.totals),
    estimatedCost: a.estimatedCost + b.estimatedCost,
    sessionCount: a.sessionCount + b.sessionCount,
    turns: a.turns + b.turns,
  };
}

function combineHeatmapDays(a: UsageHeatmapDay, b: UsageHeatmapDay): UsageHeatmapDay {
  return { day: a.day, totals: addUsageTotals(a.totals, b.totals) };
}

/**
 * Names some host has two or more live endpoints of. Which of them is the one
 * another host's endpoint stands for can't be told, so no endpoint of such a
 * name joins another host's: each is a card of its own.
 */
function namesNotMerged(reports: readonly UsageHostReport[]): Set<string> {
  const split = new Set<string>();
  for (const { report } of reports) {
    const live = new Set<string>();
    for (const endpoint of report.endpoints ?? []) {
      if (endpoint.endpointId === null || endpoint.deleted || endpoint.name === null) continue;
      if (live.has(endpoint.name)) split.add(endpoint.name);
      live.add(endpoint.name);
    }
  }
  return split;
}

/**
 * The card each of one host's endpoints joins. Across hosts one name is one card
 * (decisions Q17); on one host an endpoint is its id (Q16). A host's live endpoint
 * of a name joins the name's card, or its only one of that name when all are
 * deleted; any other endpoint of that name on the host is a card of its own, as is
 * every endpoint of a name in `split`. `null` is Official.
 */
function endpointKeysOf(input: {
  serverId: string;
  endpoints: readonly UsageEndpointBreakdown[];
  split: ReadonlySet<string>;
}): (string | null)[] {
  const { serverId, endpoints, split } = input;
  const byName = new Map<string, UsageEndpointBreakdown[]>();
  for (const endpoint of endpoints) {
    if (endpoint.endpointId === null || endpoint.name === null) continue;
    byName.set(endpoint.name, [...(byName.get(endpoint.name) ?? []), endpoint]);
  }
  const joining = new Set<UsageEndpointBreakdown>();
  for (const [name, named] of byName) {
    if (split.has(name)) continue;
    const live = named.find((endpoint) => !endpoint.deleted);
    const stand = live ?? (named.length === 1 ? named[0] : undefined);
    if (stand) joining.add(stand);
  }
  return endpoints.map((endpoint) => {
    if (endpoint.endpointId === null) return null;
    if (joining.has(endpoint)) return `name:${endpoint.name}`;
    return `host:${serverId}:${endpoint.endpointId}`;
  });
}

function foldEndpoints(input: {
  target: Map<string | null, MergedUsageEndpoint>;
  serverId: string;
  endpoints: readonly UsageEndpointBreakdown[];
  split: ReadonlySet<string>;
}): void {
  const { target, serverId, endpoints, split } = input;
  const keys = endpointKeysOf({ serverId, endpoints, split });
  for (const [index, { endpointId, ...endpoint }] of endpoints.entries()) {
    const key = keys[index] ?? null;
    const member = { serverId, endpointId, deleted: endpoint.deleted };
    const existing = target.get(key);
    if (!existing) {
      target.set(key, { ...endpoint, key, members: [member] });
      continue;
    }
    // 有一台上还在就不算删了：这家接口还在用。
    target.set(key, {
      ...existing,
      deleted: existing.deleted && endpoint.deleted,
      totals: addUsageTotals(existing.totals, endpoint.totals),
      estimatedCost: existing.estimatedCost + endpoint.estimatedCost,
      members: [...existing.members, member],
    });
  }
}

/** The share is taken again over the sum of every host. */
function resolveEndpoints(
  endpoints: Map<string | null, MergedUsageEndpoint> | null,
): MergedUsageEndpoint[] | undefined {
  if (endpoints === null) return undefined;
  const all = [...endpoints.values()];
  const grandTotal = all.reduce((sum, entry) => sum + totalUsageTokens(entry.totals), 0);
  for (const entry of all) {
    entry.share = grandTotal === 0 ? 0 : totalUsageTokens(entry.totals) / grandTotal;
  }
  return all.sort(byTokensDesc);
}

/** `modelCount` is the count of distinct merged models, never a sum of per-host counts. */
function resolveSources(
  sources: Map<string, UsageSourceBreakdown>,
  models: readonly UsageModelBreakdown[],
  grandTotal: number,
): UsageSourceBreakdown[] {
  const modelCounts = new Map<string, number>();
  for (const model of models) {
    const key = usageSourceKey(model);
    modelCounts.set(key, (modelCounts.get(key) ?? 0) + 1);
  }

  const resolved: UsageSourceBreakdown[] = [];
  for (const [key, source] of sources) {
    resolved.push({
      cli: source.cli,
      backend: source.backend,
      totals: source.totals,
      estimatedCost: source.estimatedCost,
      modelCount: modelCounts.get(key) ?? 0,
      share: grandTotal === 0 ? 0 : totalUsageTokens(source.totals) / grandTotal,
    });
  }
  return resolved.sort(byTokensDesc);
}

/**
 * Adds one report per host into the single report the page renders. Everything
 * keyed by a value that means the same thing on every host is summed; projects
 * are not, because two hosts can hold unrelated directories at the same path.
 */
export function mergeUsageReports(inputs: readonly UsageHostReport[]): MergedUsageReport {
  let summary: UsageSummary = {
    totals: ZERO_TOTALS,
    estimatedCost: 0,
    sessionCount: 0,
    last7Days: ZERO_AMOUNT,
    last30Days: ZERO_AMOUNT,
  };
  const models = new Map<string, UsageModelBreakdown>();
  const sources = new Map<string, UsageSourceBreakdown>();
  const days = new Map<string, UsageDayBreakdown>();
  const months = new Map<string, UsageMonthBreakdown>();
  const heatmapDays = new Map<string, UsageHeatmapDay>();
  const projects: MergedUsageProject[] = [];
  // 只有带中转站账本的 daemon 回 endpoints；一台都没有时整个字段不给。
  let endpoints: Map<string | null, MergedUsageEndpoint> | null = null;
  const split = namesNotMerged(inputs);
  const speeds: UsageHostSpeed[] = [];
  let error: string | null = null;

  for (const { serverId, report } of inputs) {
    summary = combineSummaries(summary, report.summary);
    foldRows(models, report.models, (row) => `${usageSourceKey(row)} ${row.model}`, combineModels);
    foldRows(sources, report.sources, usageSourceKey, combineSources);
    foldRows(days, report.days, (row) => row.day, combineDays);
    foldRows(months, report.months, (row) => row.month, combineMonths);
    foldRows(heatmapDays, report.heatmapDays, (row) => row.day, combineHeatmapDays);
    for (const project of report.projects) {
      projects.push({ ...project, serverId });
    }
    if (report.endpoints) {
      endpoints ??= new Map();
      foldEndpoints({ target: endpoints, serverId, endpoints: report.endpoints, split });
    }
    if (report.speed) speeds.push({ serverId, speed: report.speed });
    error ??= report.error;
  }

  const mergedModels = [...models.values()].sort(byTokensDesc);

  return {
    summary,
    sources: resolveSources(sources, mergedModels, totalUsageTokens(summary.totals)),
    models: mergedModels,
    days: [...days.values()].sort((a, b) => byKeyAsc(a.day, b.day)),
    months: [...months.values()].sort((a, b) => byKeyAsc(a.month, b.month)),
    heatmapDays: [...heatmapDays.values()].sort((a, b) => byKeyAsc(a.day, b.day)),
    projects: projects.sort(byTokensDesc),
    endpoints: resolveEndpoints(endpoints),
    speed: mergeUsageSpeed(speeds),
    backfill: mergeUsageBackfill(inputs.map(({ report }) => report.backfill)),
    error,
  };
}

function resolveBackfillState(entries: readonly UsageBackfill[]): UsageBackfill["state"] {
  if (entries.some((entry) => entry.state === "running")) return "running";
  if (entries.some((entry) => entry.state === "done")) return "done";
  return "idle";
}

/** One pill for every host: still running while any host is still reading files. */
export function mergeUsageBackfill(entries: readonly UsageBackfill[]): UsageBackfill {
  let filesTotal = 0;
  let filesDone = 0;
  let startedAt: string | null = null;

  for (const entry of entries) {
    filesTotal += entry.filesTotal;
    filesDone += entry.filesDone;
    if (entry.startedAt && (startedAt === null || entry.startedAt < startedAt)) {
      startedAt = entry.startedAt;
    }
  }

  return { state: resolveBackfillState(entries), filesTotal, filesDone, startedAt };
}

export const EMPTY_USAGE_REPORT: MergedUsageReport = mergeUsageReports([]);
