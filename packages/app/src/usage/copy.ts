import { i18n } from "@/i18n/i18next";

// User-facing copy for the usage surfaces, kept in one file so localization is a
// single-file change.
// Osuna：noHosts 与 retry 两句已有翻译键，源码里不能再出现字面量（i18n/resources.test.ts 的守卫），先接到
// 现有的键上；其余文案的本地化与「套餐用量」的叫法另行处理。
export const usageCopy = {
  title: "Usage",
  planUsage: "Plan usage",
  options: "Usage options",
  refresh: "Refresh",
  refreshing: "Refreshing...",
  refreshFailed: "Unable to refresh usage",
  updated: "Updated",
  loading: "Loading usage...",
  empty: "No usage data",
  get noHosts(): string {
    return i18n.t("addProject.empty.noConnectedHosts");
  },
  errorTitle: "Unable to load usage",
  hostUnavailable: (host: string) => `Connect to ${host} to see usage`,
  hostUpgradeRequired: (host: string) => `Update ${host} to see usage`,
  clientUnavailable: "Host connection is not ready",
  get retry(): string {
    return i18n.t("sessions.actions.tryAgain");
  },
  pin: "Pin",
  displayAs: "Show",
  displayUsed: "Used",
  displayRemaining: "Remaining",
  showInSidebar: "Show in sidebar",
} as const;
