// fitAnthropicBody、fitResponsesBody、被拒重问与直通回复的读法（整份回复的上限、签名不算内容）移植自 magpie（https://github.com/yetone/magpie，internal/gateway/anthropic.go 的 thinkingOffUnlessAsked、withThinkingOnToolTurns，responses.go 的 withReasoningText，gateway.go 的直通重问，sniff.go，fallback.go 的 anthropicDeltaSays）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { StringDecoder } from "node:string_decoder";
import type { Request, Response } from "express";
import { applyEdits, modify } from "jsonc-parser";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { StoredApiEndpoint } from "../store.js";
import { describeNetworkError, isRecord, parseJson } from "../upstream-http.js";
import {
  isAnthropicModel,
  thinkingLeftOn,
  thinkingOffAsTaken,
  thinkingOnToolTurns,
} from "./translation/anthropic.js";
import {
  addUsage,
  emptyUsage,
  replaysThinking,
  type StopReason,
  type StreamEvent,
  type Usage,
} from "./translation/ir.js";
import { protocolOf, type StreamDecoder } from "./translation/protocols.js";
import { replayedReasoningInput } from "./translation/responses.js";
import { SseReader } from "./translation/sse.js";
import { sendAgentError, type AgentWire } from "./agent-errors.js";
import { noteRefusal, type ShapeRefusals } from "./refusals.js";
import {
  ANSWERED_BY_HEADER,
  isEventStream,
  openUpstream,
  upstreamUrl,
  type AnswerEnd,
  type AttemptOutcome,
  type FailedAttempt,
} from "./upstream-call.js";

/*
 * 同协议直通的一次尝试：请求体除模型名（与思考字段、发给 DeepSeek 的 Responses 请求的推理项）外
 * 逐字节原样发给上游，认证头换成这家的真实 key。
 * 不思考的写法上游不收（effort none、关思考）时，开口前在同一家换写法重问一次，并记住。
 * 开口之后边收边发，同时按协议读一遍（ReplyTap）；上游断流就断开 Agent 的连接，由 CLI 自己报错。
 */

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

// 不转给上游的请求头：逐跳头、主机与长度（重算）、中转站口令、代理痕迹。
const DROPPED_REQUEST_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  "host",
  "content-length",
  "authorization",
  "x-api-key",
  "accept-encoding",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

export async function attemptEndpoint(input: {
  req: Request;
  res: Response;
  format: ApiEndpointRequestFormat;
  // 格式路径后面再接的一段：count_tokens 是 `/count_tokens`。
  pathSuffix?: string;
  endpoint: StoredApiEndpoint;
  baseUrl: string;
  apiKey: string;
  body: Buffer;
  requestedModel: string;
  upstreamModel: string;
  headerTimeoutMs: number;
  // 这家的这个模型不收哪些不思考的写法；count_tokens 不用。
  refusals?: ShapeRefusals;
}): Promise<AttemptOutcome> {
  const { res, apiKey, refusals } = input;
  const { originalUrl } = input.req;
  const url = upstreamUrl({
    baseUrl: input.baseUrl,
    format: input.format,
    suffix: input.pathSuffix,
    query: originalUrl.includes("?") ? originalUrl.slice(originalUrl.indexOf("?")) : "",
  });
  const open = (body: Buffer) =>
    openUpstream({
      res,
      url,
      headers: upstreamHeaders({ headers: input.req.headers, apiKey, format: input.format }),
      body,
      apiKey,
      headerTimeoutMs: input.headerTimeoutMs,
    });
  const body = upstreamBody(input);
  let opened = await open(body);
  if (
    opened.kind === "failed" &&
    refusals &&
    noteRefusal({
      refusals,
      format: input.format,
      body: parseJson(body.toString("utf8")),
      failed: opened,
    })
  ) {
    opened = await open(upstreamBody(input));
  }
  if (opened.kind !== "opened") return opened;
  const { response, first } = opened;
  res.writeHead(opened.status, {
    ...responseHeaders(response.headers),
    [ANSWERED_BY_HEADER]: input.endpoint.slug,
  });
  if (first === null) {
    res.end();
    return { kind: "answered", finished: Promise.resolve({ kind: "complete", cacheRead: 0 }) };
  }
  return { kind: "answered", finished: relay({ response, res, first, format: input.format }) };
}

