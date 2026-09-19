import { formatTokenCount } from "@/components/context-window-meter.utils";
import { describeTimeAgo, formatShortDuration } from "@/usage/relative-time";
import type { UsageText } from "@/usage/text";
import type {
  ProviderUsage,
  ProviderUsageBalance,
  ProviderUsageBalanceUnit,
  ProviderUsageStatus,
} from "./types";

export function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function formatPct(value: number): string {
  return `${Math.round(clampPct(value))}%`;
}

/** 窗口条尾部的「还有多久重置」。到点了说「正在重置」，而不是倒数一个负数。 */
export function describeReset(iso: string | null | undefined, now: number): UsageText | null {
  if (!iso) return null;
  const remaining = new Date(iso).getTime() - now;
  if (!Number.isFinite(remaining)) return null;
  if (remaining <= 0) return { key: "usage.planUsage.resettingNow" };
  const duration = formatShortDuration(iso, now);
  return duration ? { key: "usage.planUsage.resets", params: { duration } } : null;
}

/** 额度会在重置前用完时，窗口条说的是「什么时候用完」而不是「什么时候重置」。 */
export function describeRunsOut(iso: string | null | undefined, now: number): UsageText | null {
  const duration = formatShortDuration(iso, now);
  return duration ? { key: "usage.planUsage.runsOut", params: { duration } } : null;
}

export function describeFetchedAt(iso: string | null | undefined, now: number): UsageText | null {
  const ago = describeTimeAgo(iso, now);
  return ago ? { key: "usage.planUsage.updated", params: { ago } } : null;
}

export function formatAmount(value: number, unit: ProviderUsageBalanceUnit): string {
  switch (unit) {
    case "usd":
      return `$${value.toFixed(2)}`;
    case "tokens":
      return formatTokenCount(value);
    default:
      return value.toLocaleString();
  }
}

/** 可用时不说话：卡片上只有出问题的供应商带状态字。 */
export function describeStatus(status: ProviderUsageStatus): UsageText | null {
  if (status === "available") return null;
  return status === "error"
    ? { key: "usage.planUsage.status.error" }
    : { key: "usage.planUsage.status.unavailable" };
}

/** 卡片页脚的几段，组件层渲染后用 " · " 连起来。 */
export function describeFooterParts(usage: ProviderUsage, now: number): UsageText[] {
  const parts: UsageText[] = [];
  if (usage.sourceLabel) parts.push({ text: usage.sourceLabel });
  const updated = describeFetchedAt(usage.fetchedAt, now);
  if (updated) parts.push(updated);
  return parts;
}

export interface ResolvedBalance {
  amount: UsageText;
  /** 只有既知道用量又知道上限时才画进度条。 */
  usedPct: number | null;
}

export function resolveBalanceAmount(balance: ProviderUsageBalance): ResolvedBalance {
  const { used, remaining, limit, unit } = balance;
  if (limit != null && limit > 0) {
    const usedAmount = used ?? (remaining != null ? limit - remaining : null);
    const usedPct = usedAmount != null ? (usedAmount / limit) * 100 : null;
    const usedText = usedAmount != null ? formatAmount(usedAmount, unit) : "—";
    return { amount: { text: `${usedText} / ${formatAmount(limit, unit)}` }, usedPct };
  }
  if (remaining != null) {
    return {
      amount: {
        key: "usage.planUsage.balanceLeft",
        params: { amount: formatAmount(remaining, unit) },
      },
      usedPct: null,
    };
  }
  if (used != null) {
    return { amount: { text: formatAmount(used, unit) }, usedPct: null };
  }
  return { amount: { text: "—" }, usedPct: null };
}
