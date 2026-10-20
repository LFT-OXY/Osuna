import type { UsagePricingTimers } from "../usage/pricing/service.js";

/** 只在用例说到点时才到点的计时器；按设定的毫秒数区分（如单个与整批的时限）。 */
export class ManualTimers implements UsagePricingTimers {
  private readonly pending: { ms: number; handler: () => void; isLive: boolean }[] = [];

  schedule(handler: () => void, ms: number): () => void {
    const entry = { ms, handler, isLive: true };
    this.pending.push(entry);
    return () => {
      entry.isLive = false;
    };
  }

  fire(ms: number): void {
    for (const entry of this.pending) {
      if (!entry.isLive || entry.ms !== ms) continue;
      entry.isLive = false;
      entry.handler();
    }
  }
}
