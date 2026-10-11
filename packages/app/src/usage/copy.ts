import { i18n } from "@/i18n/i18next";

// User-facing copy for the usage surfaces, kept in one file so callers never touch the keys.
// Osuna：上游的英文字面量改成翻译键。这些界面说的都是订阅额度，按术语表叫「套餐用量」（usage.planUsage.*），
// 九种语言沿用 Osuna 已有的译法；上游的变量名不动。
function key(name: string): string {
  return `usage.planUsage.${name}`;
}

export const usageCopy = {
  get title(): string {
    return i18n.t(key("title"));
  },
  get planUsage(): string {
    return i18n.t(key("title"));
  },
  get options(): string {
    return i18n.t(key("options"));
  },
  get refresh(): string {
    return i18n.t(key("refresh"));
  },
  get refreshing(): string {
    return i18n.t(key("refreshing"));
  },
  get refreshFailed(): string {
    return i18n.t(key("refreshFailed"));
  },
  updated: (ago: string): string => i18n.t(key("updated"), { ago }),
  get loading(): string {
    return i18n.t(key("loading"));
  },
  get empty(): string {
    return i18n.t(key("empty"));
  },
  get noHosts(): string {
    return i18n.t(key("noHosts"));
  },
  get errorTitle(): string {
    return i18n.t(key("errorTitle"));
  },
  hostUnavailable: (host: string): string => i18n.t(key("connectHostToSee"), { host }),
  hostUpgradeRequired: (host: string): string => i18n.t(key("updateHostToSee"), { host }),
  get clientUnavailable(): string {
    return i18n.t(key("clientUnavailable"));
  },
  get retry(): string {
    return i18n.t(key("retry"));
  },
  get pin(): string {
    return i18n.t(key("pin"));
  },
  get displayAs(): string {
    return i18n.t(key("displayAs"));
  },
  get displayUsed(): string {
    return i18n.t(key("displayUsed"));
  },
  get displayRemaining(): string {
    return i18n.t(key("displayRemaining"));
  },
  get showInSidebar(): string {
    return i18n.t(key("showInSidebar"));
  },
} as const;
