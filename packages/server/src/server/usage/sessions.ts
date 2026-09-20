import type {
  UsageCli,
  UsageModelAmount,
  UsageProjectRef,
  UsageReportFilters,
  UsageSessionHandle,
  UsageSessionRow,
  UsageTokenTotals,
} from "@getpaseo/protocol/usage/types";
import { createLocalTimeResolver, type LocalTimeResolver } from "./local-time.js";
import type { UsageProjectAttribution } from "./project-attribution.js";
import { matchesUsageFilters, type UsageReportPricing } from "./report.js";
import type { UsageSessionChains } from "./session-chains.js";
import { spanOf, type UsageTurnIndex } from "./turn-rows.js";
import { addTotals, emptyTotals, KEY_SEPARATOR, type UsageBucketRow } from "./types.js";

/**
 * How many sessions one day answers with. A developer runs tens of sessions a
 * day; a machine that shares a home directory with a fleet can run thousands,
 * and the client shows a day's list as one expandable block.
 */
export const USAGE_SESSIONS_PER_DAY_LIMIT = 500;

export interface UsageSessionsRequest {
  from: string | null;
  to: string | null;
  timezone: string;
  filters?: UsageReportFilters;
}

/** The Paseo agent that owns a provider session, if one imported it. */
export interface UsageSessionOwner {
  agentId: string;
  workspaceId: string | null;
}

export interface BuildUsageSessionsInput {
  rows: Iterable<UsageBucketRow>;
  turns: UsageTurnIndex;
  request: UsageSessionsRequest;
  projects: Map<string, UsageProjectAttribution>;
  pricing: UsageReportPricing;
  chains: UsageSessionChains;
  /** Where the CLI resumes this session from, or null once the file is gone. */
  handleOf: (cli: UsageCli, sessionId: string) => UsageSessionHandle | null;
  /** Keyed by `usageSessionOwnerKey`, one entry per id the agent has run under. */
  owners: ReadonlyMap<string, UsageSessionOwner>;
}

export interface UsageSessionsResult {
  sessions: UsageSessionRow[];
  truncated: boolean;
}

export function usageSessionOwnerKey(cli: UsageCli, sessionId: string): string {
  return `${cli}${KEY_SEPARATOR}${sessionId}`;
}

interface ModelAmount {
  totals: UsageTokenTotals;
  estimatedCost: number;
}

/**
 * One session's usage on one local day. A session is keyed by its canonical id,
 * so a Claude resume chain accumulates into one row; `backend` and `cwd` are
 * whichever the day's tokens mostly came from, since a session can switch
 * either mid-flight and the row shows one of each.
 */
interface SessionAccumulator {
  day: string;
  cli: UsageCli;
  sessionId: string;
  models: Map<string, ModelAmount>;
  totals: UsageTokenTotals;
  estimatedCost: number;
  turns: number;
  durationMs: number;
  firstBucket: string;
  lastBucket: string;
  backends: Map<string, number>;
  cwds: Map<string, number>;
}

export function buildUsageSessions(input: BuildUsageSessionsInput): UsageSessionsResult {
  const local = createLocalTimeResolver(input.request.timezone);
  const accumulators = new Map<string, SessionAccumulator>();

  for (const row of input.rows) {
    if (!matchesUsageFilters(row, input.request.filters, input.projects)) continue;
    const day = local.day(Date.parse(row.bucket));
    if (input.request.from && day < input.request.from) continue;
    if (input.request.to && day > input.request.to) continue;
    const sessionId = input.chains.canonical(row.cli, row.sessionId);
    const key = `${row.cli}${KEY_SEPARATOR}${sessionId}${KEY_SEPARATOR}${day}`;
    let accumulator = accumulators.get(key);
    if (!accumulator) {
      accumulator = createAccumulator({ day, cli: row.cli, sessionId, bucket: row.bucket });
      accumulators.set(key, accumulator);
    }
    addRow(accumulator, row, input.pricing.estimateCost(row, row.model));
  }

  const byDay = new Map<string, UsageSessionRow[]>();
  for (const accumulator of accumulators.values()) {
    const rows = byDay.get(accumulator.day) ?? [];
    rows.push(toSessionRow(accumulator, input, local));
    byDay.set(accumulator.day, rows);
  }

  let truncated = false;
  const sessions: UsageSessionRow[] = [];
  for (const rows of byDay.values()) {
    rows.sort(byLastActivityDescending);
    if (rows.length > USAGE_SESSIONS_PER_DAY_LIMIT) truncated = true;
    sessions.push(...rows.slice(0, USAGE_SESSIONS_PER_DAY_LIMIT));
  }
  sessions.sort(byLastActivityDescending);
  return { sessions, truncated };
}

function createAccumulator(input: {
  day: string;
  cli: UsageCli;
  sessionId: string;
  bucket: string;
}): SessionAccumulator {
  return {
    day: input.day,
    cli: input.cli,
    sessionId: input.sessionId,
    models: new Map(),
    totals: emptyTotals(),
    estimatedCost: 0,
    turns: 0,
    durationMs: 0,
    firstBucket: input.bucket,
    lastBucket: input.bucket,
    backends: new Map(),
    cwds: new Map(),
  };
}

