// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gateway/chat.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { isRecord, parseJson } from "../../upstream-http.js";
import {
  INTERRUPTED_TOOL,
  ReplyCollector,
  RequestShapeError,
  TOOL_RESULT_RECEIVED,
  argsOf,
  attachmentText,
  dataUrl,
  effortOf,
  imagePart,
  joinSplitCalls,
  newId,
  NO_REASONING,
  openAIEffort,
  openAIFormat,
  parseArgs,
  promptTokens,
  replaysThinking,
  stringOf,
  stringOrText,
  textOf,
  toolOutput,
  type EmitEvent,
  type Format,
  type GatewayRequest,
  type Message,
  type Part,
  type Reply,
  type StopReason,
  type StreamEvent,
  type Tool,
  type ToolChoice,
  type ToolResultPart,
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
    format: openAIFormat(body.response_format),
    named: {},
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
            ...toolOutput(message.content),
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

/** 字符串，或分段数组里的文字、图片与文件段。 */
function chatParts(content: unknown): Part[] {
  if (typeof content === "string") return content === "" ? [] : [{ kind: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((item): Part[] => {
    if (!isRecord(item)) return [];
    if (item.type === "text" && typeof item.text === "string") {
      return [{ kind: "text", text: item.text }];
    }
    if (item.type === "image_url" && isRecord(item.image_url)) {
      const url = item.image_url.url;
      return typeof url === "string" ? [imagePart(url)] : [];
    }
    if (item.type === "file" && isRecord(item.file)) return chatFile(item.file);
    return [];
  });
}

// 按扩展名认文件段常见的类型（magpie 用系统的类型表）；认不出的算二进制。
const FILE_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".html": "text/html",
  ".rtf": "application/rtf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".zip": "application/zip",
};

/**
 * Chat 的文件段（PDF 之类）：别的协议装不下，发出时换成一句占位文字，免得模型当作读过了来回答。
 * 内容是 data: 地址或光秃秃的 base64；只给了 OpenAI 文件 id 的记下那个 id。
 */
function chatFile(file: Record<string, unknown>): Part[] {
  const data = stringOf(file.file_data);
  const name = stringOf(file.filename).toLowerCase();
  const byName = FILE_TYPES[name.slice(name.lastIndexOf("."))] ?? "";
  const fallback = byName || "application/octet-stream";
  if (data.startsWith("data:")) {
    const inline = imagePart(data);
    if (inline.data !== "") {
      return [
        { kind: "file", mediaType: inline.mediaType || fallback, data: inline.data, url: "" },
      ];
    }
  } else if (data !== "") {
    return [{ kind: "file", mediaType: fallback, data, url: "" }];
  }
  const id = stringOf(file.file_id);
  return id === "" ? [] : [{ kind: "file", mediaType: fallback, data: "", url: id }];
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
        strict: fn.strict === true,
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
  messages.push(...chatMessages({ messages: request.messages, replay: replaysThinking(model) }));
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
  const effort = openAIEffort(request);
  if (effort) out.reasoning_effort = effort;
  if (request.tools.length > 0) Object.assign(out, chatTools(request));
  if (request.format) out.response_format = chatFormat(request.format);
  return out;
}

function chatFormat(format: Format): Record<string, unknown> {
  if (format.type === "json_object") return { type: "json_object" };
  const spec: Record<string, unknown> = { name: format.name };
  if (format.description !== "") spec.description = format.description;
  spec.schema = format.schema;
  if (format.strict !== null) spec.strict = format.strict;
  return { type: "json_schema", json_schema: spec };
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

type ChatContent = Record<string, unknown>;

/**
 * 一轮的工具结果排在它自己的文字前面：tool 消息必须紧跟发起调用的 assistant 消息（Kimi 否则 400）。
 * tool 消息只装文字：工具返回的图片放进紧接着的 user 消息，有用户自己的话就放在它开头
 * （有的模型的对话模板不收两条相邻的 user 消息）。
 * replay：上游要回放推理（DeepSeek），每轮的推理写进 reasoning_content；调用工具、或回答工具结果的一轮
 * 没有推理的写一个空格，否则它整个请求都拒。
 */
function chatMessages(input: { messages: Message[]; replay: boolean }): ChatMessage[] {
  const { replay } = input;
  const out: ChatMessage[] = [];
  const names = new Map<string, string>();
  let seen: ChatContent[] = [];
  // 最后发出的是工具结果，后面没有用户自己的话。
  let afterTool = false;
  for (const message of joinSplitCalls(input.messages)) {
    if (message.role === "assistant") {
      if (seen.length > 0) out.push({ role: "user", content: seen });
      seen = [];
      const assistant = chatAssistant(message);
      let called = false;
      for (const part of message.parts) {
        if (part.kind !== "tool_call") continue;
        called = true;
        names.set(part.id, part.name);
      }
      const think = message.parts
        .map((part) => (part.kind === "thinking" ? part.text : ""))
        .join("");
      if (replay && think !== "") assistant.reasoning_content = think;
      else if (replay && (called || afterTool)) assistant.reasoning_content = NO_REASONING;
      afterTool = false;
      out.push(assistant);
      continue;
    }
    const turn = chatUserTurn(message, names);
    out.push(...turn.tools);
    seen.push(...turn.images);
    afterTool = turn.tools.length > 0 && turn.content.length === 0 && seen.length === 0;
    if (turn.content.length === 0) continue;
    const content = [...seen, ...turn.content];
    const plain = turn.plain && seen.length === 0;
    seen = [];
    out.push({
      role: "user",
      content: plain ? content.map((item) => String(item.text)).join("") : content,
    });
  }
  if (seen.length > 0) out.push({ role: "user", content: seen });
  return out;
}

interface ChatUserTurn {
  tools: ChatMessage[];
  content: ChatContent[];
  // 只有文字：写成一个字符串。
  plain: boolean;
  // 工具返回的图片，连同说明是谁的那句话。
  images: ChatContent[];
}

function chatUserTurn(message: Message, names: Map<string, string>): ChatUserTurn {
  const turn: ChatUserTurn = { tools: [], content: [], plain: true, images: [] };
  for (const part of message.parts) {
    switch (part.kind) {
      case "text":
        turn.content.push({ type: "text", text: part.text });
        break;
      case "file":
        turn.content.push({ type: "text", text: attachmentText(part) });
        break;
      case "image":
        turn.plain = false;
        turn.content.push({ type: "image_url", image_url: { url: dataUrl(part) } });
        break;
      case "tool_result":
        turn.tools.push({ role: "tool", tool_call_id: part.callId, content: withImageNote(part) });
        turn.images.push(...seenImages(part, names.get(part.callId)));
        break;
      default:
    }
  }
  return turn;
}

function withImageNote(part: ToolResultPart): string {
  const count = part.images.length;
  if (count === 0) return part.text;
  const note =
    count === 1
      ? "[The tool returned an image; it follows in the next message.]"
      : `[The tool returned ${count} images; they follow in the next message.]`;
  return part.text.trim() === "" ? note : `${part.text}\n\n${note}`;
}

function seenImages(part: ToolResultPart, name: string | undefined): ChatContent[] {
  if (part.images.length === 0) return [];
  const of = name ? `${name} (tool call ${part.callId})` : `tool call ${part.callId}`;
  return [
    { type: "text", text: `[From the result of ${of}:]` },
    ...part.images.map((image) => ({ type: "image_url", image_url: { url: dataUrl(image) } })),
  ];
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

// 回复文首一段思考的起止标签：没装推理解析的开源模型、MiniMax 用 <think>，Gemini 用 <thought>。
const THOUGHT_TAGS: Record<string, string> = { "<think>": "</think>", "<thought>": "</thought>" };

/**
 * Chat 流 → 中间事件。工具调用按 index 分片拼接，同一 id 重复出现（有的中转站每片都带）仍是同一个调用；
 * 只认第一个读得出 index 的 choice，读不出 index 的片不选也不拒。文首的 <think> / <thought> 段算推理。
 */
export class ChatDecoder {
  private started = false;
  private tool = -1;
  private toolId = "";
  private choice: number | null = null;
  // 还可能是标签开头、先扣着的文字。
  private lead = "";
  // 正在标签里：这是收尾的标签。
  private thoughtClose: string | null = null;
  // 正文已经开始，不再找标签。
  private past = false;

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
      this.text(delta.content, emit);
    }
    const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls.filter(isRecord) : [];
    if (calls.length > 0) this.end(emit);
    calls.forEach((call, position) => this.toolCall(call, position, emit));
    if (typeof choice.finish_reason === "string" && choice.finish_reason !== "") {
      this.end(emit);
      emit({ kind: "stop", stop: stopFromChat(choice.finish_reason) });
    }
  }

  /** 文字一段段到，标签可能被切开：可能是标签开头的先扣着，标签里的算推理。 */
  private text(piece: string, emit: EmitEvent): void {
    let rest: string | null = piece;
    if (!this.past && this.thoughtClose === null) rest = this.openTag(piece);
    if (rest !== null && this.thoughtClose !== null) {
      rest = this.inThought({ piece: rest, close: this.thoughtClose, emit });
    }
    if (rest) emit({ kind: "text", text: rest });
  }

  /** 文首还没定：攒着看是不是开标签。返回标签后（或确定不是标签时）的文字，还要再等时为 null。 */
  private openTag(piece: string): string | null {
    this.lead += piece;
    const lead = this.lead.replace(/^[ \n]+/, "");
    const opens = Object.keys(THOUGHT_TAGS);
    if (opens.some((open) => lead.length < open.length && open.startsWith(lead))) return null;
    const open = opens.find((tag) => lead.startsWith(tag));
    const held = this.lead;
    this.lead = "";
    if (!open) {
      this.past = true;
      return held;
    }
    this.thoughtClose = THOUGHT_TAGS[open]!;
    return lead.slice(open.length);
  }

  /** 标签里的是推理；返回收尾标签之后的正文，标签还没收尾时为 null。 */
  private inThought(input: { piece: string; close: string; emit: EmitEvent }): string | null {
    const { close, emit } = input;
    const text = this.lead + input.piece;
    this.lead = "";
    const at = text.indexOf(close);
    if (at === -1) {
      // 结尾可能是收尾标签的开头，先扣着。
      const cut = text.length - partialTagAtEnd({ text, tag: close });
      if (cut > 0) emit({ kind: "think", text: text.slice(0, cut) });
      this.lead = text.slice(cut);
      return null;
    }
    if (at > 0) emit({ kind: "think", text: text.slice(0, at) });
    this.thoughtClose = null;
    this.past = true;
    return text.slice(at + close.length).replace(/^\n+/, "");
  }

  /** 交出为看标签而扣着的文字：流结束、或接着是工具调用时。 */
  end(emit: EmitEvent): void {
    if (this.lead === "") return;
    emit({ kind: this.thoughtClose === null ? "text" : "think", text: this.lead });
    this.lead = "";
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

/** text 结尾有几个字符是 tag 的开头。 */
function partialTagAtEnd(input: { text: string; tag: string }): number {
  const { text, tag } = input;
  for (let length = Math.min(tag.length - 1, text.length); length > 0; length--) {
    if (text.endsWith(tag.slice(0, length))) return length;
  }
  return 0;
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
