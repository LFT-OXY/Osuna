import {
  API_ENDPOINT_REQUEST_FORMATS,
  type ApiEndpoint,
  type ApiEndpointAgentIssue,
  type ApiEndpointAgentSettings,
  type ApiEndpointHealthIssue,
  type ApiEndpointListResponse,
  type ApiEndpointReopenHint,
  type ApiEndpointRequestFormat,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/*
 * 「第三方接口」页的纯计算：接口是主机共用的，列表按接口开关分两组，每行的状态与摘要从列表响应里得出。
 * 列表响应带的老客户端投影字段（provider、baseUrl、defaultModelId、activeEndpointId）这里一律不读。
 */

type ListPayload = ApiEndpointListResponse["payload"];

export type HostEndpointsLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      endpoints: ApiEndpoint[];
      agents: Record<string, ApiEndpointAgentSettings>;
      // 非空时中转站用不了（如 daemon 以 socket 监听），总开关打不开。
      gatewayUnavailable: ApiEndpointHealthIssue | null;
      // 每个 Agent 的「设置被改过」，按 provider 索引；主机没声明 apiEndpointCliWiring 时为空。
      agentIssues: Record<string, ApiEndpointAgentIssue[]>;
      // 每个 Agent 要重开的副本，按 provider 索引；老主机不发时为空。
      reopenHints: Record<string, ApiEndpointReopenHint[]>;
    };

export function selectHostEndpointsState(input: {
  data: ListPayload | undefined;
  error: Error | null;
}): HostEndpointsLoadState {
  if (input.data?.error) return { status: "error", message: input.data.error.message };
  if (input.data) {
    return {
      status: "ready",
      endpoints: input.data.endpoints,
      agents: input.data.agents ?? {},
      gatewayUnavailable: input.data.gatewayUnavailable ?? null,
      agentIssues: input.data.agentIssues ?? {},
      reopenHints: input.data.reopenHints ?? {},
    };
  }
  if (input.error) return { status: "error", message: input.error.message };
  return { status: "loading" };
}

/** 列表里这一家；还没加载完、出错或已被删除时为 null。 */
export function findHostEndpoint(
  state: HostEndpointsLoadState,
  endpointId: string,
): ApiEndpoint | null {
  if (state.status !== "ready") return null;
  return state.endpoints.find((endpoint) => endpoint.id === endpointId) ?? null;
}

export interface HostEndpointGroups {
  enabled: ApiEndpoint[];
  disabled: ApiEndpoint[];
}

/** 接口开关开着的在「已开启」，关着的在「已关闭」；两组共用一个接口顺序，组内按它排。 */
export function groupHostEndpoints(endpoints: ApiEndpoint[]): HostEndpointGroups {
  return {
    enabled: endpoints.filter((endpoint) => endpoint.enabled !== false),
    disabled: endpoints.filter((endpoint) => endpoint.enabled === false),
  };
}

/** 一次挪动：上移、下移、移到最前、移到最后，或拖到组里的第几个（落在那一行原来的位置）。 */
export type EndpointPlace = "up" | "down" | "top" | "bottom" | { index: number };

function groupIds(endpoints: ApiEndpoint[], id: string): string[] | null {
  const moving = endpoints.find((endpoint) => endpoint.id === id);
  if (!moving) return null;
  const isEnabled = moving.enabled !== false;
  return endpoints
    .filter((endpoint) => (endpoint.enabled !== false) === isEnabled)
    .map((endpoint) => endpoint.id);
}

function targetIndex(place: EndpointPlace, from: number, size: number): number {
  if (place === "up") return from - 1;
  if (place === "down") return from + 1;
  if (place === "top") return 0;
  if (place === "bottom") return size - 1;
  return place.index;
}

/**
 * 挪动之后的完整接口顺序（照 magpie arrangeProvider）：只在这家所在的组（已开启 / 已关闭）里挪，
 * 另一组的接口留在原来的位置上。什么都不会变时为 null。
 */
export function arrangeEndpoint(
  endpoints: ApiEndpoint[],
  id: string,
  place: EndpointPlace,
): string[] | null {
  const group = groupIds(endpoints, id);
  if (!group) return null;
  const from = group.indexOf(id);
  const to = targetIndex(place, from, group.length);
  if (to < 0 || to >= group.length || to === from) return null;
  const moved = group.filter((member) => member !== id);
  moved.splice(to, 0, id);
  const members = new Set(group);
  let next = 0;
  return endpoints.map((endpoint) => (members.has(endpoint.id) ? moved[next++] : endpoint.id));
}

/** 拖动结束后组里的新先后：挪动的是哪一行、落到组里第几个。没挪时为 null。 */
export function draggedEndpoint(
  before: string[],
  after: string[],
): { id: string; index: number } | null {
  const sameWithout = (id: string) => {
    const left = before.filter((entry) => entry !== id);
    const right = after.filter((entry) => entry !== id);
    return left.length === right.length && left.every((entry, i) => entry === right[i]);
  };
  for (const id of after) {
    const index = after.indexOf(id);
    if (index !== before.indexOf(id) && sameWithout(id)) return { id, index };
  }
  return null;
}

