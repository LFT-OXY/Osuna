// 保活之后在流里报错移植自 magpie（https://github.com/yetone/magpie，internal/gateway/gateway.go 的 streamFailure、streamError），
// 对话太长按 CLI 自己的说法交出照 writeErrorSaid，全都拒答时的 400 照 fallback.go 的 refusedStatus
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { Response } from "express";
import { readsTooLong } from "./failure.js";
import { REFUSED_STATUS } from "./safety-filter.js";
import { sseEvent } from "./translation/sse.js";

/*
 * 中转站给 Agent 的报错一律按 Agent 自己的协议包装，CLI 才会把文字显示在对话里：
 * Anthropic 是 {"type":"error","error":{type,message}}，OpenAI（Responses 与 Chat）是 {"error":{message,type,code,param}}。
 * 保活已经回了 200 与事件流的响应头时，状态码说不出了，改发流里的错误事件（magpie 的 streamFailure）：
 * Claude Code 收到 api_error（它会改发不流式的请求），Codex 收到 response.failed 加 server_error（它会重问整轮，
 * 原因带到最终报错里），Chat 的客户端（Pi、OMP）收到没有事件名的 {"error":{message,type:"api_error"}}。
 * 认得出是对话太长的，照 CLI 自己的 API 的说法交出，CLI 才会压缩对话再问（magpie writeErrorSaid、streamError）：
 * 400 invalid_request_error 带 context_length_exceeded，Anthropic 一侧文字里没有「prompt is too long」就补在前面；
 * 流里的错误事件带 context_length_exceeded 代码。
 */

const TOO_LONG_CODE = "context_length_exceeded";

/*
 * 全都拒答时给 Codex 的错误码：invalid_prompt。Codex 把它读成 InvalidPrompt，不重问、把 message 原样显示
 * （openai/codex@ce0323f2 codex-rs/codex-api/src/sse/responses_error.rs:82 读 response.failed，
 * codex-api/src/api_bridge.rs:150-172 读 HTTP 400，protocol/src/error.rs:155 显示 message、:422 不给重试间隔）。
 * server_error 会让它整轮重问最多 5 次、每次都被拒；bio_policy、cyber_policy 同样终止，但会被当成 OpenAI
 * 自己的那两种政策显示，magpie 也把说违反用量政策的 invalid_prompt 认作拒答（fallback.go:2943 policyRefusal）。
 * magpie 自己保活之后发的是 server_error（gateway.go:6366 streamError 经 responses.go:1773 的编码），这里不照搬。
 */
const REFUSED_CODE = "invalid_prompt";

/** 流里错误事件的错误码：一般的失败、对话太长、拒答。 */
export type StreamErrorCode = "server_error" | typeof TOO_LONG_CODE | typeof REFUSED_CODE;

// openai 是 Responses（Codex），chat 是 OpenAI Chat（Pi、OMP）。
export type AgentWire = "anthropic" | "openai" | "chat";

export interface AgentError {
  status: number;
  message: string;
  // 上游自己写的错误类型、代码与参数；没有时按状态码取类型，代码与参数为 null。
  type?: string;
  code?: string | number | null;
  param?: string | null;
}

/** Anthropic 文档里的错误类型；OpenAI 侧沿用同一套名字。 */
function errorTypeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "invalid_request_error";
    case 401:
      return "authentication_error";
    case 403:
      return "permission_error";
    case 404:
      return "not_found_error";
    case 413:
      return "request_too_large";
    case 429:
      return "rate_limit_error";
    case 529:
      return "overloaded_error";
    default:
      return status >= 500 ? "api_error" : "invalid_request_error";
  }
}

export function sendAgentError(input: {
  res: Response;
  wire: AgentWire;
  error: AgentError;
  headers?: Record<string, string | string[]>;
}): void {
  const { res, wire } = input;
  const isTooLong = readsTooLong(input.error.status, input.error.message);
  if (res.headersSent) {
    const code = isTooLong ? TOO_LONG_CODE : "server_error";
    sendStreamError({ res, wire, message: input.error.message, code });
    return;
  }
  let { error } = input;
  if (isTooLong) error = tooLongError({ wire, message: error.message });
  const type = error.type ?? errorTypeForStatus(error.status);
  const code = error.code ?? null;
  const param = error.param ?? null;
  const body =
    wire === "anthropic"
      ? { type: "error", error: { type, message: error.message } }
      : { error: { message: error.message, type, code, param } };
  if (input.headers) res.set(input.headers);
  res.status(error.status).json(body);
}

/** 对话太长照 CLI 自己的说法：400、invalid_request_error、context_length_exceeded。 */
function tooLongError(input: { wire: AgentWire; message: string }): AgentError {
  const { message } = input;
  const saysPromptTooLong = message.toLowerCase().includes("prompt is too long");
  const needsPrefix = input.wire === "anthropic" && !saysPromptTooLong;
  const told = { status: 400, message, type: "invalid_request_error", code: TOO_LONG_CODE };
  if (needsPrefix) told.message = `prompt is too long: ${message}`;
  return told;
}

/**
 * 全都拒答：告诉 Agent 这个请求被拒了、原样再发也一样（magpie 的 refusedStatus），而不是一份它会再三重问的空回答。
 * 400 invalid_request_error；Codex 一侧带 invalid_prompt，保活之后在流里发 response.failed 也用它。
 */
export function sendRefusal(input: {
  res: Response;
  wire: AgentWire;
  message: string;
  headers: Record<string, string>;
}): void {
  const { res, wire, message } = input;
  if (res.headersSent) {
    sendStreamError({ res, wire, message, code: REFUSED_CODE });
    return;
  }
  // Chat 一侧照 magpie 不带代码。
  const code = wire === "openai" ? REFUSED_CODE : null;
  const error = { status: REFUSED_STATUS, message, code };
  sendAgentError({ res, wire, error, headers: input.headers });
}

function sendStreamError(input: {
  res: Response;
  wire: AgentWire;
  message: string;
  code: StreamErrorCode;
}): void {
  input.res.end(streamErrorEvent(input));
}

/**
 * 流里错误事件的原文：Anthropic 是 error 事件，OpenAI 是 response.failed，Chat 是只有 data 的 error
 * （magpie 的 streamFailure 与 streamError 经 chatEncoder：只有对话太长时带代码）。
 */
export function streamErrorEvent(input: {
  wire: AgentWire;
  message: string;
  code: StreamErrorCode;
}): string {
  const { message, code } = input;
  if (input.wire === "chat") {
    const failed = { message, type: "api_error", ...(code === TOO_LONG_CODE ? { code } : {}) };
    return sseEvent(null, { error: failed });
  }
  const event =
    input.wire === "anthropic"
      ? { type: "error", error: anthropicStreamError({ message, code }) }
      : {
          type: "response.failed",
          response: {
            object: "response",
            status: "failed",
            error: { code, message },
          },
        };
  return sseEvent(event.type, event);
}

/** Anthropic 流里的错误：api_error；对话太长时带上 context_length_exceeded 代码（magpie 同样）。 */
function anthropicStreamError(input: {
  message: string;
  code: StreamErrorCode;
}): AnthropicStreamError {
  const failed: AnthropicStreamError = { type: "api_error", message: input.message };
  if (input.code === TOO_LONG_CODE) failed.code = TOO_LONG_CODE;
  return failed;
}

interface AnthropicStreamError {
  type: "api_error";
  message: string;
  code?: typeof TOO_LONG_CODE;
}
