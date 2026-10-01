import { formatUsageTokensCompact } from "@/usage/format";
import { describeTimeAgo, formatShortDuration } from "@/usage/relative-time";
import type { UsageText } from "@/usage/text";
import { deriveTone } from "./tone";
import type {
  ProviderUsageBalance,
  ProviderUsageBalanceUnit,
  ProviderUsageStatus,
  ProviderUsageTone,
  ProviderUsageWindow,
} from "./types";

export function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** daemon 可能只给剩余比例。两者都没有时是 null。 */
export function resolveWindowUsedPct(window: ProviderUsageWindow): number | null {
  if (window.usedPct != null) return window.usedPct;
  if (window.remainingPct != null) return 100 - window.remainingPct;
  return null;
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

/** 窗口的尾部文字：重置时长，或者会在重置前用完时的用完时长（atRisk，危险色）。 */
export interface ProviderUsageWindowTrailing {
  text: UsageText;
  atRisk: boolean;
}

export interface ProviderUsageWindowRow {
  id: string;
  label: string;
  /** 「45%」，不知道用量时是「—」。 */
  percentText: string;
  fillPct: number;
  tone: ProviderUsageTone;
  /** 完整说法（「4d 后重置」「1h 后用完」）；窄栏在它上面改写成短说法。 */
  trailing: ProviderUsageWindowTrailing | null;
}

function resolveWindowTrailing(
  window: ProviderUsageWindow,
  now: number,
): ProviderUsageWindowTrailing | null {
  if (window.runsOutAt != null && window.shortfallPct != null) {
    const runsOut = describeRunsOut(window.runsOutAt, now);
    if (runsOut) return { text: runsOut, atRisk: true };
  }
  const reset = describeReset(window.resetsAt, now);
  return reset ? { text: reset, atRisk: false } : null;
}

/** 一个限额窗口的显示值，卡片表格的一行和窄栏的窗口段都从这里取。 */
export function resolveWindowRow(window: ProviderUsageWindow, now: number): ProviderUsageWindowRow {
  const usedPct = resolveWindowUsedPct(window);
  const percentText = usedPct != null ? formatPct(usedPct) : "—";
  const fillPct = clampPct(usedPct ?? 0);
  const tone = window.tone ?? deriveTone(usedPct);
  const trailing = resolveWindowTrailing(window, now);
  return { id: window.id, label: window.label, percentText, fillPct, tone, trailing };
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
      return formatUsageTokensCompact(value);
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

/** 余额的数额：知道上限时写「已用 / 上限」，否则写剩余或已用。 */
export function describeBalanceAmount(balance: ProviderUsageBalance): UsageText {
  const { used, remaining, limit, unit } = balance;
  if (limit != null && limit > 0) {
    const usedAmount = used ?? (remaining != null ? limit - remaining : null);
    const usedText = usedAmount != null ? formatAmount(usedAmount, unit) : "—";
    return { text: `${usedText} / ${formatAmount(limit, unit)}` };
  }
  if (remaining != null) {
    return {
      key: "usage.planUsage.balanceLeft",
      params: { amount: formatAmount(remaining, unit) },
    };
  }
  if (used != null) {
    return { text: formatAmount(used, unit) };
  }
  return { text: "—" };
}
