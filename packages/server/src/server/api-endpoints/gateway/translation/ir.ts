// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gateway/ir.go、wire_effort.go 的 thinkingBackOn、fallback.go 的 streamPart.said，
// decide.go 的 fitFor、internal/catalog/catalog.go 的 EffortRank 与 NearestEffort、maxoutput.go 的 askedOutput、internal/provider/models.go 的 OutputWithin）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { randomBytes } from "node:crypto";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { ModelFacts } from "../../model-facts.js";
import { isRecord, parseJson } from "../../upstream-http.js";

/*
 * 三种协议共用的中间格式：请求先读成它，回复由它写出。只在中转站里用，不进 packages/protocol。
 * 思考只带本轮文字与 Anthropic 签名；联网搜索不代搜，服务端工具在解析时剔除。
 */

export interface TextPart {
  kind: "text";
  text: string;
}

export interface ThinkingPart {
  kind: "thinking";
  text: string;
  // Anthropic 的签名；只回给 Anthropic。
  signature: string;
}

export interface ToolCallPart {
  kind: "tool_call";
  id: string;
  name: string;
  // 参数的 JSON 对象原文。
  args: string;
}

export interface ToolResultPart {
  kind: "tool_result";
  callId: string;
  text: string;
  isError: boolean;
  // 工具随文字一起返回的图片。
  images: ImagePart[];
}

/** 内嵌（base64）或按地址给的图片；地址原样转发，不下载。 */
export interface ImagePart {
  kind: "image";
  mediaType: string;
  data: string;
  url: string;
}

/** Chat 客户端的文件附件：别的协议装不下，发出时换成一句占位文字。 */
export interface FilePart {
  kind: "file";
  mediaType: string;
  data: string;
  // 只给了 OpenAI 文件 id 时是那个 id。
  url: string;
}

export type Part = TextPart | ThinkingPart | ToolCallPart | ToolResultPart | ImagePart | FilePart;

export interface Message {
  role: "user" | "assistant";
  parts: Part[];
}

export interface Tool {
  name: string;
  description: string;
  // 参数的 JSON schema；客户端没给时为 null。
  schema: unknown;
  // 客户端要求参数严格照 schema。
  strict: boolean;
}

/**
 * Codex 的命名空间工具与自由文本（custom）工具：给模型时按扁平名、当作函数，
 * 模型的调用写回 Codex 时按这里还原成它认得的调用。
 */
export interface NamedTool {
  namespace: string;
  name: string;
  custom: boolean;
}

/** 空为没说；`name:<工具名>` 为点名某个工具。 */
export type ToolChoice = "" | "auto" | "none" | "required" | `name:${string}`;

/** minimal、ultra 只来自按模型资料适配（requestForModel），读请求时归到 low、max。 */
export type Effort = "" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

/** 客户端要的回答形状（结构化输出）：按 schema 的 JSON，或任意 JSON 对象。 */
export type Format = { type: "json_object" } | SchemaFormat;

export interface SchemaFormat {
  type: "json_schema";
  // OpenAI 系要名字；客户端的协议没有名字时用 "response"。
  name: string;
  description: string;
  schema: unknown;
  // 客户端没说为 null。
  strict: boolean | null;
}

export interface GatewayRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: Tool[];
  toolChoice: ToolChoice;
  // 0 为客户端没给。
  maxTokens: number;
  temperature: number | null;
  topP: number | null;
  stop: string[];
  stream: boolean;
  // 客户端明确要的推理力度。
  effort: Effort;
  // 客户端要看推理。
  thinking: boolean;
  // 客户端关掉推理：Anthropic 的 thinking disabled，或 OpenAI 的 effort none。
  thinkOff: boolean;
  // 允许并行调用工具；null 为没说。
  parallel: boolean | null;
  // Anthropic 客户端的 metadata（Claude Code 的 user_id），只转给 Anthropic 上游。
  metadata: unknown;
  // 客户端的 prompt_cache_key（Codex 发它这段对话的 id）：OpenAI 与前面的中转服务按它把对话送到缓存所在处。
  // 转给 Chat 与 Responses 上游；空为没给。
  cacheKey: string;
  // Responses 客户端的 include（要上游另外给的输出，如 Codex 的 reasoning.encrypted_content），只转给 Responses 上游。
  include: string[];
  // Responses 客户端的 client_metadata（Codex 的安装与会话 id，中转服务可能查），只转给 Responses 上游；null 为没给。
  clientMetadata: unknown;
  // Responses 客户端的 text 去掉 format（Codex 的 verbosity），只转给 Responses 上游；null 为没给。
  text: Record<string, unknown> | null;
  // 结构化输出；null 为普通文字。
  format: Format | null;
  // 按扁平名索引的 Codex 命名空间工具与自由文本工具；别的协议的客户端没有。
  named: Record<string, NamedTool>;
}

