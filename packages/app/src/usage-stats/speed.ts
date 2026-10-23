// 组内速度与首字等待（按 token 加权、首字取均值、先按速度再按 token 排）移植自 magpie
// （https://github.com/yetone/magpie，internal/gui/assets/app.js 的 ledSpeed、ledTTFT 与 ledCategories）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type {
  UsageSpeed,
  UsageSpeedEndpoint,
  UsageSpeedGroup,
  UsageSpeedGroupBy,
} from "@getpaseo/protocol/usage/types";

/** One Speed card row: the groups of every host that stand for the same thing, summed. */
export interface MergedUsageSpeedGroup extends UsageSpeedGroup {
  key: string;
}

export interface MergedUsageSpeed {
  groupBy: UsageSpeedGroupBy;
  groups: MergedUsageSpeedGroup[];
}

export interface UsageHostSpeed {
  serverId: string;
  speed: UsageSpeed;
}

/**
 * Adds the hosts' speed groups up. An endpoint is told apart across hosts by
 * name, as the endpoint cards are (merge.ts `endpointKeysOf`); Official adds up
 * everywhere. Undefined when no host answered with speed.
 */
export function mergeUsageSpeed(inputs: readonly UsageHostSpeed[]): MergedUsageSpeed | undefined {
  const first = inputs[0];
  if (!first) return undefined;
  const split = namesNotMerged(inputs);
  const groups = new Map<string, MergedUsageSpeedGroup>();
  for (const { serverId, speed } of inputs) {
    const joining = joiningEndpoints(speed.groups, split);
    for (const group of speed.groups) {
      const key = groupKey({ group, serverId, joining });
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, { ...group, key });
        continue;
      }
      groups.set(key, {
        ...existing,
        endpoint: mergedEndpoint(existing.endpoint, group.endpoint),
        tokens: existing.tokens + group.tokens,
        ttftCount: existing.ttftCount + group.ttftCount,
        ttftMs: existing.ttftMs + group.ttftMs,
        speedCount: existing.speedCount + group.speedCount,
        speedOutput: existing.speedOutput + group.speedOutput,
        speedMs: existing.speedMs + group.speedMs,
      });
    }
  }
  return {
    groupBy: first.speed.groupBy,
    groups: [...groups.values()].sort(
      (a, b) => (usageGroupSpeed(b) ?? 0) - (usageGroupSpeed(a) ?? 0) || b.tokens - a.tokens,
    ),
  };
}

/** Tokens a second over the group's summed windows; null when none of its replies told a speed. */
export function usageGroupSpeed(
  group: Pick<UsageSpeedGroup, "speedOutput" | "speedMs">,
): number | null {
  return group.speedMs > 0 ? group.speedOutput / (group.speedMs / 1000) : null;
}

/** The group's mean wait for the first token in ms; null when none was timed. */
export function usageGroupWaitMs(
  group: Pick<UsageSpeedGroup, "ttftCount" | "ttftMs">,
): number | null {
  return group.ttftCount > 0 ? group.ttftMs / group.ttftCount : null;
}

/** A wait in seconds: two decimals under a second, one above. */
export function formatWaitSeconds(ms: number | null): string {
  if (ms === null) return "—";
  const seconds = ms / 1000;
  return `${seconds < 1 ? seconds.toFixed(2) : seconds.toFixed(1)} s`;
}

function endpointKey(input: {
  endpoint: UsageSpeedEndpoint;
  serverId: string;
  joining: ReadonlySet<string>;
}): string {
  const { endpoint, serverId, joining } = input;
  if (endpoint.endpointId === null) return "official";
  if (joining.has(endpoint.endpointId)) return `name:${endpoint.name ?? endpoint.endpointId}`;
  return `host:${serverId}:${endpoint.endpointId}`;
}

function groupKey(input: {
  group: UsageSpeedGroup;
  serverId: string;
  joining: ReadonlySet<string>;
}): string {
  const { group, serverId, joining } = input;
  const endpoint =
    group.endpoint === null ? "" : endpointKey({ endpoint: group.endpoint, serverId, joining });
  return [group.cli ?? "", group.model ?? "", endpoint].join("\u0000");
}

/** Still in use on one host is not deleted. */
function mergedEndpoint(
  a: UsageSpeedEndpoint | null,
  b: UsageSpeedEndpoint | null,
): UsageSpeedEndpoint | null {
  if (a === null || b === null) return a ?? b;
  return { ...a, deleted: a.deleted && b.deleted };
}

/** Distinct endpoints a host's groups name, by name. */
function endpointsByName(groups: readonly UsageSpeedGroup[]): Map<string, UsageSpeedEndpoint[]> {
  const byName = new Map<string, UsageSpeedEndpoint[]>();
  for (const { endpoint } of groups) {
    if (endpoint === null || endpoint.endpointId === null || endpoint.name === null) continue;
    const named = byName.get(endpoint.name) ?? [];
    if (!named.some((seen) => seen.endpointId === endpoint.endpointId)) named.push(endpoint);
    byName.set(endpoint.name, named);
  }
  return byName;
}

/** Names some host has two or more live endpoints of: none of them joins another host's. */
function namesNotMerged(inputs: readonly UsageHostSpeed[]): Set<string> {
  const split = new Set<string>();
  for (const { speed } of inputs) {
    for (const [name, named] of endpointsByName(speed.groups)) {
      if (named.filter((endpoint) => !endpoint.deleted).length > 1) split.add(name);
    }
  }
  return split;
}

/** The endpoint of each name on one host that joins the name's row: its live one, or its only one. */
function joiningEndpoints(
  groups: readonly UsageSpeedGroup[],
  split: ReadonlySet<string>,
): Set<string> {
  const joining = new Set<string>();
  for (const [name, named] of endpointsByName(groups)) {
    if (split.has(name)) continue;
    const stand =
      named.find((endpoint) => !endpoint.deleted) ?? (named.length === 1 ? named[0] : undefined);
    if (stand?.endpointId) joining.add(stand.endpointId);
  }
  return joining;
}
