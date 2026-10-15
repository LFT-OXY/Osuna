// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/provider/provider.go 的 MessagesFirst、internal/gateway/gateway.go 的 usable）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import {
  API_ENDPOINT_MODEL_TIERS,
  type ApiEndpointModelTier,
  type ApiEndpointRequestFormat,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { ApiEndpointProvider, ApiEndpointState, StoredApiEndpoint } from "../store.js";

/*
 * 中转站按请求里的模型名挑出用户选的那家，按顺序试：
 * 1. `slug/模型名`：该家开着且选了这个模型就直达；
 * 2. 整个名字是某家已选的模型（模型名本身可能带斜杠，如 `moonshotai/kimi-k2`）；
 * 3. 标识那家已删除 / 已关闭 / 没选这个模型：视同不可用，斜杠后的光秃秃模型名换同名的家；
 * 4. Claude 档位名（含 opus / sonnet / haiku / fable）：第一家映射了该档位的接口，换成映射到的模型。
 * 都按创建顺序（数组顺序）找，只看开着的接口。
 * 用户选的那家排第一，后面跟着其他开着、选了同名模型的接口（创建顺序），供失败时自动切换；模型名不变。
 */

export interface GatewayCandidate {
  endpoint: StoredApiEndpoint;
  upstreamModel: string;
}

export type GatewayRoute =
  | { ok: true; candidates: GatewayCandidate[] }
  | { ok: false; message: string };

/** `claude-haiku-4-5-20251001`、`haiku` 这类名字里的档位；档位词须独立成段。 */
function claudeTierOf(model: string): ApiEndpointModelTier | null {
  const lower = model.toLowerCase();
  return (
    API_ENDPOINT_MODEL_TIERS.find((tier) =>
      new RegExp(`(?:^|[^a-z])${tier}(?:[^a-z]|$)`).test(lower),
    ) ?? null
  );
}

export function resolveGatewayRoute(input: {
  state: ApiEndpointState;
  agent: ApiEndpointProvider;
  model: string;
}): GatewayRoute {
  const chosen = chooseEndpoint(input);
  if (!chosen) {
    return { ok: false, message: `No enabled API endpoint offers the model "${input.model}"` };
  }
  const others = input.state.endpoints
    .filter(
      (endpoint) =>
        endpoint.enabled &&
        endpoint.id !== chosen.endpoint.id &&
        endpoint.models.some((entry) => entry.id === chosen.upstreamModel),
    )
    .map((endpoint) => ({ endpoint, upstreamModel: chosen.upstreamModel }));
  return { ok: true, candidates: [chosen, ...others] };
}

function chooseEndpoint(input: {
  state: ApiEndpointState;
  agent: ApiEndpointProvider;
  model: string;
}): GatewayCandidate | null {
  const { model } = input;
  const enabled = input.state.endpoints.filter((endpoint) => endpoint.enabled);
  const selects = (endpoint: StoredApiEndpoint, id: string) =>
    endpoint.models.some((entry) => entry.id === id);
  const firstSelecting = (id: string) => enabled.find((endpoint) => selects(endpoint, id));

  const slash = model.indexOf("/");
  const bare = slash === -1 ? null : model.slice(slash + 1);
  if (bare !== null) {
    const slug = model.slice(0, slash);
    const direct = enabled.find((endpoint) => endpoint.slug === slug && selects(endpoint, bare));
    if (direct) return { endpoint: direct, upstreamModel: bare };
  }
  for (const name of bare === null ? [model] : [model, bare]) {
    const endpoint = firstSelecting(name);
    if (endpoint) return { endpoint, upstreamModel: name };
  }
  const tier = input.agent === "claude" ? claudeTierOf(bare ?? model) : null;
  if (tier) {
    for (const endpoint of enabled) {
      const mapped = endpoint.modelMapping?.[tier];
      if (mapped) return { endpoint, upstreamModel: mapped };
    }
  }
  return null;
}

// 没有 Agent 自己格式的地址时，按这个顺序取第一个能用的格式翻译过去。
const TRANSLATION_ORDER: ApiEndpointRequestFormat[] = [
  "openai_chat",
  "openai_responses",
  "anthropic_messages",
];

/** 斜杠后的名字以 claude 开头（magpie 的 claudeModel）。 */
export function isClaudeModel(model: string): boolean {
  return model
    .slice(model.lastIndexOf("/") + 1)
    .toLowerCase()
    .startsWith("claude");
}

/**
 * 这次向这家接口用哪种格式请求（照 magpie 的 usable + MessagesFirst）：
 * Claude 模型且有 Anthropic 地址一律走 Anthropic，保住缓存标记与思考；
 * 否则有 Agent 自己格式的地址就直通；再否则按 Chat → Responses → Anthropic 取第一个翻译过去。
 */
export function chooseRequestFormat(input: {
  agentFormat: ApiEndpointRequestFormat;
  model: string;
  formats: readonly ApiEndpointRequestFormat[];
}): ApiEndpointRequestFormat | null {
  const { formats } = input;
  if (isClaudeModel(input.model) && formats.includes("anthropic_messages")) {
    return "anthropic_messages";
  }
  if (formats.includes(input.agentFormat)) return input.agentFormat;
  return TRANSLATION_ORDER.find((format) => formats.includes(format)) ?? null;
}
