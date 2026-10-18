// 候选排序与最后一家原地重试移植自 magpie（https://github.com/yetone/magpie，internal/gateway/fallback.go），换格式重问照 gateway.go 的 markUnfit 与 usable，
// 已下线模型的记下与恢复照 gateway.go 的 provider.Retire 与 routing.go 的 servedCandidate，对话太长时的跳过与换家照 gateway.go 对 roomy、tooLongUnsaid、withRoom 的调用，
// 拒答换家与全都拒答时交出的照 gateway.go 的 refusals、handBack 与 failTo(refusedStatus)，
// ChatGPT 后端路径按模型名分流（带斜杠的走接口、压缩拒绝、搜索回说明）照 codex_backend.go 的 codexBackend，「模型名:档位」照 gateway.go 的 askedAt，
// Codex 的 Subagent 改到强制模型、spawn_agent 补上清单照 codexBackend 与 handle 对 codexSubagentPick、spawnAgentModels 的调用
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import http, { type IncomingHttpHeaders } from "node:http";
import os from "node:os";
import type { Request, RequestHandler, Response } from "express";
import type pino from "pino";
import { applyEdits, modify } from "jsonc-parser";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { AGENT_REQUEST_FORMAT, isDefaultModelChoice, usableModels } from "../host-endpoints.js";
import {
  ApiEndpointStore,
  ApiEndpointsFileUnparsableError,
  type ApiEndpointProvider,
  type ApiEndpointState,
  type StoredApiEndpoint,
} from "../store.js";
import type { ModelFacts } from "../model-facts.js";
import type { RetiredModels } from "../retired-models.js";
import { isRecord, parseJson } from "../upstream-http.js";
import { sendAgentError, sendRefusal, type AgentWire } from "./agent-errors.js";
import { ConversationSticks, conversationId, turnOf } from "./affinity.js";
import { judgeCaller } from "./callers.js";
import { isClaudeSignIn, keepClaudeSignIn } from "./claude-signin.js";
import {
  DEFAULT_CHATGPT_BASE_URL,
  DEFAULT_OPENAI_API_BASE_URL,
  chatgptBackendRest,
  codexIdentityHeaders,
  noWebSearchReply,
  relayToChatGpt,
  relayedHeaders,
  type ChatGptBases,
} from "./chatgpt-backend.js";
import {
  CHATGPT_MODELS_WAIT_MS,
  answerChatGptModels,
  type ChatGptModelsListing,
} from "./chatgpt-models.js";
import { answerCodexCompaction, type CompactionAnswer } from "./codex-compaction-answer.js";
import { CompactionFailures } from "./codex-compaction-fallback.js";
import { codexCompactionInput, localCompactionTurn } from "./codex-compaction.js";
import {
  chatgptTurnDestination,
  shapeCodexApiRequest,
  shapeCodexChatGptRequest,
  type ShapedChatGptRequest,
} from "./codex-requests.js";
import { hasSealedAgentTask, sealedTaskMessage } from "./codex-subagents.js";
import { CodexLastTurn } from "./codex-side-calls.js";
import {
  COOLDOWN,
  EndpointCooldowns,
  heldClock,
  passing,
  quotaHeld,
  spentAfter,
  type EndpointRest,
} from "./cooldown.js";
import { endpointFailure, lateRests, modelRetired, retryable } from "./failure.js";
import { askedAt, fitFixedEffort, withFixedEffort, type FixedEffort } from "./fixed-effort.js";
import {
  largerWindows,
  overflowOf,
  roomyCandidates,
  type Overflow,
  type WindowOf,
} from "./overflow.js";
import { attemptEndpoint, sendFailedAttempt } from "./passthrough.js";
import { AgentKeepAlive, KEEPALIVE_EVERY_MS, KEEPALIVE_QUIET_MOST_MS } from "./keepalive.js";
import {
  RefusedShapes,
  formatShape,
  refusalNote,
  refusesFormat,
  type ShapeRefusals,
} from "./refusals.js";
import {
  chooseRequestFormat,
  resolveGatewayRoute,
  type GatewayCandidate,
  type GatewayRoute,
} from "./routing.js";
import { foldsRootsUpFront } from "./refused-fields.js";
import { attemptTranslated } from "./translated.js";
import { parseAnthropicRequest } from "./translation/anthropic.js";
import { RequestShapeError, estimateInputTokens, type GatewayRequest } from "./translation/ir.js";
import { protocolOf } from "./translation/protocols.js";
import { decodeAgentBody, readAgentBody, readRawBody } from "./request-body.js";
import { joinToolRuns, orphanedToolOutputs, pairToolItems } from "./translation/responses.js";
import {
  ANSWERED_BY_HEADER,
  type AttemptOutcome,
  type FailedAttempt,
  type HandBack,
} from "./upstream-call.js";
import {
  asksAnthropicWebSearch,
  asksWebSearch,
  formatsToSearchOn,
  searchesWebItself,
  withWebSearchFor,
} from "./web-search.js";
import { GATEWAY_INFO_NAME } from "../gateway-reach.js";

/*
 * 本机中转站：挂在 daemon 自己的 HTTP 监听上，替 CLI 把请求转给第三方接口。
 * Claude Code 的地址写到前缀为止，Codex 写到 `/v1`，两者落到同一组路径上。
 * 挂在 daemon 密码中间件与全局 JSON 解析之前：请求体自己读，不受 100 kb 上限。
 * 认调用方（callers.ts，ADR 0010）：本机回环来的、不带转发头的请求一律收，网页发来的拒收；
 * 口令只说明是哪个 Agent，对不上时按 User-Agent 认，再认不出按请求路径。
 * 用 ChatGPT 登录的 Codex 走 ChatGPT 后端那组路径（serveChatGptBackend）：光秃秃的模型名原样转给 ChatGPT，
 * 「接口标识/模型名」照下面的规则选路，发给接口的只有 Codex 的身份头，ChatGPT 令牌与账号 id 从不带。
 * 每次请求都重读接口与口令文件，接口页的改动立刻生效。
 *
 * 每家接口按 chooseRequestFormat 挑格式：有 Agent 自己格式的地址就直通，否则经中间格式翻译过去。
 *
 * 自动切换：用户选的那家在开口（回复里出现第一段内容）前失败（额度、欠费、限流、服务器错误、超时）时，
 * 按创建顺序换到下一家有同名模型的接口，失败的那家冷却；开口之后不再换家。冷却与「上次谁答的」只记在内存里。
 * 空回复先在同一家再问一次，还空就换下一家；空回复怪不到这家，不冷却（magpie #1221）。
 * 拒答（安全过滤不肯回答，safety-filter.ts）也怪不到这家：不冷却、不标「需要检查」，问遍剩下的同名候选。
 * 换家之前先看是不是拒收（不思考的写法、这个格式的地址没有这个模型、两个认证头不能同时带）：
 * 是就在同一家换写法重问（换格式时按格式顺序问下一个地址，要翻译就翻译），也只记在内存里。
 * 要流式的请求等开口时有保活（keepalive.ts）；保活发出响应头之后再失败，错误在流里交给 Agent。
 * 厂商说模型已下线时记下这家的这一项（retired-models.ts，落盘），一周内列表与只写模型名的选路都没有它；
 * 这家答成功一次就恢复。
 * 压缩过的请求体（zstd、gzip）先解开再处理（request-body.ts）；发给上游的 User-Agent 是 CLI 自己的，
 * CLI 没带时写 Osuna/<版本>。
 * 对话太长（overflow.ts）：已知窗口装不下的候选发出前就跳过；一家说太长（或不说原因、估算已超窗口 1.2 倍）时
 * 不冷却，后面有已知窗口更大的同名候选就换过去，没有就按超长告诉 CLI 去压缩。
 */

export const API_ENDPOINT_GATEWAY_PATH = "/api-endpoint-gateway";

// CLI 等上游响应头最长这么久；开口之后不限时，交给 CLI 自己的超时。
const DEFAULT_HEADER_TIMEOUT_MS = 10 * 60 * 1000;
// Claude Code 带图的长上下文也只有几 MB；再大多半是出了错。按解开后的大小算。
const MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024;

const COUNT_TOKENS_PATH = "/v1/messages/count_tokens";

