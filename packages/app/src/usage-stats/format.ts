/**
 * Number shapes for usage figures wherever they appear — the usage page, the
 * turn footer, the context meter. Thousands separators, percent signs and
 * decimal marks follow the UI language; `K` / `M` / `B` and `$` do not, so the
 * same abbreviation reads the same in every language on the same screen.
 */

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

/** `↑14.3K ↓4.6K` — uncached input in, output out. One shape, two surfaces. */
export function formatTokenArrows(input: number, output: number): string {
  return `↑${formatUsageTokensCompact(input)} ↓${formatUsageTokensCompact(output)}`;
}

/**
 * Session and turn cost: four decimals under a cent, two above. A model the
 * price table does not know reads `$0.00`, which the surrounding UI marks as
 * "no price data" rather than as free.
 */
export function formatSessionCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/** Two decimals, always. An unpriced model reads `$0.00`, never a blank. */
export function formatUsageCost(value: number): string {
  return `$${value.toFixed(2)}`;
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
