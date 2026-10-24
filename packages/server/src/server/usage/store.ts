// 逐条记录的修剪（过完的一天先压成 .gz，30 天、按压过的大小合计 200 MB、写入后最多每小时一次、从最旧的一天整天删、
// 今天不删）照 magpie（https://github.com/yetone/magpie，internal/gateway/history.go:29-31、93-134 的 saveRoute、pruneHistory）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import type { ZodType } from "zod";
import { writeFileAtomic, writeJsonFileAtomic } from "../atomic-file.js";
import { USAGE_REQUEST_RECORD_SCHEMA, type UsageRequestRecord } from "./ledger.js";
import { gzipFinishedDays, listRequestDayFiles, readRequestDayLines } from "./request-files.js";
import { PRICING_TABLE_SCHEMA, type PricingTable } from "./pricing/table.js";
import {
  USAGE_BUCKET_ROW_SCHEMA,
  USAGE_SCAN_STATE_SCHEMA,
  USAGE_TURN_ROW_SCHEMA,
  addBucketRow,
  addTurnRow,
  emptyScanState,
  mergeBucketRow,
  mergeTurnRow,
  rowMonth,
  type UsageBucketRow,
  type UsageScanState,
  type UsageTurnRow,
} from "./types.js";

const FILE_SUFFIX = ".jsonl";
const DAY_MS = 24 * 60 * 60 * 1000;
const SCAN_STATE_FILE = "scan-state.json";
const PRICING_CACHE_FILE = "pricing-table.json";
const REQUESTS_DIR = "requests";
/** Per-request records are kept this many days and this many bytes in all (magpie's history.go). */
export const REQUEST_RETENTION_DAYS = 30;
export const REQUEST_RETENTION_BYTES = 200 * 1024 * 1024;
// 账本与逐条记录和接口目录一样只给本人读写。
const REQUEST_FILE_MODE = 0o600;
const REQUEST_DIR_MODE = 0o700;

/** What one parse pass produced, in the shapes the directory keeps. */
export interface UsageRowSet {
  buckets: UsageBucketRow[];
  turns: UsageTurnRow[];
  /** Ledger rows and the log replies they merge with, a file per UTC day. */
  requests: UsageRequestRecord[];
}

export function emptyRowSet(): UsageRowSet {
  return { buckets: [], turns: [], requests: [] };
}

/**
 * One kind of append-only row file: how a row picks its month, how two rows of
 * the same key fold together, and the schema that guards both ends.
 */
interface UsageRowFile<T> {
  prefix: string;
  schema: ZodType<T>;
  month: (row: T) => string;
  merge: (into: Map<string, T>, row: T) => void;
  add: (target: T, source: T) => void;
}

const BUCKET_FILE: UsageRowFile<UsageBucketRow> = {
  prefix: "buckets-",
  schema: USAGE_BUCKET_ROW_SCHEMA,
  month: (row) => rowMonth(row.bucket),
  merge: mergeBucketRow,
  add: addBucketRow,
};

const TURN_FILE: UsageRowFile<UsageTurnRow> = {
  prefix: "turns-",
  schema: USAGE_TURN_ROW_SCHEMA,
  // A turn belongs to the month it started in, even when it ran past midnight.
  month: (row) => rowMonth(row.startedAt),
  merge: mergeTurnRow,
  add: addTurnRow,
};

/**
 * Owns `$PASEO_HOME/usage/`. Bucket and turn rows are append-only increments in
 * a file per month; the cursor is a single atomically written JSON file.
 */
export class UsageStore {
  private readonly dir: string;
  private readonly logger: Logger;
  private appendQueue: Promise<void> = Promise.resolve();

  constructor(options: { dir: string; logger: Logger }) {
    this.dir = options.dir;
    this.logger = options.logger.child({ module: "usage-store" });
  }

  /**
   * Sum every row file into one row per key. A month whose line count has grown
   * past twice its unique keys is rewritten as one line per key.
   */
  async loadRows(): Promise<UsageRowSet> {
    return {
      buckets: await this.loadKind(BUCKET_FILE),
      turns: await this.loadKind(TURN_FILE),
      requests: await this.loadRequests(),
    };
  }

