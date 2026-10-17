// 写在文字里的工具调用转成真调用移植自 magpie（https://github.com/yetone/magpie，internal/gateway/textcalls.go 的 textCallAt、parseTextCalls、cutMark、hermesCall、paramCall、glmCall、dsmlCall、callArgs、escapeRawControls 与 textCallSee）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { isRecord, parseJson } from "../../upstream-http.js";
import { partialTagAtEnd } from "./chat.js";
import {
  newId,
  passingFilter,
  type EmitEvent,
  type ReplyFilter,
  type StreamEvent,
  type Tool,
} from "./ir.js";

/*
 * 长对话里模型可能把工具调用写进文字而不真调用（magpie #823：DeepSeek 经中转、约 70 万 token 时）：
 * Hermes 的 <tool_call>{"name": …, "arguments": …}</tool_call>，GLM 的 <tool_call>名字<arg_key>…</arg_key><arg_value>…</arg_value></tool_call>（#906），
 * 或 DeepSeek 自己的 <｜DSML｜invoke name="…"> 带参数，后面常散落着另一种的收尾标签。Agent 当文字收下、什么都没执行就结束这一轮，
 * 让它接着做，模型读回自己写的文字又照样写下一个调用，这段对话就废了。
 * 请求给了工具时，从第一个这样的标签起的文字先扣着；回复结束时，里面每块点名了给过的工具、参数读得出的都转成真调用，
 * 回复按调用了工具结束。扣着的文字不全是这样的块就照原文交出。
 */

const TOOL_CALL_OPEN = "<tool_call>";
const TOOL_CALL_CLOSE = "</tool_call>";

/** 写进文字的调用以这些开头。 */
const TEXT_CALL_MARKS = [TOOL_CALL_OPEN, "<｜DSML｜", "<|DSML|"];

/** 截断在结尾的半个标签（</tool_call> 的 </）；单独一个 < 可能是正文。 */
const CUT_MARKS = [TOOL_CALL_CLOSE, "</parameter>", "</｜DSML｜", "</|DSML|", ...TEXT_CALL_MARKS];