export type StopReason = "stop" | "length" | "tool" | "filter";

/** Anthropic 口径：input 不含缓存读写，OpenAI 的 prompt 含。 */
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  // cacheWrite 中写进 1 小时缓存的部分。
  cacheWrite1h: number;
  reasoning: number;
}

export type StreamEvent =
  | { kind: "start"; id: string; usage: Usage }
  | { kind: "text"; text: string }
  // 新的一段推理开始：之后的推理不接在前一段上。
  | { kind: "think_start" }
  | { kind: "think"; text: string }
  | { kind: "sig"; text: string }
  | { kind: "tool_start"; id: string; name: string }
  // 参数 JSON 的一段。
  | { kind: "tool_args"; text: string }
  // 中间格式不带的工具项（服务端工具、Codex 自己的 apply_patch 之类）：只说明回复里有它，编码器不写出。
  | { kind: "other_tool" }
  | { kind: "stop"; stop: StopReason }
  | { kind: "usage"; usage: Usage }
  // 上游发了结束标记：Anthropic 的 message_stop、Chat 的 [DONE]、Responses 的 completed 或 incomplete。
  | { kind: "done" }
  | { kind: "error"; message: string; code: string | null; vendorError: VendorError | null };

/**
 * 厂商说是请求本身有问题（错误对象的 type 是 invalid_request_error）时它自己的错误：转给 Agent 时带上它的
 * type、code、param，状态读成 400，重问也一样被拒（magpie 的 requestRefused、saidError）。只按 type 认，不看措辞。
 */
export interface VendorError {
  type: string;
  code: string | null;
  param: string | null;
}

/** 错误对象是不是厂商说请求本身有问题。 */
export function vendorErrorOf(error: unknown): VendorError | null {
  if (!isRecord(error) || error.type !== "invalid_request_error") return null;
  const code = stringOf(error.code) || null;
  const param = stringOf(error.param) || null;
  return { type: error.type, code, param };
}

/** 写给 Agent 的错误对象上要带的厂商字段：有值的 type、code、param。 */
export function vendorErrorFields(vendorError: VendorError | null): Record<string, string> {
  if (vendorError === null) return {};
  const fields: Record<string, string> = { type: vendorError.type };
  if (vendorError.code !== null) fields.code = vendorError.code;
  if (vendorError.param !== null) fields.param = vendorError.param;
  return fields;
}

export type EmitEvent = (event: StreamEvent) => void;

/** 解码出的事件流上的一道修补：按需扣着、改了再交给下一道；流结束时交出还扣着的。 */
export interface ReplyFilter {
  event(event: StreamEvent): void;
  end(): void;
}

/** 什么都不改的一道：直接交给下一道。 */
export function passingFilter(emit: EmitEvent): ReplyFilter {
  return { event: emit, end: () => {} };
}

/** 非流式客户端拿到的整份回复。 */
export interface Reply {
  id: string;
  parts: Part[];
  stop: StopReason;
  usage: Usage;
}

/** 请求体读不懂：中转站回 400。 */
export class RequestShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestShapeError";
  }
}

export const INTERRUPTED_TOOL =
  "[The result of this tool call is unavailable: the turn was interrupted.]";
export const TOOL_RESULT_RECEIVED = "Tool result received.";

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 };
}

