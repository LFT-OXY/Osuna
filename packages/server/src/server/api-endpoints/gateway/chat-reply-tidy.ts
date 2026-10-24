// 直转的 Chat 回复修整移植自 magpie（https://github.com/yetone/magpie，internal/gateway/chattidy.go 的 chatTidy、tidyLine、
// withoutEmptyNames、partsText、flattenContent 与 chatWhole，textcalls.go 的 chatToolNames、textCallTidy、mayWriteCalls 与
// wholeTextCalls）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { isRecord, parseJson } from "../upstream-http.js";
import type { ReplyTidy } from "./reply-tidy.js";
import { newId } from "./translation/ir.js";
import { parseTextCalls, textCallAt } from "./translation/text-calls.js";

/*
 * 原样直转给 Chat 客户端（Pi、OMP）的 Chat 回复，照 magpie 改几处：
 * - 流（ChatStreamTidy）：去掉空的 reasoning_content（Qoder 会当成思考重新开始）、finish_reason 的 "" 改 null（AI SDK 拒收）、
 *   去掉工具参数片段上重复的空名字（按字段覆盖合并的客户端会拼出名叫 "" 的调用）、去掉空的 tool_calls: []，
 *   Mistral 分段写的 content（thinking 段与 text 段，#483）拍平成字符串、思考放进 reasoning_content。
 * - 请求给了工具时，模型写进文字的调用转成真调用（TextCallStreamTidy，与翻译时的 textCallFilter 同一套读法）。
 * - 没流式、整份来的回复（ChatWholeTidy）：分段的 content 拍平，写进文字的调用转成真调用。
 * 没有这些写法的行原样。
 */

/** Chat 请求给的函数工具的名字；没给为 null。 */
export function chatToolNames(body: unknown): ReadonlySet<string> | null {
  if (!isRecord(body) || !Array.isArray(body.tools) || body.tools.length === 0) return null;
  const names = new Set<string>();
  for (const tool of body.tools) {
    if (!isRecord(tool)) continue;
    const fn = isRecord(tool.function) ? tool.function : {};
    if (typeof fn.name === "string" && fn.name !== "") names.add(fn.name);
    else if (typeof tool.name === "string" && tool.name !== "") names.add(tool.name);
  }
  return names;
}

const TIDY_MARKS = [
  '"reasoning_content":""',
  '"finish_reason":""',
  '"name":""',
  '"tool_calls":[]',
  '"content":[',
  '"content": [',
];

function needsTidy(text: string): boolean {
  return TIDY_MARKS.some((mark) => text.includes(mark));
}

/** 按整行交出、行没收完的扣到下一次的修整。 */
abstract class LineTidy implements ReplyTidy {
  private held = "";

  write(text: string): string {
    this.held += text;
    const end = this.held.lastIndexOf("\n");
    if (end < 0) return "";
    const lines = this.held.slice(0, end + 1);
    this.held = this.held.slice(end + 1);
    return this.lines(lines);
  }

  end(): string {
    const held = this.held;
    this.held = "";
    return this.lines(held) + this.finish();
  }

  protected lines(text: string): string {
    return text
      .split(/(?<=\n)/)
      .map((line) => this.line(line))
      .join("");
  }

  protected abstract line(line: string): string;

  protected finish(): string {
    return "";
  }
}

/** 直转的 Chat 流（magpie chatTidy）。 */
export class ChatStreamTidy extends LineTidy {
  protected lines(text: string): string {
    if (!needsTidy(text)) return text;
    return super.lines(text);
  }

  protected line(line: string): string {
    if (!needsTidy(line)) return line;
    const body = line.replace(/\r?\n$/, "");
    if (!body.startsWith("data:")) return line;
    const chunk = parseJson(body.slice("data:".length).trim());
    if (!isRecord(chunk) || !Array.isArray(chunk.choices)) return line;
    let changed = false;
    for (const choice of chunk.choices) {
      if (!isRecord(choice)) continue;
      if (choice.finish_reason === "") {
        choice.finish_reason = null;
        changed = true;
      }
      if (isRecord(choice.delta) && tidyDelta(choice.delta)) changed = true;
    }
    if (!changed) return line;
    return `data: ${JSON.stringify(chunk)}${line.slice(body.length)}`;
  }
}

