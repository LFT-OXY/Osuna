// 开口后断流移植自 magpie（https://github.com/yetone/magpie，internal/gateway/upstream.go 的 replyEnds、continuation.go 的 errEndedShort，
// gateway.go 的 cutMidReply、streamFailure、saysPassing 与直通回复里的 apart）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { describeNetworkError } from "../upstream-http.js";
import { streamErrorEvent, type AgentWire } from "./agent-errors.js";
import type { StreamEvent } from "./translation/ir.js";

/*
 * 开口之后上游断了：连接中断，或流读完了却没说完。直通与翻译都不再假装说完、也不掐断 Agent 的连接，
 * 而是在流尾先空一行，再补一个 Agent 协议里的错误事件（Claude Code 是 api_error，Codex 是 response.failed），
 * 写明哪家、什么原因，后面加上「(502: you can retry your request)」，然后正常结束响应。
 */

// 说完之前就结束了的流（magpie 的 errEndedShort）。
export const ENDED_SHORT = "the reply ended before it was complete";

// 断流交给 Agent 时说的状态码。
const BROKEN_STATUS = 502;

/** 连接在回复中途断开的原因（magpie 的 cutMidReply）。 */
export function connectionLost(input: { error: Error | undefined }): string {
  let cause = "aborted";
  if (input.error !== undefined) cause = describeNetworkError(input.error);
  return `connection lost mid-reply (${cause})`;
}

/** 回复的收尾：上游说了结束原因、发了结束标记、报了错。 */
export interface ReplyEnding {
  stopped: boolean;
  ended: boolean;
  failed: boolean;
}

/**
 * 读完了的流没说完（magpie 的 replyEnds）：Anthropic 既没有 stop_reason 也没有 message_stop，
 * Responses 没有 completed、incomplete 之类的结尾；报了错的不算。Chat 不带 [DONE] 也可以是完整的，从不算。
 */
export function endedShort(input: {
  format: ApiEndpointRequestFormat;
  ending: ReplyEnding;
}): boolean {
  if (input.format === "openai_chat") return false;
  const { stopped, ended, failed } = input.ending;
  const closed = stopped || ended || failed;
  return !closed;
}

/** 边解码边记下回复怎么收的尾。 */
export class ReplyEndingWatch implements ReplyEnding {
  stopped = false;
  ended = false;
  failed = false;

  add(event: StreamEvent): void {
    if (event.kind === "stop") this.stopped = true;
    else if (event.kind === "done") this.ended = true;
    else if (event.kind === "error") this.failed = true;
  }
}

/** 断流时交给 Agent 的话：「<接口名>: <原因> (502: you can retry your request)」（magpie 的 saysPassing）。 */
export function brokenMessage(input: { endpointName: string; reason: string }): string {
  return `${input.endpointName}: ${input.reason} (${BROKEN_STATUS}: you can retry your request)`;
}

/**
 * 直通断流时补在流尾的原文：先空一行，上游停在一行中间时先把这行收尾（magpie 的 apart），
 * 还没写完的那个事件照原样留着，错误自成一个事件。
 */
export function brokenTail(input: {
  wire: AgentWire;
  endpointName: string;
  reason: string;
  // 已经写给 Agent 的最后一个字节是换行。
  atLine: boolean;
}): string {
  const apart = input.atLine ? "\n" : "\n\n";
  const message = brokenMessage(input);
  return apart + streamErrorEvent({ wire: input.wire, message, code: "server_error" });
}
