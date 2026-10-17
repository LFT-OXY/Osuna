// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gateway/anthropic.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { isRecord, parseJson } from "../../upstream-http.js";
import {
  INTERRUPTED_TOOL,
  ReplyCollector,
  RequestShapeError,
  TOOL_RESULT_RECEIVED,
  argsOf,
  attachmentText,
  budgetOf,
  callsTool,
  effortOf,
  effortOfBudget,
  FORMAT_NAME,
  formatInstruction,
  newId,
  NO_REASONING,
  replaysThinking,
  sourceImage,
  stringOrText,
  toolOutput,
  withLine,
  type EmitEvent,
  type SchemaFormat,
  type GatewayRequest,
  type ImagePart,
  type Message,
  type Part,
  type Reply,
  type StopReason,
  type StreamEvent,
  type Tool,
  type ToolChoice,
  type ToolResultPart,
  type Usage,
  vendorErrorFields,
} from "./ir.js";
import { withoutSampling } from "../refused-fields.js";
import { objectSchema } from "./object-root.js";
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
    cacheKey: "",
    include: [],
    clientMetadata: null,
    text: null,
    format: anthropicFormat(body.output_config),
    named: {},
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
          ...toolOutput(block.content),
          isError: block.is_error === true,
        },
      ];
    case "image":
      return isRecord(block.source) ? [sourceImage(block.source)] : [];
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
        strict: false,
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

/** output_config.format 只有带 schema 的一种。 */
export function anthropicFormat(config: unknown): SchemaFormat | null {
  if (!isRecord(config) || !isRecord(config.format)) return null;
  const { format } = config;
  if (format.type !== "json_schema" || format.schema === undefined || format.schema === null) {
    return null;
  }
  return {
    type: "json_schema",
    name: FORMAT_NAME,
    description: "",
    schema: format.schema,
    strict: null,
  };
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
  const { format } = request;
  // output_config.format 只收 schema：任意 JSON 对象用话写进系统提示。
  const system =
    format?.type === "json_object"
      ? withLine(request.system, formatInstruction(format))
      : request.system;
  const replay = replaysThinking(model) && !isAnthropicModel(model);
  const messages = pairToolBlocks(anthropicMessages({ messages: request.messages, replay }));
  markLastBlock(messages);
  const out: Record<string, unknown> = { model, messages, stream: request.stream };
  if (replay) {
    const changes = thinkingOnToolTurns(messages);
    out.messages = messages.map((message, index) => {
      const content = changes.get(index);
      return content ? { role: message.role, content } : message;
    });
  }
  // 系统提示与工具每轮都一样，和对话分开缓存。
  if (system !== "") out.system = [{ type: "text", text: system, cache_control: EPHEMERAL }];
  // 不收采样参数的 Claude 不发 temperature、top_p（magpie samplingAsTaken，直通也一样）。
  let thinking = anthropicThinking(request, model);
  if (refusesSampling(model)) thinking = withoutSampling(thinking);
  Object.assign(out, thinking);
  const config: Record<string, unknown> = {};
  const effort = adaptiveEffort(request, model);
  if (effort !== null) config.effort = effort;
  if (format?.type === "json_schema")
    config.format = { type: "json_schema", schema: format.schema };
  if (Object.keys(config).length > 0) out.output_config = config;
  if (request.stop.length > 0) out.stop_sequences = request.stop;
  if (request.metadata !== null) out.metadata = request.metadata;
  if (request.tools.length > 0) {
    const tools: Record<string, unknown>[] = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      // 根是联合的 schema Anthropic 不收（"does not support oneOf, allOf, or anyOf at the top level"）。
      input_schema: objectSchema(tool.schema) ?? { type: "object", properties: {} },
    }));
    // 有系统提示时工具不标：连同 Claude 登录自带的一个，不超过 Anthropic 的四个。
    if (system === "") tools.at(-1)!.cache_control = EPHEMERAL;
    out.tools = tools;
    const choice = anthropicToolChoice(request);
    if (choice) out.tool_choice = choice;
  }
  return thinkingOffAsTaken(out, model);
}

const EPHEMERAL = { type: "ephemeral" };

