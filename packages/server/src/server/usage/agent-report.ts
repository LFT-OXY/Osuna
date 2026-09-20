import type {
  UsageAgentSummary,
  UsageAgentTurn,
  UsageBackfill,
  UsageCli,
  UsageModelAmount,
  UsageTokenTotals,
} from "@getpaseo/protocol/usage/types";
import type { UsageAgentBacking } from "./agent-sessions.js";
import type { UsageReportPricing } from "./report.js";
import { cursorKeyOfSession, sessionCursorKey } from "./sources.js";
import { spanOf, type UsageTurnIndex } from "./turn-rows.js";
import {
  addTotals,
  emptyTotals,
  type UsageBucketRow,
  type UsageScanState,
  type UsageTurnRow,
} from "./types.js";

export interface AgentReportInput {
  /** Null when no agent by that id exists, live or on disk. */
  backing: UsageAgentBacking | null;
  rows: Iterable<UsageBucketRow>;
  turns: UsageTurnIndex;
  scanState: UsageScanState;
  backfill: UsageBackfill;
  pricing: UsageReportPricing;
}

/** What one agent spent across every provider session it has run in. */
export function buildAgentSummary(input: AgentReportInput): UsageAgentSummary {
  const sessions = resolveSessions(input);
  if (!sessions) return emptyAgentSummary();
  const { cli, sessionIds, complete } = sessions;
  const byModel = new Map<string, { totals: UsageTokenTotals; priced: boolean }>();
  let turns = 0;
  let durationMs = 0;
  for (const row of input.rows) {
    if (row.cli !== cli || !sessionIds.includes(row.sessionId)) continue;
    const entry = byModel.get(row.model) ?? {
      totals: emptyTotals(),
      priced: input.pricing.isPriced(row.model),
    };
    addTotals(entry.totals, row);
    byModel.set(row.model, entry);
    turns += row.turns;
    durationMs += row.durationMs;
  }
  const models = Array.from(byModel, ([model, entry]) =>
    toModelAmount(model, entry, input.pricing),
  );
  const span = activitySpanOf(input.scanState, cli, sessionIds);
  return {
    byModel: models,
    totals: sumTotals(models.map((model) => model.totals)),
    estimatedCost: sumCost(models),
    turns,
    durationMs,
    firstAt: span.firstAt,
    lastAt: span.lastAt,
    complete,
  };
}

/** The agent's turns, oldest first. Codex history gets its id stamped later. */
export function buildAgentTurns(input: AgentReportInput): {
  turns: UsageAgentTurn[];
  complete: boolean;
} {
  const sessions = resolveSessions(input);
  if (!sessions) return { turns: [], complete: false };
  const turns: UsageAgentTurn[] = [];
  for (const sessionId of sessions.sessionIds) {
    for (const rows of input.turns.listSession(sessions.cli, sessionId).values()) {
      turns.push(toAgentTurn(rows, input.pricing));
    }
  }
  turns.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return { turns, complete: sessions.complete };
}

interface AgentSessions {
  cli: UsageCli;
  sessionIds: string[];
  complete: boolean;
}

/**
 * The sessions an agent's usage adds up over: its own list, plus the Claude
 * sessions it was resumed from, which the cursors remember. `complete` is false
 * while a scan could still change the answer. Null for an unknown agent, which
 * has no CLI to borrow rows from.
 */
function resolveSessions(input: AgentReportInput): AgentSessions | null {
  if (!input.backing) return null;
  const { cli } = input.backing;
  const sessionIds = expandClaudeChain(input.scanState, cli, input.backing.sessionIds);
  const complete =
    input.backfill.state !== "running" &&
    sessionIds.every((sessionId) => hasScannedSession(input.scanState, cli, sessionId));
  return { cli, sessionIds, complete };
}