/** 开口之后边收边发，同时按协议读一遍回复（粘性要用其中的缓存命中 token 数）。 */
function relay(input: {
  response: IncomingMessage;
  res: Response;
  first: Buffer;
  format: ApiEndpointRequestFormat;
}): Promise<AnswerEnd> {
  const { response, res, first } = input;
  const tap = new ReplyTap({ format: input.format, stream: isEventStream(response, first) });
  tap.feed(first);
  res.write(first);
  let agentGone = false;
  res.once("close", () => {
    if (!res.writableFinished) agentGone = true;
  });
  return new Promise((resolve) => {
    const complete = () => {
      const { usage } = tap.end();
      resolve({ kind: "complete", cacheRead: usage.cacheRead });
    };
    response.on("data", (chunk: Buffer) => tap.feed(chunk));
    response.once("end", complete);
    const broke = (error?: Error) => {
      // 上游已经收完：Agent 这时离开也算答完了（end 可能因为没人读而不再发出）。
      if (response.complete) {
        complete();
        return;
      }
      if (agentGone) {
        resolve({ kind: "gone" });
        return;
      }
      // 首字之后上游断流：照样断开 Agent 的连接，由 CLI 自己报错。
      res.destroy();
      resolve({ kind: "broken", message: error ? describeNetworkError(error) : "aborted" });
    };
    response.once("error", broke);
    response.once("close", () => broke());
    response.pipe(res);
  });
}

/** 直通回复里出现过的内容。 */
export type ReplyContent = "text" | "thinking" | "tool_call";

/** 直通回复里读出来的东西。 */
export interface TappedReply {
  // 出现过的内容，按第一次出现的先后。
  content: ReplyContent[];
  // 上游说的结束原因；拒答是 filter。没说为 null。
  stop: StopReason | null;
  // 上游发了结束标记（StreamEvent 的 done）。
  ended: boolean;
  error: { message: string; code: string | null } | null;
  usage: Usage;
}

// 整份回复最多攒这么多来读（magpie sniff.go 的上限），再大的不读。
const MAX_WHOLE_REPLY_BYTES = 8 * 1024 * 1024;

type Reading =
  // 一个字可能被切在两段之间：utf8 接好再交给事件读取。
  | { kind: "stream"; events: SseReader; utf8: StringDecoder }
  | { kind: "whole"; chunks: Buffer[]; bytes: number }
  // 不再读：整份回复超过了上限，或回复已经读完。
  | { kind: "none" };

/**
 * 直通回复边转边读，一个字节也不改，交给翻译用的同一个解码器去认：
 * 流式回复一个事件一个事件读；整份回复（不流式）攒齐了，照它流出来时的事件读。
 */
export class ReplyTap {
  private readonly reply: TappedReply = {
    content: [],
    stop: null,
    ended: false,
    error: null,
    usage: emptyUsage(),
  };
  private readonly decoder: StreamDecoder;
  private reading: Reading;

  constructor(input: { format: ApiEndpointRequestFormat; stream: boolean }) {
    this.decoder = protocolOf(input.format).decoder();
    if (input.stream) {
      const events = new SseReader((data) => this.decoder.decode(data, (event) => this.add(event)));
      this.reading = { kind: "stream", events, utf8: new StringDecoder("utf8") };
    } else {
      this.reading = { kind: "whole", chunks: [], bytes: 0 };
    }
  }

  feed(chunk: Buffer): void {
    const { reading } = this;
    if (reading.kind === "stream") {
      reading.events.feed(reading.utf8.write(chunk));
    } else if (reading.kind === "whole") {
      reading.bytes += chunk.length;
      if (reading.bytes > MAX_WHOLE_REPLY_BYTES) this.reading = { kind: "none" };
      else reading.chunks.push(chunk);
    }
  }

