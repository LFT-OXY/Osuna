// 按厂商的改写移植自 magpie（https://github.com/yetone/magpie，internal/gateway/kimi_schema.go 的 kimiToolEnumTypes、isKimi、valuesType，
// deepseek_schema.go 的 deepseekToolPatterns、unicodeNullEscape，grok_schema.go 的 grokToolPatterns、ecmaClassForRust，grok_integral.go 的 grokModel，
// chattidy.go 的 reasoningDetailsAsContent，chat.go buildChat 里 MiniMax 的 inlineThink，gateway.go forwardOnce 里 Kimi 的 withoutDeferredTools，
// responses.go buildResponses 里 xAI 不要 web_search_call.action.sources）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { hostOf } from "../model-facts.js";
import { isRecord } from "../upstream-http.js";
import { withoutRefusedFields } from "./refused-fields.js";
import { reasoningText } from "./translation/chat.js";
import { SEARCH_SOURCES } from "./translation/responses.js";
import type { GatewayRequest, Message } from "./translation/ir.js";

/*
 * 按厂商的改写只做四家，触发条件照 magpie。Kimi、MiniMax、DeepSeek 只认它们的官方地址：经中转服务用这几家的模型时
 * 不改，中转服务的拒收由拒收重问接住。Grok 按模型名认，不论谁提供（xAI 自己的地址也算）。
 * Osuna 没有 magpie 的「预设」，所以只按地址认。回复里 Grok 的整数改写在 grok-integral.ts。
 */

/** 按官方地址认出的厂商。 */
export type AddressVendor = "kimi" | "minimax" | "deepseek";

type Body = Record<string, unknown>;

/** 改一个 schema 节点自己（不管它下面的）；没改就原样交回同一个对象。 */
type SchemaFix = (schema: Body) => Body;

const KIMI_HOSTS = new Set(["api.moonshot.ai", "api.moonshot.cn", "api.kimi.com", "api.kimi.ai"]);
const MINIMAX_HOST_SUFFIXES = ["minimax.io", "minimaxi.com"];
const DEEPSEEK_HOST = "api.deepseek.com";
const XAI_HOST = "api.x.ai";

// schema 里装着一组子 schema（按名字）的键，与装着一个子 schema（或一列）的键（magpie collectPatterns）。
const SCHEMA_MAPS = new Set([
  "properties",
  "$defs",
  "definitions",
  "dependentSchemas",
  "patternProperties",
]);
const SCHEMA_KEYS = new Set([
  "items",
  "additionalProperties",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contentSchema",
]);

