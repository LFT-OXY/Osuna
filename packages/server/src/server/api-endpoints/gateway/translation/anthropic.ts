// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gateway/anthropic.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { isRecord, parseJson } from "../../upstream-http.js";
import {
  INTERRUPTED_TOOL,
  ReplyCollector,
  RequestShapeError,
  TOOL_RESULT_RECEIVED,
  argsOf,
  effortOf,
  effortOfBudget,
  newId,
  stringOrText,
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
 * Anthropic Messages 协议：解析请求、构建请求、解码流、编码流、渲染整份回复。
 * 回复里的模型名一律写 Agent 请求时的名字，不写上游说的。
 */

const DEFAULT_MAX_TOKENS = 16_384;

export function parseAnthropicRequest(body: unknown): GatewayRequest {
  if (!isRecord(body) || !Array.isArray(body.messages)) {
    throw new RequestShapeError("invalid request: messages must be an array");
  }
  return {
    model: typeof body.model === "string" ? body.model : "",
    system: stringOrText(body.system),
    messages: body.messages.map(parseMessage),
    tools: parseTools(body.tools),
    toolChoice: parseToolChoice(body.tool_choice),
    maxTokens: typeof body.max_tokens === "number" ? body.max_tokens : 0,
    temperature: typeof body.temperature === "number" ? body.temperature : null,
    topP: typeof body.top_p === "number" ? body.top_p : null,
    stop: Array.isArray(body.stop_sequences)
      ? body.stop_sequences.filter((item): item is string => typeof item === "string")
      : [],
    stream: body.stream === true,
    parallel:
      isRecord(body.tool_choice) && body.tool_choice.disable_parallel_tool_use === true
        ? false
        : null,
    metadata: body.metadata ?? null,
    ...parseThinking(body),
  };
}

function parseMessage(message: unknown): Message {
  if (!isRecord(message)) throw new RequestShapeError("invalid message");
  const role = message.role === "assistant" ? "assistant" : "user";
  const { content } = message;
  if (typeof content === "string") {
    return { role, parts: content === "" ? [] : [{ kind: "text", text: content }] };
  }
  if (!Array.isArray(content)) throw new RequestShapeError("invalid message content");
  return { role, parts: content.flatMap(parseBlock) };
}

function parseBlock(block: unknown): Part[] {
  if (!isRecord(block)) return [];
  switch (block.type) {
    case "text":
      return [{ kind: "text", text: typeof block.text === "string" ? block.text : "" }];
    case "tool_use":
      return [
        {
          kind: "tool_call",
          id: anthropicInId(String(block.id ?? "")),
          name: String(block.name ?? ""),
          args: JSON.stringify(block.input ?? {}),
        },
      ];
    case "tool_result":
      return [
        {
          kind: "tool_result",
          callId: anthropicInId(String(block.tool_use_id ?? "")),
          text: stringOrText(block.content),
          isError: block.is_error === true,
        },
      ];
    case "thinking":
      return [
        {
          kind: "thinking",
          text: typeof block.thinking === "string" ? block.thinking : "",
          signature: typeof block.signature === "string" ? block.signature : "",
        },
      ];
    default:
      return [];
  }
}

/** 服务端工具（联网搜索等）没有 input_schema，别处无意义；DeferredToolPlaceholder 只为保持延后加载，永不被调用。 */
function parseTools(tools: unknown): Tool[] {
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool): Tool[] => {
    if (!isRecord(tool)) return [];
    const serverTool =
      typeof tool.type === "string" && tool.type !== "custom" && tool.input_schema === undefined;
    if (serverTool || tool.name === "DeferredToolPlaceholder") return [];
    return [
      {
        name: String(tool.name ?? ""),
        description: typeof tool.description === "string" ? tool.description : "",
        schema: tool.input_schema ?? null,
      },
    ];
  });
}

function parseToolChoice(choice: unknown): ToolChoice {
  if (!isRecord(choice)) return "";
  switch (choice.type) {
    case "auto":
    case "none":
      return choice.type;
    case "any":
      return "required";
    case "tool":
      return `name:${String(choice.name ?? "")}`;
    default:
      return "";
  }
}

