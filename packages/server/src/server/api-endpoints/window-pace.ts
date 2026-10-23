// 配速移植自 magpie（https://github.com/yetone/magpie，internal/provider/window_pace.go 的 Pace 与
// window_holds.go 的 Bounds，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

/** 窗口多长：毫秒数，或「一个自然月」（起点是重置时间往前一个月的同一天）。 */
export type WindowSpan = number | "month";

/**
 * 配速：窗口已用的百分比减去照匀速到现在该用的百分比，单位是窗口的百分点。+12 是比匀速多用了 12 个点，
 * 照这个速度会在重置前用完；−8 是还富余 8 个点。不知道重置时间或窗口长度、现在不在窗口里时为 null。
 */
export function windowPace(input: {
  usedPct: number;
  resetsAt: string | null;
  span: WindowSpan | null;
  now: number;
}): number | null {
  const start = windowStart({ resetsAt: input.resetsAt, span: input.span });
  if (start === null || input.resetsAt === null) return null;
  return paceBetween({
    usedPct: input.usedPct,
    start,
    end: Date.parse(input.resetsAt),
    now: input.now,
  });
}

/** 窗口从什么时候开始：重置时间往前一个窗口长度，月窗口往前一个自然月；不知道时为 null。 */
export function windowStart(input: {
  resetsAt: string | null;
  span: WindowSpan | null;
}): number | null {
  if (input.resetsAt === null || input.span === null) return null;
  const end = Date.parse(input.resetsAt);
  if (Number.isNaN(end)) return null;
  if (input.span !== "month") return end - input.span;
  // 照 Go 的 AddDate(0, -1, 0)：月份减一，日子不够时顺延到下个月（UTC）。
  const at = new Date(end);
  at.setUTCMonth(at.getUTCMonth() - 1);
  return at.getTime();
}

/** 起止已知的窗口在 now 的配速；现在不在窗口里时为 null。 */
export function paceBetween(input: {
  usedPct: number;
  start: number;
  end: number;
  now: number;
}): number | null {
  const { start, end, now } = input;
  const isInside = end > start && now >= start && now < end;
  if (!isInside) return null;
  const even = (100 * (now - start)) / (end - start);
  return Math.max(0, Math.min(100, input.usedPct)) - even;
}
