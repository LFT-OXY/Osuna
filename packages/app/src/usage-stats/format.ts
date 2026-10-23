// 万 / 亿的写法（亿两位小数、万一位小数、去掉末尾的 0）照 magpie 的 fmtN，人民币的换算照 fmtCost
// （https://github.com/yetone/magpie，internal/gui/assets/app.js，7597c132）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
/**
 * Number shapes for usage figures wherever they appear — the usage page, the
 * turn footer, the context meter. Thousands separators, percent signs and
 * decimal marks follow the UI language; `K` / `M` / `B` and `$` do not, so the
 * same abbreviation reads the same in every language on the same screen.
 * The two exceptions are the device's own choices: CNY for estimated costs,
 * and 万 / 亿 for token counts in a Chinese UI.
 */

/** How an estimated cost is shown: in USD as priced, or in CNY at a rate the host fetched. */
export type UsageMoney = { currency: "usd" } | { currency: "cny"; cnyPerUsd: number };

export const USD_MONEY: UsageMoney = { currency: "usd" };

/** How a token count is abbreviated: K / M / B, or 万 / 亿 (Chinese UI with the switch on). */
export type UsageTokenUnits = "kmb" | "wanYi";

/** Grouped digits, no decimals — the hero number, table cells, and the backfill counts. */
export function formatGroupedNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(value));
}

/** One decimal, always: `1.2K`, `3.4M`, `5.6B`. Below 1000 the raw count. */
export function formatUsageTokensCompact(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const magnitude = Math.abs(rounded);
  if (magnitude >= 1_000_000_000) return `${sign}${(magnitude / 1_000_000_000).toFixed(1)}B`;
  if (magnitude >= 1_000_000) return `${sign}${(magnitude / 1_000_000).toFixed(1)}M`;
  if (magnitude >= 1_000) return `${sign}${(magnitude / 1_000).toFixed(1)}K`;
  return `${sign}${magnitude}`;
}

/** `1.2 万`, `3.4 亿`; below 10,000 the raw count. */
function formatWanYiTokens(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const magnitude = Math.abs(rounded);
  if (magnitude >= 100_000_000) return `${sign}${Number((magnitude / 100_000_000).toFixed(2))} 亿`;
  if (magnitude >= 10_000) return `${sign}${Number((magnitude / 10_000).toFixed(1))} 万`;
  return `${sign}${magnitude}`;
}

/** A short token count in the device's units: `1.2K` or `1.2 万`. */
export function formatUsageTokens(value: number, units: UsageTokenUnits): string {
  return units === "wanYi" ? formatWanYiTokens(value) : formatUsageTokensCompact(value);
}

/** A whole token count: grouped digits, or `123.5 万` in 万 / 亿. */
export function formatGroupedTokens(input: {
  value: number;
  locale: string;
  units: UsageTokenUnits;
}): string {
  if (input.units === "wanYi") return formatWanYiTokens(input.value);
  return formatGroupedNumber(input.value, input.locale);
}

/** `↑14.3K ↓4.6K` — uncached input in, output out. One shape, two surfaces. */
export function formatTokenArrows(input: {
  input: number;
  output: number;
  units: UsageTokenUnits;
}): string {
  return `↑${formatUsageTokens(input.input, input.units)} ↓${formatUsageTokens(input.output, input.units)}`;
}

/** The amount in the chosen currency, and the sign it is written with. */
function convert(value: number, money: UsageMoney): { amount: number; sign: string } {
  if (money.currency === "cny") return { amount: value * money.cnyPerUsd, sign: "¥" };
  return { amount: value, sign: "$" };
}

/**
 * Session and turn cost: four decimals under a cent, two above. A model the
 * price table does not know reads `$0.00`, which the surrounding UI marks as
 * "no price data" rather than as free.
 */
export function formatSessionCost(value: number, money: UsageMoney): string {
  const { amount, sign } = convert(value, money);
  if (!Number.isFinite(amount) || amount <= 0) return `${sign}0.00`;
  if (amount < 0.01) return `${sign}${amount.toFixed(4)}`;
  return `${sign}${amount.toFixed(2)}`;
}

/** Two decimals, always. An unpriced model reads `$0.00`, never a blank. */
export function formatUsageCost(value: number, money: UsageMoney): string {
  const { amount, sign } = convert(value, money);
  return `${sign}${amount.toFixed(2)}`;
}

/**
 * Two decimals. A source with a real but tiny share reads `<0.01%` instead of
 * `0.00%`, which would be indistinguishable from no usage at all.
 */
export function formatUsageShare(share: number, locale: string): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (share > 0 && share < 0.0001) return `<${formatter.format(0.0001)}`;
  return formatter.format(share);
}
