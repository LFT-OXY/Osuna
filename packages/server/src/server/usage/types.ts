import { z } from "zod";
import { UsageCliSchema, type UsageTokenTotals } from "@osuna/protocol/usage/types";

/** UTC bucket width. Fifteen minutes keeps a year of rows in the thousands. */
export const USAGE_BUCKET_MS = 15 * 60 * 1000;

/**
 * A bucket row is an increment, not a total: one parse pass emits what it just
 * read for a key, and the loader sums same-key rows. Token columns can go
 * negative when a later line corrects an earlier snapshot of the same
 * `message.id`.
 */
export const USAGE_BUCKET_ROW_SCHEMA = z.object({
  cli: UsageCliSchema,
  backend: z.string().nullable(),
  model: z.string(),
  sessionId: z.string(),
  cwd: z.string(),
  bucket: z.string(),
  input: z.number().int(),
  cachedInput: z.number().int(),
  cacheWrite: z.number().int(),
  output: z.number().int(),
  reasoning: z.number().int(),
  turns: z.number().int(),
  durationMs: z.number().int(),
});
export type UsageBucketRow = z.infer<typeof USAGE_BUCKET_ROW_SCHEMA>;

/**
 * One turn's usage, split by the model that produced it. Like a bucket row it
 * is an increment: a turn read across two passes leaves two rows that the
 * loader sums. It carries no cost and no duration — `lastAt - startedAt` is the
 * duration, derived where it is read.
 */
export const USAGE_TURN_ROW_SCHEMA = z.object({
  cli: UsageCliSchema,
  backend: z.string().nullable(),
  sessionId: z.string(),
  /** The CLI's own turn id: Claude `promptId`, Codex `turn_id`, Pi/OMP entry id. */
  turnKey: z.string(),
  model: z.string(),
  input: z.number().int(),
  cachedInput: z.number().int(),
  cacheWrite: z.number().int(),
  output: z.number().int(),
  reasoning: z.number().int(),
  startedAt: z.string(),
  lastAt: z.string(),
  userMessageIds: z.array(z.string()),
  /** Paseo's own turn id, stamped by the parse a finished turn triggered. */
  turnId: z.string().optional(),
});
export type UsageTurnRow = z.infer<typeof USAGE_TURN_ROW_SCHEMA>;

/**
 * A turn row before the scanner has named its turn. A main-thread file always
 * knows the key; a subagent file either reads it off the line (Claude
 * `promptId`, Codex `root_turn_id`) or leaves `attachAt` for the scanner to
 * match against the parent session's turns. A draft that ends up with neither
 * is dropped, and its tokens are only in the bucket rows.
 */
export interface UsageTurnRowDraft extends Omit<UsageTurnRow, "turnKey"> {
  turnKey: string | null;
  attachAt: string | null;
}

/** The five fields that identify a turn row. */
export type UsageTurnKey = Pick<
  UsageTurnRow,
  "cli" | "backend" | "sessionId" | "turnKey" | "model"
>;

/**
 * A turn that has not been settled yet. `settledMs` is how much of its wall
 * clock already reached a bucket row, so a later settlement appends only the
 * remainder. `model` is null until the first assistant message, which is also
 * what makes the turn count. `userMessageIds` is what a client matches its own
 * timeline rows against; a cursor written before turn rows existed has none.
 */
export const USAGE_OPEN_TURN_SCHEMA = z.object({
  turnKey: z.string(),
  startedAt: z.string(),
  bucket: z.string(),
  lastAt: z.string(),
  settledMs: z.number().int().nonnegative(),
  model: z.string().nullable(),
  userMessageIds: z.array(z.string()).default([]),
});
export type UsageOpenTurn = z.infer<typeof USAGE_OPEN_TURN_SCHEMA>;

/**
 * The last deduplicated message and what it contributed. A response is split
 * across several lines that each repeat the usage, and the trailing line holds
 * the final numbers — which may arrive in a later read window, so the recorded
 * amount is carried in the cursor to be corrected by a delta row.
 */
export const USAGE_LAST_MESSAGE_SCHEMA = z.object({
  id: z.string(),
  model: z.string(),
  cwd: z.string(),
  bucket: z.string(),
  input: z.number().int(),
  cachedInput: z.number().int(),
  cacheWrite: z.number().int(),
  output: z.number().int(),
  reasoning: z.number().int(),
});
export type UsageLastMessage = z.infer<typeof USAGE_LAST_MESSAGE_SCHEMA>;

// How a subagent file names the turn its tokens belong to. Both default so a
// cursor written by an earlier daemon still parses; a scan state that fails to
// parse replays every log file and doubles the report.

/** A Claude subagent repeats the parent turn's prompt id in its task prompt. */
const PARENT_TURN_KEY_FIELD = { parentTurnKey: z.string().nullable().default(null) };

