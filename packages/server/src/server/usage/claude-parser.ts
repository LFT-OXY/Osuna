import {
  emptyBucketRow,
  mergeBucketRow,
  toBucketStart,
  type ClaudeParserState,
  type UsageBucketRow,
  type UsageLastMessage,
  type UsageOpenTurn,
  type UsageParseResult,
} from "./types.js";

const NEWLINE = 0x0a;
const SYNTHETIC_MODEL = "<synthetic>";

export function createClaudeParserState(input: { subagent: boolean }): ClaudeParserState {
  return {
    kind: "claude",
    sessionId: null,
    cwd: null,
    subagent: input.subagent,
    forkedFromSessionId: null,
    openTurn: null,
    lastMessage: null,
  };
}

/**
 * Parse a slice of a Claude Code transcript.
 *
 * Lines are split on the `\n` byte rather than with `readline`, which treats
 * U+2028 and U+2029 inside JSON strings as line breaks. Only bytes up to the
 * last complete newline are consumed; the caller keeps the rest for the next
 * read.
 */
export function parseClaudeChunk(bytes: Buffer, state: ClaudeParserState): UsageParseResult {
  const lastNewline = bytes.lastIndexOf(NEWLINE);
  if (lastNewline < 0) {
    return { rows: [], state, consumedBytes: 0, firstAt: null, lastAt: null };
  }

  const next: ClaudeParserState = { ...state };
  const rows: UsageBucketRow[] = [];
  const span: TimestampSpan = { firstAt: null, lastAt: null };
  const text = bytes.subarray(0, lastNewline).toString("utf8");
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    const entry = parseLine(line);
    if (entry) consumeEntry(entry, next, rows, span);
  }

  return {
    rows: mergeRows(rows),
    state: next,
    consumedBytes: lastNewline + 1,
    firstAt: span.firstAt,
    lastAt: span.lastAt,
  };
}

interface TimestampSpan {
  firstAt: string | null;
  lastAt: string | null;
}

/**
 * Append the wall clock a still-open turn has accumulated so far. Called when
 * the file has gone quiet; a stop hook that resumes the same turn later appends
 * another segment on top.
 */
export function settleClaudeOpenTurn(state: ClaudeParserState): UsageParseResult {
  const rows: UsageBucketRow[] = [];
  const next: ClaudeParserState = { ...state };
  settleOpenTurn(next, rows);
  return { rows, state: next, consumedBytes: 0, firstAt: null, lastAt: null };
}

interface ClaudeEntry {
  type?: unknown;
  timestamp?: unknown;
  sessionId?: unknown;
  cwd?: unknown;
  promptId?: unknown;
  isSidechain?: unknown;
  isMeta?: unknown;
  isCompactSummary?: unknown;
  isApiErrorMessage?: unknown;
  forkedFrom?: { sessionId?: unknown } | null;
  message?: {
    id?: unknown;
    model?: unknown;
    role?: unknown;
    content?: unknown;
    stop_reason?: unknown;
    usage?: Record<string, unknown> | null;
  } | null;
}

function parseLine(line: string): ClaudeEntry | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null ? (value as ClaudeEntry) : null;
  } catch {
    return null;
  }
}

function consumeEntry(
  entry: ClaudeEntry,
  state: ClaudeParserState,
  rows: UsageBucketRow[],
  span: TimestampSpan,
): void {
  // A resumed session copies the whole previous transcript into the new file.
  // The old file already counted those lines; only the link is worth keeping.
  if (entry.forkedFrom) {
    const forkedFrom = asString(entry.forkedFrom.sessionId);
    if (forkedFrom && !state.forkedFromSessionId) state.forkedFromSessionId = forkedFrom;
    return;
  }

  if (!state.sessionId) state.sessionId = asString(entry.sessionId);
  if (!state.cwd) state.cwd = asString(entry.cwd);
  recordSpan(span, asString(entry.timestamp));

  if (entry.type === "user") {
    consumeUserEntry(entry, state, rows);
    return;
  }
  if (entry.type === "assistant") {
    consumeAssistantEntry(entry, state, rows);
  }
}

function consumeUserEntry(
  entry: ClaudeEntry,
  state: ClaudeParserState,
  rows: UsageBucketRow[],
): void {
  if (state.subagent || entry.isSidechain === true) return;
  if (entry.isCompactSummary === true) return;
  if (isToolResultMessage(entry.message?.content)) return;

  const turnKey = asString(entry.promptId);
  const timestamp = asTimestamp(entry.timestamp);
  if (!turnKey || timestamp === null) return;
  if (state.openTurn?.turnKey === turnKey) return;

  settleOpenTurn(state, rows);
  state.openTurn = {
    turnKey,
    startedAt: new Date(timestamp).toISOString(),
    bucket: toBucketStart(timestamp),
    lastAt: new Date(timestamp).toISOString(),
    settledMs: 0,
    model: null,
  };
}

