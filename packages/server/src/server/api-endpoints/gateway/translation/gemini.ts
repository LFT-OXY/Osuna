// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gateway/codeassist.go 的 buildCodeAssistSent（非 Antigravity、非 Code Assist 的分支）、
// dropSecondAnswers、pairFunctionTurns、thinkingConfig、geminiGeneration、codeAssistDecoder（含 toolOfCall、textCall、closeBrace、textArgs、nextKey）与 stopFromGemini，
// gemini.go 的 buildGemini 与 geminiRequest，internal/catalog/catalog.go 的 DrawsID）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { isRecord, parseJson } from "../../upstream-http.js";
import { SKIP_SIGNATURE, signedId, type GeminiSignatureStore } from "../gemini-signatures.js";
import { filteredBy } from "../safety-filter.js";
import { compacting } from "./compacting.js";
import {
  CONTINUE_TEXT,
  INTERRUPTED_TOOL,
  argsOf,
  budgetOf,
  effortOf,
  emptyUsage,
  newId,
  stringOf,
  type Effort,
  type FilePart,
  type ImagePart,
  type EmitEvent,
  type Format,
  type GatewayRequest,
  type Message,
  type SearchHit,
  type StopReason,
  type Usage,
} from "./ir.js";

/*
 * Gemini（generateContent）只做上游方向：中间格式的请求构建成 Gemini 请求，Gemini 的流解码成中间事件。
 * 没有 Agent 说 Gemini，所以没有解析、编码与渲染。模型名在地址里（upstream-call.ts），请求体不带 model 与 stream；
 * 上游一律流式（streamGenerateContent?alt=sse），Agent 要整份时由中转站读流拼成整份。
 */

type GeminiPart = Record<string, unknown>;

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

// 历史以模型的轮次开头时前插的一句（Gemini CLI 的 hardenHistory）。
const CONTINUING_TEXT = "[Continuing from previous AI thoughts...]";
// 压缩对话时以模型的轮次结尾，补的 user 轮请它写总结（magpie compactLastText）。
const COMPACT_LAST_TEXT =
  "Write the summary of the conversation above that the system prompt asks for.";
const EMPTY_SCHEMA = { type: "object", properties: {} };

export function buildGeminiRequest(
  request: GatewayRequest,
  model: string,
): Record<string, unknown> {
  const claude = model.toLowerCase().includes("claude");
  const out: Record<string, unknown> = { contents: geminiContents({ request, claude }) };
  // Gemini 的 systemInstruction 不带 role（magpie geminiRequest）。
  if (request.system !== "") out.systemInstruction = { parts: [{ text: request.system }] };
  Object.assign(out, geminiTools(request));
  const generation = generationConfig({ request, model, claude });
  if (Object.keys(generation).length > 0) out.generationConfig = generation;
  return out;
}

/**
 * 工具写成 functionDeclarations，schema 原样（不清洗），没有的补空对象；tool_choice none 不发工具。
 * 没有工具、要联网搜索时发 Google 自己的搜索：旁边声明了函数它就不搜（magpie codeAssistSearches）。
 */
function geminiTools(request: GatewayRequest): Record<string, unknown> {
  if (request.tools.length > 0 && request.toolChoice !== "none") {
    const declarations = request.tools.map((tool) => {
      const declaration: Record<string, unknown> = { name: tool.name };
      if (tool.description !== "") declaration.description = tool.description;
      declaration.parametersJsonSchema = tool.schema ?? EMPTY_SCHEMA;
      return declaration;
    });
    const calling: Record<string, unknown> = { mode: "AUTO" };
    if (request.toolChoice === "required") calling.mode = "ANY";
    if (request.toolChoice.startsWith("name:")) {
      calling.mode = "ANY";
      calling.allowedFunctionNames = [request.toolChoice.slice("name:".length)];
    }
    return {
      tools: [{ functionDeclarations: declarations }],
      toolConfig: { functionCallingConfig: calling },
    };
  }
  return request.webSearch ? { tools: [{ googleSearch: {} }] } : {};
}

/**
 * 对话写成 Gemini 的 contents（magpie buildCodeAssistSent）：assistant 是 model，其余是 user；思考不回传（签名只认它自己发的）。
 * Gemini 拒收的几种历史先修补：同一调用的第二个回答丢掉；带 functionResponse 的轮次里用户说的另起一轮；
 * 没被回答的调用补上中断的结果；以模型开头或结尾的历史前后补一条 user。
 */
