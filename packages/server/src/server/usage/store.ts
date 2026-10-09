import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import type { ZodType } from "zod";
import { writeFileAtomic, writeJsonFileAtomic } from "../atomic-file.js";
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
const SCAN_STATE_FILE = "scan-state.json";
const PRICING_CACHE_FILE = "pricing-table.json";

/** What one parse pass produced, in the two shapes the directory keeps. */
export interface UsageRowSet {
  buckets: UsageBucketRow[];
  turns: UsageTurnRow[];
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
 * Owns `$OSUNA_HOME/usage/`. Bucket and turn rows are append-only increments in
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
    };
  }

  /**
   * Append both kinds in one pass. Turn rows go down with the bucket rows they
   * were parsed from, so a crash cannot leave one kind ahead of the other.
   */
  async appendRows(rows: UsageRowSet): Promise<void> {
    const writes = [
      ...this.serialize(BUCKET_FILE, rows.buckets),
      ...this.serialize(TURN_FILE, rows.turns),
    ];
    if (writes.length === 0) return;

    await this.enqueue(async () => {
      await fs.mkdir(this.dir, { recursive: true });
      // Row files are append-only, so a plain append is the write; only the
      // cursor and a compaction rewrite need the atomic temp-and-rename dance.
      for (const write of writes) await fs.appendFile(write.path, write.body, "utf8");
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