export interface ApiEndpointGatewayOverrides {
  // 只给测试缩短等上游响应头的时间、最后一家原地重试前的等待、保活的间隔与上游毫无动静多久停止保活。
  gatewayHeaderTimeoutMs?: number;
  gatewayRetryPauseMs?: number;
  gatewayKeepAliveMs?: number;
  gatewayKeepAliveQuietMs?: number;
  // 只给测试缩小请求体上限（按解开后的大小），不必真造 64 MB。
  gatewayBodyLimitBytes?: number;
  // 只给测试把 ChatGPT 后端与 OpenAI API 换成本机的假后端，从不连真的 chatgpt.com。
  gatewayChatGptBaseUrl?: string;
  gatewayOpenAiApiBaseUrl?: string;
  // 只给测试缩短等 ChatGPT 模型清单的时间（缺省 3 秒）。
  gatewayChatGptModelsWaitMs?: number;
}

/** 一家接口的一个模型（按这家的写法）的资料：这家上游清单给的在前，models.dev 补上没给的。 */
export type ModelFactsLookup = (endpoint: StoredApiEndpoint, modelId: string) => ModelFacts;

/** 每种 Agent 自己说的请求格式，按请求路径认；口令与 User-Agent 都认不出是谁时，路径也说明是哪个 Agent。 */
const AGENT_PATHS = {
  "/v1/messages": { wire: "anthropic", format: "anthropic_messages", agent: "claude" },
  "/v1/responses": { wire: "openai", format: "openai_responses", agent: "codex" },
} as const;
type AgentPath = (typeof AGENT_PATHS)[keyof typeof AGENT_PATHS];

export function createApiEndpointGateway(options: {
  paseoHome: string;
  logger: pino.Logger;
  cooldowns: EndpointCooldowns;
  retired: RetiredModels;
  modelFacts: ModelFactsLookup;
  // daemon 自己的版本：CLI 没带 User-Agent 时写 Osuna/<版本>。
  daemonVersion: string;
  // 用 ChatGPT 登录的 Codex 的模型清单里接在后面的接口模型、它们的标记与 CODEX_HOME（ADR 0010）。
  codexChatGptListing: () => ChatGptModelsListing;
  overrides?: ApiEndpointGatewayOverrides;
}): RequestHandler {
  const logger = options.logger.child({ module: "api-endpoint-gateway" });
  const store = new ApiEndpointStore({ paseoHome: options.paseoHome, logger });
  const failover: Failover = {
    cooldowns: options.cooldowns,
    retired: options.retired,
    sticks: new ConversationSticks(),
    refusals: new RefusedShapes(),
    codexTurns: new CodexLastTurn(),
    compactionFailures: new CompactionFailures(),
    modelFacts: options.modelFacts,
    headerTimeoutMs: options.overrides?.gatewayHeaderTimeoutMs ?? DEFAULT_HEADER_TIMEOUT_MS,
    retryPauseMs: options.overrides?.gatewayRetryPauseMs ?? COOLDOWN.retryPause,
    keepAliveMs: options.overrides?.gatewayKeepAliveMs ?? KEEPALIVE_EVERY_MS,
    keepAliveQuietMs: options.overrides?.gatewayKeepAliveQuietMs ?? KEEPALIVE_QUIET_MOST_MS,
    bodyLimitBytes: options.overrides?.gatewayBodyLimitBytes ?? MAX_REQUEST_BODY_BYTES,
    ownUserAgent: `Osuna/${options.daemonVersion}`,
  };
  const chatgpt: ChatGptBackend = {
    bases: {
      chatgpt: options.overrides?.gatewayChatGptBaseUrl ?? DEFAULT_CHATGPT_BASE_URL,
      openAiApi: options.overrides?.gatewayOpenAiApiBaseUrl ?? DEFAULT_OPENAI_API_BASE_URL,
    },
    listing: options.codexChatGptListing,
    modelsWaitMs: options.overrides?.gatewayChatGptModelsWaitMs ?? CHATGPT_MODELS_WAIT_MS,
  };

  return (req, res) => {
    const wire = wireOf(req);
    const caller = judgeCaller({
      remoteAddress: req.socket.remoteAddress,
      headers: req.headers,
      tokens: store.readGatewayTokens(),
      machineName: os.hostname(),
      platform: process.platform,
    });
    if (caller.kind === "refused") {
      logger.warn({ method: req.method, path: req.path }, caller.message);
      sendAgentError({ res, wire, error: { status: caller.status, message: caller.message } });
      return;
    }

    // ChatGPT 后端那组路径只有 Codex 走（ADR 0010）：ChatGPT 自带模型原样转给 ChatGPT，接口模型照常选路。
    const chatgptRest = chatgptBackendRest(req.path);
    if (chatgptRest !== null) {
      const served = serveChatGptBackend({
        req,
        res,
        rest: chatgptRest,
        chatgpt,
        store,
        logger,
        failover,
      });
      void served.catch((error: unknown) => {
        logger.error({ err: error }, "API endpoint gateway request crashed");
        if (!res.headersSent) {
          sendAgentError({
            res,
            wire: "openai",
            error: { status: 500, message: "API endpoint gateway error" },
          });
        } else {
          res.destroy();
        }
      });
      return;
    }
    const isWarmUp = req.path === "/api/hello" && (req.method === "GET" || req.method === "HEAD");
    if (isWarmUp) {
      res.status(200).json({ ok: true });
      return;
    }
    // 自我介绍：代理后面的地址据此认出通到中转站（gateway-reach.ts，照 magpie 的根路径信息）。
    if (req.path === "/" && req.method === "GET") {
      res.status(200).json({ name: GATEWAY_INFO_NAME });
      return;
    }
    if (req.path === "/v1/models" && req.method === "GET") {
      const state = readState({ res, wire, store, logger });
      if (state) res.status(200).json(modelList(failover.retired.listed(state)));
      return;
    }
    const target = req.method === "POST" ? agentPath(req.path) : null;
    const counting = req.method === "POST" && req.path === COUNT_TOKENS_PATH;
    if (!target && !counting) {
      sendAgentError({
        res,
        wire,
        error: { status: 404, message: `${req.method} ${req.path} is not served by the gateway` },
      });
      return;
    }
    // count_tokens 只有 Claude Code 发。
    const agent = caller.agent ?? target?.agent ?? "claude";
    const handled = target
      ? handleAgentRequest({
          req,
          res,
          agent,
          wire: target.wire,
          format: target.format,
          store,
          logger,
          failover,
          source: { kind: "agent_path" },
        })
      : countTokens({ req, res, agent, store, logger, failover });
    void handled.catch((error: unknown) => {
      logger.error({ err: error }, "API endpoint gateway request crashed");
      if (!res.headersSent) {
        sendAgentError({
          res,
          wire,
          error: { status: 500, message: "API endpoint gateway error" },
        });
      } else {
        res.destroy();
      }
    });
  };
}

interface ChatGptBackend {
  bases: ChatGptBases;
  listing: () => ChatGptModelsListing;
  modelsWaitMs: number;
}

// 要先看模型名再决定转给 ChatGPT 还是接口的路径。
const CHATGPT_ROUTED_PATHS = new Set(["/responses", "/responses/compact", "/alpha/search"]);

/**
 * ChatGPT 后端那组路径（ADR 0010）：模型清单合并接口模型；对话、压缩与搜索先读出请求体看模型名，
 * 带接口标识的按接口处理（对话照常选路换家、只带 Codex 的身份头，压缩照 magpie 拒绝，搜索回 200 和说明），
 * 光秃秃的名字（或读不出模型名的）把原样的字节转给 ChatGPT。其余路径原样转。
 */
