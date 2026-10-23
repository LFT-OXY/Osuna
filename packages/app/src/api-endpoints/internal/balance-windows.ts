// 配速的写法移植自 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的 quotaPace 与 paceNumber，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { ApiEndpointBalanceWindow } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { UsageDisplayAs } from "@/usage/preferences";
import type { UsageWindowPace } from "@/usage/types";

/** 列表行上显示的窗口：放一旁的不算，取剩得最少的（已用最多的）；没有可比的为 null。 */
export function tightestWindow(
  windows: readonly ApiEndpointBalanceWindow[],
): ApiEndpointBalanceWindow | null {
  let tightest: ApiEndpointBalanceWindow | null = null;
  for (const window of windows) {
    if (window.aside || window.usedPct == null) continue;
    if (tightest === null || window.usedPct > (tightest.usedPct ?? 0)) tightest = window;
  }
  return tightest;
}

/**
 * 配速的文字：四舍五入，「+12%」「−8%」（真的减号）「±0%」。看剩余时符号反过来（照 magpie）；over 说比匀速用得快，
 * 照这样会在重置前用完，不论怎么看。
 */
export function paceOf(input: {
  pacePct: number | null | undefined;
  displayAs: UsageDisplayAs;
}): UsageWindowPace | null {
  const { pacePct, displayAs } = input;
  if (pacePct == null) return null;
  const rounded = Math.round(displayAs === "remaining" ? -pacePct : pacePct);
  const n = rounded === 0 ? 0 : rounded;
  let sign = "±";
  if (n > 0) sign = "+";
  else if (n < 0) sign = "−";
  return { text: `${sign}${Math.abs(n)}%`, over: Math.round(pacePct) > 0 };
}