/** 后来的非零数覆盖先前的：流里先报输入、结尾再报输出。 */
export function addUsage(into: Usage, from: Usage): void {
  for (const key of Object.keys(into) as (keyof Usage)[]) {
    if (from[key] > 0) into[key] = from[key];
  }
}

/** OpenAI 口径的整个 prompt：Anthropic 的 input 加上缓存读写。 */
export function promptTokens(usage: Usage): number {
  return usage.input + usage.cacheRead + usage.cacheWrite;
}

/** 回复与工具调用的 id：时间加随机数，同一毫秒内也不重复。 */
export function newId(): string {
  return `${Date.now().toString(16)}${randomBytes(4).toString("hex")}`;
}

/** 参数原文是 JSON 对象就原样留下；不是 JSON 的包成 {"input": 原文}，什么都不丢。 */
export function parseArgs(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return "{}";
  if (trimmed.startsWith("{") && parseJson(trimmed) !== undefined) return trimmed;
  return JSON.stringify({ input: trimmed });
}

export function argsOf(part: ToolCallPart): string {
  return part.args.trim() === "" ? "{}" : part.args;
}

/** data: 地址读成内嵌图片，别的地址原样留着。 */
export function imagePart(url: string): ImagePart {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    if (comma !== -1) {
      const meta = url.slice(5, comma);
      return {
        kind: "image",
        mediaType: meta.replace(/;base64$/, ""),
        data: url.slice(comma + 1),
        url: "",
      };
    }
  }
  return { kind: "image", mediaType: "", data: "", url };
}

/** 图片写成 OpenAI 的 image_url：按地址的原样，内嵌的拼成 data: 地址。 */
export function dataUrl(part: ImagePart | FilePart): string {
  if (part.url !== "" && part.data === "") return part.url;
  return `data:${part.mediaType};base64,${part.data}`;
}

/** 协议装不下的附件说一句它在：内嵌的没有地址可给。 */
export function attachmentText(part: FilePart): string {
  return part.url === ""
    ? `[attachment ${part.mediaType}]`
    : `[attachment ${part.mediaType}: ${part.url}]`;
}

/** JSON 里的字符串字段；不是字符串的算空。 */
export function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Anthropic image 块的 source：base64 带 media_type，或按地址。 */
export function sourceImage(source: Record<string, unknown>): ImagePart {
  return {
    kind: "image",
    mediaType: stringOf(source.media_type),
    data: stringOf(source.data),
    url: stringOf(source.url),
  };
}

export interface ToolOutput {
  text: string;
  images: ImagePart[];
}

/**
 * 工具结果的文字与其中的图片：Anthropic tool_result 里的 image 块，Chat tool 消息里的 image_url 段。
 * Anthropic 的 document 块不读，丢掉。
 */
export function toolOutput(value: unknown): ToolOutput {
  const text = stringOrText(value);
  if (!Array.isArray(value)) return { text, images: [] };
  const images = value.flatMap((block): ImagePart[] => {
    if (!isRecord(block)) return [];
    if (block.type === "image" && isRecord(block.source)) {
      const image = sourceImage(block.source);
      return image.data === "" && image.url === "" ? [] : [image];
    }
    if (block.type === "image_url" || block.type === "input_image") {
      // 字符串，或 {url}。
      const url = stringOf(isRecord(block.image_url) ? block.image_url.url : block.image_url);
      return url === "" ? [] : [imagePart(url)];
    }
    return [];
  });
  return { text, images };
}

export function textOf(parts: Part[]): string {
  return parts.map((part) => (part.kind === "text" ? part.text : "")).join("");
}

/** 告诉模型 ToolSearch 加载的这个工具已经能用了（tool_reference 不能原样发时）。 */
export function toolLoadedText(name: string): string {
  return `Tool ${name} is loaded and can be called now.`;
}

/**
 * 字符串，或 {type:"text"} 块的数组（Anthropic 的 system、工具结果……），读成一段文字。
 * Claude Code 的 tool_reference（ToolSearch 加载延后的工具）告诉模型工具已经能用了。
 */
