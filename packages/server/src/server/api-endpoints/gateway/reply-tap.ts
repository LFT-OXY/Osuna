// 回复的读法（整份回复的上限、签名不算内容）移植自 magpie（https://github.com/yetone/magpie，internal/gateway/sniff.go，fallback.go 的 anthropicDeltaSays）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { StringDecoder } from "node:string_decoder";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { parseJson } from "../upstream-http.js";
import {
  addUsage,
  emptyUsage,
  type StopReason,
  type StreamEvent,
  type Usage,
} from "./translation/ir.js";
import { protocolOf, type StreamDecoder } from "./translation/protocols.js";
import { SseReader } from "./translation/sse.js";

/** 回复里出现过的内容。 */
export type ReplyContent = "text" | "thinking" | "tool_call";

/** 回复里读出来的东西。 */
export interface TappedReply {
  // 出现过的内容，按第一次出现的先后。
  content: ReplyContent[];
  // 上游说的结束原因；拒答是 filter。没说为 null。
  stop: StopReason | null;
  // 上游发了结束标记（StreamEvent 的 done）。
  ended: boolean;
  // raw 是报错那个事件的 data 原文（整份回复是整份原文），判错读它。
  error: { message: string; code: string | null; raw: string } | null;
  usage: Usage;
}

// 整份回复最多攒这么多来读（magpie sniff.go 的上限），再大的不读。
const MAX_WHOLE_REPLY_BYTES = 8 * 1024 * 1024;

type Reading =
  // 一个字可能被切在两段之间：utf8 接好再交给事件读取。
  | { kind: "stream"; events: SseReader; utf8: StringDecoder }
  | { kind: "whole"; chunks: Buffer[]; bytes: number }
  // 不再读：整份回复超过了上限，或回复已经读完。
  | { kind: "none" };

/**
 * 回复边收边读，一个字节也不改，交给翻译用的同一个解码器去认（开口与直通都用它）：
 * 流式回复一个事件一个事件读；整份回复（不流式）攒齐了，照它流出来时的事件读。
 */
export class ReplyTap {
  private readonly reply: TappedReply = {
    content: [],
    stop: null,
    ended: false,
    error: null,
    usage: emptyUsage(),
  };
  private readonly decoder: StreamDecoder;
  private reading: Reading;
  // 正在解码的那个事件的原文。
  private raw = "";

  constructor(input: { format: ApiEndpointRequestFormat; stream: boolean }) {
    this.decoder = protocolOf(input.format).decoder();
    if (input.stream) {
      const events = new SseReader((data) => {
        this.raw = data;
        this.decoder.decode(data, (event) => this.add(event));
      });
      this.reading = { kind: "stream", events, utf8: new StringDecoder("utf8") };
    } else {
      this.reading = { kind: "whole", chunks: [], bytes: 0 };
    }
  }

  feed(chunk: Buffer): void {
    const { reading } = this;
    if (reading.kind === "stream") {
      reading.events.feed(reading.utf8.write(chunk));
    } else if (reading.kind === "whole") {
      reading.bytes += chunk.length;
      if (reading.bytes > MAX_WHOLE_REPLY_BYTES) this.reading = { kind: "none" };
      else reading.chunks.push(chunk);
    }
  }

  /** 到目前为止读到的；整份回复要等 end() 才读。 */
  soFar(): TappedReply {
    return this.reply;
  }

  /** 回复收完了：交出还扣着的，返回读到的。再调一次只返回读到的。 */
  end(): TappedReply {
    const { reading } = this;
    this.reading = { kind: "none" };
    const add = (event: StreamEvent) => this.add(event);
    if (reading.kind === "stream") {
      reading.events.feed(reading.utf8.end());
      reading.events.end();
      this.decoder.end?.(add);
    } else if (reading.kind === "whole") {
      const text = Buffer.concat(reading.chunks).toString("utf8");
      this.raw = text;
      this.decoder.whole(parseJson(text), add);
    }
    return this.reply;
  }

  private add(event: StreamEvent): void {
    switch (event.kind) {
      case "start":
      case "usage":
        addUsage(this.reply.usage, event.usage);
        return;
      case "stop":
        this.reply.stop = event.stop;
        return;
      case "done":
        this.reply.ended = true;
        return;
      case "error":
        this.reply.error = { message: event.message, code: event.code, raw: this.raw };
        return;
      case "text":
        if (event.text !== "") this.addContent("text");
        return;
      case "think":
        if (event.text !== "") this.addContent("thinking");
        return;
      case "tool_start":
      case "other_tool":
        this.addContent("tool_call");
        return;
      default:
      // think_start、tool_args 不是新的内容；签名也不算（magpie 的 anthropicDeltaSays）。
    }
  }

  private addContent(content: ReplyContent): void {
    if (!this.reply.content.includes(content)) this.reply.content.push(content);
  }
}