async function serveChatGptBackend(input: {
  req: Request;
  res: Response;
  rest: string;
  chatgpt: ChatGptBackend;
  store: ApiEndpointStore;
  logger: pino.Logger;
  failover: Failover;
}): Promise<void> {
  const { req, res, rest, chatgpt, logger } = input;
  if (req.method === "GET" && rest === "/models") {
    await answerChatGptModels({ req, res, ...chatgpt, waitMs: chatgpt.modelsWaitMs, logger });
    return;
  }
  const isRouted = req.method === "POST" && CHATGPT_ROUTED_PATHS.has(rest);
  if (!isRouted) {
    relayChatGpt({ ...input, sent: null });
    return;
  }
  const limit = input.failover.bodyLimitBytes;
  const raw = await readRawBody({ req, limit });
  if (raw.kind === "broken") return;
  if (raw.kind === "tooLarge") {
    sendAgentError({ res, wire: "openai", error: { status: 413, message: raw.message } });
    return;
  }
  const decoded = await decodeAgentBody({
    raw: raw.body,
    encoding: req.headers["content-encoding"],
    limit,
    logger,
  });
  if (decoded.kind !== "read") {
    relayChatGpt({ ...input, sent: { kind: "raw", body: raw.body } });
    return;
  }
  const sentText = decoded.body.toString("utf8");
  const sentModel = modelOf(sentText);
  if (sentModel === null) {
    relayChatGpt({ ...input, sent: chatgptBodyFor({ rest, raw: raw.body, text: sentText }) });
    return;
  }
  const shaped = shapeChatGptTurn({ ...input, text: sentText, model: sentModel });
  const { text, model } = shaped;
  if (shaped.goesTo === "chatgpt") {
    const isShaped = text !== sentText;
    relayChatGpt({ ...input, sent: chatgptBodyFor({ rest, raw: raw.body, text, isShaped }) });
    return;
  }
  if (rest === "/responses" && hasSealedAgentTask(parseJson(text))) {
    // ChatGPT 后端封存的任务只有 ChatGPT 自带模型打得开（magpie sealedReader）：交给接口它读不了，照 magpie 回 400 说明怎么办。
    const allowsAnySubagentModel = input.chatgpt.listing().marksAgentsV1;
    const message = sealedTaskMessage({ model, allowsAnySubagentModel });
    sendAgentError({ res: input.res, wire: "openai", error: { status: 400, message } });
    return;
  }
  await serveEndpointModel({ ...input, model, text });
}

/**
 * 对话（/responses）里 Codex 的 Subagent 改到强制 Subagent 模型、spawn_agent 补上能选的模型；压缩与搜索不改。
 * 去向原样按模型名：带接口标识的走接口，光秃秃的给 ChatGPT（改到强制模型时按它归谁）。
 */
function shapeChatGptTurn(input: {
  req: Request;
  rest: string;
  chatgpt: ChatGptBackend;
  store: ApiEndpointStore;
  logger: pino.Logger;
  failover: Failover;
  text: string;
  model: string;
}): ShapedChatGptRequest {
  const { text, model } = input;
  if (input.rest !== "/responses") return { text, model, goesTo: chatgptTurnDestination(model) };
  const state = stateForShaping(input);
  let listed: ApiEndpointState | null = null;
  if (state !== null) listed = input.failover.retired.listed(state);
  return shapeCodexChatGptRequest({
    headers: input.req.headers,
    text,
    model,
    state,
    listed,
    listing: input.chatgpt.listing(),
    logger: input.logger,
  });
}

/** endpoints.json 读不懂时为 null：Codex 自己的模型照常转给 ChatGPT，只是不改请求。 */
function stateForShaping(input: {
  store: ApiEndpointStore;
  logger: pino.Logger;
}): ApiEndpointState | null {
  try {
    return input.store.readState();
  } catch (error) {
    if (!(error instanceof ApiEndpointsFileUnparsableError)) throw error;
    input.logger.warn({ filePath: error.filePath }, "API endpoints file could not be parsed");
    return null;
  }
}

/** 请求体里的模型名；没有为 null。 */
function modelOf(text: string): string | null {
  const parsed = parseJson(text);
  if (isRecord(parsed) && typeof parsed.model === "string") return parsed.model;
  return null;
}

/** 转给 ChatGPT 的请求体：原样的字节；或读回了 Osuna 的压缩摘要、解开后改过的 JSON。 */
type ChatGptBody = { kind: "raw"; body: Buffer } | { kind: "rewritten"; body: Buffer } | null;

/**
 * ChatGPT 自带模型的对话里带着 Osuna 做的压缩条目时换成摘要消息（ChatGPT 读不懂它）；改过请求（isShaped：
 * Subagent 改到强制模型、spawn_agent 补了模型）时发改过的；别的原样。
 */
function chatgptBodyFor(input: {
  rest: string;
  raw: Buffer;
  text: string;
  isShaped?: boolean;
}): ChatGptBody {
  if (input.rest !== "/responses") return { kind: "raw", body: input.raw };
  const restored = codexCompactionInput({ text: input.text, isEndpointModel: false });
  if (restored.kind === "changed") return { kind: "rewritten", body: Buffer.from(restored.body) };
  if (input.isShaped === true) return { kind: "rewritten", body: Buffer.from(input.text) };
  return { kind: "raw", body: input.raw };
}

function relayChatGpt(input: {
  req: Request;
  res: Response;
  chatgpt: ChatGptBackend;
  logger: pino.Logger;
  sent: ChatGptBody;
}): void {
  const { req, chatgpt, logger, sent } = input;
  logger.debug({ agent: "codex", method: req.method, path: req.path }, "Relaying to ChatGPT");
  const headers = relayedHeaders(req.headers);
  if (sent?.kind === "rewritten") {
    // 发出去的是解开后改过的 JSON：不再说压缩，长度按新内容。
    delete headers["content-encoding"];
    headers["content-length"] = String(sent.body.length);
  }
  relayToChatGpt({
    req,
    res: input.res,
    bases: chatgpt.bases,
    logger,
    body: sent?.body,
    headers,
    listTag: () => chatgpt.listing().tag,
  });
}

/**
 * 接口模型（ADR 0010）：压缩照 magpie 拒绝 /responses/compact、在 /responses 里自己做摘要；搜索回 200 和说明；
 * 对话照常选路换家，只带 Codex 的身份头。
 */
async function serveEndpointModel(input: {
  req: Request;
  res: Response;
  rest: string;
  store: ApiEndpointStore;
  logger: pino.Logger;
  failover: Failover;
  model: string;
  text: string;
}): Promise<void> {
  const { req, res, rest, model } = input;
  if (rest === "/responses/compact") {
    const message = `/responses/compact is not supported for API endpoint models (${model}); use a compaction_trigger on /responses`;
    sendAgentError({ res, wire: "openai", error: { status: 400, message } });
    return;
  }
  if (rest === "/alpha/search") {
    res.status(200).json(noWebSearchReply(model));
    return;
  }
  const forwardedHeaders = codexIdentityHeaders(req.headers);
  const read = codexCompactionInput({ text: input.text, isEndpointModel: true });
  if (read.kind === "changed" && read.compacts) {
    const turn = localCompactionTurn(String(forwardedHeaders[TURN_METADATA_HEADER] ?? ""));
    if (turn !== null) forwardedHeaders[TURN_METADATA_HEADER] = turn;
    await answerCodexCompaction({
      res,
      model,
      body: read.body,
      ask: (asked) => askOwnGateway({ req, body: Buffer.from(asked), headers: forwardedHeaders }),
      failures: input.failover.compactionFailures,
      logger: input.logger,
    });
    return;
  }
  let body = Buffer.from(input.text);
  if (read.kind === "changed") body = Buffer.from(read.body);
  await handleAgentRequest({
    req,
    res,
    agent: "codex",
    wire: "openai",
    format: "openai_responses",
    store: input.store,
    logger: input.logger,
    failover: input.failover,
    source: { kind: "chatgpt_backend", body },
    forwardedHeaders,
  });
}

const TURN_METADATA_HEADER = "x-codex-turn-metadata";

/**
 * 摘要请求交给中转站自己的 /v1/responses（同一个本机端口），照常选路、换家、冷却，整份读回再改成压缩条目
 * （magpie 把它交给自己的 serve、记在 recorder 里）。只带 Codex 的身份头。
 */
function askOwnGateway(input: {
  req: Request;
  body: Buffer;
  headers: IncomingHttpHeaders;
}): Promise<CompactionAnswer> {
  const { localAddress, localPort } = input.req.socket;
  if (localAddress === undefined || localPort === undefined) {
    throw new Error("The gateway's own address is unknown");
  }
  let host = localAddress;
  if (host.includes(":")) host = `[${host}]`;
  const url = `http://${host}:${localPort}${API_ENDPOINT_GATEWAY_PATH}/v1/responses`;
  const headers = { ...input.headers, "content-length": String(input.body.length) };
  return new Promise((resolve, reject) => {
    const asked = http.request(url, { method: "POST", headers }, (reply) => {
      const chunks: Buffer[] = [];
      reply.on("data", (chunk: Buffer) => chunks.push(chunk));
      reply.once("error", reject);
      reply.once("end", () => {
        const answeredBy = reply.headers[ANSWERED_BY_HEADER.toLowerCase()];
        resolve({
          status: reply.statusCode ?? 502,
          contentType: reply.headers["content-type"],
          answeredBy: typeof answeredBy === "string" ? answeredBy : undefined,
          body: Buffer.concat(chunks),
        });
      });
    });
    asked.once("error", reject);
    asked.end(input.body);
  });
}

