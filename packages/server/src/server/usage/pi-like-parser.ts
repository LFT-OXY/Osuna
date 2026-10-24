// 服务商是 Osuna 中转站的条目只算账本、计数用的条目照 magpie（https://github.com/yetone/magpie，
// internal/sessions/calls_pi.go 的 piGateway 与 piCall）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { PI_PROVIDER_ID } from "../api-endpoints/pi-config-patch.js";
import {
  asCount,
  asRecord,
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
  type UsageParseSink,
  type UsageRowIdentity,
  type UsageTokenColumns,
} from "./parse.js";
import {
  emptyTotals,
  toBucketStart,
  type PiLikeParserState,
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
    attachAt: null,
    usingProvider: null,
    usingModel: null,
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
  const sink = emptySink();
  const next: PiLikeParserState = { ...state };
  settleTurn(next, sink);
  return idleParseResult(sink, next);
}

interface PiLikeEntry {
  type?: unknown;
  id?: unknown;
  timestamp?: unknown;
  cwd?: unknown;
  parentSession?: unknown;
  message?: unknown;
  /** On Pi's `usage` and OMP's `model_usage` entries, which sit outside the conversation, and on a model change. */
  provider?: unknown;
  model?: unknown;
  usage?: unknown;
  /** Pi's model change names the model here; OMP's writes `<provider>/<model>` in `model`. */
  modelId?: unknown;
}

/**
 * Calls a CLI made outside the conversation, each naming its provider and
 * model: Pi's `usage` (a cache warm-up, say) and OMP's `model_usage` (a title,
 * a `smol` role's auto-thinking). magpie counts both as calls.
 */
const SIDE_CALL_TYPES = new Set(["usage", "model_usage"]);
/** Summaries a CLI asked the model in use for, their usage naming neither provider nor model. */
const SUMMARY_TYPES = new Set(["compaction", "branch_summary"]);

/** An entry's call that names no reply id, with the provider and model it is counted on. */
interface UnmatchableCall {
  entry: PiLikeEntry;
  provider: string | null;
  model: string | null;
  usage: unknown;
  state: PiLikeParserState;
  sink: UsageParseSink;
}

/** What one call the log wrote down cost, and where it ran. */
interface LoggedCall {
  /** The entry's provider as written, before lowercasing. */
  provider: string | null;
  model: string;
  usage: Record<string, unknown>;
  /** Null when the entry names neither a reply id nor an entry id. */
  replyId: string | null;
  /** The entry's own name when the reply is named by its `responseId` (UsageCallDelta). */
  formerReplyId: string | null;
  timestamp: number;
}

function consumeEntry(entry: PiLikeEntry, state: PiLikeParserState, sink: UsageParseSink): void {
  const at = asString(entry.timestamp);
  if (entry.type === "session") {
    consumeHeader(entry, state);
    recordSpan(sink.span, at);
    return;
  }
  if (isCopiedFromParent(state, at)) return;
  recordSpan(sink.span, at);
  const entryType = asString(entry.type);
  if (entryType === "model_change") {
    switchModelTo(entry, state);
    return;
  }
  if (entryType && SIDE_CALL_TYPES.has(entryType)) {
    recordUnmatchableCall({
      entry,
      provider: asString(entry.provider),
      model: asString(entry.model),
      usage: entry.usage,
      state,
      sink,
    });
    return;
  }
  if (entryType && SUMMARY_TYPES.has(entryType)) {
    recordOnModelInUse(entry, entry.usage, state, sink);
    return;
  }
  const message = asRecord(entry.message);
  if (!message) return;

  const timestamp = asTimestamp(entry.timestamp);
  const role = asString(message.role);
  if (role === "user") {
    // A turn ends where the next prompt begins, so the open turn settles
    // against its own last entry rather than against this one.
    startTurn(entry, state, sink, timestamp);
    recordOnModelInUse(entry, message.usage, state, sink);
    return;
  }

  // A turn runs to its own last message. The model switches, credential pins
  // and exit records both CLIs write around it are not part of its wall clock,
  // and a turn the CLI abandoned mid-tool measures to its last message too.
  advanceOpenTurn(state, timestamp);
  if (role !== "assistant") {
    // A tool's result can carry the usage of a call the tool made.
    recordOnModelInUse(entry, message.usage, state, sink);
    return;
  }
  recordAssistant({ message, entryId: asString(entry.id), state, sink, timestamp });
  const stopReason = asString(message.stopReason);
  // A response that stopped to run a tool is still inside its turn, and so is
  // one whose line names no stop reason at all. A turn that ends and then runs
  // on settles again, appending only what it ran beyond the first settlement.
  if (stopReason && stopReason !== TOOL_USE_STOP) settleTurn(state, sink);
}

