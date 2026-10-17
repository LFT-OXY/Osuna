// 用例照 magpie（https://github.com/yetone/magpie，internal/gateway/quiet_whole_test.go 的 TestQuietWholeReplyStreamed）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { describe, expect, test } from "vitest";
import { ReplyCollector } from "./translation/ir.js";
import { protocolOf } from "./translation/protocols.js";
import { isWholeReply, wholeEvents } from "./whole-stream.js";

const RESPONSES_WHOLE = {
  id: "resp_1",
  object: "response",
  created_at: 1791370000,
  status: "completed",
  model: "m",
  output: [
    {
      type: "reasoning",
      id: "rs_1",
      summary: [{ type: "summary_text", text: "The user wants the weather." }],
      encrypted_content: "gAAAAB",
    },
    {
      type: "message",
      id: "msg_1",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: "Checking.", annotations: [] }],
    },
    {
      type: "function_call",
      id: "fc_1",
      status: "completed",
      call_id: "call_1",
      name: "get_weather",
      arguments: '{"city":"Paris"}',
    },
  ],
  usage: { input_tokens: 12, output_tokens: 9, total_tokens: 21 },
};

interface NotWhole {
  format: ApiEndpointRequestFormat;
  body: unknown;
}

describe("a whole reply said as its protocol's stream", () => {
  test("a Responses response streams its reasoning, text and call, and Codex reads them back", () => {
    const events = wholeEvents("openai_responses", RESPONSES_WHOLE) ?? [];
    const collector = new ReplyCollector();
    const decoder = protocolOf("openai_responses").decoder();
    for (const event of events) {
      decoder.decode(JSON.stringify(event.data), (decoded) => collector.add(decoded));
    }

    expect(events.map((event) => event.name)).toEqual([
      "response.created",
      "response.in_progress",
      "response.output_item.added",
      "response.reasoning_summary_part.added",
      "response.reasoning_summary_text.delta",
      "response.reasoning_summary_text.done",
      "response.reasoning_summary_part.done",
      "response.output_item.done",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.output_item.added",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.done",
      "response.output_item.done",
      "response.completed",
    ]);
    expect(events.map((event) => event.data.sequence_number)).toEqual([...events.keys()]);
    expect(collector.finish()).toEqual({
      id: "resp_1",
      parts: [
        { kind: "thinking", text: "The user wants the weather.", signature: "" },
        { kind: "text", text: "Checking." },
        { kind: "tool_call", id: "call_1", name: "get_weather", args: '{"city":"Paris"}' },
      ],
      stop: "tool",
      usage: { input: 12, output: 9, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 },
    });
  });

  test.each<NotWhole>([
    { format: "anthropic_messages", body: { type: "error", error: { message: "busy" } } },
    { format: "openai_responses", body: { status: "queued", task: "t1" } },
    { format: "openai_chat", body: { choices: [] } },
    { format: "openai_chat", body: { choices: [{ index: 0, delta: {} }] } },
  ])("$format: $body is no whole reply", ({ format, body }) => {
    expect(isWholeReply(format, body)).toBe(false);
    expect(wholeEvents(format, body)).toBeNull();
  });
});