interface Failover {
  cooldowns: EndpointCooldowns;
  retired: RetiredModels;
  sticks: ConversationSticks;
  refusals: RefusedShapes;
  codexTurns: CodexLastTurn;
  // 接口模型压缩连续失败的对话（只记在内存里）。
  compactionFailures: CompactionFailures;
  modelFacts: ModelFactsLookup;
  headerTimeoutMs: number;
  retryPauseMs: number;
  keepAliveMs: number;
  keepAliveQuietMs: number;
  bodyLimitBytes: number;
  // CLI 没带 User-Agent 时发给上游的。
  ownUserAgent: string;
}

/** 读出 Agent 的请求体与模型名，按模型名找到候选；读不了或找不到时已按 Agent 协议回了错误，返回 null。 */
async function routeAgentRequest(input: {
  req: Request;
  res: Response;
  wire: AgentWire;
  agent: ApiEndpointProvider;
  store: ApiEndpointStore;
  logger: pino.Logger;
  failover: Failover;
  source: RequestSource;
}): Promise<RoutedRequest | null> {
  const { res, wire, source } = input;
  const reply = (status: number, message: string) =>
    sendAgentError({ res, wire, error: { status, message } });
  const read = await bodyFrom({ ...input, source });
  if (read.kind === "tooLarge") {
    reply(413, read.message);
    return null;
  }
  if (read.kind === "unreadable") {
    reply(read.status, read.message);
    return null;
  }
  const asked = parseJson(read.body.toString("utf8"));
  const askedModel = isRecord(asked) && typeof asked.model === "string" ? asked.model : null;
  if (askedModel === null) {
    reply(400, "The request has no model");
    return null;
  }
  const state = readState({ res, wire, store: input.store, logger: input.logger });
  if (!state) return null;
  const codexed = codexApiRequest({
    ...input,
    body: read.body,
    parsed: asked,
    model: askedModel,
    state,
  });
  const { body, parsed, model, fixedEffort } = withoutAskedEffort({ ...codexed, state });
  const route = routeModel({ ...input, state, model });
  if (!route.ok) {
    reply(404, route.message);
    return null;
  }
  if (input.wire === "anthropic" && asksAnthropicWebSearch(parsed)) {
    const searchers = webSearchCandidates(route.candidates);
    if (searchers.length === 0) {
      // 不剔掉工具照发：上游凭记忆写的文字会被 Claude Code 当成搜索结果。400 不会让它重试或要求重新登录。
      reply(400, noWebSearchMessage(model));
      return null;
    }
    return { body, parsed, model, fixedEffort, candidates: searchers };
  }
  return { body, parsed, model, fixedEffort, candidates: route.candidates };
}

/**
 * 请求体从哪来：Agent 自己的路径上从请求里读；ChatGPT 后端那组路径先读出、解开、看过模型名，
 * 并已按它自己的清单改过（Subagent 的强制模型、spawn_agent 的清单）。
 */
type RequestSource = { kind: "agent_path" } | { kind: "chatgpt_backend"; body: Buffer };

/** 从请求里读，或用 ChatGPT 后端那组路径已经读出的。 */
function bodyFrom(input: {
  req: Request;
  logger: pino.Logger;
  failover: Failover;
  source: RequestSource;
}): ReturnType<typeof readAgentBody> {
  const { source } = input;
  if (source.kind === "chatgpt_backend") {
    return Promise.resolve({ kind: "read", body: source.body });
  }
  return readAgentBody({
    req: input.req,
    limit: input.failover.bodyLimitBytes,
    logger: input.logger,
  });
}

/** 读出的请求体、解析后的内容与模型名。 */
interface ReadRequest {
  body: Buffer;
  parsed: unknown;
  model: string;
}

/**
 * Codex 经 /v1/responses 的请求（API key 接法）：Subagent 改到强制 Subagent 模型，spawn_agent 补上目录里的其余模型。
 * ChatGPT 后端那组路径来的已经在那边改过。
 */
function codexApiRequest(
  input: ReadRequest & {
    req: Request;
    agent: ApiEndpointProvider;
    source: RequestSource;
    logger: pino.Logger;
    failover: Failover;
    state: ApiEndpointState;
  },
): ReadRequest {
  const { body, parsed, model, state } = input;
  const isCodexApiTurn = input.agent === "codex" && input.source.kind === "agent_path";
  if (!isCodexApiTurn) return { body, parsed, model };
  const sentText = body.toString("utf8");
  const shaped = shapeCodexApiRequest({
    headers: input.req.headers,
    text: sentText,
    model,
    state,
    listed: input.failover.retired.listed(state),
    logger: input.logger,
  });
  if (shaped.text === sentText) return { body, parsed, model };
  return { body: Buffer.from(shaped.text), parsed: parseJson(shaped.text), model: shaped.model };
}

/** 读出的请求与找到的候选；fixedEffort 是「模型名:档位」固定的档位，没有为 null。 */
interface RoutedRequest extends AskedRequest {
  candidates: GatewayCandidate[];
}

/** 拆掉「模型名:档位」后的请求：模型名去掉后缀；固定的档位另记，发给每家时按它的模型落定。 */
interface AskedRequest {
  body: Buffer;
  parsed: unknown;
  model: string;
  fixedEffort: FixedEffort | null;
}

/** 照 magpie 的 askedAt：每家都按这个模型问；整个名字是哪家选了的模型时原样。count_tokens 只数这个模型。 */
function withoutAskedEffort(input: {
  body: Buffer;
  parsed: unknown;
  model: string;
  state: ApiEndpointState;
}): AskedRequest {
  const { state } = input;
  const split = askedAt({ id: input.model, isListed: (id) => isDefaultModelChoice(state, id) });
  if (split.effort === null) {
    return { body: input.body, parsed: input.parsed, model: input.model, fixedEffort: null };
  }
  const original = input.body.toString("utf8");
  const renamed = applyEdits(original, modify(original, ["model"], split.model, {}));
  return {
    body: Buffer.from(renamed, "utf8"),
    parsed: parseJson(renamed),
    model: split.model,
    fixedEffort: split.effort,
  };
}

/** 按 Agent 自己的格式把请求改成固定的档位：翻译时由 requestForModel 按每家的模型落定（直通在 askOnce 里另落定）。 */
function withAgentEffort(input: {
  body: Buffer;
  agent: ApiEndpointProvider;
  fixedEffort: FixedEffort | null;
}): Buffer {
  if (input.fixedEffort === null) return input.body;
  const text = withFixedEffort({
    format: AGENT_REQUEST_FORMAT[input.agent],
    text: input.body.toString("utf8"),
    effort: input.fixedEffort,
  });
  return Buffer.from(text, "utf8");
}

/**
 * Claude Code 的搜索子请求只交给同一模型下、打开了「自己能联网搜索」、有 Anthropic 或 Responses 地址的接口，
 * 对话本身走哪家不影响（ADR 0009）。只留这家会搜的地址：有 Anthropic 地址就原样直通，只有 Responses 地址时翻成那边的
 * 原生 web_search（照 magpie 先挑会搜的协议）；不会因为某个格式被拒换成 Chat 丢掉搜索。
 */
function webSearchCandidates(candidates: GatewayCandidate[]): GatewayCandidate[] {
  return candidates.flatMap((candidate) => {
    const { endpoint } = candidate;
    const baseUrls = endpoint.baseUrls.filter((entry) => searchesWebItself(endpoint, entry.format));
    if (baseUrls.length === 0) return [];
    const anthropic = baseUrls.filter((entry) => entry.format === "anthropic_messages");
    const kept = anthropic.length > 0 ? anthropic : baseUrls;
    return [{ ...candidate, endpoint: { ...endpoint, baseUrls: kept } }];
  });
}

function noWebSearchMessage(model: string): string {
  return (
    `Web search is not available for ${model}: no API endpoint that is on and serves this model ` +
    `has "Searches the web by itself" turned on in Osuna.`
  );
}

/**
 * 按模型名找候选。Codex 的记忆整理与 auto-review 找不到模型时，改用 Codex 上一轮对话用的模型找；
 * 找得到的 Codex 对话轮记下它问的模型。请求里的模型名不变，发给每家时照常换成候选的写法。
 * 厂商说已下线的模型只在指定了那家时才选。
 */
