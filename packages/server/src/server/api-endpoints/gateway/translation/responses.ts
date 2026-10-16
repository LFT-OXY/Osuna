// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gateway/responses.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { createHash } from "node:crypto";
import { isRecord, parseJson } from "../../upstream-http.js";
import {
  INTERRUPTED_TOOL,
  NO_REASONING,
  ReplyCollector,
  RequestShapeError,
  TOOL_RESULT_RECEIVED,
  argsOf,
  attachmentText,
  callsTool,
  dataUrl,
  effortOf,
  imagePart,
  newId,
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
  type NamedTool,
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
 * OpenAI Responses 协议：解析请求、构建请求、解码流、编码流、渲染整份回复，外加直通前的工具配对修补
 * （joinToolRuns → orphanedToolOutputs → pairToolItems，magpie 的 attempt 顺序）。
 * 修补都作用于请求体原文的 input 数组，没什么可改时原文逐字节返回。
 *
 * Responses 到 Responses 一律直通，所以翻译只发生在它与另两种协议之间：
 * 上游封存的推理（encrypted_content）只有 Responses 读得了，解析时丢掉；
 * 只给 OpenAI 文件 id 的图片、input_file 附件别家也打不开，前者在最新一轮时回 400，其余丢掉。
 * Codex 的命名空间工具与自由文本工具按扁平名的函数给模型，调用写回 Codex 时还原（GatewayRequest.named）。
 * 没做：Codex 的 tool_search 与 Responses Lite（Osuna 的模型目录不开这两样）。
 */

const CALL_TYPES = new Set(["function_call", "custom_tool_call", "tool_search_call"]);
const OUTPUT_TYPES = new Set([
  "function_call_output",
  "custom_tool_call_output",
  "tool_search_output",
]);

function inputOf(body: string): { request: Record<string, unknown>; input: unknown[] } | null {
  const request = parseJson(body);
  if (!isRecord(request) || !Array.isArray(request.input)) return null;
  return { request, input: request.input };
}

function typeOf(item: unknown): string {
  return isRecord(item) && typeof item.type === "string" ? item.type : "";
}

function callIdOf(item: unknown): string {
  return isRecord(item) && typeof item.call_id === "string" ? item.call_id : "";
}

/**
 * 一串调用与结果之间夹着的项（Codex 每个缩过图的结果后面写的 <image_resize_notice>）挪到这串的末尾：
 * 检查配对的上游会认为这串在那里断了而拒收（火山方舟、OpenCode Zen）。带 call_id 的项永远不动；
 * 第一个结果之前，模型自己写的项（推理、它的文字、*_call）是它这一步的，留在原处。
 * 只有后面有结果回答它的调用才算开了一串。
 */
export function joinToolRuns(body: string): string {
  if (!body.includes('_call"')) return body;
  const parsed = inputOf(body);
  if (!parsed) return body;
  const { input } = parsed;
  const isResult = (item: unknown) => callIdOf(item) !== "" && typeOf(item).endsWith("_output");
  const modelsOwn = (item: unknown) => {
    const type = typeOf(item);
    const assistant = type === "message" && isRecord(item) && item.role === "assistant";
    return type === "reasoning" || assistant || type.endsWith("_call");
  };
  // answeredLater[i]：位置 i 的调用后面有回答它的结果。
  const ahead = new Set<string>();
  const answeredLater = input.map(() => false);
  for (let index = input.length - 1; index >= 0; index--) {
    const item = input[index];
    if (isResult(item)) ahead.add(callIdOf(item));
    else if (callIdOf(item) !== "") answeredLater[index] = ahead.has(callIdOf(item));
  }
  const out: unknown[] = [];
  let held: unknown[] = [];
  let moved = false;
  // open：这串里结果还在后面的调用；answering：这串的结果已经开始了。
  const open = new Set<string>();
  let answering = false;
  input.forEach((item, index) => {
    const id = callIdOf(item);
    if (isResult(item)) {
      if (open.delete(id)) answering = true;
    } else if (id !== "") {
      if (answeredLater[index]) open.add(id);
    } else if (open.size > 0 && (answering || !modelsOwn(item))) {
      held.push(item);
      moved = true;
      return;
    }
    out.push(item);
    if (open.size === 0) {
      out.push(...held);
      held = [];
      answering = false;
    }
  });
  out.push(...held);
  if (!moved) return body;
  return JSON.stringify({ ...parsed.request, input: out });
}

/**
 * 没有对应结果的调用（function_call / custom_tool_call）补一个「轮次被中断」的结果，
 * 放在它所在那串调用与结果的末尾。没有调用的结果交给 orphanedToolOutputs；
 * 回答上一个请求里调用的结果（previous_response_id）原样不动。
 */
export function pairToolItems(body: string): string {
  if (!body.includes('_call"')) return body;
  const parsed = inputOf(body);
  if (!parsed) return body;
  const { input } = parsed;
  const answered = new Set(
    input.flatMap((item) => {
      const type = typeOf(item);
      const id = callIdOf(item);
      return (type === "function_call_output" || type === "custom_tool_call_output") && id !== ""
        ? [id]
        : [];
    }),
  );
  const exchange = (item: unknown) =>
    CALL_TYPES.has(typeOf(item)) || OUTPUT_TYPES.has(typeOf(item));
  const out: unknown[] = [];
  let owed: unknown[] = [];
  input.forEach((item, index) => {
    out.push(item);
    const type = typeOf(item);
    const id = callIdOf(item);
    if (
      (type === "function_call" || type === "custom_tool_call") &&
      id !== "" &&
      !answered.has(id)
    ) {
      owed.push({ type: `${type}_output`, call_id: id, output: INTERRUPTED_TOOL });
      answered.add(id);
    }
    if (owed.length > 0 && exchange(item) && !exchange(input[index + 1])) {
      out.push(...owed);
      owed = [];
    }
  });
  if (out.length === input.length) return body;
  return JSON.stringify({ ...parsed.request, input: out });
}

/**
 * 没有 call_id 的工具结果（Codex 跨线程的通知）改成 user 消息：要求结果成对的后端仍收得到它的文字，
 * 又不用编一个调用 id。正处在一串调用之中时，挪到这串结果之后。
 */
export function orphanedToolOutputs(body: string): string {
  const parsed = inputOf(body);
  if (!parsed) return body;
  const out: unknown[] = [];
  let held: unknown[] = [];
  let inCalls = false;
  let hadResults = false;
  let changed = false;
  for (const item of parsed.input) {
    const type = typeOf(item);
    const orphan =
      (type === "function_call_output" || type === "custom_tool_call_output") &&
      callIdOf(item) === "";
    if (orphan) {
      const message = orphanAsMessage(item);
      if (inCalls) held.push(message);
      else out.push(message);
      changed = true;
      continue;
    }
    if (CALL_TYPES.has(type)) {
      if (hadResults) {
        out.push(...held);
        held = [];
      }
      inCalls = true;
      hadResults = false;
    } else if (OUTPUT_TYPES.has(type)) {
      hadResults = true;
    } else {
      out.push(...held);
      held = [];
      inCalls = false;
    }
    out.push(item);
  }
  out.push(...held);
  if (!changed) return body;
  return JSON.stringify({ ...parsed.request, input: out });
}

function orphanAsMessage(item: unknown): Record<string, unknown> {
  const output = isRecord(item) ? item.output : undefined;
  const text = stringOrText(output);
  const content: Record<string, unknown>[] = text === "" ? [] : [{ type: "input_text", text }];
  if (Array.isArray(output)) {
    for (const part of output) {
      if (isRecord(part) && part.type === "input_image" && typeof part.image_url === "string") {
        content.push({ type: "input_image", detail: "auto", image_url: part.image_url });
      }
    }
  }
  if (content.length === 0) content.push({ type: "input_text", text: TOOL_RESULT_RECEIVED });
  return { type: "message", role: "user", content };
}

export function parseResponsesRequest(body: unknown): GatewayRequest {
  if (!isRecord(body)) throw new RequestShapeError("invalid request: the body must be an object");
  const reasoning = isRecord(body.reasoning) ? body.reasoning : null;
  const effort = stringOf(reasoning?.effort);
  const conversation = parseInput(body.input, stringOf(body.instructions));
  const offered = parseResponsesTools(body.tools);
  const chosen = parseResponsesToolChoice(body.tool_choice, offered);
  return {
    model: stringOf(body.model),
    system: conversation.system,
    messages: conversation.messages,
    tools: chosen.tools,
    toolChoice: chosen.choice,
    maxTokens:
      typeof body.max_output_tokens === "number" && body.max_output_tokens > 0
        ? body.max_output_tokens
        : 0,
    temperature: typeof body.temperature === "number" ? body.temperature : null,
    topP: typeof body.top_p === "number" ? body.top_p : null,
    stop: [],
    stream: body.stream === true,
    effort: effortOf(effort),
    thinking: reasoning !== null,
    thinkOff: effort.trim().toLowerCase() === "none",
    parallel: typeof body.parallel_tool_calls === "boolean" ? body.parallel_tool_calls : null,
    metadata: null,
    format: openAIFormat(isRecord(body.text) ? body.text.format : null),
    named: chosen.named,
  };
}

interface Conversation {
  system: string;
  messages: Message[];
}

/**
 * input 是一句话或一串项。对话开始回答之后 Codex 才加的 developer / system 消息（环境、设置变了）
 * 留在原处、按系统的话写进 user 消息：挪进系统提示会改掉提示开头，整段对话的缓存都要重写（magpie #502）。
 */
function parseInput(input: unknown, instructions: string): Conversation {
  if (typeof input === "string") {
    return {
      system: instructions,
      messages: [{ role: "user", parts: [{ kind: "text", text: input }] }],
    };
  }
  if (!Array.isArray(input))
    throw new RequestShapeError("invalid input: must be a string or an array");
  rejectFileIdImage(input.at(-1));
  const system = instructions === "" ? [] : [instructions];
  const messages: Message[] = [];
  let replied = false;
  for (const item of input) {
    if (!isRecord(item)) continue;
    const type = stringOf(item.type);
    const role = stringOf(item.role);
    const answering =
      role === "assistant" ||
      type === "reasoning" ||
      CALL_TYPES.has(type) ||
      OUTPUT_TYPES.has(type);
    replied ||= answering;
    if (type === "message" || (type === "" && role !== "")) {
      const parts = responsesParts(item.content);
      if (role === "system" || role === "developer") {
        const text = textOf(parts);
        if (text !== "" && replied) {
          messages.push({
            role: "user",
            parts: [{ kind: "text", text: `<system-reminder>\n${text}\n</system-reminder>` }],
          });
        } else if (text !== "") {
          system.push(text);
        }
        continue;
      }
      messages.push({ role: role === "assistant" ? "assistant" : "user", parts });
      continue;
    }
    const message = parseItem(item, type);
    if (message) messages.push(message);
  }
  return { system: system.join("\n\n"), messages: mergeTurns(messages) };
}

function parseItem(item: Record<string, unknown>, type: string): Message | null {
  const callId = stringOf(item.call_id);
  const name = toolName(item);
  switch (type) {
    // MultiAgentV2 交给子 Agent 的任务、Agent 之间的消息：收到它的那个 Agent 的 user 一轮。
    case "agent_message": {
      const parts = responsesParts(item.content);
      return parts.length === 0 ? null : { role: "user", parts };
    }
    case "function_call":
      return toolCall({ id: callId, name, args: parseArgs(argumentsOf(item.arguments)) });
    case "custom_tool_call":
      return toolCall({ id: callId, name, args: JSON.stringify({ input: stringOf(item.input) }) });
    case "function_call_output":
    case "custom_tool_call_output":
      return {
        role: "user",
        parts: [{ kind: "tool_result", callId, ...toolOutput(item.output), isError: false }],
      };
    case "reasoning": {
      const text = reasoningText(item);
      return text === ""
        ? null
        : { role: "assistant", parts: [{ kind: "thinking", text, signature: "" }] };
    }
    default:
      return null;
  }
}

function toolCall(input: { id: string; name: string; args: string }): Message {
  return { role: "assistant", parts: [{ kind: "tool_call", ...input }] };
}

/** 命名空间里的工具用扁平名，和给模型时一样。 */
function toolName(item: Record<string, unknown>): string {
  const namespace = stringOf(item.namespace);
  return flatName(namespace, stringOf(item.name));
}

/** function_call 的参数是 JSON 字符串；有的调用（Codex 的 tool_search_call）给的是对象。 */
function argumentsOf(value: unknown): string {
  if (typeof value === "string") return value;
  return value === undefined || value === null ? "" : JSON.stringify(value);
}

/** 推理本身（reasoning_text），没有时取摘要。封存的部分（encrypted_content）不读。 */
function reasoningText(item: Record<string, unknown>): string {
  return textsOf(item.content, "reasoning_text") || textsOf(item.summary, "summary_text");
}

/** 一串分段里某种段的文字接起来。 */
function textsOf(parts: unknown, type: string): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (isRecord(part) && part.type === type ? stringOf(part.text) : ""))
    .join("");
}

