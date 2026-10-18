// claude.ai 登录的 Claude Code 收到的报错移植自 magpie（https://github.com/yetone/magpie，internal/gateway/claude_signin.go 的
// claudeSignIn、keepsSignIn、signInWriter 与 refusedMessage）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingHttpHeaders } from "node:http";
import type { Response } from "express";
import { isRecord, parseJson } from "../upstream-http.js";
import { ANSWERED_BY_HEADER } from "./upstream-call.js";

/*
 * 用 claude.ai 登录、地址指向中转站、没设口令的 Claude Code（ADR 0012「保留 claude.ai 登录」）把自己的登录令牌
 * 当口令发来（Authorization: Bearer sk-ant-oat…），中转站从不转发它。Claude Code 把 401 读成登录被拒：每次重试前
 * 续一次登录（一个请求重试十次），然后要用户 /login；说 OAuth 令牌已吊销的 403 也一样；任何状态的报错里提到
 * x-api-key，它都显示成「Not logged in · Please run /login」（Claude Code 2.1.293，magpie 核实）。
 * 中转站回给这种请求的报错从来不是那份登录的事（是接口拒了 Osuna 给它的 key），所以 401 与吊销的 403 改成 502、
 * api_error，写明哪家接口；其余报错保持状态码，只把 x-api-key 说成 API key；开口 200 之后流里的错误事件同样。
 * 用量与日志里记的还是接口的原状态与原话（在这之前就记下了）。
 */

const SIGN_IN_PREFIX = "sk-ant-oat";
const REVOKED_TEXT = "OAuth token has been revoked";
const X_API_KEY = /x-api-key/gi;
// 只用来问有没有：带 g 的正则 test 会记住上次的位置。
const HAS_X_API_KEY = /x-api-key/i;
const STREAM_ERROR = "event: error\n";
// 报错开头「接口名: 」里接口名最长这么多字符（magpie refusedMessage）。
const NAME_MOST_CHARS = 64;

/** 请求的口令是 Claude 的登录：Anthropic 的 OAuth 访问令牌。 */
export function isClaudeSignIn(headers: IncomingHttpHeaders): boolean {
  const authorization = (headers.authorization ?? "").trim();
  const isBearer = authorization.slice(0, 7).toLowerCase() === "bearer ";
  return isBearer && authorization.slice(7).trim().startsWith(SIGN_IN_PREFIX);
}

type Chunk = string | Uint8Array;

/** 写给 Agent 的一段正文；回调之类的其他参数不是正文。 */
function chunkOf(value: unknown): Chunk | null {
  const isChunk = typeof value === "string" || value instanceof Uint8Array;
  return isChunk ? value : null;
}

/** 响应头的值能交给 setHeader 的样子；别的不要。 */
function headerValueOf(value: unknown): string | number | string[] | null {
  if (typeof value === "string" || typeof value === "number") return value;
  const isTextList = Array.isArray(value) && value.every((item) => typeof item === "string");
  return isTextList ? value : null;
}

/** writeHead 的参数里带的响应头（对象写法；Osuna 不用数组写法）。 */
function headersIn(args: unknown[]): Record<string, unknown> {
  return args.find(isRecord) ?? {};
}

/**
 * 带 Claude 登录的请求（isClaudeSignIn），它的回复换成 magpie signInWriter 的写法：报错的状态码先扣着，
 * 等看到正文再决定怎么说。中转站的报错都是一次写完整份，流里的错误事件也是一次一个。
 * 换的是这个回复自己的 writeHead / write / end，原来的那几个经 Reflect.apply 照常调用。
 */