/**
 * Anthropic 只缓存到标了记号的块，别的协议的请求从来不带：标在对话的最后一块上，下一轮只是往后加，
 * 前面都从缓存读。思考块不能标。
 */
function markLastBlock(messages: AnthropicMessage[]): void {
  const blocks = messages.at(-1)?.content ?? [];
  const last = blocks.findLast(
    (block) => block.type !== "thinking" && block.type !== "redacted_thinking",
  );
  if (last) last.cache_control = EPHEMERAL;
}

/** replay：上游要回放推理时，没签名的思考也按文字发回去。 */
function anthropicMessages(input: { messages: Message[]; replay: boolean }): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const message of input.messages) {
    const results: AnthropicBlock[] = [];
    const rest: AnthropicBlock[] = [];
    for (const part of message.parts) {
      const unsignedThought = part.kind === "thinking" && part.signature === "" && part.text !== "";
      const block =
        input.replay && unsignedThought
          ? { type: "thinking", thinking: part.text }
          : anthropicBlock(part);
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
      return toolResultBlock(part);
    case "image":
      return imageBlock(part);
    case "file":
      return { type: "text", text: attachmentText(part) };
    case "thinking":
      // 只有带签名的才回给 Anthropic；无签名的文字是别家的推理。
      return part.signature === ""
        ? null
        : { type: "thinking", thinking: part.text, signature: part.signature };
  }
}

function wantsThinking(request: GatewayRequest): boolean {
  return (request.thinking || request.effort !== "") && !request.thinkOff;
}

/**
 * 思考、输出上限与采样参数。关了推理的发 disabled；要思考的，4.6 起的 Claude 只认自适应思考，
 * 别的模型给预算并留出回答的余地；不思考的才带温度。
 */
function anthropicThinking(request: GatewayRequest, model: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let maxTokens = request.maxTokens > 0 ? request.maxTokens : DEFAULT_MAX_TOKENS;
  const think = wantsThinking(request);
  if (request.thinkOff) out.thinking = { type: "disabled" };
  if (think && adaptiveOnly(model)) {
    out.thinking = { type: "adaptive", display: "summarized" };
  } else if (think && (request.maxTokens <= 0 || request.maxTokens > 2048)) {
    let budget = budgetOf(request.effort);
    // 客户端给的上限是模型能写的：预算放在它下面；没给的抬高上限装下预算。
    if (request.maxTokens > 0) budget = Math.min(budget, maxTokens - 1024);
    else if (maxTokens < budget + 4096) maxTokens = budget + 4096;
    out.thinking = { type: "enabled", budget_tokens: budget };
  } else if (request.temperature !== null) {
    out.temperature = request.temperature;
  } else if (request.topP !== null) {
    out.top_p = request.topP;
  }
  out.max_tokens = maxTokens;
  return out;
}

/** 自适应思考的力度放在 output_config.effort；Opus 与 Sonnet 4.6 没有 xhigh，问 max。 */
function adaptiveEffort(request: GatewayRequest, model: string): string | null {
  if (!wantsThinking(request) || !adaptiveOnly(model) || request.effort === "") return null;
  return request.effort === "xhigh" && noXhigh(model) ? "max" : request.effort;
}

// Anthropic 自家的模型：不要求就不思考。
const ANTHROPIC_MODEL = /(?:^|[/.:-])claude-/i;

export function isAnthropicModel(model: string): boolean {
  return ANTHROPIC_MODEL.test(model);
}

// 中转站怎么拼都能读出 Claude 的版本：claude-opus-4-6、anthropic.claude-sonnet-4.6-v1、opus-5.5、claude-3-7-sonnet。
const CLAUDE_VERSION =
  /(?:^|[^a-z0-9])(?:claude-)?(?:opus|sonnet|haiku|fable|mythos)-(\d{1,2})(?:[-.](\d{1,2}))?(?:[^0-9]|$)|claude-(\d+)(?:[-.](\d))?-(?:opus|sonnet|haiku)/;

interface ClaudeVersion {
  major: number;
  minor: number;
}

