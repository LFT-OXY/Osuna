// 开口前扣住帧与空回复的认法移植自 magpie（https://github.com/yetone/magpie，internal/gateway/fallback.go 的 holdWriter.scan、streamEvent、holdMost，gateway.go 的 emptyReply、repliesCounted、uncounted、answersNothing），
// 复用的连接被掐时在新连接上重发照 upstream_transport.go 的 replayable，开口前的拒答照 fallback.go 的 holdWriter.settle、streamEvent 与 handBack，Gemini 的模型放进路径照 gateway.go 调 provider.GeminiPath 处
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import http, {
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
} from "node:http";
import https from "node:https";
import type { Response } from "express";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  describeNetworkError,
  extractErrorDetail,
  isRecord,
  parseJson,
  redactKey,
  type Secrets,
} from "../upstream-http.js";
import { geminiPath } from "../gemini-base-url.js";
import { skipsCertificateCheck } from "../insecure-tls.js";
import type { AgentError } from "./agent-errors.js";
import { streamStatus } from "./failure.js";
import { notApiDetail, notApiReply, saysNothingYet, type NotApiReply } from "./not-api-reply.js";
import { zhipuRefusal } from "./zhipu-envelope.js";
import type { ReplyTimes } from "./reply-clock.js";
import { ReplyTap, type TappedReply } from "./reply-tap.js";
import { REFUSED_STATUS, errorRefusal, replyRefusal } from "./safety-filter.js";
import type { StopReason, Usage } from "./translation/ir.js";

/*
 * 向一家接口发出请求、等它开口：直通与翻译共用。开口是回复里出现第一段真内容（文字、思考或工具调用），
 * 按上游的协议认；在那之前的帧（message_start、response.created、ping……）扣在这里，开口时原样交出。
 * 开口之前的失败（出错、断开、空回复、拒答）不写给 Agent，交回中转站决定换不换家；开口之后怎么转给 Agent
 * 由调用方决定。
 * 用 node:http 而不是 fetch：fetch 会替我们解压、把等响应头的时间限死在 5 分钟。
 */

// 只为排查：回复是哪家接口答的。值用标识，因为接口名可能含中文，放不进响应头。
export const ANSWERED_BY_HEADER = "x-osuna-api-endpoint";

const MAX_ERROR_BODY_BYTES = 1024 * 1024;
// 开口前最多扣这么多（magpie 的 holdMost），再多就当开口：只有帧不会这么长。
const MAX_HELD_BYTES = 1024 * 1024;

// 复用的连接在回复开始前被掐的报错码（EOF 记作 ECONNRESET「socket hang up」，写不进去是 EPIPE）。
const DROPPED_CONNECTION_CODES = new Set(["ECONNRESET", "EPIPE"]);
// 一次最多这么多回重发：连接池里每台主机最多留这么多条空闲连接（magpie 的 MaxIdleConnsPerHost）。
const MAX_REPLAYS = 8;

// 空回复交给 Agent 的说法（magpie 的 emptyReply）。
export const EMPTY_REPLY = "an empty reply (the model answered nothing; try again)";

// Anthropic 地址按 Claude Code 的规则拼 /v1/messages；OpenAI 两种地址按 SDK 的规则以 /v1 结尾。
// Gemini 的模型在路径里（geminiPath），上游一律流式。
const UPSTREAM_PATHS: Record<Exclude<ApiEndpointRequestFormat, "gemini">, string> = {
  anthropic_messages: "/v1/messages",
  openai_chat: "/chat/completions",
  openai_responses: "/responses",
};

export function upstreamUrl(input: {
  baseUrl: string;
  format: ApiEndpointRequestFormat;
  // 发给上游的模型名：只有 Gemini 放进路径（必须给），别的格式在请求体里。
  model?: string;
  // 接在格式路径后面，如 count_tokens 的 `/count_tokens`。
  suffix?: string;
  query?: string;
}): URL {
  const base = input.baseUrl.trim().replace(/\/+$/, "");
  if (input.format === "gemini") {
    if (input.model === undefined) throw new Error("A Gemini upstream URL needs the model");
    return new URL(`${base}${geminiPath({ model: input.model, stream: true })}`);
  }
  return new URL(`${base}${UPSTREAM_PATHS[input.format]}${input.suffix ?? ""}${input.query ?? ""}`);
}