/** output_config 的力度只在要求思考时才算：Claude Code 起标题的请求带力度不带思考。 */
function parseThinking(
  body: Record<string, unknown>,
): Pick<GatewayRequest, "effort" | "thinking" | "thinkOff"> {
  const thinking = isRecord(body.thinking) ? body.thinking : null;
  if (thinking?.type === "disabled" || thinking?.type === "between_tools") {
    return { effort: "", thinking: false, thinkOff: true };
  }
  if (thinking?.type !== "enabled" && thinking?.type !== "adaptive") {
    return { effort: "", thinking: false, thinkOff: false };
  }
  const budget = typeof thinking.budget_tokens === "number" ? thinking.budget_tokens : 0;
  const configured = isRecord(body.output_config) ? effortOf(body.output_config.effort) : "";
  return { effort: configured || effortOfBudget(budget), thinking: true, thinkOff: false };
}

interface AnthropicBlock {
  type: string;
  [field: string]: unknown;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicBlock[];
}

/** 给 Anthropic 上游的请求体。思考与缓存标记的翻译在工单 06。 */
export function buildAnthropicRequest(
  request: GatewayRequest,
  model: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    model,
    messages: pairToolBlocks(anthropicMessages(request.messages)),
    stream: request.stream,
  };
  if (request.system !== "") out.system = request.system;
  out.max_tokens = request.maxTokens > 0 ? request.maxTokens : DEFAULT_MAX_TOKENS;
  if (request.temperature !== null) out.temperature = request.temperature;
  else if (request.topP !== null) out.top_p = request.topP;
  if (request.stop.length > 0) out.stop_sequences = request.stop;
  if (request.metadata !== null) out.metadata = request.metadata;
  if (request.tools.length > 0) {
    out.tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.schema ?? { type: "object", properties: {} },
    }));
    const choice = anthropicToolChoice(request);
    if (choice) out.tool_choice = choice;
  }
  return out;
}

function anthropicMessages(messages: Message[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    const results: AnthropicBlock[] = [];
    const rest: AnthropicBlock[] = [];
    for (const part of message.parts) {
      const block = anthropicBlock(part);
      if (block?.type === "tool_result") results.push(block);
      else if (block) rest.push(block);
    }
    const blocks = [...results, ...rest];
    const previous = out.at(-1);
    if (blocks.length === 0) continue;
    if (previous?.role === message.role) previous.content.push(...blocks);
    else out.push({ role: message.role, content: blocks });
  }
  return out;
}

function anthropicBlock(part: Part): AnthropicBlock | null {
  switch (part.kind) {
    case "text":
      return part.text.trim() === "" ? null : { type: "text", text: part.text };
    case "tool_call":
      // Anthropic 的 tool_use id 只收 [A-Za-z0-9_-]：别家的 id 编码后发出，结果用同样的编码。
      return {
        type: "tool_use",
        id: anthropicOutId(part.id),
        name: part.name,
        input: parseJson(argsOf(part)) ?? {},
      };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: anthropicOutId(part.callId),
        content: part.text,
        ...(part.isError ? { is_error: true } : {}),
      };
    case "thinking":
      // 只有带签名的才回给 Anthropic；无签名的文字是别家的推理。
      return part.signature === ""
        ? null
        : { type: "thinking", thinking: part.text, signature: part.signature };
  }
}

function anthropicToolChoice(request: GatewayRequest): Record<string, unknown> | null {
  const noParallel = request.parallel === false;
  const { toolChoice } = request;
  let choice: Record<string, unknown> | null = null;
  if (toolChoice === "required") choice = { type: "any" };
  else if (toolChoice === "none") choice = { type: "none" };
  else if (toolChoice.startsWith("name:")) choice = { type: "tool", name: toolChoice.slice(5) };
  else if (noParallel) choice = { type: "auto" };
  if (choice && noParallel && choice.type !== "none") choice.disable_parallel_tool_use = true;
  return choice;
}

/**
 * 修补发给 Anthropic 的工具往来（它拒收两种形状）：没有结果的调用在随后的 user 消息里补一个
 * 「轮次被中断」的错误结果，没有对应调用的结果改成文字块，同一调用的第二个结果丢掉。形状正确的原样不动。
 */
