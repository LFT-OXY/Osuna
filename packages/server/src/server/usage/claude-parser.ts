import {
  asCount,
  asString,
  asTimestamp,
  countOpenTurn,
  emptySink,
  idleParseResult,
  parseChunk,
  pushTurnUsage,
  recordSpan,
  settleOpenTurn,
  turnAttachmentOf,
  type TurnAttachment,
  type UsageParseSink,
  type UsageRowIdentity,
  type UsageTokenColumns,
} from "./parse.js";
import {
  toBucketStart,
  type ClaudeParserState,
  type UsageLastMessage,
  type UsageParseResult,
} from "./types.js";

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
    parentTurnKey: null,
  };
}

/** Parse a slice of a Claude Code transcript. */
export function parseClaudeChunk(bytes: Buffer, state: ClaudeParserState): UsageParseResult {
  return parseChunk<ClaudeParserState, ClaudeEntry>({
    bytes,
    state: { ...state },
    consumeEntry,
  });
}

/**
 * Append the wall clock a still-open turn has accumulated so far. Called when
 * the file has gone quiet; a stop hook that resumes the same turn later appends
 * another segment on top.
 */
export function settleClaudeOpenTurn(state: ClaudeParserState): UsageParseResult {
  const sink = emptySink();
  const next: ClaudeParserState = { ...state };
  settleTurn(next, sink);
  return idleParseResult(sink, next);
}

interface ClaudeEntry {
  type?: unknown;
  timestamp?: unknown;
  uuid?: unknown;
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

function consumeEntry(entry: ClaudeEntry, state: ClaudeParserState, sink: UsageParseSink): void {
  // A resumed session copies the whole previous transcript into the new file.
  // The old file already counted those lines; only the link is worth keeping.
  if (entry.forkedFrom) {
    const forkedFrom = asString(entry.forkedFrom.sessionId);
    if (forkedFrom && !state.forkedFromSessionId) state.forkedFromSessionId = forkedFrom;
    return;
  }

  if (!state.sessionId) state.sessionId = asString(entry.sessionId);
  if (!state.cwd) state.cwd = asString(entry.cwd);
  // A Claude subagent is keyed by the prompt id its task prompt repeats, so
  // there is no fallback to matching by time.
  recordSpan(sink.span, asString(entry.timestamp));

  if (entry.type === "user") {
    consumeUserEntry(entry, state, sink);
    return;
  }
  if (entry.type === "assistant") {
    consumeAssistantEntry(entry, state, sink);
  }
}

function consumeUserEntry(
  entry: ClaudeEntry,
  state: ClaudeParserState,
  sink: UsageParseSink,
): void {
  if (entry.isCompactSummary === true) return;
  if (isToolResultMessage(entry.message?.content)) return;
  const turnKey = asString(entry.promptId);

  if (state.subagent) {
    // The task prompt repeats the prompt id of the turn that spawned it, which
    // is the only place the link to the parent turn is written down.
    if (turnKey && !state.parentTurnKey) state.parentTurnKey = turnKey;
    return;
  }
  if (entry.isSidechain === true) return;

  const timestamp = asTimestamp(entry.timestamp);
  if (!turnKey || timestamp === null) return;
  // A prompt can be written as several user lines — the prompt itself plus the
  // meta lines around it — and a client matches its timeline against all of them.
  if (state.openTurn?.turnKey === turnKey) {
    state.openTurn = withUserMessageId(state.openTurn, asString(entry.uuid));
    return;
  }

  settleTurn(state, sink);
  const startedAt = new Date(timestamp).toISOString();
  const uuid = asString(entry.uuid);
  state.openTurn = {
    turnKey,
    startedAt,
    bucket: toBucketStart(timestamp),
    lastAt: startedAt,
    settledMs: 0,
    model: null,
    userMessageIds: uuid ? [uuid] : [],
  };
}

function consumeAssistantEntry(
  entry: ClaudeEntry,
  state: ClaudeParserState,
  sink: UsageParseSink,
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
        sink,
        sessionId,
        cwd,
        model,
        at: new Date(timestamp).toISOString(),
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
    state.openTurn = countOpenTurn({
      identity: identityOf(state),
      openTurn: state.openTurn,
      model,
      rows: sink.rows,
    });
  }

  const stopReason = asString(message.stop_reason);
  if (stopReason && stopReason !== "tool_use") settleTurn(state, sink);
}

interface RecordUsageInput {
  state: ClaudeParserState;
  sink: UsageParseSink;
  sessionId: string;
  cwd: string;
  model: string;
  at: string;
  bucket: string;
  messageId: string | null;
  usage: Record<string, unknown>;
}

function recordUsage(input: RecordUsageInput): void {
  const { state } = input;
  const amounts = readUsageColumns(input.usage);
  const recorded: UsageLastMessage = {
    id: input.messageId ?? "",
    model: input.model,
    cwd: input.cwd,
    bucket: input.bucket,
    ...amounts,
  };
  // Every line of one response group falls inside the turn the group started
  // in, so the correction below reverses against the same turn it counted.
  const attachment = turnAttachmentOf(state);

  // One API response is split into a line per content block, each repeating the
  // usage; the first blocks carry a start-of-stream snapshot and the last one
  // the final numbers. Replace what the previous line of the group contributed.
  const previous = state.lastMessage;
  if (input.messageId && previous && previous.id === input.messageId) {
    pushUsage(input, attachment, previous, -1);
    pushUsage(input, attachment, recorded, 1);
    state.lastMessage = recorded;
    return;
  }

  pushUsage(input, attachment, recorded, 1);
  state.lastMessage = input.messageId ? recorded : previous;
}

function pushUsage(
  input: RecordUsageInput,
  attachment: TurnAttachment | null,
  message: UsageLastMessage,
  sign: 1 | -1,
): void {
  const amounts: UsageTokenColumns = {
    input: message.input * sign,
    cachedInput: message.cachedInput * sign,
    cacheWrite: message.cacheWrite * sign,
    output: message.output * sign,
    reasoning: message.reasoning * sign,
  };
  input.sink.rows.push({
    cli: "claude",
    backend: null,
    model: message.model,
    sessionId: input.sessionId,
    cwd: message.cwd,
    bucket: message.bucket,
    ...amounts,
    turns: 0,
    durationMs: 0,
  });
  pushTurnUsage({
    sink: input.sink,
    identity: { cli: "claude", backend: null, sessionId: input.sessionId, cwd: message.cwd },
    attachment,
    model: message.model,
    at: input.at,
    amounts,
  });
}

function readUsageColumns(usage: Record<string, unknown>): UsageTokenColumns {
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

function settleTurn(state: ClaudeParserState, sink: UsageParseSink): void {
  state.openTurn = settleOpenTurn({
    identity: identityOf(state),
    openTurn: state.openTurn,
    sink,
  });
}

function withUserMessageId(
  openTurn: NonNullable<ClaudeParserState["openTurn"]>,
  uuid: string | null,
): NonNullable<ClaudeParserState["openTurn"]> {
  if (!uuid || openTurn.userMessageIds.includes(uuid)) return openTurn;
  return { ...openTurn, userMessageIds: [...openTurn.userMessageIds, uuid] };
}

function identityOf(state: ClaudeParserState): UsageRowIdentity {
  return {
    cli: "claude",
    backend: null,
    sessionId: state.sessionId ?? "",
    cwd: state.cwd ?? "",
  };
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