function geminiContents(input: { request: GatewayRequest; claude: boolean }): GeminiContent[] {
  const { request, claude } = input;
  const names = new Map<string, string>();
  const contents: GeminiContent[] = [];
  for (const message of dropSecondAnswers(request.messages)) {
    const role = message.role === "assistant" ? "model" : "user";
    const { parts, toolImages } = messageParts({ message, names, claude });
    let said: GeminiPart[] = [];
    let own = parts;
    // 用户说的话跟 functionResponse 混在一轮里 Gemini 不收（magpie #1533），拆成两轮。
    if (role === "user" && parts.some(isResponse)) {
      own = parts.filter((part) => isResponse(part) || toolImages.has(part));
      said = parts.filter((part) => !isResponse(part) && !toolImages.has(part));
    }
    for (const group of [own, said]) {
      if (group.length > 0) appendTurn(contents, { role, parts: group });
    }
  }
  const paired = pairFunctionTurns(contents);
  if (paired[0]?.role === "model") {
    paired.unshift({ role: "user", parts: [{ text: CONTINUING_TEXT }] });
  }
  if (paired.at(-1)?.role === "model") {
    const ask = compacting(request) ? COMPACT_LAST_TEXT : CONTINUE_TEXT;
    paired.push({ role: "user", parts: [{ text: ask }] });
  }
  return paired;
}

/** 相邻同角色的并成一轮；user 轮只在两边都有或都没有 functionResponse 时并。 */
function appendTurn(contents: GeminiContent[], turn: GeminiContent): void {
  const last = contents.at(-1);
  const joins =
    last?.role === turn.role &&
    (turn.role !== "user" || last.parts.some(isResponse) === turn.parts.some(isResponse));
  if (last && joins) {
    last.parts.push(...turn.parts);
    return;
  }
  contents.push(turn);
}

function isResponse(part: GeminiPart): boolean {
  return part.functionResponse !== undefined;
}

/**
 * 一条消息的 parts；toolImages 是其中工具返回的图片（紧跟在它的 functionResponse 后）。
 * 签名：调用自己的签名照原样带回；一步里有调用签过名时，没签名的调用什么都不带（Gemini 只签第一个）；
 * 整步都没签名的每个调用带 skip。Claude 模型的调用一律带 skip，文字不带签名。
 */
function messageParts(input: { message: Message; names: Map<string, string>; claude: boolean }): {
  parts: GeminiPart[];
  toolImages: Set<GeminiPart>;
} {
  const { message, names, claude } = input;
  const signedStep = message.parts.some((part) => part.kind === "tool_call" && part.signature);
  const parts: GeminiPart[] = [];
  const toolImages = new Set<GeminiPart>();
  for (const part of message.parts) {
    switch (part.kind) {
      case "text":
        if (part.text !== "") parts.push({ text: part.text });
        break;
      case "image":
      case "file": {
        const media = mediaPart(part);
        if (media !== null) parts.push(media);
        break;
      }
      case "tool_call": {
        names.set(part.id, part.name);
        const call: Record<string, unknown> = {
          name: part.name,
          args: parseJson(argsOf(part)) ?? {},
        };
        if (part.id !== "") call.id = part.id;
        const out: GeminiPart = { functionCall: call };
        if (claude) out.thoughtSignature = SKIP_SIGNATURE;
        else if (part.signature) out.thoughtSignature = part.signature;
        else if (!signedStep) out.thoughtSignature = SKIP_SIGNATURE;
        parts.push(out);
        break;
      }
      case "tool_result": {
        const key = part.isError ? "error" : "output";
        const response: Record<string, unknown> = {
          name: names.get(part.callId) || "tool",
          response: { [key]: part.text },
        };
        if (part.callId !== "") response.id = part.callId;
        parts.push({ functionResponse: response });
        for (const image of part.images) {
          const media = mediaPart(image);
          if (media === null) continue;
          toolImages.add(media);
          parts.push(media);
        }
        break;
      }
      default:
      // 思考不回传；联网搜索只出现在回复里。
    }
  }
  return { parts, toolImages };
}