export function stringOrText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  let out = "";
  for (const block of value) {
    if (!isRecord(block)) continue;
    const type = block.type;
    if (
      (type === "text" || type === "input_text" || type === "output_text") &&
      typeof block.text === "string"
    ) {
      out += block.text;
    } else if (type === "tool_reference") {
      if (out !== "") out += "\n";
      out += toolLoadedText(String(block.tool_name));
    }
  }
  return out;
}

/**
 * 接在调用了工具的 assistant 消息后面的 assistant 消息并进去：Agent 可能把一轮的并行调用拆成两条，
 * 由一条 user 消息一起回答（magpie #1275）。
 */
export function joinSplitCalls(messages: Message[]): Message[] {
  const out: Message[] = [];
  for (const message of messages) {
    const previous = out.at(-1);
    if (
      previous &&
      message.role === "assistant" &&
      previous.role === "assistant" &&
      previous.parts.some((part) => part.kind === "tool_call")
    ) {
      previous.parts = [...previous.parts, ...message.parts];
      continue;
    }
    out.push({ role: message.role, parts: [...message.parts] });
  }
  return out;
}

/** 回复里这一类块或项是工具：调用、工具结果、服务端工具（magpie 的 streamPart.said）。 */
export function callsTool(type: string): boolean {
  return type.includes("call") || type.includes("tool") || type.startsWith("mcp_");
}

/** 给要求回放推理、这一轮却没有推理的上游的推理：一个空格。 */
export const NO_REASONING = " ";

/**
 * 上游要把每轮的推理发回去：DeepSeek 的模型，按模型名认（不看域名）。思考模式下工具调用那一轮
 * 没有推理，它整个请求都拒（"The reasoning_content in the thinking mode must be passed back"）。
 */
export function replaysThinking(model: string): boolean {
  return model.toLowerCase().includes("deepseek");
}

export const FORMAT_NAME = "response";

/**
 * OpenAI 的回答形状：Responses 的 text.format（{type, name, schema, strict, description}）
 * 或 Chat 的 response_format（{type, json_schema: {…}}）。type text 是默认，读成 null。
 */
export function openAIFormat(value: unknown): Format | null {
  if (!isRecord(value)) return null;
  if (value.type === "json_object") return { type: "json_object" };
  if (value.type !== "json_schema") return null;
  const spec = isRecord(value.json_schema) ? value.json_schema : value;
  // 没有形状的 schema 就是任意 JSON 对象。
  if (spec.schema === undefined || spec.schema === null) return { type: "json_object" };
  return {
    type: "json_schema",
    name: stringOf(spec.name) || FORMAT_NAME,
    description: stringOf(spec.description),
    schema: spec.schema,
    strict: typeof spec.strict === "boolean" ? spec.strict : null,
  };
}

/** 回答形状用话说出来：给接口问不了这种形状的模型（Anthropic 只收带 schema 的）。 */
export function formatInstruction(format: Format): string {
  return format.type === "json_schema"
    ? `Respond with a single JSON value and nothing else, matching this JSON schema:\n${JSON.stringify(format.schema)}.`
    : "Respond with a single JSON object and nothing else.";
}

/** 系统提示末尾另起一段说上这句；没有系统提示时就是这句。 */
export function withLine(system: string, line: string): string {
  return system === "" ? line : `${system}\n\n${line}`;
}

/** 各协议的推理力度名字统一成这几档。 */
export function effortOf(value: unknown): Effort {
  const effort = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (effort === "minimal" || effort === "none") return "low";
  if (effort === "ultra") return "max";
  return effort === "low" ||
    effort === "medium" ||
    effort === "high" ||
    effort === "xhigh" ||
    effort === "max"
    ? effort
    : "";
}

/**
 * OpenAI 格式的推理力度；档位已由 requestForModel 按模型适配。
 * 客户端用 OpenAI 的 effort none 关推理（effortOf 读成 low，Anthropic 的 disabled 不带力度）时照原样发 none；
 * 上游不收再由中转站用 thinkingBackOn 重发。
 */
