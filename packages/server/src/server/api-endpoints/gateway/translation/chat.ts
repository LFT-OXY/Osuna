// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gateway/chat.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { isRecord, parseJson } from "../../upstream-http.js";
import {
  INTERRUPTED_TOOL,
  ReplyCollector,
  RequestShapeError,
  TOOL_RESULT_RECEIVED,
  argsOf,
  effortOf,
  joinSplitCalls,
  newId,
  parseArgs,
  promptTokens,
  stringOrText,
  textOf,
  type EmitEvent,
  type GatewayRequest,
  type Message,
  type Part,
  type Reply,
  type StopReason,
  type StreamEvent,
  type Tool,
  type ToolChoice,
  type Usage,
} from "./ir.js";
import { sseEvent } from "./sse.js";

/*
 * OpenAI Chat Completions 协议：解析请求、构建请求、解码流、编码流、渲染整份回复。
 * 回复里的模型名一律写 Agent 请求时的名字。
 */

type ChatMessage = Record<string, unknown>;

export function parseChatRequest(body: unknown): GatewayRequest {
  if (!isRecord(body) || !Array.isArray(body.messages)) {
    throw new RequestShapeError("invalid request: messages must be an array");
  }
  const system: string[] = [];
  const messages: Message[] = [];
  for (const message of body.messages) {
    if (!isRecord(message)) continue;
    if (message.role === "system" || message.role === "developer") {
      system.push(stringOrText(message.content));
    } else {
      const parsed = parseChatMessage(message);
      if (parsed) messages.push(parsed);
    }
  }
  const effort = effortOf(body.reasoning_effort);
  const maxTokens = [body.max_completion_tokens, body.max_tokens].find(
    (value): value is number => typeof value === "number" && value > 0,
  );
  return {
    model: typeof body.model === "string" ? body.model : "",
    system: system.join("\n\n"),
    messages,
    tools: parseChatTools(body.tools),
    toolChoice: parseChatToolChoice(body.tool_choice),
    maxTokens: maxTokens ?? 0,
    temperature: typeof body.temperature === "number" ? body.temperature : null,
    topP: typeof body.top_p === "number" ? body.top_p : null,
    stop: parseStop(body.stop),
    stream: body.stream === true,
    effort,
    thinking: effort !== "",
    thinkOff:
      typeof body.reasoning_effort === "string" &&
      body.reasoning_effort.trim().toLowerCase() === "none",
    parallel: typeof body.parallel_tool_calls === "boolean" ? body.parallel_tool_calls : null,
    metadata: null,
  };
}

function parseChatMessage(message: Record<string, unknown>): Message | null {
  switch (message.role) {
    case "user":
      return { role: "user", parts: chatParts(message.content) };
    case "assistant": {
      const reasoning = [message.reasoning_content, message.reasoning].find(
        (value): value is string => typeof value === "string" && value !== "",
      );
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      return {
        role: "assistant",
        parts: [
          ...(reasoning ? [{ kind: "thinking" as const, text: reasoning, signature: "" }] : []),
          ...chatParts(message.content),
          ...calls.filter(isRecord).map(chatToolCall),
        ],
      };
    }
    case "tool":
      return {
        role: "user",
        parts: [
          {
            kind: "tool_result",
            callId: typeof message.tool_call_id === "string" ? message.tool_call_id : "",
            text: stringOrText(message.content),
            isError: false,
          },
        ],
      };
    default:
      return null;
  }
}

function chatToolCall(call: Record<string, unknown>): Part {
  const fn = isRecord(call.function) ? call.function : {};
  return {
    kind: "tool_call",
    id: typeof call.id === "string" ? call.id : "",
    name: typeof fn.name === "string" ? fn.name : "",
    args: parseArgs(typeof fn.arguments === "string" ? fn.arguments : ""),
  };
}

