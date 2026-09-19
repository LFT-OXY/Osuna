import { promises as fs, type Dirent } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import type { Logger } from "pino";
import type {
  UsageBackfill,
  UsageCli,
  UsagePricingModel,
  UsagePricingTableInfo,
  UsageReport,
  UsageTokenTotals,
} from "@getpaseo/protocol/usage/types";
import type { PersistedProjectRecord } from "../workspace-registry.js";
import type { UsageConfig, UsagePricingSettings } from "./config.js";
import { resolveUsageLogRoots, type UsageLogRoots } from "./log-roots.js";
import {
  UsagePricingService,
  type UsagePricingModelRef,
  type UsagePricingRefreshOutcome,
} from "./pricing/service.js";
import { UsageProjectResolver } from "./project-attribution.js";
import { buildUsageReport, type UsageReportRequest } from "./report.js";
import { USAGE_SOURCE_ADAPTERS, type UsageSourceAdapter } from "./sources.js";
import { UsageStore } from "./store.js";
import {
  emptyScanState,
  isMissingPathError,
  mergeBucketRow,
  modelRowKey,
  type UsageBucketRow,
  type UsageParserState,
  type UsageScanCursor,
  type UsageScanState,
} from "./types.js";

export const DEFAULT_USAGE_SCAN_INTERVAL_MS = 60_000;
const SCAN_INTERVAL_ENV = "PASEO_USAGE_SCAN_INTERVAL_MS";

/** How long a file must stay untouched before an unfinished turn is settled. */
const IDLE_TURN_SETTLE_MS = 10 * 60 * 1000;
const FLUSH_EVERY_FILES = 20;
const FLUSH_EVERY_MS = 500;
const PROGRESS_INTERVAL_MS = 1000;
const READ_CHUNK_BYTES = 1024 * 1024;

export interface UsageServiceOptions {
  paseoHome: string;
  config: UsageConfig | undefined;
  logger: Logger;
  listProjects: () => Promise<PersistedProjectRecord[]>;
  onBackfillProgress: (backfill: UsageBackfill) => void;
  /** Reads the live price settings from the daemon config, which owns them. */
  getPricingConfig: () => UsagePricingSettings;
  onPricingUpdated: () => void;
}

interface DiscoveredFile {
  cli: UsageCli;
  adapter: UsageSourceAdapter;
  cursorKey: string;
  /** Parser state for a file read from the start. */
  freshParser: UsageParserState;
  filePath: string;
  size: number;
  mtimeMs: number;
  inode: number;
}

/**
 * Parses the local CLI session logs into usage buckets and answers report
 * queries from memory. One serial worker does all the reading: the first round
 * after start is the backfill, and a timer re-scans for changed files after
 * that.
 */
export class UsageService {
  private readonly store: UsageStore;
  private readonly config: UsageConfig | undefined;
  private readonly scanIntervalMs: number;
  private readonly logger: Logger;
  private readonly projects: UsageProjectResolver;
  private readonly onBackfillProgress: (backfill: UsageBackfill) => void;
  private readonly now: () => number;
  private readonly pricing: UsagePricingService;
  private readonly getPricingConfig: () => UsagePricingSettings;

  private roots: UsageLogRoots = { claude: [], codex: [], pi: [], omp: [] };
  private rows = new Map<string, UsageBucketRow>();
  private scanState: UsageScanState = emptyScanState();
  private backfill: UsageBackfill = {
    state: "idle",
    filesTotal: 0,
    filesDone: 0,
    startedAt: null,
  };
  private lastError: string | null = null;
  private compressedLogged = false;
  private timer: NodeJS.Timeout | null = null;
  private round: Promise<void> | null = null;
  private disposed = false;