  /** 回复收完了：交出还扣着的，返回读到的。再调一次只返回读到的。 */
  end(): TappedReply {
    const { reading } = this;
    this.reading = { kind: "none" };
    const add = (event: StreamEvent) => this.add(event);
    if (reading.kind === "stream") {
      reading.events.feed(reading.utf8.end());
      reading.events.end();
      this.decoder.end?.(add);
    } else if (reading.kind === "whole") {
      const text = Buffer.concat(reading.chunks).toString("utf8");
      this.decoder.whole(parseJson(text), add);
    }
    return this.reply;
  }

  private add(event: StreamEvent): void {
    switch (event.kind) {
      case "start":
      case "usage":
        addUsage(this.reply.usage, event.usage);
        return;
      case "stop":
        this.reply.stop = event.stop;
        return;
      case "done":
        this.reply.ended = true;
        return;
      case "error":
        this.reply.error = { message: event.message, code: event.code };
        return;
      case "text":
        if (event.text !== "") this.addContent("text");
        return;
      case "think":
        if (event.text !== "") this.addContent("thinking");
        return;
      case "tool_start":
      case "other_tool":
        this.addContent("tool_call");
        return;
      default:
      // think_start、tool_args 不是新的内容；签名也不算（magpie 的 anthropicDeltaSays）。
    }
  }

  private addContent(content: ReplyContent): void {
    if (!this.reply.content.includes(content)) this.reply.content.push(content);
  }
}

/**
 * 发给上游的请求体：换模型名；Anthropic 与 Responses 的对话请求再按上游模型与它不收的写法改几处
 * （count_tokens 不改）。
 */
function upstreamBody(input: {
  format: ApiEndpointRequestFormat;
  pathSuffix?: string;
  body: Buffer;
  requestedModel: string;
  upstreamModel: string;
  refusals?: ShapeRefusals;
}): Buffer {
  const fits =
    (input.format === "anthropic_messages" || input.format === "openai_responses") &&
    input.pathSuffix === undefined;
  if (input.upstreamModel === input.requestedModel && !fits) return input.body;
  let text = input.body.toString("utf8");
  if (input.upstreamModel !== input.requestedModel) text = replaceModel(text, input.upstreamModel);
  if (fits && input.format === "anthropic_messages") {
    text = fitAnthropicBody(text, input.upstreamModel);
    text = fitThinkingOff({
      text,
      model: input.upstreamModel,
      leftOn: input.refusals?.has("thinkingOff") ?? false,
    });
  } else if (fits) {
    text = fitResponsesBody(text, input.upstreamModel);
    if (input.refusals?.has("none")) text = noneAsLow(text);
  }
  return Buffer.from(text);
}

/**
 * 关思考的 Anthropic 请求按上游 Claude 收的写法改（thinkingOffAsTaken）；这家说过这个模型关不了思考的，
 * 改成交给模型自己想（thinkingLeftOn）。只改 thinking、output_config、max_tokens 三处，其余字节原样。
 */
export function fitThinkingOff(input: { text: string; model: string; leftOn: boolean }): string {
  const { text, model } = input;
  const body = parseJson(text);
  if (!isRecord(body)) return text;
  const fitted = input.leftOn ? thinkingLeftOn(body, model) : thinkingOffAsTaken(body, model);
  let out = text;
  for (const key of ["thinking", "output_config", "max_tokens"]) {
    if (fitted[key] !== body[key]) out = applyEdits(out, modify(out, [key], fitted[key], {}));
  }
  return out;
}

/** 这家不收 effort none：Responses 请求的 none 改成 low。 */
function noneAsLow(text: string): string {
  const body = parseJson(text);
  const reasoning = isRecord(body) && isRecord(body.reasoning) ? body.reasoning : null;
  if (reasoning?.effort !== "none") return text;
  return applyEdits(text, modify(text, ["reasoning", "effort"], "low", {}));
}

/** 只替换顶层 model 的值，其余字节不动（键序、空白、cache_control 都原样）。 */
function replaceModel(text: string, model: string): string {
  return applyEdits(text, modify(text, ["model"], model, {}));
}

/**
 * 直通给 Anthropic 地址、上游模型不是 Claude 时改的几处，只动这几个字段，其余字节原样：
 * Claude Code 认不出的模型名会带上自适应思考与 output_config.effort，别家不认，去掉后由模型按自己的默认想；
 * 请求根本没提思考的（起标题之类的小请求）说思考关着：别家默认会想，白花 token。
 * DeepSeek 还要每个工具轮都带思考块（thinkingOnToolTurns）。
 */
