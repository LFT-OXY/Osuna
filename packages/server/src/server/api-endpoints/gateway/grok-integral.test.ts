// 用例照 magpie（MIT，THIRD_PARTY_NOTICES）的 grok_integral_test.go：TestWholeNumsAnyCut 的数字、
// messagesCall、responsesCall 的上游回复。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import {
  WholeArgsTidy,
  WholeNumbers,
  wholeArgs,
  wholeArgsFilter,
  type PassedReplyFormat,
} from "./grok-integral.js";
import type { StreamEvent } from "./translation/ir.js";

const NUMBER_CASES: [string, string][] = [
  [
    `{"yield_time_ms":2500.0,"max_output_tokens":4000.0}`,
    `{"yield_time_ms":2500,"max_output_tokens":4000}`,
  ],
  [`{"a":-3.00,"b":[1.0,2.0],"c":0.0,"d":-0.0}`, `{"a":-3,"b":[1,2],"c":0,"d":-0}`],
  [`{"a":2.5,"b":2.50,"c":2.05,"d":2.500e1}`, `{"a":2.5,"b":2.50,"c":2.05,"d":2.500e1}`],
  [
    `{"a":1.0e3,"b":1.0E-3,"c":2.5e3,"d":1e3,"e":10}`,
    `{"a":1.0e3,"b":1.0E-3,"c":2.5e3,"d":1e3,"e":10}`,
  ],
  [
    `{"1.0":"2.0","s":"a\\"1.0\\\\","t":"\\\\\\\\"," n":3.0 }`,
    `{"1.0":"2.0","s":"a\\"1.0\\\\","t":"\\\\\\\\"," n":3 }`,
  ],
  [`{"ok":true,"no":null,"x":false}`, `{"ok":true,"no":null,"x":false}`],
  [`[100.000, 7.0]`, `[100, 7]`],
];

/** 参数被流切开的各种样子：整段、一个字符一段、在每个位置切成两段。 */
function cutsOf(text: string): string[][] {
  const cuts = [[text], [...text]];
  for (let at = 1; at < text.length; at++) cuts.push([text.slice(0, at), text.slice(at)]);
  return cuts;
}

describe("a Grok call's arguments lose a fraction of zeros (magpie TestWholeNumsAnyCut)", () => {
  test.each(NUMBER_CASES)("%s, however it is cut, reads %s", (args, want) => {
    expect(wholeArgs(args)).toBe(want);
    for (const pieces of cutsOf(args)) {
      const numbers = new WholeNumbers();
      expect(pieces.map((piece) => numbers.feed(piece)).join("")).toBe(want);
    }
  });

  test("a translated reply's argument deltas: a held fraction waits for the next piece", () => {
    const events: StreamEvent[] = [];
    const filter = wholeArgsFilter((event) => events.push(event));
    for (const event of [
      { kind: "tool_start", id: "call_1", name: "exec_command" },
      { kind: "tool_args", text: `{"yield_time_ms":2500.` },
      { kind: "tool_args", text: `0` },
      { kind: "tool_args", text: `,"cmd":"sleep 2.0"}` },
      { kind: "tool_start", id: "call_2", name: "write_stdin" },
      { kind: "tool_args", text: `{"session_id":17277.0}` },
      { kind: "stop", stop: "tool" },
    ] satisfies StreamEvent[]) {
      filter.event(event);
    }
    filter.end();
    expect(events).toEqual([
      { kind: "tool_start", id: "call_1", name: "exec_command" },
      { kind: "tool_args", text: `{"yield_time_ms":2500` },
      { kind: "tool_args", text: `,"cmd":"sleep 2.0"}` },
      { kind: "tool_start", id: "call_2", name: "write_stdin" },
      { kind: "tool_args", text: `{"session_id":17277}` },
      { kind: "stop", stop: "tool" },
    ]);
  });
});

/*
 * 直通的 Grok 回复：上游原样的字节按段到达，段的边界可以落在任何地方；只改调用参数，其余字节原样。
 */

function tidied(input: { format: PassedReplyFormat; stream: boolean; chunks: string[] }): string {
  const tidy = new WholeArgsTidy({ format: input.format, stream: input.stream });
  return input.chunks.map((chunk) => tidy.write(chunk)).join("") + tidy.end();
}

/** 整段，与在每个位置切成两段。 */
function splits(text: string): string[][] {
  const cuts = [[text]];
  for (let at = 1; at < text.length; at++) cuts.push([text.slice(0, at), text.slice(at)]);
  return cuts;
}

const ARGS = `{"cmd":"sleep 2.0","yield_time_ms":2500.0}`;
const WHOLE = `{"cmd":"sleep 2.0","yield_time_ms":2500}`;

const sse = (lines: string[]) => lines.map((line) => `${line}\n\n`).join("");

// magpie messagesCall：参数切在 `2500.` 之后。
const anthropicLines = (pieces: [string, string]) => [
  `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"grok-4.6","content":[],"usage":{"input_tokens":10,"output_tokens":1}}}`,
  `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"exec_command","input":{}}}`,
  `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(pieces[0])}}}`,
  `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(pieces[1])}}}`,
  `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}`,
  `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}`,
  `event: message_stop\ndata: {"type":"message_stop"}`,
];