  constructor(options: UsageServiceOptions) {
    this.logger = options.logger.child({ module: "usage" });
    this.store = new UsageStore({
      dir: path.join(options.paseoHome, "usage"),
      logger: this.logger,
    });
    this.config = options.config;
    this.scanIntervalMs = resolveScanIntervalMs(options.config);
    this.projects = new UsageProjectResolver({ listProjects: options.listProjects });
    this.onBackfillProgress = options.onBackfillProgress;
    this.now = options.config?.now ?? (() => Date.now());
    this.getPricingConfig = options.getPricingConfig;
    const pricingConfig = options.getPricingConfig();
    this.pricing = new UsagePricingService({
      store: this.store,
      logger: this.logger,
      now: this.now,
      autoUpdate: pricingConfig.autoUpdate,
      overrides: pricingConfig.overrides,
      fetch: options.config?.pricing?.fetch,
      timers: options.config?.pricing?.timers,
      snapshot: options.config?.pricing?.snapshot,
      onUpdated: options.onPricingUpdated,
    });
  }

  /** Loads what is already on disk, then starts the backfill round in the background. */
  async start(): Promise<void> {
    this.roots = this.config?.roots ?? (await resolveUsageLogRoots());
    this.applyRows(await this.store.loadRows());
    this.scanState = await this.store.loadScanState();
    await this.pricing.start();
    this.startRound({ backfill: true });
    this.timer = setInterval(() => this.startRound({ backfill: false }), this.scanIntervalMs);
    this.timer.unref();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.pricing.dispose();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.round?.catch(() => undefined);
  }

  async getReport(request: UsageReportRequest): Promise<UsageReport> {
    const rows = Array.from(this.rows.values());
    const attributions = await this.projects.resolveAll(new Set(rows.map((row) => row.cwd)));
    return buildUsageReport({
      rows,
      request,
      projects: attributions,
      pricing: {
        estimateCost: (totals: UsageTokenTotals, model: string) =>
          this.pricing.estimateCost(totals, model),
        isPriced: (model: string) => this.pricing.priceFor(model).priced,
      },
      backfill: this.backfill,
      error: this.lastError,
      now: this.now(),
    });
  }

  /** Every model the rows have ever carried, newest use first. */
  listPricing(): { table: UsagePricingTableInfo; models: UsagePricingModel[] } {
    const seen = new Map<string, UsagePricingModelRef>();
    for (const row of this.rows.values()) {
      const key = modelRowKey(row);
      const existing = seen.get(key);
      if (existing && existing.lastSeenAt >= row.bucket) continue;
      seen.set(key, {
        model: row.model,
        cli: row.cli,
        backend: row.backend,
        lastSeenAt: row.bucket,
      });
    }
    return {
      table: this.pricing.getTableInfo(),
      models: this.pricing.list(Array.from(seen.values())),
    };
  }

  refreshPricing(): Promise<UsagePricingRefreshOutcome> {
    return this.pricing.refresh();
  }

  /** Called when the daemon config changed; a no-op when the price settings did not. */
  applyPricingConfig(): void {
    this.pricing.applyConfig(this.getPricingConfig());
  }

