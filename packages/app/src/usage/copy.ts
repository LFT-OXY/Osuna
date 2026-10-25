import type { UsageProblem } from "@getpaseo/protocol/messages";
import type { TFunction } from "i18next";
import { i18n } from "@/i18n/i18next";
import { formatCompactTimeAgo } from "@/utils/time";
import type { UsageDisplayAs } from "./preferences";

// User-facing copy for the usage surfaces, kept in one file so callers never touch the keys.
// Osuna：上游的英文字面量改成翻译键。这些界面说的都是订阅额度，按术语表叫「套餐用量」（usage.planUsage.*），
// 九种语言沿用 Osuna 已有的译法；上游的变量名不动。
function key(name: string): string {
  return `usage.planUsage.${name}`;
}

const AGO_KEYS: Record<string, string> = {
  m: "usage.common.time.minutesAgo",
  h: "usage.common.time.hoursAgo",
  d: "usage.common.time.daysAgo",
};

/**
 * Osuna：紧凑的时间标签放回句子里，按界面语言写：「now」→「just now」、「5m」→「5m ago」；
 * 「Jan 15」这样的日期原样。英文输出与上游的 formatCompactTimeAgoAsProse 相同。
 */
function agoProse(compact: string): string {
  if (compact === "now") return i18n.t("usage.common.time.justNow");
  const elapsed = /^(\d+)([mhd])$/.exec(compact);
  if (!elapsed) return compact;
  return i18n.t(AGO_KEYS[elapsed[2]], { count: Number(elapsed[1]) });
}

export const usageCopy = {
  /** 额度不可用的原因：登录过期、登录被拒或没有额度，附上刷新方法。 */
  problem: (problem: UsageProblem, now: Date = new Date()): string => {
    if (problem.kind === "no_quota") return problem.detail;
    const remedy = problem.refreshedBy
      ? i18n.t(key("remedyRun"), { command: problem.refreshedBy })
      : i18n.t(key("remedySignIn"));
    if (problem.kind === "rejected") {
      return i18n.t(key("loginRejected"), { status: problem.status, remedy });
    }
    const ago = agoProse(formatCompactTimeAgo(new Date(problem.expiresAt), now));
    return i18n.t(key("loginExpired"), { ago, remedy });
  },
  get title(): string {
    return i18n.t(key("title"));
  },
  /** 一个账号的名字：来源名加账号名，「Claude (a@b.com)」。 */
  accountName: (source: string, account: string): string =>
    i18n.t(key("accountName"), { source, account }),
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
  ago: agoProse,
  updated: (ago: string): string => i18n.t(key("updated"), { ago }),
  get loading(): string {
    return i18n.t(key("loading"));
  },
  get empty(): string {
    return i18n.t(key("empty"));
  },
  get cliSignInsOff(): string {
    return i18n.t(key("cliSignInsOff"));
  },
  get openPrivacySettings(): string {
    return i18n.t(key("openPrivacySettings"));
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
  get showInSidebar(): string {
    return i18n.t(key("showInSidebar"));
  },
  get showInSidebarHint(): string {
    return i18n.t(key("showInSidebarHint"));
  },
  get refreshAll(): string {
    return i18n.t(key("refreshAll"));
  },
  get unpin(): string {
    return i18n.t(key("unpin"));
  },
  agentError: (reason: string): string => i18n.t(key("agentError"), { reason }),
  /** 「69% left」：按剩余显示时，百分比后面说明它是剩下的。 */
  percentLeft: (percent: string): string => i18n.t(key("percentLeft"), { percent }),
  resets: (duration: string): string => i18n.t(key("resets"), { duration }),
  get resettingNow(): string {
    return i18n.t(key("resettingNow"));
  },
  runsOut: (duration: string): string => i18n.t(key("runsOut"), { duration }),
  balanceLeft: (amount: string): string => i18n.t(key("balanceLeft"), { amount }),
  get statusError(): string {
    return i18n.t(key("status.error"));
  },
  get statusUnavailable(): string {
    return i18n.t(key("status.unavailable"));
  },
  /**
   * 侧栏摘要里一个窗口的无障碍说明：「Claude Session 31% used」。结果会被调用方缓存，
   * 所以组件里要传 useTranslation() 的 t 并把它列进依赖，切换语言后才会重算。
   */
  summaryWindow: (
    window: { name: string; percent: string; displayAs: UsageDisplayAs },
    t: TFunction = i18n.t,
  ): string =>
    t(key(window.displayAs === "remaining" ? "summaryWindowLeft" : "summaryWindowUsed"), {
      name: window.name,
      percent: window.percent,
    }),
  /** 侧栏摘要整行的无障碍名称：「Plan usage: Claude Session 31% used, Codex Weekly 12% used」。 */
  summary: (label: string, windows: readonly string[]): string =>
    i18n.t(key("summaryLabel"), {
      label,
      windows: windows.join(i18n.t(key("summarySeparator"))),
    }),
} as const;
