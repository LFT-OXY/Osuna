import type {
  UsageAgentSummary,
  UsageAgentTurn,
  UsageTokenTotals,
} from "@getpaseo/protocol/usage/types";
import type { UsageText } from "./text";

/**
 * How a rendered turn names itself to the daemon's turn rows. `turnId` is
 * Paseo's own id and only exists for turns the daemon watched close;
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

/** `cache` is cache reads plus cache writes; `reasoning` is already inside `output`. */
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

/** One model is named in a line; more get a per-model list. */
export type TurnUsageModels =
  | { kind: "none" }
  | { kind: "single"; model: TurnUsageModelRow }
  | { kind: "multi"; models: TurnUsageModelRow[] };

/** What the turn usage popover reads. */
export interface TurnUsagePanelModel {
  totals: TurnUsageAmounts;
  models: TurnUsageModels;
  /** Counted at $0 in `totals.estimatedCost`. */
  unpricedModels: string[];
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

function toModelList(rows: TurnUsageModelRow[]): TurnUsageModels {
  const [first] = rows;
  if (rows.length > 1) return { kind: "multi", models: rows };
  if (first) return { kind: "single", model: first };
  return { kind: "none" };
}

export function buildTurnUsagePanel(turn: UsageAgentTurn): TurnUsagePanelModel {
  const rows = turn.byModel.map((entry) => ({
    model: entry.model,
    ...toAmounts(entry.totals, entry.estimatedCost, entry.priced),
  }));
  const totals = toAmounts(turn.totals, turn.estimatedCost, turn.priced);
  const models = toModelList(rows);
  const unpricedRows = rows.filter((row) => !row.priced);
  const unpricedModels = unpricedRows.map((row) => row.model);
  return { totals, models, unpricedModels };
}

/**
 * The popover's footnote for models counted at $0. Two keys chosen here rather
 * than a plural suffix, same as the price table. `separator` is the UI
 * language's list separator; the model ids themselves are never translated.
 */
export function describeUnpricedWarning(models: readonly string[], separator: string): UsageText {
  const key =
    models.length === 1
      ? "message.turnUsage.unpricedWarningOne"
      : "message.turnUsage.unpricedWarningMany";
  const list = models.join(separator);
  return { key, params: { models: { text: list } } };
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
