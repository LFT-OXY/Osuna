// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gateway/responses.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { isRecord, parseJson } from "../../upstream-http.js";
import { INTERRUPTED_TOOL, TOOL_RESULT_RECEIVED, stringOrText } from "./ir.js";

/*
 * OpenAI Responses 协议。工单 05 只有工具配对修补，直通前按 joinToolRuns → orphanedToolOutputs
 * → pairToolItems 的顺序做（magpie 的 attempt）；整套互译在工单 07。
 * 修补都作用于请求体原文的 input 数组，没什么可改时原文逐字节返回。
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
