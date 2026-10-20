// 每条模型带的资料移植自 magpie（https://github.com/yetone/magpie，internal/gateway/gateway.go 的 modelObject，
// internal/provider 的 Thinks、PublishedOutput、OutputWithin 与 Modalities）；Cursor 专用字段不加。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { usableModels } from "../host-endpoints.js";
import type { EndpointModelFacts } from "../model-facts.js";
import type { ApiEndpointState, StoredApiEndpoint } from "../store.js";

/** 一家接口的一个模型用起来的资料（已按模型设置改过）。 */
export type ModelFactsOf = (endpoint: StoredApiEndpoint, modelId: string) => EndpointModelFacts;

/**
 * 中转站 GET /v1/models：OpenAI 与 Anthropic 两种列表写法合在一份里，开着的接口的已选模型按 id 去重。
 * 光秃秃的模型名先发给接口顺序里最靠前的那家，资料也按那家查。
 */
export function modelList(input: { state: ApiEndpointState; factsOf: ModelFactsOf }) {
  const { state } = input;
  const data = usableModels(state).map((model) => {
    const endpoint = state.endpoints.find(
      (entry) => entry.enabled && entry.models.some((own) => own.id === model.id),
    );
    const facts = endpoint ? input.factsOf(endpoint, model.id) : {};
    return modelObject({ id: model.id, facts });
  });
  return {
    object: "list",
    data,
    has_more: false,
    first_id: data[0]?.id ?? null,
    last_id: data.at(-1)?.id ?? null,
  };
}

function modelObject(input: { id: string; facts: EndpointModelFacts }): Record<string, unknown> & {
  id: string;
} {
  const { id, facts } = input;
  const efforts = facts.efforts ?? [];
  const object: Record<string, unknown> & { id: string } = {
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
  const output = context > 0 && (facts.output ?? 0) > context ? context : (facts.output ?? 0);
  if (output > 0) object.max_output_tokens = output;
  // 只知道看不看图：看图是文字加图片，不看是只有文字，不知道不给。
  if (facts.images !== undefined) {
    object.modalities = { input: facts.images ? ["text", "image"] : ["text"] };
  }
  return object;
}
