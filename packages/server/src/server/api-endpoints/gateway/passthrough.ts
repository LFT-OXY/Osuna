// fitAnthropicBody、fitResponsesBody 与被拒重问移植自 magpie（https://github.com/yetone/magpie，internal/gateway/anthropic.go 的 thinkingOffUnlessAsked、withThinkingOnToolTurns、
// adaptiveThinking、samplingAsTaken，responses.go 的 withReasoningText，codex_backend.go 的 withoutBareReasoning，gateway.go 的 passthrough 里按上游模型改的几处、
// 直通重问与 attempt 里去掉拒收字段、画图工具的重问；按厂商的改写接在 forwardOnce 处，Grok 回复的整数接在直通回复的 intTidy 处；
// 保活之后整份回复照流写出照 fallback.go 的 holdWriter.release 与 whole_stream.go 的 wholeAsStream）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingHttpHeaders } from "node:http";
import { StringDecoder } from "node:string_decoder";
import { Transform, type Writable } from "node:stream";
import type { Request, Response } from "express";
import { applyEdits, modify } from "jsonc-parser";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { StoredApiEndpoint } from "../store.js";
import { describeNetworkError, isRecord, parseJson } from "../upstream-http.js";
import {
  adaptiveThinkingAsTaken,
  isAnthropicModel,
  refusesSampling,
  thinkingLeftOn,
  thinkingOffAsTaken,
  thinkingOnToolTurns,
} from "./translation/anthropic.js";
import { emptyUsage, replaysThinking } from "./translation/ir.js";
import { replayedReasoningInput } from "./translation/responses.js";
import { sendAgentError, type AgentWire } from "./agent-errors.js";
import {
  withAdvisorFitted,
  withoutBillingLine,
  withoutReviewBeta,
  type AdvisorEndpoint,
} from "./claude-code-fields.js";
import type { AgentKeepAlive } from "./keepalive.js";
import {
  askRefitted,
  askWithOneKeyHeader,
  askWithoutField,
  keyHeaderValues,
  keyHeadersFor,
  type KeyHeaders,
  type RefusedShape,
  type ShapeRefusals,
} from "./refusals.js";
import { withDowngrades } from "./refused-downgrades.js";
import {
  offersImageTool,
  takesImageTool,
  withoutRefusedFields,
  withoutSafeguards,
  withoutSampling,
} from "./refused-fields.js";
import { isGrokReply, WholeArgsTidy } from "./grok-integral.js";
import { ReplyTap } from "./reply-tap.js";
import { sseEvent } from "./translation/sse.js";
import { hasVendorRewrites, withVendorRewrites } from "./vendor-rewrites.js";
import { wholeEvents } from "./whole-stream.js";
import {
  ANSWERED_BY_HEADER,
  isEventStream,
  notAStream,
  openUpstream,
  readLimited,
  upstreamUrl,
  type AnswerEnd,
  type AttemptOutcome,
  type FailedAttempt,
  type OpenedUpstream,
} from "./upstream-call.js";

