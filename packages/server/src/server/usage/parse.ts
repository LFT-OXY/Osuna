import type { UsageCli } from "@getpaseo/protocol/usage/types";
import {
  emptyBucketRow,
  mergeBucketRow,
  type UsageBucketRow,
  type UsageOpenTurn,
  type UsageParseResult,
  type UsageParserState,
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

/**
 * Drive one read window: split it into lines, hand every entry to the source's
 * own consumer, and report what was consumed. `state` is mutated in place, so
 * callers pass a copy of the cursor's state rather than the cursor's own.
 */
export function parseChunk<S extends UsageParserState, E>(input: {
  bytes: Buffer;
  state: S;
  consumeEntry: (entry: E, state: S, rows: UsageBucketRow[], span: TimestampSpan) => void;
}): UsageParseResult {
  const { lines, consumedBytes } = takeCompleteLines(input.bytes);
  if (consumedBytes === 0) {
    return { rows: [], state: input.state, consumedBytes: 0, firstAt: null, lastAt: null };
  }

  const rows: UsageBucketRow[] = [];
  const span: TimestampSpan = { firstAt: null, lastAt: null };
  for (const line of lines) {
    if (line.length === 0) continue;
    const entry = parseJsonLine<E>(line);
    if (entry) input.consumeEntry(entry, input.state, rows, span);
  }

  return {
    rows: mergeRows(rows),
    state: input.state,
    consumedBytes,
    firstAt: span.firstAt,
    lastAt: span.lastAt,
  };
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
 * row. A turn whose model is still unknown never counted, so it settles
 * nothing.
 */
export function settleOpenTurn(input: {
  identity: UsageRowIdentity;
  openTurn: UsageOpenTurn | null;
  rows: UsageBucketRow[];
}): UsageOpenTurn | null {
  const openTurn = input.openTurn;
  if (!openTurn?.model) return openTurn;
  const pending = Date.parse(openTurn.lastAt) - Date.parse(openTurn.startedAt) - openTurn.settledMs;
  if (pending <= 0) return openTurn;

  input.rows.push({
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
  return { ...openTurn, settledMs: openTurn.settledMs + pending };
}
