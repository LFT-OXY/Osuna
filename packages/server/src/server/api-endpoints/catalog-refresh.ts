import type pino from "pino";
import { REAL_PRICING_TIMERS, type UsagePricingTimers } from "../usage/pricing/service.js";

/*
 * 每天给每家开着的接口重新拉一次模型清单（prd 第 15 条；magpie 只在命令行设）。daemon 主动发出、带 key 的请求，
 * 和价格表、models.dev 归同一个「价格表自动更新」开关管（docs/usage.md 的对外请求一节）。
 * 启动后先等一会儿再看第一次，和价格表、models.dev 的启动检查错开；之后每小时看一次，
 * 上次拉成（fetchedAt）或上次试过（只记在内存里）离现在不到一天的不拉。失败只记日志，清单不动。
 */

const FIRST_CHECK_DELAY_MS = 5 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const REFRESH_EVERY_MS = 24 * 60 * 60 * 1000;

export interface CatalogRefreshCandidate {
  id: string;
  enabled: boolean;
  fetchedAt: string | undefined;
}

export interface CatalogRefreshScheduleOptions {
  logger: pino.Logger;
  now: () => Date;
  // 每次检查前问一次：「价格表自动更新」关着就不拉，一小时后再问。
  isAllowed: () => boolean;
  candidates: () => CatalogRefreshCandidate[];
  // 拉一家并记下；失败自己记日志，不抛。
  refresh: (endpointId: string, signal: AbortSignal) => Promise<void>;
  // 和价格表同一种可替换的 setTimeout；测试手动到点。
  timers?: UsagePricingTimers;
}

export class CatalogRefreshSchedule {
  private readonly logger: pino.Logger;
  private readonly now: () => Date;
  private readonly isAllowed: () => boolean;
  private readonly candidates: () => CatalogRefreshCandidate[];
  private readonly refresh: (endpointId: string, signal: AbortSignal) => Promise<void>;
  private readonly timers: UsagePricingTimers;
  private readonly triedAt = new Map<string, number>();
  private readonly stopped = new AbortController();
  private cancelPendingCheck: (() => void) | null = null;

  constructor(options: CatalogRefreshScheduleOptions) {
    this.logger = options.logger;
    this.now = options.now;
    this.isAllowed = options.isAllowed;
    this.candidates = options.candidates;
    this.refresh = options.refresh;
    this.timers = options.timers ?? REAL_PRICING_TIMERS;
  }

  start(): void {
    this.scheduleCheck(FIRST_CHECK_DELAY_MS);
  }

  dispose(): void {
    this.stopped.abort();
    this.cancelPendingCheck?.();
    this.cancelPendingCheck = null;
  }

  private scheduleCheck(delayMs: number): void {
    this.cancelPendingCheck?.();
    this.cancelPendingCheck = null;
    if (this.stopped.signal.aborted) return;
    this.cancelPendingCheck = this.timers.schedule(() => {
      this.cancelPendingCheck = null;
      void this.check();
    }, delayMs);
  }

  private async check(): Promise<void> {
    try {
      if (this.isAllowed()) await this.refreshDue();
    } catch (error) {
      this.logger.warn({ err: error }, "Daily model list refresh failed");
    }
    this.scheduleCheck(CHECK_EVERY_MS);
  }

  private async refreshDue(): Promise<void> {
    for (const candidate of this.candidates()) {
      if (this.stopped.signal.aborted) return;
      if (!candidate.enabled) continue;
      const now = this.now().getTime();
      const fetchedAt =
        candidate.fetchedAt === undefined ? Number.NaN : Date.parse(candidate.fetchedAt);
      const last = Math.max(
        Number.isFinite(fetchedAt) ? fetchedAt : Number.NEGATIVE_INFINITY,
        this.triedAt.get(candidate.id) ?? Number.NEGATIVE_INFINITY,
      );
      if (now - last < REFRESH_EVERY_MS) continue;
      this.triedAt.set(candidate.id, now);
      await this.refresh(candidate.id, this.stopped.signal);
    }
  }
}