function pairToolBlocks(messages: AnthropicMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  let pending: string[] = [];
  let answered = new Set<string>();
  const synthetic = (id: string): AnthropicBlock => ({
    type: "tool_result",
    tool_use_id: id,
    content: INTERRUPTED_TOOL,
    is_error: true,
  });
  const unanswered = () => pending.filter((id) => !answered.has(id)).map(synthetic);
  const reset = () => {
    pending = [];
    answered = new Set();
  };
  for (const message of messages) {
    if (message.role === "assistant") {
      const owed = unanswered();
      if (owed.length > 0) out.push({ role: "user", content: owed });
      reset();
      pending = message.content.flatMap((block) =>
        block.type === "tool_use" ? [String(block.id)] : [],
      );
      out.push(message);
      continue;
    }
    const kept: AnthropicBlock[] = [];
    const rest: AnthropicBlock[] = [];
    for (const block of message.content) {
      const id = String(block.tool_use_id);
      if (block.type !== "tool_result") rest.push(block);
      else if (!pending.includes(id)) rest.push(resultSaid(block));
      else if (!answered.has(id)) {
        answered.add(id);
        kept.push(block);
      }
    }
    out.push({ role: "user", content: [...kept, ...unanswered(), ...rest] });
    reset();
  }
  const owed = unanswered();
  if (owed.length > 0) out.push({ role: "user", content: owed });
  return out;
}

/** 没有对应调用的结果留下它说的话。 */
function resultSaid(block: AnthropicBlock): AnthropicBlock {
  const text = typeof block.content === "string" ? block.content : "";
  return { type: "text", text: text.trim() === "" ? TOOL_RESULT_RECEIVED : text };
}

/*
 * Claude Code 只认 [A-Za-z0-9_-] 的 tool_use id，别家的 id（Devin 的 "Bash:0#…"）编码成
 * mp_ + base64url 发给它，回来时解开，上游下一轮拿到的还是自己的 id。本来安全的 id 两头都不动。
 */
const ID_MARK = "mp_";
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function anthropicOutId(id: string): string {
  if (id === "" || (SAFE_ID.test(id) && !id.startsWith(ID_MARK))) return id;
  return ID_MARK + Buffer.from(id, "utf8").toString("base64url");
}

export function anthropicInId(id: string): string {
  if (!id.startsWith(ID_MARK) || !SAFE_ID.test(id)) return id;
  const raw = Buffer.from(id.slice(ID_MARK.length), "base64url").toString("utf8");
  return raw !== "" && anthropicOutId(raw) === id ? raw : id;
}

export function usageFromAnthropic(value: unknown): Usage {
  const usage = isRecord(value) ? value : {};
  const count = (field: unknown) => (typeof field === "number" ? field : 0);
  const creation = isRecord(usage.cache_creation) ? usage.cache_creation : null;
  const write5m = count(creation?.ephemeral_5m_input_tokens);
  const write1h = count(creation?.ephemeral_1h_input_tokens);
  return {
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: Math.max(count(usage.cache_creation_input_tokens), write5m + write1h),
    cacheWrite1h: write1h,
    reasoning: 0,
  };
}

export function usageToAnthropic(usage: Usage): Record<string, unknown> {
  const out: Record<string, unknown> = {
    input_tokens: usage.input,
    output_tokens: usage.output,
    cache_read_input_tokens: usage.cacheRead,
    cache_creation_input_tokens: usage.cacheWrite,
  };
  const hour = Math.min(usage.cacheWrite1h, usage.cacheWrite);
  if (hour > 0) {
    out.cache_creation = {
      ephemeral_5m_input_tokens: usage.cacheWrite - hour,
      ephemeral_1h_input_tokens: hour,
    };
  }
  return out;
}

function stopFromAnthropic(reason: string): StopReason {
  switch (reason) {
    // 后者是 Claude 4.5+ 先撞上上下文窗口：同样是被截断。
    case "max_tokens":
    case "model_context_window_exceeded":
    case "length":
      return "length";
    // Anthropic 形状的中转站照搬 OpenAI 的原因。
    case "tool_use":
    case "tool_calls":
    case "function_call":
      return "tool";
    case "refusal":
    case "content_filter":
      return "filter";
    default:
      return "stop";
  }
}

function stopToAnthropic(stop: StopReason): string {
  const reasons: Record<StopReason, string> = {
    length: "max_tokens",
    tool: "tool_use",
    filter: "refusal",
    stop: "end_turn",
  };
  return reasons[stop];
}

/**
 * Anthropic 事件流 → 中间事件。跳过 Anthropic 服务端工具（联网搜索）的块；
 * tool_use 的 start 已带完整 input 时（中转站常见）就用它，不再等 input_json_delta。
 */