/** 有内容的发 inlineData；只有地址的发 fileData，不下载（magpie 同样，http 地址没有 mimeType）。 */
function mediaPart(part: ImagePart | FilePart): GeminiPart | null {
  if (part.data !== "") return { inlineData: { mimeType: part.mediaType, data: part.data } };
  if (part.url !== "") return { fileData: { mimeType: part.mediaType, fileUri: part.url } };
  return null;
}

/**
 * 同一个调用被回答了两次只留第一次：Gemini 的调用数与回答数对不上就拒（magpie dropSecondAnswers，#2262）。
 * 同一 id 的调用再出现时可以再被回答一次；没有 id 的结果不动。
 */
function dropSecondAnswers(messages: Message[]): Message[] {
  const answered = new Set<string>();
  const out: Message[] = [];
  for (const message of messages) {
    const parts = message.parts.filter((part) => {
      if (part.kind === "tool_call" && part.id !== "") answered.delete(part.id);
      if (part.kind !== "tool_result" || part.callId === "") return true;
      if (answered.has(part.callId)) return false;
      answered.add(part.callId);
      return true;
    });
    if (parts.length > 0) out.push({ role: message.role, parts });
  }
  return out;
}

/**
 * 模型轮次的调用在紧接着的轮次里都要有回答：哪儿都没回答的（被中断的一轮）补上中断的结果（magpie pairFunctionTurns）。
 * 下一轮已经是回答的轮次就补进它的开头，不然另起一轮放在它前面。没有 id 的调用按同名的、没有 id 的回答算答过。
 */
function pairFunctionTurns(contents: GeminiContent[]): GeminiContent[] {
  const answered = new Set<string>();
  const answeredNames = new Set<string>();
  for (const turn of contents) {
    for (const part of turn.parts) {
      const response = part.functionResponse;
      if (!isRecord(response)) continue;
      const id = stringOf(response.id);
      if (id !== "") answered.add(id);
      else answeredNames.add(stringOf(response.name));
    }
  }
  const out: GeminiContent[] = [];
  contents.forEach((turn, index) => {
    out.push(turn);
    if (turn.role !== "model") return;
    const missing: GeminiPart[] = [];
    for (const part of turn.parts) {
      const call = part.functionCall;
      if (!isRecord(call)) continue;
      const id = stringOf(call.id);
      const name = stringOf(call.name);
      if (id !== "" ? answered.has(id) : answeredNames.has(name)) continue;
      const response: Record<string, unknown> = { name, response: { output: INTERRUPTED_TOOL } };
      if (id !== "") response.id = id;
      missing.push({ functionResponse: response });
    }
    if (missing.length === 0) return;
    const next = contents[index + 1];
    if (next?.role === "user" && next.parts.some(isResponse)) {
      next.parts.unshift(...missing);
      return;
    }
    out.push({ role: "user", parts: missing });
  });
  return out;
}

/** 不设 safetySettings；topK、penalty、candidateCount 不映射（magpie 同样）。 */
function generationConfig(input: {
  request: GatewayRequest;
  model: string;
  claude: boolean;
}): Record<string, unknown> {
  const { request, model, claude } = input;
  const generation: Record<string, unknown> = {};
  if (request.maxTokens > 0) generation.maxOutputTokens = request.maxTokens;
  if (request.temperature !== null) generation.temperature = request.temperature;
  if (request.topP !== null) generation.topP = request.topP;
  if (request.stop.length > 0) generation.stopSequences = request.stop;
  const thinking = thinkingConfig({ request, model, claude });
  if (thinking !== null) {
    generation.thinkingConfig = thinking;
    // Claude 的回答要在思考之外留出地方（magpie 同样）。
    const budget = thinking.thinkingBudget;
    const needsRoomPastBudget =
      claude && typeof budget === "number" && generation.maxOutputTokens === undefined;
    if (needsRoomPastBudget) generation.maxOutputTokens = Number(budget) + 32_000;
  }
  if (request.format !== null) Object.assign(generation, jsonAnswer(request.format));
  // 画图模型要同时要图片才会画。
  if (drawsImages(model)) generation.responseModalities = ["TEXT", "IMAGE"];
  return generation;
}

