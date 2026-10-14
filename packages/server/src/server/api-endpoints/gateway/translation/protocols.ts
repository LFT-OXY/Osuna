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
import type { EmitEvent, GatewayRequest, Reply, StreamEvent, Usage } from "./ir.js";

/*
 * 每种协议的五件套：解析 Agent 的请求、构建给上游的请求、解码上游的流、把事件编码成 Agent 的流、
 * 渲染整份回复。中转站按格式取用；OpenAI Responses 的五件套在工单 07。
 */

export interface StreamDecoder {
  decode(data: string, emit: EmitEvent): void;
  // 流结束：交出还扣着的内容。
  end?(emit: EmitEvent): void;
}

export interface StreamEncoder {
  event(event: StreamEvent): void;
  finish(): void;
  usage(): Usage;
}

interface Protocol {
  parse(body: unknown): GatewayRequest;
  build(request: GatewayRequest, model: string): Record<string, unknown>;
  decoder(): StreamDecoder;
  encoder(output: { model: string; write: (text: string) => void }): StreamEncoder;
  render(reply: Reply, model: string): Record<string, unknown>;
}

const PROTOCOLS: Partial<Record<ApiEndpointRequestFormat, Protocol>> = {
  anthropic_messages: {
    parse: parseAnthropicRequest,
    build: buildAnthropicRequest,
    decoder: () => new AnthropicDecoder(),
    encoder: (output) => new AnthropicEncoder(output),
    render: renderAnthropic,
  },
  openai_chat: {
    parse: parseChatRequest,
    build: buildChatRequest,
    decoder: () => new ChatDecoder(),
    encoder: (output) => new ChatEncoder(output),
    render: renderChat,
  },
};

/** 能从 Agent 的格式翻到上游的格式：两头都有五件套。 */
export function translatable(
  from: ApiEndpointRequestFormat,
  to: ApiEndpointRequestFormat,
): boolean {
  return PROTOCOLS[from] !== undefined && PROTOCOLS[to] !== undefined;
}

export function protocolOf(format: ApiEndpointRequestFormat): Protocol {
  const protocol = PROTOCOLS[format];
  if (!protocol) throw new Error(`No translation for the ${format} request format`);
  return protocol;
}
