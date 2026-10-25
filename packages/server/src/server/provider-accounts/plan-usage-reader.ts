import type { UsageReportEntry } from "@getpaseo/protocol/messages";
import type { ListUsageReportsOptions } from "../plugins/usage-sources/index.js";
import type { AccountUsageReader, AccountUsageResult } from "./service.js";

/*
 * 当前号的额度沿用套餐用量来源的读法，不新增对外请求：报告 ID 是「来源:账号键」，
 * Codex 的账号键是 ChatGPT 账号 ID，Claude 的是账号 UUID.组织 UUID，与 CliLoginReading 的 identity 同一个口径。
 * 读数走注册表的 5 分钟缓存，与用量页、输入框条共用。
 */

export interface PlanUsageReports {
  listUsageReports(options?: ListUsageReportsOptions): Promise<UsageReportEntry[]>;
}

export function createPlanUsageAccountReader(reports: PlanUsageReports): AccountUsageReader {
  return {
    async read({ provider, identity }) {
      const id = `${provider}:${identity}`;
      let entry: UsageReportEntry | undefined = (
        await reports.listUsageReports({ reportIds: [id] })
      )[0];
      // 还没发现过这个账号（daemon 刚启动、没人打开过用量）：照用量页那样整体发现一次。
      entry ??= (await reports.listUsageReports()).find((report) => report.id === id);
      if (!entry) {
        return {
          status: "failed",
          code: "not_found",
          reason: "Plan usage doesn't see this login",
        };
      }
      return accountUsageFromReport(entry);
    },
  };
}

export function accountUsageFromReport(entry: UsageReportEntry): AccountUsageResult {
  const { report } = entry;
  switch (report.status) {
    case "available":
      return {
        status: "read",
        fetchedAt: entry.fetchedAt,
        windows: report.windows.map((window) => ({
          id: window.id,
          label: window.label,
          ...(window.shortLabel !== undefined ? { shortLabel: window.shortLabel } : {}),
          usedPct: window.usedPct ?? null,
          resetsAt: window.resetsAt ?? null,
        })),
      };
    case "unavailable": {
      const { problem } = report;
      if (problem.kind === "expired") return { status: "failed", reason: "The login expired" };
      if (problem.kind === "rejected") {
        return { status: "failed", reason: `The login was rejected (HTTP ${problem.status})` };
      }
      return { status: "failed", reason: problem.detail };
    }
    case "error":
      return { status: "failed", reason: report.error };
  }
}