  private startRound(options: { backfill: boolean }): void {
    if (this.disposed || this.round) return;
    const round = this.runRound(options).catch((error: unknown) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error({ err: error }, "Usage scan round failed");
    });
    this.round = round;
    void round.finally(() => {
      if (this.round === round) this.round = null;
    });
  }

  private async runRound(options: { backfill: boolean }): Promise<void> {
    const discovered = await this.discoverFiles();
    const changed = discovered.filter((file) => this.hasChanged(file));
    // The backfill works newest first so the days people look at fill in first.
    changed.sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (options.backfill) {
      this.backfill = {
        state: "running",
        filesTotal: changed.length,
        filesDone: 0,
        startedAt: new Date(this.now()).toISOString(),
      };
      this.onBackfillProgress(this.backfill);
    }

    let pendingRows: UsageBucketRow[] = [];
    let filesSinceFlush = 0;
    let lastFlushAt = this.now();
    let lastProgressAt = 0;
    let cursorDirty = false;

    const flush = async (): Promise<void> => {
      if (!cursorDirty) return;
      if (pendingRows.length > 0) {
        // Rows before the cursor: a crash between the two recounts at most one
        // batch, where the other order would lose it for good.
        await this.store.appendRows(pendingRows);
        pendingRows = [];
      }
      await this.store.saveScanState(this.scanState);
      cursorDirty = false;
      filesSinceFlush = 0;
      lastFlushAt = this.now();
    };

    for (const file of changed) {
      if (this.disposed) break;
      pendingRows.push(...(await this.consumeFile(file)));
      cursorDirty = true;
      filesSinceFlush += 1;
      if (options.backfill) {
        this.backfill = { ...this.backfill, filesDone: this.backfill.filesDone + 1 };
        if (this.now() - lastProgressAt >= PROGRESS_INTERVAL_MS) {
          lastProgressAt = this.now();
          this.onBackfillProgress(this.backfill);
        }
      }
      if (filesSinceFlush >= FLUSH_EVERY_FILES || this.now() - lastFlushAt >= FLUSH_EVERY_MS) {
        await flush();
      }
      await yieldToEventLoop();
    }

    const settled = this.settleIdleTurns(discovered);
    if (settled.length > 0) {
      pendingRows.push(...settled);
      cursorDirty = true;
    }
    await flush();

    // Reached only when the round finished, so it clears an earlier failure.
    this.lastError = null;
    if (options.backfill) {
      this.backfill = { ...this.backfill, state: "done" };
      this.onBackfillProgress(this.backfill);
    }
  }

  private async discoverFiles(): Promise<DiscoveredFile[]> {
    const files = new Map<string, DiscoveredFile>();
    let compressed = 0;
    for (const [cli, adapter] of Object.entries(USAGE_SOURCE_ADAPTERS)) {
      if (!adapter) continue;
      for (const root of this.roots[cli as UsageCli]) {
        const listing = await listUsageFiles(root);
        compressed += listing.compressed;
        for (const filePath of listing.files) {
          const identity = adapter.identify(root, filePath);
          if (!identity) continue;
          const stats = await statFile(filePath);
          if (!stats) continue;
          const candidate: DiscoveredFile = {
            cli: adapter.cli,
            adapter,
            cursorKey: identity.cursorKey,
            freshParser: identity.parser,
            filePath,
            size: stats.size,
            mtimeMs: stats.mtimeMs,
            inode: stats.ino,
          };
          const existing = files.get(identity.cursorKey);
          if (existing && !supersedes(candidate, existing)) continue;
          files.set(identity.cursorKey, candidate);
        }
      }
    }
    if (compressed > 0 && !this.compressedLogged) {
      this.compressedLogged = true;
      this.logger.info(
        { count: compressed },
        "Skipping compressed session logs; their usage is not counted",
      );
    }
    return Array.from(files.values());
  }

  private hasChanged(file: DiscoveredFile): boolean {
    const cursor = this.scanState.cursors[file.cursorKey];
    if (!cursor) return true;
    return cursor.size !== file.size || cursor.mtimeMs !== file.mtimeMs;
  }

  private async consumeFile(file: DiscoveredFile): Promise<UsageBucketRow[]> {
    const cursor = this.resolveCursor(file);
    let handle: FileHandle;
    try {
      handle = await fs.open(file.filePath, "r");
    } catch (error) {
      // The CLI can delete or roll a transcript between readdir and open.
      if (isMissingPathError(error)) return [];
      throw error;
    }

    const rows: UsageBucketRow[] = [];
    let state = cursor.parser;
    let position = cursor.offset;
    let firstAt = cursor.firstAt;
    let lastAt = cursor.lastAt;
    let pending = Buffer.alloc(0);
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    try {
      while (position < file.size) {
        const length = Math.min(READ_CHUNK_BYTES, file.size - position);
        const { bytesRead } = await handle.read(buffer, 0, length, position);
        if (bytesRead === 0) break;
        position += bytesRead;
        const chunk =
          pending.length > 0
            ? Buffer.concat([pending, buffer.subarray(0, bytesRead)])
            : Buffer.from(buffer.subarray(0, bytesRead));
        const result = file.adapter.parse(chunk, state);
        rows.push(...result.rows);
        state = result.state;
        if (result.firstAt && (firstAt === null || result.firstAt < firstAt)) {
          firstAt = result.firstAt;
        }
        if (result.lastAt && (lastAt === null || result.lastAt > lastAt)) lastAt = result.lastAt;
        pending = chunk.subarray(result.consumedBytes);
      }
    } finally {
      await handle.close();
    }

    this.scanState = {
      ...this.scanState,
      cursors: {
        ...this.scanState.cursors,
        [file.cursorKey]: {
          ...cursor,
          path: file.filePath,
          inode: file.inode,
          size: file.size,
          mtimeMs: file.mtimeMs,
          offset: position - pending.length,
          firstAt,
          lastAt,
          parser: state,
        },
      },
    };
    this.applyRows(rows);
    return rows;
  }

  /**
   * A file that grew is read from where we stopped; one that shrank or was
   * replaced is read again from the top, which double counts what it still
   * holds but is the only way back to a correct cursor.
   */
  private resolveCursor(file: DiscoveredFile): UsageScanCursor {
    const existing = this.scanState.cursors[file.cursorKey];
    const fresh: UsageScanCursor = {
      cli: file.cli,
      path: file.filePath,
      inode: file.inode,
      size: file.size,
      mtimeMs: file.mtimeMs,
      offset: 0,
      firstAt: null,
      lastAt: null,
      parser: file.freshParser,
    };
    if (!existing) return fresh;
    if (file.size < existing.offset || file.inode !== existing.inode) {
      this.logger.warn(
        { path: file.filePath, size: file.size, offset: existing.offset },
        "Usage log file was rewritten; rescanning it from the start",
      );
      return fresh;
    }
    return existing;
  }

  private settleIdleTurns(discovered: DiscoveredFile[]): UsageBucketRow[] {
    const cutoff = this.now() - IDLE_TURN_SETTLE_MS;
    const byKey = new Map(discovered.map((file) => [file.cursorKey, file]));
    const rows: UsageBucketRow[] = [];
    for (const [cursorKey, cursor] of Object.entries(this.scanState.cursors)) {
      const file = byKey.get(cursorKey);
      if (!file || file.mtimeMs > cutoff) continue;
      const adapter = USAGE_SOURCE_ADAPTERS[cursor.cli];
      if (!adapter) continue;
      const result = adapter.settleIdle(cursor.parser);
      if (result.rows.length === 0) continue;
      rows.push(...result.rows);
      this.scanState = {
        ...this.scanState,
        cursors: { ...this.scanState.cursors, [cursorKey]: { ...cursor, parser: result.state } },
      };
    }
    this.applyRows(rows);
    return rows;
  }

  private applyRows(rows: UsageBucketRow[]): void {
    for (const row of rows) mergeBucketRow(this.rows, row);
  }
}