/**
 * 开口之前的失败：上游的状态码与错误体，或中转站自己判的超时（504）与连不上（502）。
 * 只有拒答带 handBack：以结束形式拒答时把扣下的那份回复照常交给 Agent（全都拒答时交还给 Claude Code，
 * magpie 的 handBack）；以报错形式拒答的没有回复可交，为 null。
 */
export type FailedAttempt =
  | (FailedBase & { cause: Exclude<FailureCause, "refused"> })
  | (FailedBase & { cause: "refused"; handBack: HandBack | null });

interface FailedBase {
  kind: "failed";
  status: number;
  headers: IncomingHttpHeaders;
  // 上游错误体原文，判错用；超时与连不上时是 detail。
  text: string;
  // 给 Agent 看的上游原文，key 已打码。
  detail: string;
  upstreamError: UpstreamError;
}

/**
 * 失败从哪来：上游报错或连不上（error）；等响应头超时（timeout，不原地重试，真实的等待是 10 分钟）；
 * 空回复（empty，Anthropic 或 Responses 的回复说完了，却没有任何内容、一个 token 也没计）；
 * 拒答（refused，安全过滤不肯回答，safety-filter.ts）。
 */
export type FailureCause = "error" | "timeout" | "empty" | "refused";

/** 把一份开了口的回复照常交给 Agent：直通原样转、翻译后编码，与没被当作失败时一样。 */
export type HandBack = () => Promise<AttemptOutcome>;

/**
 * 开口之后回复怎么结束的：完整（带这次的用量，粘性按它判断缓存）、开口后才拒答（照常交给了 Agent，
 * 不算这家答成功，也不怪它）、上游断流、Agent 先走了。
 */
export type AnswerEnd =
  | { kind: "complete"; usage: Usage; reply: DeliveredReply }
  | { kind: "refused"; reply: DeliveredReply }
  // 以报错形式交给 Agent 的拒答：没有回复可记，told 是交给 Agent 的说法。
  | { kind: "refused_as_error"; told: string }
  | { kind: "broken"; message: string }
  | { kind: "gone" };

/**
 * 交给 Agent 的回复里中转站账本要记的：写给 Agent 的回复编号、用量、上游说的结束原因，以及它的计时
 * （reply-clock.ts：首个内容与首段文字发给 Agent 的时刻、内容流动的时长、可见推理的起点）。不含任何内容本身。
 */
export interface DeliveredReply extends ReplyTimes {
  id: string;
  usage: Usage;
  stop: StopReason | null;
}

export type AttemptOutcome =
  | { kind: "answered"; finished: Promise<AnswerEnd> }
  | FailedAttempt
  | { kind: "gone" };

/**
 * 上游开了口：2xx 响应头到了，第一段内容也到了（或者回复在那之前就收完了，且不是空回复）。
 * 回复收完没有，接着读之前看 `response.readableEnded`，不另记：整个流一段写完时，开口那一段交出之后
 * end 不等人读就发出，开口之后才挂上的 end 再也等不到。
 */
export interface OpenedUpstream {
  kind: "opened";
  response: IncomingMessage;
  status: number;
  // 开口前扣下的字节，按收到的顺序；调用方先交出它们，再接着读 response。
  held: Buffer;
  // 读过 held 的那个 ReplyTap，接着喂后面的字节；不按协议读（count_tokens）时为 null。
  tap: ReplyTap | null;
}

/** 问一次上游开口前的结果：开了口、失败、Agent 先走了。 */
export type UpstreamOpening = OpenedUpstream | FailedAttempt | { kind: "gone" };

type UpstreamOutcome =
  | { kind: "response"; response: IncomingMessage }
  | { kind: "timeout" }
  | { kind: "failed"; error: unknown };

type Opening =
  | { kind: "open"; held: Buffer; tap: ReplyTap | null }
  // 开口前出错：报错那个事件的原文；厂商说请求本身有问题的读成 400。
  | { kind: "error"; raw: string; refusesRequest: boolean }
  | { kind: "empty" }
  | { kind: "broken" }
  // 2xx 却不是接口的回复（网页、空的、不是 JSON）：认出它的开头，其余的由调用方接着读。
  | { kind: "not_api"; reply: NotApiReply; head: Buffer }
  // 2xx 里包着的拒绝（智谱的信封）：读成它代表的状态码与错误体。
  | { kind: "enveloped"; status: number; text: string };