/** 字符串，或分段数组里的文字与图片；input_file 附件别家打不开，丢掉。 */
function responsesParts(content: unknown): Part[] {
  if (typeof content === "string") return content === "" ? [] : [{ kind: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block): Part[] => {
    if (!isRecord(block)) return [];
    switch (block.type) {
      case "input_text":
      case "output_text":
      case "text":
        return [{ kind: "text", text: stringOf(block.text) }];
      case "input_image": {
        const url = stringOf(block.image_url);
        return url === "" ? [] : [imagePart(url)];
      }
      default:
        return [];
    }
  });
}

/**
 * 最新一轮里只给 OpenAI 文件 id 的图片：文件存在那家 Responses 接口，别家打不开，
 * 当作没有图又会让模型答非所问，回 400（magpie hasUnportableCurrentImage）。更早轮次的直接丢掉。
 */
function rejectFileIdImage(last: unknown): void {
  if (!isRecord(last) || !Array.isArray(last.content)) return;
  const unportable = last.content.some(
    (block) => isRecord(block) && block.type === "input_image" && stringOf(block.image_url) === "",
  );
  if (unportable) {
    throw new RequestShapeError(
      "The latest message has an image given only as an OpenAI file_id, which this API endpoint cannot open; send the image itself",
    );
  }
}

