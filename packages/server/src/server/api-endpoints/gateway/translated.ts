// 被拒后打开推理重问移植自 magpie（https://github.com/yetone/magpie，internal/gateway/gateway.go 的 forwardTranslated、forward 里的 RetryOneAuth，以及 forwardTranslated 里去掉拒收字段与画图工具的重问；回复里写成文字的调用与 JSON 外的代码块接在 forwardTranslated 的 written、encoder 与 render 处）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingMessage } from "node:http";
import { StringDecoder } from "node:string_decoder";
import type { Response } from "express";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { ModelFacts } from "../model-facts.js";
import type { StoredApiEndpoint } from "../store.js";
import { ANTHROPIC_VERSION, describeNetworkError, extractErrorDetail } from "../upstream-http.js";
import { sendAgentError, type AgentWire } from "./agent-errors.js";
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
import { downgradedRequest } from "./refused-downgrades.js";
import {
  requestOffersImageTool,
  takesImageTool,
  withoutImageToolRequest,
  withoutRefusedFields,
} from "./refused-fields.js";
import {
  ReplyCollector,
  openAIEffort,
  requestForModel,
  thinkingBackOn,
  type GatewayRequest,
  type StreamEvent,
} from "./translation/ir.js";
import { fenceFilter, unfencedReply } from "./translation/fence.js";
import { protocolOf } from "./translation/protocols.js";
import { SseReader } from "./translation/sse.js";
import { textCallFilter } from "./translation/text-calls.js";
import {
  ANSWERED_BY_HEADER,
  failedBySelf,
  isEventStream,
  openUpstream,
  readLimited,
  upstreamUrl,
  type AnswerEnd,
  type AttemptOutcome,
} from "./upstream-call.js";

/*
 * 翻译后的一次尝试：Agent 的请求经中间格式翻成这家能用的格式，上游一律流式请求；
 * 回复解码后按 Agent 的协议编码，Agent 要流式就边收边发，不要就攒齐渲染成整份回复。
 * 开口（第一段内容）前的失败与直通一样交回中转站换家；开口之后不再换家。
 * 关推理的请求上游不收（effort none、关思考）时，开口前在同一家打开推理、用最低档重问一次，并记住；
 * 两个认证头不能同时带时只带一个重问，也记住；不收请求里的某个字段时去掉它重问，也记住；
 * 不收结构化输出或预填时降级重问，也记住。推理档位、回复上限与采样参数按这家这个模型的资料填（requestForModel）。
 * 回复只改两处（照 magpie）：请求给了工具时，写在文字里的工具调用转成真调用（textCallFilter）；
 * Agent 要 JSON 时，剥掉模型包在外面的代码块（fenceFilter、unfencedReply）。
 */

type StreamEnd = { kind: "ended" } | { kind: "broken"; message: string } | { kind: "gone" };

export async function attemptTranslated(input: {
  res: Response;
  wire: AgentWire;
  endpoint: StoredApiEndpoint;
  baseUrl: string;
  apiKey: string;
  // Agent 说的格式与这次发给上游的格式。
  from: ApiEndpointRequestFormat;
  to: ApiEndpointRequestFormat;
  request: GatewayRequest;
  requestedModel: string;
  upstreamModel: string;
  // 这家这个模型的资料（ModelFactsLookup）。
  facts: ModelFacts;
  headerTimeoutMs: number;
  // 这家的这个模型不收哪些不思考的写法。
  refusals: ShapeRefusals;
  keepAlive: AgentKeepAlive;
}): Promise<AttemptOutcome> {
  const { res, apiKey, to, refusals } = input;
  const url = upstreamUrl({ baseUrl: input.baseUrl, format: to });
  const sends = () => keyHeadersFor({ format: to, refusals });
  const open = (body: string, keys: KeyHeaders = sends()) =>
    openUpstream({
      res,
      url,
      headers: translatedHeaders({ apiKey, keys, to }),
      body: Buffer.from(body),
      apiKey,
      headerTimeoutMs: input.headerTimeoutMs,
      reads: to,
      onHeard: () => input.keepAlive.heard(),
    });
  const build = (asked: ShapeRefusals = refusals) =>
    upstreamBody({
      request: input.request,
      from: input.from,
      to,
      model: input.upstreamModel,
      facts: input.facts,
      refusals: asked,
    });
  const body = build();
  const keys = sends();
  let opened = await open(body, keys);
  if (opened.kind === "failed") {
    opened = await askWithOneKeyHeader({
      refusals,
      sent: keys,
      failed: opened,
      ask: (alone) => open(body, alone),
    });
  }
  const refitted = await askRefitted({
    refusals,
    format: to,
    sent: body,
    outcome: opened,
    refit: build,
    ask: open,
  });
  const sentCacheKey = sendsCacheKey({ request: input.request, to, refusals });
  opened = await askWithoutField({
    refusals,
    field: "cacheKey",
    offered: sentCacheKey,
    outcome: refitted.outcome,
    ask: (without) => open(build(without)),
  });
  const sentImageTool = !refusals.has("imageTool") && requestOffersImageTool(input.request);
  const mayRefuseImageTool = sentImageTool && !takesImageTool(input.baseUrl);
  opened = await askWithoutField({
    refusals,
    field: "imageTool",
    offered: mayRefuseImageTool,
    outcome: opened,
    ask: (without) => open(build(without)),
  });
  if (opened.kind !== "opened") return opened;
  const { response, held, ended } = opened;
  if (!isEventStream(response, held)) {
    // 上游没理会 stream: true：读不出事件，当作开口前失败换家。
    const text = await wholeText({ response, held, ended });
    return failedBySelf({
      status: 502,
      detail: `${url.origin}: the reply was not a stream: ${extractErrorDetail(text, apiKey)}`,
    });
  }
  input.keepAlive.stop();
  const finished = input.request.stream
    ? streamReply({ ...input, response, held, ended })
    : wholeReply({ ...input, response, held, ended });
  return { kind: "answered", finished };
}