export interface EndpointMoves {
  top: boolean;
  up: boolean;
  down: boolean;
  bottom: boolean;
}

/** 行菜单里四个排序项哪些能用：会让顺序变的才能点。 */
export function endpointMoves(endpoints: ApiEndpoint[], id: string): EndpointMoves {
  const can = (place: EndpointPlace) => arrangeEndpoint(endpoints, id, place) !== null;
  return { top: can("top"), up: can("up"), down: can("down"), bottom: can("bottom") };
}

export interface CooldownRemaining {
  unit: "minutes" | "hours";
  value: number;
}

export type EndpointRowStatus =
  | { kind: "available"; tone: "success" }
  | { kind: "cooling"; tone: "warning"; remaining: CooldownRemaining }
  | { kind: "needsCheck"; tone: "danger" }
  | { kind: "disabled"; tone: "muted" };

const MINUTE_MS = 60_000;

/** 关着就是「已关闭」，不管冷却；冷却剩余时间向上取整，满一小时改按小时。 */
export function endpointRowStatus(endpoint: ApiEndpoint, now: Date): EndpointRowStatus {
  if (endpoint.enabled === false) return { kind: "disabled", tone: "muted" };
  const cooldown = endpoint.cooldown;
  if (cooldown?.state === "needs_check") return { kind: "needsCheck", tone: "danger" };
  if (cooldown?.state === "cooling_down" && cooldown.until !== null) {
    const minutes = Math.max(
      1,
      Math.ceil((Date.parse(cooldown.until) - now.getTime()) / MINUTE_MS),
    );
    const remaining: CooldownRemaining =
      minutes < 60
        ? { unit: "minutes", value: minutes }
        : { unit: "hours", value: Math.ceil(minutes / 60) };
    return { kind: "cooling", tone: "warning", remaining };
  }
  return { kind: "available", tone: "success" };
}

export interface EndpointSummary {
  // 这家填了地址的格式，按固定顺序；认不出的格式不列。
  formats: ApiEndpointRequestFormat[];
  // 第一个地址的主机名。
  host: string | null;
  modelCount: number;
}

export function endpointSummary(endpoint: ApiEndpoint): EndpointSummary {
  // 页面只在主机声明 apiEndpointGateway 时打开，列表一定带 baseUrls。
  const baseUrls = endpoint.baseUrls ?? [];
  return {
    formats: API_ENDPOINT_REQUEST_FORMATS.filter((format) =>
      baseUrls.some((entry) => entry.format === format),
    ),
    host: hostOf(baseUrls[0]?.url ?? ""),
    modelCount: endpoint.models.length,
  };
}

const URL_HOST = /^[a-z]+:\/\/([^/?#:]+)/i;

function hostOf(url: string): string | null {
  return URL_HOST.exec(url.trim())?.[1] ?? null;
}

/**
 * 关掉这家接口后会回到官方的 Agent：总开关开着，而剩下开着的接口一个已选模型都没有
 * （默认模型失踪时 daemon 会改用别的可用模型，只有一个都不剩才回官方）。
 */
export function agentsReturningToOfficial(input: {
  endpoints: ApiEndpoint[];
  agents: Record<string, ApiEndpointAgentSettings>;
  switchedOffId: string;
}): string[] {
  const stillUsable = input.endpoints.some(
    (endpoint) =>
      endpoint.id !== input.switchedOffId &&
      endpoint.enabled !== false &&
      endpoint.models.length > 0,
  );
  if (stillUsable) return [];
  return Object.entries(input.agents)
    .filter(([, agent]) => agent.enabled)
    .map(([provider]) => provider);
}

export type AgentSettlement =
  | { provider: string; kind: "kept" }
  | { provider: string; kind: "defaultChanged"; from: string | null; to: string }
  | { provider: string; kind: "official" };

/**
 * 某次改动（删接口、关接口、关模型）之后各个开着总开关的 Agent 会怎样，照 daemon 的默认模型失踪规则：
 * 默认模型还在开着接口的已选模型里就不变，否则改成接口顺序里最靠前的开着接口的第一个已选模型，一个都不剩就回官方。
 * `endpoints` 是改动之后的列表。
 */
export function previewAgentSettlements(input: {
  endpoints: ApiEndpoint[];
  agents: Record<string, ApiEndpointAgentSettings>;
}): AgentSettlement[] {
  const usable = input.endpoints
    .filter((endpoint) => endpoint.enabled !== false)
    .flatMap((endpoint) => endpoint.models.map((model) => model.id));
  const first = usable[0];
  return Object.entries(input.agents)
    .filter(([, agent]) => agent.enabled)
    .map(([provider, agent]): AgentSettlement => {
      if (agent.defaultModelId !== null && usable.includes(agent.defaultModelId)) {
        return { provider, kind: "kept" };
      }
      if (first === undefined) return { provider, kind: "official" };
      return { provider, kind: "defaultChanged", from: agent.defaultModelId, to: first };
    });
}
