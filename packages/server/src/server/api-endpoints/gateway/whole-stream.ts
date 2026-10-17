// 整份回复的认法与改写成事件流移植自 magpie（https://github.com/yetone/magpie，internal/gateway/whole_stream.go 的 wholeEvents、anthropicWholeEvents、responsesWholeEvents、chatWholeEvents 的认法）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { isRecord } from "../upstream-http.js";

/*
 * 上游没理会 stream: true、回了整份 JSON：先认它是不是这个协议的整份回复（`{}`、错误体、别的 JSON 都不是）。
 * 直通时保活已经回了事件流的响应头，整份回复只能照这个协议的流写出（wholeEvents）：每一项、每一块按厂商写的样子，
 * 放进流它们的事件里，不经中间格式。Chat 不会直通（Agent 只说 Anthropic 与 Responses），只认不写。
 */

/** 这个协议的整份回复：Anthropic 的 message、Responses 的 response、Chat 每个 choice 都带 message 的 completion。 */
export function isWholeReply(format: ApiEndpointRequestFormat, body: unknown): boolean {
  if (!isRecord(body)) return false;
  switch (format) {
    case "anthropic_messages":
      return body.type === "message" && Array.isArray(body.content);
    case "openai_responses":
      return body.object === "response" && Array.isArray(body.output);
    case "openai_chat":
      return isChatCompletion(body.choices);
  }
}

function isChatCompletion(choices: unknown): boolean {
  if (!Array.isArray(choices) || choices.length === 0) return false;
  return choices.every((choice) => isRecord(choice) && isRecord(choice.message));
}

/** 流里的一个事件：事件名（`event:` 行）与 data。 */
export interface WholeEvent {
  name: string;
  data: Record<string, unknown>;
}

/** 整份回复照这个协议的流说一遍的事件；不是这个协议的整份回复为 null。直通只有 Agent 说的两种格式，Chat 不会来。 */
export function wholeEvents(format: ApiEndpointRequestFormat, body: unknown): WholeEvent[] | null {
  if (!isRecord(body) || !isWholeReply(format, body)) return null;
  switch (format) {
    case "anthropic_messages":
      return anthropicWholeEvents(body);
    case "openai_responses":
      return responsesWholeEvents(body);
    case "openai_chat":
      return null;
  }
}

/**
 * Anthropic 的 message：先开一个没有内容的 message，每一块空着开、内容按增量给（文字、思考与签名、调用的 input），
 * 不流增量的块整块给；最后是结束原因与用量。
 */
function anthropicWholeEvents(message: Record<string, unknown>): WholeEvent[] {
  const events: WholeEvent[] = [];
  const send: SendEvent = (name, fields) => {
    events.push({ name, data: { ...fields, type: name } });
  };
  const usage = isRecord(message.usage) ? message.usage : null;
  const start: Record<string, unknown> = {
    ...message,
    content: [],
    stop_reason: null,
    stop_sequence: null,
  };
  // 自动模式对调用的审查是流里最后说的，在 message_delta 里（Claude Code 在那里读）。
  delete start.safeguard_results;
  // 输出边说边计，在 message_delta 里。
  if (usage !== null) start.usage = { ...usage, output_tokens: 0 };
  send("message_start", { message: start });
  listOf(message.content)
    .filter(isRecord)
    .forEach((block, index) => {
      sendBlock({ block, index, send });
      send("content_block_stop", { index });
    });
  send("message_delta", messageDelta(message, usage));
  send("message_stop", {});
  return events;
}

/** 一块空着开，内容按增量给（stop 由调用方给）。 */
function sendBlock(input: {
  block: Record<string, unknown>;
  index: number;
  send: SendEvent;
}): void {
  const { block, index, send } = input;
  const delta = (fields: Record<string, unknown>) =>
    send("content_block_delta", { index, delta: fields });
  const begin = (contentBlock: Record<string, unknown>) =>
    send("content_block_start", { index, content_block: contentBlock });
  switch (block.type) {
    case "text": {
      const text = stringOf(block.text);
      begin(emptiedText(block));
      for (const citation of listOf(block.citations)) delta({ type: "citations_delta", citation });
      delta({ type: "text_delta", text });
      return;
    }
    case "thinking": {
      const thinking = stringOf(block.thinking);
      begin({ ...block, thinking: "", signature: "" });
      delta({ type: "thinking_delta", thinking });
      if (stringOf(block.signature) !== "") {
        delta({ type: "signature_delta", signature: block.signature });
      }
      return;
    }
    case "tool_use":
    case "server_tool_use":
    case "mcp_tool_use": {
      const args = JSON.stringify(block.input ?? {});
      begin({ ...block, input: {} });
      delta({ type: "input_json_delta", partial_json: args });
      return;
    }
    default:
      // 隐去的思考、搜索结果……：整块给。
      begin(block);
  }
}

/** 文字块空着开：有引用的，引用也空着，随后逐条给。 */
function emptiedText(block: Record<string, unknown>): Record<string, unknown> {
  const empty: Record<string, unknown> = { ...block, text: "" };
  if ("citations" in block) empty.citations = [];
  return empty;
}