/** Responses 把一轮拆成一项一项：相邻同角色的消息并成一条。 */
function mergeTurns(messages: Message[]): Message[] {
  const out: Message[] = [];
  for (const message of messages) {
    const previous = out.at(-1);
    if (previous?.role === message.role) previous.parts = [...previous.parts, ...message.parts];
    else out.push({ role: message.role, parts: [...message.parts] });
  }
  return out;
}

interface OfferedTools {
  tools: Tool[];
  named: Record<string, NamedTool>;
}

// 自由文本工具当作只有一个 input 字符串参数的函数给模型。
const CUSTOM_SCHEMA = {
  type: "object",
  properties: {
    input: {
      type: "string",
      description: "The tool's free-form input, the whole of it, exactly as it is to be run.",
    },
  },
  required: ["input"],
  additionalProperties: false,
};

/**
 * 函数、自由文本工具（apply_patch、代码模式的 exec）与命名空间（MCP、协作工具）里的这两种；
 * 命名空间摊平成 `命名空间__名字`，因为认得命名空间的模型不多。联网搜索之类的服务端工具不代办，剔除。
 */
function parseResponsesTools(tools: unknown): OfferedTools {
  const out: OfferedTools = { tools: [], named: {} };
  const offer = (tool: Record<string, unknown>, namespace: string) => {
    const name = stringOf(tool.name);
    const flat = flatName(namespace, name);
    if (tool.type === "function") {
      out.tools.push({
        name: flat,
        description: stringOf(tool.description),
        schema: unsealed(tool.parameters ?? null),
        strict: tool.strict === true,
      });
      if (namespace !== "") out.named[flat] = { namespace, name, custom: false };
    } else if (tool.type === "custom") {
      out.tools.push({
        name: flat,
        description: customDescription(tool),
        schema: CUSTOM_SCHEMA,
        strict: false,
      });
      out.named[flat] = { namespace, name, custom: true };
    }
  };
  if (!Array.isArray(tools)) return out;
  for (const tool of tools) {
    if (!isRecord(tool)) continue;
    if (tool.type !== "namespace") offer(tool, "");
    else if (Array.isArray(tool.tools)) {
      for (const nested of tool.tools) if (isRecord(nested)) offer(nested, stringOf(tool.name));
    }
  }
  return out;
}

/** 摊平后的名字（不在命名空间里的就是它自己）；超过 64 个字符（多数接口的工具名上限）的截短并接上哈希，免得两个撞上。 */
function flatName(namespace: string, name: string): string {
  if (namespace === "") return name;
  const flat = `${namespace}__${name}`;
  if (flat.length <= 64) return flat;
  const sum = createHash("sha256").update(`${namespace}\0${name}`).digest("hex").slice(0, 8);
  return `${flat.slice(0, 55)}_${sum}`;
}

/**
 * Codex 给有的参数标了 "encrypted"（spawn_agent 的 message）：翻译出去的调用写回 Codex 时是明文，
 * 认这个标记的上游不能把它们封起来（magpie #613）。
 */