/** 字符串，或分段数组里的文字段。 */
function chatParts(content: unknown): Part[] {
  if (typeof content === "string") return content === "" ? [] : [{ kind: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((item): Part[] =>
    isRecord(item) && item.type === "text" && typeof item.text === "string"
      ? [{ kind: "text", text: item.text }]
      : [],
  );
}

function parseChatTools(tools: unknown): Tool[] {
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool): Tool[] => {
    if (!isRecord(tool) || (tool.type !== undefined && tool.type !== "function")) return [];
    const fn = isRecord(tool.function) ? tool.function : {};
    return [
      {
        name: String(fn.name ?? ""),
        description: typeof fn.description === "string" ? fn.description : "",
        schema: fn.parameters ?? null,
      },
    ];
  });
}

function parseChatToolChoice(choice: unknown): ToolChoice {
  if (choice === "auto" || choice === "none" || choice === "required") return choice;
  if (isRecord(choice) && isRecord(choice.function) && typeof choice.function.name === "string") {
    return `name:${choice.function.name}`;
  }
  return "";
}

function parseStop(stop: unknown): string[] {
  if (typeof stop === "string") return stop === "" ? [] : [stop];
  return Array.isArray(stop) ? stop.filter((item): item is string => typeof item === "string") : [];
}

export function buildChatRequest(request: GatewayRequest, model: string): Record<string, unknown> {
  const messages: ChatMessage[] = [];
  if (request.system !== "") messages.push({ role: "system", content: request.system });
  for (const message of joinSplitCalls(request.messages)) {
    if (message.role === "assistant") messages.push(chatAssistant(message));
    else messages.push(...chatUser(message));
  }
  const out: Record<string, unknown> = {
    model,
    messages: pairToolMessages(messages),
    stream: request.stream,
  };
  if (request.stream) out.stream_options = { include_usage: true };
  if (request.maxTokens > 0) out.max_tokens = request.maxTokens;
  if (request.temperature !== null) out.temperature = request.temperature;
  if (request.topP !== null) out.top_p = request.topP;
  if (request.stop.length > 0) out.stop = request.stop;
  const effort = chatEffort(request);
  if (effort) out.reasoning_effort = effort;
  if (request.tools.length > 0) Object.assign(out, chatTools(request));
  return out;
}

/** 不知道上游模型认哪几档：xhigh / max 降到 OpenAI 通用的 high。 */
function chatEffort(request: GatewayRequest): string | null {
  if (request.effort === "") return null;
  return request.effort === "xhigh" || request.effort === "max" ? "high" : request.effort;
}

function chatAssistant(message: Message): ChatMessage {
  const calls = message.parts.flatMap((part) =>
    part.kind === "tool_call"
      ? [
          {
            id: part.id === "" ? `call_${newId()}` : part.id,
            type: "function",
            function: { name: part.name, arguments: argsOf(part) },
          },
        ]
      : [],
  );
  const text = textOf(message.parts);
  const out: ChatMessage = { role: "assistant" };
  if (text !== "" || calls.length === 0) out.content = text;
  if (calls.length > 0) out.tool_calls = calls;
  return out;
}

/** 一轮的工具结果排在它自己的文字前面：tool 消息必须紧跟发起调用的 assistant 消息（Kimi 否则 400）。 */
function chatUser(message: Message): ChatMessage[] {
  const tools: ChatMessage[] = [];
  let text = "";
  let hasText = false;
  for (const part of message.parts) {
    if (part.kind === "tool_result") {
      tools.push({ role: "tool", tool_call_id: part.callId, content: part.text });
    } else if (part.kind === "text") {
      text += part.text;
      hasText = true;
    }
  }
  return hasText ? [...tools, { role: "user", content: text }] : tools;
}

function chatTools(request: GatewayRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {
    tools: request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        ...(tool.schema === null ? {} : { parameters: tool.schema }),
      },
    })),
  };
  const { toolChoice } = request;
  if (toolChoice === "auto" || toolChoice === "none" || toolChoice === "required") {
    out.tool_choice = toolChoice;
  } else if (toolChoice.startsWith("name:")) {
    out.tool_choice = { type: "function", function: { name: toolChoice.slice(5) } };
  }
  if (request.parallel !== null) out.parallel_tool_calls = request.parallel;
  return out;
}

