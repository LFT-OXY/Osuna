// ChatGPT 自带模型的请求记账照 magpie（https://github.com/yetone/magpie，internal/gateway/codex_backend.go 的 codexUpstreamOn：
// 只记 /responses；问 ChatGPT 的那一次是 Tries[0]；流式与否看回复的 Content-Type、没说时看请求的 stream；
// 失败记状态与原话；回复中途断了照收到的记，不算失败）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingMessage } from "node:http";
import type { Response } from "express";
import { isRecord, parseJson } from "../upstream-http.js";
import { endpointFailure } from "./failure.js";
import type { LedgerAttemptEnd, LedgerCall } from "./ledger-call.js";
import { ReplyTap } from "./reply-tap.js";

// 失败回复最多读这么多来找原话。
const MAX_ERROR_BYTES = 8 * 1024;

/**
 * 转给 ChatGPT 的一次对话（ADR 0010）在账本里的那一行：回复边转边读出编号、用量与首字，一个字节不改；
 * 接口记为官方，问 ChatGPT 的那一次记成一次尝试。ChatGPT 报错或连不上记失败（回复之前 Codex 就走了也算连不上）；
 * 回复开了头之后不管是断了还是 Codex 走了，都照已收到的记（magpie 同样）。每个请求只记一行。
 */
export class ChatGptLedgerWatch {
  private isDone = false;
  private reply: { tap: ReplyTap } | null = null;

  constructor(
    private readonly input: {
      call: LedgerCall;
      // 请求里的模型名，记在那次尝试上。
      model: string;
      // 中转站收到请求的时刻。
      since: number;
      // 请求里要了流式。
      streams: boolean;
    },
  ) {}

  /** ChatGPT 回了：失败的读出原话，成功的边转边读；回复结束（或断了）时记账。 */
  replied(reply: IncomingMessage): void {
    const status = reply.statusCode ?? 502;
    if (status >= 400) {
      this.readFailure(reply, status);
      return;
    }
    const contentType = String(reply.headers["content-type"] ?? "");
    const stream =
      contentType.includes("event-stream") || (contentType === "" && this.input.streams);
    const tap = new ReplyTap({ format: "openai_responses", stream });
    this.reply = { tap };
    reply.on("data", (chunk: Buffer) => tap.feed(chunk));
    const answered = () => this.answered();
    reply.once("end", answered);
    reply.once("aborted", answered);
    reply.once("error", answered);
  }

  /** 没收到 ChatGPT 的回复就交给 Codex 的错误（连不上、API key 被拒）；message 是交给 Codex 的说法。 */
  failed(input: { status: number; message: string }): void {
    const { status, message } = input;
    this.done(() => {
      this.attempt({
        result: "failed",
        failure: endpointFailure(status, message),
        reason: message,
        cooldownUntil: null,
      });
      this.input.call.failed(message);
    });
  }

  /**
   * 从请求一到就看着：回复开头之后 Codex 走了，照已收到的记。开头之前走的不在这里记：转发那边当作
   * 连不上 ChatGPT 交给 failed（magpie 同样记成连不上）。
   */
  watchGone(res: Response): void {
    res.once("close", () => {
      if (!res.writableFinished) this.answered();
    });
  }

  private readFailure(reply: IncomingMessage, status: number): void {
    const chunks: Buffer[] = [];
    let bytes = 0;
    reply.on("data", (chunk: Buffer) => {
      if (bytes >= MAX_ERROR_BYTES) return;
      chunks.push(chunk);
      bytes += chunk.length;
    });
    reply.once("end", () => {
      // ChatGPT 的错误体原样转给了 Codex：它看到的就是里面的原话。
      const said = errorOf(status, Buffer.concat(chunks).toString("utf8"));
      this.failed({ status, message: said });
    });
  }

  private answered(): void {
    const { reply } = this;
    if (reply === null) return;
    this.done(() => {
      const tapped = reply.tap.end();
      this.attempt({ result: "answered", failure: null, reason: null, cooldownUntil: null });
      this.input.call.answeredByOfficial({
        id: tapped.id,
        usage: tapped.usage,
        stop: tapped.stop,
        ...reply.tap.times(),
      });
    });
  }

  private attempt(end: LedgerAttemptEnd): void {
    const { call, model, since } = this.input;
    call.officialAttempt({ model, startedAt: since, end });
  }

  private done(note: () => void): void {
    if (this.isDone) return;
    this.isDone = true;
    note();
    this.input.call.finish();
  }
}

/** 失败回复里的原话：OpenAI 写法的 error.message、ChatGPT 的 detail；都没有时是状态码。 */
function errorOf(status: number, text: string): string {
  const parsed = parseJson(text);
  if (isRecord(parsed)) {
    const error = parsed.error;
    if (isRecord(error) && typeof error.message === "string") return error.message;
    if (typeof parsed.detail === "string") return parsed.detail;
  }
  return `HTTP ${status}`;
}