function addRow(target: SessionAccumulator, row: UsageBucketRow, cost: number): void {
  let model = target.models.get(row.model);
  if (!model) {
    model = { totals: emptyTotals(), estimatedCost: 0 };
    target.models.set(row.model, model);
  }
  addTotals(model.totals, row);
  model.estimatedCost += cost;
  addTotals(target.totals, row);
  target.estimatedCost += cost;
  target.turns += row.turns;
  target.durationMs += row.durationMs;
  if (row.bucket < target.firstBucket) target.firstBucket = row.bucket;
  if (row.bucket > target.lastBucket) target.lastBucket = row.bucket;
  const tokens = billableTokens(row);
  const backend = row.backend ?? "";
  target.backends.set(backend, (target.backends.get(backend) ?? 0) + tokens);
  target.cwds.set(row.cwd, (target.cwds.get(row.cwd) ?? 0) + tokens);
}

function toSessionRow(
  accumulator: SessionAccumulator,
  input: BuildUsageSessionsInput,
  local: LocalTimeResolver,
): UsageSessionRow {
  const members = input.chains.members(accumulator.cli, accumulator.sessionId);
  const cwd = pickHeaviest(accumulator.cwds);
  const backend = pickHeaviest(accumulator.backends);
  const span = activitySpan({
    turns: input.turns,
    cli: accumulator.cli,
    members,
    day: accumulator.day,
    local,
  });
  const owner = findOwner(input.owners, accumulator.cli, members);
  const models = Array.from(
    accumulator.models,
    ([model, amount]): UsageModelAmount => ({
      model,
      totals: amount.totals,
      estimatedCost: amount.estimatedCost,
      priced: input.pricing.isPriced(model),
    }),
  ).sort((a, b) => billableTokens(b.totals) - billableTokens(a.totals));

  return {
    day: accumulator.day,
    cli: accumulator.cli,
    backend: backend === "" ? null : backend,
    sessionId: accumulator.sessionId,
    cwd,
    project: projectRef(input.projects, cwd),
    models,
    totals: accumulator.totals,
    estimatedCost: accumulator.estimatedCost,
    turns: accumulator.turns,
    durationMs: accumulator.durationMs,
    firstAt: span.firstAt ?? accumulator.firstBucket,
    lastAt: span.lastAt ?? accumulator.lastBucket,
    handle: input.handleOf(accumulator.cli, accumulator.sessionId),
    ...(owner ? { importedAgentId: owner.agentId } : {}),
    ...(owner?.workspaceId ? { importedAgentWorkspaceId: owner.workspaceId } : {}),
  };
}

/**
 * When the session's turns started and last wrote on this day. A turn that ran
 * across midnight belongs to the day it started for `firstAt` and to the day it
 * ended for `lastAt`, so neither stamp can land outside the row's own day.
 */
function activitySpan(input: {
  turns: UsageTurnIndex;
  cli: UsageCli;
  members: readonly string[];
  day: string;
  local: LocalTimeResolver;
}): { firstAt: string | null; lastAt: string | null } {
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  for (const sessionId of input.members) {
    for (const rows of input.turns.listSession(input.cli, sessionId).values()) {
      const span = spanOf(rows);
      if (input.local.day(Date.parse(span.startedAt)) === input.day) {
        if (firstAt === null || span.startedAt < firstAt) firstAt = span.startedAt;
      }
      if (input.local.day(Date.parse(span.lastAt)) === input.day) {
        if (lastAt === null || span.lastAt > lastAt) lastAt = span.lastAt;
      }
    }
  }
  return { firstAt, lastAt };
}

function findOwner(
  owners: ReadonlyMap<string, UsageSessionOwner>,
  cli: UsageCli,
  members: readonly string[],
): UsageSessionOwner | null {
  for (const sessionId of members) {
    const owner = owners.get(usageSessionOwnerKey(cli, sessionId));
    if (owner) return owner;
  }
  return null;
}

/** The caller resolves every row's cwd before building, so a miss is a bug here. */
function projectRef(
  attributions: ReadonlyMap<string, UsageProjectAttribution>,
  cwd: string,
): UsageProjectRef {
  const attribution = attributions.get(cwd);
  if (!attribution) throw new Error(`No project attribution for "${cwd}"`);
  return {
    rootPath: attribution.rootPath,
    displayName: attribution.displayName,
    kind: attribution.kind,
  };
}

/**
 * The value most of the day's tokens came from; the name breaks a tie. An
 * accumulator is only ever created alongside the row that seeds both weight
 * maps, so an empty one means the builder lost a row.
 */
function pickHeaviest(weights: ReadonlyMap<string, number>): string {
  let best: { value: string; weight: number } | null = null;
  for (const [value, weight] of weights) {
    if (best && (weight < best.weight || (weight === best.weight && value >= best.value))) continue;
    best = { value, weight };
  }
  if (!best) throw new Error("A session row was built from no usage rows");
  return best.value;
}

function billableTokens(totals: UsageTokenTotals): number {
  // Reasoning is a subset of output, so counting it again would double it.
  return totals.input + totals.cachedInput + totals.cacheWrite + totals.output;
}

function byLastActivityDescending(a: UsageSessionRow, b: UsageSessionRow): number {
  if (a.lastAt !== b.lastAt) return a.lastAt < b.lastAt ? 1 : -1;
  if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? -1 : 1;
  return 0;
}
