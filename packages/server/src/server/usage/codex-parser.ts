import {
  asCount,
  asRecord,
  asString,
  asTimestamp,
  countOpenTurn,
  parseChunk,
  recordSpan,
  settleOpenTurn,
  type TimestampSpan,
  type UsageRowIdentity,
  type UsageTokenColumns,
} from "./parse.js";
import {
  toBucketStart,
  type CodexParserState,
  type UsageBucketRow,
  type UsageParseResult,
} from "./types.js";

/** A rollout with no `turn_context` before its first response names no model. */
const UNKNOWN_MODEL = "unknown";

export function createCodexParserState(input: { threadId: string | null }): CodexParserState {
  return {
    kind: "codex",
    sessionId: input.threadId,
    cwd: null,
    subagent: false,
    metaSeen: false,
    model: null,
    usesUsageRecords: false,
    lastUsageKey: null,
    openTurn: null,
  };
}

/** Parse a slice of a Codex rollout file. */
export function parseCodexChunk(bytes: Buffer, state: CodexParserState): UsageParseResult {
  return parseChunk<CodexParserState, CodexEntry>({
    bytes,
    state: { ...state },
    consumeEntry,
  });
}

/** Append the wall clock of a turn whose file has gone quiet. */
export function settleCodexOpenTurn(state: CodexParserState): UsageParseResult {
  const rows: UsageBucketRow[] = [];
  const next: CodexParserState = { ...state };
  settleTurn(next, rows);
  return { rows, state: next, consumedBytes: 0, firstAt: null, lastAt: null };
}

interface CodexEntry {
  timestamp?: unknown;
  type?: unknown;
  payload?: unknown;
}

function consumeEntry(
  entry: CodexEntry,
  state: CodexParserState,
  rows: UsageBucketRow[],
  span: TimestampSpan,
): void {
  // File names carry a local-time stamp and no zone; every time comes from the
  // line itself, which is UTC.
  recordSpan(span, asString(entry.timestamp));
  const payload = asRecord(entry.payload);
  if (!payload) return;
  const timestamp = asTimestamp(entry.timestamp);

  consumeItem(entry.type, payload, state, rows, timestamp);
  // Every line inside a turn moves its end forward, so a turn the CLI never
  // finished still measures to its own last line rather than its last response.
  // A `task_started` has just opened the turn this extends to its own start.
  advanceOpenTurn(state, timestamp);
}

function consumeItem(
  type: unknown,
  payload: Record<string, unknown>,
  state: CodexParserState,
  rows: UsageBucketRow[],
  timestamp: number | null,
): void {
  switch (type) {
    case "session_meta":
      consumeSessionMeta(payload, state);
      return;
    case "turn_context":
      // The only place a model is ever named, written once per turn.
      state.model = asString(payload.model) ?? state.model;
      state.cwd = asString(payload.cwd) ?? state.cwd;
      return;
    case "token_usage_record":
      consumeUsageRecord(payload, state, rows, timestamp);
      return;
    case "event_msg":
      consumeEventMessage(payload, state, rows, timestamp);
      return;
    default:
      return;
  }
}

function advanceOpenTurn(state: CodexParserState, timestamp: number | null): void {
  const openTurn = state.openTurn;
  if (!openTurn || timestamp === null) return;
  const lastAt = new Date(timestamp).toISOString();
  if (lastAt <= openTurn.lastAt) return;
  state.openTurn = { ...openTurn, lastAt };
}

function consumeSessionMeta(payload: Record<string, unknown>, state: CodexParserState): void {
  // A subagent file replays the parent thread's history, second `session_meta`
  // included. Only the first one says whose file this is.
  if (state.metaSeen) return;
  state.metaSeen = true;
  state.cwd = asString(payload.cwd) ?? state.cwd;

  const parentThreadId = readParentThreadId(payload);
  if (parentThreadId) {
    // A subagent's tokens belong to the session that spawned it.
    state.subagent = true;
    state.sessionId = parentThreadId;
    return;
  }
  state.sessionId = asString(payload.id) ?? state.sessionId;
}

function readParentThreadId(payload: Record<string, unknown>): string | null {
  const subagent = asRecord(asRecord(payload.source)?.subagent);
  if (!subagent) return null;
  const threadSpawn = asRecord(subagent.thread_spawn);
  return asString(payload.parent_thread_id) ?? asString(threadSpawn?.parent_thread_id);
}

function consumeEventMessage(
  payload: Record<string, unknown>,
  state: CodexParserState,
  rows: UsageBucketRow[],
  timestamp: number | null,
): void {
  switch (payload.type) {
    case "token_count":
      consumeTokenCount(payload, state, rows, timestamp);
      return;
    case "task_started":
      startTurn(payload, state, rows, timestamp);
      return;
    case "task_complete":
    case "turn_aborted":
      endTurn(payload, state, rows, timestamp);
      return;
    default:
      return;
  }
}

