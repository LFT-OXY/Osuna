import { promises as fs, type Dirent } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import type { Logger } from "pino";
import type {
  UsageAgentSummary,
  UsageAgentTurn,
  UsageBackfill,
  UsageCli,
  UsagePricingModel,
  UsagePricingTableInfo,
  UsageReport,
  UsageSessionHandle,
  UsageTokenTotals,
} from "@osuna/protocol/usage/types";
import type { PersistedProjectRecord } from "../workspace-registry.js";
import type { UsageAgentBridge, UsageAgentTurnEvent } from "./agent-sessions.js";
import { stampCodexTurnIds } from "./codex-turn-match.js";
import type { UsageConfig, UsagePricingSettings } from "./config.js";
import { resolveUsageLogRoots, type UsageLogRoots } from "./log-roots.js";
import {
  UsagePricingService,
  type UsagePricingModelRef,
  type UsagePricingRefreshOutcome,
} from "./pricing/service.js";
import { UsageProjectResolver } from "./project-attribution.js";
import { buildAgentSummary, buildAgentTurns, type AgentReportInput } from "./agent-report.js";
import { buildUsageReport, type UsageReportPricing, type UsageReportRequest } from "./report.js";
import { buildUsageSessionChains } from "./session-chains.js";
import {
  buildUsageSessions,
  type UsageSessionsRequest,
  type UsageSessionsResult,
} from "./sessions.js";
import { locateSessionFile } from "./session-files.js";
import { USAGE_SOURCE_ADAPTERS, sessionCursorKey, type UsageSourceAdapter } from "./sources.js";
import { UsageStore, type UsageRowSet } from "./store.js";
import { UsageTurnIndex, resolveTurnRows } from "./turn-rows.js";
import {
  emptyScanState,
  isMissingPathError,
  mergeBucketRow,
  modelRowKey,
  type UsageBucketRow,
  type UsageParserState,
  type UsageScanCursor,
  type UsageScanState,
  type UsageTurnRow,
  type UsageTurnRowDraft,
} from "./types.js";

export const DEFAULT_USAGE_SCAN_INTERVAL_MS = 60_000;
const SCAN_INTERVAL_ENV = "OSUNA_USAGE_SCAN_INTERVAL_MS";

/** How long a file must stay untouched before an unfinished turn is settled. */
const IDLE_TURN_SETTLE_MS = 10 * 60 * 1000;
/**
 * A subagent draft waiting on a parent turn is given up on after this. The real
 * stop condition is a later turn having begun; this only keeps a session that
 * never ran another turn from holding its drafts forever, so it is generous.
 */
const PENDING_TURN_ROW_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * A turn the targeted parse found still open is retried on these delays; after
 * the last one the periodic scan picks the file up like any other.
 */
const TARGETED_RETRY_DELAYS_MS = [2_000, 10_000];
const FLUSH_EVERY_FILES = 20;
const FLUSH_EVERY_MS = 500;
const PROGRESS_INTERVAL_MS = 1000;
const READ_CHUNK_BYTES = 1024 * 1024;

export interface UsageServiceOptions {
  osunaHome: string;
  config: UsageConfig | undefined;
  logger: Logger;
  listProjects: () => Promise<PersistedProjectRecord[]>;
  onBackfillProgress: (backfill: UsageBackfill) => void;
  /** Reads the live price settings from the daemon config, which owns them. */
  getPricingConfig: () => UsagePricingSettings;
  onPricingUpdated: () => void;
  agents: UsageAgentBridge;
  onUsageUpdated: (event: { cli: UsageCli; sessionId: string; agentId?: string }) => void;
}

/** A file a finished turn asked for, ahead of whatever the scan queued. */
interface TargetedFile {
  file: DiscoveredFile;
  agentId: string;
  turnId: string | null;
  /** When the turn ended, which bounds the turn its id may be stamped on. */
  endedAt: string;
  attempt: number;
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
  private readonly turns = new UsageTurnIndex();
  /** Subagent rows whose parent turn had not grown far enough to cover them. */
  private pendingTurnDrafts: UsageTurnRowDraft[] = [];
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
  private readonly agents: UsageAgentBridge;
  private readonly onUsageUpdated: (event: {
    cli: UsageCli;
    sessionId: string;
    agentId?: string;
  }) => void;
  private unsubscribeTurns: (() => void) | null = null;
  /** Files a finished turn asked for, keyed like the cursors so they dedupe. */
  private readonly targeted = new Map<string, TargetedFile>();
  private readonly retryTimers = new Set<NodeJS.Timeout>();
  /** Sessions this round changed, drained into `usage.updated` on each flush. */
  private readonly touchedSessions = new Map<
    string,
    { cli: UsageCli; sessionId: string; agentId?: string }
  >();

