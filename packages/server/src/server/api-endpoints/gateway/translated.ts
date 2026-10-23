// 被拒后打开推理重问移植自 magpie（https://github.com/yetone/magpie，internal/gateway/gateway.go 的 forwardTranslated、forward 里的 RetryOneAuth，以及 forwardTranslated 里去掉拒收字段与画图工具的重问；回复里写成文字的调用、JSON 外的代码块与 Grok 参数里的整数接在 forwardTranslated 的 written、encoder 与 render 处；MiniMax 的思考照 chat.go buildChat 的 inlineThink；开口后的拒答不冷却照 fallback.go 的 refusedAfter；开口后断流不补结尾、在流尾补错误照 continuation.go 的 errEndedShort 与 cutMidReply；断流后接着写照 continuation.go 的 streamTranslated 与 continuation.again）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingMessage } from "node:http";
import { StringDecoder } from "node:string_decoder";
import type { Response } from "express";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { upstreamModelName } from "@getpaseo/protocol/api-endpoint/model-settings";
import type { EndpointModelFacts } from "../model-facts.js";
import type { StoredApiEndpoint } from "../store.js";
import { ANTHROPIC_VERSION, parseJson, type Secrets } from "../upstream-http.js";
import {
  secretsOf,
  storedRequestExtras,
  unsendableHeader,
  unsendableHeaderMessage,
  withExtraBody,
  type RequestExtras,
} from "../request-extras.js";
import { adaptiveThinkingAsTaken } from "./translation/anthropic.js";
import { sendAgentError, sendRefusal, type AgentError, type AgentWire } from "./agent-errors.js";
import {
  ENDED_SHORT,
  ReplyEndingWatch,
  brokenMessage,
  passingMessage,
  type ReplyEnding,
  connectionLost,
  endedShort,
} from "./broken-reply.js";
import {
  ReplySoFar,
  STREAM_RETRIES,
  continuationUrl,
  lastThinking,
  prefillMode,
  withPrefillMark,
  type PrefillMode,
} from "./continuation.js";
import { doubledPause } from "./cooldown.js";
import type { AgentKeepAlive } from "./keepalive.js";
import {
  askRefitted,
  askWithOneKeyHeader,
  askWithoutField,
  keyHeadersFor,
  noteRefusal,
  signedHeaders,
  refusesPrefill,
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
  type FieldRefused,
} from "./refused-fields.js";
import {
  ReplyCollector,
  openAIEffort,
  passingFilter,
  requestForModel,
  reasoningOff,
  replaysThinking,
  thinkingBackOn,
  type EmitEvent,
  type GatewayRequest,
  type ReplyFilter,
  type StreamEvent,
} from "./translation/ir.js";
import { isGrokReply, wholeArgsFilter } from "./grok-integral.js";
import { fenceFilter, unfencedReply } from "./translation/fence.js";
import { protocolOf, type StreamDecoder } from "./translation/protocols.js";
import { SseReader } from "./translation/sse.js";
import { textCallFilter } from "./translation/text-calls.js";
import { withSearchSourcesFor, withThinkingInline, withVendorRewrites } from "./vendor-rewrites.js";
import { withoutThinkingAsk } from "./no-thinking.js";
import { withTemplateTranslatedRewrites } from "./template-rewrites.js";
import { servedFormats } from "../templates.js";
import { refusedAfterOpening } from "./safety-filter.js";
import { isWholeReply } from "./whole-stream.js";
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
  type UpstreamOpening,
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
 * 开口后上游断了（连接中断，或流读完了却没说完）不替上游补结尾（broken-reply.ts）：要流式的先在同一家接着写
 * （continuation.ts），接不上或续满了再在流尾补错误事件；不要的回 502。
 */

type StreamEnd = { kind: "ended" } | { kind: "broken"; message: string } | { kind: "gone" };

