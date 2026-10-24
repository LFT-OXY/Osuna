// 拒收字段的认法与改法移植自 magpie（https://github.com/yetone/magpie，internal/gateway/anthropic_shapes.go 的 refuseShapes、withoutRefusedShapes、withDisplay、withoutDeferredTools、withRefsSaid，anthropic.go 的 samplingDeprecated、withoutSampling，strict_refused.go 的 toolStrictRefusal、withoutToolStrict，image_tool.go 的 withoutImageTool、withoutImageToolReq、mayDropImageTool，
// gateway.go 的 cacheKeyField 与 refusesField，object_root.go 的 rootUnionRefusal、objectRootsBody、foldTools 与 objectRootsReq）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { hostOf } from "../model-facts.js";
import { isRecord } from "../upstream-http.js";
import { toolLoadedText, type GatewayRequest } from "./translation/ir.js";
import { objectRoot } from "./translation/object-root.js";

/*
 * 上游不收请求里的某个字段（拒收）：在同一家去掉它重问，并记住这家的这个模型以后不发。
 * 这里只认上游原话、按记住的去掉字段；记在哪、什么时候重问归 refusals.ts。
 */

/**
 * safeguards：Claude Code 自动模式的审查字段；display：thinking.display 整个不收；
 * displayValue：summarized、omitted 以外的 display 值不收；sampling：temperature、top_p、top_k 已弃用；
 * deferredTools：消息里的延后加载工具块；toolResultRefs：只有 tool_reference 的工具结果；
 * toolStrict：工具的 strict；imageTool：Codex 的画图工具（命名空间 image_gen）；cacheKey：Codex 的 prompt_cache_key；
 * rootUnion：工具参数的根是 anyOf、oneOf 或 allOf（不去掉，包成根是 object 的 schema 重问）。
 */
export type DroppedField =
  | "safeguards"
  | "display"
  | "displayValue"
  | "sampling"
  | "deferredTools"
  | "toolResultRefs"
  | "toolStrict"
  | "imageTool"
  | "cacheKey"
  | "rootUnion";

