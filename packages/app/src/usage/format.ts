import { formatTokenCount } from "@/components/context-window-meter.utils";
import { usageCopy } from "./copy";
import type { UsageDisplayAs } from "./preferences";
import type { UsageBalanceUnit } from "./types";

export function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function formatPct(value: number): string {
  return `${Math.round(clampPct(value))}%`;
}

/** "31%" of the window used, or "69% left" of it. */
export function formatDisplayPct(value: number, displayAs: UsageDisplayAs): string {
  return displayAs === "used" ? formatPct(value) : usageCopy.percentLeft(formatPct(value));
}

function relativeDuration(iso: string): string | null {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return null;
  if (diffMs <= 0) return "now";
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) return `${diffDays}d`;
  if (diffHours > 0) return `${diffHours}h`;
  return `${diffMinutes}m`;
}

export function formatResetLabel(iso: string | null | undefined, retained = false): string | null {
  if (!iso) return null;
  const rel = relativeDuration(iso);
  if (!rel) return null;
  if (rel === "now" && retained) return usageCopy.resetTimePassed;
  return rel === "now" ? usageCopy.resettingNow : usageCopy.resets(rel);
}

/** Osuna：会在重置前用完的窗口写「runs out 2h」；用完时间已过时不返回，调用方改显示重置时间。 */
export function formatRunsOutLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const rel = relativeDuration(iso);
  if (!rel || rel === "now") return null;
  return usageCopy.runsOut(rel);
}

/** A balance amount as the app's language writes it: "$1,234.50", "12,345". */
export function formatAmount(value: number, unit: UsageBalanceUnit, locale: string): string {
  switch (unit) {
    case "usd":
      return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(value);
    case "tokens":
      return formatTokenCount(value);
    default:
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  }
}
