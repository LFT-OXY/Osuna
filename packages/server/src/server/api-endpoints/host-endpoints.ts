import type {
  ApiEndpointAgentSettings,
  ApiEndpointModel,
  ApiEndpointRequestFormat,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  API_ENDPOINT_PROVIDERS,
  type ApiEndpointProvider,
  type ApiEndpointState,
  type StoredApiEndpoint,
} from "./store.js";

/*
 * 主机级接口的规则：都是对 endpoints.json 内容的纯计算，读写与 CLI 配置改写在 service 里。
 * 接口数组的顺序即创建顺序，「最早建的」一律按它找。
 */

/** 每个 Agent 自己的请求格式：老客户端的 baseUrl 投影与老 save 的地址都按它落位。 */
export const AGENT_REQUEST_FORMAT: Record<ApiEndpointProvider, ApiEndpointRequestFormat> = {
  claude: "anthropic_messages",
  codex: "openai_responses",
};

/** 从名称生成主机内唯一的标识：小写字母、数字、横杠；生成不出来用 api-N。 */
export function generateEndpointSlug(name: string, taken: ReadonlySet<string>): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base && !taken.has(base)) return base;
  const prefix = base || "api";
  for (let n = base ? 2 : 1; ; n += 1) {
    const candidate = `${prefix}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function findEndpoint(state: ApiEndpointState, id: string): StoredApiEndpoint | null {
  return state.endpoints.find((endpoint) => endpoint.id === id) ?? null;
}

/** 所有开着的接口的已选模型，按创建顺序合并、按 id 去重，label 取最早的一家。 */
export function usableModels(state: ApiEndpointState): ApiEndpointModel[] {
  const models: ApiEndpointModel[] = [];
  for (const endpoint of state.endpoints) {
    if (!endpoint.enabled) continue;
    for (const model of endpoint.models) {
      if (!models.some((existing) => existing.id === model.id)) models.push(model);
    }
  }
  return models;
}

/**
 * 默认模型失踪规则：打开着总开关的 Agent，默认模型不在可用模型里时改成最早开着接口的第一个已选模型；
 * 一个可用模型都不剩时总开关关掉（回官方）。删除接口、关接口开关、去掉模型之后都走这里。
 */
export function settleAgentSettings(state: ApiEndpointState): ApiEndpointState {
  const models = usableModels(state);
  const agents = { ...state.agents };
  for (const provider of API_ENDPOINT_PROVIDERS) {
    const agent = agents[provider];
    if (!agent.enabled) continue;
    if (models.some((model) => model.id === agent.defaultModelId)) continue;
    const first = models[0];
    agents[provider] = first
      ? { enabled: true, defaultModelId: first.id }
      : { enabled: false, defaultModelId: agent.defaultModelId };
  }
  return { ...state, agents };
}

/**
 * CLI 当前指向的接口：总开关开着时，持有默认模型、开着的接口里最早建的一家；官方为 null。
 * 老客户端的 activeEndpointId 就是它。
 */
export function agentTargetEndpoint(
  state: ApiEndpointState,
  provider: ApiEndpointProvider,
): StoredApiEndpoint | null {
  const agent = state.agents[provider];
  if (!agent.enabled) return null;
  return (
    state.endpoints.find(
      (endpoint) =>
        endpoint.enabled && endpoint.models.some((model) => model.id === agent.defaultModelId),
    ) ?? null
  );
}

/** 老客户端看到的 baseUrl：该 Agent 自己格式的地址，没有就取第一个。 */
export function projectedBaseUrl(
  endpoint: StoredApiEndpoint,
  provider: ApiEndpointProvider,
): string {
  const own = endpoint.baseUrls.find((entry) => entry.format === AGENT_REQUEST_FORMAT[provider]);
  return (own ?? endpoint.baseUrls[0])?.url ?? "";
}

/**
 * 老客户端看到的这家的默认模型：该 Agent 正用着、且这家也有的默认模型；
 * 否则老表单上次为这家选的；否则第一个已选模型。老客户端 set_active 也取它。
 */
export function projectedDefaultModelId(
  agent: ApiEndpointAgentSettings,
  endpoint: StoredApiEndpoint,
): string {
  const has = (id: string | null | undefined): id is string =>
    typeof id === "string" && endpoint.models.some((model) => model.id === id);
  if (agent.enabled && has(agent.defaultModelId)) return agent.defaultModelId;
  if (has(endpoint.legacyDefaultModelId)) return endpoint.legacyDefaultModelId;
  return endpoint.models[0]?.id ?? "";
}