/** 接口地址是哪家的官方地址；都不是为 null。 */
export function addressVendor(baseUrl: string): AddressVendor | null {
  const host = hostOf(baseUrl);
  if (KIMI_HOSTS.has(host)) return "kimi";
  if (host === DEEPSEEK_HOST) return "deepseek";
  if (MINIMAX_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return "minimax";
  return null;
}

/** 模型是不是 Grok 的，不论中转服务或路由给它加什么厂商前缀（xai/grok-4.5、x-ai/grok-4）。 */
export function isGrokModel(id: string): boolean {
  const bare = id.slice(id.lastIndexOf("/") + 1);
  return bare.toLowerCase().startsWith("grok");
}

/** 发往哪家（地址）的哪个模型（发给上游的名字）。 */
export interface VendorTarget {
  baseUrl: string;
  model: string;
}

/** Grok 的模型，或 xAI 自己的地址：工具 schema 的正则要改写。 */
function isGrokTarget(target: VendorTarget): boolean {
  return isGrokModel(target.model) || hostOf(target.baseUrl) === XAI_HOST;
}

/** 这次请求有没有按厂商要改的：没有时调用方不必再读一遍请求体。 */
export function hasVendorRewrites(target: VendorTarget): boolean {
  return addressVendor(target.baseUrl) !== null || isGrokTarget(target);
}

/** 要按厂商改的请求体：发给上游的格式与 JSON。 */
export interface VendorRewriteInput extends VendorTarget {
  format: ApiEndpointRequestFormat;
  body: Body;
}

/** 发给上游的请求体按这家（地址）与目标模型改：只有四家有要改的，别的原样交回同一个对象。 */
export function withVendorRewrites(input: VendorRewriteInput): Body {
  const { format } = input;
  const vendor = addressVendor(input.baseUrl);
  const grok = isGrokTarget(input);
  let body = input.body;
  if (vendor === "kimi") body = withToolSchemasFixed(body, withEnumType);
  const kimiChat = vendor === "kimi" && format === "openai_chat";
  if (kimiChat) body = withReasoningDetailsAsContent(body);
  if (vendor === "deepseek") body = withToolSchemasFixed(body, withNullEscaped);
  // Kimi 的 Anthropic 地址见到延后加载工具块就整个 400、原话里不点名（magpie #2042）；DeepSeek 照工单一并不发。
  const dropsDeferred = vendor === "kimi" || vendor === "deepseek";
  const dropsAnthropicDeferred = dropsDeferred && format === "anthropic_messages";
  if (dropsAnthropicDeferred) {
    body = withoutRefusedFields({ format, body, refused: (field) => field === "deferredTools" });
  }
  if (grok) body = withToolSchemasFixed(body, withRustClasses);
  return body;
}

/**
 * 翻成 Responses 的搜索请求为写回搜索结果加了 web_search_call.action.sources；xAI 自己的地址不知道收不收，不给它要
 * （magpie buildResponses）。客户端自己要的照留。
 */
export function withSearchSourcesFor(input: {
  baseUrl: string;
  body: Body;
  asked: readonly string[];
}): Body {
  const { body } = input;
  const { include } = body;
  const added = Array.isArray(include) && include.includes(SEARCH_SOURCES);
  const dropped =
    added && hostOf(input.baseUrl) === XAI_HOST && !input.asked.includes(SEARCH_SOURCES);
  if (!dropped || !Array.isArray(include)) return body;
  const kept = include.filter((item) => item !== SEARCH_SOURCES);
  if (kept.length > 0) return { ...body, include: kept };
  const { include: _include, ...rest } = body;
  return rest;
}

/**
 * MiniMax 自己的 Chat 地址把思考写在回复文字的 <think> 里，之后几轮要原样写回那里（它的交错思考，magpie #1267）：
 * 翻成 Chat 前，assistant 消息的思考挪成文字开头的 `<think>…</think>\n\n`。别的地址原样交回同一个请求。
 */
export function withThinkingInline(input: {
  baseUrl: string;
  request: GatewayRequest;
}): GatewayRequest {
  const { request } = input;
  if (addressVendor(input.baseUrl) !== "minimax") return request;
  const messages = listFixed(request.messages, messageWithThinkingInline);
  if (messages === request.messages) return request;
  return { ...request, messages };
}

function messageWithThinkingInline(message: Message): Message {
  if (message.role !== "assistant") return message;
  const think = message.parts.map((part) => (part.kind === "thinking" ? part.text : "")).join("");
  if (think === "") return message;
  const rest = message.parts.filter((part) => part.kind !== "thinking");
  const head = { kind: "text" as const, text: `<think>${think}</think>\n\n` };
  return { ...message, parts: [head, ...rest] };
}

/**
 * Kimi 不收消息里任何写法的 reasoning_details（magpie #1765）：去掉它，消息自己没有 reasoning_content 时，
 * 它的思考文字写进 reasoning_content。
 */
function withReasoningDetailsAsContent(body: Body): Body {
  const given = body.messages;
  if (!Array.isArray(given)) return body;
  const messages = listFixed(given, messageWithReasoningContent);
  if (messages === given) return body;
  return { ...body, messages };
}

function messageWithReasoningContent(message: unknown): unknown {
  const carriesDetails = isRecord(message) && "reasoning_details" in message;
  if (!carriesDetails) return message;
  const { reasoning_details: _details, ...rest } = message;
  const own = typeof message.reasoning_content === "string" && message.reasoning_content !== "";
  const think = reasoningText(message);
  if (own || think === "") return rest;
  return { ...rest, reasoning_content: think };
}

/** 请求体每个工具的参数 schema（Anthropic 的 input_schema、Chat 与 Responses 的 parameters）逐个节点改。 */
function withToolSchemasFixed(body: Body, fix: SchemaFix): Body {
  const given = body.tools;
  if (!Array.isArray(given)) return body;
  const tools = listFixed(given, (tool) => toolFixed(tool, fix));
  if (tools === given) return body;
  return { ...body, tools };
}

/** 工具里 parameters、input_schema 是 schema；Chat 的 function 里再找一层。 */
function toolFixed(tool: unknown, fix: SchemaFix): unknown {
  if (!isRecord(tool)) return tool;
  return valuesFixed(tool, (key, value) => {
    if (key === "parameters" || key === "input_schema") return schemaFixed(value, fix);
    if (key === "function") return toolFixed(value, fix);
    return value;
  });
}

/** 一个 schema（或一列 schema）连同它下面的子 schema 都改；schema 里的数据（default、const 的值）不碰。 */
function schemaFixed(node: unknown, fix: SchemaFix): unknown {
  if (Array.isArray(node)) return listFixed(node, (item) => schemaFixed(item, fix));
  if (!isRecord(node)) return node;
  return valuesFixed(fix(node), (key, value) => {
    if (SCHEMA_MAPS.has(key)) return schemaMapFixed(value, fix);
    if (SCHEMA_KEYS.has(key)) return schemaFixed(value, fix);
    return value;
  });
}

function schemaMapFixed(node: unknown, fix: SchemaFix): unknown {
  if (!isRecord(node)) return node;
  return valuesFixed(node, (_name, schema) => schemaFixed(schema, fix));
}

/** 逐个改一列的元素；一个都没变就原样交回同一列。 */
function listFixed<T>(list: T[], fix: (item: T) => T): T[] {
  const fixed = list.map(fix);
  const changed = fixed.some((item, index) => item !== list[index]);
  if (!changed) return list;
  return fixed;
}

/** 逐个键改对象的值，第一次有变化时才复制；一个都没变就原样交回同一个对象。 */
function valuesFixed(record: Body, fixValue: (key: string, value: unknown) => unknown): Body {
  let out: Body | null = null;
  for (const [key, value] of Object.entries(record)) {
    const fixed = fixValue(key, value);
    if (fixed === value) continue;
    out ??= { ...record };
    out[key] = fixed;
  }
  return out ?? record;
}

/**
 * Kimi 的「moonshot flavored json schema」不收有 enum（或 const）却没写 type 的 schema，整个请求 400（magpie #886）：
 * 补上所有值共有的 type，写在最前面；值的类型不一、或有 null 的不补。
 */
function withEnumType(schema: Body): Body {
  if ("type" in schema) return schema;
  let values: unknown[] = [];
  if (Array.isArray(schema.enum)) values = schema.enum;
  else if ("const" in schema) values = [schema.const];
  const type = valuesType(values);
  if (type === null) return schema;
  return { type, ...schema };
}

type ValueType = "string" | "boolean" | "integer" | "number";

/** 这些值共有的 JSON Schema 类型：整数夹着小数算 number；没有值、或类型不一时为 null。 */
function valuesType(values: unknown[]): ValueType | null {
  let type: ValueType | null = null;
  for (const value of values) {
    const own = valueType(value);
    if (own === null) return null;
    type = joinedType(type, own);
    if (type === null) return null;
  }
  return type;
}

function valueType(value: unknown): ValueType | null {
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value !== "number") return null;
  return Number.isInteger(value) ? "integer" : "number";
}

