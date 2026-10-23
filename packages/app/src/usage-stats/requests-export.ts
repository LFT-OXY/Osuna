// 导出文件名（选中一天写「day-日期」，起止两天写「起-to-止」，全部时间加上今天）照 magpie
// （https://github.com/yetone/magpie，internal/gui/usage.go 的 csvStamp）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { UsageRequestFilters } from "@getpaseo/protocol/usage/types";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { extractFailureReason } from "@/price-table/pricing";
import { toErrorMessage } from "@/utils/error-messages";
import type { UsageHostInput, UsageRuntimeSnapshot } from "./aggregated-usage";
import type { UsageRange } from "./period";

export interface UsageRequestsExportRuntime {
  getClient(serverId: string): Pick<DaemonClient, "usageRequestsExport"> | null;
  getSnapshot(serverId: string): UsageRuntimeSnapshot | null | undefined;
}

export interface FetchUsageRequestsCsvInput {
  /** Already filtered to hosts that advertise `features.gatewayLedger`. */
  hosts: readonly UsageHostInput[];
  runtime: UsageRequestsExportRuntime;
  range: UsageRange;
  timezone: string;
  filters: UsageRequestFilters;
}

/** A host whose rows are not in the file: not connected, or it answered with an error. */
export interface UsageRequestsExportSkip {
  serverId: string;
  serverName: string;
  reason: { kind: "offline" } | { kind: "error"; message: string };
}

export type UsageRequestsCsvResult =
  | { status: "exported"; csv: string; skipped: UsageRequestsExportSkip[] }
  | { status: "none"; skipped: UsageRequestsExportSkip[] };

/**
 * Every request the filters keep on every host that answers, as one CSV, and
 * the hosts left out with why. Only when no host answers is there no file.
 */
export async function fetchUsageRequestsCsv(
  input: FetchUsageRequestsCsvInput,
): Promise<UsageRequestsCsvResult> {
  const answers = await Promise.all(
    input.hosts.map(async (host): Promise<{ csv: string } | UsageRequestsExportSkip> => {
      const client = input.runtime.getClient(host.serverId);
      const online = input.runtime.getSnapshot(host.serverId)?.connectionStatus === "online";
      const skip = (reason: UsageRequestsExportSkip["reason"]): UsageRequestsExportSkip => ({
        serverId: host.serverId,
        serverName: host.serverName,
        reason,
      });
      if (!client || !online) return skip({ kind: "offline" });
      try {
        const payload = await client.usageRequestsExport({
          from: input.range.from,
          to: input.range.to,
          timezone: input.timezone,
          filters: input.filters,
        });
        return { csv: payload.csv };
      } catch (error) {
        // daemon 的报错去掉日志用的 requestType= / code= 再给人看。
        return skip({
          kind: "error",
          message: extractFailureReason(error) || toErrorMessage(error),
        });
      }
    }),
  );
  const csvs: string[] = [];
  const skipped: UsageRequestsExportSkip[] = [];
  for (const answer of answers) {
    if ("csv" in answer) csvs.push(answer.csv);
    else skipped.push(answer);
  }
  if (csvs.length === 0) return { status: "none", skipped };
  return { status: "exported", csv: mergeUsageRequestCsvs(csvs), skipped };
}

/**
 * One file from every host's: one header, the rows newest first. Each host's
 * rows are newest first already and start with an RFC 3339 time, which no
 * quote or comma ever enters.
 */
export function mergeUsageRequestCsvs(csvs: readonly string[]): string {
  const [first] = csvs;
  if (first === undefined) throw new Error("No CSV to merge");
  if (csvs.length === 1) return first;
  const [header] = splitCsvRecords(first);
  const rows = csvs.flatMap((csv) => splitCsvRecords(csv).slice(1));
  const timeOf = (row: string) => Date.parse(row.slice(0, row.indexOf(",")));
  rows.sort((a, b) => timeOf(b) - timeOf(a));
  return [header, ...rows].map((record) => `${record}\n`).join("");
}

/** The CSV's records as written, a line break inside quotes kept in its record. */
function splitCsvRecords(csv: string): string[] {
  const records: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (char === '"') quoted = !quoted;
    else if (char === "\n" && !quoted) {
      records.push(csv.slice(start, index));
      start = index + 1;
    }
  }
  return records;
}

/** `osuna-requests-day-2026-10-23.csv`, `osuna-requests-2026-10-01-to-2026-10-31.csv`, or for all time the day it was saved. */
export function usageRequestsCsvFileName(range: UsageRange, today: string): string {
  if (range.from === null || range.to === null) return `osuna-requests-all-${today}.csv`;
  if (range.from === range.to) return `osuna-requests-day-${range.from}.csv`;
  return `osuna-requests-${range.from}-to-${range.to}.csv`;
}