function routeModel(input: {
  req: Request;
  agent: ApiEndpointProvider;
  state: ApiEndpointState;
  model: string;
  failover: Failover;
}): GatewayRoute {
  const { req, agent, state, model } = input;
  const { codexTurns, retired } = input.failover;
  const listed = retired.listed(state);
  const route = resolveGatewayRoute({ state, listed, agent, model });
  if (route.ok) {
    if (agent === "codex") codexTurns.asked(req.headers, model);
    return route;
  }
  const standIn = agent === "codex" ? codexTurns.standIn(req.headers, model) : null;
  if (standIn === null) return route;
  const instead = resolveGatewayRoute({ state, listed, agent, model: standIn });
  return instead.ok ? instead : route;
}

/**
 * Claude Code 的 count_tokens：用户选的那家（冷却中、需要检查的跳过）有 Anthropic 地址就转给它，
 * 没有、或它数不了（报错、连不上）就按字节数 / 4 本地估算。数 token 不换家、不冷却。
 */
async function countTokens(input: {
  req: Request;
  res: Response;
  agent: ApiEndpointProvider;
  store: ApiEndpointStore;
  logger: pino.Logger;
  failover: Failover;
}): Promise<void> {
  const { res } = input;
  const wire = "anthropic";
  keepClaudeSignInOf(input);
  const routed = await routeAgentRequest({ ...input, wire, source: { kind: "agent_path" } });
  if (!routed) return;
  const { body, parsed, model, candidates } = routed;
  const { cooldowns } = input.failover;
  const counter =
    candidates.find(
      (candidate) => cooldowns.restOf(candidate.endpoint.id, candidate.upstreamModel) === null,
    ) ?? candidates[0];
  if (!counter || (await countOnEndpoint({ ...input, body, model, counter }))) return;
  try {
    const request = parseAnthropicRequest(parsed);
    res
      .status(200)
      .set(ANSWERED_BY_HEADER, counter.endpoint.slug)
      .json({ input_tokens: estimateInputTokens(request) });
  } catch (error) {
    if (!(error instanceof RequestShapeError)) throw error;
    sendAgentError({ res, wire, error: { status: 400, message: error.message } });
  }
}

/** claude.ai 登录的 Claude Code 发来的对话与 count_tokens：报错不能让它以为自己的登录失效（ADR 0012）。 */
function keepClaudeSignInOf(input: { req: Request; res: Response }): void {
  if (isClaudeSignIn(input.req.headers)) keepClaudeSignIn(input.res);
}

/** 转给这家的 Anthropic 地址数；它答了（或 Agent 走了）为 true，要本地估算为 false。 */
async function countOnEndpoint(input: {
  req: Request;
  res: Response;
  store: ApiEndpointStore;
  logger: pino.Logger;
  failover: Failover;
  body: Buffer;
  model: string;
  counter: GatewayCandidate;
}): Promise<boolean> {
  const { endpoint } = input.counter;
  const baseUrl = endpoint.baseUrls.find((entry) => entry.format === "anthropic_messages")?.url;
  const apiKey = input.store.getApiKey(endpoint.id);
  if (baseUrl === undefined || apiKey === null) return false;
  const outcome = await attemptEndpoint({
    req: input.req,
    res: input.res,
    format: "anthropic_messages",
    pathSuffix: "/count_tokens",
    endpoint,
    baseUrl,
    apiKey,
    body: input.body,
    requestedModel: input.model,
    upstreamModel: input.counter.upstreamModel,
    headerTimeoutMs: input.failover.headerTimeoutMs,
    userAgent: userAgentFor({ req: input.req, failover: input.failover }),
  });
  if (outcome.kind === "answered") await outcome.finished;
  if (outcome.kind !== "failed") return true;
  input.logger.debug(
    { endpoint: endpoint.slug, status: outcome.status },
    "API endpoint could not count tokens; estimating",
  );
  return false;
}

/**
 * 能问的候选：这次用哪种格式问它、那个格式的地址与 key。Agent 自己的格式即直通；
 * 别的格式带上读成中间格式的请求，翻译过去。
 */
interface AskableCandidate extends GatewayCandidate {
  format: ApiEndpointRequestFormat;
  baseUrl: string;
  apiKey: string;
  translated: GatewayRequest | null;
}

async function handleAgentRequest(input: {
  req: Request;
  res: Response;
  agent: ApiEndpointProvider;
  wire: AgentWire;
  format: AgentPath["format"];
  store: ApiEndpointStore;
  logger: pino.Logger;
  failover: Failover;
  source: RequestSource;
  forwardedHeaders?: IncomingHttpHeaders;
}): Promise<void> {
  const { req, res, wire, store } = input;
  const since = Date.now();
  if (wire === "anthropic") keepClaudeSignInOf(input);
  const reply = (status: number, message: string, headers?: Record<string, string>) =>
    sendAgentError({ res, wire, error: { status, message }, headers });

  const routed = await routeAgentRequest(input);
  if (!routed) return;
  const { model, candidates, fixedEffort } = routed;
  const body = withAgentEffort({ body: routed.body, agent: input.agent, fixedEffort });
  const parsed = body === routed.body ? routed.parsed : parseJson(body.toString("utf8"));
  const mended = mendedBody(input.format, body);
  // 翻译读的是修补过的请求，和直通发出去的一样。
  const translatable = mended === body ? parsed : parseJson(mended.toString("utf8"));
  const { refusals } = input.failover;
  let passable: AskableCandidate[];
  try {
    passable = askableCandidates({
      candidates,
      format: input.format,
      parsed: translatable,
      store,
      refusals,
    });
  } catch (error) {
    if (!(error instanceof RequestShapeError)) throw error;
    reply(400, error.message);
    return;
  }
  const chosen = candidates[0];
  if (passable.length === 0 && chosen) {
    const answeredBy = { [ANSWERED_BY_HEADER]: chosen.endpoint.slug };
    const asksSearch = asksWebSearch(input.format, translatable);
    if (askableFormat({ candidate: chosen, agentFormat: input.format, refusals, asksSearch })) {
      reply(500, `${chosen.endpoint.name}: the API key is missing`, answeredBy);
    } else {
      reply(502, `${chosen.endpoint.name}: no address for this agent's request format`, answeredBy);
    }
    return;
  }

  const conversation = `${input.agent}|${model}|${conversationId(req.headers, parsed)}`;
  const planned = planAttempts({
    passable,
    failover: input.failover,
    conversation,
    within: turnOf(wire, parsed).within,
  });
  if (planned.kind === "rest") {
    sendRest({ res, wire, ...planned });
    return;
  }
  const { modelFacts } = input.failover;
  const windowOf: WindowOf = (candidate) =>
    modelFacts(candidate.endpoint, candidate.upstreamModel).context;
  const windows = planned.plan.map(windowOf);
  const tokens = estimatedTokens({
    format: input.format,
    parsed: translatable,
    bytes: mended.length,
    windows,
  });
  const roomy = roomyCandidates({ plan: planned.plan, tokens, windowOf });
  for (const candidate of roomy.skipped) {
    const window = windowOf(candidate);
    input.logger.info(
      { endpoint: candidate.endpoint.name, model: candidate.upstreamModel, tokens, window },
      "API endpoint skipped: the request is past its context window",
    );
  }
  const keepAlive = new AgentKeepAlive({
    res,
    wire,
    since,
    streams: isRecord(parsed) && parsed.stream === true,
    everyMs: input.failover.keepAliveMs,
    quietMostMs: input.failover.keepAliveQuietMs,
  });
  try {
    await askInTurn({
      ...input,
      body: mended,
      parsed: translatable,
      model,
      fixedEffort,
      conversation,
      plan: roomy.plan,
      tokens,
      windowOf,
      keepAlive,
    });
  } finally {
    keepAlive.stop();
  }
}

/**
 * 这家用哪种格式问（chooseRequestFormat），跳过说过不提供这个模型的格式。所有格式都说过时照常挑：
 * 这家的这个模型已经冷却，冷却结束后从头再问。
 */
function askableFormat(input: {
  candidate: GatewayCandidate;
  agentFormat: ApiEndpointRequestFormat;
  refusals: RefusedShapes;
  asksSearch: boolean;
}): ApiEndpointRequestFormat | null {
  const { candidate } = input;
  const formats = formatsOf(candidate);
  const left = formatsLeft(input);
  // 并发的请求可能刚好把所有格式都记上：照常挑，交给冷却。
  const offered = left.length > 0 ? left : formats;
  return chooseRequestFormat({
    agentFormat: input.agentFormat,
    model: candidate.upstreamModel,
    formats: formatsToSearchOn({
      endpoint: candidate.endpoint,
      formats: offered,
      asked: input.asksSearch,
    }),
  });
}

