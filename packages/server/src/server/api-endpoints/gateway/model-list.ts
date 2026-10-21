// 每条模型带的资料与单个模型的查法移植自 magpie（https://github.com/yetone/magpie，internal/gateway/gateway.go 的
// modelObject 与 model，internal/provider 的 Thinks、PublishedOutput、OutputWithin 与 Modalities）；Cursor 专用字段不加。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { endpointModelGroups, usableModels } from "../host-endpoints.js";
import {
  bareModelFacts,
  publishedOutput,
  type EndpointModelFacts,
  type ModelFactsLookup,
} from "../model-facts.js";
import type { ApiEndpointState } from "../store.js";

const SINGLE_MODEL_PREFIX = "/v1/models/";

/** OpenAI 与 Anthropic 两种模型写法合在一条里。 */
export interface GatewayModelObject {
  id: string;
  object: "model";
  type: "model";
  display_name: string;
  created: number;
  created_at: string;
  owned_by: string;
  reasoning: boolean;
  supported_reasoning_levels: Array<{ effort: string }>;
  context_window?: number;
  context_length?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  modalities?: { input: string[] };
}

/**
 * 中转站 GET /v1/models：OpenAI 与 Anthropic 两种列表写法合在一份里，开着的接口的已选模型按 id 去重。
 * 光秃秃的模型名先发给接口顺序里最靠前的那家，资料也按那家查。
 */
export function modelList(input: { state: ApiEndpointState; factsFor: ModelFactsLookup }) {
  const { state, factsFor } = input;
  const data = usableModels(state).map((model) =>
    modelObject({ id: model.id, facts: bareModelFacts({ state, modelId: model.id, factsFor }) }),
  );
  return {
    object: "list",
    data,
    has_more: false,
    first_id: data[0]?.id ?? null,
    last_id: data.at(-1)?.id ?? null,
  };
}

/** GET /v1/models/{id} 问的模型名（百分号编码解开）；不是这条路径为 null。 */
export function modelIdOf(path: string): string | null {
  if (!path.startsWith(SINGLE_MODEL_PREFIX)) return null;
  const raw = path.slice(SINGLE_MODEL_PREFIX.length);
  if (raw === "") return null;
  try {
    return decodeURIComponent(raw);
  } catch (error) {
    // 编码坏了的名字原样拿去找，找不到就是 404。
    if (error instanceof URIError) return raw;
    throw error;
  }
}

/**
 * 中转站 GET /v1/models/{id}（magpie 的 model）：先按 `接口标识/模型名` 找，资料按那家；
 * 再按光秃秃的名字找，和列表里的那条一样。找不到为 null。
 */
export function singleModel(input: {
  state: ApiEndpointState;
  id: string;
  factsFor: ModelFactsLookup;
}): GatewayModelObject | null {
  const { state, id, factsFor } = input;
  for (const group of endpointModelGroups(state)) {
    const hit = group.models.find((entry) => entry.id === id);
    if (hit) return modelObject({ id, facts: factsFor(group.endpoint, hit.model.id) });
  }
  const isListed = usableModels(state).some((model) => model.id === id);
  if (!isListed) return null;
  return modelObject({ id, facts: bareModelFacts({ state, modelId: id, factsFor }) });
}

function modelObject(input: { id: string; facts: EndpointModelFacts }): GatewayModelObject {
  const { id, facts } = input;
  const efforts = facts.efforts ?? [];
  const object: GatewayModelObject = {
    id,
    object: "model",
    type: "model",
    display_name: facts.name ?? id,
    created: 0,
    created_at: "1970-01-01T00:00:00Z",
    owned_by: "osuna",
    reasoning: efforts.length > 0,
    supported_reasoning_levels: efforts.map((effort) => ({ effort })),
  };
  const context = facts.context ?? 0;
  if (context > 0) {
    object.context_window = context;
    object.context_length = context;
    object.max_input_tokens = context;
  }
  // 回复上限收在窗口以内，和告诉 Agent 的一样。
  const output = publishedOutput(facts);
  if (output > 0) object.max_output_tokens = output;
  // 只知道看不看图：看图是文字加图片，不看是只有文字，不知道不给。
  if (facts.images !== undefined) {
    object.modalities = { input: facts.images ? ["text", "image"] : ["text"] };
  }
  return object;
}
