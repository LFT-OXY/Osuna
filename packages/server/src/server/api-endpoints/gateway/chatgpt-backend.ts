// ChatGPT 后端路径的原样转发移植自 magpie（https://github.com/yetone/magpie，internal/gateway/codex_backend.go 的
// CodexPath、codexBackend 的 WebSocket 426、codexUpstream 的转发地址与 apiKey、codexKeyRefused、copyHeaders 与 hopHeader、
// codexHeader；gateway.go 的 codexClientHeader；codex_search.go 的 alphaSearchReply）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import http, {
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
} from "node:http";
import https from "node:https";
import type { Duplex } from "node:stream";
import type { Request, Response } from "express";
import type pino from "pino";
import { withListTag } from "../codex-models-cache.js";
import { isRecord, parseJson } from "../upstream-http.js";
import { sendAgentError } from "./agent-errors.js";
import type { ChatGptLedgerWatch } from "./chatgpt-ledger.js";
import { readLimited } from "./upstream-call.js";

/*
 * 用 ChatGPT 登录的 Codex 经顶层 openai_base_url 指到中转站的这组路径（ADR 0010）。
 * 以 /backend-api/codex 结尾，Codex 才继续把它当 ChatGPT 后端。
 * 这里把请求原样转给 ChatGPT：原路径与查询串，除逐跳头与 Host 外的请求头全部照带（含 ChatGPT 令牌与账号 id），
 * 请求体一个字节不改（zstd 也不解），回复照原样边收边回。Osuna 不加任何自己的头。
 * 带 API key（Bearer sk-）的请求照 magpie 转给 OpenAI API（模型清单除外）：开关开着时用户换成 API key 登录、
 * Osuna 还没按新登录方式改写 config.toml 的空档里会这样来。
 */

export const CHATGPT_BACKEND_PATH = "/backend-api/codex";
export const DEFAULT_CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const DEFAULT_OPENAI_API_BASE_URL = "https://api.openai.com/v1";

// 逐跳头（magpie hopHeader）与 Host：既不转给 ChatGPT，也不从它的回复转回去。长度照转，请求体与回复都原样。
const NOT_RELAYED = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "host",
]);

export interface ChatGptBases {
  chatgpt: string;
  openAiApi: string;
}

/** 中转站内的路径若是 ChatGPT 后端那组，返回其后的部分（可能为空串）；否则 null。 */
export function chatgptBackendRest(path: string): string | null {
  if (path === CHATGPT_BACKEND_PATH) return "";
  return path.startsWith(`${CHATGPT_BACKEND_PATH}/`)
    ? path.slice(CHATGPT_BACKEND_PATH.length)
    : null;
}

/**
 * 转去的完整地址：基地址加原路径与原查询串（url 是中转站内的路径带查询串）。
 * API key 登录的 Codex 去 OpenAI API，它的模型清单仍问 ChatGPT（magpie codexUpstream）。
 */
export function chatgptTarget(input: {
  url: string;
  authorization: string | undefined;
  bases: ChatGptBases;
}): string {
  const tail = input.url.slice(CHATGPT_BACKEND_PATH.length);
  const base = isForOpenAiApi(input) ? input.bases.openAiApi : input.bases.chatgpt;
  return `${base.replace(/\/+$/, "")}${tail}`;
}

/** 带 API key（Bearer sk-）、又不是模型清单的请求转给 OpenAI API（magpie apiKey 与 codexUpstream）。 */
export function isForOpenAiApi(input: { url: string; authorization: string | undefined }): boolean {
  const rest = input.url.slice(CHATGPT_BACKEND_PATH.length).split("?")[0] ?? "";
  return isSignedInWithApiKey(input.authorization) && rest !== "/models";
}

function isSignedInWithApiKey(authorization: string | undefined): boolean {
  return (authorization ?? "").replace(/^Bearer /, "").startsWith("sk-");
}

/**
 * OpenAI 以 401 拒收 Codex 登录用的 API key 时告诉 Codex 的话（magpie codexKeyRefused）：
 * 带上 OpenAI 自己的说法，说明 Codex 自带模型走的是 Codex 自己的登录、可以怎么办。
 */
