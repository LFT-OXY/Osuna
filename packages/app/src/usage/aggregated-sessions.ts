import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { toErrorMessage } from "@/utils/error-messages";
import type { UsageHostError, UsageHostInput, UsageRuntimeSnapshot } from "./aggregated-usage";
import { mergeUsageSessions, type MergedUsageSessions, type UsageSessionsPage } from "./sessions";

export const usageSessionsQueryBaseKey = ["usage", "sessions"] as const;

export const ALL_USAGE_SESSION_HOSTS_FAILED_MESSAGE = "No connected hosts could list sessions";

export interface UsageSessionsRuntime {
  getClient(serverId: string): Pick<DaemonClient, "usageSessionsList"> | null;
  getSnapshot(serverId: string): UsageRuntimeSnapshot | null | undefined;
}

export interface FetchUsageSessionsInput {
  /** Already filtered to hosts that advertise `features.usage`. */
  hosts: readonly UsageHostInput[];
  runtime: UsageSessionsRuntime;
  /** One local day: a day's sessions are what the table expands to. */
  day: string;
  timezone: string;
}

export type FetchUsageSessionsState =
  | { status: "connecting" }
  | { status: "loaded"; data: MergedUsageSessions; hostErrors: UsageHostError[] };

/**
 * Asks every connected supporting host for one day's sessions. Like the report,
 * a host that fails contributes a banner row and the rest still render; only
 * when every asked host fails does the caller see an error.
 */
export async function fetchUsageSessions(
  input: FetchUsageSessionsInput,
): Promise<FetchUsageSessionsState> {
  const askable = input.hosts.filter(
    (host) =>
      input.runtime.getSnapshot(host.serverId)?.connectionStatus === "online" &&
      input.runtime.getClient(host.serverId),
  );
  if (askable.length === 0) return { status: "connecting" };

  const pages: UsageSessionsPage[] = [];
  const hostErrors: UsageHostError[] = [];

  await Promise.all(
    askable.map(async (host) => {
      const client = input.runtime.getClient(host.serverId);
      if (!client) return;
      try {
        const payload = await client.usageSessionsList({
          from: input.day,
          to: input.day,
          timezone: input.timezone,
        });
        pages.push({
          serverId: host.serverId,
          sessions: payload.sessions,
          truncated: payload.truncated,
        });
      } catch (error) {
        hostErrors.push({
          serverId: host.serverId,
          serverName: host.serverName,
          message: toErrorMessage(error),
        });
      }
    }),
  );

  if (pages.length === 0) throw new Error(ALL_USAGE_SESSION_HOSTS_FAILED_MESSAGE);

  return { status: "loaded", data: mergeUsageSessions(pages), hostErrors };
}