  /**
   * Append every kind in one pass. Turn rows go down with the bucket rows they
   * were parsed from, and the records a merge step kept go down after the rows
   * it added, so a crash cannot leave one kind ahead of the other.
   */
  async appendRows(rows: UsageRowSet): Promise<void> {
    const writes = [
      ...this.serialize(BUCKET_FILE, rows.buckets),
      ...this.serialize(TURN_FILE, rows.turns),
    ];
    const requestWrites = this.serializeRequests(rows.requests);
    if (writes.length === 0 && requestWrites.length === 0) return;

    await this.enqueue(async () => {
      await fs.mkdir(this.dir, { recursive: true });
      // Row files are append-only, so a plain append is the write; only the
      // cursor and a compaction rewrite need the atomic temp-and-rename dance.
      for (const write of writes) await fs.appendFile(write.path, write.body, "utf8");
      if (requestWrites.length === 0) return;
      await fs.mkdir(this.requestsDir(), { recursive: true, mode: REQUEST_DIR_MODE });
      for (const write of requestWrites) {
        await fs.appendFile(write.path, write.body, { encoding: "utf8", mode: REQUEST_FILE_MODE });
      }
    });
  }

  /**
   * Every request record on disk, oldest day first, a day's gzipped part ahead
   * of what was appended after it; a torn line is dropped.
   */
  private async loadRequests(): Promise<UsageRequestRecord[]> {
    const records: UsageRequestRecord[] = [];
    for (const file of await listRequestDayFiles(this.requestsDir())) {
      for (const line of await readRequestDayLines(file)) {
        const parsed = USAGE_REQUEST_RECORD_SCHEMA.safeParse(parseRow(line));
        if (!parsed.success) {
          this.logger.warn(
            { file: path.basename(file.path), err: parsed.error },
            "Dropped unreadable usage request",
          );
          continue;
        }
        records.push(parsed.data);
      }
    }
    return records;
  }

  /** One append per UTC day of the record's own time. */
  private serializeRequests(
    records: readonly UsageRequestRecord[],
  ): { path: string; body: string }[] {
    const byDay = new Map<string, string[]>();
    for (const record of records) {
      const day = record.at.slice(0, 10);
      const lines = byDay.get(day) ?? [];
      lines.push(JSON.stringify(USAGE_REQUEST_RECORD_SCHEMA.parse(record)));
      byDay.set(day, lines);
    }
    return Array.from(byDay, ([day, lines]) => ({
      path: path.join(this.requestsDir(), `${day}${FILE_SUFFIX}`),
      body: `${lines.join("\n")}\n`,
    }));
  }

  /**
   * Gzip the days that are over, then drop the days older than `days` (today
   * counting as one) and the oldest until what is left, compressed, fits
   * `maxBytes`. A day goes whole, its `.gz` and any plain file beside it, and
   * today always stays. Summaries live in the bucket rows, which are never
   * pruned. Returns the days removed, so the caller can forget them too.
   */
  async pruneRequests(input: {
    now: number;
    days: number;
    maxBytes: number;
  }): Promise<Set<string>> {
    const removed = new Set<string>();
    await this.enqueue(async () => {
      const dir = this.requestsDir();
      const today = new Date(input.now).toISOString().slice(0, 10);
      const oldest = new Date(input.now - (input.days - 1) * DAY_MS).toISOString().slice(0, 10);
      await gzipFinishedDays({ dir, today, now: input.now });
      const files = await listRequestDayFiles(dir);
      let total = files.reduce((sum, file) => sum + file.size, 0);
      // 一天整天删：它的文件在列表里挨着，删了第一个就把同一天的都删掉。
      let dropping: string | null = null;
      for (const file of files) {
        const keep = file.day === today || (file.day >= oldest && total <= input.maxBytes);
        if (file.day !== dropping && keep) continue;
        dropping = file.day;
        await fs.rm(file.path, { force: true });
        total -= file.size;
        removed.add(file.day);
      }
    });
    return removed;
  }

  private requestsDir(): string {
    return path.join(this.dir, REQUESTS_DIR);
  }