function consumeHeader(entry: PiLikeEntry, state: PiLikeParserState): void {
  if (state.headerSeen) return;
  state.headerSeen = true;
  // The directory name is an encoding of the cwd that both CLIs rewrite on
  // their own schedule, so the header is the only place it can be read from.
  state.cwd = asString(entry.cwd) ?? state.cwd;
  // A subagent's tokens belong to the session that spawned it, which the
  // directory holding the file already named. Neither CLI writes down the turn
  // it ran inside, so the header's own stamp is what the scanner matches.
  if (state.subagent) state.attachAt = asString(entry.timestamp);
  else state.sessionId = asString(entry.id) ?? state.sessionId;
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
  sink: UsageParseSink,
  timestamp: number | null,
): void {
  // A subagent runs inside a turn of the session that spawned it.
  if (state.subagent || timestamp === null) return;
  settleTurn(state, sink);
  const startedAt = new Date(timestamp).toISOString();
  const entryId = asString(entry.id);
  state.openTurn = {
    turnKey: entryId ?? startedAt,
    startedAt,
    bucket: toBucketStart(timestamp),
    lastAt: startedAt,
    settledMs: 0,
    model: null,
    // The entry that opened the turn is the user message a client shows.
    userMessageIds: entryId ? [entryId] : [],
  };
  state.turnBackend = null;
}

function recordAssistant({
  message,
  entryId,
  state,
  sink,
  timestamp,
}: {
  message: Record<string, unknown>;
  entryId: string | null;
  state: PiLikeParserState;
  sink: UsageParseSink;
  timestamp: number | null;
}): void {
  const usage = asRecord(message.usage);
  if (!usage || timestamp === null) return;
  const provider = asString(message.provider);
  // Both CLIs route to backends the user names themselves, and OMP does not
  // normalize the case it stores them in. A call through Osuna's gateway has
  // no backend of its own: the ledger says which endpoint answered.
  state.backend = isGatewayProvider(provider) ? null : (provider?.toLowerCase() ?? null);
  const namedModel = asString(message.model);
  if (namedModel) {
    state.usingProvider = provider;
    state.usingModel = namedModel;
  }
  const model = namedModel ?? UNKNOWN_MODEL;
  // 回复编号：会话记录里的 responseId 是上游的回复编号，账本记的也是它；没有它的老记录用会话与条目编号。
  const responseId = asString(message.responseId);
  const entryReplyId = replyIdOfEntry(state, entryId);
  recordCall(
    {
      provider,
      model,
      usage,
      replyId: responseId ?? entryReplyId,
      formerReplyId: responseId ? entryReplyId : null,
      timestamp,
    },
    state,
    sink,
  );

  const openTurn = state.openTurn;
  if (!openTurn || openTurn.model) return;
  state.turnBackend = state.backend;
  state.openTurn = countOpenTurn({
    identity: identityOf(state, state.backend),
    openTurn,
    model,
    rows: sink.rows,
  });
}

/**
 * A call that names no reply id: a `usage` or `model_usage` entry on its own
 * provider and model, or a summary's or a tool result's usage on the ones in
 * use. Counted like a reply, inside the turn it was written in, without moving
 * the turn. One through Osuna's gateway can never meet its ledger row and is
 * left to the ledger alone. One with no model or no tokens (a failed call) is
 * no call, as in magpie.
 */
