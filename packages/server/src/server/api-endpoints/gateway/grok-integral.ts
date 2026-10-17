// Grok 工具参数里的整数改写移植自 magpie（https://github.com/yetone/magpie，internal/gateway/grok_integral.go 的 wholeNums、wholeArgs、
// wholeEncoder、wholeResult、intTidy，gateway.go 里接上它们的 encoder、render 与直通回复）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { applyEdits, findNodeAtLocation, modify, parseTree, type JSONPath } from "jsonc-parser";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { isRecord, parseJson } from "../upstream-http.js";
import type { EmitEvent, ReplyFilter, StreamEvent } from "./translation/ir.js";
import { isGrokModel } from "./vendor-rewrites.js";

/*
 * Grok 的模型（不论谁提供）在工具调用参数里把整数写成带零小数的样子（"yield_time_ms":2500.0），
 * Codex 按 u64、i32 这些整数类型读，serde 整个调用都拒（magpie #1431）。Grok 回复里调用参数中的数字，
 * 小数部分全是零、又没有指数的，去掉小数：2500.0 写成 2500。JSON 只有一种数字，对任何客户端都是同一个值。
 * 字符串、键、别的小数（2.5）与指数（2.5e3）照原样，别的模型的回复一个字不改。
 * 按文字流处理，参数整段来还是切成几段来，结果都一样。
 */

/** 回复是不是 Grok 的模型给的：按 Agent 要的名字或发给上游的名字认。 */
export function isGrokReply(input: { requestedModel: string; upstreamModel: string }): boolean {
  return isGrokModel(input.requestedModel) || isGrokModel(input.upstreamModel);
}

/**
 * 一段段喂进来的 JSON 文字，去掉每个数字的零小数。只扣着一段零小数（".0"、".00"），等知道数字在那里结束
 * （去掉）还是接着写（2500.05、2500.0e3，原样写出）；所以一段只会为这样的小数等下一段，结束时什么都不扣。
 */
export class WholeNumbers {
  private inString = false;
  private escaped = false;
  private inNumber = false;
  // 这个数字余下的部分原样写出。
  private asIs = false;
  // 扣着的零小数：点算一个，再加它的零。
  private zeros = 0;

  feed(text: string): string {
    let out = "";
    for (const c of text) {
      if (this.inNumber) {
        const said = this.numberChar(c);
        if (said !== null) {
          out += said;
          continue;
        }
        // 数字结束了：扣着的零小数去掉。
        this.inNumber = false;
        this.asIs = false;
        this.zeros = 0;
      }
      this.otherChar(c);
      out += c;
    }
    return out;
  }

  /** 数字里的一个字符写出什么；数字在它前面结束了为 null。 */
  private numberChar(c: string): string | null {
    const digit = c >= "0" && c <= "9";
    const exponent = c === "e" || c === "E";
    if (this.zeros > 0 && c === "0") {
      this.zeros++;
      return "";
    }
    const notZerosAfterAll = this.zeros > 0 && (digit || exponent);
    if (notZerosAfterAll) {
      // 不是全零的小数：扣着的照原样写出。
      const held = `.${"0".repeat(this.zeros - 1)}`;
      this.zeros = 0;
      this.asIs = true;
      return held + c;
    }
    if (this.zeros > 0) return null;
    const startsFraction = c === "." && !this.asIs;
    if (startsFraction) {
      this.zeros = 1;
      return "";
    }
    const numberPart = digit || exponent || c === "." || c === "+" || c === "-";
    if (!numberPart) return null;
    if (exponent || c === ".") this.asIs = true;
    return c;
  }

  private otherChar(c: string): void {
    if (this.inString) {
      if (this.escaped) this.escaped = false;
      else if (c === "\\") this.escaped = true;
      else if (c === '"') this.inString = false;
      return;
    }
    if (c === '"') this.inString = true;
    else if (c === "-" || (c >= "0" && c <= "9")) this.inNumber = true;
  }
}

/** 一个调用的整段参数去掉零小数。 */
export function wholeArgs(text: string): string {
  if (!text.includes(".")) return text;
  return new WholeNumbers().feed(text);
}

/** 翻译的回复：Grok 的调用参数边流边去掉零小数（magpie wholeEncoder）；扣着的一段等下一段再交出。 */
export function wholeArgsFilter(emit: EmitEvent): ReplyFilter {
  let numbers = new WholeNumbers();
  return {
    event(event: StreamEvent) {
      if (event.kind === "tool_start") numbers = new WholeNumbers();
      if (event.kind !== "tool_args") {
        emit(event);
        return;
      }
      const text = numbers.feed(event.text);
      if (text !== "") emit({ kind: "tool_args", text });
    },
    end() {},
  };
}

/** 直通的回复里会带调用参数的格式（Agent 只说这两种）。 */
export type PassedReplyFormat = Extract<
  ApiEndpointRequestFormat,
  "anthropic_messages" | "openai_responses"
>;

/** 一处参数：在事件 JSON 里的位置，与它怎么改（字符串按文字改，对象按原文改）。 */
interface ArgsAt {
  path: JSONPath;
  fix: (text: string) => string;
}

/**
 * 直通的 Grok 回复里，调用参数去掉零小数（magpie intTidy）：Responses 的 function_call 项与参数增量，
 * Anthropic 的 tool_use input 与 input_json_delta。流按行转出，带参数又改了的那行只改参数，其余字节原样；
 * 不是流的回复攒齐了在最后改。
 */
