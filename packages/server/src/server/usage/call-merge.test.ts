import { describe, expect, test } from "vitest";
import type { UsageTokenTotals } from "@getpaseo/protocol/usage/types";
import { UsageCallMerge } from "./call-merge.js";
import type { GatewayLedgerRow, UsageRequestRecord } from "./ledger.js";
import {
  addTotals,
  emptyBucketRow,
  emptyTotals,
  type UsageBucketRow,
  type UsageCallDelta,
} from "./types.js";

/*
 * 账本与会话记录的合并按落盘的批次推演：扫描的一批（解析出的行、合并的修正、会话记录的调用）只在 flush 时
 * 一起落盘，账本行一到就落盘。进程被直接杀掉时没 flush 的那批全丢，重启后从盘上的记录接着来。
 */

const AT = "2026-10-23T09:00:05.000Z";
const BUCKET = "2026-10-23T09:00:00.000Z";

function totals(input: number, output: number): UsageTokenTotals {
  return { input, cachedInput: 0, cacheWrite: 0, output, reasoning: 0 };
}

const CLI = totals(40, 20);
const LEDGER = totals(40, 25);

const DELTA: UsageCallDelta = {
  replyId: "msg_1",
  cli: "claude",
  model: "kimi-k2",
  sessionId: "sess-1",
  cwd: "/work/demo",
  bucket: BUCKET,
  at: AT,
  turnKey: "p1",
  amounts: CLI,
};

const LEDGER_ROW: GatewayLedgerRow = {
  kind: "gateway",
  at: "2026-10-23T09:00:00.000Z",
  agent: "claude",
  sessionId: "sess-1",
  model: "kimi-k2",
  endpointId: "ep_a",
  endpointName: "Relay A",
  upstreamModel: "kimi-k2",
  input: LEDGER.input,
  cachedInput: 0,
  cacheWrite: 0,
  cacheWrite1h: 0,
  output: LEDGER.output,
  reasoning: 0,
  durationMs: 900,
  ttftMs: 200,
  firstTextMs: 200,
  replyId: "msg_1",
  stop: "stop",
  status: "ok",
  attempts: [],
};

/** What reached disk: bucket increments and request records, in order. */
interface Disk {
  buckets: UsageBucketRow[];
  records: UsageRequestRecord[];
}

/** One scan batch held in memory until `flush`: the parser's Official row plus what the merge added. */
interface Batch {
  buckets: UsageBucketRow[];
  records: UsageRequestRecord[];
}

function scan(merge: UsageCallMerge, delta: UsageCallDelta): Batch {
  const parsed: UsageBucketRow = {
    ...emptyBucketRow({
      cli: delta.cli,
      backend: null,
      model: delta.model,
      sessionId: delta.sessionId,
      cwd: delta.cwd,
      bucket: delta.bucket,
    }),
    ...delta.amounts,
  };
  const merged = merge.addCliDeltas([delta]);
  return { buckets: [parsed, ...merged.buckets], records: merged.records };
}

/** The scan's flush: the batch and whatever the merge settles go down together. */
function flush(merge: UsageCallMerge, disk: Disk, batch: Batch): void {
  const settled = merge.settle();
  disk.buckets.push(...batch.buckets, ...settled.buckets);
  disk.records.push(...batch.records, ...settled.records);
}

function ledger(merge: UsageCallMerge, disk: Disk): void {
  const merged = merge.addLedgerRow(LEDGER_ROW);
  disk.buckets.push(...merged.buckets);
  disk.records.push(...merged.records);
}

function restart(disk: Disk): UsageCallMerge {
  const merge = new UsageCallMerge();
  merge.load(disk.records);
  return merge;
}

/** Tokens by where they count: the endpoint (or Official) and whether the row has a session. */
function counted(disk: Disk): Record<string, UsageTokenTotals> {
  const byPlace: Record<string, UsageTokenTotals> = {};
  for (const row of disk.buckets) {
    const place = `${row.endpointId ?? "official"}${row.sessionId === "" ? " unknown" : ""}`;
    const sum = byPlace[place] ?? emptyTotals();
    addTotals(sum, row);
    byPlace[place] = sum;
  }
  return Object.fromEntries(
    Object.entries(byPlace).filter(([, sum]) => Object.values(sum).some((value) => value !== 0)),
  );
}

describe("merging the ledger with the log, batch by batch", () => {
  test("ledger row first, log scanned after: once, at the endpoint", () => {
    const disk: Disk = { buckets: [], records: [] };
    const merge = new UsageCallMerge();
    ledger(merge, disk);
    flush(merge, disk, scan(merge, DELTA));
    expect(counted(disk)).toEqual({ ep_a: LEDGER });
  });

  test("log scanned and flushed first, ledger row after: once, at the endpoint", () => {
    const disk: Disk = { buckets: [], records: [] };
    const merge = new UsageCallMerge();
    flush(merge, disk, scan(merge, DELTA));
    ledger(merge, disk);
    flush(merge, disk, { buckets: [], records: [] });
    expect(counted(disk)).toEqual({ ep_a: LEDGER });
  });

  test("a hard kill after the ledger row landed but before the scan's batch flushed still counts once", () => {
    const disk: Disk = { buckets: [], records: [] };
    const merge = new UsageCallMerge();
    // 扫描读到了这次调用，那一批还在内存里；账本行这时到了并落盘；进程被杀，那一批丢了。
    scan(merge, DELTA);
    ledger(merge, disk);

    const restarted = restart(disk);
    flush(restarted, disk, scan(restarted, DELTA));

    expect(counted(disk)).toEqual({ ep_a: LEDGER });
    // 再起一次：没有新东西要补。
    const again = restart(disk);
    flush(again, disk, { buckets: [], records: [] });
    expect(counted(disk)).toEqual({ ep_a: LEDGER });
  });

  test("a reply of any age still merges: no window cuts the log off", () => {
    const disk: Disk = { buckets: [], records: [] };
    const merge = new UsageCallMerge();
    const old = { ...DELTA, at: "2025-01-01T00:00:00.000Z", bucket: "2025-01-01T00:00:00.000Z" };
    flush(merge, disk, scan(merge, old));
    ledger(merge, disk);
    flush(merge, disk, { buckets: [], records: [] });
    expect(counted(disk)).toEqual({ ep_a: LEDGER });
  });
});