function formatsOf(candidate: GatewayCandidate): ApiEndpointRequestFormat[] {
  return candidate.endpoint.baseUrls.map((entry) => entry.format);
}

/** 这家还没说过不提供这个模型的格式。 */
function formatsLeft(input: {
  candidate: GatewayCandidate;
  refusals: RefusedShapes;
}): ApiEndpointRequestFormat[] {
  const { id } = input.candidate.endpoint;
  const model = input.candidate.upstreamModel;
  return formatsOf(input.candidate).filter(
    (format) => !input.refusals.has(id, model, formatShape(format)),
  );
}

/**
 * 有地址、有 key、有能用的格式的候选；要翻译时把 Agent 的请求读成中间格式。
 * 读不懂（或翻不过去，如只给 file_id 的图片）的只跳过要翻译的候选；没有一家能问时抛出那个 RequestShapeError。
 */
function askableCandidates(input: {
  candidates: GatewayCandidate[];
  format: ApiEndpointRequestFormat;
  parsed: unknown;
  store: ApiEndpointStore;
  refusals: RefusedShapes;
}): AskableCandidate[] {
  const { refusals } = input;
  const asksSearch = asksWebSearch(input.format, input.parsed);
  const reachable = input.candidates.flatMap((candidate) => {
    const format = askableFormat({ candidate, agentFormat: input.format, refusals, asksSearch });
    const baseUrl = candidate.endpoint.baseUrls.find((entry) => entry.format === format)?.url;
    const apiKey = input.store.getApiKey(candidate.endpoint.id);
    if (format === null || baseUrl === undefined || apiKey === null) return [];
    return [{ ...candidate, format, baseUrl, apiKey }];
  });
  const translating = reachable.some((candidate) => candidate.format !== input.format);
  const translation = translating ? readTranslated(input) : null;
  const askable = reachable.flatMap((candidate): AskableCandidate[] => {
    if (candidate.format === input.format) return [{ ...candidate, translated: null }];
    return translation?.ok ? [{ ...candidate, translated: translation.request }] : [];
  });
  if (askable.length === 0 && translation && !translation.ok) throw translation.error;
  return askable;
}

type Translation = { ok: true; request: GatewayRequest } | { ok: false; error: RequestShapeError };

function readTranslated(input: { format: ApiEndpointRequestFormat; parsed: unknown }): Translation {
  try {
    return { ok: true, request: protocolOf(input.format).parse(input.parsed) };
  } catch (error) {
    if (!(error instanceof RequestShapeError)) throw error;
    return { ok: false, error };
  }
}

/**
 * 这次请求的本地估算（estimateInputTokens）。请求体字节 ÷ 4 都不到最小的已知窗口时估算不可能超过任何窗口，
 * 不必读（magpie roomy 同样）；读不懂、或没有已知窗口时为 null。
 */
function estimatedTokens(input: {
  format: ApiEndpointRequestFormat;
  parsed: unknown;
  bytes: number;
  windows: (number | undefined)[];
}): number | null {
  const known = input.windows.filter((window): window is number => window !== undefined);
  const mayOverflow = known.some((window) => input.bytes / 4 >= window);
  if (!mayOverflow) return null;
  const read = readTranslated(input);
  return read.ok ? estimateInputTokens(read.request) : null;
}

/** Responses 请求直通前先修补工具往来（夹在一串里的项、没有调用的结果、没有结果的调用）；没什么可改时原样不动。 */
function mendedBody(format: ApiEndpointRequestFormat, body: Buffer): Buffer {
  if (format !== "openai_responses") return body;
  const text = body.toString("utf8");
  const mended = pairToolItems(orphanedToolOutputs(joinToolRuns(text)));
  return mended === text ? body : Buffer.from(mended);
}

type PlannedAttempts =
  | { kind: "ask"; plan: AskableCandidate[] }
  | { kind: "rest"; candidate: GatewayCandidate; rest: EndpointRest; backAt?: number };

/**
 * 这次按什么顺序问：需要检查的不选；冷却中的排在后面，只留最早恢复的一家去问（magpie 的 restLast + probeOne），
 * 再按粘性把上次回答者挪到前面。都需要检查、或全都因额度用完在冷却时不问，交出记着的错误。
 */
function planAttempts(input: {
  passable: AskableCandidate[];
  failover: Failover;
  conversation: string;
  within: boolean;
}): PlannedAttempts {
  const { cooldowns, sticks } = input.failover;
  const restOf = (candidate: GatewayCandidate) =>
    cooldowns.restOf(candidate.endpoint.id, candidate.upstreamModel);
  const unchecked = input.passable.filter((candidate) => restOf(candidate)?.why !== "auth");
  const ready = unchecked.filter((candidate) => restOf(candidate) === null);
  const resting = unchecked.filter((candidate) => restOf(candidate) !== null);
  const lastPassable = input.passable.at(-1);
  const lastRest = lastPassable ? restOf(lastPassable) : null;
  if (unchecked.length === 0 && lastPassable && lastRest) {
    return { kind: "rest", candidate: lastPassable, rest: lastRest };
  }
  const held = ready.length === 0 ? quotaHeld(resting.map(restOf)) : null;
  const heldBy = resting[0];
  if (held && heldBy) {
    return { kind: "rest", candidate: heldBy, rest: held.first, backAt: held.backAt };
  }
  const soonest = [...resting].sort(
    (a, b) => (restOf(a)?.until ?? Infinity) - (restOf(b)?.until ?? Infinity),
  )[0];
  const plan = sticks.order({
    key: input.conversation,
    candidates: soonest ? [...ready, soonest] : ready,
    within: input.within,
    resting: (candidate) => restOf(candidate) !== null,
  });
  return { kind: "ask", plan };
}

/**
 * 按顺序问：开口前失败且值得换就冷却这家、换下一家；最后一家的错误交给 Agent。
 * 后面剩下的都因额度用完或欠费在冷却时，这家就当最后一家（原地重试、错误交给 Agent），不去问明知没额度的。
 * 对话太长不冷却：只换到后面已知窗口更大的候选，没有就交给 Agent。
 */