// 名字里带这些词的是画图模型（magpie catalog.DrawsID）。
const DRAWING_WORDS = [
  "image",
  "imagen",
  "imagine",
  "dall-e",
  "flux",
  "seedream",
  "cogview",
  "stable-diffusion",
  "sdxl",
  "wanx",
  "kolors",
  "hidream",
  "banana",
];

function drawsImages(model: string): boolean {
  const id = model.toLowerCase();
  return DRAWING_WORDS.some((word) => id.includes(word));
}

/** 名字里的 Gemini 代数（gemini-4-argon、models/gemini-3.8-flash）；看不出为 0。 */
function geminiGeneration(model: string): number {
  const match = /(?:^|\/)gemini-(\d+)/.exec(model);
  return match ? Number(match[1]) : 0;
}

/**
 * 想多深：3 代起（含 gemini-pro-agent）给档位，其余给预算（magpie thinkingConfig）。没要思考、也没给档位的不发；
 * 档位已按模型自己的档位表收敛（requestForModel）。关推理的请求档位是 low（effortOf），照 low 发，不发 0。
 * 3 代的 medium：Flash 与更新的代给 medium，3 代 Pro 只有 low 与 high，给 high；minimal 给 low，画图模型可能没有 low，给 high。
 */
function thinkingConfig(input: {
  request: GatewayRequest;
  model: string;
  claude: boolean;
}): Record<string, unknown> | null {
  const { request, claude } = input;
  const model = input.model.toLowerCase();
  if (model.startsWith("gpt-oss")) return null;
  if (claude && !model.includes("thinking")) return null;
  // 要思考的 Claude 也得说想多少。
  const notAsked = request.effort === "" && !request.thinking;
  if (notAsked && !claude) return null;
  const config: Record<string, unknown> = { includeThoughts: true };
  const generation = geminiGeneration(model);
  if (generation >= 3 || model.startsWith("gemini-pro-agent")) {
    if (request.effort !== "")
      config.thinkingLevel = thinkingLevel({ ...input, model, generation });
    return config;
  }
  // 先把档位名统一（minimal 归到 low），再换预算（magpie budgetOf(effortOf(…))）。
  let budget = budgetOf(effortOf(request.effort));
  const budgetFillsReply = request.maxTokens > 0 && budget >= request.maxTokens;
  if (claude && budgetFillsReply) {
    budget = request.maxTokens - 1;
    if (budget < 1024) return null;
  }
  config.thinkingBudget = budget;
  return config;
}

type ThinkingLevel = "low" | "medium" | "high";

function thinkingLevel(input: {
  request: GatewayRequest;
  model: string;
  generation: number;
}): ThinkingLevel {
  const effort: Effort = input.request.effort;
  const flash = input.model.includes("flash");
  if (effort === "low") return "low";
  if (effort === "minimal" && !drawsImages(input.model)) return "low";
  if (effort === "medium" && (flash || input.generation > 3)) return "medium";
  return "high";
}

function jsonAnswer(format: Format): Record<string, unknown> {
  const asked: Record<string, unknown> = { responseMimeType: "application/json" };
  if (format.type === "json_schema") asked.responseJsonSchema = format.schema;
  return asked;
}

/** Gemini 的用量：prompt 含缓存，candidates 不含思考（magpie codeAssistDecoder）。 */
function usageFromGemini(metadata: Record<string, unknown>): Usage {
  function count(key: string): number {
    const value = Number(metadata[key]);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  const cached = count("cachedContentTokenCount");
  const thoughts = count("thoughtsTokenCount");
  return {
    ...emptyUsage(),
    input: Math.max(count("promptTokenCount") - cached, 0),
    cacheRead: cached,
    output: count("candidatesTokenCount") + thoughts,
    reasoning: thoughts,
  };
}

/** 错误说了什么：字符串本身，或对象的 message、没有 message 时它的 type（magpie streamErrorText）。 */
function geminiErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim() !== "") return error.trim();
  if (isRecord(error)) {
    const said = stringOf(error.message).trim() || stringOf(error.type);
    if (said !== "") return said;
  }
  return "the upstream reported an error";
}

function stopFromGemini(reason: string): StopReason {
  switch (reason) {
    case "MAX_TOKENS":
      return "length";
    case "STOP":
    case "FINISH_REASON_UNSPECIFIED":
    case "OTHER":
    case "MALFORMED_FUNCTION_CALL":
    case "UNEXPECTED_TOOL_CALL":
      return "stop";
    default:
      // SAFETY、RECITATION、BLOCKLIST、PROHIBITED_CONTENT、SPII……
      return "filter";
  }
}

