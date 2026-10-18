// 接口模型的 compaction_trigger 换成摘要请求、读回摘要、把摘要当压缩条目交给 Codex 移植自 magpie
// （https://github.com/yetone/magpie，internal/gateway/codex_backend.go 的 codexInputAs、localCompactionTurn、
// localCompactionMeta、userMessage、codexCompact、compactReply 与 magpieCompaction）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
// 摘要提示与摘要前缀取自 openai/codex（Apache-2.0，prompts/templates/compact），同见该文件。

import type { Response } from "express";
import { isRecord, parseJson } from "../upstream-http.js";
import { sendAgentError } from "./agent-errors.js";
import { SseReader, sseEvent } from "./translation/sse.js";

/*
 * 用 ChatGPT 登录的 Codex 压缩对话时在 /responses 的 input 里放一个 compaction_trigger，等 ChatGPT 回一个
 * 加密的 compaction 条目。接口模型没有这一套：照 magpie，把 trigger 换成 Codex 自己向别的服务商要摘要时用的提示，
 * 不给工具，交给这个接口模型写摘要；摘要以 compaction 条目交回 Codex，encrypted_content 是 `osuna1:` 加摘要的 base64。
 * 之后的请求里 Codex 原样带回这个条目，换成 Codex 自己读摘要时的那条用户消息（接口模型与 ChatGPT 自带模型都换，
 * ChatGPT 读不懂 Osuna 的条目）。ChatGPT 自己的 compaction 条目与 ChatGPT 自带模型的 trigger 原样留给 ChatGPT。
 */

export const OSUNA_COMPACTION = "osuna1:";