function joinedType(sofar: ValueType | null, next: ValueType): ValueType | null {
  if (sofar === null || sofar === next) return next;
  const numbers = new Set<ValueType>([sofar, next]);
  const mixedNumbers = numbers.has("integer") && numbers.has("number");
  return mixedNumbers ? "number" : null;
}

/** schema 的 pattern 交给 `fix` 改写；不是字符串或没变就原样。 */
function withPatternFixed(schema: Body, fix: (pattern: string) => string): Body {
  if (typeof schema.pattern !== "string") return schema;
  const pattern = fix(schema.pattern);
  if (pattern === schema.pattern) return schema;
  return { ...schema, pattern };
}

/** DeepSeek 的 schema 校验不认 ECMAScript 的 `\0`（「… is not a 'regex'」）：改成同义的 `\u0000`。 */
function withNullEscaped(schema: Body): Body {
  return withPatternFixed(schema, unicodeNullEscape);
}

/** xAI 按 Rust 的正则读 pattern，读不懂就拒（magpie #2317）：字符类里会被当嵌套类或集合运算的字符转义掉。 */
function withRustClasses(schema: Body): Body {
  return withPatternFixed(schema, ecmaClassForRust);
}

/** `\0` 改成 `\u0000`；两个反斜杠是字面的反斜杠，`\01` 这类八进制转义另有意思，都不动。 */
function unicodeNullEscape(pattern: string): string {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const escapes = pattern[i] === "\\" && i + 1 < pattern.length;
    if (!escapes) {
      out += pattern[i];
      continue;
    }
    const escape = pattern.slice(i, i + 2);
    const digitAfter = /[0-9]/.test(pattern[i + 2] ?? "");
    const nullEscape = escape === "\\0" && !digitAfter;
    out += nullEscape ? "\\u0000" : escape;
    i++;
  }
  return out;
}

/**
 * 字符类里的 `[`，以及 `&&`、`--`、`~~` 的第二个字符，在 Rust 的正则里是嵌套类与集合运算：转义掉，
 * 对 ECMAScript 还是同一个字符。转义原样，字符类外不动。
 */
function ecmaClassForRust(pattern: string): string {
  let out = "";
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    const next = pattern[i + 1];
    const escaped = c === "\\" && next !== undefined;
    if (escaped) {
      out += c + next;
      i++;
      continue;
    }
    const doubled = inClass && "&-~".includes(c) && next === c;
    if (doubled) {
      out += `${c}\\${c}`;
      i++;
      continue;
    }
    const nestedOpen = inClass && c === "[";
    if (nestedOpen) {
      out += "\\[";
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    out += c;
  }
  return out;
}
