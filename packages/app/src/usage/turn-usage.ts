import type {
  UsageAgentSummary,
  UsageAgentTurn,
  UsageTokenTotals,
} from "@osuna/protocol/usage/types";

/**
 * How a rendered turn names itself to the daemon's turn rows. `turnId` is
 * Osuna's own id and only exists for turns the daemon watched close;
 * `userMessageId` is the provider id of the turn's first user message, which
 * is what Claude, Pi and OMP rows carry.
 */
export interface TurnUsageIdentity {
  turnId: string | null;
  userMessageId: string | null;
}

/**
 * `turnId` first, then the first user message id. Neither matching means the
 * turn predates the ids on both sides — the footer then shows no usage rather
 * than the wrong turn's numbers.
 */
export function matchTurnUsage(
  turns: readonly UsageAgentTurn[],
  identity: TurnUsageIdentity,
): UsageAgentTurn | null {
  const { turnId, userMessageId } = identity;
  if (turnId !== null) {
    const byTurnId = turns.find((turn) => turn.turnId === turnId);
    if (byTurnId) return byTurnId;
  }
  if (userMessageId !== null) {
    const byMessageId = turns.find((turn) => turn.userMessageIds.includes(userMessageId));
    if (byMessageId) return byMessageId;
  }
  return null;
}

/**
 * Whether a footer whose row has not arrived should hold space for one.
 *
 * `complete` alone would not do: an agent whose provider the scanner does not
 * read at all — a mock agent, OpenCode, Copilot — is reported as incomplete
 * forever, and every one of its turns would sit on a permanent grey bar. A turn
 * list that already has rows for this agent is the signal that another one is
 * genuinely on its way.
 */
export function isTurnUsagePending(
  payload: { turns: readonly UsageAgentTurn[]; complete: boolean } | undefined,
): boolean {
  if (!payload) return false;
  return !payload.complete && payload.turns.length > 0;
}

/** What the one-line footer segment reads: `↑` uncached input, `↓` output. */
export interface TurnUsageTotals {
  input: number;
  output: number;
  estimatedCost: number;
  priced: boolean;
}

/**
 * `reasoning` is a subset of `output` (`docs/data-model.md`), so `↓` is
 * `output` alone — adding the two would count reasoning twice.
 */
export function summarizeTurnUsage(turn: UsageAgentTurn): TurnUsageTotals {
  return {
    input: turn.totals.input,
    output: turn.totals.output,
    estimatedCost: turn.estimatedCost,
    priced: turn.priced,
  };
}

/** One row of the popover table. `cache` is cache reads plus cache writes. */
export interface TurnUsageAmounts {
  input: number;
  cache: number;
  output: number;
  reasoning: number;
  estimatedCost: number;
  priced: boolean;
}

export interface TurnUsageModelRow extends TurnUsageAmounts {
  model: string;
}

export interface TurnUsageBreakdown {
  rows: TurnUsageModelRow[];
  /** Only when a turn ran more than one model; one model is its own total. */
  total: TurnUsageAmounts | null;
}

function toAmounts(
  totals: UsageTokenTotals,
  estimatedCost: number,
  priced: boolean,
): TurnUsageAmounts {
  return {
    input: totals.input,
    cache: totals.cachedInput + totals.cacheWrite,
    output: totals.output,
    reasoning: totals.reasoning,
    estimatedCost,
    priced,
  };
}

export function buildTurnUsageBreakdown(turn: UsageAgentTurn): TurnUsageBreakdown {
  const rows = turn.byModel.map((entry) => ({
    model: entry.model,
    ...toAmounts(entry.totals, entry.estimatedCost, entry.priced),
  }));
  if (rows.length < 2) {
    return { rows, total: null };
  }
  return { rows, total: toAmounts(turn.totals, turn.estimatedCost, turn.priced) };
}

/**
 * The daemon settles a turn's duration only once its rows land, so a turn that
 * is still running contributes nothing to `durationMs` yet. The client adds the
 * local stopwatch until `usage.updated` replaces the whole number.
 */
export function addRunningTurnElapsed(
  durationMs: number,
  runningTurnStartedAtMs: number | null,
  nowMs: number,
): number {
  if (runningTurnStartedAtMs === null) return durationMs;
  return durationMs + Math.max(0, nowMs - runningTurnStartedAtMs);
}

/**
 * Whether the daemon has anything to say about this agent. An agent whose CLI
 * the scanner does not read reports zeros forever, and a row of zeros reads as
 * "you spent nothing", which is not what the daemon knows.
 */
export function hasAgentUsage(summary: UsageAgentSummary): boolean {
  return summary.turns > 0 || summary.firstAt !== null;
}

/** Wall-clock distance between the agent's first and last logged activity. */
export function resolveSessionSpanMs(summary: UsageAgentSummary): number | null {
  if (!summary.firstAt || !summary.lastAt) return null;
  const from = new Date(summary.firstAt).getTime();
  const to = new Date(summary.lastAt).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, to - from);
}