export async function openUpstream(input: {
  res: Response;
  url: URL;
  headers: Record<string, string | string[]>;
  body: Buffer;
  // 报错里打码的：key 与用户的请求头值。
  secrets: Secrets;
  // 不校验证书的主机（insecure-tls.ts）；没开为空。
  uncheckedHosts: readonly string[];
  headerTimeoutMs: number;
  // 按哪种协议读回复、认开口；null 时第一段字节就算开口（count_tokens 的回复不是对话）。
  reads: ApiEndpointRequestFormat | null;
  // 上游有动静（发出请求、开口前收到字节）时告诉保活。
  onHeard?: () => void;
}): Promise<UpstreamOpening> {
  const { res, url, secrets } = input;
  input.onHeard?.();
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
    return failedBySelf({ status: 502, detail: redactKey(detail, secrets) });
  }

  const { response } = outcome;
  const status = response.statusCode ?? 502;
  if (status >= 400) {
    const text = await readLimited({ stream: response, first: null });
    return refusedOr(failedByUpstream({ status, response, text, secrets }));
  }

  const opening = await awaitOpening({
    response,
    host: url.hostname,
    reads: input.reads,
    onHeard: input.onHeard,
  });
  if (res.destroyed) return { kind: "gone" };
  switch (opening.kind) {
    case "open":
      return {
        kind: "opened",
        response,
        status,
        held: opening.held,
        tap: opening.tap,
      };
    case "error": {
      const errorStatus = statusOfError(opening);
      return refusedOr(
        failedByUpstream({ status: errorStatus, response, text: opening.raw, secrets }),
      );
    }
    case "empty":
      return failedBySelf({ status: 502, detail: EMPTY_REPLY, cause: "empty" });
    case "broken":
      return failedBySelf({
        status: 502,
        detail: `${url.origin}: the connection closed before the reply began`,
      });
    case "enveloped":
      return failedByUpstream({ status: opening.status, response, text: opening.text, secrets });
    case "not_api": {
      const text = await readLimited({ stream: response, first: opening.head });
      const statusLine = `${status} ${response.statusMessage ?? ""}`.trim();
      const detail = notApiDetail({
        kind: opening.reply,
        statusLine,
        headers: response.headers,
        text,
      });
      return failedBySelf({ status: 502, detail: redactKey(detail, secrets) });
    }
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
  secrets: Secrets;
}): FailedAttempt {
  const { status, text } = input;
  return {
    kind: "failed",
    status,
    headers: input.response.headers,
    text,
    detail: extractErrorDetail(text, input.secrets) || `HTTP ${status}`,
    upstreamError: readUpstreamError(text),
    cause: "error",
  };
}

/**
 * 上游的错误是安全过滤拒答（报错形式，用 403 说的也算）：记成 400 的拒答，说法是安全过滤的原因与厂商原话
 * （magpie 的 refusedStatus）；判错仍读原文。不是拒答原样返回。
 */
function refusedOr(failed: FailedAttempt): FailedAttempt {
  const note = errorRefusal(failed.text);
  if (note === null) return failed;
  return { ...failed, status: REFUSED_STATUS, detail: note, cause: "refused", handBack: null };
}

/**
 * 开了口的回复交给 Agent（`answer`）；它其实是没说一个字就以拒答结束的（结束形式）时不交，当作拒答失败
 * 交回中转站换家，回复扣着，`handBack` 到时照常交给 Agent。只看已经收完的回复：没收完就开口的，
 * 是说了内容或扣得太多。
 */
export function answerUnlessRefused(input: {
  opened: OpenedUpstream;
  format: ApiEndpointRequestFormat;
  answer: (opened: OpenedUpstream) => Promise<AttemptOutcome>;
}): Promise<AttemptOutcome> {
  const { opened } = input;
  const handBack = () => input.answer(opened);
  const reply = opened.tap?.soFar();
  const endedReply = reply !== undefined && opened.response.readableEnded;
  const note = endedReply ? replyRefusal(reply, input.format) : null;
  if (note === null) return handBack();
  const refused: FailedAttempt = {
    ...failedBySelf({ status: REFUSED_STATUS, detail: note }),
    headers: opened.response.headers,
    cause: "refused",
    handBack,
  };
  return Promise.resolve(refused);
}