/**
 * The interval is a constant with an environment escape hatch; it is not a
 * user-facing setting. `config.scanIntervalMs` is the test seam.
 */
function resolveScanIntervalMs(config: UsageConfig | undefined): number {
  if (config?.scanIntervalMs !== undefined) return config.scanIntervalMs;
  const fromEnv = Number(process.env[SCAN_INTERVAL_ENV]);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_USAGE_SCAN_INTERVAL_MS;
}

/**
 * Two paths can hold the same session — a Codex thread copied into
 * `archived_sessions/` — and reading both would count it twice. The fuller copy
 * wins whichever root it came from, so which one the scanner follows does not
 * depend on the order the roots happen to be listed in.
 */
function supersedes(candidate: DiscoveredFile, existing: DiscoveredFile): boolean {
  if (candidate.size !== existing.size) return candidate.size > existing.size;
  if (candidate.mtimeMs !== existing.mtimeMs) return candidate.mtimeMs > existing.mtimeMs;
  return candidate.filePath < existing.filePath;
}

interface UsageFileListing {
  files: string[];
  /** Rollouts Codex compressed to `.jsonl.zst`, which the scanner cannot read. */
  compressed: number;
}

async function listUsageFiles(root: string): Promise<UsageFileListing> {
  const listing: UsageFileListing = { files: [], compressed: 0 };
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    // A CLI that is not installed has no root; the next round tries again.
    if (isMissingPathError(error)) return listing;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await listUsageFiles(full);
      listing.files.push(...nested.files);
      listing.compressed += nested.compressed;
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".jsonl")) listing.files.push(full);
    else if (entry.name.endsWith(".jsonl.zst")) listing.compressed += 1;
  }
  return listing;
}

async function statFile(
  filePath: string,
): Promise<{ size: number; mtimeMs: number; ino: number } | null> {
  try {
    const stats = await fs.stat(filePath);
    return { size: stats.size, mtimeMs: stats.mtimeMs, ino: stats.ino };
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}
