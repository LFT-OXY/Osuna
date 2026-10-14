// 部分逻辑移植自 magpie（https://github.com/yetone/magpie，internal/gateway/sse.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

/*
 * 服务器推送事件（SSE）的读与写。上游的流一段段到，一个事件可能被切在两段之间；
 * 读的一侧只关心每个事件的 data（多行 data 用换行接起来），事件名各协议的 data 里都有。
 */

export class SseReader {
  private buffer = "";
  private data: string[] = [];

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
    }
  }

  private flush(): void {
    if (this.data.length === 0) return;
    const data = this.data.join("\n");
    this.data = [];
    this.onData(data);
  }
}

/** 一个事件的原文：有名字的写 `event:` 行（Anthropic），没名字的只有 data（OpenAI）。 */
export function sseEvent(name: string | null, data: unknown): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return `${name === null ? "" : `event: ${name}\n`}data: ${payload}\n\n`;
}
