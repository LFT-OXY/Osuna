// 开口前扣住帧与空回复的认法移植自 magpie（https://github.com/yetone/magpie，internal/gateway/fallback.go 的 holdWriter.scan、streamEvent、holdMost，gateway.go 的 emptyReply、repliesCounted、uncounted、answersNothing）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import https from "node:https";
import type { Response } from "express";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { describeNetworkError, extractErrorDetail, isRecord, parseJson } from "../upstream-http.js";
import type { AgentError } from "./agent-errors.js";
import { streamStatus } from "./failure.js";
import { ReplyTap, type TappedReply } from "./reply-tap.js";

/*
 * 向一家接口发出请求、等它开口：直通与翻译共用。开口是回复里出现第一段真内容（文字、思考或工具调用），
 * 按上游的协议认；在那之前的帧（message_start、response.created、ping……）扣在这里，开口时原样交出。
 * 开口之前的失败（出错、断开、空回复）不写给 Agent，交回中转站决定换不换家；开口之后怎么转给 Agent
 * 由调用方决定。
 * 用 node:http 而不是 fetch：fetch 会替我们解压、把等响应头的时间限死在 5 分钟。
 */

// 只为排查：回复是哪家接口答的。值用标识，因为接口名可能含中文，放不进响应头。
export const ANSWERED_BY_HEADER = "x-osuna-api-endpoint";

const MAX_ERROR_BODY_BYTES = 1024 * 1024;
// 开口前最多扣这么多（magpie 的 holdMost），再多就当开口：只有帧不会这么长。
const MAX_HELD_BYTES = 1024 * 1024;

// 空回复交给 Agent 的说法（magpie 的 emptyReply）。
export const EMPTY_REPLY = "an empty reply (the model answered nothing; try again)";

// Anthropic 地址按 Claude Code 的规则拼 /v1/messages；OpenAI 两种地址按 SDK 的规则以 /v1 结尾。
const UPSTREAM_PATHS: Record<ApiEndpointRequestFormat, string> = {
  anthropic_messages: "/v1/messages",
  openai_chat: "/chat/completions",
  openai_responses: "/responses",
};

export function upstreamUrl(input: {
  baseUrl: string;
  format: ApiEndpointRequestFormat;
  // 接在格式路径后面，如 count_tokens 的 `/count_tokens`。
  suffix?: string;
  query?: string;
}): URL {
  const base = input.baseUrl.trim().replace(/\/+$/, "");
  return new URL(`${base}${UPSTREAM_PATHS[input.format]}${input.suffix ?? ""}${input.query ?? ""}`);
}

/** 开口之前的失败：上游的状态码与错误体，或中转站自己判的超时（504）与连不上（502）。 */
export interface FailedAttempt {
  kind: "failed";
  status: number;
  headers: IncomingHttpHeaders;
  // 上游错误体原文，判错用；超时与连不上时是 detail。
  text: string;
  // 给 Agent 看的上游原文，key 已打码。
  detail: string;
  upstreamError: Pick<AgentError, "type" | "code">;
  cause: FailureCause;
}

/**
 * 失败从哪来：上游报错或连不上（error）；等响应头超时（timeout，不原地重试，真实的等待是 10 分钟）；
 * 空回复（empty，Anthropic 或 Responses 的回复说完了，却没有任何内容、一个 token 也没计）。
 */
export type FailureCause = "error" | "timeout" | "empty";

/** 开口之后回复怎么结束的：完整（带这次的缓存命中 token 数）、上游断流、Agent 先走了。 */
export type AnswerEnd =
  | { kind: "complete"; cacheRead: number }
  | { kind: "broken"; message: string }
  | { kind: "gone" };

export type AttemptOutcome =
  | { kind: "answered"; finished: Promise<AnswerEnd> }
  | FailedAttempt
  | { kind: "gone" };

/** 上游开了口：2xx 响应头到了，第一段内容也到了（或者回复在那之前就收完了，且不是空回复）。 */
export interface OpenedUpstream {
  kind: "opened";
  response: IncomingMessage;
  status: number;
  // 开口前扣下的字节，按收到的顺序；调用方先交出它们，再接着读 response。
  held: Buffer;
  // 回复在开口时已经收完：response 不会再有数据。
  ended: boolean;
  // 读过 held 的那个 ReplyTap，接着喂后面的字节；不按协议读（count_tokens）时为 null。
  tap: ReplyTap | null;
}

type UpstreamOutcome =
  | { kind: "response"; response: IncomingMessage }
  | { kind: "timeout" }
  | { kind: "failed"; error: unknown };

