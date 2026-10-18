// 没人提供的后台小任务、Subagent 与记忆模型不再设，照 magpie（https://github.com/yetone/magpie，internal/agent/claude.go 的 subagentOwn、internal/agent/codex.go 的 dropSubagent）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

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
import { normalizeOpenAICompatibleBaseUrl } from "../agent/providers/codex-app-server-agent.js";
import { hostOf } from "./model-facts.js";

/*
 * 主机级接口的规则：都是对 endpoints.json 内容的纯计算，读写与 CLI 配置改写在 service 里。
 * 接口数组的顺序即创建顺序，「最早建的」一律按它找。
 */

/** 每个 Agent 自己的请求格式：老客户端的 baseUrl 投影与老 save 的地址都按它落位。 */
export const AGENT_REQUEST_FORMAT: Record<ApiEndpointProvider, ApiEndpointRequestFormat> = {
  claude: "anthropic_messages",
  codex: "openai_responses",
};

/**
 * 老格式的 baseUrl 落进该 Agent 自己的格式时的地址。0.15 存的 Codex 地址可以不带 /v1，
 * 写 config.toml 时才补上；中转站直接按存的地址拼路径，所以迁移和老 save 都在这里补。
 */
export function legacyAgentBaseUrl(provider: ApiEndpointProvider, url: string): string {
  if (AGENT_REQUEST_FORMAT[provider] !== "openai_responses") return url;
  return normalizeOpenAICompatibleBaseUrl(url) ?? url;
}

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

export interface EndpointGroupModel {
  // 会话内部用的 `接口标识/模型名`。
  id: string;
  model: ApiEndpointModel;
}

export interface EndpointModelGroup {
  endpoint: StoredApiEndpoint;
  models: EndpointGroupModel[];
}

/**
 * 聊天模型选择器的分组：每家开着且选了模型的接口一组，按创建顺序；同名模型在各家各出现一次。
 * 模型名本身带斜杠时可能和别家的 `标识/模型名` 撞上，同一个 id 只留最早的一条。
 */
