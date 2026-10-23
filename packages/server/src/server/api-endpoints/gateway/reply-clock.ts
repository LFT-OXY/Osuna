// 回复的计时（首个内容与首段文字、内容流动的时长、可见推理的起点、封存推理）移植自 magpie
// （https://github.com/yetone/magpie，internal/gateway/ttft.go 的 firstToken、flowMs、flowFor、hidesReasoning、reasoningMs 与 timingKind）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { parseJson } from "../upstream-http.js";
import type { StreamEvent } from "./translation/ir.js";

// 读这么多还没完的回复不再计时：一份全是工具调用的回复没有文字可等（magpie 的 firstMost）。
const MOST_READ = 8 * 1024 * 1024;
// 内容到达的刻度最多记这么多个不同的毫秒，再多流动时长就不说（magpie 的 flowMost）。
const MOST_MARKS = 1 << 16;
// 可见推理至少流这么久才算按它自己的节奏来的（magpie reasoningMs 的 100ms）。
const MIN_REASONING_SPAN_MS = 100;

/** 到某一刻为止来过多少内容（按事件的大小）。 */
interface FlowMark {
  at: number;
  sum: number;
}

/**
 * 交给 Agent 的回复的计时：第一个内容（文字、思考或工具调用）与第一段文字的时刻；可见推理开始的时刻
 * （只在推理先来、且按自己的节奏流了一阵时有）；推理是否被封存或只给了摘要；内容流动的时长（毫秒）。
 * 时刻都是绝对时间，没有为 null。
 */
export interface ReplyTimes {
  firstContentAt: number | null;
  firstTextAt: number | null;
  firstReasoningAt: number | null;
  reasoningHidden: boolean;
  flowMs: number | null;
}

/** 没有计时的回复：不流式的、没人交出的。 */
export const UNTIMED: ReplyTimes = {
  firstContentAt: null,
  firstTextAt: null,
  firstReasoningAt: null,
  reasoningHidden: false,
  flowMs: null,
};

/**
 * 边看交给 Agent 的事件边计时，`upstream` 是上游说的协议（Responses 的推理只是摘要，量不出速度）。
 * 不流式的回复不用它计时。
 */
export class ReplyClock {
  private first: number | null = null;
  private text: number | null = null;
  private reasoning: number | null = null;
  private lastReasoning: number | null = null;
  private hidden = false;
  private off = false;
  private read = 0;
  private sum = 0;
  private marks: FlowMark[] = [];

  constructor(private readonly upstream: ApiEndpointRequestFormat) {}

  /** 上游一个事件的原文：只看推理是否被封存（Anthropic 的 redacted_thinking、Responses 的 encrypted_content）。 */
  sawRaw(data: string): void {
    if (this.off || this.text !== null) return;
    if (!data.includes("redacted_thinking") && !data.includes("encrypted_content")) return;
    if (sealsReasoning(parseJson(data))) this.hidden = true;
  }

  /** 交给 Agent 的一个事件。 */
  saw(event: StreamEvent, at: number = Date.now()): void {
    if (this.off) return;
    const size = JSON.stringify(event).length;
    this.read += size;
    if (this.read > MOST_READ) {
      this.off = true;
      this.marks = [];
      return;
    }
    const kind = contentKind(event);
    if (kind === null) return;
    if (this.text === null && kind === "thinking") {
      this.reasoning ??= at;
      this.lastReasoning = at;
    }
    this.first ??= at;
    if (kind === "text") this.text ??= at;
    this.mark(at, size);
  }