function unsealed(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(unsealed);
  if (!isRecord(schema)) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key !== "encrypted" || typeof value !== "boolean") out[key] = unsealed(value);
  }
  return out;
}

/** 自由文本工具作为函数的说明：它自己的说明、input 是什么、input 遵循的语法。 */
function customDescription(tool: Record<string, unknown>): string {
  let out = stringOf(tool.description).trim();
  if (out !== "") out += "\n\n";
  out +=
    "Put the tool's whole free-form input, as it is to be run, in the `input` string; it is passed on as written, so it is not itself JSON.";
  const format = isRecord(tool.format) ? tool.format : null;
  const definition = stringOf(format?.definition).trim();
  if (format?.type === "grammar" && definition !== "") {
    out += `\n\nThe input follows this ${stringOf(format.syntax) || "the"} grammar:\n${definition}`;
  }
  return out;
}

/** 模型对自由文本工具的调用里的文本：参数的 input，否则它给的原样。 */
export function customInput(args: string): string {
  const parsed = parseJson(args);
  if (isRecord(parsed) && typeof parsed.input === "string") return parsed.input;
  return typeof parsed === "string" ? parsed : args;
}

interface ChosenTools extends OfferedTools {
  choice: ToolChoice;
}

/** allowed_tools 只留它点到的工具；mode 只能是 auto 或 required。 */
function parseResponsesToolChoice(choice: unknown, offered: OfferedTools): ChosenTools {
  if (choice === "auto" || choice === "none" || choice === "required") {
    return { ...offered, choice };
  }
  if (!isRecord(choice)) return { ...offered, choice: "" };
  if (choice.type === "function" && stringOf(choice.name) !== "") {
    return { ...offered, choice: `name:${stringOf(choice.name)}` };
  }
  if (choice.type !== "allowed_tools") return { ...offered, choice: "" };
  const { mode } = choice;
  if (mode !== "auto" && mode !== "required") {
    throw new RequestShapeError(`invalid allowed_tools mode ${JSON.stringify(mode)}`);
  }
  const allowed = new Set(
    (Array.isArray(choice.tools) ? choice.tools : []).flatMap((tool) => {
      if (!isRecord(tool) || (tool.type !== "function" && tool.type !== "custom")) return [];
      const name = stringOf(tool.name);
      if (name === "") return [];
      return [flatName(stringOf(tool.namespace), name)];
    }),
  );
  const named: Record<string, NamedTool> = {};
  for (const [name, tool] of Object.entries(offered.named)) {
    if (allowed.has(name)) named[name] = tool;
  }
  return { choice: mode, tools: offered.tools.filter((tool) => allowed.has(tool.name)), named };
}

/**
 * 历史思考只回原厂：Anthropic 的签名思考、Chat 的推理文字都不发给 Responses 上游；
 * 例外是要回放推理的 DeepSeek 模型，每轮推理写成 reasoning 项，每一步都以推理开头（reasonFirst）。
 */
export function buildResponsesRequest(
  request: GatewayRequest,
  model: string,
): Record<string, unknown> {
  const replay = replaysThinking(model);
  const input = responsesInput(request.messages, replay);
  const out: Record<string, unknown> = {
    model,
    input: replay ? (reasonFirst(input) ?? input) : input,
    stream: request.stream,
    store: false,
  };
  if (request.format) out.text = { format: responsesFormat(request.format) };
  if (request.system !== "") out.instructions = request.system;
  if (request.maxTokens > 0) out.max_output_tokens = request.maxTokens;
  if (request.temperature !== null) out.temperature = request.temperature;
  if (request.topP !== null) out.top_p = request.topP;
  const effort = openAIEffort(request);
  if (effort) out.reasoning = { effort, summary: "auto" };
  else if (request.thinking) out.reasoning = { summary: "auto" };
  if (request.tools.length > 0) Object.assign(out, responsesTools(request));
  return out;
}

function responsesInput(messages: Message[], replay: boolean): unknown[] {
  const input: unknown[] = [];
  for (const message of messages) {
    const assistant = message.role === "assistant";
    const textType = assistant ? "output_text" : "input_text";
    let content: Record<string, unknown>[] = [];
    const flush = () => {
      if (content.length > 0) input.push({ type: "message", role: message.role, content });
      content = [];
    };
    for (const part of message.parts) {
      switch (part.kind) {
        case "text":
          content.push({ type: textType, text: part.text });
          break;
        case "file":
          content.push({ type: textType, text: attachmentText(part) });
          break;
        case "image":
          if (!assistant) {
            content.push({ type: "input_image", detail: "auto", image_url: dataUrl(part) });
          }
          break;
        case "thinking":
          if (replay && part.text !== "") {
            flush();
            input.push(reasoningItem(part.text));
          }
          break;
        case "tool_call":
          flush();
          input.push({
            type: "function_call",
            call_id: callIdOr(part.id),
            name: part.name,
            arguments: argsOf(part),
          });
          break;
        case "tool_result": {
          flush();
          const images = part.images.map((image) => ({
            type: "input_image",
            detail: "auto",
            image_url: dataUrl(image),
          }));
          const text = part.text.trim() === "" ? [] : [{ type: "input_text", text: part.text }];
          input.push({
            type: "function_call_output",
            call_id: part.callId,
            output: images.length === 0 ? part.text : [...text, ...images],
          });
          break;
        }
      }
    }
    flush();
  }
  return input;
}

function reasoningItem(text: string): Record<string, unknown> {
  return { type: "reasoning", summary: [], content: [{ type: "reasoning_text", text }] };
}

function responsesFormat(format: Format): Record<string, unknown> {
  if (format.type === "json_object") return { type: "json_object" };
  const out: Record<string, unknown> = { type: "json_schema", name: format.name };
  if (format.description !== "") out.description = format.description;
  out.schema = format.schema;
  if (format.strict !== null) out.strict = format.strict;
  return out;
}

