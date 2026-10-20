import { applyEdits, findNodeAtLocation, modify, parseTree, type JSONPath } from "jsonc-parser";
import { isRecord, parseJson } from "../upstream-http.js";
import type { PassedReplyFormat } from "./grok-integral.js";

/*
 * 直通的回复交给 Agent 之前改几处：一段段喂进来，交出改好的文字。流按行处理，不是流的攒齐了在最后改。
 */
export interface ReplyTidy {
  write(text: string): string;
  end(): string;
}

/** 几个改法接成一个：前一个交出的文字喂给后一个；一个都没有为 null。 */
export function chainedTidy(tidies: ReplyTidy[]): ReplyTidy | null {
  const [first, ...rest] = tidies;
  if (first === undefined) return null;
  if (rest.length === 0) return first;
  return {
    write: (text) => rest.reduce((out, tidy) => tidy.write(out), first.write(text)),
    end: () =>
      rest.reduce((out, tidy) => {
        const written = tidy.write(out);
        return written + tidy.end();
      }, first.end()),
  };
}

// 回复里写模型名的地方：Anthropic 的 message_start 与整份回复，Responses 的 response.* 事件与整份回复。
const MODEL_PATHS: Readonly<Record<PassedReplyFormat, JSONPath[]>> = {
  anthropic_messages: [["message", "model"], ["model"]],
  openai_responses: [["response", "model"], ["model"]],
};

/**
 * 按上游模型名发出的请求，回复里说的正是那个名字时换回这家列出的写法：Agent 看到的模型名不随上游模型名变。
 * 上游说的是别的名字（真换了模型）照原样。只改那个字符串，别的字节原样。
 */
export class ReplyModelName implements ReplyTidy {
  private held = "";

  constructor(
    private readonly reply: {
      format: PassedReplyFormat;
      stream: boolean;
      // 发给上游的名字与要换回的名字。
      sent: string;
      shown: string;
    },
  ) {}

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

  private lines(text: string): string {
    if (!text.includes('"model"')) return text;
    return text
      .split(/(?<=\n)/)
      .map((line) => {
        const isData = line.startsWith("data:") && line.includes('"model"');
        if (!isData) return line;
        return `data:${this.event(line.slice("data:".length))}`;
      })
      .join("");
  }

  /** 一个事件（或整份回复）的 JSON 原文，说的是发出去的名字的那几处换回来；读不懂的原样。 */
  private event(text: string): string {
    if (!isRecord(parseJson(text))) return text;
    let out = text;
    for (const path of MODEL_PATHS[this.reply.format]) {
      const root = parseTree(out);
      const node = root === undefined ? undefined : findNodeAtLocation(root, path);
      if (node?.type !== "string" || node.value !== this.reply.sent) continue;
      out = applyEdits(out, modify(out, path, this.reply.shown, {}));
    }
    return out;
  }
}
