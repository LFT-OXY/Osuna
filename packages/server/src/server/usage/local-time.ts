/**
 * Buckets and turns are stored in UTC and reported in the client's zone, so
 * every timestamp is formatted once per request and reused across the blocks.
 */
export interface LocalTimeResolver {
  day(at: number): string;
  hour(at: number): string;
  month(at: number): string;
}

export function createLocalTimeResolver(timezone: string): LocalTimeResolver {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const cache = new Map<number, string>();
  const hourKey = (at: number): string => {
    const cached = cache.get(at);
    if (cached !== undefined) return cached;
    const parts = formatter.formatToParts(new Date(at));
    const find = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? "";
    const key = `${find("year")}-${find("month")}-${find("day")}T${find("hour")}`;
    cache.set(at, key);
    return key;
  };
  return {
    hour: hourKey,
    day: (at) => hourKey(at).slice(0, 10),
    month: (at) => hourKey(at).slice(0, 7),
  };
}

export function shiftDay(day: string, offset: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (date ?? 1) + offset));
  return shifted.toISOString().slice(0, 10);
}

export function dayDifference(from: string, to: string): number {
  const parse = (day: string): number => {
    const [year, month, date] = day.split("-").map(Number);
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}