async function askInTurn(input: {
  req: Request;
  res: Response;
  wire: AgentWire;
  format: AgentPath["format"];
  logger: pino.Logger;
  failover: Failover;
  body: Buffer;
  // 修补过的请求读出来的样子：换到要翻译的格式时读成中间格式。
  parsed: unknown;
  model: string;
  fixedEffort: FixedEffort | null;
  conversation: string;
  plan: AskableCandidate[];
  // 这次请求的本地估算；没估为 null。
  tokens: number | null;
  windowOf: WindowOf;
  keepAlive: AgentKeepAlive;
  forwardedHeaders?: IncomingHttpHeaders;
}): Promise<void> {
  const { res, wire, logger, tokens, windowOf } = input;
  const { cooldowns, sticks, retired } = input.failover;
  const restOf = (candidate: GatewayCandidate) =>
    cooldowns.restOf(candidate.endpoint.id, candidate.upstreamModel);
  let remaining = [...input.plan];
  // 排第一那家的拒答，与第一份扣下的结束形式的拒答。
  let refused: Refused | null = null;
  let handBack: HandBack | null = null;
  for (let candidate = remaining.shift(); candidate; candidate = remaining.shift()) {
    const next = spentAfter(remaining.map(restOf)) ? undefined : remaining[0];
    const outcome = await askUntilSettled({ ...input, candidate, last: next === undefined });
    if (outcome.kind === "gone") return;
    if (outcome.kind === "answered") {
      const end = await outcome.finished;
      if (end.kind === "complete") {
        cooldowns.served(candidate.endpoint.id, candidate.upstreamModel);
        retired.restore({ endpoint: candidate.endpoint, model: candidate.upstreamModel });
        sticks.answered(input.conversation, {
          endpointId: candidate.endpoint.id,
          model: candidate.upstreamModel,
          usage: end.usage,
        });
      } else if (end.kind === "broken" && lateRests(end.message)) {
        markFailed({
          cooldowns,
          candidate,
          failed: { status: 502, headers: {}, text: end.message, detail: end.message },
        });
      }
      return;
    }
    const { failed } = outcome;
    logger.warn(
      { endpoint: candidate.endpoint.slug, status: failed.status, detail: failed.detail },
      "API endpoint returned an error",
    );
    // 拒答不怪这家：不冷却、不标「需要检查」，问遍剩下的；都拒答时交出排第一那家的（magpie #248）。
    if (failed.cause === "refused") {
      refused ??= { candidate, failed };
      handBack ??= failed.handBack;
      if (next) {
        logSwitch({ logger, from: candidate, to: next, failure: "refused", failed, rest: null });
        continue;
      }
      await sendAllRefused({ res, wire, refused, handBack });
      return;
    }
    // 厂商自己的清单可能还列着它（OpenCode Zen 的 exo-free）：这家的这一项一周内不进列表。
    if (modelRetired(failed.status, failed.text)) {
      retired.retire({ endpoint: candidate.endpoint, model: candidate.upstreamModel });
    }
    const window = windowOf(candidate);
    const overflow = overflowOf({
      ...failed,
      tokens,
      window,
      model: candidate.upstreamModel,
      endpointName: candidate.endpoint.name,
    });
    if (overflow) {
      const larger = largerWindows({ left: remaining, window, tokens, windowOf });
      const to = larger[0];
      if (to) {
        logger.info(
          {
            from: candidate.endpoint.name,
            to: to.endpoint.name,
            model: candidate.upstreamModel,
            failure: "too_long",
            status: failed.status,
            until: null,
          },
          "API endpoint gateway switched endpoints",
        );
        remaining = larger;
        continue;
      }
      const told = toldTooLong(failed, overflow);
      sendFailedAttempt({
        res,
        wire,
        endpoint: candidate.endpoint,
        failed: told,
        suffix: "",
        headers: {},
      });
      return;
    }
    if (!retryable(failed.status, failed.text)) {
      sendFailedAttempt({
        res,
        wire,
        endpoint: candidate.endpoint,
        failed,
        suffix: "",
        headers: {},
      });
      return;
    }
    // 空回复怪不到这家，不冷却。
    let rest: EndpointRest | null = null;
    if (failed.cause !== "empty") rest = markFailed({ cooldowns, candidate, failed });
    if (next) {
      const failure = switchedFailure(failed, rest);
      logSwitch({ logger, from: candidate, to: next, failure, failed, rest });
      continue;
    }
    sendFailedAttempt({
      res,
      wire,
      endpoint: candidate.endpoint,
      failed,
      suffix: backAgainSuffix(rest),
      headers: missingRetryAfter(failed, rest),
    });
    return;
  }
}

/** 一次拒答：哪家、它的失败（说法是安全过滤的原因）。 */
interface Refused {
  candidate: AskableCandidate;
  failed: FailedAttempt;
}

function logSwitch(input: {
  logger: pino.Logger;
  from: AskableCandidate;
  to: AskableCandidate;
  failure: string;
  failed: FailedAttempt;
  rest: EndpointRest | null;
}): void {
  const { from, rest } = input;
  const until = rest?.until ? new Date(rest.until).toISOString() : null;
  input.logger.info(
    {
      from: from.endpoint.name,
      to: input.to.endpoint.name,
      model: from.upstreamModel,
      failure: input.failure,
      status: input.failed.status,
      until,
    },
    "API endpoint gateway switched endpoints",
  );
}

/**
 * 全都拒答（magpie gateway.go 的 handBack 与 failTo(refusedStatus)）：Claude Code 收到扣下的那份原样拒答
 * （200、stop_reason refusal 与 stop_details），它会按自己的设置换备用模型；保活之后就以流里的拒答结尾。
 * 没有扣下的（都以报错形式拒答）、或是 Codex，收到 400 与排第一那家的原因。
 */
async function sendAllRefused(input: {
  res: Response;
  wire: AgentWire;
  refused: Refused;
  handBack: HandBack | null;
}): Promise<void> {
  const { res, wire, handBack } = input;
  const handsBackToClaude = wire === "anthropic" && handBack !== null;
  if (handsBackToClaude) {
    const outcome = await handBack();
    if (outcome.kind === "gone") return;
    if (outcome.kind === "answered") {
      await outcome.finished;
      return;
    }
  }
  const { candidate, failed } = input.refused;
  const { endpoint } = candidate;
  sendRefusal({
    res,
    wire,
    message: `${endpoint.name}: ${candidate.upstreamModel} refused this request (${failed.detail})`,
    headers: { [ANSWERED_BY_HEADER]: endpoint.slug },
  });
}

type SettledAttempt =
  | Exclude<AttemptOutcome, FailedAttempt>
  | { kind: "failed"; failed: FailedAttempt };

/**
 * 问一家；回了空回复就马上再问一次。它是最后一家且只是一时忙或限流时，稍等后原地再问（magpie 的 passing）。
 */
async function askUntilSettled(input: {
  req: Request;
  res: Response;
  wire: AgentWire;
  logger: pino.Logger;
  body: Buffer;
  parsed: unknown;
  model: string;
  fixedEffort: FixedEffort | null;
  candidate: AskableCandidate;
  last: boolean;
  format: AgentPath["format"];
  failover: Failover;
  keepAlive: AgentKeepAlive;
  forwardedHeaders?: IncomingHttpHeaders;
}): Promise<SettledAttempt> {
  const { res } = input;
  let askedEmptyAgain = false;
  let again = 0;
  for (;;) {
    const outcome = await askEndpoint(input);
    if (outcome.kind !== "failed") return outcome;
    if (outcome.cause === "refused") return { kind: "failed", failed: outcome };
    if (outcome.cause === "empty") {
      if (askedEmptyAgain) return { kind: "failed", failed: outcome };
      askedEmptyAgain = true;
      continue;
    }
    const pause =
      input.last && outcome.cause !== "timeout" && retryable(outcome.status, outcome.text)
        ? passing({
            status: outcome.status,
            headers: outcome.headers,
            body: outcome.text,
            again,
            retryPauseMs: input.failover.retryPauseMs,
            now: Date.now(),
          })
        : { again: false, waitMs: 0 };
    if (!pause.again) return { kind: "failed", failed: outcome };
    again++;
    await new Promise((resolve) => setTimeout(resolve, pause.waitMs));
    if (res.destroyed) return { kind: "gone" };
  }
}

interface EndpointAsk {
  req: Request;
  res: Response;
  wire: AgentWire;
  logger: pino.Logger;
  body: Buffer;
  parsed: unknown;
  model: string;
  candidate: AskableCandidate;
  format: AgentPath["format"];
  // 「模型名:档位」固定的档位；直通时按这家的模型落定后照发。
  fixedEffort: FixedEffort | null;
  failover: Failover;
  keepAlive: AgentKeepAlive;
  // 转给上游的 Agent 请求头；缺省是全部（attemptEndpoint）。
  forwardedHeaders?: IncomingHttpHeaders;
}

/**
 * 问一家，直到它不再说这个格式的地址没有这个模型：说了就记住，按格式顺序换这家的下一个地址再问
 * （要翻译就翻译）。所有格式都说没有、或剩下的格式翻不过去时，交出最后一次的失败，按原来的规则只冷却这个模型。
 */
async function askEndpoint(input: EndpointAsk): Promise<AttemptOutcome> {
  let { candidate } = input;
  for (;;) {
    const outcome = await askOnce({ ...input, candidate });
    if (outcome.kind !== "failed") return outcome;
    if (!refusesFormat(outcome)) return outcome;
    const refused = shapeRefusals({ ...input, candidate });
    refused.add(formatShape(candidate.format));
    const { refusals } = input.failover;
    if (formatsLeft({ candidate, refusals }).length === 0) {
      // 所有格式都说没有：照原规则只冷却这个模型；忘掉这些格式，冷却结束后从头再问。
      const shapes = formatsOf(candidate).map(formatShape);
      refusals.forget({
        endpointId: candidate.endpoint.id,
        model: candidate.upstreamModel,
        shapes,
      });
      return outcome;
    }
    const next = nextFormat({ ...input, candidate });
    if (next === null) return outcome;
    candidate = next;
  }
}

/** 这家下一个还没说过没有这个模型的格式；要翻译却翻不过去时为 null。 */
function nextFormat(input: EndpointAsk): AskableCandidate | null {
  const { candidate } = input;
  const left = formatsLeft({ candidate, refusals: input.failover.refusals });
  const asked = asksWebSearch(input.format, input.parsed);
  const formats = formatsToSearchOn({ endpoint: candidate.endpoint, formats: left, asked });
  const format = chooseRequestFormat({
    agentFormat: input.format,
    model: candidate.upstreamModel,
    formats,
  });
  const baseUrl = candidate.endpoint.baseUrls.find((entry) => entry.format === format)?.url;
  if (format === null || baseUrl === undefined) return null;
  if (format === input.format) return { ...candidate, format, baseUrl, translated: null };
  const translation = readTranslated({ format: input.format, parsed: input.parsed });
  if (!translation.ok) return null;
  return { ...candidate, format, baseUrl, translated: translation.request };
}

