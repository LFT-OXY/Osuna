// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gateway/ir.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { randomBytes } from "node:crypto";
import { isRecord, parseJson } from "../../upstream-http.js";

/*
 * 三种协议共用的中间格式：请求先读成它，回复由它写出。只在中转站里用，不进 packages/protocol。
 * 思考只带本轮文字与 Anthropic 签名；图片、附件、结构化输出、联网搜索在工单 06 补。
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
}

export type Part = TextPart | ThinkingPart | ToolCallPart | ToolResultPart;

export interface Message {
  role: "user" | "assistant";
  parts: Part[];
}

export interface Tool {
  name: string;
  description: string;
  // 参数的 JSON schema；客户端没给时为 null。
  schema: unknown;
}

/** 空为没说；`name:<工具名>` 为点名某个工具。 */
export type ToolChoice = "" | "auto" | "none" | "required" | `name:${string}`;

export type Effort = "" | "low" | "medium" | "high" | "xhigh" | "max";

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
  | { kind: "stop"; stop: StopReason }
  | { kind: "usage"; usage: Usage }
  | { kind: "error"; message: string; code: string | null };

export type EmitEvent = (event: StreamEvent) => void;

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

export function textOf(parts: Part[]): string {
  return parts.map((part) => (part.kind === "text" ? part.text : "")).join("");
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
      out += `Tool ${String(block.tool_name)} is loaded and can be called now.`;
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
      else total += bytes(part.text);
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
  error: { message: string; code: string | null } | null = null;

  add(event: StreamEvent): void {
    switch (event.kind) {
      case "start":
        this.reply.id = event.id;
        addUsage(this.reply.usage, event.usage);
        return;
      case "usage":
        addUsage(this.reply.usage, event.usage);
        return;
      case "error":
        this.error = { message: event.message, code: event.code };
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