/** strict 照 Codex 一律写明：不写时 ChatGPT 后端按严格模式校验 schema，拒收带环视的 pattern（magpie #383）。 */
function responsesTools(request: GatewayRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {
    tools: request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      strict: tool.strict,
      ...(tool.schema === null ? {} : { parameters: tool.schema }),
    })),
  };
  const { toolChoice } = request;
  if (toolChoice === "auto" || toolChoice === "none" || toolChoice === "required") {
    out.tool_choice = toolChoice;
  } else if (toolChoice.startsWith("name:")) {
    out.tool_choice = { type: "function", name: toolChoice.slice(5) };
  }
  if (request.parallel !== null) out.parallel_tool_calls = request.parallel;
  return out;
}

type StepKind = "other" | "reasoning" | "said" | "call" | "output" | "turn";

function stepKindOf(item: unknown): StepKind {
  const type = typeOf(item);
  const role = isRecord(item) ? stringOf(item.role) : "";
  if (type === "reasoning") return "reasoning";
  if (type.endsWith("_output")) return "output";
  if (type.endsWith("_call")) return "call";
  if ((type === "message" || type === "") && role === "assistant") return "said";
  if (type === "message" || (type === "" && role !== "")) return "turn";
  return "other";
}

/**
 * 模型的每一步（两条 user 消息或工具结果之间，它的推理、说的话与调用）凡是调用了工具、或接在工具结果后面，
 * 都以一个推理项开头：这一步自己的第一个推理挪到最前，没有就补一个空格的。
 * DeepSeek 的 /v1/responses 把一步读成一条 assistant 消息，开头不是推理就整个请求拒收
 * （"The `reasoning_text` in the thinking mode must be passed back to the API"，magpie #1592、#1822）。
 * 都已以推理开头时为 null。
 */
function reasonFirst(items: unknown[]): unknown[] | null {
  const kinds = items.map(stepKindOf);
  const inStep = (kind: StepKind | undefined) =>
    kind === "reasoning" || kind === "said" || kind === "call";
  const led: unknown[] = [];
  let changed = false;
  let afterOutput = false;
  let index = 0;
  while (index < items.length) {
    if (!inStep(kinds[index])) {
      if (kinds[index] === "output") afterOutput = true;
      else if (kinds[index] === "turn") afterOutput = false;
      led.push(items[index]);
      index++;
      continue;
    }
    let end = index;
    let calls = false;
    let first = -1;
    for (; end < items.length && inStep(kinds[end]); end++) {
      calls ||= kinds[end] === "call";
      if (kinds[end] === "reasoning" && first < 0) first = end;
    }
    if ((calls || afterOutput) && first !== index) {
      changed = true;
      led.push(first < 0 ? reasoningItem(NO_REASONING) : items[first]);
      for (let at = index; at < end; at++) if (at !== first) led.push(items[at]);
    } else {
      led.push(...items.slice(index, end));
    }
    index = end;
  }
  return changed ? led : null;
}

export interface ReplayedInput {
  input: unknown[];
  // 挪过项（reasonFirst）：不能只改补了文字的那几项。
  reordered: boolean;
}

/**
 * 直通给 DeepSeek 模型的 Responses 请求的 input：没有推理文字的推理项（Codex 原样发回的封存推理、
 * 别家答的只有摘要的那轮）补上摘要或一个空格，每一步以推理开头（reasonFirst）。不用改时为 null。
 */
export function replayedReasoningInput(input: unknown[]): ReplayedInput | null {
  let changed = false;
  const filled = input.map((item) => {
    if (typeOf(item) !== "reasoning" || !isRecord(item)) return item;
    const content = Array.isArray(item.content) ? item.content : [];
    const hasText = content.some(
      (part) => isRecord(part) && part.type === "reasoning_text" && stringOf(part.text) !== "",
    );
    if (hasText) return item;
    changed = true;
    const summary = textsOf(item.summary, "summary_text");
    return { ...item, content: [{ type: "reasoning_text", text: summary || NO_REASONING }] };
  });
  const led = reasonFirst(filled);
  if (led) return { input: led, reordered: true };
  return changed ? { input: filled, reordered: false } : null;
}

/** input_tokens 是整个 prompt，其中有缓存读到的与写进缓存的（Codex 也这样算，magpie #589）。 */
export function usageFromResponses(value: unknown): Usage {
  const usage = isRecord(value) ? value : {};
  const count = (field: unknown) => (typeof field === "number" ? field : 0);
  const input = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const output = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {};
  const cacheRead = count(input.cached_tokens);
  const cacheWrite = count(input.cache_write_tokens);
  return {
    input: Math.max(count(usage.input_tokens) - cacheRead - cacheWrite, 0),
    output: count(usage.output_tokens),
    cacheRead,
    cacheWrite,
    cacheWrite1h: 0,
    reasoning: count(output.reasoning_tokens),
  };
}

export function usageToResponses(usage: Usage): Record<string, unknown> {
  const input = promptTokens(usage);
  return {
    input_tokens: input,
    output_tokens: usage.output,
    total_tokens: input + usage.output,
    input_tokens_details: { cached_tokens: usage.cacheRead, cache_write_tokens: usage.cacheWrite },
    output_tokens_details: { reasoning_tokens: usage.reasoning },
  };
}

type ResponseStatus = "in_progress" | "completed" | "incomplete" | "failed";

interface Ending {
  status: ResponseStatus;
  incomplete: { reason: "max_output_tokens" | "content_filter" } | null;
}

/** 截断与被过滤都是 incomplete，原因写在 incomplete_details 里。 */
function endingOf(stop: StopReason): Ending {
  if (stop === "length")
    return { status: "incomplete", incomplete: { reason: "max_output_tokens" } };
  if (stop === "filter") return { status: "incomplete", incomplete: { reason: "content_filter" } };
  return { status: "completed", incomplete: null };
}

