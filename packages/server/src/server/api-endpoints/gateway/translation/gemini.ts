// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gateway/codeassist.go 的 buildCodeAssistSent（非 Antigravity、非 Code Assist 的分支）、
// codeAssistDecoder 与 stopFromGemini，gemini.go 的 buildGemini 与 geminiRequest）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { isRecord, parseJson } from "../../upstream-http.js";
import {
  emptyUsage,
  stringOf,
  type EmitEvent,
  type Format,
  type GatewayRequest,
  type Message,
  type StopReason,
  type Usage,
} from "./ir.js";

/*
 * Gemini（generateContent）只做上游方向：中间格式的请求构建成 Gemini 请求，Gemini 的流解码成中间事件。
 * 没有 Agent 说 Gemini，所以没有解析、编码与渲染。模型名在地址里（upstream-call.ts），请求体不带 model 与 stream；
 * 上游一律流式（streamGenerateContent?alt=sse），Agent 要整份时由中转站读流拼成整份。
 */

interface GeminiPart {
  text: string;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export function buildGeminiRequest(
  request: GatewayRequest,
  _model: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { contents: geminiContents(request.messages) };
  // Gemini 的 systemInstruction 不带 role（magpie geminiRequest）。
  if (request.system !== "") out.systemInstruction = { parts: [{ text: request.system }] };
  const generation = generationConfig(request);
  if (Object.keys(generation).length > 0) out.generationConfig = generation;
  return out;
}

/** assistant 是 model，其余是 user；相邻同角色的并成一轮。 */
function geminiContents(messages: Message[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    const role = message.role === "assistant" ? "model" : "user";
    const parts = message.parts.flatMap((part): GeminiPart[] =>
      part.kind === "text" && part.text !== "" ? [{ text: part.text }] : [],
    );
    if (parts.length === 0) continue;
    const last = contents.at(-1);
    if (last?.role === role) {
      last.parts.push(...parts);
      continue;
    }
    contents.push({ role, parts });
  }
  return contents;
}

/** 不设 safetySettings；topK、penalty、candidateCount 不映射（magpie 同样）。 */
function generationConfig(request: GatewayRequest): Record<string, unknown> {
  const generation: Record<string, unknown> = {};
  if (request.maxTokens > 0) generation.maxOutputTokens = request.maxTokens;
  if (request.temperature !== null) generation.temperature = request.temperature;
  if (request.topP !== null) generation.topP = request.topP;
  if (request.stop.length > 0) generation.stopSequences = request.stop;
  if (request.format !== null) Object.assign(generation, jsonAnswer(request.format));
  return generation;
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

/**
 * Gemini 的流：每个事件是一个 GenerateContentResponse。没有结束标记，带 finishReason 的 candidate 才算说完，
 * 只带 usageMetadata 的不算；prompt 用量随开始事件给（Claude Code 在一轮结束前就读它），完整用量随结束原因给。
 */
export class GeminiDecoder {
  private started = false;
  private stopped = false;
  private usage: Usage | null = null;

  decode(data: string, emit: EmitEvent): void {
    const chunk = parseJson(data);
    if (isRecord(chunk)) this.read(chunk, emit);
  }

  /** 整份回复（不流式）就是只有一个事件的流。 */
  whole(body: unknown, emit: EmitEvent): void {
    if (isRecord(body)) this.read(body, emit);
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
    if (this.stopped && this.usage !== null) {
      emit({ kind: "usage", usage: this.usage });
      this.usage = null;
    }
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
    for (const part of parts) {
      const text = stringOf(part.text);
      if (part.thought !== true && text !== "") emit({ kind: "text", text });
    }
    const reason = stringOf(candidate.finishReason);
    if (reason !== "" && !this.stopped) {
      this.stopped = true;
      emit({ kind: "stop", stop: stopFromGemini(reason) });
    }
  }
}