/** 一个 delta 改了就为 true。 */
function tidyDelta(delta: Record<string, unknown>): boolean {
  let changed = flattenContent({ message: delta, whole: false });
  if (delta.reasoning_content === "") {
    delete delta.reasoning_content;
    changed = true;
  }
  const calls = delta.tool_calls;
  if (Array.isArray(calls) && calls.length === 0) {
    delete delta.tool_calls;
    return true;
  }
  if (Array.isArray(calls) && withoutEmptyNames(calls)) changed = true;
  return changed;
}

/** 去掉工具参数片段上的空名字；去掉过就为 true。 */
function withoutEmptyNames(calls: unknown[]): boolean {
  let changed = false;
  for (const call of calls) {
    if (!isRecord(call) || !isRecord(call.function) || call.function.name !== "") continue;
    delete call.function.name;
    changed = true;
  }
  return changed;
}

/** 分段写的 content 里的文字与思考；content 不是段的数组为 null。 */
function partsText(content: unknown): { text: string; think: string } | null {
  if (!Array.isArray(content)) return null;
  let text = "";
  let think = "";
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") text += part.text;
    if (part.type !== "thinking") continue;
    // Mistral 的是文字段的数组；直接是字符串的也收。
    if (typeof part.thinking === "string") think += part.thinking;
    else if (Array.isArray(part.thinking)) {
      for (const inner of part.thinking) {
        if (isRecord(inner) && typeof inner.text === "string") think += inner.text;
      }
    }
  }
  return { text, think };
}

/**
 * 分段写的 content 改成字符串，思考接在已有的 reasoning_content 后面；改了就为 true。
 * 流里的 delta 没有文字时去掉 content，整份回复的留一个空字符串。
 */
function flattenContent(input: { message: Record<string, unknown>; whole: boolean }): boolean {
  const { message } = input;
  const parts = partsText(message.content);
  if (parts === null) return false;
  if (parts.text !== "" || input.whole) message.content = parts.text;
  else delete message.content;
  if (parts.think !== "") {
    const had = typeof message.reasoning_content === "string" ? message.reasoning_content : "";
    message.reasoning_content = had + parts.think;
  }
  return true;
}

/**
 * 直转的 Chat 流里模型写进文字的调用（magpie textCallTidy）：从调用开头起的文字扣着，回复结束时读成调用，
 * 补一个带 tool_calls 的 chunk、结束原因改成 tool_calls；读不成的照原文交出。模型自己真调用过工具后不再读文字。
 */
export class TextCallStreamTidy extends LineTidy {
  private pending = "";
  private heldText = "";
  private holding = false;
  private native = false;
  // 最近读到的 chunk：补出来的 chunk 照它写编号、模型名与时间。
  private last: Record<string, unknown> = {};

  constructor(private readonly names: ReadonlySet<string>) {
    super();
  }

  protected finish(): string {
    return this.release();
  }

  protected line(line: string): string {
    const body = line.replace(/\r?\n$/, "");
    if (!body.startsWith("data:")) return line;
    const data = body.slice("data:".length).trim();
    if (data === "[DONE]") return this.release() + line;
    const event = parseJson(data);
    if (!isRecord(event)) return line;
    this.last = event;
    const choices = Array.isArray(event.choices) ? event.choices : [];
    const choice = choices.length === 1 ? choices[0] : null;
    if (!isRecord(choice)) return line;
    const delta = isRecord(choice.delta) ? choice.delta : {};
    const { before, changed } = this.choiceRead({ choice, delta });
    if (!changed) return before + line;
    // 什么都没剩下要说的 chunk 不发。
    const nothingLeft =
      Object.keys(delta).length === 0 && choice.finish_reason == null && event.usage == null;
    if (nothingLeft) return before;
    return `${before}data: ${JSON.stringify(event)}${line.slice(body.length)}`;
  }

  /** 读一个选项：扣下文字、收尾时补出调用；before 是要先交出的 chunk，changed 是这个选项改了没有。 */
  private choiceRead(input: { choice: Record<string, unknown>; delta: Record<string, unknown> }): {
    before: string;
    changed: boolean;
  } {
    const { choice, delta } = input;
    let before = "";
    let changed = false;
    const calls = delta.tool_calls;
    if (Array.isArray(calls) && calls.length > 0 && !this.native) {
      before = this.release();
      this.native = true;
    }
    if (typeof delta.content === "string" && delta.content !== "" && !this.native) {
      const said = this.text(delta.content);
      if (said === "") delete delta.content;
      else delta.content = said;
      changed = true;
    }
    const finish = typeof choice.finish_reason === "string" ? choice.finish_reason : "";
    if (finish !== "" && (this.holding || this.pending !== "")) {
      const made = this.madeCalls();
      before += made.text;
      if (made.called) {
        choice.finish_reason = "tool_calls";
        changed = true;
      }
    }
    return { before, changed };
  }