interface ResponseShell {
  id: string;
  createdAt: number;
  status: ResponseStatus;
  model: string;
  output: unknown[];
}

/** 流里的 response 与整份回复共用的外壳。output 在出现任何项之前也是空数组：Muse Code 不收 null。 */
function responseShell(shell: ResponseShell): Record<string, unknown> {
  return {
    id: shell.id,
    object: "response",
    created_at: shell.createdAt,
    status: shell.status,
    model: shell.model,
    output: shell.output,
    parallel_tool_calls: true,
    tool_choice: "auto",
    tools: [],
  };
}

/**
 * Responses 流 → 中间事件。调用的参数等它完成时再交出：delta 可能少了完成的调用里有的东西
 * （magpie #613：Codex 的 spawn_agent 收到 {}），发出去的参数又收不回来。
 * 推理只读摘要与推理文字；封存的推理（encrypted_content）只给 Responses 客户端，这里不读。
 */
export class ResponsesDecoder {
  private started = false;
  // 流里出现过调用：ChatGPT 后端 completed 时的 output 是空的。
  private called = false;
  private calling = false;
  private args = "";
  // 开着的调用在完成事件里给的参数。
  private full = "";

  decode(data: string, emit: EmitEvent): void {
    const event = parseJson(data);
    if (isRecord(event)) this.event(event, emit);
  }

  /** 整份回复（不流式）：照它流出来时的事件读一遍。错误体照一个事件读。 */
  whole(body: unknown, emit: EmitEvent): void {
    if (!isRecord(body)) return;
    if (!Array.isArray(body.output)) {
      this.event(body, emit);
      return;
    }
    this.event({ type: "response.created", response: body }, emit);
    for (const item of body.output.filter(isRecord)) {
      this.event({ type: "response.output_item.added", item }, emit);
      for (const delta of itemDeltas(item)) this.event(delta, emit);
      this.event({ type: "response.output_item.done", item }, emit);
    }
    // 完成、截断还是失败，finished 按 status 认。
    this.event({ type: "response.completed", response: body }, emit);
  }

  private event(event: Record<string, unknown>, emit: EmitEvent): void {
    const item = isRecord(event.item) ? event.item : {};
    const response = isRecord(event.response) ? event.response : {};
    switch (event.type) {
      case "response.created":
        if (!this.started) {
          this.started = true;
          emit({
            kind: "start",
            id: stringOf(response.id),
            usage: usageFromResponses(response.usage),
          });
        }
        return;
      case "response.output_item.added":
        this.itemAdded(item, emit);
        return;
      case "response.output_text.delta":
        this.endCall(emit);
        emit({ kind: "text", text: stringOf(event.delta) });
        return;
      case "response.reasoning_summary_text.delta":
      case "response.reasoning_text.delta":
        this.endCall(emit);
        emit({ kind: "think", text: stringOf(event.delta) });
        return;
      case "response.function_call_arguments.delta":
      case "response.function_call_arguments.done":
        this.callArguments(event, emit);
        return;
      case "response.output_item.done":
        this.itemDone(item, emit);
        return;
      case "response.completed":
      case "response.incomplete":
      case "response.failed":
        this.endCall(emit);
        this.finished({ type: event.type, response, emit });
        return;
      default:
        // error 事件，或别的形状里带着的错误：照样是回复的结束（magpie #1933）。
        if (event.type === "error" || carries(event.error)) {
          this.endCall(emit);
          emit({ kind: "error", ...errorOf(event.error, event.message) });
        }
    }
  }

  private itemAdded(item: Record<string, unknown>, emit: EmitEvent): void {
    this.endCall(emit);
    const type = stringOf(item.type);
    if (type === "function_call") {
      this.called = true;
      this.calling = true;
      emit({ kind: "tool_start", id: stringOf(item.call_id), name: stringOf(item.name) });
    } else if (type === "reasoning") {
      emit({ kind: "think_start" });
    } else if (callsTool(type)) {
      // Codex 自己的调用（apply_patch 之类）也等客户端去调；服务端工具不用。
      if (CALL_TYPES.has(type)) this.called = true;
      emit({ kind: "other_tool" });
    }
  }

  private callArguments(event: Record<string, unknown>, emit: EmitEvent): void {
    if (event.type === "response.function_call_arguments.done") {
      if (this.calling && stringOf(event.arguments) !== "") this.full = stringOf(event.arguments);
    } else if (this.calling) {
      this.args += stringOf(event.delta);
    } else {
      emit({ kind: "tool_args", text: stringOf(event.delta) });
    }
  }

  private itemDone(item: Record<string, unknown>, emit: EmitEvent): void {
    if (item.type !== "function_call") return;
    if (stringOf(item.arguments) !== "") this.full = stringOf(item.arguments);
    this.endCall(emit);
  }

  private finished(input: {
    type: string;
    response: Record<string, unknown>;
    emit: EmitEvent;
  }): void {
    const { response, emit } = input;
    const failed =
      carries(response.error) || input.type === "response.failed" || response.status === "failed";
    if (failed) {
      emit({ kind: "error", ...errorOf(response.error, undefined) });
      return;
    }
    let stop: StopReason = "stop";
    if (response.status === "incomplete") {
      const details = isRecord(response.incomplete_details) ? response.incomplete_details : {};
      stop = details.reason === "content_filter" ? "filter" : "length";
    } else if (this.called || listsCall(response.output)) {
      stop = "tool";
    }
    emit({ kind: "stop", stop });
    emit({ kind: "usage", usage: usageFromResponses(response.usage) });
    emit({ kind: "done" });
  }

  private endCall(emit: EmitEvent): void {
    if (!this.calling) return;
    this.calling = false;
    const args = pickArgs(this.args, this.full);
    this.args = "";
    this.full = "";
    if (args !== "") emit({ kind: "tool_args", text: args });
  }
}