export function fitAnthropicBody(text: string, model: string): string {
  if (isAnthropicModel(model)) return text;
  const body = parseJson(text);
  if (!isRecord(body)) return text;
  let out = text;
  const edit = (path: (string | number)[], value: unknown) => {
    out = applyEdits(out, modify(out, path, value, {}));
  };
  const thinking = isRecord(body.thinking) ? body.thinking : null;
  if (body.thinking === undefined) edit(["thinking"], { type: "disabled" });
  else if (thinking?.type === "adaptive") edit(["thinking"], undefined);
  const config = isRecord(body.output_config) ? body.output_config : null;
  if (config && config.effort !== undefined) {
    const rest = Object.keys(config).filter((key) => key !== "effort");
    edit(rest.length === 0 ? ["output_config"] : ["output_config", "effort"], undefined);
  }
  if (replaysThinking(model) && Array.isArray(body.messages)) {
    for (const [index, content] of thinkingOnToolTurns(body.messages)) {
      edit(["messages", index, "content"], content);
    }
  }
  return out;
}

/**
 * 直通给 DeepSeek 模型的 Responses 请求：每个推理项都要有推理文字、每一步以推理开头，否则整个请求被拒
 * （"The `reasoning_text` in the thinking mode must be passed back"）。只改要改的推理项，挪了项才换掉整个 input。
 */
export function fitResponsesBody(text: string, model: string): string {
  if (!replaysThinking(model)) return text;
  const body = parseJson(text);
  const original = isRecord(body) ? body.input : undefined;
  if (!Array.isArray(original)) return text;
  const replayed = replayedReasoningInput(original);
  if (replayed === null) return text;
  if (replayed.reordered) return applyEdits(text, modify(text, ["input"], replayed.input, {}));
  // 只补了推理文字：只改那几项的 content。
  let out = text;
  replayed.input.forEach((item, index) => {
    if (item !== original[index] && isRecord(item)) {
      out = applyEdits(out, modify(out, ["input", index, "content"], item.content, {}));
    }
  });
  return out;
}

function upstreamHeaders(input: {
  headers: IncomingHttpHeaders;
  apiKey: string;
  format: ApiEndpointRequestFormat;
}): Record<string, string | string[]> {
  const { apiKey, format } = input;
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    if (value !== undefined && !DROPPED_REQUEST_HEADERS.has(name)) out[name] = value;
  }
  // 要上游不压缩：错误体要读出原文，回复原样转给 Agent。
  out["accept-encoding"] = "identity";
  out.authorization = `Bearer ${apiKey}`;
  // Anthropic 兼容网关有的只认 x-api-key；两种都带。
  if (format === "anthropic_messages") out["x-api-key"] = apiKey;
  return out;
}

function responseHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_BY_HOP_HEADERS.has(name)) out[name] = value;
  }
  return out;
}

/** 告诉 CLI 何时再试的头：Retry-After 与各家的 *ratelimit*reset* 头。 */
function retryHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    const tellsWhenToRetry =
      name === "retry-after" || (name.includes("ratelimit") && name.includes("reset"));
    if (value !== undefined && tellsWhenToRetry) out[name] = value;
  }
  return out;
}

/** 把一次失败的尝试按 Agent 协议交给它：状态码照抄，文字是「<接口名>: <上游原文>」再接上 `suffix`。 */
export function sendFailedAttempt(input: {
  res: Response;
  wire: AgentWire;
  endpoint: StoredApiEndpoint;
  failed: FailedAttempt;
  suffix: string;
  headers: Record<string, string>;
}): void {
  const { failed } = input;
  sendAgentError({
    res: input.res,
    wire: input.wire,
    error: {
      status: failed.status,
      message: `${input.endpoint.name}: ${failed.detail}${input.suffix}`,
      ...failed.upstreamError,
    },
    headers: {
      ...retryHeaders(failed.headers),
      ...input.headers,
      [ANSWERED_BY_HEADER]: input.endpoint.slug,
    },
  });
}
