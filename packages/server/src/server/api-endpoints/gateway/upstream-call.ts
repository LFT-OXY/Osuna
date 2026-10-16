import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import https from "node:https";
import type { Response } from "express";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { describeNetworkError, extractErrorDetail, isRecord, parseJson } from "../upstream-http.js";
import type { AgentError } from "./agent-errors.js";

/*
 * 向一家接口发出请求、等它开口：直通与翻译共用。上游开口（响应头加第一段回复）之前的失败
 * 不写给 Agent，交回中转站决定换不换家；开口之后怎么转给 Agent 由调用方决定。
 * 用 node:http 而不是 fetch：fetch 会替我们解压、把等响应头的时间限死在 5 分钟。
 */

// 只为排查：回复是哪家接口答的。值用标识，因为接口名可能含中文，放不进响应头。
export const ANSWERED_BY_HEADER = "x-osuna-api-endpoint";

const MAX_ERROR_BODY_BYTES = 1024 * 1024;

// Anthropic 地址按 Claude Code 的规则拼 /v1/messages；OpenAI 两种地址按 SDK 的规则以 /v1 结尾。
const UPSTREAM_PATHS: Record<ApiEndpointRequestFormat, string> = {
  anthropic_messages: "/v1/messages",
  openai_chat: "/chat/completions",
  openai_responses: "/responses",
};

export function upstreamUrl(input: {
  baseUrl: string;
  format: ApiEndpointRequestFormat;
  // 接在格式路径后面，如 count_tokens 的 `/count_tokens`。
  suffix?: string;
  query?: string;
}): URL {
  const base = input.baseUrl.trim().replace(/\/+$/, "");
  return new URL(`${base}${UPSTREAM_PATHS[input.format]}${input.suffix ?? ""}${input.query ?? ""}`);
}

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

/** 上游开了口：2xx 响应头到了，第一段回复也到了（或者回复是空的）。 */
export interface OpenedUpstream {
  kind: "opened";
  response: IncomingMessage;
  status: number;
  first: Buffer | null;
}

type UpstreamOutcome =
  | { kind: "response"; response: IncomingMessage }
  | { kind: "timeout" }
  | { kind: "failed"; error: unknown };

type FirstChunk = { kind: "chunk"; chunk: Buffer } | { kind: "end" } | { kind: "broken" };

export async function openUpstream(input: {
  res: Response;
  url: URL;
  headers: Record<string, string | string[]>;
  body: Buffer;
  apiKey: string;
  headerTimeoutMs: number;
}): Promise<OpenedUpstream | FailedAttempt | { kind: "gone" }> {
  const { res, url, apiKey } = input;
  const outcome = await sendUpstream(input);
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
    const text = await readLimited({ stream: response, first: null });
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
  return { kind: "opened", response, status, first: first.kind === "chunk" ? first.chunk : null };
}

/** 上游的回复是事件流：响应头这样说，或回复以 data: / event: / 注释行开头。 */
export function isEventStream(response: IncomingMessage, first: Buffer | null): boolean {
  if (String(response.headers["content-type"] ?? "").includes("text/event-stream")) return true;
  return first !== null && /^\s*(data:|event:|:)/.test(first.toString("utf8", 0, 64));
}

/** 中转站自己判的失败（超时、连不上、开口前断开）：没有上游错误体，判错就读这段描述。 */
export function failedBySelf(input: {
  status: number;
  detail: string;
  timedOut: boolean;
}): FailedAttempt {
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

/** 读完（最多 1 MB）上游的回复原文：错误体，或没按要求流式回复的整份回复。 */
export function readLimited(input: {
  stream: IncomingMessage;
  // 开口时已经读到的第一段。
  first: Buffer | null;
}): Promise<string> {
  const { stream, first } = input;
  return new Promise((resolve) => {
    const chunks: Buffer[] = first ? [first] : [];
    let size = first?.length ?? 0;
    const finish = () => resolve(Buffer.concat(chunks).toString("utf8"));
    stream.on("data", (chunk: Buffer) => {
      if (size >= MAX_ERROR_BODY_BYTES) return;
      chunks.push(chunk.subarray(0, MAX_ERROR_BODY_BYTES - size));
      size += chunk.length;
      if (size >= MAX_ERROR_BODY_BYTES) {
        stream.destroy();
        finish();
      }
    });
    stream.on("end", finish);
    stream.on("error", finish);
    stream.on("aborted", finish);
    stream.resume();
  });
}
