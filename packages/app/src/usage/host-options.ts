import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import type { UsageHostInput } from "./aggregated-usage";

/** Why a host does or does not contribute to the numbers on screen. */
export type UsageHostAvailability = "available" | "unsupported" | "disconnected";

export const USAGE_HOST_AVAILABILITIES = [
  "available",
  "unsupported",
  "disconnected",
] as const satisfies readonly UsageHostAvailability[];

export interface UsageHostOption {
  serverId: string;
  serverName: string;
  availability: UsageHostAvailability;
}

export interface UsageHostSelection {
  /** The one host being shown, or `null` for every counted host at once. */
  selectedServerId: string | null;
  /** The hosts the report is asked for. */
  hosts: UsageHostInput[];
  /** How many hosts the totals add up — what the "All hosts" row claims. */
  countedCount: number;
}

export interface BuildUsageHostOptionsInput {
  hosts: readonly { serverId: string; label: string }[];
  /** `true` supported, `false` too old, `null` it has not introduced itself. */
  supported: ReadonlyMap<string, boolean | null>;
  connection: ReadonlyMap<string, HostRuntimeConnectionStatus>;
}

/**
 * One row per saved host, in the order the sidebar lists them. A host that has
 * not sent its `server_info` yet reads as disconnected rather than too old: its
 * flags are unknown, and "update this host" is a claim we cannot make yet.
 */
export function buildUsageHostOptions(input: BuildUsageHostOptionsInput): UsageHostOption[] {
  return input.hosts.map((host) => {
    const supported = input.supported.get(host.serverId) ?? null;
    const isOnline = input.connection.get(host.serverId) === "online";
    let availability: UsageHostAvailability;
    if (supported === null || !isOnline) {
      availability = "disconnected";
    } else {
      availability = supported ? "available" : "unsupported";
    }
    return { serverId: host.serverId, serverName: host.label, availability };
  });
}

/**
 * A selection only holds while its host still counts. When the chosen host drops
 * off or falls behind, the page widens back to every counted host instead of
 * waiting on a host that can no longer answer; the selection reapplies by itself
 * once that host is back.
 */
export function resolveUsageHostSelection(input: {
  options: readonly UsageHostOption[];
  selectedServerId: string | null;
}): UsageHostSelection {
  const counted = input.options.filter((option) => option.availability === "available");
  const selected = counted.find((option) => option.serverId === input.selectedServerId) ?? null;
  const asked = selected ? [selected] : counted;
  return {
    selectedServerId: selected?.serverId ?? null,
    hosts: asked.map((option) => ({
      serverId: option.serverId,
      serverName: option.serverName,
    })),
    countedCount: counted.length,
  };
}

/** The pill an option carries, or `null` for a host that simply counts. */
export function usageHostStatusKey(availability: UsageHostAvailability): string | null {
  return availability === "available" ? null : `usage.hostFilter.status.${availability}`;
}
