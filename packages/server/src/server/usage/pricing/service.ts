import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Logger } from "pino";
import type {
  UsageCli,
  UsagePricePerMillion,
  UsagePricingModel,
  UsagePricingOverride,
  UsagePricingRefreshResult,
  UsagePricingTableInfo,
  UsageTokenTotals,
} from "@osuna/protocol/usage/types";
import type { UsageStore } from "../store.js";
import {
  buildPricingIndex,
  matchModelPrice,
  type PricingIndex,
  type PricingMatch,
  type PricingOverrideEntry,
} from "./matcher.js";
import {
  LITELLM_PRICING_URL,
  PRICING_TABLE_SCHEMA,
  slimPricingTable,
  toPerMillion,
  type PricingTable,
} from "./table.js";

/** Long enough for a cold CDN, short enough that a hung socket is not a leak. */
const FETCH_TIMEOUT_MS = 15_000;
const FIRST_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FAILURE_RETRY_MS = 60 * 60 * 1000;

const SNAPSHOT_PATH = fileURLToPath(new URL("./snapshot.json", import.meta.url));

/**
 * `setTimeout` as a port so the daemon E2E can drive the refresh schedule
 * without waiting a day of real time. Scheduling returns the cancel, which
 * keeps the handle inside whichever implementation made it.
 */
export interface UsagePricingTimers {
  schedule(handler: () => void, ms: number): () => void;
}

export const REAL_PRICING_TIMERS: UsagePricingTimers = {
  schedule(handler, ms) {
    const handle = setTimeout(handler, ms);
    handle.unref();
    return () => clearTimeout(handle);
  },
};

export interface UsagePricingServiceOptions {
  store: UsageStore;
  logger: Logger;
  now: () => number;
  autoUpdate: boolean;
  overrides: readonly UsagePricingOverride[];
  fetch?: typeof globalThis.fetch;
  timers?: UsagePricingTimers;
  /** Replaces the built-in snapshot; the test seam for a table with known prices. */
  snapshot?: PricingTable;
  /** Fired after the table or the overrides changed, so clients can re-read. */
  onUpdated: () => void;
}

export interface UsagePricingRefreshOutcome {
  result: UsagePricingRefreshResult;
  fetchedAt: string;
  error: string | null;
}

/** One model as the usage rows know it, for the price table listing. */
export interface UsagePricingModelRef {
  model: string;
  cli: UsageCli;
  backend: string | null;
  lastSeenAt: string;
}

/**
 * Owns the price table: the built-in snapshot, the daily refresh from LiteLLM,
 * the user's overrides, and the model-to-price answers everything else asks
 * for. Costs are computed on read and never stored, so a price change applies
 * to history the moment it lands.
 */
export class UsagePricingService {
  private readonly store: UsageStore;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly fetchApi: typeof globalThis.fetch;
  private readonly timers: UsagePricingTimers;
  private readonly onUpdated: () => void;
  private readonly snapshot: PricingTable | undefined;

  private table: PricingTable = EMPTY_TABLE;
  private tableSource: UsagePricingTableInfo["source"] = "snapshot";
  private index: PricingIndex = { byLowercase: new Map(), bySuffix: new Map() };
  private overrides = new Map<string, PricingOverrideEntry>();
  private autoUpdate: boolean;
  private matches = new Map<string, PricingMatch>();
  private cancelPendingCheck: (() => void) | null = null;
  private disposed = false;
  private refreshing: Promise<UsagePricingRefreshOutcome> | null = null;

  constructor(options: UsagePricingServiceOptions) {
    this.store = options.store;
    this.logger = options.logger.child({ module: "usage-pricing" });
    this.now = options.now;
    this.fetchApi = options.fetch ?? globalThis.fetch;
    this.timers = options.timers ?? REAL_PRICING_TIMERS;
    this.onUpdated = options.onUpdated;
    this.snapshot = options.snapshot;
    this.autoUpdate = options.autoUpdate;
    this.overrides = buildOverrides(options.overrides);
  }

  /** Loads the newer of the cache and the snapshot, then arms the daily check. */
  async start(): Promise<void> {
    const [snapshot, cached] = await Promise.all([
      this.snapshot ?? loadSnapshot(this.logger),
      this.store.loadPricingTable(),
    ]);
    if (cached && cached._meta.fetchedAt >= snapshot._meta.fetchedAt) {
      this.setTable(cached, "cache");
    } else {
      this.setTable(snapshot, "snapshot");
    }
    this.scheduleNextCheck(FIRST_CHECK_DELAY_MS);
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }

