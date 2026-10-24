// fitAnthropicBody、fitResponsesBody 与被拒重问移植自 magpie（https://github.com/yetone/magpie，internal/gateway/anthropic.go 的 thinkingOffUnlessAsked、withThinkingOnToolTurns、
// adaptiveThinking、samplingAsTaken，responses.go 的 withReasoningText，codex_backend.go 的 withoutBareReasoning，gateway.go 的 passthrough 里按上游模型改的几处、
// 直通重问与 attempt 里去掉拒收字段、画图工具的重问；按厂商的改写接在 forwardOnce 处，Grok 回复的整数接在直通回复的 intTidy 处；
// 保活之后整份回复照流写出照 fallback.go 的 holdWriter.release 与 whole_stream.go 的 wholeAsStream；开口后断流在流尾补错误照 gateway.go 直通回复里的 apart 与 streamFailure；
// 直通 Chat 时 developer 改 system 照 gateway.go 的 developerAsSystem，工具轮补推理照 chattidy.go 的 withReasoningOnToolTurns、
// 给 Mistral 的推理照 mistralThinking，Gemini 的思考签名照 chatCallSignatures 与 sigTidy，回复的修整照直通回复里的 chatTidy、textCallTidy 与 chatWhole）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingHttpHeaders } from "node:http";
import { StringDecoder } from "node:string_decoder";
import { Transform, type Writable } from "node:stream";
import type { Request, Response } from "express";
import { applyEdits, modify } from "jsonc-parser";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { upstreamModelName } from "@getpaseo/protocol/api-endpoint/model-settings";
import type { StoredApiEndpoint } from "../store.js";
import { isRecord, parseJson, type Secrets } from "../upstream-http.js";
import {
  adaptiveThinkingAsTaken,
  isAnthropicModel,
  refusesSampling,
  thinkingLeftOn,
  thinkingOffAsTaken,
  thinkingOnToolTurns,
} from "./translation/anthropic.js";
import { NO_REASONING, emptyUsage, replaysThinking } from "./translation/ir.js";
import { reasoningText } from "./translation/chat.js";
import {
  ChatStreamTidy,
  ChatWholeTidy,
  TextCallStreamTidy,
  chatToolNames,
} from "./chat-reply-tidy.js";
import {
  GeminiSignatureTidy,
  chatCallSignatures,
  geminiCompat,
  type GeminiSignatureStore,
} from "./gemini-signatures.js";
import { hostOf } from "../model-facts.js";
import { replayedReasoningInput } from "./translation/responses.js";
import { sendAgentError, type AgentWire } from "./agent-errors.js";
import { ENDED_SHORT, brokenTail, connectionLost, endedShort } from "./broken-reply.js";
import {
  withAdvisorFitted,
  withoutBillingLine,
  fittedBetas,
  type AdvisorEndpoint,
} from "./claude-code-fields.js";
import type { AgentKeepAlive } from "./keepalive.js";
import {
  askRefitted,
  askWithOneKeyHeader,
  askWithoutField,
  keyHeadersFor,
  signedHeaders,
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
import { chainedTidy, ReplyModelName, type ReplyTidy } from "./reply-tidy.js";
import { UNTIMED } from "./reply-clock.js";
import type { ReplyTap, TappedReply } from "./reply-tap.js";
import { refusedAfterOpening } from "./safety-filter.js";
import { withFixedEffort, type FixedEffort } from "./fixed-effort.js";
import { withoutAnyReasoning } from "./no-thinking.js";
import { sseEvent } from "./translation/sse.js";
import { hasVendorRewrites, withVendorRewrites } from "./vendor-rewrites.js";
import { withTemplatePassthroughRewrites } from "./template-rewrites.js";
import { BEDROCK_TEMPLATE_ID } from "../templates.js";
import {
  secretsOf,
  storedRequestExtras,
  unsendableHeader,
  unsendableHeaderMessage,
  withExtraBody,
  type RequestExtras,
} from "../request-extras.js";
import { searchesWebItself, withoutResponsesWebSearch } from "./web-search.js";
import { wholeEvents } from "./whole-stream.js";
import {
  ANSWERED_BY_HEADER,
  isEventStream,
  notAStream,
  openUpstream,
  readLimited,
  answerUnlessRefused,
  failedBySelf,
  upstreamUrl,
  type AnswerEnd,
  type DeliveredReply,
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
 * 开口时先交出扣下的帧，之后边收边发，同时按协议读一遍（ReplyTap）；开口后上游断了（连接中断，或流读完了却没说完），
 * 事件流在流尾补错误事件（broken-reply.ts），整份回复补不了，断开 Agent 的连接。
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
  // 「模型名:档位」固定的档位，已按这家这个模型落定。
  fixedEffort?: FixedEffort;
  // 模型设置里一档思考都不留：不带任何思考参数（no-thinking.ts）。
  noThinking?: boolean;
  req: Request;
  res: Response;
  format: ApiEndpointRequestFormat;
  // 格式路径后面再接的一段：count_tokens 是 `/count_tokens`。
  pathSuffix?: string;
  endpoint: StoredApiEndpoint;
  baseUrl: string;
  // 没 key 的接口为 null，不带认证头。
  apiKey: string | null;
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
  // 只把这些 Agent 的请求头转给上游（ChatGPT 登录的 Codex 只带表明身份的头）；缺省是 Agent 的全部请求头。
  forwardedHeaders?: IncomingHttpHeaders;
  // 附加请求体里 ${sessionId} 换成的对话标识（request-extras.ts 的 extraBodySession）；count_tokens 不带附加请求体。
  sessionId?: string;
  // 直转 Chat 时 Gemini 思考签名存放处（gemini-signatures.ts）；count_tokens 不用。
  signatures?: GeminiSignatureStore;
}): Promise<AttemptOutcome> {
  const { res, apiKey, refusals } = input;
  const extras = storedRequestExtras(input.endpoint);
  const secrets = secretsOf({ apiKey, extras });
  // 这家的请求头发不出去：这一个请求当作连不上，照常换家（magpie 里 Go 发请求时报错也是这样）。
  const unsendable = unsendableHeader(extras);
  if (unsendable !== null) {
    return failedBySelf({ status: 502, detail: unsendableHeaderMessage(unsendable) });
  }
  const { originalUrl } = input.req;
  const url = upstreamUrl({
    baseUrl: input.baseUrl,
    format: input.format,
    suffix: input.pathSuffix,
    query: originalUrl.includes("?") ? originalUrl.slice(originalUrl.indexOf("?")) : "",
  });
  const sends = () =>
    keyHeadersFor({
      format: input.format,
      templateId: input.endpoint.templateId,
      baseUrl: input.baseUrl,
      extras,
      refusals,
    });
  const anthropic = input.format === "anthropic_messages";
  const sent = sentModelOf(input);
  const isClaude = isAnthropicModel(input.upstreamModel) || isAnthropicModel(sent);
  const dropsReviewBeta = anthropic && !isClaude;
  const open = (body: Buffer, keys: KeyHeaders = sends()) =>
    openUpstream({
      res,
      url,
      headers: upstreamHeaders({
        headers: input.forwardedHeaders ?? input.req.headers,
        apiKey,
        keys,
        extras,
        dropsReviewBeta,
        forBedrock: input.endpoint.templateId === BEDROCK_TEMPLATE_ID,
        userAgent: input.userAgent,
      }),
      body,
      secrets,
      uncheckedHosts: extras.uncheckedHosts,
      headerTimeoutMs: input.headerTimeoutMs,
      reads: input.pathSuffix === undefined ? input.format : null,
      onHeard: () => input.keepAlive?.heard(),
    });
  const body = upstreamBody(input);
  const keys = sends();
  let opened = await open(body, keys);
  // 没 key 时没带认证头，401 与「两个头不能同时带」无关。
  if (opened.kind === "failed" && refusals && apiKey !== null) {
    opened = await askWithOneKeyHeader({
      refusals,
      sent: keys,
      extras,
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
  return answerUnlessRefused({
    opened,
    format: input.format,
    answer: (ready) => answerOpened({ ...input, url, secrets, opened: ready }),
  });
}

/** 开了口的回复交给 Agent：先交出扣下的帧，之后边收边发；保活之后收到的整份回复照流写出。 */
async function answerOpened(input: {
  res: Response;
  format: ApiEndpointRequestFormat;
  pathSuffix?: string;
  endpoint: StoredApiEndpoint;
  baseUrl: string;
  body: Buffer;
  signatures?: GeminiSignatureStore;
  secrets: Secrets;
  requestedModel: string;
  upstreamModel: string;
  url: URL;
  opened: OpenedUpstream;
  keepAlive?: AgentKeepAlive;
}): Promise<AttemptOutcome> {
  const { res, opened } = input;
  const tidy = replyTidy(input);
  const keptAliveWhole = res.headersSent && !isEventStream(opened.response, opened.held);
  if (keptAliveWhole) return wholeAsStream({ ...input, tidy });
  input.keepAlive?.stop();
  // 保活已经回了 200 与响应头：接着在同一个流里交出回复。
  if (!res.headersSent) {
    const headers = responseHeaders(opened.response.headers);
    // 改过的回复长度会变。
    if (tidy !== null) delete headers["content-length"];
    res.writeHead(opened.status, { ...headers, [ANSWERED_BY_HEADER]: input.endpoint.slug });
  }
  const finished = relay({
    opened,
    res,
    tidy,
    format: input.format,
    endpointName: input.endpoint.name,
  });
  return { kind: "answered", finished };
}

/** 发给这家的模型名：这个模型的上游模型名（protocol 的 upstreamModelName），没设就是这家列出的写法。 */
function sentModelOf(input: {
  endpoint: Pick<StoredApiEndpoint, "modelSettings">;
  upstreamModel: string;
}): string {
  return upstreamModelName({
    settings: input.endpoint.modelSettings,
    modelId: input.upstreamModel,
  });
}

/**
 * 要改的回复：Grok 的对话回复去掉调用参数里的零小数（grok-integral.ts）；按上游模型名发的，回复里的模型名换回这家列出的写法
 * （reply-model-name.ts），CLI 看到的模型名不随上游模型名变。别的回复原样转，为 null。
 */
function replyTidy(input: {
  format: ApiEndpointRequestFormat;
  pathSuffix?: string;
  requestedModel: string;
  upstreamModel: string;
  endpoint: Pick<StoredApiEndpoint, "modelSettings">;
  baseUrl: string;
  body: Buffer;
  signatures?: GeminiSignatureStore;
  opened: OpenedUpstream;
}): ReplyTidy | null {
  const { format, opened } = input;
  const conversation = input.pathSuffix === undefined;
  if (!conversation) return null;
  const stream = isEventStream(opened.response, opened.held);
  const sent = sentModelOf(input);
  const tidies: ReplyTidy[] = format === "openai_chat" ? chatTidies({ ...input, stream }) : [];
  if (isGrokReply({ ...input, sentModel: sent })) {
    tidies.push(new WholeArgsTidy({ format, stream }));
  }
  const { signatures } = input;
  const gemini = geminiCompat({ baseUrl: input.baseUrl, model: sent });
  if (format === "openai_chat" && gemini && signatures !== undefined) {
    tidies.push(new GeminiSignatureTidy({ stream, store: signatures }));
  }
  if (sent !== input.upstreamModel) {
    tidies.push(new ReplyModelName({ format, stream, sent, shown: input.upstreamModel }));
  }
  return chainedTidy(tidies);
}

/** 直转的 Chat 回复的修整（chat-reply-tidy.ts）：流去掉几种空写法、写进文字的调用转成真调用；整份的另有一套。 */
function chatTidies(input: { body: Buffer; stream: boolean }): ReplyTidy[] {
  const names = chatToolNames(parseJson(input.body.toString("utf8")));
  if (!input.stream) return [new ChatWholeTidy(names)];
  const tidies: ReplyTidy[] = [new ChatStreamTidy()];
  if (names !== null) tidies.push(new TextCallStreamTidy(names));
  return tidies;
}

/** 交给 Agent 的那一路：要改的回复先经 tidy，按 UTF-8 接好字符再改；别的直接写给 Agent。 */
function agentSink(input: { res: Response; tidy: ReplyTidy | null }): Writable {
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
  secrets: Secrets;
  opened: OpenedUpstream;
  tidy: ReplyTidy | null;
  keepAlive?: AgentKeepAlive;
}): Promise<AttemptOutcome> {
  const { res, tidy } = input;
  const raw = await readLimited({ stream: input.opened.response, first: input.opened.held });
  let text = raw;
  if (tidy !== null) text = tidy.write(raw) + tidy.end();
  const events = wholeEvents(input.format, parseJson(text));
  if (events === null) return notAStream({ url: input.url, text: raw, secrets: input.secrets });
  input.keepAlive?.stop();
  for (const event of events) res.write(sseEvent(event.name, event.data));
  res.end();
  // 上游没流式：一次交出，不记首字（magpie 对不流式的回复也不记）。
  return { kind: "answered", finished: Promise.resolve(endOf(input.opened.tap, null)) };
}

/** 开口之后边收边发，同时按协议读一遍回复（粘性要用其中的缓存读写 token 数）。 */
function relay(input: {
  opened: OpenedUpstream;
  res: Response;
  tidy: ReplyTidy | null;
  format: ApiEndpointRequestFormat;
  endpointName: string;
}): Promise<AnswerEnd> {
  const { res, format } = input;
  const { response, held, tap } = input.opened;
  const sink = agentSink(input);
  const streamed = isEventStream(response, held);
  const wire = wireOf(format);
  let atLine = endsLine({ chunk: held, before: true });
  // 开口前扣下的帧在这一刻才交给 Agent：读到得更早的内容按这一刻算首字；整份回复不记首字。
  const deliveredAt = streamed ? Date.now() : null;
  const tailed = (reason: string): AnswerEnd => {
    const { endpointName } = input;
    sink.end(brokenTail({ wire, endpointName, reason, atLine }));
    return { kind: "broken", message: reason };
  };
  // 上游的流收完了：没说完的在流尾补错误，说完的照常结束。
  const completed = (): AnswerEnd => {
    if (tappedShort({ tap, format, streamed })) return tailed(ENDED_SHORT);
    sink.end();
    return endOf(tap, deliveredAt);
  };
  // 开口后连接断了：事件流在流尾补错误；整份回复补不了，断开 Agent 的连接，由 CLI 自己报错。
  const cut = (reason: string): AnswerEnd => {
    if (streamed) return tailed(reason);
    res.destroy();
    return { kind: "broken", message: reason };
  };
  sink.write(held);
  if (response.readableEnded) return Promise.resolve(completed());
  // 开口之后、接着读之前上游就断了：close 已经发过，不会再来；照断流处理。
  if (response.destroyed) return Promise.resolve(cut(connectionLost({ error: undefined })));
  let agentGone = false;
  res.once("close", () => {
    if (!res.writableFinished) agentGone = true;
  });
  return new Promise((resolve) => {
    // end、error、close 可能接连发出：Agent 的响应只结束一次。
    let settled = false;
    const settle = (end: () => AnswerEnd) => {
      if (settled) return;
      settled = true;
      resolve(end());
    };
    response.on("data", (chunk: Buffer) => {
      tap?.feed(chunk);
      atLine = endsLine({ chunk, before: atLine });
    });
    response.once("end", () => settle(completed));
    const broke = (error?: Error) => {
      // 上游已经收完：Agent 这时离开也算答完了（end 可能因为没人读而不再发出）。
      if (response.complete) settle(completed);
      else if (agentGone) settle(() => ({ kind: "gone" }));
      else settle(() => cut(connectionLost({ error })));
    };
    response.once("error", broke);
    response.once("close", () => broke());
    // 流尾可能要补错误：Agent 的响应由这里结束。
    response.pipe(sink, { end: false });
  });
}

const NEWLINE = 0x0a;

/** 写给 Agent 的最后一个字节是不是换行；这一段是空的，照之前的。 */
function endsLine(input: { chunk: Buffer; before: boolean }): boolean {
  const last = input.chunk.at(-1);
  if (last === undefined) return input.before;
  return last === NEWLINE;
}

/** 直通时上游的格式就是 Agent 说的格式。 */
function wireOf(format: ApiEndpointRequestFormat): AgentWire {
  if (format === "anthropic_messages") return "anthropic";
  return format === "openai_chat" ? "chat" : "openai";
}

/** 读完了的事件流没说完（broken-reply.ts 的 endedShort）；整份回复与不读的回复（count_tokens）不算。 */
function tappedShort(input: {
  tap: ReplyTap | null;
  format: ApiEndpointRequestFormat;
  streamed: boolean;
}): boolean {
  const { tap } = input;
  if (tap === null) return false;
  if (!input.streamed) return false;
  const reply = tap.end();
  const stopped = reply.stop !== null;
  const failed = reply.error !== null;
  return endedShort({ format: input.format, ending: { stopped, ended: reply.ended, failed } });
}

/** 回复收完了：开口后才拒答的照常转给了 Agent，不算答成功；别的带上这次的用量。 */
function endOf(tap: ReplyTap | null, deliveredAt: number | null): AnswerEnd {
  const reply = tap?.end();
  const delivered = deliveredReply({ tap, reply, deliveredAt });
  if (reply && refusedAfterOpening(reply)) return { kind: "refused", reply: delivered };
  return { kind: "complete", usage: delivered.usage, reply: delivered };
}

/**
 * 直通原样转出回复，回复编号就是上游的；扣下的帧里早于交出的时刻按交出的时刻算，
 * 没流式交出（deliveredAt 为 null）时不计时。
 */
function deliveredReply(input: {
  tap: ReplyTap | null;
  reply: TappedReply | undefined;
  deliveredAt: number | null;
}): DeliveredReply {
  const { tap, reply, deliveredAt } = input;
  const times =
    tap === null || deliveredAt === null ? UNTIMED : tap.times({ notBefore: deliveredAt });
  return {
    id: reply?.id ?? "",
    usage: reply?.usage ?? emptyUsage(),
    stop: reply?.stop ?? null,
    ...times,
  };
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
  endpoint: AdvisorEndpoint &
    Pick<StoredApiEndpoint, "searchesWeb" | "baseUrls" | "templateId" | "extraBody">;
  refusals?: ShapeRefusals;
  // 附加请求体里 ${sessionId} 换成的对话标识；没有为空。
  sessionId?: string;
  // 「模型名:档位」固定的档位，已按这家这个模型落定；没有为省略。
  fixedEffort?: FixedEffort;
  // 直转 Chat 时 Gemini 思考签名存放处；没有时不动调用 id。
  signatures?: GeminiSignatureStore;
  // 模型设置里一档思考都不留：对话请求不带任何思考参数，固定的档位也不发（magpie Reasonless）。
  noThinking?: boolean;
}

/**
 * 发给上游的请求体：换模型名；Anthropic 的请求（count_tokens 也算，照 magpie）按上游模型改 Claude Code 的几处；
 * Anthropic 与 Responses 的对话请求再按上游模型与它不收的写法改几处，并去掉这家这个模型不收的字段。
 */
export function upstreamBody(input: PassthroughBodyInput): Buffer {
  const conversation = input.pathSuffix === undefined;
  const anthropic = input.format === "anthropic_messages";
  const fits = (anthropic || input.format === "openai_responses") && conversation;
  const sent = sentModelOf(input);
  // 要回放推理的模型按原名或上游模型名认出一个就算（magpie replaysReasoning(model) || replaysReasoning(upstream)）。
  const replayModel = replaysThinking(input.upstreamModel) ? input.upstreamModel : sent;
  const replays = replaysThinking(replayModel);
  let text = input.body.toString("utf8");
  if (sent !== input.requestedModel) text = replaceModel(text, sent);
  if (anthropic) {
    text = fitClaudeCodeBody({ text, model: input.upstreamModel, sent, endpoint: input.endpoint });
  }
  const fixedEffort = fixedEffortOf(input);
  const isEffortFixed = fixedEffort !== undefined && conversation;
  if (isEffortFixed) text = withFixedEffort({ format: input.format, text, effort: fixedEffort });
  if (fits && anthropic) {
    text = fitAnthropicBody({ text, model: replayModel, isEffortFixed });
    text = fitThinkingOff({
      text,
      model: input.upstreamModel,
      leftOn: input.refusals?.has("thinkingOff") ?? false,
    });
  } else if (fits) {
    if (replays) text = fitResponsesBody(text, replayModel);
    else text = withoutBareReasoning(text);
    if (input.refusals?.has("none")) text = noneAsLow(text);
    if (!searchesWebItself(input.endpoint, "openai_responses")) text = withoutWebSearchText(text);
  }
  text = fitChatBody({ ...input, text, conversation, replays });
  // count_tokens 不带 refusals。
  const refusals = conversation ? input.refusals : undefined;
  if (refusals) text = withoutRefusedText({ text, format: input.format, refusals });
  if (conversation) text = withExtraBodyText({ text, input });
  text = withVendorText({ ...input, text });
  text = withTemplateText({ ...input, text, replaysReasoning: replays });
  return Buffer.from(withoutReasoningText({ text, input, conversation }));
}

/**
 * 用户的附加请求体（request-extras.ts）：只改补上或覆盖的顶层字段，其余字节原样。补进来的思考预算照样按模型改成 adaptive、
 * 这家这个模型不收的字段照样去掉（magpie forwardOnce 的 adaptiveThinking、withoutRefusedShapes）。
 */
function withExtraBodyText(args: { text: string; input: PassthroughBodyInput }): string {
  const { text, input } = args;
  const extraBody = input.endpoint.extraBody ?? {};
  const hasExtraBody = Object.keys(extraBody).length > 0;
  if (!hasExtraBody) return text;
  const body = parseJson(text);
  if (!isRecord(body)) return text;
  const session = input.sessionId ?? "";
  const added = withExtraBody({ body, extraBody, session });
  const isUnchanged = added === body;
  if (isUnchanged) return text;
  let fitted = added;
  if (input.format === "anthropic_messages") {
    fitted = adaptiveThinkingAsTaken(fitted, input.upstreamModel);
  }
  const out = withChangedKeys({ text, body, fitted });
  if (!input.refusals) return out;
  return withoutRefusedText({ text: out, format: input.format, refusals: input.refusals });
}

/** 模型设置里一档思考都不留的模型，固定的档位也不发（magpie Reasonless）。 */
function fixedEffortOf(input: PassthroughBodyInput): FixedEffort | undefined {
  return input.noThinking === true ? undefined : input.fixedEffort;
}

/** 一档思考都不留的模型的对话请求不带任何思考参数（no-thinking.ts）：只改变了的顶层字段，其余字节原样。 */
function withoutReasoningText(input: {
  text: string;
  input: PassthroughBodyInput;
  conversation: boolean;
}): string {
  const { text, conversation } = input;
  const { noThinking, format } = input.input;
  const stripsReasoning = noThinking === true && conversation;
  if (!stripsReasoning) return text;
  const body = parseJson(text);
  if (!isRecord(body)) return text;
  return withChangedKeys({ text, body, fitted: withoutAnyReasoning(format, body) });
}

/** 按模板的改写（template-rewrites.ts，Bedrock 与 Azure）：只改变了的顶层字段，其余字节原样。 */
function withTemplateText(input: {
  text: string;
  format: ApiEndpointRequestFormat;
  endpoint: Pick<StoredApiEndpoint, "templateId">;
  replaysReasoning: boolean;
}): string {
  const { templateId } = input.endpoint;
  if (templateId === undefined) return input.text;
  const body = parseJson(input.text);
  if (!isRecord(body)) return input.text;
  const fitted = withTemplatePassthroughRewrites({
    templateId,
    format: input.format,
    body,
    replaysReasoning: input.replaysReasoning,
  });
  return withChangedKeys({ text: input.text, body, fitted });
}

/** 不会搜的那家收不到 Codex 的 web_search（ADR 0009）：只改变了的顶层字段，其余字节原样。 */
function withoutWebSearchText(text: string): string {
  const body = parseJson(text);
  if (!isRecord(body)) return text;
  return withChangedKeys({ text, body, fitted: withoutResponsesWebSearch(body) });
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
  // 发给这家的名字（上游模型名）。
  sent: string;
  endpoint: AdvisorEndpoint;
}): string {
  const { text, model, sent } = input;
  const body = parseJson(text);
  if (!isRecord(body)) return text;
  let fitted = withAdvisorFitted({ body, model: sent, endpoint: input.endpoint });
  // 计费行与审查只给 Claude：原名或上游模型名是 Claude 都算（magpie keepsBillingLine）。
  const isClaude = isAnthropicModel(model) || isAnthropicModel(sent);
  if (!isClaude) fitted = withoutSafeguards(withoutBillingLine(fitted));
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

/**
 * 直通给 Chat 上游的对话请求：developer 消息改成 system（Pi 给推理模型发 developer，OpenAI 收，DeepSeek 等别家整个请求拒收；
 * system 人人都收）；要回放推理的模型（Mistral 除外），每个带工具调用、或跟在本轮工具结果后面的助手消息都要有 reasoning_content
 * （DeepSeek 否则整个请求拒收，magpie #1462、#1822）：取它在别的字段里发回的推理，没有就用 NO_REASONING。
 * 调用 id 里藏着的 Gemini 思考签名取下（发给 Gemini 的放回 extra_content，gemini-signatures.ts）；
 * 发给 Mistral 的，先前轮的推理改成它自己的 thinking 段（mistralThinking）。只改 messages。
 */
function fitChatBody(
  input: PassthroughBodyInput & {
    text: string;
    // count_tokens 之类不是对话的请求不改。
    conversation: boolean;
    replays: boolean;
  },
): string {
  if (input.format !== "openai_chat" || !input.conversation) return input.text;
  const mistral = isMistral(input);
  let text = withChatMessages({
    text: input.text,
    fit: (message, afterTool) =>
      chatMessageFitted({ message, afterTool, replays: input.replays && !mistral }),
  });
  if (input.signatures !== undefined) {
    const { baseUrl } = input;
    const gemini =
      geminiCompat({ baseUrl, model: input.upstreamModel }) ||
      geminiCompat({ baseUrl, model: input.requestedModel });
    text = chatCallSignatures({ text, gemini, store: input.signatures });
  }
  if (mistral) text = withChatMessages({ text, fit: mistralThinking });
  return text;
}

/** Mistral 自己的接口（magpie 的 preset mistral 或 api.mistral.ai）。 */
function isMistral(input: { endpoint: Pick<StoredApiEndpoint, "templateId">; baseUrl: string }) {
  return input.endpoint.templateId === "mistral" || hostOf(input.baseUrl) === "api.mistral.ai";
}

/** 逐条改 Chat 请求的 messages：fit 返回 null 的原样；一条都没改时请求原样。afterTool：前面是本轮的工具结果。 */
function withChatMessages(input: {
  text: string;
  fit: (message: Record<string, unknown>, afterTool: boolean) => Record<string, unknown> | null;
}): string {
  const { text } = input;
  const body = parseJson(text);
  if (!isRecord(body) || !Array.isArray(body.messages)) return text;
  let afterTool = false;
  let changed = false;
  const messages: unknown[] = [];
  for (const message of body.messages) {
    if (isRecord(message) && message.role === "tool") afterTool = true;
    if (isRecord(message) && message.role === "user") afterTool = false;
    const fitted = isRecord(message) ? input.fit(message, afterTool) : null;
    if (fitted !== null) changed = true;
    messages.push(fitted ?? message);
  }
  if (!changed) return text;
  return applyEdits(text, modify(text, ["messages"], messages, {}));
}

// Chat 客户端发回先前轮推理的几个字段（magpie messageReasoning）。
const MESSAGE_REASONING = ["reasoning_content", "reasoning", "reasoning_details"];

/**
 * 发给 Mistral：先前轮的推理（在 reasoning_content、reasoning 或 reasoning_details 里）改成 Mistral 自己回复时用的
 * thinking 段，放在这一轮内容前面；那几个字段 Mistral 以 422 extra_forbidden 拒收（magpie #494）。不是助手的消息只去掉字段。
 */
function mistralThinking(message: Record<string, unknown>): Record<string, unknown> | null {
  if (!MESSAGE_REASONING.some((field) => field in message)) return null;
  const think = reasoningText(message);
  const out: Record<string, unknown> = Object.assign({}, message);
  for (const field of MESSAGE_REASONING) delete out[field];
  if (think === "" || message.role !== "assistant") return out;
  const parts: unknown[] = [{ type: "thinking", thinking: [{ type: "text", text: think }] }];
  if (Array.isArray(message.content)) parts.push(...message.content);
  else if (typeof message.content === "string" && message.content !== "") {
    parts.push({ type: "text", text: message.content });
  }
  out.content = parts;
  return out;
}

/** 一条要改的消息改好的样子；不用改为 null。afterTool：前面是本轮的工具结果。 */
function chatMessageFitted(input: {
  message: Record<string, unknown>;
  afterTool: boolean;
  replays: boolean;
}): Record<string, unknown> | null {
  const { message } = input;
  if (message.role === "developer") return Object.assign({}, message, { role: "system" });
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const isToolTurn = message.role === "assistant" && (calls.length > 0 || input.afterTool);
  const hasOwn = typeof message.reasoning_content === "string";
  if (!input.replays || !isToolTurn || hasOwn) return null;
  const think = reasoningText(message);
  return Object.assign({}, message, { reasoning_content: think === "" ? NO_REASONING : think });
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
export function fitAnthropicBody(input: {
  text: string;
  model: string;
  // 「模型名:档位」固定了档位：照 magpie 留着自适应思考与 output_config.effort。
  isEffortFixed?: boolean;
}): string {
  const { text, model } = input;
  if (isAnthropicModel(model)) return text;
  const body = parseJson(text);
  if (!isRecord(body)) return text;
  let out = text;
  const edit = (path: (string | number)[], value: unknown) => {
    out = applyEdits(out, modify(out, path, value, {}));
  };
  if (input.isEffortFixed !== true) {
    const thinking = isRecord(body.thinking) ? body.thinking : null;
    if (body.thinking === undefined) edit(["thinking"], { type: "disabled" });
    else if (thinking?.type === "adaptive") edit(["thinking"], undefined);
    const config = isRecord(body.output_config) ? body.output_config : null;
    if (config && config.effort !== undefined) {
      const rest = Object.keys(config).filter((key) => key !== "effort");
      edit(rest.length === 0 ? ["output_config"] : ["output_config", "effort"], undefined);
    }
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
  apiKey: string | null;
  keys: KeyHeaders;
  extras: RequestExtras;
  // 发给 Anthropic 地址上的非 Claude 模型：anthropic-beta 去掉自动模式审查的 beta。
  dropsReviewBeta: boolean;
  // 发给从 Bedrock 模板加的接口：anthropic-beta 照 Bedrock 的叫法改。
  forBedrock: boolean;
  userAgent: string;
}): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    if (value !== undefined && !DROPPED_REQUEST_HEADERS.has(name)) out[name] = value;
  }
  const betas = out["anthropic-beta"];
  if (betas !== undefined) {
    const kept = fittedBetas({
      value: betas,
      dropsReviewBeta: input.dropsReviewBeta,
      forBedrock: input.forBedrock,
    });
    if (kept === null) delete out["anthropic-beta"];
    else out["anthropic-beta"] = kept;
  }
  // 要上游不压缩：错误体要读出原文，回复原样转给 Agent。
  out["accept-encoding"] = "identity";
  out["user-agent"] = input.userAgent;
  return signedHeaders({ ...input, headers: out });
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

/** 把一次失败的尝试按 Agent 协议交给它：状态码照抄，文字是「<接口名>: <上游原文>」再接上 `suffix`；返回这句文字。 */
export function sendFailedAttempt(input: {
  res: Response;
  wire: AgentWire;
  endpoint: StoredApiEndpoint;
  failed: FailedAttempt;
  suffix: string;
  headers: Record<string, string>;
}): string {
  const { failed } = input;
  const message = `${input.endpoint.name}: ${failed.detail}${input.suffix}`;
  sendAgentError({
    res: input.res,
    wire: input.wire,
    error: { status: failed.status, message, ...failed.upstreamError },
    headers: {
      ...retryHeaders(failed.headers),
      ...input.headers,
      [ANSWERED_BY_HEADER]: input.endpoint.slug,
    },
  });
  return message;
}