const DSML_TAG = String.raw`<\s*/?\s*[|｜][\s|｜]*DSML[\s|｜]*`;
const DSML_INVOKE = /<\s*[|｜][\s|｜]*DSML[\s|｜]*invoke\s+name\s*=\s*"([^"]+)"\s*>/;
const DSML_PARAM = new RegExp(
  String.raw`<\s*[|｜][\s|｜]*DSML[\s|｜]*parameter\s+name\s*=\s*"([^"]+)"((?:\s+\w+\s*=\s*"[^"]*")*)\s*>(.*?)` +
    DSML_TAG +
    String.raw`parameter\s*>`,
  "gs",
);
const DSML_CLOSE = /<\s*\/\s*[|｜][\s|｜]*DSML[\s|｜]*invoke\s*>/;
const DSML_STRING = /string\s*=\s*"true"/;
// 调用读走后剩下的标签，以及 GLM 在收尾标签前留下的括号、引号或 >（magpie #1945）。
const TEXT_CALL_JUNK = new RegExp(
  `${DSML_TAG}[^<>]*>?|[}\\]"'>]*\\s*</tool_calls?>|<tool_calls?>`,
  "g",
);
const PARAM_HEAD = /^\s*\{\s*"name"\s*:\s*"([^"]+)"\s*\}?\s*>?/;
const PARAM_OPEN = /^\s*<parameter(?:\s+name\s*=\s*"([^"]+)"|=([^\s>]+))\s*>/;
const PARAM_STOPS = ["</parameter>", "<parameter", TOOL_CALL_CLOSE, TOOL_CALL_OPEN];
const GLM_PAIR = /^\s*<arg_key>(.*?)<\/arg_key>\s*<arg_value>(.*?)<\/arg_value>/s;
const GLM_NAME = /^\s*([^\s<>{}"]+)\s*/;

/** 从文字里读出的一个调用：参数是 JSON 对象的原文。 */
interface WrittenCall {
  name: string;
  args: string;
}

/** 读出的调用与它占了多长的文字。 */
interface ReadCall {
  call: WrittenCall;
  length: number;
}

/** 一段扣着的文字读出的调用，与其中既不是调用也不是标签的文字。 */
interface ParsedCalls {
  calls: WrittenCall[];
  rest: string;
}

/** 从这段文字的开头读一个调用；names 是请求给过的工具。 */
interface CallText {
  text: string;
  names: ReadonlySet<string>;
}

type StopEvent = Extract<StreamEvent, { kind: "stop" }>;

function trimStartBlank(text: string): string {
  return text.replace(/^[ \t\r\n]+/, "");
}

interface CallStart {
  at: number;
  tail: number;
}

/** 写进文字的调用从哪开始（没有为 -1）；没有时结尾有几个字符可能是还没写完的开头。 */
function textCallAt(text: string): CallStart {
  const found = TEXT_CALL_MARKS.map((mark) => text.indexOf(mark)).filter((at) => at >= 0);
  if (found.length > 0) return { at: Math.min(...found), tail: 0 };
  const tails = TEXT_CALL_MARKS.map((tag) => partialTagAtEnd({ text, tag }));
  const tail = Math.max(...tails);
  return { at: -1, tail };
}

/** 去掉截在结尾的半个标签。 */
function withoutCutMark(text: string): string {
  return text.slice(0, text.length - cutMark(text).length);
}

/** 截在结尾的半个标签，没有为 ""。 */
function cutMark(text: string): string {
  for (const mark of CUT_MARKS) {
    const length = partialTagAtEnd({ text, tag: mark });
    if (length >= 2) return mark.slice(0, length);
  }
  return "";
}

/**
 * 读以调用开头的这段文字里写的调用：每块都是给过的工具、参数读得出才算，否则为 null；
 * 只有标签没有别的（magpie #823：整个回复只有 <tool_call></｜DSML｜parameter></｜DSML｜invoke></）也算，标签丢掉——
 * 留给 Agent、被模型读回去，它会照样写下一个调用。
 */
function parseTextCalls(input: CallText): ParsedCalls | null {
  const { names } = input;
  const calls: WrittenCall[] = [];
  let text = input.text;
  let left = "";
  while (text !== "") {
    const hermes = text.indexOf(TOOL_CALL_OPEN);
    const dsml = DSML_INVOKE.exec(text);
    const hermesFirst = hermes >= 0 && (dsml === null || hermes < dsml.index);
    if (hermesFirst) {
      left += text.slice(0, hermes);
      const after = text.slice(hermes + TOOL_CALL_OPEN.length);
      const next = trimStartBlank(after);
      // 后面不是 JSON：DeepSeek 自己的标签（invoke 或它的收尾），或什么都没有；丢掉开标签，后面的照常读。
      const opensNoCall = next === "" || next.startsWith("<");
      if (opensNoCall) {
        text = next;
        continue;
      }
      const read = openedCall({ text: after, names });
      if (read === null) return null;
      calls.push(read.call);
      text = after.slice(read.length);
    } else if (dsml !== null) {
      left += text.slice(0, dsml.index);
      const read = dsmlCall({
        text: text.slice(dsml.index),
        name: dsml[1] ?? "",
        open: dsml[0].length,
        names,
      });
      if (read === null) return null;
      calls.push(read.call);
      text = text.slice(dsml.index + read.length);
    } else {
      left += text;
      text = "";
    }
  }
  const unjunked = left.replace(TEXT_CALL_JUNK, "").trim();
  const rest = withoutCutMark(unjunked).trim();
  const isAllCalls = calls.length > 0 || rest === "";
  return isAllCalls ? { calls, rest } : null;
}

/** <tool_call> 之后的调用：DeepSeek 半 Hermes 半参数的、Hermes 的 JSON，再是 GLM 自己的（#906）。 */
function openedCall(input: CallText): ReadCall | null {
  const read = paramCall(input) ?? hermesCall(input);
  if (read !== null) return read;
  return trimStartBlank(input.text).startsWith("{") ? null : glmCall(input);
}

/** 逐字读 JSON 文字时一个字符在哪：字符串外（引号本身也算外）、字符串里、或紧跟在反斜杠后。 */
type JsonSpot = "outside" | "inside" | "escaped";

class JsonStrings {
  private inString = false;
  private escaped = false;

  read(char: string): JsonSpot {
    if (this.escaped) {
      this.escaped = false;
      return "escaped";
    }
    if (char === '"') {
      this.inString = !this.inString;
      return "outside";
    }
    if (!this.inString) return "outside";
    if (char === "\\") this.escaped = true;
    return "inside";
  }
}

const BRACKET_STEP: Record<string, number> = { "{": 1, "[": 1, "}": -1, "]": -1 };
const RAW_CONTROL_ESCAPES: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };

/** 从 { 开始的 JSON 对象在哪结束（之后的下标）；没收尾为 -1。字符串里的括号不算。 */
function objectEnd(text: string): number {
  const strings = new JsonStrings();
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? "";
    if (strings.read(char) !== "outside") continue;
    depth += BRACKET_STEP[char] ?? 0;
    if (depth === 0) return index + 1;
  }
  return -1;
}