export function apiKeyRefusedMessage(body: string): string {
  const parsed = parseJson(body);
  const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : null;
  const said =
    error && typeof error.message === "string" && error.message !== ""
      ? error.message
      : body.trim();
  return (
    `OpenAI refused the API key Codex is signed in with (${said}). ` +
    "This is one of Codex's own models, which goes to OpenAI with Codex's own sign-in: " +
    "pick an endpoint model (<endpoint>/<model>) in Codex, " +
    "or sign Codex in with ChatGPT, or with an OpenAI API key"
  );
}

/**
 * 名字带接口标识（`<标识>/<模型名>`）的是接口模型，由中转站按标识选路；光秃秃的名字一律是 ChatGPT 自带的模型
 * （ADR 0010）。ChatGPT 的模型名从不带斜杠。
 */
export function isEndpointModel(model: string | null): boolean {
  return model !== null && model.includes("/");
}

/**
 * 发给接口的请求头只留 Codex 表明身份的那些（magpie codexClientHeader）：User-Agent、originator、会话与线程 id、
 * version、x-client-request-id 和 x-openai-* / x-codex-* 头，另加说明请求体格式的 Content-Type 与 Accept。
 * ChatGPT 令牌、账号 id、Cookie、设备证明、只对这个 ChatGPT 账号有意义的 luna-reserve 与 turn-state 一律不带。
 */
export function codexIdentityHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const identity = Object.entries(headers).filter(([name, value]) => {
    const isSent = value !== undefined;
    return isSent && isCodexIdentityHeader(name.toLowerCase());
  });
  return Object.fromEntries(identity);
}

const CODEX_IDENTITY_HEADERS = new Set([
  "content-type",
  "accept",
  "user-agent",
  "originator",
  "session-id",
  "thread-id",
  "session_id",
  "conversation_id",
  "x-client-request-id",
  "version",
]);

function isCodexIdentityHeader(name: string): boolean {
  const isSignIn =
    name.includes("authorization") ||
    name === "x-oai-attestation" ||
    name === "x-openai-codex-luna-reserve" ||
    name === "x-codex-turn-state";
  if (isSignIn) return false;
  return (
    CODEX_IDENTITY_HEADERS.has(name) || name.startsWith("x-openai-") || name.startsWith("x-codex-")
  );
}

/**
 * 接口模型的 Codex 独立搜索（web.run 调 /alpha/search）的回答：200，output 是给模型看的一句说明。
 * 不回 404：web.run 的任何失败 Codex 都当作这一轮结束（magpie codex_search.go）。
 */
/** Codex 的 SearchResponse：output 是给模型看的工具结果。 */
export interface AlphaSearchReply {
  encrypted_output: null;
  output: string;
}

export function noWebSearchReply(model: string): AlphaSearchReply {
  return {
    encrypted_output: null,
    output:
      `Web search is not available for ${model}: it is an API endpoint model, and Codex's web search (web.run) ` +
      "only works with ChatGPT's own models. Answer without searching the web.",
  };
}

/** 去掉逐跳头与 Host，其余原样（请求头、回复头都用它）。 */
export function relayedHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) => value !== undefined && !NOT_RELAYED.has(name.toLowerCase()),
    ),
  );
}

export function isWebSocketHandshake(headers: IncomingHttpHeaders): boolean {
  return headers.upgrade?.toLowerCase() === "websocket";
}

/**
 * daemon 的 upgrade 事件：中转站 ChatGPT 后端路径上的 WebSocket 握手回 426，Codex 立刻改用 HTTP，
 * 不重试也不警告。要挂在 daemon 自己的 WebSocket 服务之前：它跳过已经答完（结束了）的 socket。
 */
