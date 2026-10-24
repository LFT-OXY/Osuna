// 结构化输出与预填的拒收移植自 magpie（https://github.com/yetone/magpie，internal/gateway/format.go 的 formatRefusal（含 Gemini 的 response_mime_type、response_json_schema）、refusesFormat、asObject、inSystem、formatInBody、withSystemLine、withLine，prefill.go 的 prefillRefusal、refusesPrefill、endsWithAssistant、userLast、userLastBody、continueText）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { isRecord } from "../upstream-http.js";
import { refusesContent } from "./refused-fields.js";
import { anthropicFormat } from "./translation/anthropic.js";
import {
  CONTINUE_TEXT,
  FORMAT_NAME,
  formatInstruction,
  openAIFormat,
  stringOf,
  withLine,
  type Format,
  type GatewayRequest,
} from "./translation/ir.js";

/*
 * 上游不收、要降级的写法：结构化输出与预填（以 assistant 结尾的对话）。结构化输出先降到 json_object、schema 写进 system，
 * 仍不收就只用文字说明；预填补一个 user 轮。这里只认上游原话、按记住的降级改请求；记在哪、什么时候重问归 refusals.ts。
 */

/**
 * jsonSchema：不收 json_schema（收 json_object）；structuredOutput：结构化输出的字段整个不收；
 * prefill：不收以 assistant 结尾的对话。
 */
export type DowngradedShape = "jsonSchema" | "structuredOutput" | "prefill";

/** 这家这个模型记着不收这种写法。 */
export type Downgraded = (shape: DowngradedShape) => boolean;

const DOWNGRADE_WORDS = {
  // 任何协议里结构化输出的字段名（DeepSeek 的「This response_format type is unavailable now」、小米 MiMo 的 json_schema，magpie #2126）。
  structuredOutput:
    /response_format|json_schema|json_object|output_config\.format|text\.format|structured.output|response_?mime_?type|response_?json_?schema|response_?schema/i,
  // OpenCode Go 的 Claude、火山方舟 Agent Plan、Vertex 上的 Gemini（magpie #1447）。
  prefill:
    /does not support (?:assistant message )?prefill|requests ending with a model turn are not supported/i,
} as const;

const W = DOWNGRADE_WORDS;

const OBJECT_FORMAT = { type: "json_object" };

type Body = Record<string, unknown>;

/** 发出去被拒的请求体与上游的回答。 */
export interface SentRefusal {
  format: ApiEndpointRequestFormat;
  body: unknown;
  status: number;
  text: string;
}

interface SentBody {
  format: ApiEndpointRequestFormat;
  body: Body;
}

/** 这次发出去的请求（`body`）被拒，是因为它要的结构化输出、还是它以 assistant 结尾。 */
export function refusedDowngrades(input: SentRefusal): DowngradedShape[] {
  const { format, body, text } = input;
  if (!refusesContent(input.status)) return [];
  if (!isRecord(body)) return [];
  const shapes: DowngradedShape[] = [];
  const asked = sentFormat({ format, body });
  if (asked !== null && W.structuredOutput.test(text)) {
    shapes.push(objectStepFits({ format, asked }) ? "jsonSchema" : "structuredOutput");
  }
  const prefillRefused = endsWithAssistant({ format, body }) && W.prefill.test(text);
  if (prefillRefused) shapes.push("prefill");
  return shapes;
}

/** 要的是 schema、又不是 Anthropic（它的 output_config.format 只收 schema）：还能先降到 json_object。 */
function objectStepFits(input: { format: ApiEndpointRequestFormat; asked: Format }): boolean {
  return input.asked.type === "json_schema" && input.format !== "anthropic_messages";
}

/**
 * 请求体要的结构化输出：Responses 的 text.format、Chat 的 response_format、Anthropic 的 output_config.format、
 * Gemini 的 generationConfig.responseMimeType 与 responseJsonSchema。
 */