/**
 * JSON 文字的字符串里的换行、回车、制表符改成转义：原样写进去的文件内容把它们放进字符串，JSON 不允许。
 */
function escapeRawControls(text: string): string {
  const strings = new JsonStrings();
  let out = "";
  for (const char of text) {
    const escape = strings.read(char) === "inside" ? RAW_CONTROL_ESCAPES[char] : undefined;
    out += escape ?? char;
  }
  return out;
}

/** 调用的参数写成 JSON 对象：给的是 JSON 字符串的读出来，没给的是 {}。 */
function callArgs(value: unknown): string | null {
  if (value === undefined || value === null) return "{}";
  const parsed = typeof value === "string" ? parseJson(escapeRawControls(value.trim())) : value;
  return isRecord(parsed) ? JSON.stringify(parsed) : null;
}

/** 块里给的参数：arguments，没有这个键再看 parameters、input（写了 null 的也算给了）。 */
function givenArgs(block: Record<string, unknown>): unknown {
  const key = ["arguments", "parameters", "input"].find((name) => name in block);
  return key === undefined ? undefined : block[key];
}

/** 参数值是 JSON（数字、对象、列表、true）就照 JSON 取，否则是它写的字符串。 */
function jsonOrText(value: string): unknown {
  const parsed = parseJson(value.trim());
  return parsed === undefined ? value : parsed;
}

/** Hermes 的块：<tool_call> 后面的 JSON 对象。 */
function hermesCall(input: CallText): ReadCall | null {
  const { text, names } = input;
  const lead = text.length - trimStartBlank(text).length;
  const body = text.slice(lead);
  if (!body.startsWith("{")) return null;
  const end = objectEnd(body);
  if (end === -1) return null;
  const value = parseJson(escapeRawControls(body.slice(0, end)));
  if (!isRecord(value)) return null;
  if (typeof value.name !== "string") return null;
  if (!names.has(value.name)) return null;
  const args = callArgs(givenArgs(value));
  if (args === null) return null;
  const call = { name: value.name, args };
  const objectEnds = lead + end;
  return closedCall({ text, call, objectEnds });
}

/**
 * Hermes 的对象之后到收尾标签之间：GLM 在那留下括号、引号或 >（}}</tool_call>、"></tool_call>，#1945），随收尾标签一起拿走。
 * 对象后面紧跟着别的文字、再才收尾，说明对象在字符串里没转义的引号处提前结束了（heredoc 命令被截短，#1945）：
 * 不算调用，免得截错。
 */
function closedCall(input: {
  text: string;
  call: WrittenCall;
  objectEnds: number;
}): ReadCall | null {
  const { text, call, objectEnds } = input;
  const after = text.slice(objectEnds);
  const junk = after.length - after.replace(/^[ \t\r\n}\]"'>]+/, "").length;
  const next = text.slice(objectEnds + junk);
  if (next.startsWith(TOOL_CALL_CLOSE)) {
    return { call, length: objectEnds + junk + TOOL_CALL_CLOSE.length };
  }
  const strayJunk = trimStartBlank(after.slice(0, junk)) !== "";
  const proseRightAfter = junk === 0 && next !== "" && !next.startsWith("<");
  const closesLater = (strayJunk || proseRightAfter) && next.includes(TOOL_CALL_CLOSE);
  return closesLater ? null : { call, length: objectEnds };
}