/**
 * 修补 Chat 请求的工具往来，给严格校验的上游（Kimi 回 400「tool_call_id is not found」）：
 * 结果按调用的顺序排；同一调用的第二个结果丢掉；不回答当前调用的结果改成 user 消息（紧挨的 user 消息就并进去）；
 * 没有结果的调用补一个「轮次被中断」的结果；夹在调用和结果之间、什么都没有的 assistant 消息（只有思考的一轮）丢掉。
 */
function pairToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let order = new Map<string, number>();
  let answered = new Set<string>();
  let held: ChatMessage[] = [];

  const flushPending = () => {
    held.sort((a, b) => (order.get(toolCallId(a)) ?? 0) - (order.get(toolCallId(b)) ?? 0));
    out.push(...held);
    for (const id of order.keys()) {
      if (!answered.has(id))
        out.push({ role: "tool", tool_call_id: id, content: INTERRUPTED_TOOL });
    }
    held = [];
    order = new Map();
    answered = new Set();
  };
  const toolAsUser = (message: ChatMessage) => {
    const content = typeof message.content === "string" ? message.content : "";
    const text = content.trim() === "" ? TOOL_RESULT_RECEIVED : content;
    const previous = out.at(-1);
    if (previous?.role === "user" && typeof previous.content === "string") {
      previous.content = `${previous.content}\n\n${text}`;
    } else {
      out.push({ role: "user", content: text });
    }
  };

  for (const message of messages) {
    if (message.role === "tool") {
      const id = toolCallId(message);
      if (!order.has(id)) {
        flushPending();
        toolAsUser(message);
      } else if (!answered.has(id)) {
        answered.add(id);
        held.push(message);
      }
      continue;
    }
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (
      message.role === "assistant" &&
      calls.length === 0 &&
      order.size > 0 &&
      emptyAssistant(message)
    ) {
      continue;
    }
    flushPending();
    out.push(message);
    calls.forEach((call, index) => {
      order.set(isRecord(call) && typeof call.id === "string" ? call.id : "", index);
    });
  }
  flushPending();
  return out;
}

function toolCallId(message: ChatMessage): string {
  return typeof message.tool_call_id === "string" ? message.tool_call_id : "";
}

function emptyAssistant(message: ChatMessage): boolean {
  const reasoning = typeof message.reasoning_content === "string" ? message.reasoning_content : "";
  const content = typeof message.content === "string" ? message.content : "";
  return reasoning.trim() === "" && content.trim() === "";
}

/**
 * Chat 的用量：缓存命中依次取 prompt_tokens_details.cached_tokens、DeepSeek 的 prompt_cache_hit_tokens、
 * Moonshot 的 cached_tokens；都没有时取 Claude 中转站的 Anthropic 名字，并按 prompt_tokens 够不够判断它是否含缓存。
 */
export function usageFromChat(value: unknown): Usage {
  const usage = isRecord(value) ? value : {};
  const count = (field: unknown) => (typeof field === "number" ? field : 0);
  const prompt = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const completion = isRecord(usage.completion_tokens_details)
    ? usage.completion_tokens_details
    : {};
  const promptCount = count(usage.prompt_tokens);
  let cacheRead =
    count(prompt.cached_tokens) ||
    count(usage.prompt_cache_hit_tokens) ||
    count(usage.cached_tokens);
  let cacheWrite = count(prompt.cache_write_tokens);
  let whole = true;
  if (cacheRead === 0 && cacheWrite === 0) {
    cacheRead = count(usage.cache_read_input_tokens);
    cacheWrite = count(usage.cache_creation_input_tokens);
    whole = promptCount >= cacheRead + cacheWrite;
  }
  return {
    input: whole ? Math.max(promptCount - cacheRead - cacheWrite, 0) : promptCount,
    output: count(usage.completion_tokens),
    cacheRead,
    cacheWrite,
    cacheWrite1h: 0,
    reasoning: count(completion.reasoning_tokens),
  };
}