/** The other three name no turn, so the file's own start is matched instead. */
const ATTACH_AT_FIELD = { attachAt: z.string().nullable().default(null) };

export const CLAUDE_PARSER_STATE_SCHEMA = z.object({
  kind: z.literal("claude"),
  sessionId: z.string().nullable(),
  cwd: z.string().nullable(),
  subagent: z.boolean(),
  forkedFromSessionId: z.string().nullable(),
  openTurn: USAGE_OPEN_TURN_SCHEMA.nullable(),
  lastMessage: USAGE_LAST_MESSAGE_SCHEMA.nullable(),
  ...PARENT_TURN_KEY_FIELD,
});
export type ClaudeParserState = z.infer<typeof CLAUDE_PARSER_STATE_SCHEMA>;

/**
 * Codex keeps one thread per file. `usesUsageRecords` latches on the first
 * `token_usage_record`: from 0.153.2 the same response is written twice, once
 * as a record and once as a `token_count`, and counting both doubles it.
 * `lastUsageKey` is the previous response's id or usage signature, which is how
 * an adjacent repeat is dropped.
 */
export const CODEX_PARSER_STATE_SCHEMA = z.object({
  kind: z.literal("codex"),
  sessionId: z.string().nullable(),
  cwd: z.string().nullable(),
  subagent: z.boolean(),
  /** A subagent file replays the parent's `session_meta`; only the first one is this file. */
  metaSeen: z.boolean(),
  model: z.string().nullable(),
  usesUsageRecords: z.boolean(),
  lastUsageKey: z.string().nullable(),
  openTurn: USAGE_OPEN_TURN_SCHEMA.nullable(),
  ...ATTACH_AT_FIELD,
});
export type CodexParserState = z.infer<typeof CODEX_PARSER_STATE_SCHEMA>;

/**
 * Pi and OMP write the same transcript format — OMP is a fork of Pi — so one
 * parser reads both and the `kind` says which CLI the file belongs to.
 * `copiedBefore` is set on a branch or `--continue`: those files repeat the
 * parent's entries ahead of their own, every copy stamped before the header.
 * `turnBackend` is the backend the open turn was counted against, kept apart
 * from `backend` so a mid-turn provider switch cannot move the turn's row.
 */
const PI_LIKE_PARSER_FIELDS = {
  sessionId: z.string().nullable(),
  cwd: z.string().nullable(),
  subagent: z.boolean(),
  headerSeen: z.boolean(),
  copiedBefore: z.string().nullable(),
  backend: z.string().nullable(),
  turnBackend: z.string().nullable(),
  openTurn: USAGE_OPEN_TURN_SCHEMA.nullable(),
  ...ATTACH_AT_FIELD,
};

export const PI_PARSER_STATE_SCHEMA = z.object({
  kind: z.literal("pi"),
  ...PI_LIKE_PARSER_FIELDS,
});

export const OMP_PARSER_STATE_SCHEMA = z.object({
  kind: z.literal("omp"),
  ...PI_LIKE_PARSER_FIELDS,
});

export type PiLikeParserState =
  | z.infer<typeof PI_PARSER_STATE_SCHEMA>
  | z.infer<typeof OMP_PARSER_STATE_SCHEMA>;

export const USAGE_PARSER_STATE_SCHEMA = z.discriminatedUnion("kind", [
  CLAUDE_PARSER_STATE_SCHEMA,
  CODEX_PARSER_STATE_SCHEMA,
  PI_PARSER_STATE_SCHEMA,
  OMP_PARSER_STATE_SCHEMA,
]);
export type UsageParserState = z.infer<typeof USAGE_PARSER_STATE_SCHEMA>;

/** One scanned file. The map of these is also the sessionId to path index. */
export const USAGE_SCAN_CURSOR_SCHEMA = z.object({
  cli: UsageCliSchema,
  path: z.string(),
  inode: z.number(),
  size: z.number().int().nonnegative(),
  mtimeMs: z.number(),
  offset: z.number().int().nonnegative(),
  firstAt: z.string().nullable(),
  lastAt: z.string().nullable(),
  parser: USAGE_PARSER_STATE_SCHEMA,
});
export type UsageScanCursor = z.infer<typeof USAGE_SCAN_CURSOR_SCHEMA>;

export const USAGE_SCAN_STATE_SCHEMA = z.object({
  version: z.literal(1),
  cursors: z.record(z.string(), USAGE_SCAN_CURSOR_SCHEMA),
});
export type UsageScanState = z.infer<typeof USAGE_SCAN_STATE_SCHEMA>;

/** The six fields that identify a bucket row. */
export type UsageBucketKey = Pick<
  UsageBucketRow,
  "cli" | "backend" | "model" | "sessionId" | "cwd" | "bucket"
>;

