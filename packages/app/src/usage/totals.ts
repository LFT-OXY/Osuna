import type { UsageSourceRef, UsageTokenTotals } from "@getpaseo/protocol/usage/types";

/**
 * The one number the page calls "tokens". `reasoning` is a subset of `output`,
 * so adding it would double-count the thinking tokens.
 */
export function totalUsageTokens(totals: UsageTokenTotals): number {
  return totals.input + totals.cachedInput + totals.cacheWrite + totals.output;
}

/** Stable identity of a source across hosts and across requests. */
export function usageSourceKey(ref: UsageSourceRef): string {
  return ref.backend ? `${ref.cli}:${ref.backend}` : ref.cli;
}
