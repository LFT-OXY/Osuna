import type { UsageCli, UsageTokenTotals } from "@getpaseo/protocol/usage/types";
import type { GatewayLedgerRow, UsageCliCall, UsageRequestRecord } from "./ledger.js";
import {
  KEY_SEPARATOR,
  addTotals,
  emptyBucketRow,
  emptyTotals,
  toBucketStart,
  type UsageBucketKey,
  type UsageBucketRow,
  type UsageCallDelta,
  type UsageTurnRow,
} from "./types.js";

/** What one merge step adds: increments for both row kinds, and the records to keep. */
export interface UsageMergeOutput {
  buckets: UsageBucketRow[];
  turns: UsageTurnRow[];
  records: UsageRequestRecord[];
}

/** One call as far as the two sides have told it. */
interface MergedCall {
  cli: UsageCliCall | null;
  ledger: GatewayLedgerRow | null;
}

/**
 * Folds the gateway ledger into the rows the CLI logs produce (ADR 0014). A
 * call both sides know is counted once, at the log's project, session and turn,
 * with the ledger's tokens and endpoint; a ledger row with no log entry counts
 * under no project; a log entry with no ledger row stays Official.
 *
 * Rows are increments, so the merge never rewrites: whichever side arrives
 * second adds the correction that moves the call to where both sides together
 * say it belongs. The state it needs is the records it hands back for the
 * store, so a restart reloads them and carries on from the same place.
 */
export class UsageCallMerge {
  private readonly calls = new Map<string, MergedCall>();

  /** Rebuild from the stored records: the last record of a log reply, the first ledger row. */
  load(records: readonly UsageRequestRecord[]): void {
    for (const record of records) {
      if (record.kind === "gateway") {
        if (record.replyId === null) continue;
        const call = this.callOf(record.agent, record.replyId);
        call.ledger ??= record;
        continue;
      }
      this.callOf(record.cli, record.replyId).cli = record;
    }
  }

  /**
   * What a scan read from a log. A reply the ledger already has keeps its
   * tokens at the endpoint: every delta the log adds is taken back from
   * Official, and the first one also moves the ledger's tokens off the unknown
   * project. Replies older than `retainFrom` that no ledger row names are not
   * kept: no ledger row can still arrive for them.
   */
  addCliDeltas(deltas: readonly UsageCallDelta[], retainFrom: string): UsageMergeOutput {
    const output = emptyOutput();
    const touched = new Map<string, UsageCliCall>();
    for (const delta of deltas) {
      const key = callKey(delta.cli, delta.replyId);
      const known = this.calls.get(key);
      if (!known && delta.at < retainFrom) continue;
      const call = known ?? this.callOf(delta.cli, delta.replyId);
      const firstSeen = call.cli === null;
      if (call.cli) addTotals(call.cli, delta.amounts);
      else call.cli = cliCallOf(delta);
      touched.set(key, call.cli);
      const { ledger } = call;
      if (!ledger) continue;
      pushAt(output, deltaKey(delta), delta.turnKey, delta.at, negated(delta.amounts));
      if (!firstSeen) continue;
      pushAt(output, unknownProjectKey(ledger), null, ledger.at, negated(totalsOf(ledger)));
      pushAt(output, mergedKey(call.cli, ledger), call.cli.turnKey, call.cli.at, totalsOf(ledger));
    }
    output.records.push(...Array.from(touched.values(), (call) => ({ ...call })));
    return output;
  }

  /**
   * A request the gateway carried. When the log already counted the reply, its
   * tokens move from Official to the endpoint; otherwise they count under no
   * project until the log names it. A second row for the same reply is kept
   * on disk and counted nowhere.
   */
  addLedgerRow(row: GatewayLedgerRow): UsageMergeOutput {
    const output = emptyOutput();
    output.records.push(row);
    if (row.replyId === null) {
      pushAt(output, unknownProjectKey(row), null, row.at, totalsOf(row));
      return output;
    }
    const call = this.callOf(row.agent, row.replyId);
    if (call.ledger) return output;
    call.ledger = row;
    if (!call.cli) {
      pushAt(output, unknownProjectKey(row), null, row.at, totalsOf(row));
      return output;
    }
    const official = { ...mergedKey(call.cli, row), endpointId: undefined };
    pushAt(output, official, call.cli.turnKey, call.cli.at, negated(totalsOf(call.cli)));
    pushAt(output, mergedKey(call.cli, row), call.cli.turnKey, call.cli.at, totalsOf(row));
    return output;
  }

