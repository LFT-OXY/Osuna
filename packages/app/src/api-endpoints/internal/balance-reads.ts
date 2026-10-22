/**
 * 每台主机每家接口上次用户要求读余额的时刻（照 magpie quotasAskedAt / QUOTAS_OPEN_GAP）：只在内存里，读时查，不渲染。
 * 上次要求之后 30 秒内再打开页面不算要求，切页面来回不让 daemon 重读；列表页与详情页共用。
 */

// open：打开页面（含换了接口、窗口回到前台）；timed：页面开着时每分钟一次；force：刷新按钮。
export type BalanceReadKind = "open" | "timed" | "force";

const OPEN_GAP_MS = 30_000;

const askedAtByEndpoint = new Map<string, number>();

function askedKey(serverId: string, endpointId: string): string {
  return `${serverId}:${endpointId}`;
}

/** 这次读余额带的 asked 与 force；算用户要求时记下这几家的时刻。 */
export function balanceReadFlags(input: {
  serverId: string;
  endpointIds: readonly string[];
  kind: BalanceReadKind;
  now: number;
}): { asked: boolean; force: boolean } {
  const { serverId, endpointIds, kind, now } = input;
  const force = kind === "force";
  const isStale = (id: string) =>
    now - (askedAtByEndpoint.get(askedKey(serverId, id)) ?? -Infinity) >= OPEN_GAP_MS;
  const asked = force || (kind === "open" && endpointIds.some(isStale));
  if (asked) for (const id of endpointIds) askedAtByEndpoint.set(askedKey(serverId, id), now);
  return { asked, force };
}

export function resetBalanceReadsForTests(): void {
  askedAtByEndpoint.clear();
}
