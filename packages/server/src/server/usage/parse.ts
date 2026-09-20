import type { UsageCli } from "@getpaseo/protocol/usage/types";
import { mergeTurnDrafts } from "./turn-rows.js";
import {
  emptyBucketRow,
  mergeBucketRow,
  type UsageBucketRow,
  type UsageOpenTurn,
  type UsageParseResult,
  type UsageParserState,
  type UsageTurnRowDraft,
} from "./types.js";

const NEWLINE = 0x0a;

/** What a parser stamps on every row it emits, apart from model and bucket. */
export interface UsageRowIdentity {
  cli: UsageCli;
  backend: string | null;
  sessionId: string;
  cwd: string;
}

export interface TimestampSpan {
  firstAt: string | null;
  lastAt: string | null;
}

/** The five token columns a line contributes, before it becomes a row. */
export type UsageTokenColumns = Pick<
  UsageBucketRow,
  "input" | "cachedInput" | "cacheWrite" | "output" | "reasoning"
>;

/** What one read window produces: both kinds of row, and the span it saw. */
export interface UsageParseSink {
  rows: UsageBucketRow[];
  turnRows: UsageTurnRowDraft[];
  span: TimestampSpan;
}

/**
 * The turn a line's tokens belong to. A main-thread line has the open turn; a
 * subagent line has whatever its file says about the turn that spawned it,
 * which is either a key or only its own start to be matched against the
 * parent's turns.
 */
export interface TurnAttachment {
  turnKey: string | null;
  attachAt: string | null;
  /** Null for a subagent line, which knows no clock but its own. */
  startedAt: string | null;
  userMessageIds: readonly string[];
}

/**
 * Where the line being read attaches. A main-thread line joins the open turn;
 * a subagent line joins whatever its file says about the turn that spawned it,
 * and nothing at all when the file says neither — its tokens then stay in the
 * bucket rows alone. `parentTurnKey` is passed in by a source that reads the
 * key off the line rather than off its state, which is what Codex does.
 */
export function turnAttachmentOf(
  state: {
    subagent: boolean;
    openTurn: UsageOpenTurn | null;
    parentTurnKey?: string | null;
    attachAt?: string | null;
  },
  parentTurnKey: string | null = null,
): TurnAttachment | null {
  if (!state.subagent) {
    return state.openTurn ? openTurnAttachment(state.openTurn) : null;
  }
  const turnKey = parentTurnKey ?? state.parentTurnKey ?? null;
  const attachAt = state.attachAt ?? null;
  if (!turnKey && !attachAt) return null;
  return { turnKey, attachAt, startedAt: null, userMessageIds: [] };
}

function openTurnAttachment(openTurn: UsageOpenTurn): TurnAttachment {
  return {
    turnKey: openTurn.turnKey,
    attachAt: null,
    startedAt: openTurn.startedAt,
    userMessageIds: openTurn.userMessageIds,
  };
}

/** What a parser returns when it settled an idle turn instead of reading bytes. */
export function idleParseResult<S extends UsageParserState>(
  sink: UsageParseSink,
  state: S,
): UsageParseResult {
  return {
    rows: sink.rows,
    turnRows: sink.turnRows,
    state,
    consumedBytes: 0,
    firstAt: null,
    lastAt: null,
  };
}

/**
 * Drive one read window: split it into lines, hand every entry to the source's
 * own consumer, and report what was consumed. `state` is mutated in place, so
 * callers pass a copy of the cursor's state rather than the cursor's own.
 */
export function parseChunk<S extends UsageParserState, E>(input: {
  bytes: Buffer;
  state: S;
  consumeEntry: (entry: E, state: S, sink: UsageParseSink) => void;
}): UsageParseResult {
  const { lines, consumedBytes } = takeCompleteLines(input.bytes);
  if (consumedBytes === 0) {
    return {
      rows: [],
      turnRows: [],
      state: input.state,
      consumedBytes: 0,
      firstAt: null,
      lastAt: null,
    };
  }

  const sink = emptySink();
  for (const line of lines) {
    if (line.length === 0) continue;
    const entry = parseJsonLine<E>(line);
    if (entry) input.consumeEntry(entry, input.state, sink);
  }

  return {
    rows: mergeRows(sink.rows),
    turnRows: mergeTurnDrafts(sink.turnRows),
    state: input.state,
    consumedBytes,
    firstAt: sink.span.firstAt,
    lastAt: sink.span.lastAt,
  };
}

export function emptySink(): UsageParseSink {
  return { rows: [], turnRows: [], span: { firstAt: null, lastAt: null } };
}