  async loadScanState(): Promise<UsageScanState> {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(this.dir, SCAN_STATE_FILE), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyScanState();
      throw error;
    }
    const parsed = USAGE_SCAN_STATE_SCHEMA.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      this.logger.warn(
        { err: parsed.error },
        "Usage scan state is unreadable; rescanning every log file",
      );
      return emptyScanState();
    }
    return parsed.data;
  }

  async saveScanState(state: UsageScanState): Promise<void> {
    await writeJsonFileAtomic(path.join(this.dir, SCAN_STATE_FILE), state);
  }

  /**
   * The last table pulled from LiteLLM, or null when there is none to use. A
   * cache that no longer parses is deleted rather than repaired: the built-in
   * snapshot is always a valid fallback.
   */
  async loadPricingTable(): Promise<PricingTable | null> {
    const filePath = path.join(this.dir, PRICING_CACHE_FILE);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const parsed = PRICING_TABLE_SCHEMA.safeParse(parseRow(raw));
    if (!parsed.success) {
      this.logger.warn({ err: parsed.error }, "Cached price table is unreadable; removing it");
      await fs.rm(filePath, { force: true });
      return null;
    }
    return parsed.data;
  }

  /** Written minified: the table is half a megabyte, and nobody hand-edits it. */
  async savePricingTable(table: PricingTable): Promise<void> {
    await writeFileAtomic(
      path.join(this.dir, PRICING_CACHE_FILE),
      JSON.stringify(PRICING_TABLE_SCHEMA.parse(table)),
    );
  }

  private async loadKind<T>(file: UsageRowFile<T>): Promise<T[]> {
    const all = new Map<string, T>();
    for (const month of await this.listMonths(file)) {
      const merged = new Map<string, T>();
      const lineCount = await this.readMonth(file, month, merged);
      if (lineCount > merged.size * 2) {
        await this.compactMonth(file, month, Array.from(merged.values()));
        this.logger.info(
          { file: file.prefix, month, lineCount, keys: merged.size },
          "Compacted usage row file",
        );
      }
      for (const [key, row] of merged) {
        const existing = all.get(key);
        if (existing) {
          file.add(existing, row);
          continue;
        }
        all.set(key, row);
      }
    }
    return Array.from(all.values());
  }

  /** One append per month, so a batch touches each file once. */
  private serialize<T>(
    file: UsageRowFile<T>,
    rows: readonly T[],
  ): { path: string; body: string }[] {
    const byMonth = new Map<string, string[]>();
    for (const row of rows) {
      const month = file.month(row);
      const serialized = JSON.stringify(file.schema.parse(row));
      const lines = byMonth.get(month);
      if (lines) {
        lines.push(serialized);
        continue;
      }
      byMonth.set(month, [serialized]);
    }
    return Array.from(byMonth, ([month, lines]) => ({
      path: this.monthPath(file, month),
      body: `${lines.join("\n")}\n`,
    }));
  }

  private async listMonths<T>(file: UsageRowFile<T>): Promise<string[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return entries
      .filter((name) => name.startsWith(file.prefix) && name.endsWith(FILE_SUFFIX))
      .map((name) => name.slice(file.prefix.length, -FILE_SUFFIX.length))
      .sort();
  }

  /** Merge one month's file into `into` and report how many lines it held. */
  private async readMonth<T>(
    file: UsageRowFile<T>,
    month: string,
    into: Map<string, T>,
  ): Promise<number> {
    const raw = await fs.readFile(this.monthPath(file, month), "utf8");
    let lineCount = 0;
    for (const line of raw.split("\n")) {
      if (line.length === 0) continue;
      lineCount += 1;
      // An append torn by a crash leaves one unparseable line; drop it rather
      // than refusing to start.
      const parsed = file.schema.safeParse(parseRow(line));
      if (!parsed.success) {
        this.logger.warn(
          { file: file.prefix, month, err: parsed.error },
          "Dropped unreadable usage row",
        );
        continue;
      }
      file.merge(into, parsed.data);
    }
    return lineCount;
  }

  private async compactMonth<T>(
    file: UsageRowFile<T>,
    month: string,
    rows: readonly T[],
  ): Promise<void> {
    const body = rows.map((row) => JSON.stringify(file.schema.parse(row))).join("\n");
    await this.enqueue(() =>
      writeFileAtomic(this.monthPath(file, month), body.length > 0 ? `${body}\n` : ""),
    );
  }

  /** Every write to a row file goes through one serial queue. */
  private async enqueue(write: () => Promise<void>): Promise<void> {
    const next = this.appendQueue.then(write);
    this.appendQueue = next.catch(() => undefined);
    await next;
  }

  private monthPath<T>(file: UsageRowFile<T>, month: string): string {
    return path.join(this.dir, `${file.prefix}${month}${FILE_SUFFIX}`);
  }
}

function parseRow(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
