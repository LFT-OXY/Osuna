import { z } from "zod";
import { UsageCliSchema } from "@getpaseo/protocol/usage/types";

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
 * A turn that has not been settled yet. `settledMs` is how much of its wall
 * clock already reached a bucket row, so a later settlement appends only the
 * remainder. `model` is null until the first assistant message, which is also
 * what makes the turn count.
 */
export const USAGE_OPEN_TURN_SCHEMA = z.object({
  turnKey: z.string(),
  startedAt: z.string(),
  bucket: z.string(),
  lastAt: z.string(),
  settledMs: z.number().int().nonnegative(),
  model: z.string().nullable(),
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

export const CLAUDE_PARSER_STATE_SCHEMA = z.object({
  kind: z.literal("claude"),
  sessionId: z.string().nullable(),
  cwd: z.string().nullable(),
  subagent: z.boolean(),
  forkedFromSessionId: z.string().nullable(),
  openTurn: USAGE_OPEN_TURN_SCHEMA.nullable(),
  lastMessage: USAGE_LAST_MESSAGE_SCHEMA.nullable(),
});
export type ClaudeParserState = z.infer<typeof CLAUDE_PARSER_STATE_SCHEMA>;

export const USAGE_PARSER_STATE_SCHEMA = z.discriminatedUnion("kind", [CLAUDE_PARSER_STATE_SCHEMA]);
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
const KEY_SEPARATOR = "\u0000";

export function bucketRowKey(row: UsageBucketKey): string {
  return [row.cli, row.backend ?? "", row.model, row.sessionId, row.cwd, row.bucket].join(
    KEY_SEPARATOR,
  );
}

/** The `buckets-YYYY-MM.jsonl` a row belongs to, by its UTC bucket. */
export function bucketMonth(bucket: string): string {
  return bucket.slice(0, 7);
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