export const CODEX_COMPACT_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`;

export const CODEX_SUMMARY_PREFIX =
  "Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:";

const TURN_METADATA = "x-codex-turn-metadata";
const ENDED_SHORT = "the reply ended before it was complete";

export type CodexCompactionInput =
  | { kind: "unchanged" }
  // compacts：这次是要摘要的请求（trigger 换掉了）。
  | { kind: "changed"; body: string; compacts: boolean };

interface InputItems {
  items: unknown[];
  isChanged: boolean;
  compacts: boolean;
}

/** 读回 Osuna 做的摘要；接口模型的 trigger 换成摘要请求（magpie codexInputAs）。没什么可改时 unchanged。 */
export function codexCompactionInput(input: {
  text: string;
  isEndpointModel: boolean;
}): CodexCompactionInput {
  const request = parseJson(input.text);
  if (!isRecord(request) || !Array.isArray(request.input)) return { kind: "unchanged" };
  const read = readItems({ items: request.input, isEndpointModel: input.isEndpointModel });
  if (!read.isChanged) return { kind: "unchanged" };
  const changed: Record<string, unknown> = { ...request, input: read.items };
  if (read.compacts) {
    // 摘要是文字：不给工具；流式与 tool_choice 照 Codex 向别的服务商要摘要时的写法（magpie #1511、#292）。
    changed.tools = [];
    changed.tool_choice = "auto";
    changed.parallel_tool_calls = false;
    const metadata = localCompactionMetadata(request.client_metadata);
    if (metadata !== null) changed.client_metadata = metadata;
  }
  return { kind: "changed", body: JSON.stringify(changed), compacts: read.compacts };
}

function readItems(input: { items: unknown[]; isEndpointModel: boolean }): InputItems {
  const read: InputItems = { items: [], isChanged: false, compacts: false };
  for (const item of input.items) {
    const summary = osunaSummaryOf(item);
    const isTrigger = isRecord(item) && item.type === "compaction_trigger";
    const isOurTrigger = isTrigger && input.isEndpointModel;
    if (summary !== null) {
      read.items.push(userMessage(`${CODEX_SUMMARY_PREFIX}\n${summary}`));
      read.isChanged = true;
    } else if (isOurTrigger) {
      read.items.push(userMessage(CODEX_COMPACT_PROMPT));
      read.isChanged = true;
      read.compacts = true;
    } else {
      read.items.push(item);
    }
  }
  return read;
}

/** Osuna 做的压缩条目里的摘要；ChatGPT 自己的（或别的）为 null。 */
function osunaSummaryOf(item: unknown): string | null {
  if (!isRecord(item)) return null;
  const isCompaction = item.type === "compaction" || item.type === "compaction_summary";
  const sealed = item.encrypted_content;
  const isOurs = typeof sealed === "string" && sealed.startsWith(OSUNA_COMPACTION);
  if (!isCompaction || !isOurs) return null;
  return Buffer.from(sealed.slice(OSUNA_COMPACTION.length), "base64").toString("utf8");
}

function userMessage(text: string) {
  return { type: "message", role: "user", content: [{ type: "input_text", text }] };
}

/**
 * 摘要请求的轮次元数据（请求头与 client_metadata 里的 x-codex-turn-metadata）：trigger 已经换掉，
 * compaction.implementation 改成 Codex 自己要摘要时写的 "responses"，其余逐字不变（magpie localCompactionTurn：
 * 只收 Codex 自己请求的中转站见过「说远程压缩却没带 trigger」会拒收）。不用改为 null。
 */
export function localCompactionTurn(meta: string): string | null {
  if (!meta.includes('"compaction"')) return null;
  const parsed = parseJson(meta);
  const compaction = isRecord(parsed) ? parsed.compaction : undefined;
  const implementation = isRecord(compaction) ? compaction.implementation : undefined;
  if (typeof implementation !== "string" || implementation === "responses") return null;
  const was = `"implementation":${JSON.stringify(implementation)}`;
  if (meta.split(was).length !== 2) return null;
  return meta.replace(was, '"implementation":"responses"');
}

function localCompactionMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!isRecord(metadata)) return null;
  const meta = metadata[TURN_METADATA];
  if (typeof meta !== "string") return null;
  const turn = localCompactionTurn(meta);
  if (turn === null) return null;
  return { ...metadata, [TURN_METADATA]: turn };
}

export type CompactionReply =
  | { kind: "summary"; id: string; summary: string; usage: unknown }
  | { kind: "failed"; message: string };

interface ReadReply {
  id: string;
  status: string | null;
  output: unknown[];
  doneItems: unknown[];
  usage: unknown;
  incompleteReason: string | null;
  failed: string | null;
}

/** 摘要请求的回复（流式或整份 JSON）里的摘要；出错、没说完、被截断的都不算摘要（magpie compactReply）。 */
export function compactionReplyOf(text: string): CompactionReply {
  const read = readReply(text);
  if (read.failed !== null) return { kind: "failed", message: read.failed };
  if (read.status === null) return { kind: "failed", message: ENDED_SHORT };
  if (read.status === "incomplete") {
    const reason = read.incompleteReason ?? "unknown";
    return { kind: "failed", message: `the reply ended incomplete (${reason})` };
  }
  const output = read.doneItems.length > 0 ? read.doneItems : read.output;
  return { kind: "summary", id: read.id, summary: messageText(output), usage: read.usage };
}

function readReply(text: string): ReadReply {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return readWholeReply(trimmed);
  return readStreamedReply(text);
}

function emptyReply(): ReadReply {
  return {
    id: "",
    status: null,
    output: [],
    doneItems: [],
    usage: null,
    incompleteReason: null,
    failed: null,
  };
}

function readWholeReply(text: string): ReadReply {
  const read = emptyReply();
  const reply = parseJson(text);
  if (!isRecord(reply)) return { ...read, failed: "the reply is not a response" };
  takeResponse(read, reply);
  read.status ??= "completed";
  return read;
}

function readStreamedReply(text: string): ReadReply {
  const read = emptyReply();
  const reader = new SseReader((data) => takeEvent(read, parseJson(data)));
  reader.feed(text);
  reader.end();
  return read;
}

function takeEvent(read: ReadReply, event: unknown): void {
  if (!isRecord(event)) return;
  const response = isRecord(event.response) ? event.response : null;
  if (response !== null && typeof response.id === "string" && response.id !== "") {
    read.id = response.id;
  }
  switch (event.type) {
    case "response.output_item.done":
      read.doneItems.push(event.item);
      return;
    case "response.completed":
    case "response.incomplete":
      if (response !== null) takeResponse(read, response);
      read.status ??= event.type.slice("response.".length);
      return;
    case "response.failed":
    case "error":
      read.failed = failureOf({ event, response });
      return;
  }
}

function takeResponse(read: ReadReply, response: Record<string, unknown>): void {
  if (typeof response.id === "string" && response.id !== "") read.id = response.id;
  if (typeof response.status === "string" && response.status !== "") read.status = response.status;
  if (Array.isArray(response.output)) read.output = response.output;
  if (response.usage !== undefined) read.usage = response.usage;
  const details = response.incomplete_details;
  if (isRecord(details) && typeof details.reason === "string")
    read.incompleteReason = details.reason;
}

function failureOf(input: {
  event: Record<string, unknown>;
  response: Record<string, unknown> | null;
}): string {
  const responseError = input.response?.error;
  if (isRecord(responseError) && isFilled(responseError.message)) return responseError.message;
  if (isFilled(input.event.message)) return input.event.message;
  const eventError = input.event.error;
  if (isRecord(eventError) && isFilled(eventError.message)) return eventError.message;
  return "the model failed";
}

function isFilled(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** 输出里各条消息的文字接起来。 */
function messageText(output: unknown[]): string {
  const messages = output.filter((item) => isRecord(item) && item.type === "message");
  const parts = messages.flatMap((message) =>
    isRecord(message) && Array.isArray(message.content) ? message.content : [],
  );
  return parts.map(partText).join("");
}

function partText(part: unknown): string {
  if (isRecord(part) && typeof part.text === "string") return part.text;
  return "";
}

/** 交给 Codex 的流：ChatGPT 会回的那个 compaction 条目，标成 Osuna 的（magpie codexCompact 的结尾）。 */
export function compactionEvents(input: { id: string; summary: string; usage: unknown }): string {
  const item = {
    type: "compaction",
    id: `cmp_${input.id.replace(/^resp_/, "")}`,
    encrypted_content: `${OSUNA_COMPACTION}${Buffer.from(input.summary).toString("base64")}`,
  };
  const done: Record<string, unknown> = {
    id: input.id,
    object: "response",
    status: "completed",
    output: [item],
  };
  if (input.usage !== null && input.usage !== undefined) done.usage = input.usage;
  const started = { id: input.id, object: "response", status: "in_progress", output: [] };
  const events = [
    { type: "response.created", response: started },
    { type: "response.output_item.added", output_index: 0, item },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: done },
  ];
  return events.map((event) => sseEvent(event.type, event)).join("");
}

/** 摘要请求问到的回复：状态码、Content-Type、回答的那家（中转站的 answered-by 头）与整份回复。 */
export interface CompactionAnswer {
  status: number;
  contentType: string | undefined;
  answeredBy: string | undefined;
  body: Buffer;
}

/**
 * 压缩一段接口模型的对话（magpie codexCompact）：摘要请求交给中转站按常规选路换家问，整份读回；
 * 失败的回复照原样交给 Codex；读不出摘要、没写摘要的回 502 说明；有摘要就以压缩条目的流交回。
 */
export async function answerCodexCompaction(input: {
  res: Response;
  model: string;
  ask: () => Promise<CompactionAnswer>;
}): Promise<void> {
  const { res } = input;
  const answer = await input.ask();
  if (res.destroyed) return;
  if (answer.status >= 400) {
    if (answer.contentType !== undefined) res.setHeader("content-type", answer.contentType);
    res.status(answer.status).end(answer.body);
    return;
  }
  const reply = compactionReplyOf(answer.body.toString("utf8"));
  const endpoint = answer.answeredBy ?? input.model.split("/")[0];
  const who = `${endpoint} (${input.model})`;
  const fail = (message: string) =>
    sendAgentError({ res, wire: "openai", error: { status: 502, message } });
  if (reply.kind === "failed") {
    fail(`compaction: ${who}: ${reply.message}, so there is no summary`);
    return;
  }
  if (reply.summary.trim() === "") {
    fail("compaction: the model wrote no summary");
    return;
  }
  let id = reply.id;
  if (id === "") id = `resp_osuna_${Date.now()}`;
  res
    .status(200)
    .set({ "content-type": "text/event-stream", "cache-control": "no-cache" })
    .end(compactionEvents({ id, summary: reply.summary, usage: reply.usage }));
}