function translatedHeaders(input: {
  apiKey: string;
  keys: KeyHeaders;
  to: ApiEndpointRequestFormat;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    // 要上游不压缩：错误体要读出原文。
    "accept-encoding": "identity",
    ...keyHeaderValues({ apiKey: input.apiKey, keys: input.keys }),
  };
  if (input.to === "anthropic_messages") headers["anthropic-version"] = ANTHROPIC_VERSION;
  return headers;
}

/** 上游整份回复的原文：开口时已经收完的就是扣下的那些。 */
function wholeText(input: {
  response: IncomingMessage;
  held: Buffer;
  ended: boolean;
}): Promise<string> {
  if (input.ended) return Promise.resolve(input.held.toString("utf8"));
  return readLimited({ stream: input.response, first: input.held });
}

/** 发给上游的请求体（JSON）：按这家这个模型不收的写法改过请求，翻好后再去掉它不收的字段。 */
function upstreamBody(input: {
  request: GatewayRequest;
  from: ApiEndpointRequestFormat;
  to: ApiEndpointRequestFormat;
  model: string;
  facts: ModelFacts;
  refusals: ShapeRefusals;
}): string {
  const { to, refusals } = input;
  let request = allowedReasoning({ request: input.request, to, refusals });
  if (refusals.has("imageTool")) request = withoutImageToolRequest(request);
  request = downgradedRequest({
    request,
    to,
    refused: (shape) => refusals.has(shape),
    // Chat、Responses 的 Agent 把末尾的 assistant 消息当作说完的一轮；Anthropic 的是它自己要的预填。
    lastIsTurn: input.from !== "anthropic_messages",
  });
  request = requestForModel({ request, to, facts: input.facts });
  const built = protocolOf(to).build({ ...request, stream: true }, input.model);
  const body = withoutRefusedFields({
    format: to,
    body: built,
    refused: (field) => refusals.has(field),
  });
  return JSON.stringify(body);
}

/** 这次翻出的请求带着 prompt_cache_key：Chat 与 Responses 上游才收，这家这个模型没说过不收。 */
function sendsCacheKey(input: {
  request: GatewayRequest;
  to: ApiEndpointRequestFormat;
  refusals: ShapeRefusals;
}): boolean {
  const carried = input.request.cacheKey !== "" && input.to !== "anthropic_messages";
  return carried && !input.refusals.has("cacheKey");
}

/** 关推理的请求：这家说过不收这种写法（Anthropic 关思考、OpenAI 的 none）的，打开推理、用最低档问。 */
function allowedReasoning(input: {
  request: GatewayRequest;
  to: ApiEndpointRequestFormat;
  refusals: ShapeRefusals;
}): GatewayRequest {
  const { request, to, refusals } = input;
  const anthropic = to === "anthropic_messages";
  const off = anthropic ? request.thinkOff : openAIEffort(request) === "none";
  const shape: RefusedShape = anthropic ? "thinkingOff" : "none";
  return off && refusals.has(shape) ? thinkingBackOn(request) : request;
}

