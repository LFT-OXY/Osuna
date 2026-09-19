import type { UsageCli } from "@getpaseo/protocol/usage/types";
import {
  KEY_SEPARATOR,
  addTurnRow,
  turnRowKey,
  type UsageTurnRow,
  type UsageTurnRowDraft,
} from "./types.js";

/** Sum the drafts one read window produced, before any of them has a turn key. */
export function mergeTurnDrafts(drafts: UsageTurnRowDraft[]): UsageTurnRowDraft[] {
  const merged = new Map<string, UsageTurnRowDraft>();
  for (const draft of drafts) {
    const key = [
      draft.cli,
      draft.backend ?? "",
      draft.sessionId,
      draft.turnKey ?? "",
      draft.attachAt ?? "",
      draft.model,
    ].join(KEY_SEPARATOR);
    const existing = merged.get(key);
    if (existing) {
      addTurnRow(existing, draft);
      continue;
    }
    merged.set(key, { ...draft, userMessageIds: [...draft.userMessageIds] });
  }
  return Array.from(merged.values());
}

export interface ResolvedTurnRows {
  rows: UsageTurnRow[];
  /**
   * Drafts no turn covers yet. A Pi/OMP subagent's header is stamped after the
   * last line its parent had written, so a read that lands mid-turn sees a span
   * too short — and by then the subagent file's cursor has passed those lines.
   * The scanner holds these and tries them again as the parent turn grows.
   */
  pending: UsageTurnRowDraft[];
}

/**
 * Name the turn every draft belongs to. A draft that names none and matches no
 * turn of its session comes back as pending rather than as a row; the caller
 * decides when to give up on it, and its tokens are in the bucket rows either
 * way.
 */
export function resolveTurnRows(
  drafts: readonly UsageTurnRowDraft[],
  index: UsageTurnIndex,
): ResolvedTurnRows {
  const resolved: ResolvedTurnRows = { rows: [], pending: [] };
  for (const draft of drafts) {
    const { turnKey, attachAt, ...amounts } = draft;
    const found =
      turnKey ?? (attachAt ? index.findTurnAt(amounts.cli, amounts.sessionId, attachAt) : null);
    if (found) resolved.rows.push({ ...amounts, turnKey: found });
    // A draft that named a key and still missed names a turn nothing wrote;
    // only a draft waiting on a span can be worth another look.
    else if (attachAt && !turnKey) resolved.pending.push(draft);
  }
  return resolved;
}

/**
 * Every turn row the daemon holds, indexed by the session it ran in — which is
 * how a subagent file finds the turn it ran inside. It stores the merged rows
 * themselves, so an increment that widens a turn widens what the next lookup
 * sees.
 */
export class UsageTurnIndex {
  private readonly rows = new Map<string, UsageTurnRow>();
  private readonly sessions = new Map<string, Map<string, UsageTurnRow[]>>();

  add(row: UsageTurnRow): void {
    const key = turnRowKey(row);
    const existing = this.rows.get(key);
    if (existing) {
      addTurnRow(existing, row);
      return;
    }
    const stored: UsageTurnRow = { ...row, userMessageIds: [...row.userMessageIds] };
    this.rows.set(key, stored);
    const session = sessionKey(stored.cli, stored.sessionId);
    let turns = this.sessions.get(session);
    if (!turns) {
      turns = new Map();
      this.sessions.set(session, turns);
    }
    const turn = turns.get(stored.turnKey);
    if (turn) turn.push(stored);
    else turns.set(stored.turnKey, [stored]);
  }

  addAll(rows: readonly UsageTurnRow[]): void {
    for (const row of rows) this.add(row);
  }

  /**
   * One session's turns, each as the rows of the models that ran in it. The
   * rows are the merged ones, so a later increment widens what a caller sees.
   */
  listSession(cli: UsageCli, sessionId: string): ReadonlyMap<string, UsageTurnRow[]> {
    return this.sessions.get(sessionKey(cli, sessionId)) ?? EMPTY_TURNS;
  }

  /**
   * The turn whose wall clock covers `at`, which is how a subagent file that
   * names no turn finds the one it ran inside. Turns of one session do not
   * overlap, so the latest match is the only one that can be right.
   */
  findTurnAt(cli: UsageCli, sessionId: string, at: string): string | null {
    let found: { turnKey: string; startedAt: string } | null = null;
    for (const [turnKey, rows] of this.listSession(cli, sessionId)) {
      const span = spanOf(rows);
      if (at < span.startedAt || at > span.lastAt) continue;
      if (found && found.startedAt >= span.startedAt) continue;
      found = { turnKey, startedAt: span.startedAt };
    }
    return found?.turnKey ?? null;
  }

  /**
   * Whether a turn of this session began after `at`. Turns do not overlap, so
   * once one has, the turn that could have covered `at` is closed and a draft
   * still waiting on it never resolves.
   */
  hasTurnAfter(cli: UsageCli, sessionId: string, at: string): boolean {
    for (const rows of this.listSession(cli, sessionId).values()) {
      if (spanOf(rows).startedAt > at) return true;
    }
    return false;
  }
}

/** A turn runs from the earliest start to the latest end its rows recorded. */
export function spanOf(rows: readonly UsageTurnRow[]): { startedAt: string; lastAt: string } {
  const first = rows[0];
  if (!first) throw new Error("A turn with no rows has no span");
  let startedAt = first.startedAt;
  let lastAt = first.lastAt;
  for (const row of rows) {
    if (row.startedAt < startedAt) startedAt = row.startedAt;
    if (row.lastAt > lastAt) lastAt = row.lastAt;
  }
  return { startedAt, lastAt };
}

const EMPTY_TURNS: ReadonlyMap<string, UsageTurnRow[]> = new Map();

function sessionKey(cli: UsageCli, sessionId: string): string {
  return `${cli}${KEY_SEPARATOR}${sessionId}`;
}