/** 结束原因、停在哪、拒答的细节（客户端从这个事件读，不论是不是 null），容器与审查结果照带。 */
function messageDelta(
  message: Record<string, unknown>,
  usage: Record<string, unknown> | null,
): Record<string, unknown> {
  const stop: Record<string, unknown> = {};
  for (const key of ["stop_reason", "stop_sequence", "stop_details"])
    stop[key] = message[key] ?? null;
  if ("container" in message) stop.container = message.container;
  if ("safeguard_results" in message) stop.safeguard_results = message.safeguard_results;
  const end: Record<string, unknown> = { delta: stop };
  if (usage !== null) end.usage = usage;
  return end;
}

/**
 * Responses 的 response：先是没有输出的 created 与 in_progress，每个输出项 added、它的文字（含引用）、拒答、
 * 推理摘要或调用参数按增量给并各自收尾，项按厂商写的样子 done，最后整份 completed（或 incomplete、failed）。
 */
function responsesWholeEvents(response: Record<string, unknown>): WholeEvent[] {
  const events: WholeEvent[] = [];
  const send: SendEvent = (name, fields) => {
    const sequence = events.length;
    events.push({ name, data: { ...fields, type: name, sequence_number: sequence } });
  };
  const begun: Record<string, unknown> = { ...response, status: "in_progress", output: [] };
  for (const key of ["usage", "incomplete_details", "error", "completed_at"]) delete begun[key];
  send("response.created", { response: begun });
  send("response.in_progress", { response: begun });
  listOf(response.output)
    .filter(isRecord)
    .forEach((item, outputIndex) => {
      sendItem({ item, outputIndex, send });
      send("response.output_item.done", { output_index: outputIndex, item });
    });
  send(responseEnd(response.status), { response });
  return events;
}

type SendEvent = (name: string, fields: Record<string, unknown>) => void;

/** 一个输出项开头到内容说完（done 由调用方给）。 */
function sendItem(input: {
  item: Record<string, unknown>;
  outputIndex: number;
  send: SendEvent;
}): void {
  const { item, outputIndex, send } = input;
  const added: Record<string, unknown> = { ...item };
  if ("status" in added) added.status = "in_progress";
  const at = { item_id: item.id, output_index: outputIndex };
  const args = stringOf(item.arguments);
  switch (item.type) {
    case "message":
      send("response.output_item.added", {
        output_index: outputIndex,
        item: { ...added, content: [] },
      });
      listOf(item.content)
        .filter(isRecord)
        .forEach((part, contentIndex) => {
          sendMessagePart({ part, ids: { ...at, content_index: contentIndex }, send });
        });
      return;
    case "reasoning":
      send("response.output_item.added", {
        output_index: outputIndex,
        item: { ...added, summary: [] },
      });
      listOf(item.summary)
        .filter(isRecord)
        .forEach((part, summaryIndex) => {
          sendSummaryPart({ part, ids: { ...at, summary_index: summaryIndex }, send });
        });
      return;
    case "function_call":
      // 没有 id 的，没有事件能指名它：整项给。
      if (stringOf(item.id) === "") break;
      send("response.output_item.added", {
        output_index: outputIndex,
        item: { ...added, arguments: "" },
      });
      send("response.function_call_arguments.delta", { ...at, delta: args });
      send("response.function_call_arguments.done", { ...at, arguments: args });
      return;
    default:
    // 自定义工具的调用、联网搜索、图片……：整项给。
  }
  send("response.output_item.added", { output_index: outputIndex, item });
}

/** 一段消息内容：文字（含引用，客户端只从这些事件读引用）、拒答，别的整段给。 */
function sendMessagePart(input: {
  part: Record<string, unknown>;
  ids: Record<string, unknown>;
  send: SendEvent;
}): void {
  const { part, ids, send } = input;
  switch (part.type) {
    case "output_text": {
      const text = stringOf(part.text);
      const emptyPart = { type: "output_text", text: "", annotations: [] };
      send("response.content_part.added", { ...ids, part: emptyPart });
      send("response.output_text.delta", { ...ids, delta: text, logprobs: [] });
      listOf(part.annotations).forEach((annotation, annotationIndex) => {
        send("response.output_text.annotation.added", {
          ...ids,
          annotation_index: annotationIndex,
          annotation,
        });
      });
      send("response.output_text.done", { ...ids, text, logprobs: [] });
      break;
    }
    case "refusal": {
      const refusal = stringOf(part.refusal);
      send("response.content_part.added", { ...ids, part: { type: "refusal", refusal: "" } });
      send("response.refusal.delta", { ...ids, delta: refusal });
      send("response.refusal.done", { ...ids, refusal });
      break;
    }
    default:
      send("response.content_part.added", { ...ids, part });
  }
  send("response.content_part.done", { ...ids, part });
}

/** 一段推理摘要。 */
function sendSummaryPart(input: {
  part: Record<string, unknown>;
  ids: Record<string, unknown>;
  send: SendEvent;
}): void {
  const { part, ids, send } = input;
  const text = stringOf(part.text);
  const emptyPart = { type: "summary_text", text: "" };
  send("response.reasoning_summary_part.added", { ...ids, part: emptyPart });
  send("response.reasoning_summary_text.delta", { ...ids, delta: text });
  send("response.reasoning_summary_text.done", { ...ids, text });
  send("response.reasoning_summary_part.done", { ...ids, part });
}

/** response 的最后一个事件按它的 status 取。 */
function responseEnd(status: unknown): string {
  if (status === "incomplete") return "response.incomplete";
  if (status === "failed") return "response.failed";
  return "response.completed";
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}