/*
 * 同协议直通的一次尝试：请求体除模型名与下面这些只看上游模型的修补外逐字节原样发给上游，认证头换成这家的真实 key。
 * Anthropic：思考字段按模型收的写法改；非 Claude 模型去掉 Claude Code 的计费行与自动模式审查（字段与 beta）；
 * advisor 工具只在这家的 Claude 上留着；不收采样参数的 Claude 去掉它们。Responses：DeepSeek 回放推理，
 * 别的模型去掉没有封存内容的推理项（中转站翻译时自己造的）。
 * 不思考的写法上游不收（effort none、关思考）、两个认证头不能同时带、不收请求里的某个字段、
 * 或不收结构化输出与预填时，开口前在同一家换写法重问，并记住。
 * 开口时先交出扣下的帧，之后边收边发，同时按协议读一遍（ReplyTap）；上游断流就断开 Agent 的连接，
 * 由 CLI 自己报错。
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
  // 请求体已经解开（request-body.ts），发出去的是原文。
  "content-encoding",
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
  // CLI 自己的 User-Agent，它没带时是 Osuna/<版本>。
  userAgent: string;
  // 这家的这个模型不收哪些不思考的写法；count_tokens 不用。
  refusals?: ShapeRefusals;
  // count_tokens 不保活。
  keepAlive?: AgentKeepAlive;
}): Promise<AttemptOutcome> {
  const { res, apiKey, refusals } = input;
  const { originalUrl } = input.req;
  const url = upstreamUrl({
    baseUrl: input.baseUrl,
    format: input.format,
    suffix: input.pathSuffix,
    query: originalUrl.includes("?") ? originalUrl.slice(originalUrl.indexOf("?")) : "",
  });
  const sends = () => keyHeadersFor({ format: input.format, refusals });
  const anthropic = input.format === "anthropic_messages";
  const dropsReviewBeta = anthropic && !isAnthropicModel(input.upstreamModel);
  const open = (body: Buffer, keys: KeyHeaders = sends()) =>
    openUpstream({
      res,
      url,
      headers: upstreamHeaders({
        headers: input.req.headers,
        apiKey,
        keys,
        dropsReviewBeta,
        userAgent: input.userAgent,
      }),
      body,
      apiKey,
      headerTimeoutMs: input.headerTimeoutMs,
      reads: input.pathSuffix === undefined ? input.format : null,
      onHeard: () => input.keepAlive?.heard(),
    });
  const body = upstreamBody(input);
  const keys = sends();
  let opened = await open(body, keys);
  if (opened.kind === "failed" && refusals) {
    opened = await askWithOneKeyHeader({
      refusals,
      sent: keys,
      failed: opened,
      ask: (alone) => open(body, alone),
    });
  }
  if (refusals) {
    const refitted = await askRefitted({
      refusals,
      format: input.format,
      sent: body.toString("utf8"),
      outcome: opened,
      refit: () => upstreamBody(input).toString("utf8"),
      ask: (text) => open(Buffer.from(text)),
    });
    const sentImageTool =
      input.format === "openai_responses" && offersImageTool(parseJson(refitted.sent));
    const mayRefuseImageTool = sentImageTool && !takesImageTool(input.baseUrl);
    opened = await askWithoutField({
      refusals,
      field: "imageTool",
      offered: mayRefuseImageTool,
      outcome: refitted.outcome,
      ask: (without) => open(upstreamBody({ ...input, refusals: without })),
    });
  }
  if (opened.kind !== "opened") return opened;
  const tidy = replyTidy({ ...input, opened });
  const keptAliveWhole = res.headersSent && !isEventStream(opened.response, opened.held);
  if (keptAliveWhole) return wholeAsStream({ ...input, url, opened, tidy });
  input.keepAlive?.stop();
  // 保活已经回了 200 与响应头：接着在同一个流里交出回复。
  if (!res.headersSent) {
    const headers = responseHeaders(opened.response.headers);
    // 改过的回复长度会变。
    if (tidy !== null) delete headers["content-length"];
    res.writeHead(opened.status, { ...headers, [ANSWERED_BY_HEADER]: input.endpoint.slug });
  }
  return { kind: "answered", finished: relay({ opened, res, tidy }) };
}

/** Grok 的对话回复要去掉调用参数里的零小数（grok-integral.ts）；别的回复原样转，为 null。 */
function replyTidy(input: {
  format: ApiEndpointRequestFormat;
  pathSuffix?: string;
  requestedModel: string;
  upstreamModel: string;
  opened: OpenedUpstream;
}): WholeArgsTidy | null {
  const { format, opened } = input;
  const conversation = input.pathSuffix === undefined;
  // 直通只有 Agent 说的两种格式，Chat 不会来。
  if (format === "openai_chat") return null;
  const grokConversation = conversation && isGrokReply(input);
  if (!grokConversation) return null;
  return new WholeArgsTidy({ format, stream: isEventStream(opened.response, opened.held) });
}

/** 交给 Agent 的那一路：要改的回复先经 tidy，按 UTF-8 接好字符再改；别的直接写给 Agent。 */
function agentSink(input: { res: Response; tidy: WholeArgsTidy | null }): Writable {
  const { tidy } = input;
  if (tidy === null) return input.res;
  const utf8 = new StringDecoder("utf8");
  const sink = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      done(null, tidy.write(utf8.write(chunk)));
    },
    flush(done) {
      done(null, tidy.write(utf8.end()) + tidy.end());
    },
  });
  sink.pipe(input.res);
  return sink;
}

/**
 * 保活已经回了事件流的响应头，上游却没理会 stream: true、回了整份 JSON：照这个协议的流写出（magpie 的 wholeAsStream），
 * 不能当作整份回复交给 Agent。不是这个协议的整份回复，当作开口前失败换家，保活接着。
 */