// Gemini 自己的工具在 default_api 命名空间里，模型偶尔把 Agent 的工具也这样叫，或干脆把调用写进正文（magpie #636）。
const NAMESPACE = "default_api";
const CALL_MARKER = `call:${NAMESPACE}:`;
// 写在正文里的调用最长这么多：更长的当它就是文字。
const MAX_HELD = 256 << 10;
// 正文里写的调用给字符串加的引号。
const CTRL46 = "<ctrl46>";

/** 调用的工具名去掉 Gemini 的命名空间。 */
function toolOfCall(name: string): string {
  for (const separator of [":", "."]) {
    const prefix = `${NAMESPACE}${separator}`;
    if (name.startsWith(prefix) && name.length > prefix.length) return name.slice(prefix.length);
  }
  return name;
}

/**
 * Gemini 的流：每个事件是一个 GenerateContentResponse。没有结束标记，带 finishReason 的 candidate 才算说完，
 * 只带 usageMetadata 的不算；prompt 用量随开始事件给（Claude Code 在一轮结束前就读它），完整用量随结束原因给。
 * thought 的部分是思考，签名随后；调用的签名藏进交给 Agent 的调用 id（signedId），下一轮从 id 上取回；
 * 没 id 的调用补 call_<随机>。文字上的签名不交给 Agent：三种 Agent 的格式都带不回来（magpie 的编码器同样不写）。
 */
export class GeminiDecoder {
  private started = false;
  private stopped = false;
  private ended = false;
  private searched = false;
  private calledTools = false;
  private usage: Usage | null = null;
  // 可能是写在正文里的调用开头、还没收全的文字。
  private held = "";

  // 没有签名存放时（只为认出回复里有什么）调用 id 不带签名。
  constructor(private readonly options: { signatures?: GeminiSignatureStore } = {}) {}

  decode(data: string, emit: EmitEvent): void {
    const chunk = parseJson(data);
    if (isRecord(chunk)) this.read(chunk, emit);
  }

  /** 整份回复（不流式）就是只有一个事件的流。 */
  whole(body: unknown, emit: EmitEvent): void {
    if (isRecord(body)) this.read(body, emit);
    this.end(emit);
  }

  end(emit: EmitEvent): void {
    this.flush(emit);
  }

  private read(chunk: Record<string, unknown>, emit: EmitEvent): void {
    if (chunk.error !== undefined && chunk.error !== null) {
      emit({
        kind: "error",
        message: geminiErrorMessage(chunk.error),
        code: null,
        vendorError: null,
      });
      return;
    }
    if (isRecord(chunk.usageMetadata)) this.usage = usageFromGemini(chunk.usageMetadata);
    if (!this.started) this.start(chunk, emit);
    const candidates = Array.isArray(chunk.candidates) ? chunk.candidates.filter(isRecord) : [];
    for (const candidate of candidates) this.readCandidate(candidate, emit);
    if (isRecord(chunk.promptFeedback)) this.readBlocked(chunk.promptFeedback, emit);
    if (this.stopped && this.usage !== null) {
      emit({ kind: "usage", usage: this.usage });
      this.usage = null;
    }
    // 不带 candidates 的 chunk（只有用量、提示词被挡）也说完了，没说什么的交给空回复；带着空数组的不算（magpie geminiEnds）。
    if (chunk.candidates === undefined && !this.ended) {
      this.ended = true;
      emit({ kind: "done" });
    }
  }

  /** 提示词被安全过滤挡下（promptFeedback.blockReason）：以拒答结束；别的原因不算拒答。 */
  private readBlocked(feedback: Record<string, unknown>, emit: EmitEvent): void {
    if (this.stopped || !filteredBy(stringOf(feedback.blockReason))) return;
    this.flush(emit);
    this.stopped = true;
    emit({ kind: "stop", stop: "filter" });
  }

  private start(chunk: Record<string, unknown>, emit: EmitEvent): void {
    this.started = true;
    const prompt = emptyUsage();
    if (this.usage !== null) {
      prompt.input = this.usage.input;
      prompt.cacheRead = this.usage.cacheRead;
    }
    emit({ kind: "start", id: stringOf(chunk.responseId), usage: prompt });
  }