function consumeUsageRecord(
  payload: Record<string, unknown>,
  state: CodexParserState,
  rows: UsageBucketRow[],
  timestamp: number | null,
): void {
  const usage = asRecord(payload.usage);
  if (!usage || timestamp === null) return;
  state.usesUsageRecords = true;
  recordUsage({
    state,
    rows,
    at: timestamp,
    usage,
    key: asString(payload.response_id) ?? usageSignature(usage),
  });
}

function consumeTokenCount(
  payload: Record<string, unknown>,
  state: CodexParserState,
  rows: UsageBucketRow[],
  timestamp: number | null,
): void {
  // From 0.153.2 the same response already arrived as a `token_usage_record`.
  if (state.usesUsageRecords) return;
  // A rate-limit-only snapshot carries no usage at all.
  const info = asRecord(payload.info);
  const usage = asRecord(info?.last_token_usage);
  if (!usage || timestamp === null) return;
  // `total_token_usage` is a per-process running sum that restarts at zero on
  // resume, so each event counts its own `last` instead of a difference.
  recordUsage({ state, rows, at: timestamp, usage, key: usageSignature(usage) });
}

function recordUsage(input: {
  state: CodexParserState;
  rows: UsageBucketRow[];
  at: number;
  usage: Record<string, unknown>;
  key: string;
}): void {
  const { state, rows } = input;
  // Codex repeats an identical usage event now and then; two responses that
  // truly match to the token are rare enough to lose.
  if (state.lastUsageKey === input.key) return;
  state.lastUsageKey = input.key;

  const model = state.model ?? UNKNOWN_MODEL;
  const identity = identityOf(state);
  if (identity.sessionId && identity.cwd) {
    rows.push({
      ...identity,
      model,
      bucket: toBucketStart(input.at),
      ...readUsageColumns(input.usage),
      turns: 0,
      durationMs: 0,
    });
  }

  const openTurn = state.openTurn;
  if (!openTurn || openTurn.model) return;
  state.openTurn = countOpenTurn({ identity, openTurn, model, rows });
}

function readUsageColumns(usage: Record<string, unknown>): UsageTokenColumns {
  const cachedInput = asCount(usage.cached_input_tokens);
  return {
    // `input_tokens` counts the cached input too.
    input: Math.max(0, asCount(usage.input_tokens) - cachedInput),
    cachedInput,
    // Absent before 0.145.
    cacheWrite: asCount(usage.cache_write_input_tokens),
    // `output_tokens` already includes reasoning; reasoning is a display subset.
    output: asCount(usage.output_tokens),
    reasoning: asCount(usage.reasoning_output_tokens),
  };
}

function usageSignature(usage: Record<string, unknown>): string {
  const columns = readUsageColumns(usage);
  return [
    columns.input,
    columns.cachedInput,
    columns.cacheWrite,
    columns.output,
    columns.reasoning,
  ].join("/");
}

function startTurn(
  payload: Record<string, unknown>,
  state: CodexParserState,
  rows: UsageBucketRow[],
  timestamp: number | null,
): void {
  // A subagent runs inside a turn of the thread that spawned it.
  if (state.subagent || timestamp === null) return;
  settleTurn(state, rows);
  const startedAt = new Date(timestamp).toISOString();
  state.openTurn = {
    turnKey: asString(payload.turn_id) ?? startedAt,
    startedAt,
    bucket: toBucketStart(timestamp),
    lastAt: startedAt,
    settledMs: 0,
    model: null,
  };
}

function endTurn(
  payload: Record<string, unknown>,
  state: CodexParserState,
  rows: UsageBucketRow[],
  timestamp: number | null,
): void {
  const openTurn = state.openTurn;
  if (!openTurn || timestamp === null) return;
  const turnId = asString(payload.turn_id);
  if (turnId && turnId !== openTurn.turnKey) return;
  state.openTurn = { ...openTurn, lastAt: new Date(timestamp).toISOString() };
  settleTurn(state, rows);
  // A thread never reopens a turn id, so later lines belong to the next turn.
  state.openTurn = null;
}

function settleTurn(state: CodexParserState, rows: UsageBucketRow[]): void {
  state.openTurn = settleOpenTurn({ identity: identityOf(state), openTurn: state.openTurn, rows });
}

function identityOf(state: CodexParserState): UsageRowIdentity {
  return {
    cli: "codex",
    backend: null,
    sessionId: state.sessionId ?? "",
    cwd: state.cwd ?? "",
  };
}