export function answerChatGptWebSocket(input: {
  gatewayPath: string;
  req: IncomingMessage;
  socket: Duplex;
}): void {
  const path = (input.req.url ?? "").split("?")[0] ?? "";
  const isInGateway = path.startsWith(`${input.gatewayPath}/`);
  const rest = isInGateway ? chatgptBackendRest(path.slice(input.gatewayPath.length)) : null;
  if (rest === null || !isWebSocketHandshake(input.req.headers)) return;
  const message = "Osuna's API endpoint gateway speaks HTTP";
  input.socket.end(
    `HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
  );
}

/**
 * 原样转给 ChatGPT（或 API key 登录时的 OpenAI API），回复边收边回。`body` 是已经读出来的原样字节
 * （要先看模型名的那几条路径），没有就把请求体直接接过去。
 * 回复的 X-Models-Etag 带上接口模型的标记（magpie modelsEtag），与清单的 ETag 一致，Codex 才不会每轮重拉清单，
 * 接口模型变了它也会重拉。
 */
export function relayToChatGpt(input: {
  req: Request;
  res: Response;
  bases: ChatGptBases;
  logger: pino.Logger;
  body?: Buffer;
  // 发给 ChatGPT 的请求头；缺省是 Codex 的请求头去掉逐跳头与 Host。
  headers?: IncomingHttpHeaders;
  listTag: () => string;
  // ChatGPT 自带模型的对话：记进中转站账本（接口记为官方）。别的路径不记。
  watch?: ChatGptLedgerWatch;
}): void {
  const { req, res, watch } = input;
  const signIn = { url: req.url, authorization: req.headers.authorization };
  const isToOpenAiApi = isForOpenAiApi(signIn);
  const target = new URL(chatgptTarget({ ...signIn, bases: input.bases }));
  const transport = target.protocol === "https:" ? https : http;
  const upstream: ClientRequest = transport.request(target, {
    method: req.method,
    headers: input.headers ?? relayedHeaders(req.headers),
  });
  // Codex 先断开（用户中断）：不再等 ChatGPT。
  const abandon = () => {
    if (!res.writableFinished) upstream.destroy();
  };
  res.once("close", abandon);
  watch?.watchGone(res);
  upstream.once("response", (reply) => {
    // ChatGPT 自己的 401、403 原样回；只有 OpenAI API 拒收 API key 的 401 照 magpie 改写成说明。
    if (isToOpenAiApi && reply.statusCode === 401) {
      void sendApiKeyRefused({ res, reply }).then((message) => watch?.failed(message));
      return;
    }
    const headers = relayedHeaders(reply.headers);
    const modelsEtag = headers["x-models-etag"];
    if (typeof modelsEtag === "string") {
      headers["x-models-etag"] = withListTag(modelsEtag, input.listTag());
    }
    res.writeHead(reply.statusCode ?? 502, headers);
    watch?.replied(reply);
    reply.pipe(res);
    // ChatGPT 中途断流：Codex 看到的是断开，账本记失败（Codex 先走的已经记了取消）。
    const broke = () => {
      watch?.failed("ChatGPT: the reply broke off");
      res.destroy();
    };
    reply.once("error", broke);
    reply.once("aborted", broke);
  });
  upstream.once("error", (error) => {
    res.off("close", abandon);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const reason = error instanceof Error && "code" in error ? String(error.code) : error.message;
    input.logger.warn({ err: error, host: target.host }, "ChatGPT backend unreachable");
    const message = `ChatGPT can't be reached (${reason}). Codex's own models go to ChatGPT with Codex's own sign-in through Osuna's API endpoint gateway: let this computer reach ${target.host}, or pick an endpoint model (<endpoint>/<model>) in Codex`;
    watch?.failed(message);
    sendAgentError({ res, wire: "openai", error: { status: 502, message } });
  });
  if (input.body === undefined) {
    req.pipe(upstream);
  } else {
    upstream.end(input.body);
  }
}

/** 返回交给 Codex 的说法。 */
async function sendApiKeyRefused(input: {
  res: Response;
  reply: IncomingMessage;
}): Promise<string> {
  const body = await readLimited({ stream: input.reply, first: null });
  const message = apiKeyRefusedMessage(body);
  sendAgentError({ res: input.res, wire: "openai", error: { status: 401, message } });
  return message;
}