function recordUnmatchableCall(input: UnmatchableCall): void {
  const { entry, provider, model, state, sink } = input;
  const usage = asRecord(input.usage);
  const timestamp = asTimestamp(entry.timestamp);
  if (!usage || !model || timestamp === null || isGatewayProvider(provider)) return;
  if (Object.values(readUsageColumns(usage)).every((value) => value === 0)) return;
  const replyId = replyIdOfEntry(state, asString(entry.id));
  recordCall({ provider, model, usage, replyId, formerReplyId: null, timestamp }, state, sink);
}

function recordOnModelInUse(
  entry: PiLikeEntry,
  usage: unknown,
  state: PiLikeParserState,
  sink: UsageParseSink,
): void {
  recordUnmatchableCall({
    entry,
    provider: state.usingProvider,
    model: state.usingModel,
    usage,
    state,
    sink,
  });
}

/** Pi writes `provider` and `modelId`; OMP writes `<provider>/<model>` in `model`. */
function switchModelTo(entry: PiLikeEntry, state: PiLikeParserState): void {
  const modelId = asString(entry.modelId);
  if (modelId) {
    state.usingProvider = asString(entry.provider);
    state.usingModel = modelId;
    return;
  }
  const named = asString(entry.model);
  const slash = named?.indexOf("/") ?? -1;
  if (!named || slash < 0) return;
  const model = named.slice(slash + 1);
  if (!model) return;
  state.usingProvider = named.slice(0, slash) || null;
  state.usingModel = model;
}

/**
 * Count one call. One through Osuna's gateway goes to no bucket row and no
 * turn's tokens: the ledger counts it, and the call record only carries the
 * reply id, project, session and turn for the merge to move it to (ADR 0014).
 */
function recordCall(call: LoggedCall, state: PiLikeParserState, sink: UsageParseSink): void {
  const amounts = readUsageColumns(call.usage);
  // magpie 丢掉输入、输出、读缓存、写缓存任一列为负的条目。
  const { input, cachedInput, cacheWrite, output } = amounts;
  if ([input, cachedInput, cacheWrite, output].some((value) => value < 0)) return;
  const gatewayOnly = isGatewayProvider(call.provider);
  const backend = gatewayOnly ? null : (call.provider?.toLowerCase() ?? null);
  const identity = identityOf(state, backend);
  const counted = gatewayOnly ? emptyTotals() : amounts;
  const bucket = toBucketStart(call.timestamp);
  if (identity.sessionId && identity.cwd && !gatewayOnly) {
    sink.rows.push({
      ...identity,
      model: call.model,
      bucket,
      ...amounts,
      turns: 0,
      durationMs: 0,
    });
  }
  const attachment = turnAttachmentOf(state);
  const at = new Date(call.timestamp).toISOString();
  pushTurnUsage({ sink, identity, attachment, model: call.model, at, amounts: counted });
  if (call.replyId && identity.sessionId && identity.cwd) {
    sink.calls.push({
      replyId: call.replyId,
      cli: state.kind,
      model: call.model,
      sessionId: identity.sessionId,
      cwd: identity.cwd,
      bucket,
      at,
      turnKey: attachment?.turnKey ?? null,
      amounts,
      gatewayOnly,
      formerReplyId: call.formerReplyId,
    });
  }
}

/** The provider Osuna writes into Pi's and OMP's config for its gateway. */
function isGatewayProvider(provider: string | null): boolean {
  return provider?.toLowerCase() === PI_PROVIDER_ID;
}

/** 条目编号只在一个会话里不重，前面加上会话编号。 */
function replyIdOfEntry(state: PiLikeParserState, entryId: string | null): string | null {
  return entryId && state.sessionId ? `${state.sessionId}/${entryId}` : null;
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

function settleTurn(state: PiLikeParserState, sink: UsageParseSink): void {
  state.openTurn = settleOpenTurn({
    identity: identityOf(state, state.turnBackend),
    openTurn: state.openTurn,
    sink,
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
