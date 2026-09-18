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
  type PiLikeParserState,
  type UsageBucketRow,
  type UsageParseResult,
} from "./types.js";

/** An assistant message that stopped to run a tool is still inside its turn. */
const TOOL_USE_STOP = "toolUse";
/** A transcript whose assistant lines name no model, which none on record do. */
const UNKNOWN_MODEL = "unknown";

/**
 * OMP is a fork of Pi and writes the same transcript format, so both CLIs share
 * this parser. The differences it has to carry are the header line number (Pi
 * writes it first, OMP puts a rewritable title line ahead of it), the reasoning
 * column's name, and the mixed-case provider ids OMP allows.
 */
export function createPiLikeParserState(input: {
  cli: PiLikeParserState["kind"];
  sessionId: string | null;
  subagent: boolean;
}): PiLikeParserState {
  return {
    kind: input.cli,
    sessionId: input.sessionId,
    cwd: null,
    subagent: input.subagent,
    headerSeen: false,
    copiedBefore: null,
    backend: null,
    turnBackend: null,
    openTurn: null,
  };
}

/** Parse a slice of a Pi or OMP transcript. */
export function parsePiLikeChunk(bytes: Buffer, state: PiLikeParserState): UsageParseResult {
  return parseChunk<PiLikeParserState, PiLikeEntry>({
    bytes,
    state: { ...state },
    consumeEntry,
  });
}

/** Append the wall clock of a turn whose file has gone quiet. */
export function settlePiLikeOpenTurn(state: PiLikeParserState): UsageParseResult {
  const rows: UsageBucketRow[] = [];
  const next: PiLikeParserState = { ...state };
  settleTurn(next, rows);
  return { rows, state: next, consumedBytes: 0, firstAt: null, lastAt: null };
}

interface PiLikeEntry {
  type?: unknown;
  id?: unknown;
  timestamp?: unknown;
  cwd?: unknown;
  parentSession?: unknown;
  message?: unknown;
}

function consumeEntry(
  entry: PiLikeEntry,
  state: PiLikeParserState,
  rows: UsageBucketRow[],
  span: TimestampSpan,
): void {
  const at = asString(entry.timestamp);
  if (entry.type === "session") {
    consumeHeader(entry, state);
    recordSpan(span, at);
    return;
  }
  if (isCopiedFromParent(state, at)) return;
  recordSpan(span, at);
  const message = asRecord(entry.message);
  if (!message) return;

  const timestamp = asTimestamp(entry.timestamp);
  const role = asString(message.role);
  if (role === "user") {
    // A turn ends where the next prompt begins, so the open turn settles
    // against its own last entry rather than against this one.
    startTurn(entry, state, rows, timestamp);
    return;
  }

  // A turn runs to its own last message. The model switches, credential pins
  // and exit records both CLIs write around it are not part of its wall clock,
  // and a turn the CLI abandoned mid-tool measures to its last message too.
  advanceOpenTurn(state, timestamp);
  if (role !== "assistant") return;
  recordAssistant(message, state, rows, timestamp);
  const stopReason = asString(message.stopReason);
  // A response that stopped to run a tool is still inside its turn, and so is
  // one whose line names no stop reason at all. A turn that ends and then runs
  // on settles again, appending only what it ran beyond the first settlement.
  if (stopReason && stopReason !== TOOL_USE_STOP) settleTurn(state, rows);
}

function consumeHeader(entry: PiLikeEntry, state: PiLikeParserState): void {
  if (state.headerSeen) return;
  state.headerSeen = true;
  // The directory name is an encoding of the cwd that both CLIs rewrite on
  // their own schedule, so the header is the only place it can be read from.
  state.cwd = asString(entry.cwd) ?? state.cwd;
  // A subagent's tokens belong to the session that spawned it, which the
  // directory holding the file already named.
  if (!state.subagent) state.sessionId = asString(entry.id) ?? state.sessionId;
  // An OMP branch or `--continue` copies the parent's entries in ahead of its
  // own. They are counted from the parent file, and every copy is stamped
  // before this header — over every such transcript on record, 263 of 263.
  // Pi names a parent too but copies nothing, so the rule stays off for it.
  if (state.kind === "omp" && asString(entry.parentSession)) {
    state.copiedBefore = asString(entry.timestamp);
  }
}

function isCopiedFromParent(state: PiLikeParserState, at: string | null): boolean {
  return state.copiedBefore !== null && at !== null && at < state.copiedBefore;
}

function advanceOpenTurn(state: PiLikeParserState, timestamp: number | null): void {
  const openTurn = state.openTurn;
  if (!openTurn || timestamp === null) return;
  const lastAt = new Date(timestamp).toISOString();
  if (lastAt <= openTurn.lastAt) return;
  state.openTurn = { ...openTurn, lastAt };
}

function startTurn(
  entry: PiLikeEntry,
  state: PiLikeParserState,
  rows: UsageBucketRow[],
  timestamp: number | null,
): void {
  // A subagent runs inside a turn of the session that spawned it.
  if (state.subagent || timestamp === null) return;
  settleTurn(state, rows);
  const startedAt = new Date(timestamp).toISOString();
  state.openTurn = {
    turnKey: asString(entry.id) ?? startedAt,
    startedAt,
    bucket: toBucketStart(timestamp),
    lastAt: startedAt,
    settledMs: 0,
    model: null,
  };
  state.turnBackend = null;
}

function recordAssistant(
  message: Record<string, unknown>,
  state: PiLikeParserState,
  rows: UsageBucketRow[],
  timestamp: number | null,
): void {
  const usage = asRecord(message.usage);
  if (!usage || timestamp === null) return;
  // Both CLIs route to backends the user names themselves, and OMP does not
  // normalize the case it stores them in.
  state.backend = asString(message.provider)?.toLowerCase() ?? null;
  const model = asString(message.model) ?? UNKNOWN_MODEL;
  const identity = identityOf(state, state.backend);
  if (identity.sessionId && identity.cwd) {
    rows.push({
      ...identity,
      model,
      bucket: toBucketStart(timestamp),
      ...readUsageColumns(usage),
      turns: 0,
      durationMs: 0,
    });
  }

  const openTurn = state.openTurn;
  if (!openTurn || openTurn.model) return;
  state.turnBackend = state.backend;
  state.openTurn = countOpenTurn({ identity, openTurn, model, rows });
}

function readUsageColumns(usage: Record<string, unknown>): UsageTokenColumns {
  return {
    // `input` already excludes what was read from cache: all four columns sum
    // to the `totalTokens` both CLIs write next to them.
    input: asCount(usage.input),
    cachedInput: asCount(usage.cacheRead),
    cacheWrite: asCount(usage.cacheWrite),
    // `output` includes reasoning; reasoning is a display subset.
    output: asCount(usage.output),
    // Pi names the column `reasoning`, OMP names it `reasoningTokens`.
    reasoning: "reasoning" in usage ? asCount(usage.reasoning) : asCount(usage.reasoningTokens),
  };
}

function settleTurn(state: PiLikeParserState, rows: UsageBucketRow[]): void {
  state.openTurn = settleOpenTurn({
    identity: identityOf(state, state.turnBackend),
    openTurn: state.openTurn,
    rows,
  });
}

function identityOf(state: PiLikeParserState, backend: string | null): UsageRowIdentity {
  return {
    cli: state.kind,
    backend,
    sessionId: state.sessionId ?? "",
    cwd: state.cwd ?? "",
  };
}