  getTableInfo(): UsagePricingTableInfo {
    return {
      fetchedAt: this.table._meta.fetchedAt,
      source: this.tableSource,
      autoUpdate: this.autoUpdate,
    };
  }

  /** Answers are memoized per model id, misses included, and dropped on change. */
  priceFor(model: string): PricingMatch {
    const cached = this.matches.get(model);
    if (cached) return cached;
    const match = matchModelPrice(model, this.table, this.overrides, this.index);
    this.matches.set(model, match);
    return match;
  }

  /** Reasoning tokens are already counted inside output, so they are not billed. */
  estimateCost(totals: UsageTokenTotals, model: string): number {
    const { rates } = this.priceFor(model);
    return (
      totals.input * rates.input +
      totals.cachedInput * rates.cachedInput +
      totals.cacheWrite * rates.cacheWrite +
      totals.output * rates.output
    );
  }

  /** Unpriced models first, then most recently used, so gaps are the top rows. */
  list(models: readonly UsagePricingModelRef[]): UsagePricingModel[] {
    return models
      .map((ref): UsagePricingModel => {
        const match = this.priceFor(ref.model);
        return {
          model: ref.model,
          cli: ref.cli,
          backend: ref.backend,
          priced: match.priced,
          priceSource: match.priceSource,
          matchedKey: match.matchedKey,
          pricePerMillion: match.priced ? toPricePerMillion(match) : null,
          lastSeenAt: ref.lastSeenAt,
        };
      })
      .sort((a, b) => {
        if (a.priced !== b.priced) return a.priced ? 1 : -1;
        if (a.lastSeenAt !== b.lastSeenAt) return a.lastSeenAt < b.lastSeenAt ? 1 : -1;
        return a.model < b.model ? -1 : 1;
      });
  }

  applyConfig(options: { autoUpdate: boolean; overrides: readonly UsagePricingOverride[] }): void {
    const nextOverrides = buildOverrides(options.overrides);
    const autoUpdateChanged = this.autoUpdate !== options.autoUpdate;
    const overridesChanged = !sameOverrides(this.overrides, nextOverrides);
    if (!autoUpdateChanged && !overridesChanged) return;

    this.autoUpdate = options.autoUpdate;
    this.overrides = nextOverrides;
    this.matches.clear();
    if (autoUpdateChanged) this.scheduleNextCheck(FIRST_CHECK_DELAY_MS);
    this.onUpdated();
  }

  /** The user asked, so this runs even when auto-update is switched off. */
  async refresh(): Promise<UsagePricingRefreshOutcome> {
    if (this.refreshing) return this.refreshing;
    const request = this.runRefresh();
    this.refreshing = request;
    try {
      return await request;
    } finally {
      this.refreshing = null;
    }
  }

  private async runRefresh(): Promise<UsagePricingRefreshOutcome> {
    const etag = this.table._meta.etag;
    let response: Response;
    try {
      response = await this.fetchApi(LITELLM_PRICING_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: etag ? { "if-none-match": etag } : {},
      });
    } catch (error) {
      return this.refreshFailed(error);
    }

    if (response.status === 304) {
      // The table itself is unchanged, so only its age moves. Where it came
      // from does not: a snapshot confirmed current is still the snapshot.
      const fetchedAt = new Date(this.now()).toISOString();
      this.table = { ...this.table, _meta: { ...this.table._meta, fetchedAt } };
      await this.store.savePricingTable(this.table);
      return { result: "not_modified", fetchedAt, error: null };
    }
    if (!response.ok) {
      return this.refreshFailed(new Error(`Price table request failed with ${response.status}`));
    }

    let table: PricingTable;
    try {
      table = slimPricingTable(await response.json(), {
        source: LITELLM_PRICING_URL,
        fetchedAt: new Date(this.now()).toISOString(),
        etag: response.headers.get("etag"),
      });
    } catch (error) {
      return this.refreshFailed(error);
    }

