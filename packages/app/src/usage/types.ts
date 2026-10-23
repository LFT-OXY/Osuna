import type { ProviderUsageTone, UsageReportEntry } from "@getpaseo/protocol/messages";

export type { UsageReportEntry };
export type UsageReport = UsageReportEntry["report"];
export type UsageTone = ProviderUsageTone;
export type AvailableUsageReport = Extract<UsageReport, { status: "available" }>;
export type UsageWindow = AvailableUsageReport["windows"][number];
export type UsageBalance = NonNullable<AvailableUsageReport["balances"]>[number];
export type UsageBalanceUnit = UsageBalance["unit"];

/** What a host's usage surface shows. `unavailable` is a host state, not a failed request. */
export type UsageView =
  | { kind: "unavailable"; message: string }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; reports: UsageReportEntry[]; isRefreshing: boolean };

/** Osuna：窗口的配速文字（「配速 +12%」）；over 是照这样会在重置前用完。 */
export interface UsageWindowPace {
  text: string;
  over: boolean;
}