  constructor(options: UsageServiceOptions) {
    this.logger = options.logger.child({ module: "usage" });
    this.store = new UsageStore({
      dir: path.join(options.osunaHome, "usage"),
      logger: this.logger,
    });
    this.config = options.config;
    this.scanIntervalMs = resolveScanIntervalMs(options.config);
    this.projects = new UsageProjectResolver({ listProjects: options.listProjects });
    this.onBackfillProgress = options.onBackfillProgress;
    this.now = options.config?.now ?? (() => Date.now());
    this.getPricingConfig = options.getPricingConfig;
    this.agents = options.agents;
    this.onUsageUpdated = options.onUsageUpdated;
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
    const stored = await this.store.loadRows();
    this.applyRows(stored.buckets);
    this.turns.addAll(stored.turns);
    this.scanState = await this.store.loadScanState();
    await this.pricing.start();
    this.unsubscribeTurns = this.agents.subscribeTurnEnd((event) => {
      void this.onAgentTurnEnded(event);
    });
    this.startRound({ backfill: true, discover: true });
    this.timer = setInterval(
      () => this.startRound({ backfill: false, discover: true }),
      this.scanIntervalMs,
    );
    this.timer.unref();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.pricing.dispose();
    this.unsubscribeTurns?.();
    this.unsubscribeTurns = null;
    for (const timer of this.retryTimers) clearTimeout(timer);
    this.retryTimers.clear();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.round?.catch(() => undefined);
  }

  async getReport(request: UsageReportRequest): Promise<UsageReport> {
    const rows = Array.from(this.rows.values());
    const attributions = await this.projects.resolveAll(new Set(rows.map((row) => row.cwd)));
    const chains = buildUsageSessionChains(this.scanState);
    return buildUsageReport({
      rows,
      request,
      projects: attributions,
      pricing: this.reportPricing(),
      canonicalSessionId: (cli, sessionId) => chains.canonical(cli, sessionId),
      backfill: this.backfill,
      error: this.lastError,
      now: this.now(),
    });
  }

  /** One row per session and local day, for the page's daily detail table. */
  async listSessions(request: UsageSessionsRequest): Promise<UsageSessionsResult> {
    const rows = Array.from(this.rows.values());
    const attributions = await this.projects.resolveAll(new Set(rows.map((row) => row.cwd)));
    return buildUsageSessions({
      rows,
      turns: this.turns,
      request,
      projects: attributions,
      pricing: this.reportPricing(),
      chains: buildUsageSessionChains(this.scanState),
      handleOf: (cli, sessionId) => this.sessionHandle(cli, sessionId),
      owners: await this.agents.listSessionOwners(),
    });
  }

  /**
   * How Session history resumes this session. Claude and Codex resume by id;
   * Pi and OMP take the transcript path, which is only known once the scanner
   * has seen the file.
   */
  private sessionHandle(cli: UsageCli, sessionId: string): UsageSessionHandle | null {
    if (cli === "claude" || cli === "codex") {
      return { providerId: cli, providerHandleId: sessionId };
    }
    const cursor = this.scanState.cursors[sessionCursorKey(cli, sessionId)];
    return cursor ? { providerId: cli, providerHandleId: cursor.path } : null;
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

  /** What one agent spent across every provider session it has run in. */
  async getAgentUsage(agentId: string): Promise<UsageAgentSummary> {
    return buildAgentSummary(await this.agentReportInput(agentId));
  }

  /** The agent's turns, oldest first, with Osuna's turn id where it is known. */
  async listAgentTurns(agentId: string): Promise<{ turns: UsageAgentTurn[]; complete: boolean }> {
    const { turns, complete } = buildAgentTurns(await this.agentReportInput(agentId));
    const timeline = await this.agents.listTurnTimestamps(agentId);
    return { turns: stampCodexTurnIds(turns, timeline), complete };
  }

  private async agentReportInput(agentId: string): Promise<AgentReportInput> {
    return {
      backing: await this.agents.getBacking(agentId),
      rows: this.rows.values(),
      turns: this.turns,
      scanState: this.scanState,
      backfill: this.backfill,
      pricing: this.reportPricing(),
    };
  }

  private reportPricing(): UsageReportPricing {
    return {
      estimateCost: (totals: UsageTokenTotals, model: string) =>
        this.pricing.estimateCost(totals, model),
      isPriced: (model: string) => this.pricing.priceFor(model).priced,
    };
  }

  refreshPricing(): Promise<UsagePricingRefreshOutcome> {
    return this.pricing.refresh();
  }

  /** Called when the daemon config changed; a no-op when the price settings did not. */
  applyPricingConfig(): void {
    this.pricing.applyConfig(this.getPricingConfig());
  }

  private startRound(options: { backfill: boolean; discover: boolean }): void {
    if (this.disposed || this.round) return;
    const round = this.runRound(options).catch((error: unknown) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error({ err: error }, "Usage scan round failed");
    });
    this.round = round;
    void round.finally(() => {
      if (this.round !== round) return;
      this.round = null;
      // A turn that ended while this round was settling would otherwise wait
      // for the next 60-second tick, which is not what "targeted" means.
      if (this.targeted.size > 0) this.startRound({ backfill: false, discover: false });
    });
  }

