import type { UsageText } from "./text";

const MINUTE_MS = 60_000;
const HOUR_MS = MINUTE_MS * 60;
const DAY_MS = HOUR_MS * 24;

/**
 * 「3 分钟前」。套餐用量卡片与价格表都用它，所以键放在跨区块的
 * `usage.common.time.*`，而不是各自的区块里各写一份。
 */
export function describeTimeAgo(iso: string | null | undefined, now: number): UsageText | null {
  if (!iso) return null;
  const elapsed = now - new Date(iso).getTime();
  if (!Number.isFinite(elapsed)) return null;
  if (elapsed < MINUTE_MS) return { key: "usage.common.time.justNow" };
  const days = Math.floor(elapsed / DAY_MS);
  if (days > 0) return { key: "usage.common.time.daysAgo", params: { count: days } };
  const hours = Math.floor(elapsed / HOUR_MS);
  if (hours > 0) return { key: "usage.common.time.hoursAgo", params: { count: hours } };
  return {
    key: "usage.common.time.minutesAgo",
    params: { count: Math.floor(elapsed / MINUTE_MS) },
  };
}

/**
 * 距某个时刻还有多久，写成 `3d` / `3h` / `5m`。单位缩写按 spec 保持英文：同一
 * 屏上只有一种缩写，翻译它会让 `5h` 和「5 小时」同时出现。
 */
export function formatShortDuration(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const remaining = new Date(iso).getTime() - now;
  if (!Number.isFinite(remaining)) return null;
  if (remaining <= 0) return null;
  const days = Math.floor(remaining / DAY_MS);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(remaining / HOUR_MS);
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(remaining / MINUTE_MS)}m`;
}