export class AnthropicDecoder {
  private readonly serverBlocks = new Set<number>();
  private readonly wholeInput = new Set<number>();

  decode(data: string, emit: EmitEvent): void {
    const event = parseJson(data);
    if (!isRecord(event)) return;
    const index = typeof event.index === "number" ? event.index : -1;
    switch (event.type) {
      case "message_start":
        emitStart(event, emit);
        return;
      case "content_block_start":
        this.startBlock(index, event.content_block, emit);
        return;
      case "content_block_delta":
        if (!this.serverBlocks.has(index)) this.delta(index, event.delta, emit);
        return;
      case "message_delta":
        emitMessageDelta(event, emit);
        return;
      case "error":
        emit({ kind: "error", ...errorOf(event.error) });
        return;
      default:
    }
  }

  private startBlock(index: number, block: unknown, emit: EmitEvent): void {
    if (!isRecord(block)) return;
    if (block.type === "server_tool_use") this.serverBlocks.add(index);
    else this.serverBlocks.delete(index);
    this.wholeInput.delete(index);
    switch (block.type) {
      case "tool_use":
        emit({ kind: "tool_start", id: String(block.id ?? ""), name: String(block.name ?? "") });
        if (isRecord(block.input) && Object.keys(block.input).length > 0) {
          this.wholeInput.add(index);
          emit({ kind: "tool_args", text: JSON.stringify(block.input) });
        }
        return;
      case "text":
        if (typeof block.text === "string" && block.text !== "") {
          emit({ kind: "text", text: block.text });
        }
        return;
      case "thinking":
        // 自成一块：签了名没有文字的、紧接上一块的都是。
        emit({ kind: "think_start" });
        if (typeof block.thinking === "string" && block.thinking !== "") {
          emit({ kind: "think", text: block.thinking });
        }
        if (typeof block.signature === "string" && block.signature !== "") {
          emit({ kind: "sig", text: block.signature });
        }
        return;
      default:
    }
  }

  private delta(index: number, delta: unknown, emit: EmitEvent): void {
    if (!isRecord(delta)) return;
    const text = (field: unknown) => (typeof field === "string" ? field : "");
    switch (delta.type) {
      case "text_delta":
        emit({ kind: "text", text: text(delta.text) });
        return;
      case "input_json_delta":
        if (!this.wholeInput.has(index)) {
          emit({ kind: "tool_args", text: text(delta.partial_json) });
        }
        return;
      case "thinking_delta":
        emit({ kind: "think", text: text(delta.thinking) });
        return;
      case "signature_delta":
        emit({ kind: "sig", text: text(delta.signature) });
        return;
      default:
    }
  }
}

function emitStart(event: Record<string, unknown>, emit: EmitEvent): void {
  const message = isRecord(event.message) ? event.message : {};
  emit({
    kind: "start",
    id: typeof message.id === "string" ? message.id : "",
    usage: usageFromAnthropic(message.usage),
  });
}

function emitMessageDelta(event: Record<string, unknown>, emit: EmitEvent): void {
  const delta = isRecord(event.delta) ? event.delta : {};
  if (typeof delta.stop_reason === "string" && delta.stop_reason !== "") {
    emit({ kind: "stop", stop: stopFromAnthropic(delta.stop_reason) });
  }
  emit({ kind: "usage", usage: usageFromAnthropic(event.usage) });
}

function errorOf(error: unknown): { message: string; code: string | null } {
  const record = isRecord(error) ? error : {};
  const message =
    (typeof record.message === "string" && record.message) ||
    (typeof record.type === "string" && record.type) ||
    "the upstream reported an error";
  return { message, code: typeof record.type === "string" ? record.type : null };
}

type OpenBlock = "text" | "thinking" | "tool_use" | null;

/** 中间事件 → Anthropic 事件流，写给 Claude Code。 */
export class AnthropicEncoder {
  private readonly collector = new ReplyCollector();
  private started = false;
  private index = 0;
  private open: OpenBlock = null;
  // 开着的工具块收到过参数。
  private gotArgs = false;
  // 上游开始了新的一段思考，要和开着的那段分开。
  private freshThinking = false;

  constructor(private readonly input: { model: string; write: (text: string) => void }) {}

