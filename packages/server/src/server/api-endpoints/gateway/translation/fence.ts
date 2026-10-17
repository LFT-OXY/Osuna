// 剥掉 JSON 回答外面的代码块移植自 magpie（https://github.com/yetone/magpie，internal/gateway/format_fence.go 的 unfence、unfencedResult、fenceEncoder，format.go 的 wantsJSON）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { parseJson } from "../../upstream-http.js";
import {
  passingFilter,
  type EmitEvent,
  type GatewayRequest,
  type Reply,
  type ReplyFilter,
  type StreamEvent,
} from "./ir.js";

/*
 * Agent 要结构化输出（json_schema 或 json_object；不收而写进系统提示的也算），模型却用 ``` 把整个 JSON 包住时，
 * 剥掉代码块（Codex 读记忆的那一轮因此报「expected value at line 1 column 1」，magpie #2196）。
 * 只剥包住整个回答、不带标签或标 json、里面是一个完整 JSON 值的；写坏的、半截的原样留着。
 */

const FENCE = "```";

/** 包住整个回答的代码块里的 JSON；不是这样的回答为 null。 */
export function unfence(said: string): string | null {
  const trimmed = said.trim();
  const wrapped = trimmed.length >= 6 && trimmed.startsWith(FENCE) && trimmed.endsWith(FENCE);
  if (!wrapped) return null;
  const newline = trimmed.indexOf("\n");
  if (newline === -1) return null;
  const tag = trimmed.slice(FENCE.length, newline).trim();
  if (tag !== "" && tag.toLowerCase() !== "json") return null;
  const inner = trimmed.slice(newline + 1, -FENCE.length).trim();
  return parseJson(inner) === undefined ? null : inner;
}

/** Agent 要的是 JSON：请求里的结构化输出（降级写进系统提示前的原样）。 */
function wantsJson(request: GatewayRequest): boolean {
  return request.format !== null;
}

/** 整份回复：每段包着代码块的文字剥掉代码块。 */
export function unfencedReply(input: { reply: Reply; request: GatewayRequest }): Reply {
  const { reply } = input;
  if (!wantsJson(input.request)) return reply;
  const parts = reply.parts.map((part) => {
    if (part.kind !== "text") return part;
    const json = unfence(part.text);
    return json === null ? part : { ...part, text: json };
  });
  return { ...reply, parts };
}

/** 流式回复：Agent 要 JSON 时扣着可能是代码块的文字（FenceFilter），不要时原样交出。 */
export function fenceFilter(input: { request: GatewayRequest; emit: EmitEvent }): ReplyFilter {
  return wantsJson(input.request) ? new FenceFilter(input.emit) : passingFilter(input.emit);
}

/**
 * 文字还可能是代码块的开头时扣着：一旦以 ``` 以外的东西开头就照来的交出；以代码块开头的，
 * 等文字说完（来了文字以外的事件，开头与用量除外）整段剥掉代码块再交出。
 */
class FenceFilter implements ReplyFilter {
  private held = "";
  // 扣着的文字还可能是代码块的开头。
  private holding = false;
  // 文字已经以别的开头：什么都不再扣。
  private past = false;

  constructor(private readonly emit: EmitEvent) {}

  event(event: StreamEvent): void {
    if (event.kind !== "text") {
      if (event.kind !== "start" && event.kind !== "usage") this.flush();
      this.emit(event);
      return;
    }
    if (this.past) {
      this.emit(event);
      return;
    }
    this.held += event.text;
    const lead = this.held.replace(/^[ \t\r\n]+/, "");
    const mayBeFence = lead === "" || FENCE.startsWith(lead) || lead.startsWith(FENCE);
    if (mayBeFence) {
      this.holding = true;
      return;
    }
    this.past = true;
    this.holding = false;
    const text = this.held;
    this.held = "";
    this.emit({ kind: "text", text });
  }

  end(): void {
    this.flush();
  }

  /** 交出扣着的文字：是包着代码块的 JSON 就剥掉代码块。 */
  private flush(): void {
    if (!this.holding) return;
    this.holding = false;
    this.past = true;
    const held = this.held;
    this.held = "";
    const text = unfence(held) ?? held;
    if (text !== "") this.emit({ kind: "text", text });
  }
}