export function usageToChat(usage: Usage): Record<string, unknown> {
  const prompt = promptTokens(usage);
  return {
    prompt_tokens: prompt,
    completion_tokens: usage.output,
    total_tokens: prompt + usage.output,
    prompt_tokens_details: { cached_tokens: usage.cacheRead, cache_write_tokens: usage.cacheWrite },
    completion_tokens_details: { reasoning_tokens: usage.reasoning },
  };
}

function stopFromChat(reason: string): StopReason {
  if (reason === "length") return "length";
  if (reason === "tool_calls" || reason === "function_call") return "tool";
  return reason === "content_filter" ? "filter" : "stop";
}

function stopToChat(stop: StopReason): string {
  const reasons: Record<StopReason, string> = {
    length: "length",
    tool: "tool_calls",
    filter: "content_filter",
    stop: "stop",
  };
  return reasons[stop];
}

/**
 * Chat 流 → 中间事件。工具调用按 index 分片拼接，同一 id 重复出现（有的中转站每片都带）仍是同一个调用；
 * 只认第一个读得出 index 的 choice，读不出 index 的片不选也不拒。
 */
export class ChatDecoder {
  private started = false;
  private tool = -1;
  private toolId = "";
  private choice: number | null = null;

  decode(data: string, emit: EmitEvent): void {
    if (data.trim() === "[DONE]") return;
    const chunk = parseJson(data);
    if (!isRecord(chunk)) return;
    if (chunk.error !== undefined && chunk.error !== null) {
      emit({ kind: "error", message: chatErrorMessage(chunk.error), code: null });
      return;
    }
    if (!this.started) this.start(chunk, emit);
    const choices = Array.isArray(chunk.choices) ? chunk.choices.filter(isRecord) : [];
    for (const choice of choices) {
      if (this.ownChoice(choice.index)) this.decodeChoice(choice, emit);
    }
    const usage = isRecord(chunk.usage) ? chunk.usage : null;
    if (usage && (Number(usage.prompt_tokens) > 0 || Number(usage.completion_tokens) > 0)) {
      emit({ kind: "usage", usage: usageFromChat(usage) });
    }
  }

  /** 有的流在第一片就报 prompt 用量，像 Anthropic 的 message_start 那样在开头告诉 Agent。 */
  private start(chunk: Record<string, unknown>, emit: EmitEvent): void {
    this.started = true;
    const usage = usageFromChat(chunk.usage);
    emit({
      kind: "start",
      id: typeof chunk.id === "string" ? chunk.id : "",
      usage: { ...usage, output: 0, reasoning: 0 },
    });
  }

  private ownChoice(raw: unknown): boolean {
    const index = choiceIndex(raw);
    if (index === null) return true;
    this.choice ??= index;
    return index === this.choice;
  }

  private decodeChoice(choice: Record<string, unknown>, emit: EmitEvent): void {
    const delta = isRecord(choice.delta) ? choice.delta : {};
    // 有的中转站把同一段推理在两个名字下各发一遍，取一个。
    const think = [delta.reasoning_content, delta.reasoning].find(
      (value): value is string => typeof value === "string" && value !== "",
    );
    if (think) emit({ kind: "think", text: think });
    if (typeof delta.content === "string" && delta.content !== "") {
      emit({ kind: "text", text: delta.content });
    }
    const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls.filter(isRecord) : [];
    calls.forEach((call, position) => this.toolCall(call, position, emit));
    if (typeof choice.finish_reason === "string" && choice.finish_reason !== "") {
      emit({ kind: "stop", stop: stopFromChat(choice.finish_reason) });
    }
  }

  /** 新 index 或新 id 开始下一个调用；同一 index 的片、或重复已开调用的 id，接在它后面。 */
  private toolCall(call: Record<string, unknown>, position: number, emit: EmitEvent): void {
    const index = typeof call.index === "number" ? call.index : position;
    const id = typeof call.id === "string" ? call.id : "";
    const fn = isRecord(call.function) ? call.function : {};
    if (index !== this.tool || (id !== "" && id !== this.toolId)) {
      this.tool = index;
      this.toolId = id;
      emit({ kind: "tool_start", id, name: typeof fn.name === "string" ? fn.name : "" });
    }
    if (typeof fn.arguments === "string" && fn.arguments !== "") {
      emit({ kind: "tool_args", text: fn.arguments });
    }
  }
}

