import type { IncomingMessage } from "node:http";
import { StringDecoder } from "node:string_decoder";
import type { Response } from "express";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { StoredApiEndpoint } from "../store.js";
import { ANTHROPIC_VERSION, describeNetworkError, extractErrorDetail } from "../upstream-http.js";
import { sendAgentError, type AgentWire } from "./agent-errors.js";
import { ReplyCollector, type GatewayRequest } from "./translation/ir.js";
import { protocolOf } from "./translation/protocols.js";
import { SseReader } from "./translation/sse.js";
import {
  ANSWERED_BY_HEADER,
  failedBySelf,
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
}): Promise<AttemptOutcome> {
  const { res, apiKey, to } = input;
  const body = protocolOf(to).build({ ...input.request, stream: true }, input.upstreamModel);
  const url = upstreamUrl({ baseUrl: input.baseUrl, format: to });
  const opened = await openUpstream({
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

function isEventStream(response: IncomingMessage, first: Buffer | null): boolean {
  if (String(response.headers["content-type"] ?? "").includes("text/event-stream")) return true;
  return first !== null && /^\s*(data:|event:|:)/.test(first.toString("utf8", 0, 64));
}

/** Agent 要流式：解码一个事件就编码一个事件写给它。上游断流就断开 Agent 的连接，由 CLI 自己报错。 */
async function streamReply(input: {
  res: Response;
  endpoint: StoredApiEndpoint;
  from: ApiEndpointRequestFormat;
  to: ApiEndpointRequestFormat;
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
  });
  const decoder = protocolOf(input.to).decoder();
  const reader = new SseReader((data) => decoder.decode(data, (event) => encoder.event(event)));
  const end = await readStream({ ...input, onText: (text) => reader.feed(text) });
  if (end.kind === "gone") return end;
  if (end.kind === "broken") {
    res.destroy();
    return end;
  }
  reader.end();
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
  requestedModel: string;
  response: IncomingMessage;
  first: Buffer | null;
}): Promise<AnswerEnd> {
  const { res, endpoint } = input;
  const collector = new ReplyCollector();
  const decoder = protocolOf(input.to).decoder();
  const reader = new SseReader((data) => decoder.decode(data, (event) => collector.add(event)));
  const end = await readStream({ ...input, onText: (text) => reader.feed(text) });
  if (end.kind === "gone") return end;
  reader.end();
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
  res.status(200).set(headers).json(protocolOf(input.from).render(reply, input.requestedModel));
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
