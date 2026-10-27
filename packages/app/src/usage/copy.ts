import type { TFunction } from "i18next";
import type { UsageProblem } from "@getpaseo/protocol/messages";
import { i18n } from "@/i18n/i18next";
import { formatAgo } from "./format";

// Messages for usage failures outside the UI. Rendered copy uses useTranslation.
// Osuna：另放两句 Osuna 独有、要在组件外拼的话（账号名、侧栏摘要的无障碍名称），
// 键在 usage.planUsage.*；与上游同义的句子一律用 providerUsage.*。
export const usageCopy = {
  problem: (problem: UsageProblem, now: Date = new Date(), t: TFunction = i18n.t): string => {
    if (problem.kind === "no_quota") return problem.detail;
    const remedy = problem.refreshedBy
      ? t("providerUsage.runToRefresh", { command: problem.refreshedBy })
      : t("providerUsage.signInAgain");
    if (problem.kind === "rejected")
      return t("providerUsage.loginRejected", { status: problem.status, remedy });
    return t("providerUsage.loginExpired", {
      relativeTime: formatAgo(problem.expiresAt, now.getTime(), t),
      remedy,
    });
  },
  get clientUnavailable() {
    return i18n.t("providerUsage.clientUnavailable");
  },
  /** Osuna：一个账号的名字，来源名加账号名，「Claude (a@b.com)」。 */
  accountName: (source: string, account: string): string =>
    i18n.t("usage.planUsage.accountName", { source, account }),
  /** Osuna：侧栏摘要整行的无障碍名称，按界面语言的标点把各窗口连起来。 */
  summary: (label: string, windows: readonly string[]): string =>
    i18n.t("usage.planUsage.summaryLabel", {
      label,
      windows: windows.join(i18n.t("usage.planUsage.summarySeparator")),
    }),
} as const;
