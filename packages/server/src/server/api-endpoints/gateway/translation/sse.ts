// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gateway/sse.go；只用 event: 行命名的事件照 fallback.go 的 streamEvent）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { isRecord, parseJson } from "../../upstream-http.js";

/*
 * 服务器推送事件（SSE）的读与写。上游的流一段段到，一个事件可能被切在两段之间；
 * 读的一侧只关心每个事件的 data（多行 data 用换行接起来），事件名各协议的 data 里都有；
 * data 里没写 type、只用 `event:` 行命名的（如 `event: error` 加 `data: {"message":…}`），把事件名当 type 补进 data。
 */

export class SseReader {
  private buffer = "";
  private data: string[] = [];
  // 这个事件 `event:` 行写的名字。
  private name: string | null = null;

  constructor(private readonly onData: (data: string) => void) {}

  feed(text: string): void {
    this.buffer += text;
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      this.line(this.buffer.slice(0, newline).replace(/\r$/, ""));
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
    }
  }

  /** 流结束：没以空行收尾的最后一个事件也算。 */
  end(): void {
    if (this.buffer !== "") this.line(this.buffer.replace(/\r$/, ""));
    this.buffer = "";
    this.flush();
  }

  private line(line: string): void {
    if (line === "") {
      this.flush();
    } else if (line.startsWith("data:")) {
      this.data.push(line.slice(5).replace(/^ /, ""));
    } else if (line.startsWith("event:")) {
      this.name = line.slice(6).trim();
    }
  }

  private flush(): void {
    const { name } = this;
    this.name = null;
    if (this.data.length === 0) return;
    const data = this.data.join("\n");
    this.data = [];
    this.onData(typedByName({ data, name }));
  }
}

/** 有事件名、data 是顶层没写 type 的对象时补上事件名；别的原样。 */
function typedByName(input: { data: string; name: string | null }): string {
  const { data, name } = input;
  // 各协议自己的事件都以 type 开头：不必解析。
  const leadsWithType = data.startsWith('{"type":');
  const named = name !== null && name !== "";
  if (!named || leadsWithType) return data;
  const event = parseJson(data);
  if (!isRecord(event) || typeof event.type === "string") return data;
  return JSON.stringify({ ...event, type: name });
}

/** 一个事件的原文：有名字的写 `event:` 行（Anthropic），没名字的只有 data（OpenAI）。 */
export function sseEvent(name: string | null, data: unknown): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return `${name === null ? "" : `event: ${name}\n`}data: ${payload}\n\n`;
}
