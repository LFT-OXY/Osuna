// 汇率的取法（open.er-api.com、只认 rates.CNY > 0、回复最多读 1 MB、失败后 10 分钟内不再试、从没取到过按 7.2、读不懂的缓存当作没有）移植自 magpie（https://github.com/yetone/magpie，internal/fx/fx.go，7597c132）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { Logger } from "pino";
import { z } from "zod";
import type { UsageExchangeRate } from "@getpaseo/protocol/usage/rpc-schemas";
import { readOptionalFile } from "../api-endpoints/config-file.js";
import { parseJson } from "../api-endpoints/upstream-http.js";
import { writePrivateFileAtomicSync } from "../private-files.js";

/** A free, no-key endpoint with every currency's rate against one US dollar. */
export const EXCHANGE_RATE_URL = "https://open.er-api.com/v6/latest/USD";
/** magpie keeps a rate 12 hours; Osuna asks at most once a day (prd). */
const RATE_TTL_MS = 24 * 60 * 60 * 1000;
/** After a failed fetch the last rate is answered at once instead of waiting on the network again. */
const RETRY_AFTER_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REPLY_BYTES = 1 << 20;
/** Roughly what a dollar has been worth in yuan, for a first run that never reached the network. */
export const FALLBACK_CNY_PER_USD = 7.2;

const CachedRateSchema = z.object({ cnyPerUsd: z.number().positive(), fetchedAt: z.string() });
type CachedRate = z.infer<typeof CachedRateSchema>;

const ReplySchema = z.object({ rates: z.object({ CNY: z.number().positive() }) });

export interface UsageExchangeRateOptions {
  filePath: string;
  logger: Logger;
  now: () => number;
  userAgent: string;
  /** Read live: while the price table's auto-update is off nothing is fetched. */
  autoUpdate: () => boolean;
  url?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * The USD→CNY rate the CNY currency choice converts estimated costs with.
 * Costs stay stored and computed in USD; only what a client shows is converted.
 * The cache is `usage/exchange-rate.json`: unreadable means none.
 */
export class UsageExchangeRates {
  private readonly filePath: string;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly userAgent: string;
  private readonly autoUpdate: () => boolean;
  private readonly url: string;
  private readonly fetchApi: typeof globalThis.fetch;
  private cached: CachedRate | null | undefined = undefined;
  private failedAt: number | null = null;
  private fetching: Promise<CachedRate | null> | null = null;

  constructor(options: UsageExchangeRateOptions) {
    this.filePath = options.filePath;
    this.logger = options.logger.child({ module: "usage-exchange-rate" });
    this.now = options.now;
    this.userAgent = options.userAgent;
    this.autoUpdate = options.autoUpdate;
    this.url = options.url ?? EXCHANGE_RATE_URL;
    this.fetchApi = options.fetch ?? globalThis.fetch;
  }

  async get(): Promise<UsageExchangeRate> {
    const known = this.known();
    if (known && !this.isStale(known)) return this.answer(known);
    if (!this.autoUpdate() || this.failedRecently()) return this.answer(known);
    const fetched = await this.fetchOnce();
    return this.answer(fetched ?? known);
  }

  private known(): CachedRate | null {
    if (this.cached === undefined) this.cached = this.read();
    return this.cached;
  }

  private isStale(rate: CachedRate): boolean {
    return this.now() - Date.parse(rate.fetchedAt) >= RATE_TTL_MS;
  }

  private failedRecently(): boolean {
    return this.failedAt !== null && this.now() - this.failedAt < RETRY_AFTER_MS;
  }

  private answer(rate: CachedRate | null): UsageExchangeRate {
    if (!rate) {
      return { cnyPerUsd: FALLBACK_CNY_PER_USD, fetchedAt: null, fallback: true, stale: true };
    }
    return { ...rate, fallback: false, stale: this.isStale(rate) };
  }

  /** One fetch at a time: callers that arrive while it runs share its answer. */
  private fetchOnce(): Promise<CachedRate | null> {
    this.fetching ??= this.fetchLive().finally(() => {
      this.fetching = null;
    });
    return this.fetching;
  }

  private async fetchLive(): Promise<CachedRate | null> {
    try {
      const response = await this.fetchApi(this.url, {
        headers: { "user-agent": this.userAgent },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Exchange rate request failed with ${response.status}`);
      const text = await readLimited(response);
      const reply = ReplySchema.safeParse(parseJson(text));
      if (!reply.success) throw new Error("No CNY rate in the exchange rate reply");
      const rate = {
        cnyPerUsd: reply.data.rates.CNY,
        fetchedAt: new Date(this.now()).toISOString(),
      };
      this.cached = rate;
      this.failedAt = null;
      this.write(rate);
      return rate;
    } catch (error) {
      // 取不到汇率不是事故：照旧用上次的（或 7.2）。
      this.failedAt = this.now();
      this.logger.info({ err: error }, "Exchange rate fetch failed; keeping the last rate");
      return null;
    }
  }

  private read(): CachedRate | null {
    let bytes: Buffer | null;
    try {
      bytes = readOptionalFile(this.filePath);
    } catch (error) {
      this.logger.warn({ err: error, filePath: this.filePath }, "Failed to read exchange rate");
      return null;
    }
    if (bytes === null) return null;
    const parsed = CachedRateSchema.safeParse(parseJson(bytes.toString("utf8")));
    if (!parsed.success) {
      this.logger.warn({ filePath: this.filePath }, "Ignoring an unreadable exchange rate file");
      return null;
    }
    return parsed.data;
  }

  private write(rate: CachedRate): void {
    try {
      writePrivateFileAtomicSync(
        this.filePath,
        `${JSON.stringify(CachedRateSchema.parse(rate), null, 2)}\n`,
      );
    } catch (error) {
      // 写不进只记日志：内存里的照样用，下次取到再写。
      this.logger.warn({ err: error, filePath: this.filePath }, "Failed to write exchange rate");
    }
  }
}

/** The reply's text, cut at 1 MB (magpie reads at most that much). */
async function readLimited(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = MAX_REPLY_BYTES - size;
    chunks.push(value.length > room ? value.subarray(0, room) : value);
    size += Math.min(value.length, room);
    if (size >= MAX_REPLY_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}
