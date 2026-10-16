// 保活之后在流里报错移植自 magpie（https://github.com/yetone/magpie，internal/gateway/gateway.go 的 streamFailure）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { Response } from "express";
import { sseEvent } from "./translation/sse.js";

/*
 * 中转站给 Agent 的报错一律按 Agent 自己的协议包装，CLI 才会把文字显示在对话里：
 * Anthropic 是 {"type":"error","error":{type,message}}，OpenAI 是 {"error":{message,type,code,param}}。
 * 保活已经回了 200 与事件流的响应头时，状态码说不出了，改发流里的错误事件（magpie 的 streamFailure）：
 * Claude Code 收到 api_error（它会改发不流式的请求），Codex 收到 response.failed 加 server_error（它会重问整轮，
 * 原因带到最终报错里）。
 */

export type AgentWire = "anthropic" | "openai";

export interface AgentError {
  status: number;
  message: string;
  // 上游自己写的错误类型与代码；没有时按状态码取。
  type?: string;
  code?: string | number | null;
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
  const { res, wire, error } = input;
  if (res.headersSent) {
    sendStreamError({ res, wire, message: error.message });
    return;
  }
  const type = error.type ?? errorTypeForStatus(error.status);
  const body =
    wire === "anthropic"
      ? { type: "error", error: { type, message: error.message } }
      : { error: { message: error.message, type, code: error.code ?? null, param: null } };
  if (input.headers) res.set(input.headers);
  res.status(error.status).json(body);
}

function sendStreamError(input: { res: Response; wire: AgentWire; message: string }): void {
  const { message } = input;
  const event =
    input.wire === "anthropic"
      ? { type: "error", error: { type: "api_error", message } }
      : {
          type: "response.failed",
          response: {
            object: "response",
            status: "failed",
            error: { code: "server_error", message },
          },
        };
  input.res.end(sseEvent(event.type, event));
}
