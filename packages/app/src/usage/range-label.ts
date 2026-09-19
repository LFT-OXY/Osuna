import type { UsageCustomRange, UsageRange } from "./period";

/**
 * Both ends are formatted on their own and joined by a translated key, because
 * `Intl.DateTimeFormat.formatRange` collapses a range differently per locale
 * and the joined form has to match the rest of the header.
 */
export interface UsageRangeDescription {
  key: string;
  params: Record<string, string>;
}

function asUtcDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function formatUsageDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(asUtcDate(day));
}

export function formatUsageDayShort(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
  }).format(asUtcDate(day));
}

export function describeUsageRange(range: UsageRange, locale: string): UsageRangeDescription {
  if (!range.from || !range.to) return { key: "usage.overview.rangeAll", params: {} };
  if (range.from === range.to) {
    return {
      key: "usage.overview.rangeSingle",
      params: { day: formatUsageDay(range.from, locale) },
    };
  }
  return {
    key: "usage.overview.range",
    params: { from: formatUsageDay(range.from, locale), to: formatUsageDay(range.to, locale) },
  };
}

/**
 * The custom tab shows the range it holds once it is the selected tab, on the
 * same joining key as the hero line so both read the same way in every language.
 */
export function describeUsageCustomTab(
  custom: UsageCustomRange,
  locale: string,
): UsageRangeDescription {
  return {
    key: "usage.overview.range",
    params: {
      from: formatUsageDayShort(custom.from, locale),
      to: formatUsageDayShort(custom.to, locale),
    },
  };
}
