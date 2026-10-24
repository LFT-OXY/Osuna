// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway 的 chattidy_test.go、mistral_parts_test.go、
// textcalls_test.go 与 textcalls_whole_test.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import {
  ChatStreamTidy,
  ChatWholeTidy,
  TextCallStreamTidy,
  chatToolNames,
} from "./chat-reply-tidy.js";
import type { ReplyTidy } from "./reply-tidy.js";

/** 一段段喂进去（每个位置切成两段也一样），交出的全文。 */
function tidied(make: () => ReplyTidy, text: string): string[] {
  const outs: string[] = [];
  for (let at = 0; at < text.length; at += 7) {
    const tidy = make();
    outs.push(tidy.write(text.slice(0, at)) + tidy.write(text.slice(at)) + tidy.end());
  }
  return outs;
}

const line = (chunk: unknown) => `data: ${JSON.stringify(chunk)}\n\n`;

describe("a Chat stream passed through as it came (magpie chatTidy)", () => {
  test("an empty reasoning_content, an empty finish_reason, an empty tool name and tool_calls: [] are left out", () => {
    const stream =
      line({
        id: "c1",
        choices: [
          {
            index: 0,
            delta: { content: "hi", reasoning_content: "", tool_calls: [] },
            finish_reason: "",
          },
        ],
      }) +
      line({
        id: "c1",
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { name: "", arguments: "{}" } }] },
            finish_reason: null,
          },
        ],
      }) +
      "data: [DONE]\n\n";
    const want =
      line({ id: "c1", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] }) +
      line({
        id: "c1",
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] },
            finish_reason: null,
          },
        ],
      }) +
      "data: [DONE]\n\n";
    for (const out of tidied(() => new ChatStreamTidy(), stream)) expect(out).toBe(want);
  });

  test("Mistral's typed content: thinking goes to reasoning_content, text to a string (#483)", () => {
    const stream = line({
      id: "c1",
      choices: [
        {
          index: 0,
          delta: {
            content: [
              { type: "thinking", thinking: [{ type: "text", text: "hmm" }] },
              { type: "text", text: "ok" },
            ],
          },
        },
      ],
    });
    const want = line({
      id: "c1",
      choices: [{ index: 0, delta: { content: "ok", reasoning_content: "hmm" } }],
    });
    for (const out of tidied(() => new ChatStreamTidy(), stream)) expect(out).toBe(want);
  });

  test("a stream with none of those goes byte for byte", () => {
    const stream = 'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n';
    for (const out of tidied(() => new ChatStreamTidy(), stream)) expect(out).toBe(stream);
  });
});

describe("a call a model wrote into its text, in a Chat stream passed through (magpie textCallTidy)", () => {
  const names = chatToolNames({ tools: [{ type: "function", function: { name: "read" } }] })!;
  const written = '<tool_call>{"name": "read", "arguments": {"path": "a.txt"}}</tool_call>';

  test("becomes a tool call and the reply ends calling tools", () => {
    const stream =
      line({
        id: "c1",
        model: "m",
        choices: [{ index: 0, delta: { content: `look ${written.slice(0, 20)}` } }],
      }) +
      line({
        id: "c1",
        model: "m",
        choices: [{ index: 0, delta: { content: written.slice(20) } }],
      }) +
      line({ id: "c1", model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
      "data: [DONE]\n\n";
    for (const out of tidied(() => new TextCallStreamTidy(names), stream)) {
      const chunks = out
        .split("\n")
        .filter((part) => part.startsWith("data: {"))
        .map(
          (part) =>
            JSON.parse(part.slice(6)) as {
              choices: { delta: Record<string, unknown>; finish_reason: unknown }[];
            },
        );
      const content = chunks.map((chunk) => chunk.choices[0]!.delta.content ?? "").join("");
      expect(content).toBe("look ");
      const calls = chunks.flatMap(
        (chunk) => (chunk.choices[0]!.delta.tool_calls as unknown[]) ?? [],
      );
      expect(calls).toMatchObject([
        { index: 0, type: "function", function: { name: "read", arguments: '{"path":"a.txt"}' } },
      ]);
      expect(chunks.at(-1)!.choices[0]!.finish_reason).toBe("tool_calls");
      expect(out.endsWith("data: [DONE]\n\n")).toBe(true);
    }
  });

  test("a written block naming a tool not offered stays text", () => {
    const other = '<tool_call>{"name": "rm", "arguments": {}}</tool_call>';
    const stream =
      line({ id: "c1", choices: [{ index: 0, delta: { content: other } }] }) +
      line({ id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    const tidy = new TextCallStreamTidy(names);
    const out = tidy.write(stream) + tidy.end();
    expect(out).toContain(JSON.stringify(other).slice(1, -1));
    expect(out).toContain('"finish_reason":"stop"');
  });
});

describe("a whole Chat reply passed through (magpie chatWhole)", () => {
  test("typed content is flattened, and a call written into the text becomes a call", () => {
    const names = chatToolNames({ tools: [{ type: "function", function: { name: "read" } }] });
    const reply = JSON.stringify({
      id: "c1",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: [{ type: "text", text: "hmm" }] },
              {
                type: "text",
                text: 'sure <tool_call>{"name": "read", "arguments": {"path": "a"}}</tool_call>',
              },
            ],
          },
          finish_reason: "stop",
        },
      ],
    });
    const tidy = new ChatWholeTidy(names);
    const out = JSON.parse(tidy.write(reply) + tidy.end()) as {
      choices: { message: Record<string, unknown>; finish_reason: string }[];
    };
    expect(out.choices[0]!.message).toMatchObject({
      content: "sure ",
      reasoning_content: "hmm",
      tool_calls: [{ type: "function", function: { name: "read", arguments: '{"path":"a"}' } }],
    });
    expect(out.choices[0]!.finish_reason).toBe("tool_calls");
  });

  test("a plain reply goes byte for byte", () => {
    const reply = '{"id":"c1", "choices":[{"message":{"content":"hi"}}]}';
    const tidy = new ChatWholeTidy(null);
    expect(tidy.write(reply) + tidy.end()).toBe(reply);
  });
});