/**
 * DeepSeek 一半照 Hermes、一半照自己模板写的调用（magpie #917）：名字写成 JSON，以 }、> 收尾或不收尾，
 * 然后每个参数写成 <parameter name="k">v</parameter>（或 Qwen 的 <parameter=k>），收尾常常缺。
 * 值到它的收尾、下一个参数、</tool_call> 或结尾为止；是 JSON 的照 JSON 取，否则是它写的文字。
 */
function paramCall(input: CallText): ReadCall | null {
  const { text, names } = input;
  const head = PARAM_HEAD.exec(text);
  if (head === null) return null;
  const name = head[1] ?? "";
  if (!names.has(name)) return null;
  let at = head[0].length;
  const args: Record<string, unknown> = {};
  for (let open = PARAM_OPEN.exec(text.slice(at)); open; open = PARAM_OPEN.exec(text.slice(at))) {
    const key = open[1] ?? open[2] ?? "";
    at += open[0].length;
    const value = paramValue({ text, from: at });
    const raw = text.slice(at, value.end).replace(/^[\r\n]+|[\r\n]+$/g, "");
    args[key] = jsonOrText(withoutCutMark(raw));
    at = value.next;
  }
  if (Object.keys(args).length === 0) return null;
  return { call: { name, args: JSON.stringify(args) }, length: afterClose({ text, at }) };
}

interface ValueSpan {
  end: number;
  next: number;
}

/** 参数值从 from 起到哪结束、之后从哪接着读（它自己的收尾标签一起跳过）。 */
function paramValue(input: { text: string; from: number }): ValueSpan {
  const { text, from } = input;
  let end = text.length;
  let next = text.length;
  for (const stop of PARAM_STOPS) {
    const found = text.indexOf(stop, from);
    const stopsEarlier = found >= 0 && found < end;
    if (!stopsEarlier) continue;
    end = found;
    next = stop === "</parameter>" ? found + stop.length : found;
  }
  return { end, next };
}

/** at 之后隔着空白就是 </tool_call> 时跳过它。 */
function afterClose(input: { text: string; at: number }): number {
  const { text, at } = input;
  const rest = trimStartBlank(text.slice(at));
  return rest.startsWith(TOOL_CALL_CLOSE) ? text.length - rest.length + TOOL_CALL_CLOSE.length : at;
}

/**
 * GLM 自己的调用（magpie #906：GLM-5.3-Flash 经 vLLM 在 Codex 里写进文字）：<tool_call> 后紧跟工具名，
 * 每个参数是 <arg_key>…</arg_key><arg_value>…</arg_value>，再是 </tool_call>。值是 JSON 的照 JSON 取（GLM 的模板这样写），
 * 否则是它写的字符串。
 */
function glmCall(input: CallText): ReadCall | null {
  const { text, names } = input;
  const head = GLM_NAME.exec(text);
  if (head === null) return null;
  const name = head[1] ?? "";
  if (!names.has(name)) return null;
  let at = head[0].length;
  const args: Record<string, unknown> = {};
  for (let pair = GLM_PAIR.exec(text.slice(at)); pair; pair = GLM_PAIR.exec(text.slice(at))) {
    args[(pair[1] ?? "").trim()] = jsonOrText(pair[2] ?? "");
    at += pair[0].length;
  }
  const rest = trimStartBlank(text.slice(at));
  // 名字后面跟着别的：不是 GLM 的调用。
  const isOther =
    rest !== "" && !rest.startsWith(TOOL_CALL_CLOSE) && !rest.startsWith(TOOL_CALL_OPEN);
  if (isOther) return null;
  return { call: { name, args: JSON.stringify(args) }, length: afterClose({ text, at }) };
}