/** Agent 要流式：解码一个事件就编码一个事件写给它。上游断流就断开 Agent 的连接，由 CLI 自己报错。 */
async function streamReply(input: {
  res: Response;
  endpoint: StoredApiEndpoint;
  from: ApiEndpointRequestFormat;
  to: ApiEndpointRequestFormat;
  request: GatewayRequest;
  requestedModel: string;
  response: IncomingMessage;
  held: Buffer;
  ended: boolean;
}): Promise<AnswerEnd> {
  const { res } = input;
  // 保活已经回了 200 与响应头：接着在同一个流里写。
  if (!res.headersSent) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      [ANSWERED_BY_HEADER]: input.endpoint.slug,
    });
  }
  const encoder = protocolOf(input.from).encoder({
    model: input.requestedModel,
    write: (text) => res.write(text),
    request: input.request,
  });
  const decoder = protocolOf(input.to).decoder();
  const fence = fenceFilter({ request: input.request, emit: (event) => encoder.event(event) });
  const calls = textCallFilter({ tools: input.request.tools, emit: (event) => fence.event(event) });
  const emit = (event: StreamEvent) => calls.event(event);
  const reader = new SseReader((data) => decoder.decode(data, emit));
  const end = await readStream({ ...input, onText: (text) => reader.feed(text) });
  if (end.kind === "gone") return end;
  if (end.kind === "broken") {
    res.destroy();
    return end;
  }
  reader.end();
  decoder.end?.(emit);
  calls.end();
  fence.end();
  encoder.finish();
  res.end();
  return { kind: "complete", cacheRead: encoder.usage().cacheRead };
}

/** Agent 不要流式：攒齐整份回复再一次给它；只想了一下就出错的回复按出错交给它。 */
async function wholeReply(input: {
  res: Response;
  wire: AgentWire;
  endpoint: StoredApiEndpoint;
  from: ApiEndpointRequestFormat;
  to: ApiEndpointRequestFormat;
  request: GatewayRequest;
  requestedModel: string;
  response: IncomingMessage;
  held: Buffer;
  ended: boolean;
}): Promise<AnswerEnd> {
  const { res, endpoint } = input;
  const collector = new ReplyCollector();
  const decoder = protocolOf(input.to).decoder();
  const calls = textCallFilter({
    tools: input.request.tools,
    emit: (event) => collector.add(event),
  });
  const emit = (event: StreamEvent) => calls.event(event);
  const reader = new SseReader((data) => decoder.decode(data, emit));
  const end = await readStream({ ...input, onText: (text) => reader.feed(text) });
  if (end.kind === "gone") return end;
  reader.end();
  decoder.end?.(emit);
  calls.end();
  let failure: string | null = null;
  if (end.kind === "broken") failure = end.message;
  else if (collector.error && !collector.saidAnything()) failure = collector.error.message;
  const headers = { [ANSWERED_BY_HEADER]: endpoint.slug };
  if (failure !== null) {
    sendAgentError({
      res,
      wire: input.wire,
      error: { status: 502, message: `${endpoint.name}: ${failure}` },
      headers,
    });
    return { kind: "broken", message: failure };
  }
  const reply = unfencedReply({ reply: collector.finish(), request: input.request });
  res
    .status(200)
    .set(headers)
    .json(
      protocolOf(input.from).render(reply, { model: input.requestedModel, request: input.request }),
    );
  return { kind: "complete", cacheRead: reply.usage.cacheRead };
}

/** 读上游的流直到结束（从开口时扣下的字节读起）；字符可能被切在两段之间，按 UTF-8 接好再交出去。 */
function readStream(input: {
  res: Response;
  response: IncomingMessage;
  held: Buffer;
  ended: boolean;
  onText: (text: string) => void;
}): Promise<StreamEnd> {
  const { response, res } = input;
  const utf8 = new StringDecoder("utf8");
  input.onText(utf8.write(input.held));
  if (input.ended) {
    input.onText(utf8.end());
    return Promise.resolve({ kind: "ended" });
  }
  let agentGone = false;
  res.once("close", () => {
    if (!res.writableFinished) agentGone = true;
  });
  return new Promise((resolve) => {
    response.on("data", (chunk: Buffer) => input.onText(utf8.write(chunk)));
    response.once("end", () => {
      input.onText(utf8.end());
      resolve({ kind: "ended" });
    });
    const broke = (error?: Error) => {
      if (response.complete) return;
      if (agentGone) resolve({ kind: "gone" });
      else resolve({ kind: "broken", message: error ? describeNetworkError(error) : "aborted" });
    };
    response.once("error", broke);
    response.once("close", () => broke());
    response.resume();
  });
}
