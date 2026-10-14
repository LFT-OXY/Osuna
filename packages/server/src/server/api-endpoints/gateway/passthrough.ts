import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import https from "node:https";
import type { Request, Response } from "express";
import { applyEdits, modify } from "jsonc-parser";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { StoredApiEndpoint } from "../store.js";
import { describeNetworkError, extractErrorDetail, isRecord, parseJson } from "../upstream-http.js";
import { sendAgentError, type AgentError, type AgentWire } from "./agent-errors.js";

/*
 * 同协议直通的一次尝试：请求体除模型名外逐字节原样发给上游，认证头换成这家的真实 key。
 * 上游开口（响应头加第一段回复）之前的失败不写给 Agent，交回中转站决定换不换家；
 * 开口之后边收边发，上游断流就断开 Agent 的连接，由 CLI 自己报错。
 * 用 node:http 而不是 fetch：fetch 会替我们解压、把等响应头的时间限死在 5 分钟。
 */

// 只为排查：回复是哪家接口答的。值用标识，因为接口名可能含中文，放不进响应头。
export const ANSWERED_BY_HEADER = "x-osuna-api-endpoint";

const MAX_ERROR_BODY_BYTES = 1024 * 1024;

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

// 上游路径：Anthropic 地址按 Claude Code 的规则拼 /v1/messages；Responses 地址已按 Codex 的规则以 /v1 结尾。
const UPSTREAM_PATHS: Partial<Record<ApiEndpointRequestFormat, string>> = {
  anthropic_messages: "/v1/messages",
  openai_responses: "/responses",
};

/** 开口之前的失败：上游的状态码与错误体，或中转站自己判的超时（504）与连不上（502）。 */
export interface FailedAttempt {
  kind: "failed";
  status: number;
  headers: IncomingHttpHeaders;
  // 上游错误体原文，判错用；超时与连不上时是 detail。
  text: string;
  // 给 Agent 看的上游原文，key 已打码。
  detail: string;
  upstreamError: Pick<AgentError, "type" | "code">;
  // 等响应头超时：不原地重试，真实的等待是 10 分钟。
  timedOut: boolean;
}

/** 开口之后回复怎么结束的：完整（带这次的缓存命中 token 数）、上游断流、Agent 先走了。 */
export type AnswerEnd =
  | { kind: "complete"; cacheRead: number }
  | { kind: "broken"; message: string }
  | { kind: "gone" };

export type AttemptOutcome =
  | { kind: "answered"; finished: Promise<AnswerEnd> }
  | FailedAttempt
  | { kind: "gone" };

type UpstreamOutcome =
  | { kind: "response"; response: IncomingMessage }
  | { kind: "timeout" }
  | { kind: "failed"; error: unknown };

type FirstChunk = { kind: "chunk"; chunk: Buffer } | { kind: "end" } | { kind: "broken" };

export async function attemptEndpoint(input: {
  req: Request;
  res: Response;
  format: ApiEndpointRequestFormat;
  endpoint: StoredApiEndpoint;
  baseUrl: string;
  apiKey: string;
  body: Buffer;
  requestedModel: string;
  upstreamModel: string;
  headerTimeoutMs: number;
}): Promise<AttemptOutcome> {
  const { res, apiKey } = input;
  const query = input.req.originalUrl.includes("?")
    ? input.req.originalUrl.slice(input.req.originalUrl.indexOf("?"))
    : "";
  const url = new URL(
    `${input.baseUrl.trim().replace(/\/+$/, "")}${UPSTREAM_PATHS[input.format]}${query}`,
  );
  const body =
    input.upstreamModel === input.requestedModel
      ? input.body
      : Buffer.from(replaceModel(input.body.toString("utf8"), input.upstreamModel));

  const outcome = await sendUpstream({
    res,
    url,
    headers: upstreamHeaders({ headers: input.req.headers, apiKey, format: input.format }),
    body,
    headerTimeoutMs: input.headerTimeoutMs,
  });
  if (res.destroyed) return { kind: "gone" };

  if (outcome.kind === "timeout") {
    return failedBySelf({
      status: 504,
      detail: `no response headers within ${input.headerTimeoutMs / 1000}s`,
      timedOut: true,
    });
  }
  if (outcome.kind === "failed") {
    const detail = `${url.origin}: ${describeNetworkError(outcome.error)}`;
    return failedBySelf({ status: 502, detail: detail.replaceAll(apiKey, "***"), timedOut: false });
  }

  const { response } = outcome;
  const status = response.statusCode ?? 502;
  if (status >= 400) {
    const text = await readLimited(response, MAX_ERROR_BODY_BYTES);
    return {
      kind: "failed",
      status,
      headers: response.headers,
      text,
      detail: extractErrorDetail(text, apiKey) || `HTTP ${status}`,
      upstreamError: readUpstreamError(text),
      timedOut: false,
    };
  }

  const first = await firstChunk(response);
  if (res.destroyed) return { kind: "gone" };
  if (first.kind === "broken") {
    return failedBySelf({
      status: 502,
      detail: `${url.origin}: the connection closed before the reply began`,
      timedOut: false,
    });
  }
  res.writeHead(status, {
    ...responseHeaders(response.headers),
    [ANSWERED_BY_HEADER]: input.endpoint.slug,
  });
  if (first.kind === "end") {
    res.end();
    return { kind: "answered", finished: Promise.resolve({ kind: "complete", cacheRead: 0 }) };
  }
  return { kind: "answered", finished: relay({ response, res, first: first.chunk }) };
}