/**
 * Lines up to the last complete `\n`, and the bytes they took. Splitting on the
 * byte rather than with `readline` keeps U+2028 and U+2029 inside a JSON string
 * from ending a line; the caller keeps the remainder for the next read.
 */
export function takeCompleteLines(bytes: Buffer): { lines: string[]; consumedBytes: number } {
  const lastNewline = bytes.lastIndexOf(NEWLINE);
  if (lastNewline < 0) return { lines: [], consumedBytes: 0 };
  return {
    lines: bytes.subarray(0, lastNewline).toString("utf8").split("\n"),
    consumedBytes: lastNewline + 1,
  };
}

/** Null for a line a CLI wrote half of, or one that is not a JSON object. */
export function parseJsonLine<T>(line: string): T | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null ? (value as T) : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export function recordSpan(span: TimestampSpan, timestamp: string | null): void {
  if (!timestamp) return;
  if (span.firstAt === null || timestamp < span.firstAt) span.firstAt = timestamp;
  if (span.lastAt === null || timestamp > span.lastAt) span.lastAt = timestamp;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

export function asTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Sum same-key rows and drop the ones left carrying nothing. */
export function mergeRows(rows: UsageBucketRow[]): UsageBucketRow[] {
  const merged = new Map<string, UsageBucketRow>();
  for (const row of rows) mergeBucketRow(merged, row);
  return Array.from(merged.values()).filter(
    (row) =>
      row.input !== 0 ||
      row.cachedInput !== 0 ||
      row.cacheWrite !== 0 ||
      row.output !== 0 ||
      row.reasoning !== 0 ||
      row.turns !== 0 ||
      row.durationMs !== 0,
  );
}

/**
 * Add what one response contributed to the turn it ran in. `at` is the
 * response's own timestamp, which both ends the turn row's span and starts it
 * for a subagent row that knows nothing earlier.
 */
export function pushTurnUsage(input: {
  sink: UsageParseSink;
  identity: UsageRowIdentity;
  attachment: TurnAttachment | null;
  model: string;
  at: string;
  amounts: UsageTokenColumns;
}): void {
  const { attachment, identity } = input;
  if (!attachment || !identity.sessionId) return;
  const startedAt = attachment.startedAt ?? input.at;
  input.sink.turnRows.push({
    cli: identity.cli,
    backend: identity.backend,
    sessionId: identity.sessionId,
    turnKey: attachment.turnKey,
    attachAt: attachment.attachAt,
    model: input.model,
    ...input.amounts,
    startedAt: startedAt < input.at ? startedAt : input.at,
    lastAt: input.at,
    userMessageIds: [...attachment.userMessageIds],
  });
}

/**
 * Count a turn the moment its model becomes known, against the bucket the turn
 * started in rather than the one its first response landed in.
 */
export function countOpenTurn(input: {
  identity: UsageRowIdentity;
  openTurn: UsageOpenTurn;
  model: string;
  rows: UsageBucketRow[];
}): UsageOpenTurn {
  input.rows.push({
    ...emptyBucketRow({
      cli: input.identity.cli,
      backend: input.identity.backend,
      model: input.model,
      sessionId: input.identity.sessionId,
      cwd: input.identity.cwd,
      bucket: input.openTurn.bucket,
    }),
    turns: 1,
  });
  return { ...input.openTurn, model: input.model };
}

/**
 * Append the wall clock a turn has run beyond what already reached a bucket
 * row, and carry the same end into its turn row so the two agree by
 * construction. A turn whose model is still unknown never counted, so it
 * settles nothing.
 */
export function settleOpenTurn(input: {
  identity: UsageRowIdentity;
  openTurn: UsageOpenTurn | null;
  sink: UsageParseSink;
}): UsageOpenTurn | null {
  const openTurn = input.openTurn;
  if (!openTurn?.model) return openTurn;
  const pending = Date.parse(openTurn.lastAt) - Date.parse(openTurn.startedAt) - openTurn.settledMs;
  if (pending <= 0) return openTurn;

  input.sink.rows.push({
    ...emptyBucketRow({
      cli: input.identity.cli,
      backend: input.identity.backend,
      model: openTurn.model,
      sessionId: input.identity.sessionId,
      cwd: input.identity.cwd,
      bucket: openTurn.bucket,
    }),
    durationMs: pending,
  });
  pushTurnUsage({
    sink: input.sink,
    identity: input.identity,
    attachment: openTurnAttachment(openTurn),
    model: openTurn.model,
    at: openTurn.lastAt,
    amounts: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 },
  });
  return { ...openTurn, settledMs: openTurn.settledMs + pending };
}
