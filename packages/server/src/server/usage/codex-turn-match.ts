import type { UsageCli } from "@getpaseo/protocol/usage/types";

/** When one of the agent's turns began, as its durable timeline recorded it. */
export interface AgentTurnTimestamp {
  turnId: string;
  at: string;
}

/**
 * How far a rollout turn's start may sit from the user message that opened it.
 * Codex stamps the rollout when it begins writing, Paseo when it accepts the
 * prompt, and the gap is seconds; half a minute covers it without letting the
 * neighbouring turn win.
 */
const MATCH_WINDOW_MS = 30_000;

/**
 * Give the Codex turns Paseo watched close no id, and the ones it did not — the
 * history a backfill read — the id of the nearest user message. Claude, Pi and
 * OMP name their turn in the log, so nothing is guessed for them.
 */
export function stampCodexTurnIds<
  T extends { cli: UsageCli; startedAt: string; turnId: string | null },
>(turns: readonly T[], timeline: readonly AgentTurnTimestamp[]): T[] {
  if (timeline.length === 0) return [...turns];
  return turns.map((turn) => {
    if (turn.cli !== "codex" || turn.turnId) return turn;
    const turnId = nearestTurnId(timeline, Date.parse(turn.startedAt));
    return turnId ? { ...turn, turnId } : turn;
  });
}

function nearestTurnId(
  timeline: readonly AgentTurnTimestamp[],
  startedAtMs: number,
): string | null {
  if (Number.isNaN(startedAtMs)) return null;
  let best: { turnId: string; distance: number } | null = null;
  for (const entry of timeline) {
    const distance = Math.abs(Date.parse(entry.at) - startedAtMs);
    if (Number.isNaN(distance) || distance > MATCH_WINDOW_MS) continue;
    if (best && best.distance <= distance) continue;
    best = { turnId: entry.turnId, distance };
  }
  return best?.turnId ?? null;
}