type Opening =
  | { kind: "open"; held: Buffer; ended: boolean; tap: ReplyTap | null }
  // 开口前出错：报错那个事件的原文。
  | { kind: "error"; raw: string }
  | { kind: "empty" }
  | { kind: "broken" };

export async function openUpstream(input: {
  res: Response;
  url: URL;
  headers: Record<string, string | string[]>;
  body: Buffer;
  apiKey: string;
  headerTimeoutMs: number;
  // 按哪种协议读回复、认开口；null 时第一段字节就算开口（count_tokens 的回复不是对话）。
  reads: ApiEndpointRequestFormat | null;
}): Promise<OpenedUpstream | FailedAttempt | { kind: "gone" }> {
  const { res, url, apiKey } = input;
  const outcome = await sendUpstream(input);
  if (res.destroyed) return { kind: "gone" };

  if (outcome.kind === "timeout") {
    return failedBySelf({
      status: 504,
      detail: `no response headers within ${input.headerTimeoutMs / 1000}s`,
      cause: "timeout",
    });
  }
  if (outcome.kind === "failed") {
    const detail = `${url.origin}: ${describeNetworkError(outcome.error)}`;
    return failedBySelf({ status: 502, detail: detail.replaceAll(apiKey, "***") });
  }

  const { response } = outcome;
  const status = response.statusCode ?? 502;
  if (status >= 400) {
    const text = await readLimited({ stream: response, first: null });
    return failedByUpstream({ status, response, text, apiKey });
  }

  const opening = await awaitOpening(response, input.reads);
  if (res.destroyed) return { kind: "gone" };
  switch (opening.kind) {
    case "open":
      return {
        kind: "opened",
        response,
        status,
        held: opening.held,
        ended: opening.ended,
        tap: opening.tap,
      };
    case "error":
      return failedByUpstream({
        status: streamStatus(opening.raw),
        response,
        text: opening.raw,
        apiKey,
      });
    case "empty":
      return failedBySelf({ status: 502, detail: EMPTY_REPLY, cause: "empty" });
    case "broken":
      return failedBySelf({
        status: 502,
        detail: `${url.origin}: the connection closed before the reply began`,
      });
  }
}

/** 上游的回复是事件流：响应头这样说，或回复以 data: / event: / 注释行开头。 */
export function isEventStream(response: IncomingMessage, first: Buffer | null): boolean {
  if (String(response.headers["content-type"] ?? "").includes("text/event-stream")) return true;
  return first !== null && /^\s*(data:|event:|:)/.test(first.toString("utf8", 0, 64));
}

/** 上游自己说的失败：错误体，或开口前流里的错误事件；判错读原文 `text`。 */
function failedByUpstream(input: {
  status: number;
  response: IncomingMessage;
  text: string;
  apiKey: string;
}): FailedAttempt {
  const { status, text } = input;
  return {
    kind: "failed",
    status,
    headers: input.response.headers,
    text,
    detail: extractErrorDetail(text, input.apiKey) || `HTTP ${status}`,
    upstreamError: readUpstreamError(text),
    cause: "error",
  };
}

/** 中转站自己判的失败（超时、连不上、开口前断开、空回复）：没有上游错误体，判错就读这段描述。 */
export function failedBySelf(input: {
  status: number;
  detail: string;
  cause?: Exclude<FailureCause, "error">;
}): FailedAttempt {
  return {
    kind: "failed",
    status: input.status,
    headers: {},
    text: input.detail,
    detail: input.detail,
    upstreamError: {},
    cause: input.cause ?? "error",
  };
}

/**
 * 等上游开口：边收边按协议读，扣住第一段内容之前的字节。之前出错、断开、或回复收完却是空回复，
 * 都还能换家；出错时不再读这家的回复。
 */
function awaitOpening(
  response: IncomingMessage,
  reads: ApiEndpointRequestFormat | null,
): Promise<Opening> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let tap: ReplyTap | null = null;
    const settle = (result: Opening) => {
      response.off("data", onData);
      response.off("end", onEnd);
      response.off("close", onClose);
      response.off("error", onClose);
      resolve(result);
    };
    const open = (ended: boolean): Opening => ({
      kind: "open",
      held: Buffer.concat(chunks),
      ended,
      tap,
    });
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      bytes += chunk.length;
      if (reads !== null) {
        tap ??= new ReplyTap({ format: reads, stream: isEventStream(response, chunk) });
        tap.feed(chunk);
        const reply = tap.soFar();
        const failed = failedBeforeContent(reply);
        if (failed) {
          response.destroy();
          settle(failed);
          return;
        }
        const saidSomething = reply.content.length > 0;
        const heldTooMuch = bytes > MAX_HELD_BYTES;
        if (!saidSomething && !heldTooMuch) return;
      }
      response.pause();
      settle(open(false));
    };
    const onEnd = () => {
      if (reads === null) {
        settle(open(true));
        return;
      }
      // 一个字节都没有的回复照原样交出（不是本协议回复的 2xx 归工单 18）。
      const reply = tap?.end() ?? null;
      const failed = reply ? failedBeforeContent(reply) : null;
      if (failed) settle(failed);
      else if (reply && isEmptyReply(reply, reads)) settle({ kind: "empty" });
      else settle(open(true));
    };
    const onClose = () => settle({ kind: "broken" });
    response.on("data", onData);
    response.once("end", onEnd);
    response.once("close", onClose);
    response.once("error", onClose);
  });
}

