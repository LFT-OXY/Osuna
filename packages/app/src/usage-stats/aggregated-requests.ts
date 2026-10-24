import type { UsageRequestFilters } from "@getpaseo/protocol/usage/types";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { toErrorMessage } from "@/utils/error-messages";
import type { UsageHostError, UsageHostInput, UsageRuntimeSnapshot } from "./aggregated-usage";
import type { UsageRange } from "./period";
import {
  mergeUsageRequestPages,
  type MergedUsageRequests,
  type UsageRequestsPage,
} from "./requests";

export const usageRequestsQueryBaseKey = ["usage", "requests"] as const;

export const ALL_USAGE_REQUEST_HOSTS_FAILED_MESSAGE = "No connected hosts could list requests";

export interface UsageRequestsRuntime {
  getClient(serverId: string): Pick<DaemonClient, "usageRequestsList"> | null;
  getSnapshot(serverId: string): UsageRuntimeSnapshot | null | undefined;
}

export interface FetchUsageRequestsInput {
  /** Already filtered to hosts that advertise `features.gatewayLedger`. */
  hosts: readonly UsageHostInput[];
  runtime: UsageRequestsRuntime;
  range: UsageRange;
  timezone: string;
  filters: UsageRequestFilters;
  offset: number;
  limit: number;
}

export type FetchUsageRequestsState =
  | { status: "connecting" }
  | { status: "loaded"; data: MergedUsageRequests; hostErrors: UsageHostError[] };

/**
 * One page of requests from every connected host. Each host is asked for its
 * newest `offset + limit`, which is what the merged page can come from. A host
 * that fails is named in a banner and the rest still list.
 */
export async function fetchUsageRequests(
  input: FetchUsageRequestsInput,
): Promise<FetchUsageRequestsState> {
  const askable = input.hosts.filter(
    (host) =>
      input.runtime.getSnapshot(host.serverId)?.connectionStatus === "online" &&
      input.runtime.getClient(host.serverId),
  );
  if (askable.length === 0) return { status: "connecting" };

  const single = askable.length === 1;
  const pages: UsageRequestsPage[] = [];
  const hostErrors: UsageHostError[] = [];
  await Promise.all(
    askable.map(async (host) => {
      const client = input.runtime.getClient(host.serverId);
      if (!client) return;
      try {
        const payload = await client.usageRequestsList({
          from: input.range.from,
          to: input.range.to,
          timezone: input.timezone,
          filters: input.filters,
          offset: single ? input.offset : 0,
          limit: single ? input.limit : input.offset + input.limit,
        });
        pages.push({
          serverId: host.serverId,
          requests: payload.requests,
          total: payload.total,
          facets: payload.facets,
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
  if (pages.length === 0) throw new Error(ALL_USAGE_REQUEST_HOSTS_FAILED_MESSAGE);

  // 只问了一台主机时它已经按偏移切好了。
  const window = { offset: single ? 0 : input.offset, limit: input.limit };
  return { status: "loaded", data: mergeUsageRequestPages(pages, window), hostErrors };
}