  private async runRound(options: { backfill: boolean; discover: boolean }): Promise<void> {
    const discovered = options.discover ? await this.discoverFiles() : [];
    const changed = discovered.filter((file) => this.hasChanged(file));
    // The backfill works newest first so the days people look at fill in first.
    // A subagent file that names no turn is matched against the turns of the
    // session that spawned it, so every main-thread file is read ahead of them.
    changed.sort(
      (a, b) =>
        Number(a.freshParser.subagent) - Number(b.freshParser.subagent) || b.mtimeMs - a.mtimeMs,
    );

    if (options.backfill) {
      this.backfill = {
        state: "running",
        filesTotal: changed.length,
        filesDone: 0,
        startedAt: new Date(this.now()).toISOString(),
      };
      this.onBackfillProgress(this.backfill);
    }

    let pendingRows: UsageRowSet = { buckets: [], turns: [] };
    let filesSinceFlush = 0;
    let lastFlushAt = this.now();
    let lastProgressAt = 0;
    let cursorDirty = false;

    const flush = async (): Promise<void> => {
      if (!cursorDirty) return;
      if (pendingRows.buckets.length > 0 || pendingRows.turns.length > 0) {
        // Rows before the cursor: a crash between the two recounts at most one
        // batch, where the other order would lose it for good.
        await this.store.appendRows(pendingRows);
        pendingRows = { buckets: [], turns: [] };
      }
      await this.store.saveScanState(this.scanState);
      cursorDirty = false;
      filesSinceFlush = 0;
      lastFlushAt = this.now();
      await this.emitTouchedSessions(options.backfill);
    };

    // One serial worker over two queues: a file a finished turn asked for goes
    // first, and a file already waiting in the scan queue is not read twice.
    const consumed = new Set<string>();
    const scanQueue = [...changed];
    while (!this.disposed) {
      const targeted = this.takeTargeted();
      const file = targeted?.file ?? takeUnconsumed(scanQueue, consumed);
      if (!file) break;
      consumed.add(file.cursorKey);
      appendRowSet(pendingRows, await this.consumeFile(file, targeted ?? undefined));
      cursorDirty = true;
      filesSinceFlush += 1;
      if (options.backfill && !targeted) {
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
    if (settled.buckets.length > 0 || settled.turns.length > 0) {
      appendRowSet(pendingRows, settled);
      cursorDirty = true;
    }
    // Last, so the retry sees every turn this round grew or closed.
    const retried = this.retryPendingTurnRows();
    if (retried.length > 0) {
      pendingRows.turns.push(...retried);
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

  private async consumeFile(file: DiscoveredFile, targeted?: TargetedFile): Promise<UsageRowSet> {
    const cursor = this.resolveCursor(file);
    let handle: FileHandle;
    try {
      handle = await fs.open(file.filePath, "r");
    } catch (error) {
      // The CLI can delete or roll a transcript between readdir and open.
      if (isMissingPathError(error)) return { buckets: [], turns: [] };
      throw error;
    }

    const rows: UsageRowSet = { buckets: [], turns: [] };
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
        rows.buckets.push(...result.rows);
        // Main-thread files are read first, so a subagent draft usually finds
        // its turn right here; one whose parent turn is still short waits.
        const resolved = resolveTurnRows(result.turnRows, this.turns);
        rows.turns.push(...resolved.rows);
        this.pendingTurnDrafts.push(...resolved.pending);
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
    if (targeted?.turnId) {
      const stamped = stampClosedTurn(rows.turns, state, targeted);
      // The CLI had not finished writing the turn out; read it again shortly.
      if (stamped === null) this.scheduleTargetedRetry(targeted);
      else rows.turns.push(...stamped);
    }
    const sessionId = state.sessionId;
    if (sessionId && (rows.buckets.length > 0 || rows.turns.length > 0)) {
      this.touchedSessions.set(sessionCursorKey(file.cli, sessionId), {
        cli: file.cli,
        sessionId,
        ...(targeted ? { agentId: targeted.agentId } : {}),
      });
    }
    this.applyRows(rows.buckets);
    this.turns.addAll(rows.turns);
    return rows;
  }

  /** A finished turn puts its own transcript at the head of the worker's queue. */
  private async onAgentTurnEnded(event: UsageAgentTurnEvent): Promise<void> {
    if (this.disposed) return;
    try {
      const backing = await this.agents.getBacking(event.agentId);
      const filePath = backing
        ? await locateSessionFile({
            backing,
            roots: this.roots,
            scanState: this.scanState,
            now: this.now,
          })
        : null;
      const file = filePath ? await this.describeFile(backing!.cli, filePath) : null;
      // A Codex rollout we cannot place yet is left to the periodic scan.
      if (!file) return;
      this.enqueueTargeted({
        file,
        agentId: event.agentId,
        turnId: event.turnId,
        // The turn ended now, so nothing that starts later can be the one it named.
        endedAt: new Date(this.now()).toISOString(),
        attempt: 0,
      });
    } catch (error) {
      this.logger.warn({ err: error, agentId: event.agentId }, "Targeted usage parse failed");
    }
  }

  private enqueueTargeted(entry: TargetedFile): void {
    if (this.disposed) return;
    this.targeted.set(entry.file.cursorKey, entry);
    this.startRound({ backfill: false, discover: false });
  }

  private takeTargeted(): TargetedFile | null {
    for (const [key, entry] of this.targeted) {
      this.targeted.delete(key);
      return entry;
    }
    return null;
  }

  private scheduleTargetedRetry(entry: TargetedFile): void {
    const delay = TARGETED_RETRY_DELAYS_MS[entry.attempt];
    if (delay === undefined || this.disposed) return;
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);
      void this.retryTargeted({ ...entry, attempt: entry.attempt + 1 });
    }, delay);
    timer.unref();
    this.retryTimers.add(timer);
  }

  private async retryTargeted(entry: TargetedFile): Promise<void> {
    const stats = await statFile(entry.file.filePath);
    if (!stats) return;
    this.enqueueTargeted({
      ...entry,
      file: { ...entry.file, size: stats.size, mtimeMs: stats.mtimeMs, inode: stats.ino },
    });
  }

  private async describeFile(cli: UsageCli, filePath: string): Promise<DiscoveredFile | null> {
    const adapter = USAGE_SOURCE_ADAPTERS[cli];
    if (!adapter) return null;
    const root = this.roots[cli].find(
      (candidate) => filePath === candidate || filePath.startsWith(`${candidate}${path.sep}`),
    );
    if (root === undefined) return null;
    const identity = adapter.identify(root, filePath);
    if (!identity) return null;
    const stats = await statFile(filePath);
    if (!stats) return null;
    return {
      cli,
      adapter,
      cursorKey: identity.cursorKey,
      freshParser: identity.parser,
      filePath,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      inode: stats.ino,
    };
  }

  /**
   * One `usage.updated` per session each batch touched. The backfill stays
   * silent — the page reloads once it reports `done` — and an agent id the
   * targeted parse did not carry is looked up from the backing sessions.
   */
  private async emitTouchedSessions(backfill: boolean): Promise<void> {
    const touched = Array.from(this.touchedSessions.values());
    this.touchedSessions.clear();
    if (backfill) return;
    for (const entry of touched) {
      const agentId =
        entry.agentId ??
        (await this.agents.findAgentIdForSession(entry.cli, entry.sessionId)) ??
        undefined;
      this.onUsageUpdated({
        cli: entry.cli,
        sessionId: entry.sessionId,
        ...(agentId ? { agentId } : {}),
      });
    }
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

  private settleIdleTurns(discovered: DiscoveredFile[]): UsageRowSet {
    const cutoff = this.now() - IDLE_TURN_SETTLE_MS;
    const byKey = new Map(discovered.map((file) => [file.cursorKey, file]));
    const rows: UsageRowSet = { buckets: [], turns: [] };
    for (const [cursorKey, cursor] of Object.entries(this.scanState.cursors)) {
      const file = byKey.get(cursorKey);
      if (!file || file.mtimeMs > cutoff) continue;
      const adapter = USAGE_SOURCE_ADAPTERS[cursor.cli];
      if (!adapter) continue;
      const result = adapter.settleIdle(cursor.parser);
      if (result.rows.length === 0) continue;
      rows.buckets.push(...result.rows);
      const resolved = resolveTurnRows(result.turnRows, this.turns);
      rows.turns.push(...resolved.rows);
      this.pendingTurnDrafts.push(...resolved.pending);
      this.scanState = {
        ...this.scanState,
        cursors: { ...this.scanState.cursors, [cursorKey]: { ...cursor, parser: result.state } },
      };
    }
    this.applyRows(rows.buckets);
    this.turns.addAll(rows.turns);
    return rows;
  }

  /**
   * Try the subagent drafts no turn covered when they were read. A draft is let
   * go once a later turn of its session has begun — nothing earlier can still
   * grow over it — and, for a session that never ran another turn, once it has
   * waited out `PENDING_TURN_ROW_TTL_MS`. The buffer is memory only: a restart
   * inside that window loses the drafts, and their tokens stay in the bucket
   * rows alone.
   */
  private retryPendingTurnRows(): UsageTurnRow[] {
    if (this.pendingTurnDrafts.length === 0) return [];
    const resolved = resolveTurnRows(this.pendingTurnDrafts, this.turns);
    const cutoff = new Date(this.now() - PENDING_TURN_ROW_TTL_MS).toISOString();
    this.pendingTurnDrafts = resolved.pending.filter(
      (draft) =>
        draft.attachAt !== null &&
        draft.attachAt >= cutoff &&
        !this.turns.hasTurnAfter(draft.cli, draft.sessionId, draft.attachAt),
    );
    this.turns.addAll(resolved.rows);
    return resolved.rows;
  }

  private applyRows(rows: UsageBucketRow[]): void {
    for (const row of rows) mergeBucketRow(this.rows, row);
  }
}

/** The next scan-queue file the targeted queue has not already read this round. */
function takeUnconsumed(
  queue: DiscoveredFile[],
  consumed: ReadonlySet<string>,
): DiscoveredFile | null {
  while (queue.length > 0) {
    const file = queue.shift();
    if (file && !consumed.has(file.cursorKey)) return file;
  }
  return null;
}

function appendRowSet(target: UsageRowSet, source: UsageRowSet): void {
  target.buckets.push(...source.buckets);
  target.turns.push(...source.turns);
}

/**
 * Stamp Osuna's turn id on the turn the targeted parse was asked about — the
 * newest one in the file. Returns null when the CLI is mid-turn, which is what
 * tells the caller to read the file again in a moment: a turn whose wall clock
 * is not fully settled has not seen its closing line yet.
 *
 * The extra rows it returns cover the retry that finds nothing new to parse:
 * the turn closed on an earlier pass, so the id rides in on a zero row that
 * merges into what is already stored.
 */
function stampClosedTurn(
  turns: UsageTurnRow[],
  state: UsageParserState,
  targeted: TargetedFile,
): UsageTurnRow[] | null {
  const turnId = targeted.turnId;
  if (!turnId) return [];
  const openTurn = state.openTurn;
  if (openTurn && unsettledMs(openTurn) > 0) return null;
  // The turn that ended began before the event did; a later one is a turn the
  // CLI has since started, and stamping it would misname both.
  let closed: { turnKey: string; startedAt: string } | null = null;
  for (const row of turns) {
    if (row.startedAt > targeted.endedAt) continue;
    if (closed && closed.startedAt > row.startedAt) continue;
    closed = { turnKey: row.turnKey, startedAt: row.startedAt };
  }
  if (closed) {
    for (const row of turns) {
      if (row.turnKey === closed.turnKey) row.turnId = turnId;
    }
    return [];
  }
  // A retry that found nothing new still has to deliver the id: the turn closed
  // on an earlier pass, so it rides in on a zero row that merges into what is
  // already stored.
  if (!openTurn?.model || !state.sessionId || openTurn.startedAt > targeted.endedAt) return null;
  return [
    {
      cli: state.kind,
      backend: "turnBackend" in state ? state.turnBackend : null,
      sessionId: state.sessionId,
      turnKey: openTurn.turnKey,
      model: openTurn.model,
      input: 0,
      cachedInput: 0,
      cacheWrite: 0,
      output: 0,
      reasoning: 0,
      startedAt: openTurn.startedAt,
      lastAt: openTurn.lastAt,
      userMessageIds: [...openTurn.userMessageIds],
      turnId,
    },
  ];
}

/** Wall clock of the open turn that no bucket row has accounted for yet. */
function unsettledMs(openTurn: NonNullable<UsageParserState["openTurn"]>): number {
  return Date.parse(openTurn.lastAt) - Date.parse(openTurn.startedAt) - openTurn.settledMs;
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
