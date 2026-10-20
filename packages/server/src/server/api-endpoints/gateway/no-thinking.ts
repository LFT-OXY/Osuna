// 移植自 magpie（https://github.com/yetone/magpie，internal/gateway/quiet.go 的 withoutAnyReasoning 与 withoutReasoningFields）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { isRecord } from "../upstream-http.js";
import type { GatewayRequest } from "./translation/ir.js";

/*
 * 模型设置里一档思考都不留的模型（magpie Reasonless）：中转站发给它的请求不带任何思考参数，连「关掉思考」也不带——
 * 有的厂商对不会思考的模型连 reasoning_effort 都回 422，去掉就好（magpie 的 yuexian7 案例）。
 * 直通时按 Agent 自己的格式去掉字段；翻译时在中间表示上不要思考，编出的请求就没有这些字段。
 */

const SEALED_REASONING = "reasoning.encrypted_content";

/**
 * 去掉一切关于思考的字段：Chat 与 Responses 的 reasoning_effort、reasoning、thinking、enable_thinking 与 include 里要的
 * 封存推理（OpenAI 对不推理的模型会拒）；Anthropic 的任何 thinking 与 output_config.effort（output_config 其余留着）。
 */
export function withoutAnyReasoning(
  format: ApiEndpointRequestFormat,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...body };
  if (format === "anthropic_messages") {
    delete out.thinking;
    if (isRecord(out.output_config) && "effort" in out.output_config) {
      const { effort: _effort, ...config } = out.output_config;
      if (Object.keys(config).length === 0) delete out.output_config;
      else out.output_config = config;
    }
    return out;
  }
  for (const key of ["reasoning_effort", "reasoning", "thinking", "enable_thinking"]) {
    delete out[key];
  }
  if (Array.isArray(out.include)) {
    out.include = out.include.filter((item) => item !== SEALED_REASONING);
  }
  return out;
}

/** 翻译前的中间表示：不要思考，也不关思考；不要封存推理。 */
export function withoutThinkingAsk(request: GatewayRequest): GatewayRequest {
  return {
    ...request,
    effort: "",
    thinking: false,
    thinkOff: false,
    include: request.include.filter((item) => item !== SEALED_REASONING),
  };
}