  event(event: StreamEvent): void {
    if (event.kind !== "start") this.start("");
    switch (event.kind) {
      case "start":
        this.start(event.id, event.usage);
        break;
      case "think_start":
        this.freshThinking = true;
        break;
      case "error":
        this.close();
        this.send("error", {
          type: "error",
          error: {
            type: "api_error",
            message: event.message,
            ...(event.code ? { code: event.code } : {}),
          },
        });
        break;
      default:
        this.content(event);
    }
    this.collector.add(event);
  }

  private content(event: StreamEvent): void {
    switch (event.kind) {
      case "text":
        if (event.text === "") return;
        this.openBlock("text", { text: "" });
        this.delta({ type: "text_delta", text: event.text });
        return;
      case "think":
        if (event.text === "") return;
        this.thinking();
        this.delta({ type: "thinking_delta", thinking: event.text });
        return;
      case "sig":
        if (this.open !== "thinking" && !this.freshThinking) return;
        this.thinking();
        this.delta({ type: "signature_delta", signature: event.text });
        return;
      case "tool_start":
        this.openBlock("tool_use", {
          id: anthropicOutId(event.id === "" ? `toolu_${newId()}` : event.id),
          name: event.name,
          input: {},
        });
        return;
      case "tool_args":
        if (this.open !== "tool_use" || event.text === "") return;
        this.gotArgs = true;
        this.delta({ type: "input_json_delta", partial_json: event.text });
        return;
      default:
    }
  }

  finish(): void {
    this.start("");
    this.close();
    const reply = this.collector.finish();
    this.send("message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopToAnthropic(reply.stop), stop_sequence: null },
      usage: usageToAnthropic(reply.usage),
    });
    this.send("message_stop", { type: "message_stop" });
  }

  usage(): Usage {
    return this.collector.usage();
  }

  private start(id: string, usage?: Usage): void {
    if (this.started) return;
    this.started = true;
    this.send("message_start", {
      type: "message_start",
      message: {
        id: anthropicMessageId(id),
        type: "message",
        role: "assistant",
        model: this.input.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: usageToAnthropic(usage ?? this.collector.usage()),
      },
    });
  }

  private openBlock(kind: Exclude<OpenBlock, null>, block: Record<string, unknown>): void {
    if (this.open === kind && kind !== "tool_use") return;
    this.close();
    this.gotArgs = false;
    this.freshThinking = false;
    this.send("content_block_start", {
      type: "content_block_start",
      index: this.index,
      content_block: { type: kind, ...block },
    });
    this.open = kind;
  }

  /** 开着的块变成思考块：除非上游从那以后开始了新的一段。 */
  private thinking(): void {
    if (this.freshThinking) {
      this.close();
      this.freshThinking = false;
    }
    this.openBlock("thinking", { thinking: "" });
  }

  private close(): void {
    if (this.open === null) return;
    if (this.open === "tool_use" && !this.gotArgs) {
      this.delta({ type: "input_json_delta", partial_json: "{}" });
    }
    this.send("content_block_stop", { type: "content_block_stop", index: this.index });
    this.index++;
    this.open = null;
  }

  private delta(delta: Record<string, unknown>): void {
    this.send("content_block_delta", { type: "content_block_delta", index: this.index, delta });
  }

  private send(name: string, data: unknown): void {
    this.input.write(sseEvent(name, data));
  }
}

/** 回复 id 写成 Anthropic 的 msg_…：OpenAI 形状上游的 chatcmpl-… 也一样。 */
function anthropicMessageId(id: string): string {
  if (id === "") return `msg_${newId()}`;
  return id.startsWith("msg_") ? id : `msg_${id.replace(/^chatcmpl-/, "")}`;
}

export function renderAnthropic(reply: Reply, model: string): Record<string, unknown> {
  const content = reply.parts.flatMap((part): Record<string, unknown>[] => {
    switch (part.kind) {
      case "text":
        return [{ type: "text", text: part.text }];
      case "thinking":
        return part.text === "" && part.signature === ""
          ? []
          : [{ type: "thinking", thinking: part.text, signature: part.signature }];
      case "tool_call":
        return [
          {
            type: "tool_use",
            id: anthropicOutId(part.id === "" ? `toolu_${newId()}` : part.id),
            name: part.name,
            input: parseJson(argsOf(part)) ?? {},
          },
        ];
      case "tool_result":
        return [];
    }
  });
  return {
    id: anthropicMessageId(reply.id),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stopToAnthropic(reply.stop),
    stop_sequence: null,
    usage: usageToAnthropic(reply.usage),
  };
}