export function keepClaudeSignIn(res: Response): void {
  const originalWriteHead = res.writeHead;
  const originalWrite = res.write;
  const originalEnd = res.end;
  const sendHead = (status: number): void => {
    Reflect.apply(originalWriteHead, res, [status]);
  };
  const sendChunk = (chunk: Chunk): boolean => Boolean(Reflect.apply(originalWrite, res, [chunk]));
  const finish = (chunk: Chunk | null): Response => {
    const args = chunk === null ? [] : [chunk];
    Reflect.apply(originalEnd, res, args);
    return res;
  };
  // 扣着的报错状态码；0 为没有。
  let held = 0;
  // 报错已经改成 502 发出：后面的正文都丢掉。
  let told = false;

  const heldStatus = (): number => {
    if (held !== 0) return held;
    const isErrorNotSent = !res.headersSent && res.statusCode >= 400;
    if (isErrorNotSent) return res.statusCode;
    return 0;
  };
  // 扣着的状态码到底没有正文：401 照样改成 502，其余原样。
  const release = (status: number): void => {
    held = 0;
    sendHead(status === 401 ? 502 : status);
  };
  // 看到报错正文：要改成 502 的交出新正文，其余保持状态码、只换掉 x-api-key。
  const answer = (status: number, chunk: Chunk): Chunk => {
    held = 0;
    const text = Buffer.from(chunk).toString("utf8");
    const isRevoked = status === 403 && text.includes(REVOKED_TEXT);
    const isSignInRefused = status === 401 || isRevoked;
    if (!isSignInRefused) {
      if (!HAS_X_API_KEY.test(text)) {
        sendHead(status);
        return chunk;
      }
      res.removeHeader("content-length");
      sendHead(status);
      return text.replace(X_API_KEY, "API key");
    }
    told = true;
    res.removeHeader("content-length");
    res.setHeader("content-type", "application/json");
    sendHead(502);
    const answeredBy = res.getHeader(ANSWERED_BY_HEADER);
    let endpoint = "";
    if (typeof answeredBy === "string") endpoint = answeredBy;
    const message = refusedMessage({ text, endpoint, status });
    return JSON.stringify({ type: "error", error: { type: "api_error", message } });
  };
  // 开口 200 之后流里的错误事件：x-api-key 说成 API key。
  const streamed = (chunk: Chunk): Chunk => {
    const text = Buffer.from(chunk).toString("utf8");
    const at = text.indexOf(STREAM_ERROR);
    if (at === -1) return chunk;
    const event = text.slice(at);
    if (!HAS_X_API_KEY.test(event)) return chunk;
    return text.slice(0, at) + event.replace(X_API_KEY, "API key");
  };
  // 不扣着状态码时照发；响应头已经发出时才可能是流里的错误事件。
  const passed = (chunk: Chunk): Chunk => {
    if (!res.headersSent) return chunk;
    return streamed(chunk);
  };

  // 报错的状态码与响应头先扣着（头放进 res，正文来了再一起发）；其余照常。
  res.writeHead = (status: number, ...rest: unknown[]): Response => {
    const isHeldError = !res.headersSent && status >= 400 && held === 0;
    if (!isHeldError) {
      Reflect.apply(originalWriteHead, res, [status, ...rest]);
      return res;
    }
    held = status;
    for (const [name, raw] of Object.entries(headersIn(rest))) {
      const value = headerValueOf(raw);
      if (value !== null) res.setHeader(name, value);
    }
    return res;
  };

  res.write = (data: unknown): boolean => {
    if (told) return true;
    const chunk = chunkOf(data);
    if (chunk === null || chunk.length === 0) return true;
    const status = heldStatus();
    if (status === 0) return sendChunk(passed(chunk));
    return sendChunk(answer(status, chunk));
  };

  res.end = (data?: unknown): Response => {
    if (told) return finish(null);
    const chunk = chunkOf(data);
    const isEmpty = chunk === null || chunk.length === 0;
    const status = heldStatus();
    if (status === 0) {
      if (isEmpty) return finish(null);
      return finish(passed(chunk));
    }
    if (isEmpty) {
      release(status);
      return finish(null);
    }
    return finish(answer(status, chunk));
  };
}

/**
 * 接口拒了 Osuna 给它的 key，说给 claude.ai 登录的 Claude Code 听：中转站的报错是「接口名: 原因」，
 * 拆出接口名（拆不出用回复头里的接口标识），原因里的 x-api-key 说成 API key。
 */
function refusedMessage(input: { text: string; endpoint: string; status: number }): string {
  const parsed = parseJson(input.text);
  const error = isRecord(parsed) ? parsed.error : null;
  const said = isRecord(error) ? error.message : null;
  let reason = "";
  if (typeof said === "string") reason = said.trim();
  let name = input.endpoint;
  const cut = reason.indexOf(": ");
  const isNamed = cut > 0 && cut <= NAME_MOST_CHARS && !/[\n{]/.test(reason.slice(0, cut));
  if (isNamed) {
    name = reason.slice(0, cut);
    reason = reason.slice(cut + 2).trim();
  }
  const told = `${name || "The API endpoint"} refused Osuna's credential (HTTP ${input.status})`;
  return reason === "" ? told : `${told}: ${reason.replace(X_API_KEY, "API key")}`;
}
