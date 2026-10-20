import type pino from "pino";
import { REAL_PRICING_TIMERS, type UsagePricingTimers } from "../usage/pricing/service.js";

/*
 * 每天给每家开着的接口重新拉一次模型清单（prd 第 15 条；magpie 只在命令行设）。daemon 主动发出、带 key 的请求，
 * 和价格表、models.dev 归同一个「价格表自动更新」开关管（docs/usage.md 的对外请求一节）。
 * 启动后先等一会儿再看第一次，和价格表、models.dev 的启动检查错开；之后每分钟看一次（照 magpie listsEvery），
 * 上次拉成（fetchedAt）离现在不到一天的不拉。失败只记日志、清单不动，过 15 分钟再试（照 magpie autolist.go 的 listRetry，
 * 只记在内存里）。
 */

const FIRST_CHECK_DELAY_MS = 5 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 1000;
const REFRESH_EVERY_MS = 24 * 60 * 60 * 1000;
const LIST_RETRY_MS = Math.min(15 * 60 * 1000, REFRESH_EVERY_MS);

/** 拉一家的结果：listed 记下了新清单；failed 没拉成（含没有能问的地址），清单不动。 */
export type CatalogRefreshOutcome = "listed" | "failed";

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
  // 拉一家并记下；上游的失败自己记日志、回 failed，不抛。
  refresh: (endpointId: string, signal: AbortSignal) => Promise<CatalogRefreshOutcome>;
  // 和价格表同一种可替换的 setTimeout；测试手动到点。
  timers?: UsagePricingTimers;
}

export class CatalogRefreshSchedule {
  private readonly logger: pino.Logger;
  private readonly now: () => Date;
  private readonly isAllowed: () => boolean;
  private readonly candidates: () => CatalogRefreshCandidate[];
  private readonly refresh: (
    endpointId: string,
    signal: AbortSignal,
  ) => Promise<CatalogRefreshOutcome>;
  private readonly timers: UsagePricingTimers;
  private readonly failedAt = new Map<string, number>();
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
      // 后台循环的边界（同 reopen-hints.ts 的 scheduleTick）：上游失败 refresh 自己处理，
      // 漏到这里的是意料之外的（如 endpoints.json 读不懂），记日志后下一次照常看。
      void this.check()
        .catch((error: unknown) => {
          this.logger.error({ err: error }, "Failed to look for model lists to refresh");
        })
        .finally(() => this.scheduleCheck(CHECK_EVERY_MS));
    }, delayMs);
  }

  private async check(): Promise<void> {
    if (!this.isAllowed()) return;
    for (const candidate of this.candidates()) {
      if (this.stopped.signal.aborted) return;
      if (!candidate.enabled) continue;
      const now = this.now().getTime();
      const fetchedAt =
        candidate.fetchedAt === undefined ? Number.NaN : Date.parse(candidate.fetchedAt);
      if (Number.isFinite(fetchedAt) && now - fetchedAt < REFRESH_EVERY_MS) continue;
      const failedAt = this.failedAt.get(candidate.id);
      if (failedAt !== undefined && now - failedAt < LIST_RETRY_MS) continue;
      const outcome = await this.refresh(candidate.id, this.stopped.signal);
      if (outcome === "failed") this.failedAt.set(candidate.id, now);
      else this.failedAt.delete(candidate.id);
    }
  }
}
