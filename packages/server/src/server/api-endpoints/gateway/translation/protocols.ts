// 上游与 Agent 两个方向分开、Gemini 只做上游照 magpie（https://github.com/yetone/magpie，internal/gateway/gemini.go 的 buildGemini 与 gateway.go 里 Gemini 解码共用 codeAssistDecoder 处）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  AnthropicDecoder,
  AnthropicEncoder,
  buildAnthropicRequest,
  parseAnthropicRequest,
  renderAnthropic,
} from "./anthropic.js";
import {
  ChatDecoder,
  ChatEncoder,
  buildChatRequest,
  parseChatRequest,
  renderChat,
} from "./chat.js";
import type { GeminiSignatureStore } from "../gemini-signatures.js";
import { GeminiDecoder, buildGeminiRequest } from "./gemini.js";
import type { EmitEvent, GatewayRequest, Reply, StreamEvent, Usage } from "./ir.js";
import {
  ResponsesDecoder,
  ResponsesEncoder,
  buildResponsesRequest,
  parseResponsesRequest,
  renderResponses,
} from "./responses.js";

/*
 * 每种协议的上游两件：构建给上游的请求、解码上游的流；Agent 说的协议另有三件：解析 Agent 的请求、
 * 把事件编码成 Agent 的流、渲染整份回复。中转站按格式取用。编码与渲染拿着 Agent 的请求：Codex 的命名空间工具要按它写回。
 * Gemini 只做上游：没有 Agent 说它（入口按路径认格式），它没有 Agent 那三件。
 */

export interface StreamDecoder {
  decode(data: string, emit: EmitEvent): void;
  // 上游没流式、给了整份回复：照它流出来时的事件读一遍。
  whole(body: unknown, emit: EmitEvent): void;
  // 流结束：交出还扣着的内容。
  end?(emit: EmitEvent): void;
}

export interface StreamEncoder {
  event(event: StreamEvent): void;
  finish(): void;
  usage(): Usage;
  // 写给 Agent 的回复编号（还没开头时为空）：中转站账本按它对上 CLI 会话记录里的同一次调用。
  replyId(): string;
}

interface UpstreamProtocol {
  build(request: GatewayRequest, model: string): Record<string, unknown>;
  // signatures：Gemini 的调用签名存放（藏进调用 id）；只为认出回复里有什么时不给。
  decoder(options?: { signatures?: GeminiSignatureStore }): StreamDecoder;
}

interface Protocol extends UpstreamProtocol {
  parse(body: unknown): GatewayRequest;
  encoder(output: {
    model: string;
    write: (text: string) => void;
    request: GatewayRequest;
  }): StreamEncoder;
  render(reply: Reply, output: { model: string; request: GatewayRequest }): Record<string, unknown>;
}

type AgentFormat = Exclude<ApiEndpointRequestFormat, "gemini">;

const PROTOCOLS: Record<AgentFormat, Protocol> = {
  anthropic_messages: {
    parse: parseAnthropicRequest,
    build: buildAnthropicRequest,
    decoder: () => new AnthropicDecoder(),
    encoder: (output) => new AnthropicEncoder(output),
    render: (reply, output) => renderAnthropic(reply, output.model),
  },
  openai_chat: {
    parse: parseChatRequest,
    build: buildChatRequest,
    decoder: () => new ChatDecoder(),
    encoder: (output) => new ChatEncoder(output),
    render: (reply, output) => renderChat(reply, output.model),
  },
  openai_responses: {
    parse: parseResponsesRequest,
    build: buildResponsesRequest,
    decoder: () => new ResponsesDecoder(),
    encoder: (output) => new ResponsesEncoder(output),
    render: renderResponses,
  },
};

const GEMINI: UpstreamProtocol = {
  build: buildGeminiRequest,
  decoder: (options) => new GeminiDecoder(options),
};

/** Agent 说的协议：Agent 不说 Gemini，按 Gemini 要是中转站自己的错。 */
export function protocolOf(format: ApiEndpointRequestFormat): Protocol {
  if (format === "gemini") throw new Error("No agent speaks Gemini: it is an upstream format only");
  return PROTOCOLS[format];
}

/** 发给上游的协议：四种格式都有。 */
export function upstreamProtocolOf(format: ApiEndpointRequestFormat): UpstreamProtocol {
  return format === "gemini" ? GEMINI : PROTOCOLS[format];
}