  /**
   * 回复交完后的计时。`reasoning` 是上游报的推理 token：有推理且有文字时流动从第一段文字算起。
   * `notBefore` 是第一次交给 Agent 的时刻（直通扣下的帧此前已收到），更早的刻度都算在那一刻。
   */
  times(input: { reasoning: number; notBefore?: number | null }): ReplyTimes {
    const floor = input.notBefore ?? null;
    const at = (value: number | null) =>
      value === null || floor === null ? value : Math.max(value, floor);
    const first = at(this.first);
    const text = at(this.text);
    const marks = floor === null ? this.marks : clamped(this.marks, floor);
    const from = input.reasoning > 0 && text !== null ? text : first;
    return {
      firstContentAt: first,
      firstTextAt: text,
      firstReasoningAt: this.visibleReasoning() ? at(this.reasoning) : null,
      reasoningHidden: this.hidesReasoning(),
      flowMs: from === null || this.off ? null : flowFrom(marks, from),
    };
  }

  /** Responses 的推理只给摘要，量不全（magpie 的 hidesReasoning）。 */
  private hidesReasoning(): boolean {
    return this.hidden || (this.upstream === "openai_responses" && this.reasoning !== null);
  }

  /** 推理是第一个内容、没封存、按自己的节奏流了至少 100ms，且上游是 Chat 或 Anthropic（magpie 的 reasoningMs）。 */
  private visibleReasoning(): boolean {
    if (this.upstream === "openai_responses" || this.hidden || this.off) return false;
    if (this.reasoning === null || this.lastReasoning === null) return false;
    if (this.reasoning !== this.first) return false;
    return this.lastReasoning - this.reasoning >= MIN_REASONING_SPAN_MS;
  }

  private mark(at: number, size: number): void {
    this.sum += size;
    const last = this.marks.at(-1);
    if (last && last.at === at) {
      last.sum = this.sum;
      return;
    }
    if (this.marks.length >= MOST_MARKS) {
      this.off = true;
      this.marks = [];
      return;
    }
    this.marks.push({ at, sum: this.sum });
  }
}

type ContentKind = "text" | "thinking" | "other";

/** 事件里有没有内容：文字、思考，或工具调用（开头与参数）、联网搜索。 */
function contentKind(event: StreamEvent): ContentKind | null {
  switch (event.kind) {
    case "text":
      return event.text === "" ? null : "text";
    case "think":
      return event.text === "" ? null : "thinking";
    case "tool_args":
      return event.text === "" ? null : "other";
    case "tool_start":
    case "other_tool":
    case "search":
      return "other";
    default:
      return null;
  }
}

/** 推理被封存：Anthropic 的 redacted_thinking 块、Responses 带 encrypted_content 的输出项。 */
function sealsReasoning(parsed: unknown): boolean {
  if (!isRecord(parsed)) return false;
  const block = parsed.content_block;
  if (isRecord(block) && block.type === "redacted_thinking") return true;
  const item = parsed.item;
  return (
    isRecord(item) && typeof item.encrypted_content === "string" && item.encrypted_content !== ""
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamped(marks: FlowMark[], floor: number): FlowMark[] {
  const out: FlowMark[] = [];
  for (const mark of marks) {
    const at = Math.max(mark.at, floor);
    const last = out.at(-1);
    if (last && last.at === at) last.sum = mark.sum;
    else out.push({ at, sum: mark.sum });
  }
  return out;
}

/**
 * 内容从 from 起流了多久：中间 80% 的内容用了多久，再放大到整份，所以匀速来的回复得到它整个窗口，
 * 攒着一次吐出的几乎为 0（magpie 的 flowMs）。至少 1；from 之后没有内容时为 null。
 */
function flowFrom(marks: FlowMark[], from: number): number | null {
  if (marks.length === 0) return null;
  let base = 0;
  for (const mark of marks) {
    if (mark.at >= from) break;
    base = mark.sum;
  }
  const total = (marks.at(-1)?.sum ?? 0) - base;
  if (total <= 0) return null;
  const reached = (share: number) => {
    for (const mark of marks) {
      if ((mark.sum - base) * 100 >= total * share && mark.at >= from) return mark.at;
    }
    return marks.at(-1)?.at ?? from;
  };
  const span = reached(90) - reached(10);
  return Math.max(Math.trunc((span * 10) / 8), 1);
}