    await this.storeTable(table);
    this.onUpdated();
    return { result: "updated", fetchedAt: table._meta.fetchedAt, error: null };
  }

  /**
   * A price table the daemon could not reach is not an incident: the snapshot
   * still prices everything it did an hour ago.
   */
  private refreshFailed(error: unknown): UsagePricingRefreshOutcome {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.info({ err: error }, "Price table refresh failed; keeping the current table");
    return { result: "failed", fetchedAt: this.table._meta.fetchedAt, error: message };
  }

  private async storeTable(table: PricingTable): Promise<void> {
    this.setTable(table, "cache");
    await this.store.savePricingTable(table);
  }

  private setTable(table: PricingTable, source: UsagePricingTableInfo["source"]): void {
    this.table = table;
    this.tableSource = source;
    this.index = buildPricingIndex(table);
    this.matches.clear();
  }

  private scheduleNextCheck(delayMs: number): void {
    this.cancelTimer();
    if (this.disposed || !this.autoUpdate) return;
    this.cancelPendingCheck = this.timers.schedule(() => {
      this.cancelPendingCheck = null;
      void this.runScheduledCheck();
    }, delayMs);
  }

  /**
   * Nothing is fetched while a table that came from upstream is younger than
   * the interval. Running from the built-in snapshot always asks: a fresh
   * install has never spoken to LiteLLM, whatever the snapshot's own date says.
   */
  private async runScheduledCheck(): Promise<void> {
    if (this.disposed || !this.autoUpdate) return;
    const age = this.now() - Date.parse(this.table._meta.fetchedAt);
    if (this.tableSource === "cache" && Number.isFinite(age) && age < CHECK_INTERVAL_MS) {
      this.scheduleNextCheck(CHECK_INTERVAL_MS - age);
      return;
    }
    const outcome = await this.refresh().catch((error: unknown) => {
      this.logger.info({ err: error }, "Scheduled price table refresh failed");
      return { result: "failed" as const, fetchedAt: "", error: null };
    });
    this.scheduleNextCheck(outcome.result === "failed" ? FAILURE_RETRY_MS : CHECK_INTERVAL_MS);
  }

  private cancelTimer(): void {
    this.cancelPendingCheck?.();
    this.cancelPendingCheck = null;
  }
}

const EMPTY_TABLE: PricingTable = {
  _meta: {
    source: LITELLM_PRICING_URL,
    fetchedAt: new Date(0).toISOString(),
    etag: null,
    license: "",
  },
  models: {},
};

/**
 * The snapshot ships with the daemon, so a read failure means a broken install
 * rather than a missing file; the daemon still starts, with nothing priced.
 */
async function loadSnapshot(logger: Logger): Promise<PricingTable> {
  try {
    return PRICING_TABLE_SCHEMA.parse(JSON.parse(await fs.readFile(SNAPSHOT_PATH, "utf8")));
  } catch (error) {
    logger.error({ err: error, path: SNAPSHOT_PATH }, "Built-in price snapshot is unusable");
    return EMPTY_TABLE;
  }
}

/** Case-insensitive exact keys; a repeated model means the last entry wins. */
function buildOverrides(
  overrides: readonly UsagePricingOverride[],
): Map<string, PricingOverrideEntry> {
  const map = new Map<string, PricingOverrideEntry>();
  for (const override of overrides) {
    const model = override.model.trim();
    if (model.length === 0) continue;
    map.set(model.toLowerCase(), { model, pricePerMillion: override.pricePerMillion });
  }
  return map;
}

function sameOverrides(
  a: ReadonlyMap<string, PricingOverrideEntry>,
  b: ReadonlyMap<string, PricingOverrideEntry>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, entry] of a) {
    const other = b.get(key);
    if (!other || other.model !== entry.model) return false;
    if (
      other.pricePerMillion.input !== entry.pricePerMillion.input ||
      other.pricePerMillion.cachedInput !== entry.pricePerMillion.cachedInput ||
      other.pricePerMillion.cacheWrite !== entry.pricePerMillion.cacheWrite ||
      other.pricePerMillion.output !== entry.pricePerMillion.output
    ) {
      return false;
    }
  }
  return true;
}

function toPricePerMillion(match: PricingMatch): UsagePricePerMillion {
  return {
    input: toPerMillion(match.rates.input),
    cachedInput: toPerMillion(match.rates.cachedInput),
    cacheWrite: toPerMillion(match.rates.cacheWrite),
    output: toPerMillion(match.rates.output),
  };
}