function claudeVersionOf(model: string): ClaudeVersion | null {
  const match = CLAUDE_VERSION.exec(model.toLowerCase());
  if (!match) return null;
  const [major, minor] = match[3] === undefined ? [match[1], match[2]] : [match[3], match[4]];
  return { major: Number(major), minor: Number(minor ?? 0) };
}

/** 4.6 起的 Claude 只认自适应思考，力度放在 output_config.effort。 */
function adaptiveOnly(model: string): boolean {
  const version = claudeVersionOf(model);
  return version !== null && (version.major > 4 || (version.major === 4 && version.minor >= 6));
}

function noXhigh(model: string): boolean {
  const version = claudeVersionOf(model);
  return version?.major === 4 && version.minor === 6;
}

/**
 * 发给 4.6 起只认自适应思考的 Claude 的 enabled 加预算（不认得这个模型的客户端发的），改成 adaptive（magpie adaptiveThinking）：
 * display 照请求的，没给就 summarized（Opus 4.7 起不要就不显示思考，magpie #1485）；没给 output_config.effort 时按预算换成力度，
 * 预算分不出 xhigh 与 max、4.6 又没有 xhigh，这一档问 max。别的请求（含更早的 Claude、disabled）原样返回同一个对象。
 */
export function adaptiveThinkingAsTaken(
  body: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const thinking = isRecord(body.thinking) ? body.thinking : null;
  const budgeted = thinking?.type === "enabled";
  if (!budgeted || !adaptiveOnly(model)) return body;
  const display = thinking.display ?? "summarized";
  const out: Record<string, unknown> = { ...body, thinking: { type: "adaptive", display } };
  const config = isRecord(body.output_config) ? body.output_config : {};
  const asked = typeof config.effort === "string" ? config.effort : "";
  const budget = typeof thinking.budget_tokens === "number" ? thinking.budget_tokens : 0;
  const effort = effortOfBudget(budget);
  const addsEffort = asked === "" && effort !== "";
  if (!addsEffort) return out;
  out.output_config = { ...config, effort: effort === "xhigh" ? "max" : effort };
  return out;
}

/**
 * 不收 temperature、top_p、top_k 的 Claude（magpie samplingRefused，照 Anthropic 的规则）：Opus 4.7、4.8、5、5.5，
 * Fable 5、Mythos 5 任何值都不收；Sonnet 5、5.5 只收默认值；Haiku 5.5 只收个别值、不收 top_k。
 * 去掉后按模型的默认采样。更早的 Claude 都收；比这些新的系列原样发。
 */
export function refusesSampling(model: string): boolean {
  const match = CLAUDE_LINE.exec(model.toLowerCase());
  if (!match) return false;
  const family = match[1];
  const major = Number(match[2]);
  const minor = Number(match[3] ?? 0);
  const fiveOrFiveFive = major === 5 && [0, 5].includes(minor);
  const fourSevenOn = major === 4 && minor >= 7;
  const fiveFive = major === 5 && minor === 5;
  if (family === "fable" || family === "mythos") return major === 5;
  if (family === "opus") return fourSevenOn || fiveOrFiveFive;
  if (family === "sonnet") return fiveOrFiveFive;
  return family === "haiku" && fiveFive;
}

// 中转站怎么拼都能读出 Claude 的系列与版本：claude-sonnet-5-5、sonnet-5.5、anthropic.claude-sonnet-5-5-v1:0、claude-fable-5-1。
const CLAUDE_LINE =
  /(?:^|[^a-z0-9])(?:claude-)?(opus|sonnet|haiku|fable|mythos)-(\d{1,2})(?:[-.](\d{1,2}))?(?:[^0-9]|$)/;

/**
 * 一个 Claude 怎么收「关思考」（magpie thinkingOffOf，照 Anthropic 自己的规则）：taken 任何档位都收 disabled；
 * upToHigh 只在 high 及以下收（Opus 5、Haiku 5.5）；betweenTools 不收 disabled、要 between_tools（Sonnet 5.5）；
 * never 关不掉（Opus 5.5、Fable 5、Mythos 5）。认不出、或比这些新的系列为 unknown，原样发。
 */
type ThinkingOff = "unknown" | "taken" | "upToHigh" | "betweenTools" | "never";