function sentFormat(input: SentBody): Format | null {
  const { body } = input;
  if (input.format === "anthropic_messages") return anthropicFormat(body.output_config);
  if (input.format === "gemini") return geminiFormat(body.generationConfig);
  if (input.format === "openai_chat") return openAIFormat(body.response_format);
  return openAIFormat(isRecord(body.text) ? body.text.format : null);
}

function geminiFormat(config: unknown): Format | null {
  if (!isRecord(config) || config.responseMimeType !== "application/json") return null;
  const schema = config.responseJsonSchema;
  if (schema === undefined || schema === null) return { type: "json_object" };
  return { type: "json_schema", name: FORMAT_NAME, description: "", schema, strict: null };
}

function itemsOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function lastOf(items: unknown): unknown {
  return itemsOf(items).at(-1);
}

/** 对话以 assistant 自己的话结尾（不是它调用的工具）：这就是预填。 */
function endsWithAssistant(input: SentBody): boolean {
  const { body } = input;
  if (input.format === "openai_responses") return isAssistantItem(lastOf(body.input));
  const last = lastOf(body.messages);
  if (!isRecord(last) || last.role !== "assistant") return false;
  if (input.format === "openai_chat") return !hasItems(last.tool_calls);
  return !itemsOf(last.content).some((block) => isRecord(block) && block.type === "tool_use");
}

function isAssistantItem(item: unknown): boolean {
  if (!isRecord(item) || item.role !== "assistant") return false;
  return item.type === undefined || item.type === "message";
}

function hasItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

interface BodyDowngrade extends SentBody {
  refused: Downgraded;
}

/**
 * 直通的请求体按这家这个模型不收的写法降级；没有要改的就原样交回同一个对象。
 * 预填只对 Chat、Responses 补 user 轮：它们把末尾的 assistant 消息当作说完的一轮；Anthropic 客户端的预填是它自己要的，照原样发。
 */
export function withDowngrades(input: BodyDowngrade): Body {
  const { format, refused } = input;
  let body = input.body;
  if (refused("structuredOutput")) body = formatInBody({ format, body, asObject: false });
  else if (refused("jsonSchema")) body = formatInBody({ format, body, asObject: true });
  const turnAfter = refused("prefill") && format !== "anthropic_messages";
  if (turnAfter) body = withUserLast({ format, body });
  return body;
}

interface FormatTold extends SentBody {
  // 只把 schema 降到 json_object；否则整个结构化输出改用文字说明。
  asObject: boolean;
}

/** 请求体少要一步结构化输出，少要的写进 system。 */
function formatInBody(input: FormatTold): Body {
  const { format, body, asObject } = input;
  const asked = sentFormat({ format, body });
  if (asked === null) return body;
  if (asObject && !objectStepFits({ format, asked })) return body;
  const told = { body, line: formatInstruction(asked), asObject };
  if (format === "anthropic_messages") return anthropicToldFormat(told);
  if (format === "openai_chat") return chatToldFormat(told);
  return responsesToldFormat(told);
}

interface ToldLine {
  body: Body;
  line: string;
  asObject: boolean;
}

function withoutKey(record: Body, key: string): Body {
  const out = { ...record };
  delete out[key];
  return out;
}

function responsesToldFormat(input: ToldLine): Body {
  const { body } = input;
  const text = isRecord(body.text) ? body.text : {};
  const out: Body = { ...body, instructions: withLine(stringOf(body.instructions), input.line) };
  const rest = withoutKey(text, "format");
  if (input.asObject) out.text = { ...text, format: OBJECT_FORMAT };
  else if (Object.keys(rest).length > 0) out.text = rest;
  else delete out.text;
  return out;
}

function chatToldFormat(input: ToldLine): Body {
  const { body } = input;
  const messages = withSystemLine({ messages: body.messages, line: input.line });
  const out: Body = { ...body, messages };
  if (input.asObject) out.response_format = OBJECT_FORMAT;
  else delete out.response_format;
  return out;
}