export interface UsageParseResult {
  rows: UsageBucketRow[];
  /** Turn rows a subagent file cannot key yet; the scanner resolves them. */
  turnRows: UsageTurnRowDraft[];
  state: UsageParserState;
  consumedBytes: number;
  /** Entry timestamps seen in this slice, for the cursor's session span. */
  firstAt: string | null;
  lastAt: string | null;
}

/** A path, or one of its parents, is gone — which a live log directory does. */
export function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export function emptyScanState(): UsageScanState {
  return { version: 1, cursors: {} };
}

/** Start of the UTC 15-minute bucket an instant falls in, as an ISO string. */
export function toBucketStart(timestampMs: number): string {
  return new Date(Math.floor(timestampMs / USAGE_BUCKET_MS) * USAGE_BUCKET_MS).toISOString();
}

// cwd and model can hold anything a path or a vendor model id can, so the
// separator has to be a byte neither of them can contain.
export const KEY_SEPARATOR = "\u0000";

export function bucketRowKey(row: UsageBucketKey): string {
  return [row.cli, row.backend ?? "", row.model, row.sessionId, row.cwd, row.bucket].join(
    KEY_SEPARATOR,
  );
}

/** Identifies one model as a report or the price table groups it. */
export function modelRowKey(row: Pick<UsageBucketRow, "cli" | "backend" | "model">): string {
  return [row.cli, row.backend ?? "", row.model].join(KEY_SEPARATOR);
}

/** The `<kind>-YYYY-MM.jsonl` a row belongs to: its bucket, or a turn's start. */
export function rowMonth(timestamp: string): string {
  return timestamp.slice(0, 7);
}

export function turnRowKey(row: UsageTurnKey): string {
  return [row.cli, row.backend ?? "", row.sessionId, row.turnKey, row.model].join(KEY_SEPARATOR);
}

/** Identifies the turn a row belongs to, across the models it ran. */
export function turnKeyOf(row: Pick<UsageTurnRow, "cli" | "sessionId" | "turnKey">): string {
  return [row.cli, row.sessionId, row.turnKey].join(KEY_SEPARATOR);
}

export function emptyTotals(): UsageTokenTotals {
  return { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 };
}

export function addTotals(target: UsageTokenTotals, source: UsageTokenTotals): void {
  target.input += source.input;
  target.cachedInput += source.cachedInput;
  target.cacheWrite += source.cacheWrite;
  target.output += source.output;
  target.reasoning += source.reasoning;
}

export function emptyBucketRow(key: UsageBucketKey): UsageBucketRow {
  return {
    cli: key.cli,
    backend: key.backend,
    model: key.model,
    sessionId: key.sessionId,
    cwd: key.cwd,
    bucket: key.bucket,
    input: 0,
    cachedInput: 0,
    cacheWrite: 0,
    output: 0,
    reasoning: 0,
    turns: 0,
    durationMs: 0,
  };
}

export function addBucketRow(target: UsageBucketRow, source: UsageBucketRow): void {
  target.input += source.input;
  target.cachedInput += source.cachedInput;
  target.cacheWrite += source.cacheWrite;
  target.output += source.output;
  target.reasoning += source.reasoning;
  target.turns += source.turns;
  target.durationMs += source.durationMs;
}

/** Sum `row` into the map's entry for its key, cloning it on first sight. */
export function mergeBucketRow(into: Map<string, UsageBucketRow>, row: UsageBucketRow): void {
  const key = bucketRowKey(row);
  const existing = into.get(key);
  if (existing) {
    addBucketRow(existing, row);
    return;
  }
  into.set(key, { ...row });
}

/** What a turn row carries beyond its key, which a draft carries too. */
export type UsageTurnAmounts = Omit<
  UsageTurnRow,
  "cli" | "backend" | "sessionId" | "turnKey" | "model"
>;

/**
 * Fold an increment into the row it belongs to. Tokens add; the span widens to
 * hold both; the id lists union; a Paseo turn id is kept once it is known.
 */
export function addTurnRow(target: UsageTurnAmounts, source: UsageTurnAmounts): void {
  target.input += source.input;
  target.cachedInput += source.cachedInput;
  target.cacheWrite += source.cacheWrite;
  target.output += source.output;
  target.reasoning += source.reasoning;
  if (source.startedAt < target.startedAt) target.startedAt = source.startedAt;
  if (source.lastAt > target.lastAt) target.lastAt = source.lastAt;
  for (const id of source.userMessageIds) {
    if (!target.userMessageIds.includes(id)) target.userMessageIds.push(id);
  }
  if (!target.turnId && source.turnId) target.turnId = source.turnId;
}

export function mergeTurnRow(into: Map<string, UsageTurnRow>, row: UsageTurnRow): void {
  const key = turnRowKey(row);
  const existing = into.get(key);
  if (existing) {
    addTurnRow(existing, row);
    return;
  }
  into.set(key, { ...row, userMessageIds: [...row.userMessageIds] });
}
