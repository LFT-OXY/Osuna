// 被拒后打开推理重问移植自 magpie（https://github.com/yetone/magpie，internal/gateway/gateway.go 的 forwardTranslated）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingMessage } from "node:http";
import { StringDecoder } from "node:string_decoder";
import type { Response } from "express";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { StoredApiEndpoint } from "../store.js";
import { ANTHROPIC_VERSION, describeNetworkError, extractErrorDetail } from "../upstream-http.js";
import { sendAgentError, type AgentWire } from "./agent-errors.js";
import { noteRefusal, type RefusedShape, type ShapeRefusals } from "./refusals.js";
import {
  ReplyCollector,
  openAIEffort,
  thinkingBackOn,
  type GatewayRequest,
  type StreamEvent,
} from "./translation/ir.js";
import { protocolOf } from "./translation/protocols.js";
import { SseReader } from "./translation/sse.js";
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
 * 开口前的失败与直通一样交回中转站换家；开口之后不再换家。
 * 关推理的请求上游不收（effort none、关思考）时，开口前在同一家打开推理、用最低档重问一次，并记住。
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
  headerTimeoutMs: number;
  // 这家的这个模型不收哪些不思考的写法。
  refusals: ShapeRefusals;
}): Promise<AttemptOutcome> {
  const { res, apiKey, to, refusals } = input;
  const url = upstreamUrl({ baseUrl: input.baseUrl, format: to });
  const open = (body: Record<string, unknown>) =>
    openUpstream({
      res,
      url,
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        // 要上游不压缩：错误体要读出原文。
        "accept-encoding": "identity",
        authorization: `Bearer ${apiKey}`,
        ...(to === "anthropic_messages"
          ? { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION }
          : {}),
      },
      body: Buffer.from(JSON.stringify(body)),
      apiKey,
      headerTimeoutMs: input.headerTimeoutMs,
    });
  const build = () =>
    protocolOf(to).build(
      { ...allowedReasoning({ request: input.request, to, refusals }), stream: true },
      input.upstreamModel,
    );
  const body = build();
  let opened = await open(body);
  if (opened.kind === "failed" && noteRefusal({ refusals, format: to, body, failed: opened })) {
    opened = await open(build());
  }
  if (opened.kind !== "opened") return opened;
  const { response, first } = opened;
  if (!isEventStream(response, first)) {
    // 上游没理会 stream: true：读不出事件，当作开口前失败换家。
    const text = await readLimited({ stream: response, first });
    return failedBySelf({
      status: 502,
      detail: `${url.origin}: the reply was not a stream: ${extractErrorDetail(text, apiKey)}`,
      timedOut: false,
    });
  }
  const finished = input.request.stream
    ? streamReply({ ...input, response, first })
    : wholeReply({ ...input, response, first });
  return { kind: "answered", finished };
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
  first: Buffer | null;
}): Promise<AnswerEnd> {
  const { res } = input;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    [ANSWERED_BY_HEADER]: input.endpoint.slug,
  });
  const encoder = protocolOf(input.from).encoder({
    model: input.requestedModel,
    write: (text) => res.write(text),
    request: input.request,
  });
  const decoder = protocolOf(input.to).decoder();
  const emit = (event: StreamEvent) => encoder.event(event);
  const reader = new SseReader((data) => decoder.decode(data, emit));
  const end = await readStream({ ...input, onText: (text) => reader.feed(text) });
  if (end.kind === "gone") return end;
  if (end.kind === "broken") {
    res.destroy();
    return end;
  }
  reader.end();
  decoder.end?.(emit);
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
  first: Buffer | null;
}): Promise<AnswerEnd> {
  const { res, endpoint } = input;
  const collector = new ReplyCollector();
  const decoder = protocolOf(input.to).decoder();
  const emit = (event: StreamEvent) => collector.add(event);
  const reader = new SseReader((data) => decoder.decode(data, emit));
  const end = await readStream({ ...input, onText: (text) => reader.feed(text) });
  if (end.kind === "gone") return end;
  reader.end();
  decoder.end?.(emit);
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
  const reply = collector.finish();
  res
    .status(200)
    .set(headers)
    .json(
      protocolOf(input.from).render(reply, { model: input.requestedModel, request: input.request }),
    );
  return { kind: "complete", cacheRead: reply.usage.cacheRead };
}

/** 读上游的流直到结束；字符可能被切在两段之间，按 UTF-8 接好再交出去。 */
function readStream(input: {
  res: Response;
  response: IncomingMessage;
  first: Buffer | null;
  onText: (text: string) => void;
}): Promise<StreamEnd> {
  const { response, res } = input;
  const utf8 = new StringDecoder("utf8");
  if (input.first) input.onText(utf8.write(input.first));
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
