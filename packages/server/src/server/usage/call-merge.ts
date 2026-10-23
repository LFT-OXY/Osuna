import type { UsageCli, UsageTokenTotals } from "@getpaseo/protocol/usage/types";
import type {
  GatewayLedgerRow,
  UsageCliCall,
  UsageMergedCall,
  UsageRequestRecord,
} from "./ledger.js";
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

/** One call as far as the two sides have told it, and whether its move to the endpoint is done. */
interface MergedCall {
  cli: UsageCliCall | null;
  ledger: GatewayLedgerRow | null;
  settled: boolean;
}

/**
 * Folds the gateway ledger into the rows the CLI logs produce (ADR 0014). A
 * call both sides know is counted once, at the log's project, session and turn,
 * with the ledger's tokens and endpoint; a ledger row with no log entry counts
 * under no project; a log entry with no ledger row stays Official.
 *
 * Rows are increments, so the merge never rewrites. A ledger row lands at
 * once, under no project. The move to the log's project and the endpoint —
 * Official's tokens taken back, the unknown project's too, the endpoint's added
 * — happens only in `settle`, which the scan runs in the same batch that writes
 * the log's reply, and it leaves a `merged` record behind. So whatever a hard
 * kill throws away, what is on disk agrees with itself: an unflushed reply was
 * never moved, and a moved one is marked. A restart reloads the records and
 * carries on from the same place.
 */
export class UsageCallMerge {
  private readonly calls = new Map<string, MergedCall>();
  /** Calls with a ledger row that are not settled yet; settled once the log has them too. */
  private readonly awaiting = new Set<string>();

  /** Rebuild from the stored records: the last record of a log reply, the first ledger row. */
  load(records: readonly UsageRequestRecord[]): void {
    for (const record of records) {
      if (record.kind === "gateway") {
        if (record.replyId === null) continue;
        const call = this.callOf(record.agent, record.replyId);
        call.ledger ??= record;
        continue;
      }
      if (record.kind === "merged") {
        this.callOf(record.agent, record.replyId).settled = true;
        continue;
      }
      this.callOf(record.cli, record.replyId).cli = record;
    }
    for (const [key, call] of this.calls) {
      if (call.ledger && !call.settled) this.awaiting.add(key);
    }
  }

  /**
   * What a scan read from a log, to go down in the scan's own batch. A reply
   * already settled keeps its tokens at the endpoint: every delta the log adds
   * is taken back from Official at the delta's own key.
   */
  addCliDeltas(deltas: readonly UsageCallDelta[]): UsageMergeOutput {
    const output = emptyOutput();
    const touched = new Map<string, UsageCliCall>();
    for (const delta of deltas) {
      const key = callKey(delta.cli, delta.replyId);
      const call = this.callOf(delta.cli, delta.replyId);
      if (call.cli) addTotals(call.cli, delta.amounts);
      else call.cli = cliCallOf(delta);
      touched.set(key, call.cli);
      if (call.settled) {
        pushAt(output, deltaKey(delta), delta.turnKey, delta.at, negated(delta.amounts));
      }
    }
    output.records.push(...Array.from(touched.values(), (call) => ({ ...call })));
    return output;
  }

  /**
   * A request the gateway carried: counted under no project until `settle`
   * finds the log's reply. A second row for the same reply is kept on disk and
   * counted nowhere, and so is a row of 0 tokens (a failed or cancelled request).
   */
  addLedgerRow(row: GatewayLedgerRow): UsageMergeOutput {
    const output = emptyOutput();
    output.records.push(row);
    if (row.replyId !== null) {
      const call = this.callOf(row.agent, row.replyId);
      if (call.ledger) return output;
      call.ledger = row;
      this.awaiting.add(callKey(row.agent, row.replyId));
    }
    const totals = totalsOf(row);
    if (Object.values(totals).every((value) => value === 0)) return output;
    pushAt(output, unknownProjectKey(row), null, row.at, totals);
    return output;
  }

  /** Whether a ledger row's reply is in the log and waiting for `settle`. */
  hasUnsettled(): boolean {
    for (const key of this.awaiting) {
      if (this.calls.get(key)?.cli) return true;
    }
    return false;
  }

  /**
   * Move every call both sides now know to the log's project and the endpoint:
   * Official gives back what the log counted, the unknown project what the
   * ledger counted there. Run it in the batch that writes the log's replies,
   * never on its own ahead of them.
   */
  settle(): UsageMergeOutput {
    const output = emptyOutput();
    for (const key of this.awaiting) {
      const call = this.calls.get(key);
      const { cli, ledger } = call ?? { cli: null, ledger: null };
      if (!call || !cli || !ledger) continue;
      const official = { ...mergedKey(cli, ledger), endpointId: undefined };
      pushAt(output, official, cli.turnKey, cli.at, negated(totalsOf(cli)));
      pushAt(output, unknownProjectKey(ledger), null, ledger.at, negated(totalsOf(ledger)));
      pushAt(output, mergedKey(cli, ledger), cli.turnKey, cli.at, totalsOf(ledger));
      const marker: UsageMergedCall = {
        kind: "merged",
        agent: ledger.agent,
        replyId: cli.replyId,
        at: ledger.at,
      };
      output.records.push(marker);
      call.settled = true;
      this.awaiting.delete(key);
    }
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
      call = { cli: null, ledger: null, settled: false };
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