/** Claude hands out a new id per resume and records the one it forked from. */
function expandClaudeChain(
  scanState: UsageScanState,
  cli: UsageCli,
  sessionIds: readonly string[],
): string[] {
  const expanded = [...sessionIds];
  if (cli !== "claude") return expanded;
  for (const sessionId of sessionIds) {
    let cursor = scanState.cursors[sessionCursorKey("claude", sessionId)];
    while (cursor?.parser.kind === "claude" && cursor.parser.forkedFromSessionId) {
      const parent = cursor.parser.forkedFromSessionId;
      if (expanded.includes(parent)) break;
      expanded.push(parent);
      cursor = scanState.cursors[sessionCursorKey("claude", parent)];
    }
  }
  return expanded;
}

/**
 * Whether the session's own transcript has been scanned. A subagent file of
 * that session does not count: its cursor says nothing about whether the main
 * thread's tokens are in yet.
 */
function hasScannedSession(scanState: UsageScanState, cli: UsageCli, sessionId: string): boolean {
  return scanState.cursors[sessionCursorKey(cli, sessionId)] !== undefined;
}

/** When the agent's sessions first and last wrote anything, subagents included. */
function activitySpanOf(
  scanState: UsageScanState,
  cli: UsageCli,
  sessionIds: readonly string[],
): { firstAt: string | null; lastAt: string | null } {
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  for (const sessionId of sessionIds) {
    for (const [key, cursor] of Object.entries(scanState.cursors)) {
      if (!cursorKeyOfSession(key, cli, sessionId)) continue;
      if (cursor.firstAt && (firstAt === null || cursor.firstAt < firstAt))
        firstAt = cursor.firstAt;
      if (cursor.lastAt && (lastAt === null || cursor.lastAt > lastAt)) lastAt = cursor.lastAt;
    }
  }
  return { firstAt, lastAt };
}

function toAgentTurn(rows: UsageTurnRow[], pricing: UsageReportPricing): UsageAgentTurn {
  const first = rows[0];
  if (!first) throw new Error("A turn with no rows cannot be reported");
  const span = spanOf(rows);
  const byModel = rows.map((row) =>
    toModelAmount(
      row.model,
      {
        totals: {
          input: row.input,
          cachedInput: row.cachedInput,
          cacheWrite: row.cacheWrite,
          output: row.output,
          reasoning: row.reasoning,
        },
        priced: pricing.isPriced(row.model),
      },
      pricing,
    ),
  );
  const userMessageIds = new Set<string>();
  for (const row of rows) for (const id of row.userMessageIds) userMessageIds.add(id);
  return {
    cli: first.cli,
    backend: first.backend,
    sessionId: first.sessionId,
    turnKey: first.turnKey,
    turnId: rows.find((row) => row.turnId)?.turnId ?? null,
    userMessageIds: Array.from(userMessageIds),
    startedAt: span.startedAt,
    endedAt: span.lastAt,
    durationMs: Math.max(0, Date.parse(span.lastAt) - Date.parse(span.startedAt)),
    byModel,
    totals: sumTotals(byModel.map((model) => model.totals)),
    estimatedCost: sumCost(byModel),
    priced: byModel.every((model) => model.priced),
  };
}

function toModelAmount(
  model: string,
  entry: { totals: UsageTokenTotals; priced: boolean },
  pricing: UsageReportPricing,
): UsageModelAmount {
  return {
    model,
    totals: entry.totals,
    estimatedCost: pricing.estimateCost(entry.totals, model),
    priced: entry.priced,
  };
}

function sumTotals(parts: readonly UsageTokenTotals[]): UsageTokenTotals {
  const totals = emptyTotals();
  for (const part of parts) addTotals(totals, part);
  return totals;
}

function sumCost(parts: readonly UsageModelAmount[]): number {
  return parts.reduce((total, part) => total + part.estimatedCost, 0);
}

function emptyAgentSummary(): UsageAgentSummary {
  return {
    byModel: [],
    totals: emptyTotals(),
    estimatedCost: 0,
    turns: 0,
    durationMs: 0,
    firstAt: null,
    lastAt: null,
    complete: false,
  };
}