const FIELD_WORDS = {
  // Copilot 的 Messages API 不收自动模式的 safeguards（magpie #1756）。
  safeguards: /\bsafeguards:? Extra inputs are not permitted/,
  // 只收 summarized、omitted 的中转服务（magpie Keenc 报告）。
  displayValue: /thinking\.(?:adaptive|enabled)\.display:? Input should be/,
  display: /thinking\.(?:adaptive|enabled)\.display:? Extra inputs are not permitted/,
  // Haiku 5.5：「`temperature` is deprecated for this model.」（magpie #1454）。
  sampling: /\b(?:temperature|top_p|top_k)`?\W+is (?:deprecated|not supported) for this model/i,
  // DeepSeek 的 Anthropic 地址：422「messages[1].content: unknown variant `tool_removal`」。
  deferredTools:
    /messages\[\d+\]\.content: unknown variant `(?:tool_addition|tool_removal|tool_definition|tool_reference)`/,
  // OpenDesign 读不懂只有 tool_reference 的工具结果（magpie #2124）。
  toolResultRefs: /missing field `content`/,
  // 工具的 strict 被说不支持、不认识、不许带，或 pydantic 的 extra_forbidden 落在它上面（magpie #1980）。
  // 值不对、schema 不合严格模式是别的错，不算。
  toolStrict:
    /(?:unsupported|unknown|unrecognized|not (?:supported|allowed|permitted)|extra (?:fields?|inputs?|parameters?)|forbidden)[^\n{}]{0,120}?\btools(?:\[\d+\]|\.\d+)(?:\.[^\s.'"`]+)?\.strict\b|\btools(?:\[\d+\]|\.\d+)(?:\.[^\s.'"`]+)?\.strict\b['"`]?[^\n{}]{0,40}?(?:unsupported|unknown|unrecognized|not (?:supported|allowed|permitted)|extra_forbidden|forbidden)|"loc"\s*:\s*\[\s*(?:"body"\s*,\s*)?"tools"\s*,\s*\d+\s*,\s*(?:"function"\s*,\s*)?"strict"\s*\][^{}]*"type"\s*:\s*"extra_forbidden"|"type"\s*:\s*"extra_forbidden"[^{}]*"loc"\s*:\s*\[\s*(?:"body"\s*,\s*)?"tools"\s*,\s*\d+\s*,\s*(?:"function"\s*,\s*)?"strict"\s*\]/i,
  // 不认识的字段一律不收的厂商（Gemini 的「Unknown name」、Mistral 的 extra_forbidden）：原话里点了它的名（magpie refusesField）。
  cacheKey: /\bprompt_cache_key\b/,
  // xAI、Anthropic（经中转服务的 Chat）与照 OpenAI 校验工具的上游（magpie #1271、#646、#1493）。
  rootUnion:
    /tool parameter root must be an object type|does not support oneOf, allOf, or anyOf at the top level|schema must have type .object. and not have .oneOf.|schema must be a JSON Schema of .type: \\?"object\\?"./i,
} as const;

const W = FIELD_WORDS;

const IMAGE_NAMESPACE = "image_gen";

const SAMPLING_KEYS = ["temperature", "top_p", "top_k"];

const DEFERRED_BLOCKS = new Set(["tool_addition", "tool_removal", "tool_reference"]);

type Body = Record<string, unknown>;

/** 这家这个模型记着不收这个字段。 */
export type FieldRefused = (field: DroppedField) => boolean;

/** 一种字段的认法：上游的原话，与发出的请求体带着它。 */
interface FieldCheck {
  field: DroppedField;
  words: RegExp;
  sent: (body: Body) => boolean;
}

// Anthropic 格式的请求体可能带着的；display 与 displayValue 是同一个字段的两种说法。
const ANTHROPIC_CHECKS: FieldCheck[] = [
  { field: "display", words: W.display, sent: sendsDisplay },
  { field: "displayValue", words: W.displayValue, sent: sendsNewDisplay },
  { field: "safeguards", words: W.safeguards, sent: (body) => body.safeguards !== undefined },
  { field: "sampling", words: W.sampling, sent: hasSampling },
  { field: "deferredTools", words: W.deferredTools, sent: hasDeferredTools },
  { field: "toolResultRefs", words: W.toolResultRefs, sent: hasRefsOnlyResult },
];

const OPENAI_CHECKS: FieldCheck[] = [
  { field: "toolStrict", words: W.toolStrict, sent: (body) => toolsHaveStrict(body.tools) },
  { field: "cacheKey", words: W.cacheKey, sent: (body) => body.prompt_cache_key !== undefined },
  { field: "rootUnion", words: W.rootUnion, sent: (body) => foldsTools(body) !== body },
];

/** 上游拒收内容时用的状态码（magpie badRequest）。 */
export function refusesContent(status: number): boolean {
  return status === 400 || status === 422;
}

/** 这次发出去的请求（`body`）被拒，是因为哪些它带着的字段；画图工具的裸 400 不在这里认。 */
export function refusedFields(input: {
  format: ApiEndpointRequestFormat;
  body: unknown;
  status: number;
  text: string;
}): DroppedField[] {
  const { body, text } = input;
  if (!refusesContent(input.status)) return [];
  if (!isRecord(body)) return [];
  const checks = input.format === "anthropic_messages" ? ANTHROPIC_CHECKS : OPENAI_CHECKS;
  const refusedHere = (check: FieldCheck) => check.words.test(text) && check.sent(body);
  return checks.filter(refusedHere).map((check) => check.field);
}

/** 去掉这家这个模型不收的字段；没有要去掉的就原样交回同一个对象。 */
export function withoutRefusedFields(input: {
  format: ApiEndpointRequestFormat;
  body: Body;
  refused: FieldRefused;
}): Body {
  const { refused } = input;
  let body = input.body;
  if (input.format !== "anthropic_messages") {
    if (refused("toolStrict")) body = withoutToolStrict({ format: input.format, body });
    // 只有 Responses 的请求体有命名空间工具。
    if (refused("imageTool")) body = withoutImageTool(body);
    if (refused("cacheKey")) body = withoutKeys(body, ["prompt_cache_key"]);
    if (refused("rootUnion")) body = foldsTools(body);
    return body;
  }
  if (refused("deferredTools")) body = withoutDeferredTools(body);
  if (refused("toolResultRefs")) body = withRefsSaid(body);
  if (refused("safeguards")) body = withoutSafeguards(body);
  if (refused("sampling")) body = withoutSampling(body);
  const displayRefused = refused("display") || refused("displayValue");
  if (displayRefused) body = withDisplay({ body, all: refused("display") });
  return body;
}

/** 去掉 Claude Code 自动模式的审查字段（safeguards）；没有就原样交回同一个对象。 */
export function withoutSafeguards(body: Body): Body {
  return withoutKeys(body, ["safeguards"]);
}

/** 去掉 temperature、top_p、top_k；都没有就原样交回同一个对象。 */
export function withoutSampling(body: Body): Body {
  return withoutKeys(body, SAMPLING_KEYS);
}

/** 去掉这几个顶层字段；一个都没有就原样交回同一个对象。 */
export function withoutKeys(body: Body, keys: string[]): Body {
  if (!keys.some((key) => key in body)) return body;
  const out = { ...body };
  for (const key of keys) delete out[key];
  return out;
}

function knownDisplay(display: unknown): boolean {
  return display === "summarized" || display === "omitted";
}

function displayOf(body: Body): unknown {
  return isRecord(body.thinking) ? body.thinking.display : undefined;
}

function sendsDisplay(body: Body): boolean {
  return displayOf(body) !== undefined;
}

/** 带着 summarized、omitted 以外的 display。 */
function sendsNewDisplay(body: Body): boolean {
  const display = displayOf(body);
  return display !== undefined && !knownDisplay(display);
}

/** 去掉 thinking.display；只是值不收（不是 all）时，highlights 改成 summarized，别的新值去掉。 */
function withDisplay(input: { body: Body; all: boolean }): Body {
  const { body } = input;
  const sent = isRecord(body.thinking) ? body.thinking : {};
  if (sent.display === undefined) return body;
  const { display, ...rest } = sent;
  const keeps = !input.all && knownDisplay(display);
  if (keeps) return body;
  const highlights = !input.all && display === "highlights";
  const thinking = highlights ? { ...rest, display: "summarized" } : rest;
  return { ...body, thinking };
}

function hasSampling(body: Body): boolean {
  return SAMPLING_KEYS.some((key) => body[key] !== undefined);
}

function contentBlocks(message: unknown): unknown[] {
  if (!isRecord(message)) return [];
  return Array.isArray(message.content) ? message.content : [];
}

function withContent(input: { message: unknown; content: unknown[] }): unknown {
  if (!isRecord(input.message)) return input.message;
  return { ...input.message, content: input.content };
}

function blockType(block: unknown): unknown {
  return isRecord(block) ? block.type : undefined;
}

/** 消息里的延后加载工具块：tool_addition、tool_removal、tool_reference。 */
export function isDeferredBlock(block: unknown): boolean {
  return DEFERRED_BLOCKS.has(String(blockType(block)));
}

function messagesOf(body: Body): unknown[] {
  return Array.isArray(body.messages) ? body.messages : [];
}

/** 消息里有延后加载工具块；工具结果里的 tool_reference（ToolSearch 的回答）不算。 */
function hasDeferredTools(body: Body): boolean {
  return messagesOf(body).some((message) => contentBlocks(message).some(isDeferredBlock));
}

function toolName(tool: unknown): unknown {
  return isRecord(tool) ? tool.name : undefined;
}

/**
 * 去掉消息里的延后加载工具块，只剩它们的消息也去掉；只在消息里给出的工具定义并进请求的 tools，
 * tools 里已有同名的以 tools 为准。工具结果里的 tool_reference 留着：那是工具的回答。
 */
function withoutDeferredTools(body: Body): Body {
  if (!hasDeferredTools(body)) return body;
  const given = Array.isArray(body.tools) ? body.tools : [];
  const tools = [...given];
  const named = new Set(given.map(toolName));
  const messages: unknown[] = [];
  for (const message of messagesOf(body)) {
    const blocks = contentBlocks(message);
    for (const definition of blocks.flatMap(inlineDefinition)) {
      if (named.has(definition.name)) continue;
      tools.push(definition);
      named.add(definition.name);
    }
    const kept = blocks.filter((block) => !isDeferredBlock(block));
    if (kept.length === blocks.length) messages.push(message);
    else if (kept.length > 0) messages.push(withContent({ message, content: kept }));
  }
  const out: Body = { ...body, messages };
  if (tools.length > given.length) out.tools = tools;
  return out;
}

/** tool_addition 里直接给出、带名字的工具定义（tool_definition）；只是点名的没有。 */
function inlineDefinition(block: unknown): Body[] {
  if (!isRecord(block) || block.type !== "tool_addition") return [];
  const { tool } = block;
  if (!isRecord(tool) || tool.type !== "tool_definition") return [];
  const { definition } = tool;
  if (!isRecord(definition)) return [];
  const named = typeof definition.name === "string" && definition.name !== "";
  return named ? [definition] : [];
}

/** 工具结果的内容只有 tool_reference 块。 */
function refsOnly(content: unknown): content is Body[] {
  if (!Array.isArray(content)) return false;
  if (content.length === 0) return false;
  return content.every((block) => blockType(block) === "tool_reference");
}

function isRefsOnlyResult(block: unknown): block is Body & { content: Body[] } {
  return isRecord(block) && block.type === "tool_result" && refsOnly(block.content);
}

function hasRefsOnlyResult(body: Body): boolean {
  return messagesOf(body).some((message) => contentBlocks(message).some(isRefsOnlyResult));
}

/** 只有 tool_reference 的工具结果，前面补一个文字块说哪些工具已加载；引用与调用、结果的配对不动。 */
function withRefsSaid(body: Body): Body {
  if (!hasRefsOnlyResult(body)) return body;
  const messages = messagesOf(body).map((message) => {
    const blocks = contentBlocks(message);
    if (!blocks.some(isRefsOnlyResult)) return message;
    return withContent({ message, content: blocks.map(refsSaid) });
  });
  return { ...body, messages };
}

function refsSaid(block: unknown): unknown {
  if (!isRefsOnlyResult(block)) return block;
  const lines = block.content.map((ref) => toolLoadedText(String(ref.tool_name)));
  const said = { type: "text", text: lines.join("\n") };
  return { ...block, content: [said, ...block.content] };
}

/** Chat 的 tools[].function、Responses 的 tools[]（含命名空间里的）带着 strict。 */
function toolsHaveStrict(tools: unknown): boolean {
  if (!Array.isArray(tools)) return false;
  return tools.some((tool) => {
    if (!isRecord(tool)) return false;
    if (tool.type === "namespace") return toolsHaveStrict(tool.tools);
    const fn = isRecord(tool.function) ? tool.function : tool;
    return "strict" in fn;
  });
}

function withoutToolStrict(input: { format: ApiEndpointRequestFormat; body: Body }): Body {
  const { body } = input;
  const { tools } = body;
  if (!Array.isArray(tools)) return body;
  if (!toolsHaveStrict(tools)) return body;
  const chat = input.format === "openai_chat";
  return { ...body, tools: toolsWithoutStrict({ tools, chat }) };
}

function toolsWithoutStrict(input: { tools: unknown[]; chat: boolean }): unknown[] {
  return input.tools.map((tool) => {
    if (!isRecord(tool)) return tool;
    const nested = tool.tools;
    const namespace = tool.type === "namespace" && Array.isArray(nested);
    if (namespace)
      return { ...tool, tools: toolsWithoutStrict({ tools: nested, chat: input.chat }) };
    const fn = tool.function;
    const chatFunction = input.chat && isRecord(fn);
    if (chatFunction) return { ...tool, function: withoutKeys(fn, ["strict"]) };
    return withoutKeys(tool, ["strict"]);
  });
}

/**
 * Chat 的 tools[].function、Responses 的 tools[]（含命名空间里的）、Gemini 的 functionDeclarations 的参数根包成 object；
 * 工具里没有联合（`Of"`）或都不用改时原样交回同一个对象。
 */
function foldsTools(body: Body): Body {
  const { tools } = body;
  if (!Array.isArray(tools)) return body;
  const hasUnion = JSON.stringify(tools).includes('Of"');
  if (!hasUnion) return body;
  const folded = toolsFolded(tools);
  if (folded === tools) return body;
  return { ...body, tools: folded };
}

function toolsFolded(tools: unknown[]): unknown[] {
  let changed = false;
  const out = tools.map((tool) => {
    const next = toolFolded(tool);
    changed ||= next !== tool;
    return next;
  });
  return changed ? out : tools;
}

function toolFolded(tool: unknown): unknown {
  if (!isRecord(tool)) return tool;
  const nested = tool.tools;
  if (tool.type === "namespace" && Array.isArray(nested)) {
    const folded = toolsFolded(nested);
    if (folded === nested) return tool;
    return { ...tool, tools: folded };
  }
  const fn = tool.function;
  if (isRecord(fn)) {
    const folded = withParametersFolded({ definition: fn, key: "parameters" });
    if (folded === fn) return tool;
    return { ...tool, function: folded };
  }
  const declarations = tool.functionDeclarations;
  if (Array.isArray(declarations)) {
    let changed = false;
    const folded = declarations.map((declaration: unknown) => {
      if (!isRecord(declaration)) return declaration;
      const next = withParametersFolded({ definition: declaration, key: "parametersJsonSchema" });
      changed ||= next !== declaration;
      return next;
    });
    return changed ? { ...tool, functionDeclarations: folded } : tool;
  }
  return withParametersFolded({ definition: tool, key: "parameters" });
}

/**
 * 工具定义（Responses 的工具、Chat 的 function，或 Gemini 的 functionDeclaration）的参数根包成 object；
 * 不用改时交回同一个对象。
 */
function withParametersFolded(input: {
  definition: Body;
  key: "parameters" | "parametersJsonSchema";
}): Body {
  const { definition, key } = input;
  const parameters = definition[key];
  if (!isRecord(parameters)) return definition;
  const folded = objectRoot(parameters);
  if (folded === parameters) return definition;
  return { ...definition, [key]: folded };
}

function isImageTool(tool: unknown): boolean {
  return isRecord(tool) && tool.type === "namespace" && tool.name === IMAGE_NAMESPACE;
}

/** Responses 请求体在命名空间 image_gen 里给了 Codex 的画图工具。 */
export function offersImageTool(body: unknown): boolean {
  return isRecord(body) && Array.isArray(body.tools) && body.tools.some(isImageTool);
}

/** 去掉 Codex 的画图工具；一个工具都不剩时 tool_choice 也去掉。 */
function withoutImageTool(body: Body): Body {
  const given = Array.isArray(body.tools) ? body.tools : [];
  const tools = given.filter((tool) => !isImageTool(tool));
  if (tools.length === given.length) return body;
  if (tools.length > 0) return { ...body, tools };
  return withoutKeys(body, ["tools", "tool_choice"]);
}

function isImageToolName(input: { request: GatewayRequest; name: string }): boolean {
  return input.request.named[input.name]?.namespace === IMAGE_NAMESPACE;
}

/** 翻译的请求给了 Codex 的画图工具（扁平名）。 */
export function requestOffersImageTool(request: GatewayRequest): boolean {
  return request.tools.some((tool) => isImageToolName({ request, name: tool.name }));
}

/** 翻译的请求去掉 Codex 的画图工具；一个工具都不剩时，点名或要求调用工具的 tool_choice 改成没说。 */
export function withoutImageToolRequest(request: GatewayRequest): GatewayRequest {
  if (!requestOffersImageTool(request)) return request;
  const tools = request.tools.filter((tool) => !isImageToolName({ request, name: tool.name }));
  const asksForTool = request.toolChoice !== "" && request.toolChoice !== "none";
  const asksForGoneTool = tools.length === 0 && asksForTool;
  const toolChoice = asksForGoneTool ? "" : request.toolChoice;
  return { ...request, tools, toolChoice };
}

/** xAI 自己的 API 不收根是联合的工具参数，不等它拒：一开始就包成 object（magpie object_root.go 的 foldsRoots）。 */
export function foldsRootsUpFront(baseUrl: string): boolean {
  return hostOf(baseUrl) === "api.x.ai";
}

/** OpenAI 自己的地址收 Codex 的画图工具，不必去掉（magpie mayDropImageTool；Osuna 没有 ChatGPT 登录的接口）。 */
export function takesImageTool(baseUrl: string): boolean {
  const host = URL.canParse(baseUrl) ? new URL(baseUrl).hostname : "";
  return host === "openai.com" || host.endsWith(".openai.com");
}