  private readCandidate(candidate: Record<string, unknown>, emit: EmitEvent): void {
    const content = isRecord(candidate.content) ? candidate.content : {};
    const parts = Array.isArray(content.parts) ? content.parts.filter(isRecord) : [];
    for (const part of parts) this.readPart(part, emit);
    if (isRecord(candidate.groundingMetadata) && !this.searched) {
      this.readSearch(candidate.groundingMetadata, emit);
    }
    const reason = stringOf(candidate.finishReason);
    if (reason !== "" && !this.stopped) {
      this.flush(emit);
      this.stopped = true;
      const stop = stopFromGemini(reason);
      emit({ kind: "stop", stop: this.calledTools && stop === "stop" ? "tool" : stop });
    }
  }

  private readPart(part: Record<string, unknown>, emit: EmitEvent): void {
    const signature = stringOf(part.thoughtSignature);
    if (isRecord(part.functionCall)) {
      this.flush(emit);
      const call = part.functionCall;
      const id = stringOf(call.id) || `call_${newId()}`;
      const args = isRecord(call.args) ? JSON.stringify(call.args) : "{}";
      const store = this.options.signatures;
      const signedCall = store ? signedId({ id, signature, store }) : id;
      this.call({ id: signedCall, name: toolOfCall(stringOf(call.name)), args }, emit);
      return;
    }
    if (part.thought === true) {
      this.flush(emit);
      const text = stringOf(part.text);
      if (text !== "") emit({ kind: "think", text });
      if (signature !== "") emit({ kind: "sig", text: signature });
      return;
    }
    const inline = isRecord(part.inlineData) ? part.inlineData : null;
    if (inline !== null && stringOf(inline.data) !== "") {
      // 画图模型画的图（gemini-*-image）。
      this.flush(emit);
      emit({ kind: "image", mediaType: stringOf(inline.mimeType), data: stringOf(inline.data) });
      return;
    }
    const text = stringOf(part.text);
    if (text !== "") this.text(text, emit);
  }

  /** googleSearch 找到的：查询词，与按站名、Google 的跳转地址给的页面。一份回复只读一次。 */
  private readSearch(grounding: Record<string, unknown>, emit: EmitEvent): void {
    const chunks = Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks : [];
    const hits = chunks.flatMap((chunk): SearchHit[] => {
      if (!isRecord(chunk) || !isRecord(chunk.web)) return [];
      const url = stringOf(chunk.web.uri);
      if (url === "") return [];
      return [{ title: stringOf(chunk.web.title) || url, url, pageAge: "" }];
    });
    const queries = Array.isArray(grounding.webSearchQueries)
      ? grounding.webSearchQueries.filter((query): query is string => typeof query === "string")
      : [];
    if (hits.length === 0 && queries.length === 0) return;
    this.flush(emit);
    this.searched = true;
    emit({ kind: "search", query: queries.join("; "), hits });
  }

  /** 文字照常交出；其中写成 call:default_api:x{…} 的调用变成真调用，可能是它开头的尾巴等下一段。 */
  private text(piece: string, emit: EmitEvent): void {
    let rest = this.held + piece;
    this.held = "";
    const say = (text: string) => {
      if (text !== "") emit({ kind: "text", text });
    };
    while (rest !== "") {
      const at = rest.indexOf(CALL_MARKER);
      if (at < 0) {
        let kept = CALL_MARKER.length - 1;
        while (kept > 0 && !rest.endsWith(CALL_MARKER.slice(0, kept))) kept--;
        say(rest.slice(0, rest.length - kept));
        this.held = rest.slice(rest.length - kept);
        return;
      }
      say(rest.slice(0, at));
      rest = rest.slice(at);
      const call = textCall(rest);
      if (call === "partial" && rest.length < MAX_HELD) {
        this.held = rest;
        return;
      }
      if (call === "partial" || call === "none") {
        say(rest.slice(0, CALL_MARKER.length));
        rest = rest.slice(CALL_MARKER.length);
        continue;
      }
      this.call({ id: `call_${newId()}`, name: call.name, args: call.args }, emit);
      rest = rest.slice(call.length);
    }
  }

