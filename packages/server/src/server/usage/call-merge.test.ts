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
  gatewayOnly: false,
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
  const merged = merge.addCliDeltas([delta]);
  // Pi / OMP 经过中转站的回复，解析时 token 不进任何一行。
  if (delta.gatewayOnly) return { buckets: merged.buckets, records: merged.records };
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
  return { buckets: [parsed, ...merged.buckets], records: merged.records };
}

/** The scan's flush: the batch and whatever the merge settles go down together. */
function flush(merge: UsageCallMerge, disk: Disk, batch: Batch): void {
  const settled = merge.settle();
  disk.buckets.push(...batch.buckets, ...settled.buckets);
  disk.records.push(...batch.records, ...settled.records);
}

function ledger(merge: UsageCallMerge, disk: Disk, row: GatewayLedgerRow = LEDGER_ROW): void {
  const merged = merge.addLedgerRow(row);
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

describe("pruning a day of records", () => {
  // 请求在午夜前开始（账本行与合并标记记在 22 日），会话记录里的回复写在午夜后（记在 23 日）。
  const lateLedger = { ...LEDGER_ROW, at: "2026-10-22T23:59:58.000Z" };
  const earlyDelta = {
    ...DELTA,
    at: "2026-10-23T00:00:03.000Z",
    bucket: "2026-10-23T00:00:00.000Z",
  };

  function mergedAcrossMidnight(): { merge: UsageCallMerge; disk: Disk } {
    const disk: Disk = { buckets: [], records: [] };
    const merge = new UsageCallMerge();
    const row = merge.addLedgerRow(lateLedger);
    disk.buckets.push(...row.buckets);
    disk.records.push(...row.records);
    flush(merge, disk, scan(merge, earlyDelta));
    return { merge, disk };
  }

  /** What a restart loads once the day's file is gone. */
  function withoutDay(disk: Disk, day: string): Disk {
    return {
      buckets: disk.buckets,
      records: disk.records.filter((record) => !record.at.startsWith(day)),
    };
  }

  for (const day of ["2026-10-22", "2026-10-23"]) {
    test(`pruning ${day} leaves memory where a restart would, and neither moves the call again`, () => {
      const { merge, disk } = mergedAcrossMidnight();
      expect(counted(disk)).toEqual({ ep_a: LEDGER });
      merge.prune(new Set([day]));
      const pruned = withoutDay(disk, day);
      const restarted = restart(pruned);

      expect(merge.listCalls()).toEqual(restarted.listCalls());
      expect(merge.hasUnsettled()).toBe(false);
      expect(restarted.hasUnsettled()).toBe(false);
      flush(merge, disk, { buckets: [], records: [] });
      flush(restarted, pruned, { buckets: [], records: [] });
      expect(counted(disk)).toEqual({ ep_a: LEDGER });
      expect(counted(pruned)).toEqual({ ep_a: LEDGER });
    });
  }

  test("a ledger row still waiting for its reply is let go with its day, and a row with no reply id is dropped from the list", () => {
    const merge = new UsageCallMerge();
    merge.addLedgerRow(lateLedger);
    merge.addLedgerRow({ ...lateLedger, replyId: null, status: "failed" });
    expect(merge.listCalls()).toHaveLength(2);

    merge.prune(new Set(["2026-10-22"]));

    expect(merge.listCalls()).toEqual([]);
    scan(merge, earlyDelta);
    expect(merge.hasUnsettled()).toBe(false);
  });
});

describe("a Pi or OMP reply that went through the gateway", () => {
  // 会话记录里服务商是 osuna 的回复：token 只看账本，回复编号是记录里的 responseId。
  const PI_DELTA: UsageCallDelta = {
    ...DELTA,
    replyId: "chatcmpl-77",
    cli: "pi",
    model: "deepseek-v3",
    gatewayOnly: true,
  };
  const PI_LEDGER_ROW: GatewayLedgerRow = {
    ...LEDGER_ROW,
    agent: "pi",
    model: "deepseek-v3",
    replyId: "chatcmpl-77",
  };

  test("ledger row first, log scanned after: once, at the endpoint, in the log's turn", () => {
    const disk: Disk = { buckets: [], records: [] };
    const merge = new UsageCallMerge();
    ledger(merge, disk, PI_LEDGER_ROW);
    const batch = scan(merge, PI_DELTA);
    const settled = merge.settle();
    disk.buckets.push(...batch.buckets, ...settled.buckets);
    disk.records.push(...batch.records, ...settled.records);

    expect(counted(disk)).toEqual({ ep_a: LEDGER });
    expect(settled.turns).toEqual([
      expect.objectContaining({
        cli: "pi",
        sessionId: "sess-1",
        turnKey: "p1",
        endpointId: "ep_a",
        ...LEDGER,
      }),
    ]);
  });

  test("log scanned and flushed first, ledger row after: once, at the endpoint", () => {
    const disk: Disk = { buckets: [], records: [] };
    const merge = new UsageCallMerge();
    flush(merge, disk, scan(merge, PI_DELTA));
    expect(counted(disk)).toEqual({});
    ledger(merge, disk, PI_LEDGER_ROW);
    flush(merge, disk, { buckets: [], records: [] });
    expect(counted(disk)).toEqual({ ep_a: LEDGER });
  });

  test("across restarts on either side of the ledger row: still once, and not moved twice", () => {
    const disk: Disk = { buckets: [], records: [] };
    flush(new UsageCallMerge(), disk, scan(new UsageCallMerge(), PI_DELTA));
    const afterLog = restart(disk);
    ledger(afterLog, disk, PI_LEDGER_ROW);
    flush(afterLog, disk, { buckets: [], records: [] });
    flush(restart(disk), disk, { buckets: [], records: [] });
    expect(counted(disk)).toEqual({ ep_a: LEDGER });

    const killed: Disk = { buckets: [], records: [] };
    const merge = new UsageCallMerge();
    scan(merge, PI_DELTA);
    ledger(merge, killed, PI_LEDGER_ROW);
    const restarted = restart(killed);
    flush(restarted, killed, scan(restarted, PI_DELTA));
    flush(restart(killed), killed, { buckets: [], records: [] });
    expect(counted(killed)).toEqual({ ep_a: LEDGER });
  });

  test("a reply no ledger row matches is counted nowhere and not listed, as magpie skips it", () => {
    const disk: Disk = { buckets: [], records: [] };
    const merge = new UsageCallMerge();
    flush(merge, disk, scan(merge, PI_DELTA));

    expect(counted(disk)).toEqual({});
    expect(merge.listCalls()).toEqual([]);
    expect(restart(disk).listCalls()).toEqual([]);
  });

  test("a merged reply is listed once, as the gateway's, with the log's session", () => {
    const disk: Disk = { buckets: [], records: [] };
    const merge = new UsageCallMerge();
    ledger(merge, disk, PI_LEDGER_ROW);
    flush(merge, disk, scan(merge, PI_DELTA));

    for (const listed of [merge.listCalls(), restart(disk).listCalls()]) {
      expect(listed).toEqual([
        {
          kind: "gateway",
          ledger: PI_LEDGER_ROW,
          cli: expect.objectContaining({
            replyId: "chatcmpl-77",
            sessionId: "sess-1",
            cwd: "/work/demo",
          }),
        },
      ]);
    }
  });

  test("a Pi reply on its own provider is still a direct call at Official", () => {
    const disk: Disk = { buckets: [], records: [] };
    const merge = new UsageCallMerge();
    flush(merge, disk, scan(merge, { ...PI_DELTA, gatewayOnly: false }));

    expect(counted(disk)).toEqual({ official: CLI });
    expect(merge.listCalls()).toEqual([
      { kind: "direct", cli: expect.objectContaining({ replyId: "chatcmpl-77", cli: "pi" }) },
    ]);
  });
});