export class WholeArgsTidy {
  private held = "";
  // 流式调用到目前为止的参数，按它的位置或项 id。
  private readonly calls = new Map<string, WholeNumbers>();

  constructor(private readonly reply: { format: PassedReplyFormat; stream: boolean }) {}

  write(text: string): string {
    this.held += text;
    if (!this.reply.stream) return "";
    const end = this.held.lastIndexOf("\n");
    if (end < 0) return "";
    const lines = this.held.slice(0, end + 1);
    this.held = this.held.slice(end + 1);
    return this.lines(lines);
  }

  end(): string {
    const rest = this.held;
    this.held = "";
    if (this.reply.stream) return this.lines(rest);
    return this.event(rest);
  }

  /** 这段文字可能带着调用参数。 */
  private carries(text: string): boolean {
    if (this.reply.format === "openai_responses") return text.includes("function_call");
    return text.includes('"tool_use"') || text.includes('"input_json_delta"');
  }

  private lines(text: string): string {
    if (!this.carries(text)) return text;
    return text
      .split(/(?<=\n)/)
      .map((line) => this.line(line))
      .join("");
  }

  private line(line: string): string {
    const isData = line.startsWith("data:") && this.carries(line);
    if (!isData) return line;
    return `data:${this.event(line.slice("data:".length))}`;
  }

  /** 一个事件（或整份回复）的 JSON 原文，参数去掉零小数；读不懂的原样。 */
  private event(text: string): string {
    const event = parseJson(text);
    if (!isRecord(event)) return text;
    const places = this.argsIn(event);
    return places.reduce((out, place) => withArgsFixed({ text: out, place }), text);
  }

  private argsIn(event: Record<string, unknown>): ArgsAt[] {
    if (this.reply.format === "openai_responses") return this.responsesArgs(event);
    return this.anthropicArgs(event);
  }

  private numbersFor(key: string): WholeNumbers {
    let numbers = this.calls.get(key);
    if (numbers === undefined) {
      numbers = new WholeNumbers();
      this.calls.set(key, numbers);
    }
    return numbers;
  }

  private responsesArgs(event: Record<string, unknown>): ArgsAt[] {
    const places: ArgsAt[] = [];
    if (isFunctionCall(event.item)) places.push({ path: ["item", "arguments"], fix: wholeArgs });
    const key = callKey(event);
    if (event.type === "response.function_call_arguments.delta") {
      const numbers = this.numbersFor(key);
      places.push({ path: ["delta"], fix: (text) => numbers.feed(text) });
    }
    if (event.type === "response.function_call_arguments.done") {
      this.calls.delete(key);
      places.push({ path: ["arguments"], fix: wholeArgs });
    }
    const whole = event.object === "response";
    if (isRecord(event.response)) places.push(...outputArgs(event.response, ["response"]));
    else if (whole) places.push(...outputArgs(event, []));
    return places;
  }

  private anthropicArgs(event: Record<string, unknown>): ArgsAt[] {
    const places: ArgsAt[] = [];
    const content = Array.isArray(event.content) ? event.content : [];
    content.forEach((block, index) => {
      if (isToolUse(block)) places.push({ path: ["content", index, "input"], fix: wholeArgs });
    });
    if (isToolUse(event.content_block)) {
      places.push({ path: ["content_block", "input"], fix: wholeArgs });
    }
    const delta = isRecord(event.delta) ? event.delta : null;
    const argsDelta = event.type === "content_block_delta" && delta?.type === "input_json_delta";
    if (argsDelta) {
      const numbers = this.numbersFor(String(event.index));
      places.push({ path: ["delta", "partial_json"], fix: (text) => numbers.feed(text) });
    }
    return places;
  }
}

function isFunctionCall(item: unknown): boolean {
  return isRecord(item) && item.type === "function_call";
}

function isToolUse(block: unknown): boolean {
  return isRecord(block) && block.type === "tool_use" && block.input !== undefined;
}

/** Responses 参数事件的调用按什么认：项 id，没有就按它在输出里的位置。 */
function callKey(event: Record<string, unknown>): string {
  const itemId = typeof event.item_id === "string" ? event.item_id : "";
  if (itemId !== "") return itemId;
  return `#${String(event.output_index)}`;
}

/** 一份 Responses 回复的 output 里每个 function_call 的参数。 */
function outputArgs(response: Record<string, unknown>, at: JSONPath): ArgsAt[] {
  const output = Array.isArray(response.output) ? response.output : [];
  const places: ArgsAt[] = [];
  output.forEach((item, index) => {
    if (isFunctionCall(item))
      places.push({ path: [...at, "output", index, "arguments"], fix: wholeArgs });
  });
  return places;
}

/** 只改这一处：字符串按它的文字改、写回字符串；对象或数组按原文改。别的字节原样。 */
function withArgsFixed(input: { text: string; place: ArgsAt }): string {
  const { text, place } = input;
  const root = parseTree(text);
  if (root === undefined) return text;
  const node = findNodeAtLocation(root, place.path);
  if (node === undefined) return text;
  if (node.type === "string") {
    const value = String(node.value);
    const fixed = place.fix(value);
    if (fixed === value) return text;
    return applyEdits(text, modify(text, place.path, fixed, {}));
  }
  const raw = text.slice(node.offset, node.offset + node.length);
  const fixed = place.fix(raw);
  return text.slice(0, node.offset) + fixed + text.slice(node.offset + node.length);
}