/** 中转站自己判的失败（超时、连不上、开口前断开）：没有上游错误体，判错就读这段描述。 */
function failedBySelf(input: { status: number; detail: string; timedOut: boolean }): FailedAttempt {
  return {
    kind: "failed",
    status: input.status,
    headers: {},
    text: input.detail,
    detail: input.detail,
    upstreamError: {},
    timedOut: input.timedOut,
  };
}

/** 等上游回复的第一段：拿到之前断开的还能换家。 */
function firstChunk(response: IncomingMessage): Promise<FirstChunk> {
  return new Promise((resolve) => {
    const settle = (result: FirstChunk) => {
      response.off("data", onData);
      response.off("end", onEnd);
      response.off("close", onClose);
      response.off("error", onClose);
      resolve(result);
    };
    const onData = (chunk: Buffer) => {
      response.pause();
      settle({ kind: "chunk", chunk });
    };
    const onEnd = () => settle({ kind: "end" });
    const onClose = () => settle({ kind: "broken" });
    response.on("data", onData);
    response.once("end", onEnd);
    response.once("close", onClose);
    response.once("error", onClose);
  });
}

/** 开口之后边收边发，顺带读出回复里的缓存命中 token 数（粘性要用）。 */
function relay(input: {
  response: IncomingMessage;
  res: Response;
  first: Buffer;
}): Promise<AnswerEnd> {
  const { response, res } = input;
  const usage = new CacheReadTap();
  usage.feed(input.first);
  res.write(input.first);
  let agentGone = false;
  res.once("close", () => {
    if (!res.writableFinished) agentGone = true;
  });
  return new Promise((resolve) => {
    response.on("data", (chunk: Buffer) => usage.feed(chunk));
    response.once("end", () => resolve({ kind: "complete", cacheRead: usage.cacheRead }));
    const broke = (error?: Error) => {
      // 上游已经收完：Agent 这时离开也算答完了（end 可能因为没人读而不再发出）。
      if (response.complete) {
        resolve({ kind: "complete", cacheRead: usage.cacheRead });
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

/**
 * 从回复里读缓存命中的 token 数：Anthropic 的 cache_read_input_tokens，OpenAI 的 cached_tokens。
 * 流式与非流式都按文字扫，跨段的数字靠留下上一段的尾巴接上；取最大的一个。
 */
class CacheReadTap {
  cacheRead = 0;
  private tail = "";

  feed(chunk: Buffer): void {
    const text = this.tail + chunk.toString("utf8");
    for (const match of text.matchAll(/"(?:cache_read_input_tokens|cached_tokens)"\s*:\s*(\d+)/g)) {
      this.cacheRead = Math.max(this.cacheRead, Number(match[1]));
    }
    this.tail = text.slice(-64);
  }
}

async function sendUpstream(input: {
  res: Response;
  url: URL;
  headers: Record<string, string | string[]>;
  body: Buffer;
  headerTimeoutMs: number;
}): Promise<UpstreamOutcome> {
  const transport = input.url.protocol === "https:" ? https : http;
  const upstream = transport.request(input.url, {
    method: "POST",
    headers: { ...input.headers, "content-length": String(input.body.length) },
  });
  const answered = new Promise<IncomingMessage>((resolve, reject) => {
    upstream.once("response", resolve);
    upstream.once("error", reject);
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
  if (outcome.kind === "timeout") upstream.destroy();
  return outcome;
}

/** 只替换顶层 model 的值，其余字节不动（键序、空白、cache_control 都原样）。 */
function replaceModel(text: string, model: string): string {
  return applyEdits(text, modify(text, ["model"], model, {}));
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

function readUpstreamError(text: string): Pick<AgentError, "type" | "code"> {
  const body = parseJson(text);
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  if (!error) return {};
  return {
    ...(typeof error.type === "string" ? { type: error.type } : {}),
    ...(typeof error.code === "string" || typeof error.code === "number"
      ? { code: error.code }
      : {}),
  };
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

function readLimited(stream: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = () => resolve(Buffer.concat(chunks).toString("utf8"));
    stream.on("data", (chunk: Buffer) => {
      if (size >= limit) return;
      chunks.push(chunk.subarray(0, limit - size));
      size += chunk.length;
      if (size >= limit) {
        stream.destroy();
        finish();
      }
    });
    stream.on("end", finish);
    stream.on("error", finish);
    stream.on("aborted", finish);
  });
}