async function wholeAsStream(input: {
  res: Response;
  format: ApiEndpointRequestFormat;
  url: URL;
  apiKey: string;
  opened: OpenedUpstream;
  tidy: WholeArgsTidy | null;
  keepAlive?: AgentKeepAlive;
}): Promise<AttemptOutcome> {
  const { res, tidy } = input;
  const raw = await readLimited({ stream: input.opened.response, first: input.opened.held });
  let text = raw;
  if (tidy !== null) text = tidy.write(raw) + tidy.end();
  const events = wholeEvents(input.format, parseJson(text));
  if (events === null) return notAStream({ url: input.url, text: raw, apiKey: input.apiKey });
  input.keepAlive?.stop();
  for (const event of events) res.write(sseEvent(event.name, event.data));
  res.end();
  const usage = input.opened.tap?.end().usage ?? emptyUsage();
  return { kind: "answered", finished: Promise.resolve({ kind: "complete", usage }) };
}

/** 开口之后边收边发，同时按协议读一遍回复（粘性要用其中的缓存读写 token 数）。 */
function relay(input: {
  opened: OpenedUpstream;
  res: Response;
  tidy: WholeArgsTidy | null;
}): Promise<AnswerEnd> {
  const { res } = input;
  const { response, held, tap } = input.opened;
  const usage = (reading: ReplyTap | null) => reading?.end().usage ?? emptyUsage();
  const sink = agentSink(input);
  if (response.readableEnded) {
    sink.end(held);
    return Promise.resolve({ kind: "complete", usage: usage(tap) });
  }
  sink.write(held);
  // 开口之后、接着读之前上游就断了：close 已经发过，不会再来；照断流处理。
  if (response.destroyed) {
    res.destroy();
    return Promise.resolve({ kind: "broken", message: "aborted" });
  }
  let agentGone = false;
  res.once("close", () => {
    if (!res.writableFinished) agentGone = true;
  });
  return new Promise((resolve) => {
    const complete = () => resolve({ kind: "complete", usage: usage(tap) });
    response.on("data", (chunk: Buffer) => tap?.feed(chunk));
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
    response.pipe(sink);
  });
}

/** 直通请求体要的：格式、路径后缀（count_tokens）、这家的地址、原请求体、两个模型名、这家接口与它不收的写法。 */
export interface PassthroughBodyInput {
  format: ApiEndpointRequestFormat;
  pathSuffix?: string;
  // 按厂商的改写按它认官方地址。
  baseUrl: string;
  body: Buffer;
  requestedModel: string;
  upstreamModel: string;
  endpoint: AdvisorEndpoint;
  refusals?: ShapeRefusals;
}

/**
 * 发给上游的请求体：换模型名；Anthropic 的请求（count_tokens 也算，照 magpie）按上游模型改 Claude Code 的几处；
 * Anthropic 与 Responses 的对话请求再按上游模型与它不收的写法改几处，并去掉这家这个模型不收的字段。
 */
export function upstreamBody(input: PassthroughBodyInput): Buffer {
  const conversation = input.pathSuffix === undefined;
  const anthropic = input.format === "anthropic_messages";
  const fits = (anthropic || input.format === "openai_responses") && conversation;
  let text = input.body.toString("utf8");
  if (input.upstreamModel !== input.requestedModel) text = replaceModel(text, input.upstreamModel);
  if (anthropic) {
    text = fitClaudeCodeBody({ text, model: input.upstreamModel, endpoint: input.endpoint });
  }
  if (fits && anthropic) {
    text = fitAnthropicBody(text, input.upstreamModel);
    text = fitThinkingOff({
      text,
      model: input.upstreamModel,
      leftOn: input.refusals?.has("thinkingOff") ?? false,
    });
  } else if (fits) {
    if (replaysThinking(input.upstreamModel)) text = fitResponsesBody(text, input.upstreamModel);
    else text = withoutBareReasoning(text);
    if (input.refusals?.has("none")) text = noneAsLow(text);
  }
  // count_tokens 不带 refusals。
  const refusals = conversation ? input.refusals : undefined;
  if (refusals) text = withoutRefusedText({ text, format: input.format, refusals });
  text = withVendorText({ ...input, text });
  return Buffer.from(text);
}

/** 按厂商的改写（vendor-rewrites.ts，count_tokens 也算，照 magpie forwardOnce）：只改变了的顶层字段，其余字节原样。 */
function withVendorText(input: {
  text: string;
  format: ApiEndpointRequestFormat;
  baseUrl: string;
  upstreamModel: string;
}): string {
  const target = { baseUrl: input.baseUrl, model: input.upstreamModel };
  if (!hasVendorRewrites(target)) return input.text;
  const body = parseJson(input.text);
  if (!isRecord(body)) return input.text;
  const fitted = withVendorRewrites({ ...target, format: input.format, body });
  return withChangedKeys({ text: input.text, body, fitted });
}