function thinkingOffOf(model: string): ThinkingOff {
  const match = CLAUDE_LINE.exec(model.toLowerCase());
  if (!match) return "unknown";
  const family = match[1];
  const major = Number(match[2]);
  const minor = Number(match[3] ?? 0);
  if (family === "fable" || family === "mythos") return major === 5 ? "never" : "unknown";
  if (major < 5) return "taken";
  if (major === 5 && minor === 0) return family === "opus" ? "upToHigh" : "taken";
  if (major === 5 && minor === 5) {
    if (family === "sonnet") return "betweenTools";
    return family === "opus" ? "never" : "upToHigh";
  }
  return "unknown";
}

// 不带 thinking 的 Claude 照样自适应地想：给很短的回答上限再加这么多（magpie classifierRoom，Claude Code 也这样给）。
const THINKING_ROOM = 2048;

/**
 * 关思考（disabled 或 between_tools）的请求，换成上游这个 Claude 收的写法（magpie thinkingOffAsTaken）。
 * Claude Code 的自动模式判定与后台小查询会关思考，经中转站发给 Sonnet 5.5 / Opus 5.5 就被拒；
 * Codex 的 effort none 翻译过来也是关思考。别的请求、别家与老的 Claude 原样返回同一个对象。
 */
export function thinkingOffAsTaken(
  body: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const off = thinkingOff(body);
  if (off === null) return body;
  const aboveHigh = off.effort === "xhigh" || off.effort === "max";
  switch (thinkingOffOf(model)) {
    case "taken":
      return off.type === "disabled"
        ? body
        : withThinking(body, { thinking: { type: "disabled" }, effort: "" });
    case "upToHigh":
      if (off.type === "disabled" && !aboveHigh) return body;
      return withThinking(body, {
        thinking: { type: "disabled" },
        effort: aboveHigh ? "high" : "",
      });
    case "betweenTools":
      // between_tools 不收别的字段（display、budget_tokens）。
      if (off.type === "between_tools" && off.alone && !aboveHigh) return body;
      return withThinking(body, {
        thinking: { type: "between_tools" },
        effort: aboveHigh ? "high" : "",
      });
    case "never":
      return withThinking(body, { thinking: null, effort: off.effort === "" ? "low" : "" });
    case "unknown":
      return body;
  }
}

/**
 * 上游说这个模型关不了思考：去掉关思考，交给模型自己想；Claude 再按最低档想（magpie withoutThinkingOff）。
 * 不关思考的请求原样返回同一个对象。
 */
export function thinkingLeftOn(
  body: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const off = thinkingOff(body);
  if (off === null) return body;
  const claude = isAnthropicModel(model) || CLAUDE_LINE.test(model.toLowerCase());
  return withThinking(body, { thinking: null, effort: claude && off.effort === "" ? "low" : "" });
}

function thinkingOff(
  body: Record<string, unknown>,
): { type: "disabled" | "between_tools"; alone: boolean; effort: string } | null {
  const thinking = isRecord(body.thinking) ? body.thinking : null;
  const type = thinking?.type;
  if (type !== "disabled" && type !== "between_tools") return null;
  const config = isRecord(body.output_config) ? body.output_config : null;
  const effort = typeof config?.effort === "string" ? config.effort : "";
  return { type, alone: Object.keys(thinking ?? {}).length === 1, effort };
}

/** `thinking` 为 null 时去掉思考字段，并给很短的回答上限留出想的余地；`effort` 非空时写进 output_config。 */
function withThinking(
  body: Record<string, unknown>,
  change: { thinking: Record<string, unknown> | null; effort: string },
): Record<string, unknown> {
  const { thinking, effort } = change;
  const out = { ...body };
  if (thinking) {
    out.thinking = thinking;
  } else {
    delete out.thinking;
    const maxTokens = body.max_tokens;
    if (typeof maxTokens === "number" && maxTokens > 0 && maxTokens < THINKING_ROOM) {
      out.max_tokens = maxTokens + THINKING_ROOM;
    }
  }
  if (effort !== "") {
    const config = isRecord(body.output_config) ? body.output_config : {};
    out.output_config = { ...config, effort };
  }
  return out;
}

