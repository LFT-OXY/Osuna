import { findNodeAtLocation, parseTree, type JSONPath } from "jsonc-parser";
import type { PassedReplyFormat } from "./grok-integral.js";

/*
 * 直通的回复交给 Agent 之前改几处：一段段喂进来，交出改好的文字。
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
    end: () => rest.reduce((out, tidy) => tidy.write(out) + tidy.end(), first.end()),
  };
}

/**
 * 按事件改的回复：流按整行交出，只把可能要改的 `data:` 行交给 event，其余字节原样；不是流的回复攒齐了在最后整份交给 event。
 * 行没收完的那段扣到下一次。
 */
export abstract class JsonEventTidy implements ReplyTidy {
  private held = "";

  protected constructor(private readonly stream: boolean) {}

  write(text: string): string {
    this.held += text;
    if (!this.stream) return "";
    const end = this.held.lastIndexOf("\n");
    if (end < 0) return "";
    const lines = this.held.slice(0, end + 1);
    this.held = this.held.slice(end + 1);
    return this.lines(lines);
  }

  end(): string {
    const rest = this.held;
    this.held = "";
    if (this.stream) return this.lines(rest);
    return this.event(rest);
  }

  /** 这段文字可能带着要改的东西；不带的整段原样交出。 */
  protected abstract carries(text: string): boolean;

  /** 一个事件（或整份回复）的 JSON 原文改好；读不懂的原样。 */
  protected abstract event(text: string): string;

  private lines(text: string): string {
    if (!this.carries(text)) return text;
    return text
      .split(/(?<=\n)/)
      .map((line) => {
        const isData = line.startsWith("data:") && this.carries(line);
        if (!isData) return line;
        return `data:${this.event(line.slice("data:".length))}`;
      })
      .join("");
  }
}

// 回复里写模型名的地方：Anthropic 的 message_start 与整份回复，Responses 的 response.* 事件与整份回复。
const MODEL_PATHS: Readonly<Record<PassedReplyFormat, JSONPath[]>> = {
  anthropic_messages: [["message", "model"], ["model"]],
  openai_responses: [["response", "model"], ["model"]],
  openai_chat: [["model"]],
};

/**
 * 按上游模型名发出的请求，回复里说的正是那个名字时换回这家列出的写法：Agent 看到的模型名不随上游模型名变。
 * 上游说的是别的名字（真换了模型）照原样。只换那个字符串，别的字节原样；每个事件只解析一次。
 */
export class ReplyModelName extends JsonEventTidy {
  constructor(
    private readonly reply: {
      format: PassedReplyFormat;
      stream: boolean;
      // 发给上游的名字与要换回的名字。
      sent: string;
      shown: string;
    },
  ) {
    super(reply.stream);
  }

  protected carries(text: string): boolean {
    return text.includes('"model"');
  }

  protected event(text: string): string {
    const root = parseTree(text);
    if (root?.type !== "object") return text;
    const nodes = MODEL_PATHS[this.reply.format]
      .map((path) => findNodeAtLocation(root, path))
      .filter((node) => node?.type === "string" && node.value === this.reply.sent)
      .sort((a, b) => (b?.offset ?? 0) - (a?.offset ?? 0));
    let out = text;
    for (const node of nodes) {
      if (node === undefined) continue;
      const shown = JSON.stringify(this.reply.shown);
      out = out.slice(0, node.offset) + shown + out.slice(node.offset + node.length);
    }
    return out;
  }
}
