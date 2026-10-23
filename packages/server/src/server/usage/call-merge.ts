// 账本行与会话记录按回复编号对上合成一条、会话取会话记录照 magpie（https://github.com/yetone/magpie，internal/usage/codex_identity.go 的 codexResponseMatches 与 codexIdentityRow）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { UsageCli, UsageTokenTotals } from "@getpaseo/protocol/usage/types";
import type {
  GatewayLedgerRow,
  UsageCliCall,
  UsageMergedCall,
  UsageRequestRecord,
} from "./ledger.js";
import { speedSumsOf, type UsageSpeedSums } from "./speed.js";
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

/**
 * One request as the Requests list shows it: one the gateway carried, with
 * the log's reply when the log has it too, or a reply only the log has.
 */
export type UsageListedCall =
  | { kind: "gateway"; ledger: GatewayLedgerRow; cli: UsageCliCall | null }
  | { kind: "direct"; cli: UsageCliCall };

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
  /** Ledger rows with no reply id (no one answered, or the reply named none): listed, never merged. */
  private unreplied: GatewayLedgerRow[] = [];

  /** Rebuild from the stored records: the last record of a log reply, the first ledger row. */
  load(records: readonly UsageRequestRecord[]): void {
    for (const record of records) {
      if (record.kind === "gateway") {
        if (record.replyId === null) {
          this.unreplied.push(record);
          continue;
        }
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
        pushAt({
          output,
          key: deltaKey(delta),
          turnKey: delta.turnKey,
          at: delta.at,
          amounts: negated(delta.amounts),
        });
      }
    }
    output.records.push(...Array.from(touched.values(), (call) => ({ ...call })));
    return output;
  }

  /**
   * A request the gateway carried: counted under no project until `settle`
   * finds the log's reply. A second row for the same reply is kept on disk and
   * counted nowhere. A failed or cancelled request counts as an error under no
   * project, at the endpoint it last tried, as magpie counts it in its groups.
   */
  addLedgerRow(row: GatewayLedgerRow): UsageMergeOutput {
    const output = emptyOutput();
    output.records.push(row);
    if (row.replyId === null) this.unreplied.push(row);
    else {
      const call = this.callOf(row.agent, row.replyId);
      if (call.ledger) return output;
      call.ledger = row;
      this.awaiting.add(callKey(row.agent, row.replyId));
    }
    if (row.status !== "ok") {
      output.buckets.push({ ...emptyBucketRow(failedKey(row)), errors: 1 });
      return output;
    }
    const totals = totalsOf(row);
    const speed = speedOf(row);
    if (Object.values(totals).every((value) => value === 0) && speed === null) return output;
    pushAt({
      output,
      key: unknownProjectKey(row),
      turnKey: null,
      at: row.at,
      amounts: totals,
      speed,
    });
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
      pushAt({
        output,
        key: official,
        turnKey: cli.turnKey,
        at: cli.at,
        amounts: negated(totalsOf(cli)),
      });
      const speed = speedOf(ledger);
      const unknown = unknownProjectKey(ledger);
      pushAt({
        output,
        key: unknown,
        turnKey: null,
        at: ledger.at,
        amounts: negated(totalsOf(ledger)),
        speed: negatedSpeed(speed),
      });
      pushAt({
        output,
        key: mergedKey(cli, ledger),
        turnKey: cli.turnKey,
        at: cli.at,
        amounts: totalsOf(ledger),
        speed,
      });
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

  /**
   * Every request the stored records still hold: each call once, at the first
   * ledger row of its reply, and each ledger row that names no reply.
   */
  listCalls(): UsageListedCall[] {
    const listed: UsageListedCall[] = [];
    for (const { cli, ledger } of this.calls.values()) {
      if (ledger) listed.push({ kind: "gateway", ledger, cli });
      else if (cli) listed.push({ kind: "direct", cli });
    }
    for (const ledger of this.unreplied) listed.push({ kind: "gateway", ledger, cli: null });
    return listed;
  }

  /**
   * Forget what the pruned day files held, so memory ends where a restart
   * would load it from. A `merged` marker lies in the file of its ledger row
   * (both stamped with the request's time), so the two go together: a call
   * whose ledger row is gone is no longer settled, and none is left waiting.
   * A log reply's records all lie in its own first day.
   */
  prune(days: ReadonlySet<string>): void {
    if (days.size === 0) return;
    const pruned = (at: string) => days.has(dayOf(at));
    for (const [key, call] of this.calls) {
      if (call.cli && pruned(call.cli.at)) call.cli = null;
      if (call.ledger && pruned(call.ledger.at)) {
        call.ledger = null;
        call.settled = false;
        this.awaiting.delete(key);
      }
      if (!call.cli && !call.ledger) this.calls.delete(key);
    }
    this.unreplied = this.unreplied.filter((row) => !pruned(row.at));
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

/** The UTC day a record is filed under (`usage/requests/YYYY-MM-DD.jsonl`). */
export function dayOf(at: string): string {
  return at.slice(0, 10);
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

/**
 * What an answered request adds to its bucket's speed sums. A row written
 * before the ledger kept a reply's flow was never summed, so it moves none.
 */
function speedOf(row: GatewayLedgerRow): UsageSpeedSums | null {
  if (row.flowMs === undefined) return null;
  return speedSumsOf(row);
}

function negatedSpeed(speed: UsageSpeedSums | null): UsageSpeedSums | null {
  if (speed === null) return null;
  return {
    ttftCount: -speed.ttftCount,
    ttftMs: -speed.ttftMs,
    speedCount: -speed.speedCount,
    speedOutput: -speed.speedOutput,
    speedMs: -speed.speedMs,
  };
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
function unknownProjectKey(
  row: GatewayLedgerRow,
  endpointId: string | null = row.endpointId,
): UsageBucketKey {
  return {
    cli: row.agent,
    backend: null,
    model: row.model,
    sessionId: "",
    cwd: "",
    bucket: toBucketStart(Date.parse(row.at)),
    ...(endpointId === null ? {} : { endpointId }),
  };
}

/** Where a request no one answered counts: under no project, at the endpoint it last tried. */
function failedKey(row: GatewayLedgerRow): UsageBucketKey {
  return unknownProjectKey(row, row.attempts.at(-1)?.endpointId ?? null);
}

/**
 * One increment at a bucket key, and at its turn when the call ran in one. A
 * speed goes to the bucket alone: turns show no speed.
 */
function pushAt(input: {
  output: UsageMergeOutput;
  key: UsageBucketKey;
  turnKey: string | null;
  at: string;
  amounts: UsageTokenTotals;
  speed?: UsageSpeedSums | null;
}): void {
  const { output, key, turnKey, at, amounts } = input;
  output.buckets.push({ ...emptyBucketRow(key), ...amounts, ...input.speed });
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
