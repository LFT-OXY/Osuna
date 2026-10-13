import { resolveUsageView, type UsageHost, type UsageQueryState } from "@/usage/model";
import type { UsageView } from "@/usage/types";
import type { UsageHostInput } from "@/usage-stats/aggregated-usage";

export interface PlanUsageHostGroup {
  serverId: string;
  serverName: string;
  view: UsageView;
}

export interface PlanUsageHosts {
  groups: PlanUsageHostGroup[];
  /** 各主机的报告里最近一次取数的时刻，卡片头部按它显示「多久之前」。 */
  fetchedAt: string | null;
  isBusy: boolean;
}

/**
 * 「用量」页的套餐用量跟随页面的主机筛选：页面把几台主机的数字加在一起，只显示其中
 * 一台的套餐会和上面的大数字自相矛盾。每台主机一组，状态的说法与套餐用量弹窗一致。
 */
export interface PlanUsageHostsInput {
  /** 页面计入的主机，按页面的顺序。 */
  hosts: readonly UsageHostInput[];
  usageHosts: readonly UsageHost[];
  /** 与 `hosts` 一一对应；还没开始取的主机是 undefined。 */
  queries: readonly (UsageQueryState | undefined)[];
}

export function resolvePlanUsageHosts(input: PlanUsageHostsInput): PlanUsageHosts {
  const groups = input.hosts.map((host, index): PlanUsageHostGroup => {
    const usageHost = input.usageHosts.find((candidate) => candidate.serverId === host.serverId);
    const isConnected = usageHost?.isConnected === true;
    const supportsUsage = usageHost?.supportsUsage === true;
    const view = resolveUsageView({
      hostLabel: host.serverName,
      isConnected,
      supportsUsage,
      query: input.queries[index],
    });
    return { serverId: host.serverId, serverName: host.serverName, view };
  });
  let fetchedAt: string | null = null;
  let latest = Number.NEGATIVE_INFINITY;
  for (const query of input.queries) {
    for (const report of query?.data ?? []) {
      const fetched = Date.parse(report.fetchedAt);
      if (fetched > latest) {
        latest = fetched;
        fetchedAt = report.fetchedAt;
      }
    }
  }
  const isBusy = input.queries.some((query) => query?.isFetching === true);
  return { groups, fetchedAt, isBusy };
}
