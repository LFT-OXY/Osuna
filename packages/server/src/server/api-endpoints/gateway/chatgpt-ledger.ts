// ChatGPT 自带模型的请求记账照 magpie（https://github.com/yetone/magpie，internal/gateway/codex_backend.go 的 codexUpstreamOn：
// 只记 /responses，流式与否看回复的 Content-Type、没说时看请求的 stream，失败记状态与原话）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingMessage } from "node:http";
import type { Response } from "express";
import { isRecord, parseJson } from "../upstream-http.js";
import type { LedgerCall } from "./ledger-call.js";
import { ReplyTap } from "./reply-tap.js";

// 失败回复最多读这么多来找原话。
const MAX_ERROR_BYTES = 8 * 1024;

/**
 * 转给 ChatGPT 的一次对话（ADR 0010）在账本里的那一行：回复边转边读出编号、用量与首字，一个字节不改；
 * 接口记为官方。ChatGPT 报错或连不上记失败，Codex 先走记取消。每个请求只记一行。
 */
export class ChatGptLedgerWatch {
  private isDone = false;

  constructor(
    private readonly input: {
      call: LedgerCall;
      // 请求里要了流式。
      streams: boolean;
    },
  ) {}

  /** ChatGPT 回了：回复转完（或 Codex 先走）时记账。 */
  replied(reply: IncomingMessage): void {
    const status = reply.statusCode ?? 502;
    const contentType = String(reply.headers["content-type"] ?? "");
    const stream =
      contentType.includes("event-stream") || (contentType === "" && this.input.streams);
    const tap = new ReplyTap({ format: "openai_responses", stream });
    const failed: Buffer[] = [];
    let failedBytes = 0;
    reply.on("data", (chunk: Buffer) => {
      if (status < 400) {
        tap.feed(chunk);
        return;
      }
      if (failedBytes >= MAX_ERROR_BYTES) return;
      failed.push(chunk);
      failedBytes += chunk.length;
    });
    reply.once("end", () => {
      if (status >= 400) {
        this.failed(`ChatGPT: ${errorOf(status, Buffer.concat(failed).toString("utf8"))}`);
        return;
      }
      const tapped = tap.end();
      this.done(() =>
        this.input.call.answeredByOfficial({
          id: tapped.id,
          usage: tapped.usage,
          stop: tapped.stop,
          firstContentAt: tapped.firstContentAt,
          firstTextAt: tapped.firstTextAt,
        }),
      );
    });
  }

  /** 没收到 ChatGPT 的回复就交给 Codex 的错误（连不上、API key 被拒）。 */
  failed(message: string): void {
    this.done(() => this.input.call.failedWithout(message));
  }

  /** 从请求一到就看着：Codex 在回复转完之前走了记取消。 */
  watchGone(res: Response): void {
    res.once("close", () => {
      if (!res.writableFinished) this.done(() => this.input.call.cancelled());
    });
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