/** 图片按 Anthropic 的写法：内嵌的给 base64，按地址的给地址。 */
function imageBlock(part: ImagePart): AnthropicBlock {
  const source =
    part.url !== "" && part.data === ""
      ? { type: "url", url: part.url }
      : { type: "base64", media_type: part.mediaType, data: part.data };
  return { type: "image", source };
}

/** tool_result 里文字旁边能放图片。 */
function toolResultBlock(part: ToolResultPart): AnthropicBlock {
  const block: AnthropicBlock = { type: "tool_result", tool_use_id: anthropicOutId(part.callId) };
  if (part.images.length === 0) {
    block.content = part.text;
  } else {
    const text: AnthropicBlock[] =
      part.text.trim() === "" ? [] : [{ type: "text", text: part.text }];
    block.content = [...text, ...part.images.map(imageBlock)];
  }
  if (part.isError) block.is_error = true;
  return block;
}

/**
 * 给回放推理的上游（DeepSeek 的 Anthropic 地址）：调用了工具、或回答只有工具结果的 assistant 消息
 * 没有思考块的，开头补一个空格的思考块；Claude 封存的 redacted_thinking 它读不了，换成空格的思考块
 * （消息里已有思考块就去掉）。返回要换内容的消息下标与新内容，别的消息不动。
 */
export function thinkingOnToolTurns(messages: unknown[]): Map<number, unknown[]> {
  const space = { type: "thinking", thinking: NO_REASONING };
  const changes = new Map<number, unknown[]>();
  // 前一条消息只有工具结果。
  let afterTool = false;
  messages.forEach((message, index) => {
    const blocks = isRecord(message) && Array.isArray(message.content) ? message.content : null;
    if (!isRecord(message) || message.role !== "assistant") {
      afterTool =
        blocks !== null &&
        blocks.length > 0 &&
        blocks.every((block) => isRecord(block) && block.type === "tool_result");
      return;
    }
    const after = afterTool;
    afterTool = false;
    if (blocks === null) return;
    const out: unknown[] = [];
    let thought = false;
    let called = false;
    let edited = false;
    for (const block of blocks) {
      const type = isRecord(block) ? block.type : undefined;
      if (type === "redacted_thinking") {
        edited = true;
        if (!thought) out.push(space);
        thought = true;
        continue;
      }
      if (type === "thinking") thought = true;
      if (type === "tool_use") called = true;
      out.push(block);
    }
    if ((called || after) && !thought) {
      out.unshift(space);
      edited = true;
    }
    if (edited) changes.set(index, out);
  });
  return changes;
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
 * Anthropic 事件流 → 中间事件。Anthropic 服务端工具（联网搜索）的块只报一个 other_tool，内容跳过；
 * tool_use 的 start 已带完整 input 时（中转站常见）就用它，不再等 input_json_delta。
 */
export class AnthropicDecoder {
  private readonly serverBlocks = new Set<number>();
  private readonly wholeInput = new Set<number>();

  decode(data: string, emit: EmitEvent): void {
    const event = parseJson(data);
    if (isRecord(event)) this.event(event, emit);
  }

  /** 整份回复（不流式）：照它流出来时的事件读一遍。错误体本身就是 error 事件的样子。 */
  whole(body: unknown, emit: EmitEvent): void {
    if (!isRecord(body)) return;
    if (body.type === "error") {
      this.event(body, emit);
      return;
    }
    this.event({ type: "message_start", message: body }, emit);
    const blocks = Array.isArray(body.content) ? body.content : [];
    blocks.forEach((block, index) => {
      this.event({ type: "content_block_start", index, content_block: block }, emit);
    });
    const delta = { stop_reason: body.stop_reason };
    this.event({ type: "message_delta", delta, usage: body.usage }, emit);
    this.event({ type: "message_stop" }, emit);
  }

  private event(event: Record<string, unknown>, emit: EmitEvent): void {
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
      case "message_stop":
        emit({ kind: "done" });
        return;
      case "error":
        emit({ kind: "error", ...errorOf(event.error), vendorError: null });
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
        if (callsTool(String(block.type))) emit({ kind: "other_tool" });
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
            ...vendorErrorFields(event.vendorError),
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
      case "image":
      case "file":
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