  /** 这段文字里现在能交出的；从调用开头起的扣着，结尾可能是标签开头的也扣着。 */
  private text(piece: string): string {
    const text = this.pending + piece;
    this.pending = "";
    if (this.holding) {
      this.heldText += text;
      return "";
    }
    const { at, tail } = textCallAt(text);
    if (at >= 0) {
      this.holding = true;
      this.heldText = text.slice(at);
      return text.slice(0, at);
    }
    this.pending = text.slice(text.length - tail);
    return text.slice(0, text.length - tail);
  }

  /** 回复结束：扣着的读成调用交出；读不成的照文字交出。 */
  private madeCalls(): { text: string; called: boolean } {
    const parsed =
      this.holding && !this.native
        ? parseTextCalls({ text: this.heldText, names: this.names })
        : null;
    if (parsed === null) return { text: this.release(), called: false };
    this.holding = false;
    this.heldText = "";
    let out = "";
    if (parsed.rest !== "") out += this.chunk({ content: parsed.rest });
    out += this.release();
    if (parsed.calls.length === 0) return { text: out, called: false };
    const toolCalls = parsed.calls.map((call, index) => ({
      index,
      id: `call_text_${newId()}`,
      type: "function",
      function: { name: call.name, arguments: call.args },
    }));
    out += this.chunk({ tool_calls: toolCalls });
    return { text: out, called: true };
  }

  private release(): string {
    const text = this.pending + this.heldText;
    this.pending = "";
    this.heldText = "";
    this.holding = false;
    return text === "" ? "" : this.chunk({ content: text });
  }

  private chunk(delta: Record<string, unknown>): string {
    const chunk: Record<string, unknown> = { object: "chat.completion.chunk" };
    for (const key of ["id", "object", "created", "model"]) {
      if (key in this.last) chunk[key] = this.last[key];
    }
    chunk.choices = [{ index: 0, delta, finish_reason: null }];
    return `data: ${JSON.stringify(chunk)}\n\n`;
  }
}

/**
 * 整份来的 Chat 回复（magpie chatWhole）：分段的 content 拍平，请求给了工具时写进文字的调用转成真调用。
 * 攒齐了在最后改；别的回复原样。
 */
export class ChatWholeTidy implements ReplyTidy {
  private held = "";

  constructor(private readonly names: ReadonlySet<string> | null) {}

  write(text: string): string {
    this.held += text;
    return "";
  }

  end(): string {
    const text = this.held;
    this.held = "";
    const parts = text.includes('"content":[') || text.includes('"content": [');
    const mayWriteCalls =
      this.names !== null && (text.includes("tool_call") || text.includes("DSML"));
    if (!parts && !mayWriteCalls) return text;
    const reply = parseJson(text);
    if (!isRecord(reply) || !Array.isArray(reply.choices)) return text;
    let changed = false;
    for (const choice of reply.choices) {
      if (!isRecord(choice) || !isRecord(choice.message)) continue;
      const flattened = parts && flattenContent({ message: choice.message, whole: true });
      const written = wholeTextCalls({ message: choice.message, names: this.names });
      if (written.called) choice.finish_reason = "tool_calls";
      if (flattened || written.wrote) changed = true;
    }
    return changed ? JSON.stringify(reply) : text;
  }
}

/** 整份回复的消息里写进文字的调用；wrote 是消息改了没有，called 是现在是否调用了工具。 */
function wholeTextCalls(input: {
  message: Record<string, unknown>;
  names: ReadonlySet<string> | null;
}): { wrote: boolean; called: boolean } {
  const { message, names } = input;
  const none = { wrote: false, called: false };
  if (names === null) return none;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return none;
  if (typeof message.content !== "string") return none;
  const text = message.content;
  const { at } = textCallAt(text);
  if (at < 0) return none;
  const parsed = parseTextCalls({ text: text.slice(at), names });
  if (parsed === null) return none;
  const said = text.slice(0, at) + parsed.rest;
  if (parsed.calls.length === 0) {
    // 只有标签：照流里一样丢掉。
    message.content = said;
    return { wrote: true, called: false };
  }
  message.content = said === "" ? null : said;
  message.tool_calls = parsed.calls.map((call) => ({
    id: `call_text_${newId()}`,
    type: "function",
    function: { name: call.name, arguments: call.args },
  }));
  return { wrote: true, called: true };
}
