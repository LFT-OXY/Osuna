// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/codex_backend.go 的 codexInputAs、
// localCompactionTurn、compactReply 与 codexCompact 的做法）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import {
  CODEX_COMPACT_PROMPT,
  CODEX_SUMMARY_PREFIX,
  OSUNA_COMPACTION,
  codexCompactionInput,
  compactionEvents,
  compactionReplyOf,
  localCompactionTurn,
} from "./codex-compaction.js";

function userText(text: string) {
  return { type: "message", role: "user", content: [{ type: "input_text", text }] };
}

const SUMMARY = "We fixed the parser; next is the tests.";
const OUR_ITEM = {
  type: "compaction",
  id: "cmp_1",
  encrypted_content: `${OSUNA_COMPACTION}${Buffer.from(SUMMARY).toString("base64")}`,
};

describe("codexCompactionInput", () => {
  test("an endpoint model's compaction_trigger becomes Codex's own request for a summary, with no tools", () => {
    const meta = '{"turn_id":"t1","compaction":{"implementation":"responses_compaction_v2"}}';
    const body = JSON.stringify({
      model: "relay-a/kimi-k2",
      input: [userText("hi"), { type: "compaction_trigger" }],
      tools: [{ type: "function", name: "shell" }],
      tool_choice: "required",
      parallel_tool_calls: true,
      client_metadata: { "x-codex-turn-metadata": meta },
      stream: true,
    });

    const read = codexCompactionInput({ text: body, isEndpointModel: true });

    expect(read.kind).toBe("changed");
    if (read.kind !== "changed") return;
    expect(read.compacts).toBe(true);
    expect(JSON.parse(read.body)).toEqual({
      model: "relay-a/kimi-k2",
      input: [userText("hi"), userText(CODEX_COMPACT_PROMPT)],
      tools: [],
      tool_choice: "auto",
      parallel_tool_calls: false,
      client_metadata: {
        "x-codex-turn-metadata": '{"turn_id":"t1","compaction":{"implementation":"responses"}}',
      },
      stream: true,
    });
  });

  test("a summary Osuna made is read back as the user message Codex would have made of it", () => {
    const body = JSON.stringify({ model: "gpt-5.5", input: [OUR_ITEM, userText("go on")] });
    for (const isEndpointModel of [true, false]) {
      const read = codexCompactionInput({ text: body, isEndpointModel });
      expect(read.kind).toBe("changed");
      if (read.kind !== "changed") return;
      expect(read.compacts).toBe(false);
      expect(JSON.parse(read.body).input).toEqual([
        userText(`${CODEX_SUMMARY_PREFIX}\n${SUMMARY}`),
        userText("go on"),
      ]);
    }
  });

  test("ChatGPT's own compaction items and a ChatGPT model's trigger are left for ChatGPT", () => {
    const body = JSON.stringify({
      model: "gpt-5.5",
      input: [
        { type: "compaction", encrypted_content: "gAAAAAopaque" },
        { type: "compaction_trigger" },
      ],
    });
    expect(codexCompactionInput({ text: body, isEndpointModel: false })).toEqual({
      kind: "unchanged",
    });
  });

  test("a body that is not a Responses request is unchanged", () => {
    expect(codexCompactionInput({ text: "not json", isEndpointModel: true })).toEqual({
      kind: "unchanged",
    });
    expect(codexCompactionInput({ text: '{"input":"hi"}', isEndpointModel: true })).toEqual({
      kind: "unchanged",
    });
  });
});

describe("localCompactionTurn", () => {
  test("says the compaction is the local responses one, the rest byte for byte", () => {
    expect(
      localCompactionTurn(
        '{"turn_id":"t1","compaction":{"implementation":"responses_compaction_v2","x":1}}',
      ),
    ).toBe('{"turn_id":"t1","compaction":{"implementation":"responses","x":1}}');
  });

  test("leaves metadata with no compaction, or already local, alone", () => {
    expect(localCompactionTurn('{"turn_id":"t1"}')).toBeNull();
    expect(localCompactionTurn('{"compaction":{"implementation":"responses"}}')).toBeNull();
    expect(localCompactionTurn("not json")).toBeNull();
  });
});

describe("compactionReplyOf", () => {
  test("reads the summary from a streamed reply", () => {
    const stream = [
      'data: {"type":"response.created","response":{"id":"resp_9"}}',
      'data: {"type":"response.output_item.done","item":{"type":"message","content":[{"type":"output_text","text":"Sum"},{"type":"output_text","text":"mary"}]}}',
      'data: {"type":"response.completed","response":{"id":"resp_9","status":"completed","usage":{"input_tokens":5}}}',
    ].join("\n\n");
    expect(compactionReplyOf(`${stream}\n\n`)).toEqual({
      kind: "summary",
      id: "resp_9",
      summary: "Summary",
      usage: { input_tokens: 5 },
    });
  });

  test("reads the summary from a whole JSON reply", () => {
    const whole = JSON.stringify({
      id: "resp_2",
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "S" }] }],
    });
    expect(compactionReplyOf(whole)).toEqual({
      kind: "summary",
      id: "resp_2",
      summary: "S",
      usage: null,
    });
  });

  test("a failed, cut-off or incomplete reply is no summary", () => {
    expect(compactionReplyOf('data: {"type":"error","message":"overloaded"}\n\n')).toEqual({
      kind: "failed",
      message: "overloaded",
    });
    expect(
      compactionReplyOf('data: {"type":"response.created","response":{"id":"r"}}\n\n'),
    ).toEqual({ kind: "failed", message: "the reply ended before it was complete" });
    expect(
      compactionReplyOf(
        'data: {"type":"response.incomplete","response":{"id":"r","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}\n\n',
      ),
    ).toEqual({ kind: "failed", message: "the reply ended incomplete (max_output_tokens)" });
  });
});

describe("compactionEvents", () => {
  test("hands Codex the compaction item ChatGPT would have made, marked as Osuna's", () => {
    const events = compactionEvents({ id: "resp_9", summary: SUMMARY, usage: null });
    const item = { type: "compaction", id: "cmp_9", encrypted_content: OUR_ITEM.encrypted_content };
    expect(events).toBe(
      [
        `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { id: "resp_9", object: "response", status: "in_progress", output: [] } })}`,
        `event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item })}`,
        `event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item })}`,
        `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_9", object: "response", status: "completed", output: [item] } })}`,
        "",
      ].join("\n\n"),
    );
  });
});