// magpie responsesCall：参数切在 `2500.` 之后。
const responsesLines = (input: { pieces: [string, string]; args: string }) => {
  const call = `{"type":"function_call","id":"fc_1","call_id":"call_1","name":"exec_command","arguments":${JSON.stringify(input.args)},"status":"completed"}`;
  const done = `{"id":"resp_1","object":"response","status":"completed","model":"grok-4.6","output":[${call}],"usage":{"input_tokens":5,"output_tokens":3}}`;
  const delta = (piece: string) =>
    `event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","sequence_number":2,"item_id":"fc_1","output_index":0,"delta":${JSON.stringify(piece)}}`;
  return [
    `event: response.created\ndata: {"type":"response.created","sequence_number":0,"response":{"id":"resp_1","object":"response","status":"in_progress","output":[]}}`,
    `event: response.output_item.added\ndata: {"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"exec_command","arguments":"","status":"in_progress"}}`,
    delta(input.pieces[0]),
    delta(input.pieces[1]),
    `event: response.function_call_arguments.done\ndata: {"type":"response.function_call_arguments.done","sequence_number":3,"item_id":"fc_1","output_index":0,"arguments":${JSON.stringify(input.args)}}`,
    `event: response.output_item.done\ndata: {"type":"response.output_item.done","sequence_number":4,"output_index":0,"item":${call}}`,
    `event: response.completed\ndata: {"type":"response.completed","sequence_number":5,"response":${done}}`,
  ];
};

describe("a Grok reply passed through has its calls' whole numbers written whole (magpie intTidy)", () => {
  test("an Anthropic stream, cut anywhere: only the argument deltas change", () => {
    const stream = sse(anthropicLines([`{"cmd":"sleep 2.0","yield_time_ms":2500.`, `0}`]));
    const want = sse(anthropicLines([`{"cmd":"sleep 2.0","yield_time_ms":2500`, `}`]));
    for (const chunks of splits(stream)) {
      expect(tidied({ format: "anthropic_messages", stream: true, chunks })).toBe(want);
    }
  });

  test("a Responses stream, cut anywhere: deltas, done arguments, the item and the completed output", () => {
    const stream = sse(
      responsesLines({ pieces: [`{"cmd":"sleep 2.0","yield_time_ms":2500.`, `0}`], args: ARGS }),
    );
    const want = sse(
      responsesLines({ pieces: [`{"cmd":"sleep 2.0","yield_time_ms":2500`, `}`], args: WHOLE }),
    );
    for (const chunks of splits(stream)) {
      expect(tidied({ format: "openai_responses", stream: true, chunks })).toBe(want);
    }
  });

  test("a whole Anthropic reply: the tool_use input's numbers, a big integer kept as written", () => {
    const reply = (input: string) =>
      `{"id":"msg_1","type":"message","role":"assistant","model":"grok-4.6","content":[{"type":"text","text":"2.0"},{"type":"tool_use","id":"toolu_1","name":"exec_command","input":${input}}],"stop_reason":"tool_use","usage":{"input_tokens":10,"output_tokens":5}}`;
    const chunks = [reply(`{"yield_time_ms":2500.0, "id":12345678901234567890}`)];
    expect(tidied({ format: "anthropic_messages", stream: false, chunks })).toBe(
      reply(`{"yield_time_ms":2500, "id":12345678901234567890}`),
    );
  });

  test("a whole Responses reply: the output's call arguments", () => {
    const reply = (args: string) =>
      `{"id":"resp_1","object":"response","status":"completed","model":"grok-4.6","output":[{"type":"function_call","id":"fc_1","call_id":"call_1","name":"exec_command","arguments":${JSON.stringify(args)},"status":"completed"}]}`;
    expect(tidied({ format: "openai_responses", stream: false, chunks: [reply(ARGS)] })).toBe(
      reply(WHOLE),
    );
  });

  test("a Chat stream, cut anywhere: each call's argument deltas", () => {
    const chunk = (index: number, args: string) =>
      `data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":${index},"function":{"arguments":${JSON.stringify(args)}}}]}}]}`;
    const lines = (pieces: [string, string, string]) => [
      `data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"exec_command","arguments":""}},{"index":1,"id":"call_2","type":"function","function":{"name":"write_stdin","arguments":""}}]}}]}`,
      chunk(0, pieces[0]),
      chunk(1, pieces[1]),
      chunk(0, pieces[2]),
      `data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
      "data: [DONE]",
    ];
    const stream = sse(lines([`{"yield_time_ms":2500.`, `{"session_id":17277.0}`, `0}`]));
    const want = sse(lines([`{"yield_time_ms":2500`, `{"session_id":17277}`, `}`]));
    for (const chunks of splits(stream)) {
      expect(tidied({ format: "openai_chat", stream: true, chunks })).toBe(want);
    }
  });

  test("a whole Chat reply: the message's call arguments", () => {
    const reply = (args: string) =>
      `{"id":"chatcmpl-1","object":"chat.completion","model":"grok-4.6","choices":[{"index":0,"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"exec_command","arguments":${JSON.stringify(args)}}}]},"finish_reason":"tool_calls"}]}`;
    expect(tidied({ format: "openai_chat", stream: false, chunks: [reply(ARGS)] })).toBe(
      reply(WHOLE),
    );
  });

  test("a stream without calls goes byte for byte", () => {
    const stream = sse([
      `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"2500.0"}}`,
    ]);
    expect(tidied({ format: "anthropic_messages", stream: true, chunks: [stream] })).toBe(stream);
  });
});