/** 这家的这个模型不收哪些写法；新记住一种就写一行 info 日志。 */
function shapeRefusals(input: EndpointAsk): ShapeRefusals {
  const { candidate } = input;
  const { refusals } = input.failover;
  const endpointId = candidate.endpoint.id;
  const model = candidate.upstreamModel;
  const foldsRoots = foldsRootsUpFront(candidate.baseUrl);
  return {
    has: (shape) => {
      const foldedUpFront = shape === "rootUnion" && foldsRoots;
      return foldedUpFront || refusals.has(endpointId, model, shape);
    },
    add: (shape) => {
      // 并发的请求可能都按旧写法发出、都被拒：日志只在第一次记住时写。
      if (refusals.has(endpointId, model, shape)) return;
      refusals.add(endpointId, model, shape);
      input.logger.info(
        { endpoint: candidate.endpoint.name, model, refused: shape },
        refusalNote(shape),
      );
    },
  };
}

/** 问一次：这家用 Agent 自己的格式就直通，否则翻译。 */
function askOnce(input: EndpointAsk): Promise<AttemptOutcome> {
  const { candidate } = input;
  const refused = shapeRefusals(input);
  const target = {
    res: input.res,
    endpoint: candidate.endpoint,
    baseUrl: candidate.baseUrl,
    apiKey: candidate.apiKey,
    requestedModel: input.model,
    upstreamModel: candidate.upstreamModel,
    headerTimeoutMs: input.failover.headerTimeoutMs,
    userAgent: userAgentFor(input),
    refusals: refused,
    keepAlive: input.keepAlive,
  };
  if (candidate.translated === null) {
    return attemptEndpoint({
      ...target,
      req: input.req,
      format: input.format,
      body: input.body,
      forwardedHeaders: input.forwardedHeaders,
      ...passedEffort(input),
    });
  }
  // 只有在这个格式上自己会搜的那家才带搜索（ADR 0009）；不会搜的连同点名它的 tool_choice 一起拿掉。
  const searches = searchesWebItself(candidate.endpoint, candidate.format);
  return attemptTranslated({
    ...target,
    wire: input.wire,
    from: input.format,
    to: candidate.format,
    request: withWebSearchFor({ request: candidate.translated, searches }),
    facts: input.failover.modelFacts(candidate.endpoint, candidate.upstreamModel),
    retryPauseMs: input.failover.retryPauseMs,
  });
}

/** 直通时固定的档位按这家这个模型自己的档位落定（magpie fitLevel）；没固定时不带。 */
function passedEffort(input: EndpointAsk): { fixedEffort?: FixedEffort } {
  if (input.fixedEffort === null) return {};
  const { candidate } = input;
  const facts = input.failover.modelFacts(candidate.endpoint, candidate.upstreamModel);
  return { fixedEffort: fitFixedEffort({ effort: input.fixedEffort, levels: facts.efforts }) };
}

/** 发给上游的 User-Agent：直通与翻译都用 CLI 自己的，CLI 没带时用 Osuna/<版本>。 */
function userAgentFor(input: { req: Request; failover: Failover }): string {
  return input.req.headers["user-agent"] ?? input.failover.ownUserAgent;
}

/**
 * 超长交给 Agent 的样子：上游说了的照原样；不说原因、认作超长的改成 400、换成「prompt is too long」的说法。
 * 两种都由 sendAgentError 按 CLI 自己的说法交出（invalid_request_error、context_length_exceeded）。
 */
function toldTooLong(failed: FailedAttempt, overflow: Overflow): FailedAttempt {
  if (overflow.kind === "said") return failed;
  return {
    ...failed,
    status: 400,
    headers: {},
    detail: overflow.message,
  };
}

/** 换家日志里的失败原因：空回复，或冷却的分类。 */
function switchedFailure(failed: FailedAttempt, rest: EndpointRest | null): string {
  if (failed.cause === "empty") return "empty";
  return rest?.why ?? endpointFailure(failed.status, failed.text);
}

/** 把一次失败记进冷却：判错读上游原文，全在冷却时交出的是打过码的原文。 */
function markFailed(input: {
  cooldowns: EndpointCooldowns;
  candidate: AskableCandidate;
  failed: Pick<FailedAttempt, "status" | "headers" | "text" | "detail">;
}): EndpointRest | null {
  const { candidate, failed } = input;
  return input.cooldowns.markFailed({
    endpoint: candidate.endpoint,
    model: candidate.upstreamModel,
    baseUrl: candidate.baseUrl,
    status: failed.status,
    headers: failed.headers,
    body: failed.text,
    said: failed.detail,
  });
}

/**
 * 额度、欠费、限流判出了恢复时间：附在上游原文后面。全在额度冷却时给的是最早恢复那家的时刻
 * （`backAt`，magpie 同样），不是被复述那家自己的。
 */
function backAgainSuffix(rest: EndpointRest | null, backAt?: number): string {
  const backed = rest?.why === "credit" || rest?.why === "quota" || rest?.why === "rate";
  if (!backed) return "";
  const until = backAt ?? rest.until;
  if (until === null) return "";
  return ` (available again at ${heldClock(until, Date.now())})`;
}

/** 429 没带 Retry-After 时告诉 CLI 何时再问：这家冷却结束的时刻。 */
function missingRetryAfter(
  failed: FailedAttempt,
  rest: EndpointRest | null,
): Record<string, string> {
  if (failed.status !== 429 || failed.headers["retry-after"] !== undefined) return {};
  return rest?.until ? { "retry-after": retryAfterSeconds(rest.until) } : {};
}

function retryAfterSeconds(at: number): string {
  return String(Math.max(Math.ceil((at - Date.now()) / 1000), 1));
}

/** 不问上游，直接交出冷却里记着的那次错误：全在额度冷却中，或都需要检查。 */
function sendRest(input: {
  res: Response;
  wire: AgentWire;
  candidate: GatewayCandidate;
  rest: EndpointRest;
  backAt?: number;
}): void {
  const { rest } = input;
  sendAgentError({
    res: input.res,
    wire: input.wire,
    error: {
      status: rest.status,
      message: `${input.candidate.endpoint.name}: ${rest.said}${backAgainSuffix(rest, input.backAt)}`,
    },
    headers: {
      [ANSWERED_BY_HEADER]: input.candidate.endpoint.slug,
      ...(input.backAt === undefined ? {} : { "retry-after": retryAfterSeconds(input.backAt) }),
    },
  });
}

function agentPath(path: string): AgentPath | null {
  return path === "/v1/messages" || path === "/v1/responses" ? AGENT_PATHS[path] : null;
}

/** 认不出路径时（拒收、/v1/models）按请求头猜：带 anthropic-version 的是 Claude Code。 */
function wireOf(req: Request): AgentWire {
  const target = agentPath(req.path);
  if (target) return target.wire;
  return req.headers["anthropic-version"] ? "anthropic" : "openai";
}

function readState(input: {
  res: Response;
  wire: AgentWire;
  store: ApiEndpointStore;
  logger: pino.Logger;
}): ApiEndpointState | null {
  try {
    return input.store.readState();
  } catch (error) {
    if (!(error instanceof ApiEndpointsFileUnparsableError)) throw error;
    input.logger.error(
      { err: error, filePath: error.filePath },
      "API endpoints file could not be parsed",
    );
    sendAgentError({
      res: input.res,
      wire: input.wire,
      error: { status: 500, message: "The API endpoints file could not be parsed" },
    });
    return null;
  }
}

/** OpenAI 与 Anthropic 两种列表写法合在一份里：开着的接口的已选模型，去重后的光秃秃名字。 */
function modelList(state: ApiEndpointState) {
  const data = usableModels(state).map((model) => ({
    id: model.id,
    object: "model",
    type: "model",
    display_name: model.label ?? model.id,
    created: 0,
    created_at: "1970-01-01T00:00:00Z",
    owned_by: "osuna",
  }));
  return {
    object: "list",
    data,
    has_more: false,
    first_id: data[0]?.id ?? null,
    last_id: data.at(-1)?.id ?? null,
  };
}