function listsCall(output: unknown): boolean {
  return Array.isArray(output) && output.some((item) => CALL_TYPES.has(typeOf(item)));
}

/** 整份回复里一项说的话，写成流里的 delta 事件：消息的文字，推理的摘要与文字。 */
function itemDeltas(item: Record<string, unknown>): Record<string, unknown>[] {
  const parts = (key: string) => {
    const value = item[key];
    return Array.isArray(value) ? value.filter(isRecord) : [];
  };
  if (item.type === "message") {
    return parts("content")
      .filter((part) => part.type === "output_text")
      .map((part) => ({ type: "response.output_text.delta", delta: part.text }));
  }
  if (item.type !== "reasoning") return [];
  const summaries = parts("summary").map((part) => ({
    type: "response.reasoning_summary_text.delta",
    delta: part.text,
  }));
  const texts = parts("content").map((part) => ({
    type: "response.reasoning_text.delta",
    delta: part.text,
  }));
  return [...summaries, ...texts];
}

/** 流出来的参数与完成事件给的参数里更全的一个，JSON 优先。 */
function pickArgs(streamed: string, done: string): string {
  const streamedArgs = streamed.trim();
  const doneArgs = done.trim();
  const streamedIsJson = parseJson(streamedArgs) !== undefined;
  const doneIsJson = parseJson(doneArgs) !== undefined;
  if (doneIsJson && (!streamedIsJson || doneArgs.length > streamedArgs.length)) return done;
  if (streamedIsJson || doneArgs === "") return streamed;
  return done;
}

function carries(value: unknown): boolean {
  return value !== undefined && value !== null;
}

type StreamError = Pick<Extract<StreamEvent, { kind: "error" }>, "message" | "code">;

/** 错误的话：对象的 message 或 type，或字符串；都没有也算一次错误。 */
function errorOf(error: unknown, message: unknown): StreamError {
  if (typeof error === "string" && error.trim() !== "")
    return { message: error.trim(), code: null };
  const record = isRecord(error) ? error : {};
  const said =
    stringOf(record.message).trim() ||
    stringOf(message).trim() ||
    stringOf(record.type) ||
    "the upstream reported an error";
  return { message: said, code: stringOf(record.code) || null };
}

// 调用项 id 的前缀：OpenAI 不收类型对不上的（"Expected an ID that begins with 'ctc'"），Codex 会把它发回去。
const ITEM_PREFIX: Record<string, string> = { custom_tool_call: "ctc_" };

function itemPrefix(item: Record<string, unknown>): string {
  return ITEM_PREFIX[stringOf(item.type)] ?? "fc_";
}

/**
 * 调用项按 Codex 认的样子写：命名空间工具写回它的名字与命名空间、注明参数没封（MultiAgentV2 否则把
 * spawn_agent 的 message 当密文）；自由文本工具写成 custom_tool_call，带的是 input 文本。
 */
function callTo(input: {
  item: Record<string, unknown>;
  name: string;
  named: Record<string, NamedTool>;
}): Record<string, unknown> {
  const { item, name } = input;
  const tool = input.named[name];
  if (!tool) return { ...item, name };
  if (!tool.custom) {
    return { ...item, name: tool.name, namespace: tool.namespace, encrypted_function_args: [] };
  }
  const { arguments: args, ...rest } = item;
  const text = stringOf(args);
  return {
    ...rest,
    type: "custom_tool_call",
    name: tool.name,
    input: text === "" ? "" : customInput(text),
    ...(tool.namespace === "" ? {} : { namespace: tool.namespace }),
  };
}

type OpenItem = "text" | "thinking" | "tool_call" | null;

/** 中间事件 → Responses 流。Codex 从 output_item.done 读整项，从 response.completed 读用量。 */
export class ResponsesEncoder {
  private readonly collector = new ReplyCollector();
  private readonly created = Math.floor(Date.now() / 1000);
  private readonly output: unknown[] = [];
  private id = "";
  private sequence = 0;
  private started = false;
  // 开着的那一项在 output 里的下标。
  private outputIndex = -1;
  private open: OpenItem = null;
  private itemId = "";
  private text = "";
  // 上游开始了新的一段推理：下一段推理自成一项。
  private thinkNew = false;
  private call = { id: "", name: "" };

  constructor(
    private readonly input: {
      model: string;
      write: (text: string) => void;
      request: GatewayRequest;
    },
  ) {}