export async function attemptTranslated(input: {
  res: Response;
  wire: AgentWire;
  endpoint: StoredApiEndpoint;
  baseUrl: string;
  apiKey: string | null;
  // Agent 说的格式与这次发给上游的格式。
  from: ApiEndpointRequestFormat;
  to: ApiEndpointRequestFormat;
  request: GatewayRequest;
  requestedModel: string;
  upstreamModel: string;
  // 这家这个模型的资料（ModelFactsLookup）。
  facts: EndpointModelFacts;
  headerTimeoutMs: number;
  // CLI 自己的 User-Agent，它没带时是 Osuna/<版本>。
  userAgent: string;
  // 照原样带给上游的 CLI 身份头（Codex 发往 Responses 或 Chat 时的 originator、x-codex-* 等）；没有为空。
  clientIdentity: Record<string, string>;
  // 这家的这个模型不收哪些不思考的写法。
  refusals: ShapeRefusals;
  keepAlive: AgentKeepAlive;
  // 断了的回复接着写之前等多久（第二次加倍）。
  retryPauseMs: number;
  // 附加请求体里 ${sessionId} 换成的对话标识（request-extras.ts 的 extraBodySession）。
  sessionId: string;
}): Promise<AttemptOutcome> {
  const { res, apiKey, to, refusals } = input;
  const url = upstreamUrl({ baseUrl: input.baseUrl, format: to });
  const extras = storedRequestExtras(input.endpoint);
  const secrets = secretsOf({ apiKey, extras });
  // 这家的请求头发不出去：这一个请求当作连不上，照常换家。
  const unsendable = unsendableHeader(extras);
  if (unsendable !== null) {
    return failedBySelf({ status: 502, detail: unsendableHeaderMessage(unsendable) });
  }
  const sends = () =>
    keyHeadersFor({
      format: to,
      templateId: input.endpoint.templateId,
      baseUrl: input.baseUrl,
      extras,
      refusals,
    });
  const openAt = (ask: { url: URL; body: string; keys: KeyHeaders }) =>
    openUpstream({
      res,
      url: ask.url,
      headers: translatedHeaders({
        apiKey,
        keys: ask.keys,
        extras,
        to,
        userAgent: input.userAgent,
        clientIdentity: input.clientIdentity,
      }),
      body: Buffer.from(ask.body),
      secrets,
      uncheckedHosts: extras.uncheckedHosts,
      headerTimeoutMs: input.headerTimeoutMs,
      reads: to,
      onHeard: () => input.keepAlive.heard(),
    });
  const open = (body: string, keys: KeyHeaders = sends()) => openAt({ url, body, keys });
  const bodyOf = (ask: {
    request: GatewayRequest;
    continuation: PrefillMode | null;
    refusals: ShapeRefusals;
  }) =>
    translatedBody({
      ...ask,
      baseUrl: input.baseUrl,
      templateId: input.endpoint.templateId,
      chatOnly: servesOnChatAlone({ endpoint: input.endpoint, model: input.upstreamModel }),
      from: input.from,
      to,
      model: input.upstreamModel,
      sentModel: upstreamModelName({
        settings: input.endpoint.modelSettings,
        modelId: input.upstreamModel,
      }),
      facts: input.facts,
      extraBody: extras.extraBody,
      session: input.sessionId,
    });
  const build = (asked: ShapeRefusals = refusals) =>
    bodyOf({ request: input.request, continuation: null, refusals: asked });
  const goOn = continuer({
    ...input,
    ask: async ({ soFar, mode }) => {
      const request = soFar.resume(input.request);
      const sent = bodyOf({ request, continuation: mode, refusals });
      const resumeUrl = continuationUrl({ baseUrl: input.baseUrl, to, mode });
      const opening = await openAt({ url: resumeUrl, body: sent, keys: sends() });
      return resumedFrom({ opening, sent, url: resumeUrl, secrets, to, refusals });
    },
  });
  const body = build();
  const keys = sends();
  let opened = await open(body, keys);
  // 没 key 时没带认证头，401 与「两个头不能同时带」无关。
  if (opened.kind === "failed" && apiKey !== null) {
    opened = await askWithOneKeyHeader({
      refusals,
      sent: keys,
      extras,
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
  return answerUnlessRefused({
    opened,
    format: to,
    answer: (ready) => answerOpened({ ...input, url, secrets, opened: ready, goOn }),
  });
}

/** 开了口的回复解码后按 Agent 的协议交给它：要流式就边收边发，不要就渲染成整份回复。 */
async function answerOpened(input: TranslatedAnswer): Promise<AttemptOutcome> {
  const reply = await upstreamReplyOf(input);
  if (reply.kind === "failed") return reply;
  input.keepAlive.stop();
  const finished = input.request.stream
    ? streamReply({ ...input, reply })
    : wholeReply({ ...input, reply });
  return { kind: "answered", finished };
}

/** 交出一份翻译后的回复要的：Agent 的协议与请求、这家、上游的格式与开了口的回复。 */
interface TranslatedAnswer {
  res: Response;
  wire: AgentWire;
  endpoint: StoredApiEndpoint;
  secrets: Secrets;
  from: ApiEndpointRequestFormat;
  to: ApiEndpointRequestFormat;
  request: GatewayRequest;
  requestedModel: string;
  upstreamModel: string;
  keepAlive: AgentKeepAlive;
  url: URL;
  opened: OpenedUpstream;
  goOn: GoOn;
}

/**
 * 开了口的回复怎么读：事件流照常；上游没理会 stream: true 的，整份回复照它流出来时的事件读；
 * 不是这个协议的回复，当作开口前失败。
 */
async function upstreamReplyOf(input: {
  opened: OpenedUpstream;
  to: ApiEndpointRequestFormat;
  url: URL;
  secrets: Secrets;
}): Promise<UpstreamReply | FailedAttempt> {
  const { response, held } = input.opened;
  if (isEventStream(response, held)) return { kind: "stream", response, held };
  const text = await readLimited({ stream: response, first: held });
  const whole = parseJson(text);
  if (!isWholeReply(input.to, whole))
    return notAStream({ url: input.url, text, secrets: input.secrets });
  return { kind: "whole", body: whole };
}

/**
 * 接着写问到了什么：接着读的回复；接不上（以引起断流的原因收尾）；接着写的那一问失败（以它自己的话收尾）；Agent 走了。
 */
type Resumed =
  | { kind: "reply"; reply: UpstreamReply }
  | { kind: "stopped" }
  | { kind: "failed"; failure: FailedAttempt }
  | { kind: "gone" };

/** 接着问一次的结果；retryable 是还能再续一次的失败（5xx、连不上之类）。 */
type AskedToGoOn = Resumed | { kind: "retryable"; failure: FailedAttempt };

/** 按 Agent 已经收到的部分接着写：每份回复最多问 STREAM_RETRIES 次。 */
type GoOn = (soFar: ReplySoFar) => Promise<Resumed>;

/** 接着问一次要的：Agent 已经收到的部分与这家怎么接。 */
interface GoOnAsk {
  soFar: ReplySoFar;
  mode: PrefillMode;
}

/**
 * 断了的回复怎么接着写（magpie 的 continuation.again）：这家这个模型能从一半接着写（prefillMode）、
 * Agent 已经收到了点什么、没开始工具调用、也不是拒答时，等一会儿在同一家接着问；问不开口的再问，
 * 同一个请求再问也会被拒的不再问。等着的时候照开口前那样给 Agent 保活（magpie 的 enc.keepalive）。
 */
function continuer(input: {
  res: Response;
  to: ApiEndpointRequestFormat;
  baseUrl: string;
  upstreamModel: string;
  refusals: ShapeRefusals;
  retryPauseMs: number;
  keepAlive: AgentKeepAlive;
  ask: (ask: GoOnAsk) => Promise<AskedToGoOn>;
}): GoOn {
  const { res, keepAlive } = input;
  let asked = 0;
  const askUntilSettled = async (soFar: ReplySoFar): Promise<Resumed> => {
    let settled: Resumed = { kind: "stopped" };
    while (asked < STREAM_RETRIES) {
      const mode = prefillMode({ ...input, model: input.upstreamModel });
      const canGoOn = mode !== null && soFar.canGoOn();
      if (!canGoOn) return settled;
      const waitMs = doubledPause({ retryPauseMs: input.retryPauseMs, again: asked });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      if (res.destroyed) return { kind: "gone" };
      asked++;
      const resumed = await input.ask({ soFar, mode });
      if (resumed.kind !== "retryable") return resumed;
      settled = { kind: "failed", failure: resumed.failure };
    }
    return settled;
  };
  return async (soFar) => {
    keepAlive.restart();
    try {
      return await askUntilSettled(soFar);
    } finally {
      keepAlive.stop();
    }
  };
}

/**
 * 接着写的那一问开了口没有：开了口就接着读；被拒时先记下认得出的拒收。拒了预填的以引起断流的原因收尾、以后不再续
 * （Agent 没要过预填）；同一个请求再问也会被拒的（400、404、422、拒答）以它自己的话收尾；别的失败还能再续一次。
 */
async function resumedFrom(input: {
  opening: UpstreamOpening;
  sent: string;
  url: URL;
  secrets: Secrets;
  to: ApiEndpointRequestFormat;
  refusals: ShapeRefusals;
}): Promise<AskedToGoOn> {
  const { opening, to, refusals } = input;
  if (opening.kind === "gone") return opening;
  if (opening.kind === "failed") {
    const body = parseJson(input.sent);
    noteRefusal({ refusals, format: to, body, failed: opening });
    if (refusesPrefill(refusals)) return { kind: "stopped" };
    if (turnsAwayAgain(opening)) return { kind: "failed", failure: opening };
    return { kind: "retryable", failure: opening };
  }
  const reply = await upstreamReplyOf({ ...input, opened: opening });
  if (reply.kind === "failed") return { kind: "retryable", failure: reply };
  return { kind: "reply", reply };
}

// 同一个请求再问也一样被拒的状态码（magpie 的 continuation.again）。
const TURNED_AWAY_STATUSES = new Set([400, 404, 422]);

function turnsAwayAgain(failed: FailedAttempt): boolean {
  return failed.cause === "refused" || TURNED_AWAY_STATUSES.has(failed.status);
}

/** 上游的回复怎么读：事件流从开口时扣下的字节读起；没理会 stream: true 的，是已经读完的整份回复。 */
type UpstreamReply =
  | { kind: "stream"; response: IncomingMessage; held: Buffer }
  | { kind: "whole"; body: unknown };

function translatedHeaders(input: {
  apiKey: string | null;
  keys: KeyHeaders;
  extras: RequestExtras;
  to: ApiEndpointRequestFormat;
  userAgent: string;
  clientIdentity: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = {
    ...input.clientIdentity,
    "content-type": "application/json",
    "user-agent": input.userAgent,
    accept: "text/event-stream",
    // 要上游不压缩：错误体要读出原文。
    "accept-encoding": "identity",
  };
  if (input.to === "anthropic_messages") headers["anthropic-version"] = ANTHROPIC_VERSION;
  return signedHeaders({ ...input, headers });
}

/** 翻译后发给上游的请求体要的：Agent 的请求、这家的地址、两种格式、上游模型名与资料、这家这个模型不收的写法。 */
export interface TranslatedBodyInput {
  request: GatewayRequest;
  baseUrl: string;
  // 这家从哪个模板加的：Bedrock、Azure 按模板改（template-rewrites.ts）；「自定义」的没有。
  templateId: string | undefined;
  // 这家只在 Chat 上给这个模型：Chat 带工具不收推理力度时，没有别的格式可去，关掉推理重问（magpie servesElsewhere）。
  chatOnly: boolean;
  from: ApiEndpointRequestFormat;
  to: ApiEndpointRequestFormat;
  model: string;
  // 请求体里的模型名（上游模型名）；没设上游模型名时同 model。
  sentModel: string;
  facts: EndpointModelFacts;
  refusals: ShapeRefusals;
  // 断了的回复接着写时这家怎么接（request 的最后一条是 Agent 已经收到的部分）；平常的请求为 null。
  continuation: PrefillMode | null;
  // 这家的附加请求体与 ${sessionId} 换成的对话标识（request-extras.ts）；没有为不加。
  extraBody?: Record<string, unknown>;
  session?: string;
}

/**
 * 发给上游的请求体（JSON）：按这家这个模型不收的写法改过请求，翻好后再去掉它不收的字段，
 * 最后按厂商改（vendor-rewrites.ts；MiniMax 的思考在翻成 Chat 之前写回 <think>）。
 */
export function translatedBody(input: TranslatedBodyInput): string {
  const { to, refusals, baseUrl, continuation } = input;
  let request = allowedReasoning({
    request: input.request,
    to,
    refusals,
    chatOnly: input.chatOnly,
  });
  if (refusals.has("imageTool")) request = withoutImageToolRequest(request);
  request = downgradedRequest({
    request,
    to,
    refused: (shape) => refusals.has(shape),
    // Chat、Responses 的 Agent 把末尾的 assistant 消息当作说完的一轮；Anthropic 的是它自己要的预填。
    // 接着写的请求末尾是中转站自己的预填，不补 user 轮。
    lastIsTurn: input.from !== "anthropic_messages" && continuation === null,
  });
  request = requestForModel({ request, to, facts: input.facts });
  // 模型设置里一档思考都不留：编出的请求不带任何思考参数（no-thinking.ts）。
  if (input.facts.noThinking === true) request = withoutThinkingAsk(request);
  if (to === "openai_chat") request = withThinkingInline({ baseUrl, request });
  // 要回放推理的模型按原名或上游模型名认出一个就算（magpie）；请求体里的模型名总是上游模型名。
  const replayModel = replaysThinking(input.model) ? input.model : input.sentModel;
  const built = protocolOf(to).build({ ...request, stream: true }, replayModel);
  built.model = input.sentModel;
  let body = withoutRefusedFields({
    format: to,
    body: built,
    refused: (field) => refusals.has(field),
  });
  if (continuation !== null) {
    body = withPrefillMark({ body, mode: continuation, thinking: lastThinking(request.messages) });
  }
  if (to === "openai_responses") {
    body = withSearchSourcesFor({ baseUrl, body, asked: request.include });
  }
  body = withExtraFields({ ...input, body });
  body = withVendorRewrites({ format: to, baseUrl, model: input.model, body });
  return JSON.stringify(
    withTemplateTranslatedRewrites({ templateId: input.templateId, format: to, body }),
  );
}

/**
 * 补上用户的附加请求体（照 magpie forwardOnce）：Anthropic 上补进来的思考预算按模型改成 adaptive；
 * 这家这个模型不收的字段，补进来的也去掉（每种格式都去，和直通一样；不然被拒的字段每次重问都又补回来）。
 */
function withExtraFields(input: {
  body: Record<string, unknown>;
  to: ApiEndpointRequestFormat;
  model: string;
  refusals: ShapeRefusals;
  extraBody?: Record<string, unknown>;
  session?: string;
}): Record<string, unknown> {
  const { body, to, refusals } = input;
  const extraBody = input.extraBody ?? {};
  const session = input.session ?? "";
  const added = withExtraBody({ body, extraBody, session });
  const isUnchanged = added === body;
  if (isUnchanged) return added;
  let fitted = added;
  if (to === "anthropic_messages") fitted = adaptiveThinkingAsTaken(added, input.model);
  const refused: FieldRefused = (field) => refusals.has(field);
  return withoutRefusedFields({ format: to, body: fitted, refused });
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

/**
 * 关推理的请求：这家说过不收这种写法（Anthropic 关思考、OpenAI 的 none）的，打开推理、用最低档问。
 * 只在 Chat 上给这个模型的、说过带工具不收推理力度的，关掉推理问（magpie #176）；它也说过不收 none 的不关。
 */
function allowedReasoning(input: {
  request: GatewayRequest;
  to: ApiEndpointRequestFormat;
  refusals: ShapeRefusals;
  chatOnly: boolean;
}): GatewayRequest {
  const { request, to, refusals } = input;
  const anthropic = to === "anthropic_messages";
  const off = anthropic ? request.thinkOff : openAIEffort(request) === "none";
  const shape: RefusedShape = anthropic ? "thinkingOff" : "none";
  if (off && refusals.has(shape)) return thinkingBackOn(request);
  const turnsOff =
    to === "openai_chat" &&
    input.chatOnly &&
    !off &&
    refusals.has("toolsEffort") &&
    !refusals.has("none");
  return turnsOff ? reasoningOff(request) : request;
}

/** 这家有地址给这个模型的格式只有 Chat。 */
function servesOnChatAlone(input: { endpoint: StoredApiEndpoint; model: string }): boolean {
  const { endpoint, model } = input;
  const formats = servedFormats({
    templateId: endpoint.templateId,
    baseUrls: endpoint.baseUrls,
    model,
  });
  return formats.every((format) => format === "openai_chat");
}

/**
 * Agent 要流式：解码一个事件就编码一个事件写给它。上游断流时先接着写（goOn），接上的回复接着往下写；
 * 接不上就在流尾补错误事件，不补结尾。
 */
async function streamReply(input: {
  res: Response;
  wire: AgentWire;
  endpoint: StoredApiEndpoint;
  from: ApiEndpointRequestFormat;
  to: ApiEndpointRequestFormat;
  request: GatewayRequest;
  requestedModel: string;
  upstreamModel: string;
  reply: UpstreamReply;
  goOn: GoOn;
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
  const delivery = new DeliveryClock();
  const fence = fenceFilter({
    request: input.request,
    emit: (event) => {
      delivery.saw(event);
      encoder.event(event);
    },
  });
  const numbers = wholeNumbersFilter({
    requestedModel: input.requestedModel,
    upstreamModel: input.upstreamModel,
    endpoint: input.endpoint,
    emit: (event) => fence.event(event),
  });
  // 接着写时 Agent 收到的要连成一份回复：这之后的几道修补与编码器各次共用。
  const soFar = new ReplySoFar((event) => numbers.event(event));
  const flush = () => {
    numbers.end();
    fence.end();
  };
  let reply = input.reply;
  while (true) {
    const tried = await readTry({ ...input, reply, soFar });
    if (tried.kind === "gone") return tried;
    if (tried.kind === "ended") {
      flush();
      encoder.finish();
      res.end();
      const { stop } = tried.read.finish();
      const delivered: DeliveredReply = {
        id: encoder.replyId(),
        usage: encoder.usage(),
        stop,
        ...delivery.times(),
      };
      const refused = refusedAfterOpening({ stop, error: tried.read.error });
      if (refused) return { kind: "refused", reply: delivered };
      return { kind: "complete", usage: delivered.usage, reply: delivered };
    }
    const resumed = await input.goOn(soFar);
    if (resumed.kind === "gone") return resumed;
    if (resumed.kind === "reply") {
      reply = resumed.reply;
      continue;
    }
    // 写成文字的调用还扣着的，照原文交出（接着写时它们不算 Agent 已经收到的，由新的一次重说）。
    tried.release();
    flush();
    // 编码器写的都是完整的事件：空一行，错误连同它前面收尾的块（编码器自己补的）都在这之后。
    res.write("\n");
    const told = toldBroken({ endpointName: input.endpoint.name, reason: tried.reason, resumed });
    encoder.event({ kind: "error", message: told.message, code: null, vendorError: null });
    res.end();
    return { kind: "broken", message: told.reason };
  }
}

/** 流尾交给 Agent 的错误：话与原因。 */
interface ToldBroken {
  message: string;
  reason: string;
}

/** 接不上时以引起断流的原因收尾；接着写的那一问失败时以它自己的话收尾（magpie 的 failed）。 */
function toldBroken(input: { endpointName: string; reason: string; resumed: Resumed }): ToldBroken {
  const { endpointName, resumed } = input;
  if (resumed.kind !== "failed") {
    const { reason } = input;
    return { message: brokenMessage({ endpointName, reason }), reason };
  }
  const { detail, status } = resumed.failure;
  return { message: passingMessage({ endpointName, reason: detail, status }), reason: detail };
}

/** 读一次上游的回复读到哪：说完了（这一次解码出的回复）、断了（原因，与交出还扣着的文字）、Agent 走了。 */
type TryEnd =
  | { kind: "ended"; read: ReplyCollector }
  | { kind: "broken"; reason: string; release: () => void }
  | { kind: "gone" };

/** 读一次上游的回复交给 soFar：写成文字的调用每次重新认，断了时还扣着的不交出（由调用方决定）。 */
async function readTry(input: {
  res: Response;
  to: ApiEndpointRequestFormat;
  request: GatewayRequest;
  reply: UpstreamReply;
  soFar: ReplySoFar;
}): Promise<TryEnd> {
  const { soFar } = input;
  const decoder = protocolOf(input.to).decoder();
  const calls = textCallFilter({
    tools: input.request.tools,
    emit: (event) => soFar.event(event),
  });
  // 只为认出开口后的拒答：解码出的事件另攒一份。
  const read = new ReplyCollector();
  const ending = new ReplyEndingWatch();
  const emit = (event: StreamEvent) => {
    read.add(event);
    ending.add(event);
    calls.event(event);
  };
  const end = await decodeReply({ res: input.res, reply: input.reply, decoder, emit });
  if (end.kind === "gone") return end;
  const broken = brokenReason({ end, format: input.to, ending });
  if (broken !== null) return { kind: "broken", reason: broken, release: () => calls.end() };
  calls.end();
  return { kind: "ended", read };
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
  upstreamModel: string;
  reply: UpstreamReply;
}): Promise<AnswerEnd> {
  const { res, endpoint } = input;
  const collector = new ReplyCollector();
  const decoder = protocolOf(input.to).decoder();
  const numbers = wholeNumbersFilter({
    requestedModel: input.requestedModel,
    upstreamModel: input.upstreamModel,
    endpoint: input.endpoint,
    emit: (event) => collector.add(event),
  });
  const calls = textCallFilter({
    tools: input.request.tools,
    emit: (event) => numbers.event(event),
  });
  const ending = new ReplyEndingWatch();
  const emit = (event: StreamEvent) => {
    ending.add(event);
    calls.event(event);
  };
  const end = await decodeReply({ res, reply: input.reply, decoder, emit });
  if (end.kind === "gone") return end;
  calls.end();
  numbers.end();
  const broken = brokenReason({ end, format: input.to, ending });
  let failure: WholeFailure | null = null;
  if (broken !== null) failure = { message: broken, vendorError: null };
  else if (collector.error && !collector.saidAnything()) failure = collector.error;
  const headers = { [ANSWERED_BY_HEADER]: endpoint.slug };
  if (failure !== null) {
    // 只想了一下就以报错形式拒答：照拒答交给 Agent（400，不是它会重问的 5xx），不怪这家（magpie 的 refusedAfter）。
    const refusedAfterThinking =
      end.kind === "ended" && refusedAfterOpening({ stop: null, error: collector.error });
    if (refusedAfterThinking) {
      const message = `${endpoint.name}: ${failure.message}`;
      sendRefusal({ res, wire: input.wire, message, headers });
      return { kind: "refused", reply: null };
    }
    sendAgentError({
      res,
      wire: input.wire,
      error: wholeFailureError({ failure, endpointName: endpoint.name }),
      headers,
    });
    return { kind: "broken", message: failure.message };
  }
  const reply = unfencedReply({ reply: collector.finish(), request: input.request });
  const rendered = protocolOf(input.from).render(reply, {
    model: input.requestedModel,
    request: input.request,
  });
  res.status(200).set(headers).json(rendered);
  // 整份回复一次交出，不记首字（magpie 对不流式的回复也不记）。
  const delivered: DeliveredReply = {
    id: typeof rendered.id === "string" ? rendered.id : "",
    usage: reply.usage,
    stop: reply.stop,
    firstContentAt: null,
    firstTextAt: null,
  };
  const refused = refusedAfterOpening({ stop: reply.stop, error: collector.error });
  if (refused) return { kind: "refused", reply: delivered };
  return { kind: "complete", usage: reply.usage, reply: delivered };
}

/** 第一个内容（文字、思考、工具调用、联网搜索）与第一段文字交给编码器、写给 Agent 的时刻。 */
class DeliveryClock {
  private firstContentAt: number | null = null;
  private firstTextAt: number | null = null;

  saw(event: StreamEvent): void {
    const text = event.kind === "text" && event.text !== "";
    const content =
      text ||
      (event.kind === "think" && event.text !== "") ||
      event.kind === "tool_start" ||
      event.kind === "search";
    if (!content) return;
    const now = Date.now();
    this.firstContentAt ??= now;
    if (text) this.firstTextAt ??= now;
  }

  times(): Pick<DeliveredReply, "firstContentAt" | "firstTextAt"> {
    return { firstContentAt: this.firstContentAt, firstTextAt: this.firstTextAt };
  }
}

/** 开口后上游断了的原因：连接中断，或流读完了却没说完；说完了为 null。 */
function brokenReason(input: {
  end: Exclude<StreamEnd, { kind: "gone" }>;
  format: ApiEndpointRequestFormat;
  ending: ReplyEnding;
}): string | null {
  const { end } = input;
  if (end.kind === "broken") return end.message;
  return endedShort(input) ? ENDED_SHORT : null;
}

/** 整份回复交不出的原因：上游断流，或只想了一下就出错。 */
type WholeFailure = Pick<Extract<StreamEvent, { kind: "error" }>, "message" | "vendorError">;

/** 交给 Agent 的错误：502；厂商说请求本身有问题的是 400，带上它的 type、code、param（magpie 的 writeVendorError）。 */
function wholeFailureError(input: { failure: WholeFailure; endpointName: string }): AgentError {
  const { vendorError } = input.failure;
  const message = `${input.endpointName}: ${input.failure.message}`;
  if (vendorError === null) return { status: 502, message };
  return { status: 400, message, ...vendorError };
}

/** Grok 的回复：调用参数里的零小数去掉（grok-integral.ts）；别的模型的回复原样往下交。 */
function wholeNumbersFilter(input: {
  requestedModel: string;
  upstreamModel: string;
  endpoint: Pick<StoredApiEndpoint, "modelSettings">;
  emit: EmitEvent;
}): ReplyFilter {
  const sentModel = upstreamModelName({
    settings: input.endpoint.modelSettings,
    modelId: input.upstreamModel,
  });
  if (isGrokReply({ ...input, sentModel })) return wholeArgsFilter(input.emit);
  return passingFilter(input.emit);
}

/** 把上游的回复解码成中间事件，读到结束；流断了或 Agent 先走了，还扣着的不再交出。 */
async function decodeReply(input: {
  res: Response;
  reply: UpstreamReply;
  decoder: StreamDecoder;
  emit: EmitEvent;
}): Promise<StreamEnd> {
  const { reply, decoder, emit } = input;
  if (reply.kind === "whole") {
    decoder.whole(reply.body, emit);
    return { kind: "ended" };
  }
  const reader = new SseReader((data) => decoder.decode(data, emit));
  const end = await readStream({ ...reply, res: input.res, onText: (text) => reader.feed(text) });
  if (end.kind !== "ended") return end;
  reader.end();
  decoder.end?.(emit);
  return end;
}

/** 读上游的流直到结束（从开口时扣下的字节读起）；字符可能被切在两段之间，按 UTF-8 接好再交出去。 */
function readStream(input: {
  res: Response;
  response: IncomingMessage;
  held: Buffer;
  onText: (text: string) => void;
}): Promise<StreamEnd> {
  const { response, res } = input;
  const utf8 = new StringDecoder("utf8");
  input.onText(utf8.write(input.held));
  if (response.readableEnded) {
    input.onText(utf8.end());
    return Promise.resolve({ kind: "ended" });
  }
  // 开口之后、接着读之前上游就断了：close 已经发过，不会再来；没读到的也读不到了。
  if (response.destroyed) {
    const message = connectionLost({ error: undefined });
    return Promise.resolve({ kind: "broken", message });
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
      if (agentGone) {
        resolve({ kind: "gone" });
        return;
      }
      const message = connectionLost({ error });
      resolve({ kind: "broken", message });
    };
    response.once("error", broke);
    response.once("close", () => broke());
    response.resume();
  });
}
