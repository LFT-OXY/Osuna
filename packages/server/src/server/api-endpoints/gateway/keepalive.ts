// 等开口时给 Agent 保活移植自 magpie（https://github.com/yetone/magpie，internal/gateway/fallback.go 的 keepAlive、keepQuiet，gateway.go 的 keepaliveEvery、keepaliveLongest；接着写时的保活照 continuation.go streamTranslated 的 enc.keepalive）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { Response } from "express";
import type { AgentWire } from "./agent-errors.js";
import { sseEvent } from "./translation/sse.js";

/*
 * 回复开口前给要流式的 Agent 保活：Claude Code 连自定义地址时 5 分钟没收到字节就断开重发，
 * Codex 5 分钟没收到带数据的事件也断开。请求进来满一个间隔还没开口，就先回 200 与事件流的响应头，
 * 之后每个间隔发一个协议自带的保活事件（Anthropic 的 ping；Responses 的 response.in_progress，
 * Codex 不认注释行；Chat 照 OpenAI 兼容服务发注释行，magpie chatEncoder.keepalive）。
 * 一家接口这么久毫无动静就不发，真卡死的请求交给 CLI 自己超时。
 * 开口后由回复接手，保活停止；响应头发出之后再失败，错误改在流里发（sendAgentError）。
 *
 * 不照搬 magpie 给 Codex 设的「累计最多扣 4 分钟」（agentQuietMost）：那是因为 magpie 用注释行保活，
 * Codex 不把它算作事件；这里发的是真事件，每次都重置 Codex 的计时。
 */

export const KEEPALIVE_EVERY_MS = 15 * 1000;
export const KEEPALIVE_QUIET_MOST_MS = 5 * 60 * 1000;

const KEEPALIVE_EVENTS: Record<AgentWire, string> = {
  anthropic: sseEvent("ping", { type: "ping" }),
  openai: sseEvent("response.in_progress", {
    type: "response.in_progress",
    response: { object: "response", status: "in_progress", output: [] },
  }),
  chat: ": keepalive\n\n",
};

export class AgentKeepAlive {
  private readonly res: Response;
  private readonly event: string;
  private readonly everyMs: number;
  private readonly quietMostMs: number;
  private timer: NodeJS.Timeout | null = null;
  // 上一次听到上游（发出请求、收到字节）的时刻。
  private heardAt = Date.now();

  constructor(input: {
    res: Response;
    wire: AgentWire;
    // 请求进来的时刻：第一次保活从这时算起。
    since: number;
    // Agent 没要流式时不保活。
    streams: boolean;
    everyMs: number;
    quietMostMs: number;
  }) {
    this.res = input.res;
    this.event = KEEPALIVE_EVENTS[input.wire];
    this.everyMs = input.everyMs;
    this.quietMostMs = input.quietMostMs;
    if (input.streams) {
      const waited = Date.now() - input.since;
      this.timer = setTimeout(() => this.tick(), Math.max(this.everyMs - waited, 0));
    }
  }

  /** 上游有动静：发出了请求，或收到了字节。 */
  heard(): void {
    this.heardAt = Date.now();
  }

  /** 开口后又要等（断了的回复等着接着写）：从现在起每个间隔再发一次保活事件，直到 stop。 */
  restart(): void {
    this.stop();
    this.heardAt = Date.now();
    this.timer = setTimeout(() => this.tick(), this.everyMs);
  }

  /** 回复开口或请求结束：不再保活。 */
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const { res } = this;
    if (res.destroyed || res.writableEnded) {
      this.stop();
      return;
    }
    if (Date.now() - this.heardAt < this.quietMostMs) {
      if (!res.headersSent) {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        });
      }
      res.write(this.event);
    }
    this.timer = setTimeout(() => this.tick(), this.everyMs);
  }
}
