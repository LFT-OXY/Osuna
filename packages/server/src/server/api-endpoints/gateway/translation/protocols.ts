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
import {
  ResponsesDecoder,
  ResponsesEncoder,
  buildResponsesRequest,
  parseResponsesRequest,
  renderResponses,
} from "./responses.js";

/*
 * 每种协议的五件套：解析 Agent 的请求、构建给上游的请求、解码上游的流、把事件编码成 Agent 的流、
 * 渲染整份回复。中转站按格式取用。编码与渲染拿着 Agent 的请求：Codex 的命名空间工具要按它写回。
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
}

interface Protocol {
  parse(body: unknown): GatewayRequest;
  build(request: GatewayRequest, model: string): Record<string, unknown>;
  decoder(): StreamDecoder;
  encoder(output: {
    model: string;
    write: (text: string) => void;
    request: GatewayRequest;
  }): StreamEncoder;
  render(reply: Reply, output: { model: string; request: GatewayRequest }): Record<string, unknown>;
}

const PROTOCOLS: Record<ApiEndpointRequestFormat, Protocol> = {
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

export function protocolOf(format: ApiEndpointRequestFormat): Protocol {
  return PROTOCOLS[format];
}