/** 还没有内容就报了错。 */
function failedBeforeContent(reply: TappedReply): Opening | null {
  if (reply.error === null || reply.content.length > 0) return null;
  return { kind: "error", raw: reply.error.raw };
}

/**
 * 空回复（magpie 的 repliesCounted、uncounted、answersNothing）：Anthropic 与 Responses 的回复一定计 token，
 * 什么都没说、一个 token 也没计的才是空回复；Claude 自己以空回复结束一轮时计了提示词，仍是回答。
 * Chat 的回复不一定计 token，从不算空。被截断（length）与拒答（filter）的不算。
 * 没说结束原因的（HTML 页、`{}`）读不出是不是本协议的回复，也不算，归工单 18。
 */
function isEmptyReply(reply: TappedReply, format: ApiEndpointRequestFormat): boolean {
  const { usage } = reply;
  const repliesCounted = format === "anthropic_messages" || format === "openai_responses";
  const uncounted = usage.input + usage.output + usage.cacheRead + usage.cacheWrite === 0;
  const answersNothing = reply.stop !== null && reply.stop !== "length" && reply.stop !== "filter";
  return repliesCounted && uncounted && reply.content.length === 0 && answersNothing;
}

async function sendUpstream(input: {
  res: Response;
  url: URL;
  headers: Record<string, string | string[]>;
  body: Buffer;
  headerTimeoutMs: number;
}): Promise<UpstreamOutcome> {
  const transport = input.url.protocol === "https:" ? https : http;
  const upstream = transport.request(input.url, {
    method: "POST",
    headers: { ...input.headers, "content-length": String(input.body.length) },
  });
  const answered = new Promise<IncomingMessage>((resolve, reject) => {
    upstream.once("response", resolve);
    upstream.once("error", reject);
  });
  // 开口之后的连接错误由 response 的 error / close 处理；这里只为不让无人接的 error 打崩进程。
  upstream.on("error", () => {});
  // Agent 先断开（用户中断）：不再等上游。
  const abandon = () => {
    if (!input.res.writableFinished) upstream.destroy();
  };
  input.res.once("close", abandon);
  upstream.once("close", () => input.res.off("close", abandon));
  upstream.end(input.body);

  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<UpstreamOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), input.headerTimeoutMs);
  });
  const outcome = await Promise.race([
    answered.then(
      (response): UpstreamOutcome => ({ kind: "response", response }),
      (error: unknown): UpstreamOutcome => ({ kind: "failed", error }),
    ),
    timedOut,
  ]);
  clearTimeout(timer);
  if (outcome.kind === "timeout") upstream.destroy();
  return outcome;
}

function readUpstreamError(text: string): Pick<AgentError, "type" | "code"> {
  const body = parseJson(text);
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  if (!error) return {};
  return {
    ...(typeof error.type === "string" ? { type: error.type } : {}),
    ...(typeof error.code === "string" || typeof error.code === "number"
      ? { code: error.code }
      : {}),
  };
}

/** 读完（最多 1 MB）上游的回复原文：错误体，或没按要求流式回复的整份回复。 */
export function readLimited(input: {
  stream: IncomingMessage;
  // 开口时已经读到的第一段。
  first: Buffer | null;
}): Promise<string> {
  const { stream, first } = input;
  return new Promise((resolve) => {
    const chunks: Buffer[] = first ? [first] : [];
    let size = first?.length ?? 0;
    const finish = () => resolve(Buffer.concat(chunks).toString("utf8"));
    stream.on("data", (chunk: Buffer) => {
      if (size >= MAX_ERROR_BODY_BYTES) return;
      chunks.push(chunk.subarray(0, MAX_ERROR_BODY_BYTES - size));
      size += chunk.length;
      if (size >= MAX_ERROR_BODY_BYTES) {
        stream.destroy();
        finish();
      }
    });
    stream.on("end", finish);
    stream.on("error", finish);
    stream.on("aborted", finish);
    stream.resume();
  });
}
