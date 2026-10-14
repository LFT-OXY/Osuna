import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import https from "node:https";
import type { Request, Response } from "express";
import { applyEdits, modify } from "jsonc-parser";
import type pino from "pino";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { StoredApiEndpoint } from "../store.js";
import { describeNetworkError, extractErrorDetail, isRecord, parseJson } from "../upstream-http.js";
import { sendAgentError, type AgentError, type AgentWire } from "./agent-errors.js";

/*
 * 同协议直通：请求体除模型名外逐字节原样发给上游，认证头换成这家的真实 key；
 * 回复边收边发。上游报错时状态码照抄，文字包成「<接口名>: <上游原文>」，Retry-After 与重置时间头带回。
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

type UpstreamOutcome =
  | { kind: "response"; response: IncomingMessage }
  | { kind: "timeout" }
  | { kind: "failed"; error: unknown };

export async function forwardToEndpoint(input: {
  req: Request;
  res: Response;
  wire: AgentWire;
  format: ApiEndpointRequestFormat;
  endpoint: StoredApiEndpoint;
  baseUrl: string;
  apiKey: string;
  body: Buffer;
  requestedModel: string;
  upstreamModel: string;
  headerTimeoutMs: number;
  logger: pino.Logger;
}): Promise<void> {
  const { res, wire, endpoint, apiKey } = input;
  const answeredBy = { [ANSWERED_BY_HEADER]: endpoint.slug };
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
  if (res.destroyed) return;

  const fail = (status: number, detail: string) => {
    input.logger.warn({ endpoint: endpoint.slug, status }, "API endpoint gateway request failed");
    sendAgentError({
      res,
      wire,
      error: { status, message: `${endpoint.name}: ${detail.replaceAll(apiKey, "***")}` },
      headers: answeredBy,
    });
  };
  if (outcome.kind === "timeout") {
    fail(504, `no response headers within ${input.headerTimeoutMs / 1000}s`);
    return;
  }
  if (outcome.kind === "failed") {
    fail(502, `${url.origin}: ${describeNetworkError(outcome.error)}`);
    return;
  }

  const { response } = outcome;
  const status = response.statusCode ?? 502;
  if (status >= 400) {
    const text = await readLimited(response, MAX_ERROR_BODY_BYTES);
    const upstreamError = readUpstreamError(text);
    input.logger.warn({ endpoint: endpoint.slug, status }, "API endpoint returned an error");
    sendAgentError({
      res,
      wire,
      error: {
        status,
        message: `${endpoint.name}: ${extractErrorDetail(text, apiKey) || `HTTP ${status}`}`,
        ...upstreamError,
      },
      headers: { ...retryHeaders(response.headers), ...answeredBy },
    });
    return;
  }

  res.writeHead(status, { ...responseHeaders(response.headers), ...answeredBy });
  response.pipe(res);
  // 首字之后上游断流：照样断开 Agent 的连接，由 CLI 自己报错。
  response.on("aborted", () => res.destroy());
  response.on("error", () => res.destroy());
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
  // 开口之后的连接错误由 response 的 aborted / error 处理；这里只为不让无人接的 error 打崩进程。
  upstream.on("error", () => {});
  // Agent 先断开（用户中断）：不再等上游。
  input.res.on("close", () => {
    if (!input.res.writableFinished) upstream.destroy();
  });
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