/** 数字或数字字符串的 index；没有、null、读不懂的不算。1.0 与 1 是同一个。 */
function choiceIndex(raw: unknown): number | null {
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function chatErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return "the upstream reported an error";
}

/** 中间事件 → Chat 流。 */
export class ChatEncoder {
  private readonly collector = new ReplyCollector();
  private readonly created = Math.floor(Date.now() / 1000);
  private id = "";
  private started = false;
  private tool = -1;

  constructor(private readonly input: { model: string; write: (text: string) => void }) {}

  event(event: StreamEvent): void {
    if (event.kind === "start") this.start(event.id);
    else this.start("");
    switch (event.kind) {
      case "text":
        if (event.text !== "") this.chunk({ delta: { content: event.text } });
        break;
      case "think":
        if (event.text !== "") this.chunk({ delta: { reasoning_content: event.text } });
        break;
      case "tool_start":
        this.tool++;
        this.chunk({
          delta: {
            tool_calls: [
              {
                index: this.tool,
                id: event.id === "" ? `call_${newId()}` : event.id,
                type: "function",
                function: { name: event.name, arguments: "" },
              },
            ],
          },
        });
        break;
      case "tool_args":
        if (this.tool >= 0 && event.text !== "") {
          this.chunk({
            delta: { tool_calls: [{ index: this.tool, function: { arguments: event.text } }] },
          });
        }
        break;
      case "error":
        this.input.write(
          sseEvent(null, {
            error: {
              message: event.message,
              type: "api_error",
              ...(event.code ? { code: event.code } : {}),
            },
          }),
        );
        break;
      default:
    }
    this.collector.add(event);
  }

  finish(): void {
    this.start("");
    const reply = this.collector.finish();
    this.chunk({ finish: stopToChat(reply.stop) });
    this.chunk({ usage: usageToChat(reply.usage) });
    this.input.write(sseEvent(null, "[DONE]"));
  }

  usage(): Usage {
    return this.collector.usage();
  }

  private start(id: string): void {
    if (this.started) return;
    this.started = true;
    this.id = chatCompletionId(id);
    this.chunk({ delta: { role: "assistant", content: "" } });
  }

  private chunk(input: {
    delta?: Record<string, unknown>;
    finish?: string;
    usage?: unknown;
  }): void {
    const choices =
      input.delta || input.finish
        ? [{ index: 0, delta: input.delta ?? {}, finish_reason: input.finish ?? null }]
        : [];
    this.input.write(
      sseEvent(null, {
        id: this.id,
        object: "chat.completion.chunk",
        created: this.created,
        model: this.input.model,
        choices,
        usage: input.usage ?? null,
      }),
    );
  }
}

function chatCompletionId(id: string): string {
  const base = id === "" ? newId() : id;
  return base.startsWith("chatcmpl-") ? base : `chatcmpl-${base}`;
}

export function renderChat(reply: Reply, model: string): Record<string, unknown> {
  const message: Record<string, unknown> = { role: "assistant", content: null };
  const texts = reply.parts.filter((part) => part.kind === "text");
  if (texts.length > 0) message.content = textOf(texts);
  const calls = reply.parts.flatMap((part) =>
    part.kind === "tool_call"
      ? [
          {
            id: part.id === "" ? `call_${newId()}` : part.id,
            type: "function",
            function: { name: part.name, arguments: argsOf(part) },
          },
        ]
      : [],
  );
  if (calls.length > 0) message.tool_calls = calls;
  const think = reply.parts.map((part) => (part.kind === "thinking" ? part.text : "")).join("");
  if (think !== "") message.reasoning_content = think;
  return {
    id: chatCompletionId(reply.id),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: stopToChat(reply.stop) }],
    usage: usageToChat(reply.usage),
  };
}