export function openAIEffort(request: GatewayRequest): string | null {
  if (request.thinkOff && request.effort !== "") return "none";
  return request.effort === "" ? null : request.effort;
}

/** 各家说的推理档位，从弱到强（magpie EffortRank）。 */
const EFFORT_RANK: readonly (Effort | "none")[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

/**
 * 模型自己的档位里离要的最近的一档，一样近取高的，不挑 none（magpie NearestEffort）。
 * 档位不知道、本来就有要的这档、或要的不是认得的档位时照要的。
 */
export function nearestEffort(want: Effort, levels: string[]): Effort {
  const at = EFFORT_RANK.indexOf(want);
  const keepsWant = levels.length === 0 || at < 0 || levels.includes(want);
  if (keepsWant) return want;
  let best = want;
  let distance = EFFORT_RANK.length;
  for (const level of levels) {
    const index = EFFORT_RANK.findIndex((rung) => rung === level);
    const rung = EFFORT_RANK[index];
    if (rung === undefined || rung === "none") continue;
    const gap = Math.abs(index - at);
    const isCloser = gap < distance;
    const isTieUp = gap === distance && index > at;
    if (isCloser || isTieUp) {
      best = rung;
      distance = gap;
    }
  }
  return best;
}

/**
 * 按模型资料改翻译出的请求（magpie forwardTranslated 的 fitFor、askedOutput 与 build 的 rejectTemp）：
 * - 推理档位挑模型自己有的最近一档；知道它没有可挑的档位（资料里档位是空列表，magpie Levelless）时不超过 high，
 *   档位不知道的照要的发。
 * - Messages 必须给回复上限：请求没给时按模型公布的上限（不超过窗口）填，不知道才由构建用 16384。
 * - 已知不收 temperature、top_p 的模型发 Chat、Responses 时不带；Claude 走 Messages 另有 refusesSampling。
 */
export function requestForModel(input: {
  request: GatewayRequest;
  to: ApiEndpointRequestFormat;
  facts: ModelFacts;
}): GatewayRequest {
  const { request, facts } = input;
  const messages = input.to === "anthropic_messages";
  const levels = facts.efforts;
  const nearest = nearestEffort(request.effort, levels ?? []);
  const levelless = levels !== undefined && levels.length === 0;
  const aboveHigh = EFFORT_RANK.indexOf(nearest) > EFFORT_RANK.indexOf("high");
  const capsEffort = levelless && aboveHigh;
  const effort = capsEffort ? "high" : nearest;
  const fillsMaxTokens = messages && request.maxTokens <= 0;
  const maxTokens = fillsMaxTokens ? publishedOutput(facts) : request.maxTokens;
  const dropsSampling = !messages && facts.takesSampling === false;
  const temperature = dropsSampling ? null : request.temperature;
  const topP = dropsSampling ? null : request.topP;
  return { ...request, effort, maxTokens, temperature, topP };
}

/** 模型公布的回复上限，不超过它的窗口；不知道是 0（magpie OutputWithin）。 */
function publishedOutput(facts: ModelFacts): number {
  const output = facts.output ?? 0;
  const context = facts.context ?? 0;
  const pastWindow = context > 0 && output > context;
  return pastWindow ? context : output;
}

/** 上游不让关推理：打开推理、用最低档重问（magpie thinkingBackOn）。 */
export function thinkingBackOn(request: GatewayRequest): GatewayRequest {
  return { ...request, thinkOff: false, effort: request.effort === "" ? "low" : request.effort };
}

/** 力度换成 Anthropic 的思考预算。 */
export function budgetOf(effort: Effort): number {
  const budgets: Record<Effort, number> = {
    "": 10_000,
    // magpie budgetOf 不认的档位按 10000。
    minimal: 10_000,
    low: 4096,
    medium: 10_000,
    high: 24_000,
    xhigh: 32_000,
    max: 32_000,
    ultra: 10_000,
  };
  return budgets[effort];
}

/** Anthropic 的思考预算换成力度。 */
export function effortOfBudget(budget: number): Effort {
  if (budget <= 0) return "";
  if (budget <= 4096) return "low";
  if (budget <= 12_000) return "medium";
  if (budget <= 24_000) return "high";
  return "xhigh";
}

/** 不问上游时的 token 估算：系统提示、消息文字、工具调用与定义的字节数 / 4（magpie 的 estimate）。 */
export function estimateInputTokens(request: GatewayRequest): number {
  const bytes = (text: string) => Buffer.byteLength(text, "utf8");
  let total = bytes(request.system);
  for (const message of request.messages) {
    for (const part of message.parts) {
      if (part.kind === "tool_call") total += bytes(part.args) + bytes(part.name);
      else if (part.kind !== "image" && part.kind !== "file") total += bytes(part.text);
    }
  }
  for (const tool of request.tools) {
    total +=
      bytes(tool.name) + bytes(tool.description) + bytes(JSON.stringify(tool.schema ?? null));
  }
  return Math.floor(total / 4);
}

/** 把事件流攒成整份回复；编码器也靠它知道回复里有过什么。 */
export class ReplyCollector {
  private readonly reply: Reply = { id: "", parts: [], stop: "stop", usage: emptyUsage() };
  private args = "";
  // 收到 think_start：下一段推理自成一块。
  private fresh = false;
  error: Omit<Extract<StreamEvent, { kind: "error" }>, "kind"> | null = null;

  add(event: StreamEvent): void {
    switch (event.kind) {
      case "start":
        this.reply.id = event.id;
        addUsage(this.reply.usage, event.usage);
        return;
      case "usage":
        addUsage(this.reply.usage, event.usage);
        return;
      case "done":
      case "other_tool":
        return;
      case "error":
        this.error = { message: event.message, code: event.code, vendorError: event.vendorError };
        return;
      case "think_start":
        this.fresh = true;
        return;
      default:
        this.addContent(event);
        this.fresh = false;
    }
  }

  private addContent(event: StreamEvent): void {
    switch (event.kind) {
      case "text":
        this.addText(event.text);
        return;
      case "think":
        this.addThinking({ text: event.text, signature: "" });
        return;
      case "sig":
        this.addThinking({ text: "", signature: event.text });
        return;
      case "tool_start":
        this.closeTool();
        this.reply.parts.push({ kind: "tool_call", id: event.id, name: event.name, args: "" });
        return;
      case "tool_args":
        this.args += event.text;
        return;
      case "stop":
        this.closeTool();
        this.reply.stop = event.stop;
        return;
      default:
    }
  }

  private addText(text: string): void {
    const last = this.reply.parts.at(-1);
    if (last?.kind === "text") {
      last.text += text;
      return;
    }
    this.closeTool();
    this.reply.parts.push({ kind: "text", text });
  }

  /** 接在还开着的那段推理上；新一段开始了、或签了名没有文字的块（Claude 不显示思考时）自成一块。 */
  private addThinking(piece: { text: string; signature: string }): void {
    const last = this.reply.parts.at(-1);
    if (!this.fresh && last?.kind === "thinking") {
      last.text += piece.text;
      last.signature += piece.signature;
      return;
    }
    if (piece.signature !== "" && !this.fresh) return;
    this.closeTool();
    this.reply.parts.push({ kind: "thinking", ...piece });
  }

  private closeTool(): void {
    const last = this.reply.parts.at(-1);
    if (last?.kind === "tool_call" && last.args === "") {
      last.args = this.args.trim() === "" ? "{}" : this.args.trim();
      this.args = "";
    }
  }

  /** 上游没说结束原因或说 stop 却调用了工具（中转站的 end_turn 旁带 tool_use）：按调用工具结束。 */
  finish(): Reply {
    this.closeTool();
    if (this.reply.stop === "stop" && this.reply.parts.some((part) => part.kind === "tool_call")) {
      this.reply.stop = "tool";
    }
    return this.reply;
  }

  /** 回复里除了推理还说了什么：只想了一下就出错的不算回答。 */
  saidAnything(): boolean {
    return this.reply.parts.some((part) => part.kind !== "thinking");
  }

  usage(): Usage {
    return this.reply.usage;
  }
}