/** 中转站自己判的失败（超时、连不上、开口前断开、空回复）：没有上游错误体，判错就读这段描述。 */
export function failedBySelf(input: {
  status: number;
  detail: string;
  cause?: Exclude<FailureCause, "error" | "refused">;
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
function awaitOpening(input: {
  response: IncomingMessage;
  // 这家的主机名：智谱的信封只认它自己的地址。
  host: string;
  reads: ApiEndpointRequestFormat | null;
  onHeard?: () => void;
}): Promise<Opening> {
  const { response, reads } = input;
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
    const open = (): Opening => ({ kind: "open", held: Buffer.concat(chunks), tap });
    // 看过回复的开头了（第一个不是空白的字节到了）；204 本来就没有内容，不看。
    let looked = response.statusCode === 204;
    // 回复的开头（收完时一个字节都没有就是空的）说它不是接口的回复。
    const notApi = (head: Buffer): Opening | null => {
      const reply = notApiReply({ headers: response.headers, head });
      if (reply === null) return null;
      return { kind: "not_api", reply, head };
    };
    const onData = (chunk: Buffer) => {
      input.onHeard?.();
      chunks.push(chunk);
      bytes += chunk.length;
      let fresh = chunk;
      if (!looked) {
        const head = Buffer.concat(chunks);
        // 只有空白还看不出是什么，等后面的字节（太多就不等了）。
        const waits = saysNothingYet(head) && bytes <= MAX_HELD_BYTES;
        if (waits) return;
        looked = true;
        const notReply = notApi(head);
        if (notReply) {
          response.pause();
          settle(notReply);
          return;
        }
        fresh = head;
      }
      if (reads !== null) {
        tap ??= new ReplyTap({ format: reads, stream: isEventStream(response, fresh) });
        tap.feed(fresh);
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
      settle(open());
    };
    const onEnd = () => {
      const body = Buffer.concat(chunks);
      const notReply = notApi(body);
      if (!looked && notReply) {
        settle(notReply);
        return;
      }
      const refusal = zhipuRefusal({ host: input.host, headers: response.headers, body });
      if (refusal) {
        settle({ kind: "enveloped", ...refusal });
        return;
      }
      if (reads === null) {
        settle(open());
        return;
      }
      const reply = tap?.end() ?? null;
      const failed = reply ? failedBeforeContent(reply) : null;
      if (failed) settle(failed);
      else if (reply && isEmptyReply(reply, reads)) settle({ kind: "empty" });
      else settle(open());
    };
    const onClose = () => settle({ kind: "broken" });
    response.on("data", onData);
    response.once("end", onEnd);
    response.once("close", onClose);
    response.once("error", onClose);
  });
}

/** 开口前出错代表的状态码：厂商说请求本身有问题的是 400，别的按流里的话判（streamStatus）。 */
function statusOfError(opening: Extract<Opening, { kind: "error" }>): number {
  if (opening.refusesRequest) return 400;
  return streamStatus(opening.raw);
}

/** 还没有内容就报了错。 */
function failedBeforeContent(reply: TappedReply): Opening | null {
  if (reply.error === null || reply.content.length > 0) return null;
  const refusesRequest = reply.error.vendorError !== null;
  return { kind: "error", raw: reply.error.raw, refusesRequest };
}

/**
 * 空回复（magpie 的 repliesCounted、uncounted、answersNothing）：Anthropic 与 Responses 的回复一定计 token，
 * 什么都没说、一个 token 也没计的才是空回复；Claude 自己以空回复结束一轮时计了提示词，仍是回答。
 * Chat 的回复不一定计 token，从不算空。被截断（length）与拒答（filter）的不算。
 * 没说结束原因的（`{}`）读不出是不是本协议的回复，也不算；网页与空的回复开口前就认出（not-api-reply.ts）。
 */
function isEmptyReply(reply: TappedReply, format: ApiEndpointRequestFormat): boolean {
  const { usage } = reply;
  const repliesCounted = format === "anthropic_messages" || format === "openai_responses";
  const uncounted = usage.input + usage.output + usage.cacheRead + usage.cacheWrite === 0;
  const answersNothing = reply.stop !== null && reply.stop !== "length" && reply.stop !== "filter";
  return repliesCounted && uncounted && reply.content.length === 0 && answersNothing;
}

interface UpstreamSend {
  res: Response;
  url: URL;
  headers: Record<string, string | string[]>;
  body: Buffer;
  uncheckedHosts: readonly string[];
  headerTimeoutMs: number;
}

async function sendUpstream(input: UpstreamSend): Promise<UpstreamOutcome> {
  // 最近发出的那个请求：超时时掐掉它。
  const latest: { request: ClientRequest | null } = { request: null };
  const answered = answeredOnLiveConnection({
    send: input,
    sent: (upstream) => {
      latest.request = upstream;
    },
  });
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
  if (outcome.kind === "timeout") latest.request?.destroy();
  return outcome;
}

/**
 * 发出请求等响应头。保活留下的连接可能已被上游或中间的代理关掉：请求写进去、回复一个字节都没来就断了
 * （EOF、broken pipe）。这不怪这家，立刻再发；坏连接已从连接池里拿掉，再发会落到别的连接上（magpie 的 replayable）。
 * 只认复用的连接：新连接上断开是真的连不上。最多重发 MAX_REPLAYS 回。
 */
async function answeredOnLiveConnection(input: {
  send: UpstreamSend;
  sent: (upstream: ClientRequest) => void;
}): Promise<IncomingMessage> {
  const { send } = input;
  for (let replays = 0; ; replays++) {
    const upstream = sendOnce(send);
    input.sent(upstream);
    try {
      return await new Promise<IncomingMessage>((resolve, reject) => {
        upstream.once("response", resolve);
        upstream.once("error", reject);
      });
    } catch (error) {
      const droppedWhileIdle = upstream.reusedSocket && droppedConnection(error);
      const mayReplay = droppedWhileIdle && replays < MAX_REPLAYS;
      const agentLeft = send.res.destroyed;
      if (!mayReplay || agentLeft) throw error;
    }
  }
}

function sendOnce(input: UpstreamSend): ClientRequest {
  const transport = input.url.protocol === "https:" ? https : http;
  // 不校验证书的连接与校验的不共用：全局 agent 按 rejectUnauthorized 分开放连接。
  const skipsCheck = skipsCertificateCheck(input);
  const upstream = transport.request(input.url, {
    method: "POST",
    headers: { ...input.headers, "content-length": String(input.body.length) },
    ...(skipsCheck ? { rejectUnauthorized: false } : {}),
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
  return upstream;
}

function droppedConnection(error: unknown): boolean {
  const code = error instanceof Error && "code" in error ? error.code : null;
  return typeof code === "string" && DROPPED_CONNECTION_CODES.has(code);
}

/** 上游自己写的错误类型、代码与参数，转给 Agent 时照带。 */
export type UpstreamError = Pick<AgentError, "type" | "code" | "param">;

/** 错误体或流里的错误事件里的 `error`（Responses 的 response.failed 在 `response.error`）。 */
function readUpstreamError(text: string): UpstreamError {
  const body = parseJson(text);
  const read: UpstreamError = {};
  if (!isRecord(body)) return read;
  const response = isRecord(body.response) ? body.response : {};
  const error = [body.error, response.error].find(isRecord);
  if (!error) return read;
  if (typeof error.type === "string") read.type = error.type;
  if (isErrorCode(error.code)) read.code = error.code;
  if (typeof error.param === "string") read.param = error.param;
  return read;
}

function isErrorCode(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

/** 上游没理会 stream: true，回的又不是这个协议的整份回复：读不出回复，当作开口前失败换家。 */
export function notAStream(input: { url: URL; text: string; secrets: Secrets }): FailedAttempt {
  const detail = extractErrorDetail(input.text, input.secrets);
  return failedBySelf({
    status: 502,
    detail: `${input.url.origin}: the reply was not a stream: ${detail}`,
  });
}

/** 读完（最多 1 MB）上游的回复原文：错误体，或没按要求流式回复的整份回复。 */
export function readLimited(input: {
  stream: IncomingMessage;
  // 开口时已经读到的第一段。
  first: Buffer | null;
}): Promise<string> {
  const { stream, first } = input;
  // 开口时那一段之后就收完或断了的，end、close 已经发过，不会再来。
  const over = stream.readableEnded || stream.destroyed;
  if (over) return Promise.resolve(first?.toString("utf8") ?? "");
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
