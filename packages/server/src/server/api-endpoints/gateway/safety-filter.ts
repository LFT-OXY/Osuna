// 拒答的认法移植自 magpie（https://github.com/yetone/magpie，internal/gateway/fallback.go 的 filterReasons、policyCode、flaggedWords、
// policyRefusal、highRiskRefusal、refusedNote、refusedDetail、refusedCode、refusedReply）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { isRecord, parseJson } from "../upstream-http.js";
import type { TappedReply } from "./reply-tap.js";
import { stringOf, type StopReason } from "./translation/ir.js";

/*
 * 拒答：厂商的安全过滤不肯回答。照 magpie 只认错误本身，不认回答文字里引用的句子：
 * 报错形式是错误体或流里的错误事件，按错误码（content_filter、*_policy、说违反用量政策的 invalid_prompt）
 * 或整句「…considered high risk」认；结束形式是没说一个字就以拒答结束的回复（Anthropic 的 refusal、
 * Chat 的 content_filter、Responses 因 content_filter 没有完成）。
 * 拒答不怪这家：不冷却、不标「需要检查」，开口前的问遍剩下的同名候选（gateway.ts）。
 */

// 厂商说安全过滤停下回复的写法 → 记下的原因（magpie 的 filterReasons；Gemini 的几种一并照搬）。
const FILTER_REASONS: Record<string, string> = {
  refusal: "refusal",
  content_filter: "content_filter",
  content_policy_violation: "content_filter",
  SAFETY: "safety",
  PROHIBITED_CONTENT: "safety",
  BLOCKLIST: "safety",
  SPII: "safety",
  IMAGE_SAFETY: "safety",
};

/** 厂商说的这个原因是安全过滤（Gemini 的 finishReason、blockReason 也用它认）。 */
export function filteredBy(reason: string): boolean {
  return Object.hasOwn(FILTER_REASONS, reason);
}

// 点名用量政策的错误码：OpenAI 的 bio_policy、cyber_policy 之类。
const POLICY_CODE = /^[a-z]+_policy$/;
// OpenAI 的 invalid_prompt 说的是违反用量政策，不是请求写错了。
const FLAGGED_WORDS = /flagged|usage polic/i;
// 没有错误码、整句就是拒答的错误（magpie #2400）。只认错误自己的整句 message：回答里引用它的仍是回答。
export const HIGH_RISK_REFUSAL = "The request was rejected because it was considered high risk";

// 拒答记成、全都拒答时交给 Agent 的状态码（magpie 的 refusedStatus）：告诉 Agent 这个请求原样再发也一样，
// 不是一份它会再三重问的空回答。
export const REFUSED_STATUS = 400;

const MAX_NOTE_MESSAGE = 300;
const MAX_EXPLANATION = 200;

/** 记下的拒答：安全过滤的原因。 */
export function refusedNote(reason: string): string {
  return `safety filter: ${reason}`;
}

/** 拒答的说法再带上 Anthropic 分类器在 stop_details 里说的类别与解释（magpie #1768）；没说就不编。 */
export function refusedDetail(reason: string, details: unknown): string {
  const note = refusedNote(reason);
  if (!isRecord(details)) return note;
  const said: string[] = [];
  const category = stringOf(details.category).trim();
  if (category !== "") said.push(`category ${category}`);
  const explanation = stringOf(details.explanation).split(/\s+/).filter(Boolean).join(" ");
  if (explanation !== "") said.push(cut(explanation, MAX_EXPLANATION));
  if (said.length === 0) return note;
  return `${note} (${said.join(": ")})`;
}

/**
 * 一个错误对象（或包着它的错误体）是不是安全过滤拒答；是就返回记下的说法（带厂商的原话），不是为 null
 * （magpie 的 policyRefusal）。
 */
function policyRefusal(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const error = isRecord(value.error) ? value.error : value;
  const code = stringOf(error.code) || stringOf(error.type);
  const message = stringOf(error.message).trim();
  const reason = refusalReason(code, message);
  if (reason === null) return null;
  if (message === "") return refusedNote(reason);
  return `${refusedNote(reason)} — ${cut(message, MAX_NOTE_MESSAGE)}`;
}

function refusalReason(code: string, message: string): string | null {
  const filtered = FILTER_REASONS[code];
  if (filtered !== undefined) return filtered;
  if (POLICY_CODE.test(code)) return code;
  if (code === "invalid_prompt" && FLAGGED_WORDS.test(message)) return code;
  if (message === HIGH_RISK_REFUSAL) return "high risk";
  return null;
}

/**
 * 开口之后读完的回复以拒答结束（结束原因是拒答，或最后报的错是拒答）：照常交给了 Agent，不算这家答成功，
 * 也不怪它（magpie 的 refusedAfter）。
 */
export function refusedAfterOpening(reply: {
  stop: StopReason | null;
  error: DecodedError | null;
}): boolean {
  if (reply.stop === "filter") return true;
  return reply.error !== null && saysRefusal(reply.error);
}

/** 解码出的一个错误（错误码与话）。 */
interface DecodedError {
  code: string | null;
  message: string;
}

/** 解码出的一个错误是不是拒答：按错误码或整句话认。 */
export function saysRefusal(error: DecodedError): boolean {
  return refusalReason(error.code ?? "", error.message.trim()) !== null;
}

/**
 * 上游的错误原文（HTTP 错误体，或流里错误事件的 data）是不是拒答：依次看 `response.error`、`error` 与整个对象
 * （magpie 的 refusedCode 与 streamEvent）。
 */
export function errorRefusal(text: string): string | null {
  const body = parseJson(text);
  if (!isRecord(body)) return null;
  const response = isRecord(body.response) ? body.response : {};
  for (const error of [response.error, body.error, body]) {
    const note = policyRefusal(error);
    if (note !== null) return note;
  }
  return null;
}

/**
 * 读完的回复是不是没说一个字就以拒答结束（magpie 的 refusedReply 与 streamEvent 的 eventRefusal）；
 * 是就返回记下的说法，Anthropic 的带上 stop_details。
 */
export function replyRefusal(reply: TappedReply, format: ApiEndpointRequestFormat): string | null {
  const saidNothing = reply.content.length === 0;
  if (reply.stop !== "filter" || !saidNothing) return null;
  if (format === "anthropic_messages") return refusedDetail("refusal", reply.stopDetails);
  return refusedNote("content_filter");
}

function cut(text: string, most: number): string {
  return text.length > most ? `${text.slice(0, most)}…` : text;
}
