import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { UsageTrendStackBy } from "@getpaseo/protocol/usage/types";
import { toErrorMessage } from "@/utils/error-messages";
import { mergeUsageReports, type MergedUsageReport } from "./merge";
import type { UsageRange } from "./period";

export const usageQueryBaseKey = ["usage", "report"] as const;

export const ALL_USAGE_HOSTS_FAILED_MESSAGE = "No connected hosts could load usage";

export interface UsageHostInput {
  serverId: string;
  serverName: string;
}

export interface UsageRuntimeSnapshot {
  connectionStatus: string;
}

export interface UsageRuntime {
  getClient(serverId: string): Pick<DaemonClient, "usageReportGet"> | null;
  getSnapshot(serverId: string): UsageRuntimeSnapshot | null | undefined;
}

export interface UsageHostError {
  serverId: string;
  serverName: string;
  message: string;
}

export interface FetchUsageReportInput {
  /** Already filtered to hosts that advertise `features.usage`. */
  hosts: readonly UsageHostInput[];
  runtime: UsageRuntime;
  range: UsageRange;
  timezone: string;
  stackBy: UsageTrendStackBy;
}

export type FetchUsageReportState =
  | { status: "connecting" }
  | { status: "loaded"; data: MergedUsageReport; hostErrors: UsageHostError[] };

/**
 * Asks every connected supporting host for the same range and adds the answers
 * together. A host that fails contributes a banner row while the rest still
 * render; only when every asked host fails does the screen show an error.
 */
export async function fetchUsageReport(
  input: FetchUsageReportInput,
): Promise<FetchUsageReportState> {
  const askable = input.hosts.filter(
    (host) =>
      input.runtime.getSnapshot(host.serverId)?.connectionStatus === "online" &&
      input.runtime.getClient(host.serverId),
  );

  // No host to ask is not an empty report: zeroes would read as "you used
  // nothing", which is a claim the client has no basis for.
  if (askable.length === 0) return { status: "connecting" };

  const reports: {
    serverId: string;
    report: Awaited<ReturnType<DaemonClient["usageReportGet"]>>;
  }[] = [];
  const hostErrors: UsageHostError[] = [];

  await Promise.all(
    askable.map(async (host) => {
      const client = input.runtime.getClient(host.serverId);
      if (!client) return;
      try {
        const payload = await client.usageReportGet({
          from: input.range.from,
          to: input.range.to,
          timezone: input.timezone,
          trend: { stackBy: input.stackBy },
        });
        reports.push({ serverId: host.serverId, report: payload });
      } catch (error) {
        hostErrors.push({
          serverId: host.serverId,
          serverName: host.serverName,
          message: toErrorMessage(error),
        });
      }
    }),
  );

  if (reports.length === 0) {
    throw new Error(ALL_USAGE_HOSTS_FAILED_MESSAGE);
  }

  return { status: "loaded", data: mergeUsageReports(reports), hostErrors };
}