  /** The newest name the ledger recorded for each endpoint. */
  endpointNames(): Map<string, string> {
    const latest = new Map<string, { name: string; at: string }>();
    for (const { ledger } of this.calls.values()) {
      if (!ledger?.endpointId || !ledger.endpointName) continue;
      const seen = latest.get(ledger.endpointId);
      if (seen && seen.at >= ledger.at) continue;
      latest.set(ledger.endpointId, { name: ledger.endpointName, at: ledger.at });
    }
    return new Map(Array.from(latest, ([id, entry]) => [id, entry.name]));
  }

  private callOf(cli: UsageCli, replyId: string): MergedCall {
    const key = callKey(cli, replyId);
    let call = this.calls.get(key);
    if (!call) {
      call = { cli: null, ledger: null };
      this.calls.set(key, call);
    }
    return call;
  }
}

function callKey(cli: UsageCli, replyId: string): string {
  return `${cli}${KEY_SEPARATOR}${replyId}`;
}

function emptyOutput(): UsageMergeOutput {
  return { buckets: [], turns: [], records: [] };
}

function cliCallOf(delta: UsageCallDelta): UsageCliCall {
  return {
    kind: "cli",
    replyId: delta.replyId,
    cli: delta.cli,
    at: delta.at,
    model: delta.model,
    sessionId: delta.sessionId,
    cwd: delta.cwd,
    bucket: delta.bucket,
    turnKey: delta.turnKey,
    ...delta.amounts,
  };
}

function totalsOf(source: UsageTokenTotals): UsageTokenTotals {
  return {
    input: source.input,
    cachedInput: source.cachedInput,
    cacheWrite: source.cacheWrite,
    output: source.output,
    reasoning: source.reasoning,
  };
}

function negated(totals: UsageTokenTotals): UsageTokenTotals {
  const result = emptyTotals();
  result.input = -totals.input;
  result.cachedInput = -totals.cachedInput;
  result.cacheWrite = -totals.cacheWrite;
  result.output = -totals.output;
  result.reasoning = -totals.reasoning;
  return result;
}

/** The bucket a log delta itself went to: Official, at the line's own key. */
function deltaKey(delta: UsageCallDelta): UsageBucketKey {
  return {
    cli: delta.cli,
    backend: null,
    model: delta.model,
    sessionId: delta.sessionId,
    cwd: delta.cwd,
    bucket: delta.bucket,
  };
}

/** A matched call's place: the log's session, cwd, bucket and model, the ledger's endpoint. */
function mergedKey(call: UsageCliCall, ledger: GatewayLedgerRow): UsageBucketKey {
  return {
    cli: call.cli,
    backend: null,
    model: call.model,
    sessionId: call.sessionId,
    cwd: call.cwd,
    bucket: call.bucket,
    ...(ledger.endpointId === null ? {} : { endpointId: ledger.endpointId }),
  };
}

/** A ledger row the log has not named: no session, no project, at the request's own bucket. */
function unknownProjectKey(row: GatewayLedgerRow): UsageBucketKey {
  return {
    cli: row.agent,
    backend: null,
    model: row.model,
    sessionId: "",
    cwd: "",
    bucket: toBucketStart(Date.parse(row.at)),
    ...(row.endpointId === null ? {} : { endpointId: row.endpointId }),
  };
}

/** One increment at a bucket key, and at its turn when the call ran in one. */
function pushAt(
  output: UsageMergeOutput,
  key: UsageBucketKey,
  turnKey: string | null,
  at: string,
  amounts: UsageTokenTotals,
): void {
  output.buckets.push({ ...emptyBucketRow(key), ...amounts });
  if (turnKey === null || key.sessionId === "") return;
  output.turns.push({
    cli: key.cli,
    backend: key.backend,
    sessionId: key.sessionId,
    turnKey,
    model: key.model,
    ...amounts,
    startedAt: at,
    lastAt: at,
    userMessageIds: [],
    ...(key.endpointId === undefined ? {} : { endpointId: key.endpointId }),
  });
}
