import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import { writeFileAtomic, writeJsonFileAtomic } from "../atomic-file.js";
import { PRICING_TABLE_SCHEMA, type PricingTable } from "./pricing/table.js";
import {
  USAGE_BUCKET_ROW_SCHEMA,
  USAGE_SCAN_STATE_SCHEMA,
  addBucketRow,
  bucketMonth,
  emptyScanState,
  mergeBucketRow,
  type UsageBucketRow,
  type UsageScanState,
} from "./types.js";

const BUCKET_FILE_PREFIX = "buckets-";
const BUCKET_FILE_SUFFIX = ".jsonl";
const SCAN_STATE_FILE = "scan-state.json";
const PRICING_CACHE_FILE = "pricing-table.json";

/**
 * Owns `$PASEO_HOME/usage/`. Bucket rows are append-only increments in a file
 * per month; the cursor is a single atomically written JSON file.
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
   * Sum every bucket file into one row per key. A month whose line count has
   * grown past twice its unique keys is rewritten as one line per key.
   */
  async loadRows(): Promise<UsageBucketRow[]> {
    const months = await this.listMonths();
    const all = new Map<string, UsageBucketRow>();
    for (const month of months) {
      const merged = new Map<string, UsageBucketRow>();
      const lineCount = await this.readMonth(month, merged);
      if (lineCount > merged.size * 2) {
        await this.compactMonth(month, Array.from(merged.values()));
        this.logger.info({ month, lineCount, keys: merged.size }, "Compacted usage bucket file");
      }
      for (const [key, row] of merged) {
        const existing = all.get(key);
        if (existing) {
          addBucketRow(existing, row);
          continue;
        }
        all.set(key, row);
      }
    }
    return Array.from(all.values());
  }

  async appendRows(rows: UsageBucketRow[]): Promise<void> {
    if (rows.length === 0) return;
    const byMonth = new Map<string, string[]>();
    for (const row of rows) {
      const month = bucketMonth(row.bucket);
      const lines = byMonth.get(month);
      const serialized = JSON.stringify(USAGE_BUCKET_ROW_SCHEMA.parse(row));
      if (lines) {
        lines.push(serialized);
        continue;
      }
      byMonth.set(month, [serialized]);
    }

    await this.enqueue(async () => {
      await fs.mkdir(this.dir, { recursive: true });
      // Bucket files are append-only, so a plain append is the write; only the
      // cursor and a compaction rewrite need the atomic temp-and-rename dance.
      for (const [month, lines] of byMonth) {
        await fs.appendFile(this.monthPath(month), `${lines.join("\n")}\n`, "utf8");
      }
    });
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

  private async listMonths(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return entries
      .filter((name) => name.startsWith(BUCKET_FILE_PREFIX) && name.endsWith(BUCKET_FILE_SUFFIX))
      .map((name) => name.slice(BUCKET_FILE_PREFIX.length, -BUCKET_FILE_SUFFIX.length))
      .sort();
  }

  /** Merge one month's file into `into` and report how many lines it held. */
  private async readMonth(month: string, into: Map<string, UsageBucketRow>): Promise<number> {
    const raw = await fs.readFile(this.monthPath(month), "utf8");
    let lineCount = 0;
    for (const line of raw.split("\n")) {
      if (line.length === 0) continue;
      lineCount += 1;
      // An append torn by a crash leaves one unparseable line; drop it rather
      // than refusing to start.
      const parsed = USAGE_BUCKET_ROW_SCHEMA.safeParse(parseRow(line));
      if (!parsed.success) {
        this.logger.warn({ month, err: parsed.error }, "Dropped unreadable usage bucket row");
        continue;
      }
      mergeBucketRow(into, parsed.data);
    }
    return lineCount;
  }

  private async compactMonth(month: string, rows: UsageBucketRow[]): Promise<void> {
    const body = rows.map((row) => JSON.stringify(USAGE_BUCKET_ROW_SCHEMA.parse(row))).join("\n");
    await this.enqueue(() =>
      writeFileAtomic(this.monthPath(month), body.length > 0 ? `${body}\n` : ""),
    );
  }

  /** Every write to a bucket file goes through one serial queue. */
  private async enqueue(write: () => Promise<void>): Promise<void> {
    const next = this.appendQueue.then(write);
    this.appendQueue = next.catch(() => undefined);
    await next;
  }

  private monthPath(month: string): string {
    return path.join(this.dir, `${BUCKET_FILE_PREFIX}${month}${BUCKET_FILE_SUFFIX}`);
  }
}

function parseRow(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