/** DeepSeek 的 <｜DSML｜invoke name="…"> 与它的参数，到它的收尾、下一个 invoke 或结尾为止。 */
function dsmlCall(input: CallText & { name: string; open: number }): ReadCall | null {
  const { text, name, open, names } = input;
  if (!names.has(name)) return null;
  const inside = text.slice(open);
  const close = DSML_CLOSE.exec(inside);
  const closeEnd = close === null ? text.length : open + close.index + close[0].length;
  const nextInvoke = DSML_INVOKE.exec(inside);
  const nextAt = nextInvoke === null ? text.length : open + nextInvoke.index;
  const end = Math.min(closeEnd, nextAt);
  const args: Record<string, unknown> = {};
  for (const param of text.slice(open, end).matchAll(DSML_PARAM)) {
    const key = param[1] ?? "";
    const value = param[3] ?? "";
    args[key] = DSML_STRING.test(param[2] ?? "") ? value : jsonOrText(value);
  }
  return { call: { name, args: JSON.stringify(args) }, length: end };
}

/** 请求给了工具时，翻译出的回复先过这一道（TextCallFilter）；没给工具时原样交出。 */
export function textCallFilter(input: { tools: Tool[]; emit: EmitEvent }): ReplyFilter {
  const offered = input.tools.map((tool) => tool.name).filter((name) => name !== "");
  const names = new Set(offered);
  return names.size > 0
    ? new TextCallFilter({ names, emit: input.emit })
    : passingFilter(input.emit);
}

/**
 * 从写进文字的调用开始处扣着文字，回复结束（stop）时把扣着的读成调用交出，读不成的照原文交出。
 * 模型自己真调用过工具后，文字就不再读。
 */
class TextCallFilter implements ReplyFilter {
  // 文字的结尾，可能是标签开了个头。
  private pending = "";
  private held = "";
  private holding = false;
  // 回复里有过真调用。
  private native = false;

  constructor(private readonly input: { names: ReadonlySet<string>; emit: EmitEvent }) {}

  event(event: StreamEvent): void {
    switch (event.kind) {
      case "text":
        if (this.native) break;
        this.text(event.text);
        return;
      case "tool_start":
        this.release();
        this.native = true;
        break;
      // 上游做完的搜索接在已经说的文字后面：扣着的先交出。
      case "search":
        this.release();
        break;
      case "stop":
        this.input.emit(this.stop(event));
        return;
      case "error":
        this.release();
        break;
      default:
    }
    this.input.emit(event);
  }

  end(): void {
    this.release();
  }

  private text(piece: string): void {
    const text = this.pending + piece;
    this.pending = "";
    if (this.holding) {
      this.held += text;
      return;
    }
    const { at, tail } = textCallAt(text);
    let said = text;
    if (at >= 0) {
      this.holding = true;
      this.held = text.slice(at);
      said = text.slice(0, at);
    } else {
      this.pending = text.slice(text.length - tail);
      said = text.slice(0, text.length - tail);
    }
    if (said !== "") this.input.emit({ kind: "text", text: said });
  }

  /** 回复结束：扣着的读成调用交出，回复改按调用了工具结束；读不成的照原文交出。 */
  private stop(event: StopEvent): StopEvent {
    const parsed = this.holding
      ? parseTextCalls({ text: this.held, names: this.input.names })
      : null;
    if (parsed !== null) {
      this.holding = false;
      this.held = "";
      if (parsed.rest !== "") this.input.emit({ kind: "text", text: parsed.rest });
      for (const call of parsed.calls) {
        this.input.emit({ kind: "tool_start", id: `call_text_${newId()}`, name: call.name });
        this.input.emit({ kind: "tool_args", text: call.args });
      }
    }
    this.release();
    const madeCalls = parsed !== null && parsed.calls.length > 0;
    return madeCalls ? { ...event, stop: "tool" } : event;
  }

  /** 扣着的照文字交出。 */
  private release(): void {
    const text = this.pending + this.held;
    this.pending = "";
    this.held = "";
    this.holding = false;
    if (text !== "") this.input.emit({ kind: "text", text });
  }
}