/** Chat 的第一条 system（或 developer）消息末尾说上这句；没有就在最前面加一条。 */
function withSystemLine(input: { messages: unknown; line: string }): unknown[] {
  const { line } = input;
  const messages = itemsOf(input.messages);
  const at = messages.findIndex(saysSystem);
  if (at === -1) return [{ role: "system", content: line }, ...messages];
  const out = [...messages];
  const message = out[at];
  if (isRecord(message))
    out[at] = { ...message, content: contentWith({ content: message.content, line }) };
  return out;
}

/** 文字或文字块数组的末尾说上这句。 */
function contentWith(input: { content: unknown; line: string }): unknown {
  const { content, line } = input;
  if (Array.isArray(content)) return [...content, { type: "text", text: line }];
  return withLine(stringOf(content), line);
}

function saysSystem(message: unknown): boolean {
  if (!isRecord(message)) return false;
  const systemRole = message.role === "system" || message.role === "developer";
  const textual = typeof message.content === "string" || Array.isArray(message.content);
  return systemRole && textual;
}

/** Anthropic 只有带 schema 的一步：去掉 output_config.format，schema 写进 system。 */
function anthropicToldFormat(input: ToldLine): Body {
  const { body, line } = input;
  const sent = isRecord(body.output_config) ? body.output_config : {};
  const config = withoutKey(sent, "format");
  const out: Body = { ...body, system: contentWith({ content: body.system, line }) };
  if (Object.keys(config).length > 0) out.output_config = config;
  else delete out.output_config;
  return out;
}

/** 以 assistant 结尾的 Chat、Responses 对话后面补一个 user 轮。 */
function withUserLast(input: SentBody): Body {
  const { body } = input;
  if (!endsWithAssistant(input)) return body;
  if (input.format === "openai_chat") {
    const turn = { role: "user", content: CONTINUE_TEXT };
    return { ...body, messages: [...itemsOf(body.messages), turn] };
  }
  const content = [{ type: "input_text", text: CONTINUE_TEXT }];
  const turn = { type: "message", role: "user", content };
  return { ...body, input: [...itemsOf(body.input), turn] };
}

/** 翻译的请求按这家这个模型不收的写法降级。 */
export interface RequestDowngrade {
  request: GatewayRequest;
  to: ApiEndpointRequestFormat;
  refused: Downgraded;
  // Agent 自己的协议把末尾的 assistant 消息当作说完的一轮（Chat、Responses），不是要接着写的预填。
  lastIsTurn: boolean;
}

/** 翻译的请求降级：结构化输出少要一步、写进 system；Agent 当作说完一轮的预填后面补 user 轮。 */
export function downgradedRequest(input: RequestDowngrade): GatewayRequest {
  const { refused } = input;
  let request = input.request;
  const objectStep = refused("jsonSchema") && input.to !== "anthropic_messages";
  if (refused("structuredOutput")) request = formatInSystem(request);
  else if (objectStep) request = formatAsObject(request);
  const turnAfter = refused("prefill") && input.lastIsTurn;
  if (turnAfter && requestEndsWithAssistant(request)) request = userLast(request);
  return request;
}

function formatInSystem(request: GatewayRequest): GatewayRequest {
  const { format } = request;
  if (format === null) return request;
  return { ...request, format: null, system: withLine(request.system, formatInstruction(format)) };
}

function formatAsObject(request: GatewayRequest): GatewayRequest {
  const { format } = request;
  if (format?.type !== "json_schema") return request;
  const system = withLine(request.system, formatInstruction(format));
  return { ...request, format: { type: "json_object" }, system };
}

function requestEndsWithAssistant(request: GatewayRequest): boolean {
  const last = request.messages.at(-1);
  if (last?.role !== "assistant") return false;
  return !last.parts.some((part) => part.kind === "tool_call");
}

function userLast(request: GatewayRequest): GatewayRequest {
  const turn = { role: "user" as const, parts: [{ kind: "text" as const, text: CONTINUE_TEXT }] };
  return { ...request, messages: [...request.messages, turn] };
}
