import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { Request, Response } from "express";
import { applyEdits, modify } from "jsonc-parser";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { StoredApiEndpoint } from "../store.js";
import { describeNetworkError } from "../upstream-http.js";
import { sendAgentError, type AgentWire } from "./agent-errors.js";
import {
  ANSWERED_BY_HEADER,
  openUpstream,
  upstreamUrl,
  type AnswerEnd,
  type AttemptOutcome,
  type FailedAttempt,
} from "./upstream-call.js";

/*
 * 同协议直通的一次尝试：请求体除模型名外逐字节原样发给上游，认证头换成这家的真实 key。
 * 开口之后边收边发，上游断流就断开 Agent 的连接，由 CLI 自己报错。
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
}): Promise<AttemptOutcome> {
  const { res, apiKey } = input;
  const { originalUrl } = input.req;
  const url = upstreamUrl({
    baseUrl: input.baseUrl,
    format: input.format,
    suffix: input.pathSuffix,
    query: originalUrl.includes("?") ? originalUrl.slice(originalUrl.indexOf("?")) : "",
  });
  const body =
    input.upstreamModel === input.requestedModel
      ? input.body
      : Buffer.from(replaceModel(input.body.toString("utf8"), input.upstreamModel));

  const opened = await openUpstream({
    res,
    url,
    headers: upstreamHeaders({ headers: input.req.headers, apiKey, format: input.format }),
    body,
    apiKey,
    headerTimeoutMs: input.headerTimeoutMs,
  });
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
  return { kind: "answered", finished: relay({ response, res, first }) };
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