function consumeAssistantEntry(
  entry: ClaudeEntry,
  state: ClaudeParserState,
  rows: UsageBucketRow[],
): void {
  const message = entry.message;
  const model = asString(message?.model);
  const timestamp = asTimestamp(entry.timestamp);
  if (!message || !model || timestamp === null) return;
  // Synthetic messages are local API-error placeholders with all-zero usage.
  if (model === SYNTHETIC_MODEL || entry.isApiErrorMessage === true) return;

  const usage = message.usage;
  if (usage) {
    const cwd = state.cwd ?? asString(entry.cwd);
    const sessionId = state.sessionId ?? asString(entry.sessionId);
    if (cwd && sessionId) {
      recordUsage({
        state,
        rows,
        sessionId,
        cwd,
        model,
        bucket: toBucketStart(timestamp),
        messageId: asString(message.id),
        usage,
      });
    }
  }

  if (state.subagent || entry.isSidechain === true) return;
  const openTurn = state.openTurn;
  if (!openTurn) return;

  state.openTurn = { ...openTurn, lastAt: new Date(timestamp).toISOString() };
  if (!openTurn.model) {
    state.openTurn = { ...state.openTurn, model };
    rows.push({
      ...emptyBucketRow({
        cli: "claude",
        backend: null,
        model,
        sessionId: state.sessionId ?? "",
        cwd: state.cwd ?? "",
        bucket: openTurn.bucket,
      }),
      turns: 1,
    });
  }

  const stopReason = asString(message.stop_reason);
  if (stopReason && stopReason !== "tool_use") settleOpenTurn(state, rows);
}

interface RecordUsageInput {
  state: ClaudeParserState;
  rows: UsageBucketRow[];
  sessionId: string;
  cwd: string;
  model: string;
  bucket: string;
  messageId: string | null;
  usage: Record<string, unknown>;
}

function recordUsage(input: RecordUsageInput): void {
  const { state, rows } = input;
  const amounts = readUsageColumns(input.usage);
  const recorded: UsageLastMessage = {
    id: input.messageId ?? "",
    model: input.model,
    cwd: input.cwd,
    bucket: input.bucket,
    ...amounts,
  };

  // One API response is split into a line per content block, each repeating the
  // usage; the first blocks carry a start-of-stream snapshot and the last one
  // the final numbers. Replace what the previous line of the group contributed.
  const previous = state.lastMessage;
  if (input.messageId && previous && previous.id === input.messageId) {
    rows.push(toRow(previous, input.sessionId, -1));
    rows.push(toRow(recorded, input.sessionId, 1));
    state.lastMessage = recorded;
    return;
  }

  rows.push(toRow(recorded, input.sessionId, 1));
  state.lastMessage = input.messageId ? recorded : previous;
}

function toRow(message: UsageLastMessage, sessionId: string, sign: 1 | -1): UsageBucketRow {
  return {
    cli: "claude",
    backend: null,
    model: message.model,
    sessionId,
    cwd: message.cwd,
    bucket: message.bucket,
    input: message.input * sign,
    cachedInput: message.cachedInput * sign,
    cacheWrite: message.cacheWrite * sign,
    output: message.output * sign,
    reasoning: message.reasoning * sign,
    turns: 0,
    durationMs: 0,
  };
}

function readUsageColumns(usage: Record<string, unknown>): {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
} {
  const details = usage.output_tokens_details;
  const thinking =
    typeof details === "object" && details !== null
      ? asCount((details as Record<string, unknown>).thinking_tokens)
      : 0;
  return {
    input: asCount(usage.input_tokens),
    cachedInput: asCount(usage.cache_read_input_tokens),
    cacheWrite: asCount(usage.cache_creation_input_tokens),
    // `output_tokens` already includes thinking; reasoning is a display subset.
    output: asCount(usage.output_tokens),
    reasoning: thinking,
  };
}

function settleOpenTurn(state: ClaudeParserState, rows: UsageBucketRow[]): void {
  const openTurn = state.openTurn;
  if (!openTurn?.model) return;
  const pending = elapsedMs(openTurn) - openTurn.settledMs;
  if (pending <= 0) return;

  rows.push({
    ...emptyBucketRow({
      cli: "claude",
      backend: null,
      model: openTurn.model,
      sessionId: state.sessionId ?? "",
      cwd: state.cwd ?? "",
      bucket: openTurn.bucket,
    }),
    durationMs: pending,
  });
  state.openTurn = { ...openTurn, settledMs: openTurn.settledMs + pending };
}

function elapsedMs(openTurn: UsageOpenTurn): number {
  return Date.parse(openTurn.lastAt) - Date.parse(openTurn.startedAt);
}

function isToolResultMessage(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) =>
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "tool_result",
  );
}

function mergeRows(rows: UsageBucketRow[]): UsageBucketRow[] {
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

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function recordSpan(span: TimestampSpan, timestamp: string | null): void {
  if (!timestamp) return;
  if (span.firstAt === null || timestamp < span.firstAt) span.firstAt = timestamp;
  if (span.lastAt === null || timestamp > span.lastAt) span.lastAt = timestamp;
}

function asTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