/** 去掉这家这个模型不收的字段、降级它不收的写法：只改变了的顶层字段，其余字节原样。 */
function withoutRefusedText(input: {
  text: string;
  format: ApiEndpointRequestFormat;
  refusals: ShapeRefusals;
}): string {
  const body = parseJson(input.text);
  if (!isRecord(body)) return input.text;
  const { format, refusals } = input;
  const refused = (shape: RefusedShape) => refusals.has(shape);
  const dropped = withoutRefusedFields({ format, body, refused });
  const fitted = withDowngrades({ format, body: dropped, refused });
  return withChangedKeys({ text: input.text, body, fitted });
}

/** 请求体原文只改 fitted 里与 body 不同的顶层字段（去掉的也算），其余字节原样。 */
function withChangedKeys(input: {
  text: string;
  body: Record<string, unknown>;
  fitted: Record<string, unknown>;
}): string {
  const { body, fitted } = input;
  let out = input.text;
  for (const key of new Set([...Object.keys(body), ...Object.keys(fitted)])) {
    if (fitted[key] !== body[key]) out = applyEdits(out, modify(out, [key], fitted[key], {}));
  }
  return out;
}

/**
 * Claude Code 的请求按上游模型改：advisor 工具（withAdvisorFitted）；非 Claude 模型去掉计费行与自动模式的审查字段；
 * 4.6 起的 Claude 把 enabled 加预算改成 adaptive；不收采样参数的 Claude 去掉 temperature、top_p、top_k。
 * 发给 Claude 模型、没什么要改的请求逐字节原样。
 */
function fitClaudeCodeBody(input: {
  text: string;
  model: string;
  endpoint: AdvisorEndpoint;
}): string {
  const { text, model } = input;
  const body = parseJson(text);
  if (!isRecord(body)) return text;
  let fitted = withAdvisorFitted({ body, model, endpoint: input.endpoint });
  if (!isAnthropicModel(model)) fitted = withoutSafeguards(withoutBillingLine(fitted));
  fitted = adaptiveThinkingAsTaken(fitted, model);
  if (refusesSampling(model)) fitted = withoutSampling(fitted);
  return withChangedKeys({ text, body, fitted });
}

/**
 * 直通给 Responses 上游（要回放推理的 DeepSeek 除外）前，去掉没有封存内容的推理项：只有 id 与摘要，
 * 是中转站翻译回复时给 Codex 造的（rs_ 加随机 id）。请求不存储（store 不是 true）时上游按 id 找不到它，
 * 整个请求回 400「Item with id 'rs_…' not found」（magpie #1008）；它的摘要是模型写给自己的，不会被读回。
 */
function withoutBareReasoning(text: string): string {
  if (!text.includes('"reasoning"')) return text;
  const body = parseJson(text);
  // 存储的请求上游找得到这些项，原样发。
  const stored = !isRecord(body) || body.store === true;
  const input = stored ? undefined : body.input;
  if (!Array.isArray(input)) return text;
  const kept = input.filter((item) => !isBareReasoning(item));
  if (kept.length === input.length) return text;
  return applyEdits(text, modify(text, ["input"], kept, {}));
}

function isBareReasoning(item: unknown): boolean {
  if (!isRecord(item) || item.type !== "reasoning") return false;
  const sealed = typeof item.encrypted_content === "string" && item.encrypted_content !== "";
  return !sealed;
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
  keys: KeyHeaders;
  // 发给 Anthropic 地址上的非 Claude 模型：anthropic-beta 去掉自动模式审查的 beta。
  dropsReviewBeta: boolean;
  userAgent: string;
}): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    if (value !== undefined && !DROPPED_REQUEST_HEADERS.has(name)) out[name] = value;
  }
  const betas = out["anthropic-beta"];
  const fitsBetas = input.dropsReviewBeta && betas !== undefined;
  if (fitsBetas) {
    const kept = withoutReviewBeta(betas);
    if (kept === null) delete out["anthropic-beta"];
    else out["anthropic-beta"] = kept;
  }
  // 要上游不压缩：错误体要读出原文，回复原样转给 Agent。
  out["accept-encoding"] = "identity";
  out["user-agent"] = input.userAgent;
  return { ...out, ...keyHeaderValues({ apiKey: input.apiKey, keys: input.keys }) };
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