  private call(call: { id: string; name: string; args: string }, emit: EmitEvent): void {
    this.calledTools = true;
    emit({ kind: "tool_start", id: call.id, name: call.name });
    emit({ kind: "tool_args", text: call.args });
  }

  /** 扣着的文字照文字交出：后面来的不是它的下文。 */
  private flush(emit: EmitEvent): void {
    if (this.held === "") return;
    emit({ kind: "text", text: this.held });
    this.held = "";
  }
}

type TextCall = { name: string; args: string; length: number } | "partial" | "none";

/** rest 开头写成文字的调用 call:default_api:<工具>{<参数>}：还没收全为 partial，不是调用为 none。 */
function textCall(rest: string): TextCall {
  let end = CALL_MARKER.length;
  while (end < rest.length && isIdent(rest.charAt(end))) end++;
  if (end === rest.length) return "partial";
  const name = rest.slice(CALL_MARKER.length, end);
  if (name === "" || rest.charAt(end) !== "{") return "none";
  const close = closeBrace(rest, end);
  if (close < 0) return "partial";
  const args = textArgs(rest.slice(end + 1, close));
  if (args === null) return "none";
  return { name, args, length: close + 1 };
}

function isIdent(char: string): boolean {
  return /^[A-Za-z0-9_.-]$/.test(char);
}

/** at 处的 { 在哪里闭合，<ctrl46> 引号里的括号不算；在 text 里没闭合为 -1。 */
function closeBrace(text: string, at: number): number {
  let depth = 0;
  let index = at;
  while (index < text.length) {
    if (text.startsWith(CTRL46, index)) {
      const closing = text.indexOf(CTRL46, index + CTRL46.length);
      if (closing < 0) return -1;
      index = closing + CTRL46.length;
      continue;
    }
    const char = text.charAt(index);
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return index;
    }
    index++;
  }
  return -1;
}

/** 写成文字的调用的参数写成 JSON 对象：本来就是 JSON 的成员，或 key:value，值用 <ctrl46> 引起、是 JSON、或一直到下一个 ",key:"。 */
function textArgs(raw: string): string | null {
  let body = raw.trim();
  if (body === "") return "{}";
  const asObject = `{${body}}`;
  if (parseJson(asObject) !== undefined) return asObject;
  const members: string[] = [];
  while (body !== "") {
    let keyEnd = 0;
    while (keyEnd < body.length && isIdent(body.charAt(keyEnd))) keyEnd++;
    if (keyEnd === 0 || keyEnd === body.length || body.charAt(keyEnd) !== ":") return null;
    const key = JSON.stringify(body.slice(0, keyEnd));
    body = body.slice(keyEnd + 1);
    const member = body.startsWith(CTRL46) ? quotedValue(body) : bareValue(body);
    if (member === null) return null;
    body = member.rest;
    members.push(`${key}:${member.value}`);
  }
  return `{${members.join(",")}}`;
}

interface ReadValue {
  value: string;
  // 这个值与它后面的逗号之后剩下的。
  rest: string;
}

/** <ctrl46> 引起的值；后面不是逗号或尽头为 null。 */
function quotedValue(body: string): ReadValue | null {
  const quoted = body.slice(CTRL46.length);
  const closing = quoted.indexOf(CTRL46);
  if (closing < 0) return null;
  const after = quoted.slice(closing + CTRL46.length).trimStart();
  if (after !== "" && !after.startsWith(",")) return null;
  const rest = after === "" ? "" : after.slice(1).trimStart();
  return { value: JSON.stringify(quoted.slice(0, closing)), rest };
}

/** 不带引号的值：是 JSON 就原样，不然当字符串。 */
function bareValue(body: string): ReadValue {
  const end = nextKey(body);
  const bare = body.slice(0, end).trim();
  const value = parseJson(bare) !== undefined ? bare : JSON.stringify(bare);
  const after = body.slice(end);
  return { value, rest: after === "" ? "" : after.slice(1).trimStart() };
}

/** 不带引号的值到哪儿为止：括号外下一个 ",key:" 的逗号，或到尽头。 */
function nextKey(text: string): number {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      let at = index + 1;
      while (text.charAt(at) === " ") at++;
      const start = at;
      while (at < text.length && isIdent(text.charAt(at))) at++;
      if (at > start && text.charAt(at) === ":") return index;
    }
  }
  return text.length;
}