  event(event: StreamEvent): void {
    if (event.kind === "start") this.start(event.id);
    else this.start("");
    switch (event.kind) {
      case "text":
        if (event.text === "") return;
        if (this.open !== "text") {
          this.openItem({
            kind: "text",
            prefix: "msg_",
            item: { type: "message", role: "assistant", content: [] },
          });
          this.send("response.content_part.added", {
            ...this.at(),
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [], logprobs: [] },
          });
        }
        this.text += event.text;
        this.send("response.output_text.delta", {
          ...this.at(),
          content_index: 0,
          delta: event.text,
          logprobs: [],
        });
        break;
      case "think":
        if (event.text === "") return;
        if (this.open !== "thinking" || this.thinkNew) {
          this.openItem({
            kind: "thinking",
            prefix: "rs_",
            item: { type: "reasoning", summary: [] },
          });
          this.send("response.reasoning_summary_part.added", {
            ...this.at(),
            summary_index: 0,
            part: { type: "summary_text", text: "" },
          });
        }
        this.text += event.text;
        this.send("response.reasoning_summary_text.delta", {
          ...this.at(),
          summary_index: 0,
          delta: event.text,
        });
        break;
      case "think_start":
        this.thinkNew = true;
        break;
      case "tool_start": {
        const id = callIdOr(event.id);
        const item = callTo({
          item: { type: "function_call", call_id: id, arguments: "" },
          name: event.name,
          named: this.input.request.named,
        });
        // 先开新项（关上一项时要读上一个调用的 id 与名字），再记下这个调用。
        this.openItem({ kind: "tool_call", prefix: itemPrefix(item), item });
        this.call = { id, name: event.name };
        break;
      }
      case "tool_args":
        if (this.open !== "tool_call" || event.text === "") break;
        this.text += event.text;
        // 自由文本工具的 input 要等参数齐了才完整：随整项给出。
        if (!this.callIsCustom()) {
          this.send("response.function_call_arguments.delta", { ...this.at(), delta: event.text });
        }
        break;
      case "error":
        this.closeItem();
        this.send("response.failed", {
          response: this.response("failed", {
            error: { code: event.code ?? "server_error", message: event.message },
          }),
        });
        break;
      default:
    }
    this.collector.add(event);
  }

  finish(): void {
    this.start("");
    this.closeItem();
    const reply = this.collector.finish();
    const { status, incomplete } = endingOf(reply.stop);
    this.send(status === "completed" ? "response.completed" : "response.incomplete", {
      response: this.response(status, {
        usage: usageToResponses(reply.usage),
        incomplete_details: incomplete,
      }),
    });
  }

  usage(): Usage {
    return this.collector.usage();
  }

  private start(id: string): void {
    if (this.started) return;
    this.started = true;
    this.id = responseId(id);
    this.send("response.created", { response: this.response("in_progress", {}) });
    this.send("response.in_progress", { response: this.response("in_progress", {}) });
  }

  private at(): Record<string, unknown> {
    return { item_id: this.itemId, output_index: this.outputIndex };
  }

  private openItem(input: {
    kind: Exclude<OpenItem, null>;
    prefix: string;
    item: Record<string, unknown>;
  }): void {
    this.closeItem();
    this.outputIndex++;
    this.open = input.kind;
    this.itemId = input.prefix + newId();
    this.thinkNew = false;
    this.send("response.output_item.added", {
      output_index: this.outputIndex,
      item: { ...input.item, id: this.itemId, status: "in_progress" },
    });
  }

  private closeItem(): void {
    if (this.open === null) return;
    let item: Record<string, unknown>;
    if (this.open === "text") {
      const part = { type: "output_text", text: this.text, annotations: [], logprobs: [] };
      this.send("response.output_text.done", {
        ...this.at(),
        content_index: 0,
        text: this.text,
        logprobs: [],
      });
      this.send("response.content_part.done", { ...this.at(), content_index: 0, part });
      item = {
        id: this.itemId,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [part],
      };
    } else if (this.open === "thinking") {
      const part = { type: "summary_text", text: this.text };
      this.send("response.reasoning_summary_text.done", {
        ...this.at(),
        summary_index: 0,
        text: this.text,
      });
      this.send("response.reasoning_summary_part.done", { ...this.at(), summary_index: 0, part });
      item = { id: this.itemId, type: "reasoning", status: "completed", summary: [part] };
    } else {
      item = this.closeCall();
    }
    this.send("response.output_item.done", { output_index: this.outputIndex, item });
    this.output.push(item);
    this.open = null;
    this.text = "";
  }

  private closeCall(): Record<string, unknown> {
    const args = this.text.trim() === "" ? "{}" : this.text.trim();
    const { named } = this.input.request;
    const { id, name } = this.call;
    if (!this.callIsCustom()) {
      this.send(
        "response.function_call_arguments.done",
        callTo({ item: { ...this.at(), call_id: id, arguments: args }, name, named }),
      );
    }
    return callTo({
      item: {
        id: this.itemId,
        type: "function_call",
        status: "completed",
        call_id: id,
        arguments: args,
      },
      name,
      named,
    });
  }

  private callIsCustom(): boolean {
    return this.input.request.named[this.call.name]?.custom === true;
  }

  private response(
    status: ResponseStatus,
    extra: Record<string, unknown>,
  ): Record<string, unknown> {
    const shell = { id: this.id, createdAt: this.created, status, model: this.input.model };
    return { ...responseShell({ ...shell, output: this.output }), ...extra };
  }

  private send(type: string, fields: Record<string, unknown>): void {
    const data = { type, sequence_number: this.sequence++, ...fields };
    this.input.write(sseEvent(type, data));
  }
}

function responseId(id: string): string {
  const base = id === "" ? newId() : id;
  return base.startsWith("resp_") ? base : `resp_${base}`;
}

/** 不要流式的 Codex 拿到的整份回复。别家的签名思考只给摘要文字，签名不给。 */
export function renderResponses(
  reply: Reply,
  output: { model: string; request: GatewayRequest },
): Record<string, unknown> {
  const items = reply.parts.flatMap((part): Record<string, unknown>[] => {
    switch (part.kind) {
      case "text":
        return [
          {
            id: `msg_${newId()}`,
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: part.text, annotations: [] }],
          },
        ];
      case "thinking":
        return part.text === ""
          ? []
          : [
              {
                id: `rs_${newId()}`,
                type: "reasoning",
                status: "completed",
                summary: [{ type: "summary_text", text: part.text }],
              },
            ];
      case "tool_call": {
        const item = callTo({
          item: {
            type: "function_call",
            status: "completed",
            call_id: callIdOr(part.id),
            arguments: argsOf(part),
          },
          name: part.name,
          named: output.request.named,
        });
        return [{ id: itemPrefix(item) + newId(), ...item }];
      }
      default:
        return [];
    }
  });
  const { status, incomplete } = endingOf(reply.stop);
  const shell = responseShell({
    id: responseId(reply.id),
    createdAt: Math.floor(Date.now() / 1000),
    status,
    model: output.model,
    output: items,
  });
  return {
    ...shell,
    usage: usageToResponses(reply.usage),
    incomplete_details: incomplete,
    error: null,
  };
}

/** 上游没给调用 id 的编一个。 */
function callIdOr(id: string): string {
  return id === "" ? `call_${newId()}` : id;
}