export function endpointModelGroups(state: ApiEndpointState): EndpointModelGroup[] {
  const seen = new Set<string>();
  const groups: EndpointModelGroup[] = [];
  for (const endpoint of state.endpoints) {
    if (!endpoint.enabled) continue;
    const models: EndpointGroupModel[] = [];
    for (const model of endpoint.models) {
      const id = `${endpoint.slug}/${model.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      models.push({ id, model });
    }
    if (models.length > 0) groups.push({ endpoint, models });
  }
  return groups;
}

/**
 * 默认模型能选的名字（ADR 0012）：先是光秃秃的模型名（usableModels 的顺序，哪家提供都行），
 * 再是每家的「接口标识/模型名」（先用那家，不行再自动切换到提供同名模型的别家）。
 */
export function defaultModelChoices(state: ApiEndpointState): string[] {
  const bare = usableModels(state).map((model) => model.id);
  const named = endpointModelGroups(state).flatMap((group) => group.models.map(({ id }) => id));
  return [...bare, ...named.filter((id) => !bare.includes(id))];
}

export function isDefaultModelChoice(
  state: ApiEndpointState,
  id: string | null | undefined,
): id is string {
  return typeof id === "string" && defaultModelChoices(state).includes(id);
}

/** 默认模型指定的那一家与它的模型。 */
export interface NamedDefaultModel {
  endpoint: StoredApiEndpoint;
  model: ApiEndpointModel;
}

/** 光秃秃的名字、或那家已不提供时为 null。 */
export function namedDefaultModel(
  state: ApiEndpointState,
  id: string | null,
): NamedDefaultModel | null {
  if (id === null) return null;
  for (const group of endpointModelGroups(state)) {
    const entry = group.models.find((model) => model.id === id);
    if (entry) return { endpoint: group.endpoint, model: entry.model };
  }
  return null;
}

/** 默认模型去掉接口标识后的模型名；光秃秃的照原样。 */
export function bareDefaultModel(state: ApiEndpointState, id: string | null): string | null {
  return namedDefaultModel(state, id)?.model.id ?? id;
}

/**
 * 默认模型失踪规则：打开着总开关的 Agent，默认模型不再能选时，指定的那家不再提供而别家还有同名的就改成光秃秃的名字，
 * 否则改成最早开着接口的第一个已选模型；一个可用模型都不剩时总开关关掉（回官方）。删除接口、关接口开关、去掉模型之后都走这里。
 */
export function settleAgentSettings(state: ApiEndpointState): ApiEndpointState {
  const models = usableModels(state);
  const agents = { ...state.agents };
  for (const provider of API_ENDPOINT_PROVIDERS) {
    const agent = withoutUnservedSideModels({ state, provider, agent: agents[provider] });
    agents[provider] = agent;
    if (!agent.enabled) continue;
    if (isDefaultModelChoice(state, agent.defaultModelId)) continue;
    const first = models[0];
    if (!first) {
      agents[provider] = { ...agent, enabled: false };
      continue;
    }
    const current = agent.defaultModelId ?? "";
    const bare = current.slice(current.indexOf("/") + 1);
    const isBareOffered = current.includes("/") && models.some((model) => model.id === bare);
    agents[provider] = { ...agent, enabled: true, defaultModelId: isBareOffered ? bare : first.id };
  }
  return { ...state, agents };
}

/**
 * 后台小任务模型、Subagent 模型与记忆模型已没有开着的接口提供时不再设，跟主模型（magpie 只写它在售的模型，
 * Codex 的 dropSubagent 同样拿掉找不到的模型）。没变时原样返回同一个对象。
 */
function withoutUnservedSideModels(input: {
  state: ApiEndpointState;
  provider: ApiEndpointProvider;
  agent: ApiEndpointAgentSettings;
}): ApiEndpointAgentSettings {
  const { state, agent } = input;
  let settled = agent;
  if (isUnserved(state, agent.backgroundModelId)) settled = { ...settled, backgroundModelId: null };
  if (isUnserved(state, agent.memoryModelId)) settled = { ...settled, memoryModelId: null };
  if (isUnserved(state, agent.subagentModelId)) settled = { ...settled, subagentModelId: null };
  // 照 magpie 的 subagentOwn：Claude Code 整个变量都不写，档位一起忘掉；Codex 的档位是单独的键，留给 settle 按主模型看。
  const isClaudeSubagentGone =
    input.provider === "claude" && settled.subagentModelId !== agent.subagentModelId;
  if (isClaudeSubagentGone) settled = { ...settled, subagentThinkingOptionId: null };
  return settled;
}

function isUnserved(state: ApiEndpointState, id: string | null | undefined): boolean {
  return typeof id === "string" && !isDefaultModelChoice(state, id);
}

/**
 * CLI 当前指向的接口：总开关开着时，默认模型指定的那家，否则持有默认模型、开着的接口里最早建的一家；官方为 null。
 * 老客户端的 activeEndpointId 就是它。
 */
export function agentTargetEndpoint(
  state: ApiEndpointState,
  provider: ApiEndpointProvider,
): StoredApiEndpoint | null {
  const agent = state.agents[provider];
  if (!agent.enabled) return null;
  const named = namedDefaultModel(state, agent.defaultModelId);
  if (named) return named.endpoint;
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
  // 指定了这家的默认模型，老客户端看到的是去掉接口标识的名字。
  const prefix = `${endpoint.slug}/`;
  const current = agent.defaultModelId?.startsWith(prefix)
    ? agent.defaultModelId.slice(prefix.length)
    : agent.defaultModelId;
  if (agent.enabled && has(current)) return current;
  if (has(endpoint.legacyDefaultModelId)) return endpoint.legacyDefaultModelId;
  return endpoint.models[0]?.id ?? "";
}

// 「会被 Anthropic 审查」照 magpie（https://github.com/yetone/magpie，internal/gateway/automode.go 的 AutoModeReviewed、
// internal/agent/claude.go 的 claudeReviewed）。Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
// 名字是 Claude 的模型：Anthropic 自己、前面的中转、Bedrock / Vertex 给它起的名字（anthropic.claude-…）。
const ANTHROPIC_MODEL = /(?:^|[/.:-])claude-/i;
const ANTHROPIC_API_HOST = "api.anthropic.com";

/**
 * 经中转站能到的模型里有没有会被 Anthropic 审查 Claude Code 自动模式动作的：开着的接口选了的模型和档位映射到的模型，
 * 名字是 Claude 的，或这家的 Anthropic 地址是 api.anthropic.com。都没有时 Claude Code 应写 CLAUDE_CODE_AUTO_MODE_SERVER=0。
 */
export function isAutoModeReviewed(state: ApiEndpointState): boolean {
  return state.endpoints.some((endpoint) => {
    if (!endpoint.enabled) return false;
    const models = [
      ...endpoint.models.map((model) => model.id),
      ...Object.values(endpoint.modelMapping ?? {}).filter((model) => typeof model === "string"),
    ];
    if (models.length === 0) return false;
    const isOnAnthropicApi = endpoint.baseUrls.some(
      (entry) => entry.format === "anthropic_messages" && hostOf(entry.url) === ANTHROPIC_API_HOST,
    );
    return isOnAnthropicApi || models.some((model) => ANTHROPIC_MODEL.test(model));
  });
}
