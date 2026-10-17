// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway 的 join_tool_runs_test.go、pair_tool_items_test.go、orphan_tool_output_test.go、phase_test.go、codex_access_programs_test.go 与 responses.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import {
  AnthropicDecoder,
  AnthropicEncoder,
  buildAnthropicRequest,
  parseAnthropicRequest,
  renderAnthropic,
} from "./anthropic.js";
import { buildChatRequest, parseChatRequest } from "./chat.js";
import {
  ReplyCollector,
  RequestShapeError,
  emptyUsage,
  thinkingBackOn,
  type GatewayRequest,
  type StreamEvent,
} from "./ir.js";
import {
  ResponsesDecoder,
  ResponsesEncoder,
  buildResponsesRequest,
  renderResponses,
  replayedReasoningInput,
  usageFromResponses,
  usageToResponses,
  joinToolRuns,
  orphanedToolOutputs,
  pairToolItems,
  parseResponsesRequest,
} from "./responses.js";

/*
 * Responses 请求的工具配对修补。例子照 magpie 的
 * join_tool_runs_test.go、pair_tool_items_test.go、orphan_tool_output_test.go 与 phase_test.go；
 * 流里 invalid_request_error 的字段照 codex_access_programs_test.go 与 responses.go 的 requestRefused。
 */

const INTERRUPTED = "[The result of this tool call is unavailable: the turn was interrupted.]";

function inputOf(body: string): Record<string, unknown>[] {
  return (JSON.parse(body) as { input: Record<string, unknown>[] }).input;
}

describe("a call with no result in a Responses request (magpie pair_tool_items_test.go)", () => {
  test("a lone call gets a synthetic result after it", () => {
    const input = inputOf(
      pairToolItems(
        '{"model":"m","input":[' +
          '{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]},' +
          '{"type":"function_call","call_id":"call_lone","name":"echo","arguments":"{}"},' +
          '{"type":"message","role":"user","content":[{"type":"input_text","text":"again"}]}]}',
      ),
    );
    expect(input).toHaveLength(4);
    expect(input[2]).toEqual({
      type: "function_call_output",
      call_id: "call_lone",
      output: INTERRUPTED,
    });
  });

  test("a custom tool call gets a custom result", () => {
    const input = inputOf(
      pairToolItems(
        '{"model":"m","input":[{"type":"custom_tool_call","call_id":"call_c","name":"apply_patch","input":"x"}]}',
      ),
    );
    expect(input[1]).toEqual({
      type: "custom_tool_call_output",
      call_id: "call_c",
      output: INTERRUPTED,
    });
  });

  test("the synthetic result goes at the end of the run of calls and results", () => {
    const input = inputOf(
      pairToolItems(
        '{"model":"m","input":[' +
          '{"type":"function_call","call_id":"c1","name":"echo","arguments":"{}"},' +
          '{"type":"function_call","call_id":"c2","name":"echo","arguments":"{}"},' +
          '{"type":"function_call_output","call_id":"c2","output":"second"},' +
          '{"type":"message","role":"user","content":[{"type":"input_text","text":"next"}]}]}',
      ),
    );
    expect(input.map((item) => `${String(item.type)}:${String(item.call_id ?? "")}`)).toEqual([
      "function_call:c1",
      "function_call:c2",
      "function_call_output:c2",
      "function_call_output:c1",
      "message:",
    ]);
  });

  test("a request with nothing to mend comes back byte for byte", () => {
    for (const body of [
      '{"model":"m","input":[{"type":"function_call","call_id":"c1","name":"echo","arguments":"{}"},{"type":"function_call_output","call_id":"c1","output":"ok"}]}',
      '{"model":"m","input":[{"type":"function_call","call_id":"c1","name":"echo","arguments":"{}"},{"type":"function_call","call_id":"c2","name":"echo","arguments":"{}"},{"type":"function_call_output","call_id":"c2","output":"second"},{"type":"function_call_output","call_id":"c1","output":"first"}]}',
      '{"model":"m","input":[{"type":"custom_tool_call","call_id":"c3","name":"apply_patch","input":"x"},{"type":"custom_tool_call_output","call_id":"c3","output":"done"}]}',
      '{"model":"m","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]}]}',
      '{"model":"m","previous_response_id":"resp_1","input":[{"type":"function_call_output","call_id":"call_gone","output":"late result"}]}',
      "not json",
      "{}",
      '{"input":"hello"}',
    ]) {
      expect(pairToolItems(body)).toBe(body);
    }
  });
});

describe("a tool result with no call id (magpie orphan_tool_output_test.go)", () => {
  test("becomes a user message with its text and images", () => {
    const fixed = orphanedToolOutputs(
      '{"model":"fake/m1","previous_response_id":"resp_synthetic","input":[{"type":"function_call_output","output":[{"type":"text","text":"look"},{"type":"input_image","image_url":"data:image/png;base64,AQID"}]},{"type":"function_call_output","output":""}]}',
    );
    expect(JSON.parse(fixed)).toEqual({
      model: "fake/m1",
      previous_response_id: "resp_synthetic",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "look" },
            { type: "input_image", detail: "auto", image_url: "data:image/png;base64,AQID" },
          ],
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Tool result received." }],
        },
      ],
    });
    expect(orphanedToolOutputs(fixed)).toBe(fixed);
  });

  test("inside a run of calls it waits until the run's results are in", () => {
    const input = inputOf(
      orphanedToolOutputs(
        '{"input":[{"type":"function_call","call_id":"call_synthetic","name":"echo","arguments":"{}"},' +
          '{"type":"function_call_output","id":"fco_synthetic","output":"<codex_delegation>synthetic delivery</codex_delegation>"},' +
          '{"type":"function_call_output","call_id":"call_synthetic","output":"paired result"}]}',
      ),
    );
    expect(input.map((item) => item.type)).toEqual([
      "function_call",
      "function_call_output",
      "message",
    ]);
  });

  test("a request with no such result comes back byte for byte", () => {
    for (const body of [
      "not json",
      "{}",
      '{"input":"hello"}',
      '{"input":[{"type":"function_call_output","call_id":"paired","output":"ok"}]}',
      '{"input":[{"role":"user","content":"ordinary"}]}',
    ]) {
      expect(orphanedToolOutputs(body)).toBe(body);
    }
  });
});

const RESIZE_NOTICE = `<image_resize_notice>
Image 1 of 1 in the preceding tool output was resized from 1024x9000 to 233x2048 pixels.
</image_resize_notice>`;

function orderOf(body: string): string[] {
  return inputOf(body).map((item) => `${String(item.type)}:${String(item.call_id ?? "")}`);
}

describe("an item inside a run of calls and results (magpie join_tool_runs_test.go)", () => {
  test("Codex's resize notice between two results moves to the end of the run", () => {
    const fixed = joinToolRuns(
      '{"model":"m","input":[' +
        '{"type":"message","role":"user","content":[{"type":"input_text","text":"look"}]},' +
        '{"type":"function_call","call_id":"call_00","name":"view_image","arguments":"{\\"path\\":\\"wide.png\\"}"},' +
        '{"type":"function_call","call_id":"call_01","name":"exec_command","arguments":"{}"},' +
        '{"type":"function_call_output","call_id":"call_00","output":[{"type":"input_image","image_url":"data:image/png;base64,AQID"}]},' +
        `{"type":"message","role":"developer","content":[{"type":"input_text","text":${JSON.stringify(RESIZE_NOTICE)}}]},` +
        '{"type":"function_call_output","call_id":"call_01","output":"PIL 11.3.0\\r\\n"}]}',
    );
    expect(orderOf(fixed)).toEqual([
      "message:",
      "function_call:call_00",
      "function_call:call_01",
      "function_call_output:call_00",
      "function_call_output:call_01",
      "message:",
    ]);
    expect(fixed).toContain("image_resize_notice");
    expect(joinToolRuns(fixed)).toBe(fixed);
  });

  // magpie TestRelayedTextBetweenABatchsCallsIsAnswered（#2100）：模型在一批调用的每个调用前各说了一句。
  const SAY_1 =
    '{"type":"message","role":"assistant","content":[{"type":"output_text","text":"I\'ll run two commands."}]}';
  const SAY_2 =
    '{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Also this."}]}';
  const CALL_A =
    '{"type":"function_call","call_id":"call_aaaa1111","name":"exec_command","arguments":"{\\"cmd\\":\\"ls\\"}"}';
  const CALL_B =
    '{"type":"function_call","call_id":"call_bbbb2222","name":"exec_command","arguments":"{\\"cmd\\":\\"pwd\\"}"}';
  const OUT_A = '{"type":"function_call_output","call_id":"call_aaaa1111","output":"a.txt"}';
  const OUT_B = '{"type":"function_call_output","call_id":"call_bbbb2222","output":"/w"}';
  const REASONING = '{"type":"reasoning","id":"rs_2","summary":[],"encrypted_content":"ZW5j"}';
  const USER =
    '{"type":"message","role":"user","content":[{"type":"input_text","text":"run them"}]}';
  const batch = (items: string[]) => `{"model":"m","input":[${[USER, ...items].join(",")}]}`;

  test("the model's text between a batch's calls goes ahead of the first call, with the reasoning before it", () => {
    expect(JSON.parse(joinToolRuns(batch([SAY_1, CALL_A, SAY_2, CALL_B, OUT_A, OUT_B])))).toEqual(
      JSON.parse(batch([SAY_1, SAY_2, CALL_A, CALL_B, OUT_A, OUT_B])),
    );
    expect(
      JSON.parse(joinToolRuns(batch([SAY_1, CALL_A, REASONING, SAY_2, CALL_B, OUT_A, OUT_B]))),
    ).toEqual(JSON.parse(batch([SAY_1, REASONING, SAY_2, CALL_A, CALL_B, OUT_A, OUT_B])));
  });

  test("text between whole exchanges, or before a batch's calls, stays byte for byte", () => {
    for (const body of [
      batch([SAY_1, CALL_A, OUT_A, SAY_2, CALL_B, OUT_B]),
      batch([SAY_1, CALL_A, CALL_B, OUT_A, OUT_B]),
    ]) {
      expect(joinToolRuns(body)).toBe(body);
    }
  });

  test("whole exchanges, a call nobody answers and results out of order are left byte for byte", () => {
    for (const body of [
      '{"model":"m","input":[{"type":"function_call","call_id":"call_a","name":"echo","arguments":"{}"},{"type":"function_call_output","call_id":"call_a","output":"a"},{"type":"message","role":"developer","content":[{"type":"input_text","text":"a note"}]},{"type":"function_call","call_id":"call_b","name":"echo","arguments":"{}"},{"type":"function_call_output","call_id":"call_b","output":"b"}]}',
      '{"model":"m","input":[{"type":"function_call","call_id":"call_a","name":"echo","arguments":"{}"},{"type":"message","role":"user","content":[{"type":"input_text","text":"never mind"}]}]}',
      '{"model":"m","input":[{"type":"function_call","call_id":"call_a","name":"echo","arguments":"{}"},{"type":"function_call","call_id":"call_b","name":"echo","arguments":"{}"},{"type":"function_call_output","call_id":"call_b","output":"b"},{"type":"function_call_output","call_id":"call_a","output":"a"}]}',
      '{"model":"m","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]}]}',
      "not json",
      "{}",
      '{"input":"hello"}',
    ]) {
      expect(joinToolRuns(body)).toBe(body);
    }
  });
});

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// magpie upstream_bytes_test.go 的 responsesBody：一张图、一段封存的推理、一轮工具往来。
const CODEX_BODY = `{"model":"fake/m1","instructions":"be brief — ok","service_tier":"priority","reasoning":{"effort":"medium","summary":"auto"},
 "input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"},{"type":"input_image","image_url":"data:image/png;base64,${PNG}"}]},
 {"type":"reasoning","id":"rs_1","summary":[],"encrypted_content":"ZW5j"},
 {"type":"function_call","call_id":"call_1","name":"Read","arguments":"{\\"path\\":\\"/x\\"}"},
 {"type":"function_call_output","call_id":"call_1","output":"done\\t\\"x\\""},
 {"type":"message","role":"user","content":"go on"}],
 "tools":[{"type":"function","name":"Read","description":"Reads","parameters":{"type":"object","properties":{"path":{"type":"string"}}}}],
 "store":false,"stream":false,"include":["reasoning.encrypted_content"]}`;

describe("magpie's Responses upstream bodies (testdata/upstream_bodies)", () => {
  test("Codex's request reaches an Anthropic upstream as magpie builds it, without the sealed reasoning", () => {
    const parsed = parseResponsesRequest(JSON.parse(CODEX_BODY));
    expect(buildAnthropicRequest({ ...parsed, stream: true }, "m1")).toEqual(
      JSON.parse(
        `{"max_tokens":16384,"messages":[{"role":"user","content":[{"type":"text","text":"hi"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"${PNG}"}}]},{"role":"assistant","content":[{"type":"tool_use","id":"call_1","name":"Read","input":{"path":"/x"}}]},{"role":"user","content":[{"type":"tool_result","tool_use_id":"call_1","content":"done\\t\\"x\\""},{"type":"text","text":"go on","cache_control":{"type":"ephemeral"}}]}],"model":"m1","stream":true,"system":[{"type":"text","text":"be brief — ok","cache_control":{"type":"ephemeral"}}],"thinking":{"budget_tokens":10000,"type":"enabled"},"tools":[{"description":"Reads","input_schema":{"type":"object","properties":{"path":{"type":"string"}}},"name":"Read"}]}`,
      ),
    );
  });

  test("Codex's request reaches a Chat upstream as magpie builds it (no service tier: Osuna has no fast mode)", () => {
    const parsed = parseResponsesRequest(JSON.parse(CODEX_BODY));
    expect(buildChatRequest({ ...parsed, stream: true }, "m1")).toEqual(
      JSON.parse(
        `{"messages":[{"content":"be brief — ok","role":"system"},{"content":[{"text":"hi","type":"text"},{"image_url":{"url":"data:image/png;base64,${PNG}"},"type":"image_url"}],"role":"user"},{"role":"assistant","tool_calls":[{"function":{"arguments":"{\\"path\\":\\"/x\\"}","name":"Read"},"id":"call_1","type":"function"}]},{"content":"done\\t\\"x\\"","role":"tool","tool_call_id":"call_1"},{"content":"go on","role":"user"}],"model":"m1","reasoning_effort":"medium","stream":true,"stream_options":{"include_usage":true},"tools":[{"function":{"description":"Reads","name":"Read","parameters":{"type":"object","properties":{"path":{"type":"string"}}}},"type":"function"}]}`,
      ),
    );
  });

  test("Claude Code's request with an image reaches a Responses upstream as magpie builds it", () => {
    const parsed = parseAnthropicRequest({
      model: "fake/m1",
      max_tokens: 64,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
          ],
        },
      ],
    });
    expect(buildResponsesRequest({ ...parsed, stream: true }, "m1")).toEqual(
      JSON.parse(
        `{"input":[{"content":[{"text":"what is this","type":"input_text"},{"detail":"auto","image_url":"data:image/png;base64,${PNG}","type":"input_image"}],"role":"user","type":"message"}],"max_output_tokens":64,"model":"m1","store":false,"stream":true}`,
      ),
    );
  });
});

describe("a tool exchange translated into Responses (magpie pair_tool_items_test.go, gemini_pending_call_test.go)", () => {
  const RUN_IT = {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "run it" }],
  };
  const GO_ON = { type: "message", role: "user", content: [{ type: "input_text", text: "go on" }] };
  const CALL_A = { type: "function_call", call_id: "call_a", name: "echo", arguments: "{}" };

  test("a Chat or Messages client's lone call gets its synthetic result (TestTranslatedToResponsesAnswersALoneCall)", () => {
    const chat = parseChatRequest({
      model: "fake/m1",
      stream: true,
      messages: [
        { role: "user", content: "run it" },
        {
          role: "assistant",
          tool_calls: [
            { id: "call_a", type: "function", function: { name: "echo", arguments: "{}" } },
          ],
        },
        { role: "user", content: "go on" },
      ],
    });
    const messages = parseAnthropicRequest({
      model: "fake/m1",
      stream: true,
      max_tokens: 16,
      messages: [
        { role: "user", content: "run it" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "call_a", name: "echo", input: {} }],
        },
        { role: "user", content: "go on" },
      ],
    });
    const answered = [
      RUN_IT,
      CALL_A,
      { type: "function_call_output", call_id: "call_a", output: INTERRUPTED },
      GO_ON,
    ];
    expect(buildResponsesRequest(chat, "m1").input).toEqual(answered);
    expect(buildResponsesRequest(messages, "m1").input).toEqual(answered);
  });

  test("a paired exchange goes as it was built (TestTranslatedToResponsesKeepsAPairedExchange)", () => {
    const chat = parseChatRequest({
      model: "fake/m1",
      stream: true,
      messages: [
        { role: "user", content: "run it" },
        {
          role: "assistant",
          tool_calls: [
            { id: "call_a", type: "function", function: { name: "echo", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "call_a", content: "ok" },
        { role: "user", content: "go on" },
      ],
    });
    expect(buildResponsesRequest(chat, "m1").input).toEqual([
      RUN_IT,
      CALL_A,
      { type: "function_call_output", call_id: "call_a", output: "ok" },
      GO_ON,
    ]);
  });

  test("a second answer to one call is left out with its image; a call made again gets its own (TestSecondAnswerDroppedWithItsImages)", () => {
    const request = parseAnthropicRequest({
      model: "fake/m1",
      max_tokens: 16,
      messages: [
        { role: "user", content: "look" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "call_1", name: "Read", input: {} }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "call_1", content: "alpha-result" }],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_1",
              content: [
                { type: "text", text: "beta-result" },
                {
                  type: "image",
                  source: { type: "base64", media_type: "image/png", data: "c2Vjb25k" },
                },
              ],
            },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "call_1", name: "Read", input: {} }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "call_1", content: "gamma-result" }],
        },
      ],
    });
    const call = { type: "function_call", call_id: "call_1", name: "Read", arguments: "{}" };
    expect(buildResponsesRequest(request, "gpt-5.4").input).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "look" }] },
      call,
      { type: "function_call_output", call_id: "call_1", output: "alpha-result" },
      call,
      { type: "function_call_output", call_id: "call_1", output: "gamma-result" },
    ]);
  });
});

/** 写出的 SSE 里每个事件的 data。 */
function events(written: string): Record<string, unknown>[] {
  return written
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

function decodeResponses(chunks: string[]): ReplyCollector {
  const collector = new ReplyCollector();
  const decoder = new ResponsesDecoder();
  for (const chunk of chunks) decoder.decode(chunk, (event) => collector.add(event));
  return collector;
}

/** 中间事件经 Responses 编码器写给 Codex。 */
function toCodex(request: GatewayRequest, feed: (emit: (event: StreamEvent) => void) => void) {
  let written = "";
  const encoder = new ResponsesEncoder({
    model: "relay-a/kimi-k2",
    request,
    write: (piece) => {
      written += piece;
    },
  });
  feed((event) => encoder.event(event));
  encoder.finish();
  return events(written);
}

function codexRequest(body: Record<string, unknown>): GatewayRequest {
  return parseResponsesRequest({ model: "relay-a/kimi-k2", input: "hi", ...body });
}

const NAMESPACED_TOOLS = [
  { type: "function", name: "exec_command", parameters: { type: "object" } },
  {
    type: "namespace",
    name: "collaboration",
    description: "Tools in the collaboration namespace.",
    tools: [
      {
        type: "function",
        name: "spawn_agent",
        description: "Spawns an agent.",
        parameters: {
          type: "object",
          properties: { message: { type: "string", encrypted: true } },
        },
      },
      { type: "custom", name: "freeform", description: "no JSON schema" },
    ],
  },
];

describe("reading a Codex request (magpie namespace_test.go, codex_custom_tools_test.go, agent_message_test.go)", () => {
  test("namespaced tools are offered flat, without Codex's encrypted marks, and remembered", () => {
    const parsed = codexRequest({ tools: NAMESPACED_TOOLS });
    expect(parsed.tools.map((tool) => tool.name)).toEqual([
      "exec_command",
      "collaboration__spawn_agent",
      "collaboration__freeform",
    ]);
    expect(parsed.tools[1]).toEqual({
      name: "collaboration__spawn_agent",
      description: "Spawns an agent.",
      schema: { type: "object", properties: { message: { type: "string" } } },
      strict: false,
    });
    expect(parsed.named).toEqual({
      collaboration__spawn_agent: {
        namespace: "collaboration",
        name: "spawn_agent",
        custom: false,
      },
      collaboration__freeform: { namespace: "collaboration", name: "freeform", custom: true },
    });
  });

  test("a custom tool takes its free-form input as one string argument, its grammar told", () => {
    const parsed = codexRequest({
      tools: [
        {
          type: "custom",
          name: "exec",
          description: "Run JavaScript.",
          format: { type: "grammar", syntax: "lark", definition: "start: plain_source" },
        },
      ],
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "list the files" }],
        },
        { type: "custom_tool_call", call_id: "c1", name: "exec", input: "text(1);" },
        { type: "custom_tool_call_output", call_id: "c1", output: "a.txt" },
      ],
    });
    expect(parsed.tools[0]?.description).toBe(
      "Run JavaScript.\n\nPut the tool's whole free-form input, as it is to be run, in the `input` string; it is passed on as written, so it is not itself JSON.\n\nThe input follows this lark grammar:\nstart: plain_source",
    );
    expect(parsed.tools[0]?.schema).toMatchObject({ required: ["input"] });
    expect(parsed.messages[1]).toEqual({
      role: "assistant",
      parts: [{ kind: "tool_call", id: "c1", name: "exec", args: '{"input":"text(1);"}' }],
    });
  });

  test("long namespaced names are cut to 64 characters and stay apart", () => {
    const namespace = `mcp__${"a".repeat(60)}`;
    const parsed = codexRequest({
      tools: [
        {
          type: "namespace",
          name: namespace,
          tools: [
            { type: "function", name: `${"b".repeat(40)}1` },
            { type: "function", name: `${"b".repeat(40)}2` },
          ],
        },
      ],
    });
    const [first, second] = parsed.tools.map((tool) => tool.name);
    expect(first).toHaveLength(64);
    expect(first).not.toBe(second);
    expect(parsed.named[first!]).toEqual({ namespace, name: `${"b".repeat(40)}1`, custom: false });
  });

  test("a namespaced call in the history goes by its flat name", () => {
    const parsed = codexRequest({
      tools: NAMESPACED_TOOLS,
      input: [
        { type: "message", role: "user", content: "go" },
        {
          type: "function_call",
          call_id: "c1",
          name: "spawn_agent",
          namespace: "collaboration",
          arguments: "{}",
        },
        { type: "function_call_output", call_id: "c1", output: "ok" },
      ],
    });
    expect(parsed.messages[1]?.parts[0]).toMatchObject({ name: "collaboration__spawn_agent" });
  });

  test("allowed_tools keeps only the tools it names and its mode", () => {
    const parsed = codexRequest({
      tools: NAMESPACED_TOOLS,
      tool_choice: {
        type: "allowed_tools",
        mode: "required",
        tools: [{ type: "function", name: "spawn_agent", namespace: "collaboration" }],
      },
    });
    expect(parsed.toolChoice).toBe("required");
    expect(parsed.tools.map((tool) => tool.name)).toEqual(["collaboration__spawn_agent"]);
    expect(Object.keys(parsed.named)).toEqual(["collaboration__spawn_agent"]);
    expect(() =>
      codexRequest({ tool_choice: { type: "allowed_tools", mode: "none", tools: [] } }),
    ).toThrow(RequestShapeError);
  });

  test("web search is not run for the model: the tool is left out", () => {
    const parsed = codexRequest({ tools: [{ type: "web_search" }, NAMESPACED_TOOLS[0]] });
    expect(parsed.tools.map((tool) => tool.name)).toEqual(["exec_command"]);
  });

  test("a subagent's agent_message is its user turn", () => {
    const parsed = codexRequest({
      input: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "be brief" }] },
        {
          type: "agent_message",
          author: "/root",
          recipient: "/root/w",
          content: [{ type: "input_text", text: "Message Type: NEW_TASK\nPayload:\nreply PONG" }],
        },
      ],
    });
    expect(parsed.system).toBe("be brief");
    expect(parsed.messages).toEqual([
      {
        role: "user",
        parts: [{ kind: "text", text: "Message Type: NEW_TASK\nPayload:\nreply PONG" }],
      },
    ]);
  });

  test("a developer message added after a reply stays in place as a system reminder (magpie codex_developer_cache_test.go)", () => {
    const item = (role: string, text: string) => ({
      type: "message",
      role,
      content: [{ type: role === "assistant" ? "output_text" : "input_text", text }],
    });
    const head = [
      item("developer", "<permissions>sandboxed</permissions>"),
      item("user", "fix the bug"),
    ];
    const first = codexRequest({ instructions: "You are Codex.", input: head });
    const second = codexRequest({
      instructions: "You are Codex.",
      input: [
        ...head,
        item("assistant", "done"),
        item("developer", "<skills>new</skills>"),
        item("user", "and the test?"),
      ],
    });
    expect(second.system).toBe(first.system);
    expect(second.system).toBe("You are Codex.\n\n<permissions>sandboxed</permissions>");
    expect(second.messages.at(-1)).toEqual({
      role: "user",
      parts: [
        { kind: "text", text: "<system-reminder>\n<skills>new</skills>\n</system-reminder>" },
        { kind: "text", text: "and the test?" },
      ],
    });
  });

  test("a tool asked strict stays strict on a Responses upstream; others say strict false (magpie tool_strict_test.go)", () => {
    const schema = {
      type: "object",
      properties: { path: { type: "string", pattern: "^(?!.*\\.\\.).+$" } },
    };
    const strictOf = (request: GatewayRequest) =>
      (buildResponsesRequest(request, "gpt-6.1-sol").tools as Record<string, unknown>[]).map(
        (tool) => [tool.name, tool.strict],
      );
    const anthropic = parseAnthropicRequest({
      model: "m",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "read", description: "Read a file", input_schema: schema }],
    });
    expect(strictOf(anthropic)).toEqual([["read", false]]);
    const chat = parseChatRequest({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "held", strict: true, parameters: schema } }],
    });
    expect(strictOf(chat)).toEqual([["held", true]]);
  });
});

describe("images and files in a Codex request asked of another API (magpie responses_file_id_test.go)", () => {
  const latest = (content: unknown[]) => ({
    model: "m",
    input: [{ role: "user", content }],
  });

  test("an image of the latest turn given only as a file_id is refused, naming the image", () => {
    expect(() =>
      parseResponsesRequest(
        latest([
          { type: "input_text", text: "read" },
          { type: "input_image", file_id: "file-abc" },
        ]),
      ),
    ).toThrow(/image/);
  });

  test("an earlier turn's file_id image is left out, an inline one kept", () => {
    const parsed = parseResponsesRequest({
      model: "m",
      input: [
        { role: "user", content: [{ type: "input_image", file_id: "file-abc" }] },
        { role: "assistant", content: [{ type: "output_text", text: "seen" }] },
        {
          role: "user",
          content: [
            { type: "input_text", text: "now" },
            { type: "input_image", image_url: "data:image/png;base64,aGVsbG8=" },
          ],
        },
      ],
    });
    expect(parsed.messages.map((message) => message.parts)).toEqual([
      [],
      [{ kind: "text", text: "seen" }],
      [
        { kind: "text", text: "now" },
        { kind: "image", mediaType: "image/png", data: "aGVsbG8=", url: "" },
      ],
    ]);
  });

  test("an input_file attachment is dropped", () => {
    const parsed = parseResponsesRequest(
      latest([
        { type: "input_text", text: "summarise" },
        {
          type: "input_file",
          filename: "a.pdf",
          file_data: "data:application/pdf;base64,JVBERi0=",
        },
      ]),
    );
    expect(parsed.messages[0]?.parts).toEqual([{ kind: "text", text: "summarise" }]);
  });
});

describe("Responses usage (magpie responses_cache_write_test.go)", () => {
  test.each([
    [
      { input_tokens: 120000, output_tokens: 300, input_tokens_details: { cached_tokens: 113000 } },
      { input: 7000, output: 300, cacheRead: 113000, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 },
    ],
    [
      {
        input_tokens: 130000,
        output_tokens: 400,
        input_tokens_details: { cached_tokens: 113000, cache_write_tokens: 9000 },
        output_tokens_details: { reasoning_tokens: 50 },
      },
      {
        input: 8000,
        output: 400,
        cacheRead: 113000,
        cacheWrite: 9000,
        cacheWrite1h: 0,
        reasoning: 50,
      },
    ],
    [
      { input_tokens: 1000, output_tokens: 5 },
      { input: 1000, output: 5, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 },
    ],
  ])("cache reads and writes are taken out of the input, and read back the same", (raw, usage) => {
    expect(usageFromResponses(raw)).toEqual(usage);
    expect(usageFromResponses(usageToResponses(usage))).toEqual(usage);
  });
});

// OpenAI 推理指南里的两项：带摘要的、只封存没摘要的（magpie reasoning_state_responses_test.go）。
const SEALED_STREAM = [
  '{"type":"response.created","response":{"id":"resp_1","model":"gpt-5","status":"in_progress"}}',
  '{"type":"response.output_item.added","output_index":0,"item":{"id":"rs_a","type":"reasoning","summary":[]}}',
  '{"type":"response.reasoning_summary_text.delta","item_id":"rs_a","delta":"**Checking the weather**"}',
  '{"type":"response.output_item.done","output_index":0,"item":{"id":"rs_a","type":"reasoning","summary":[{"type":"summary_text","text":"**Checking the weather**"}],"encrypted_content":"gAAAAABoIPOH"}}',
  '{"type":"response.output_item.added","output_index":1,"item":{"id":"rs_b","type":"reasoning","summary":[]}}',
  '{"type":"response.output_item.done","output_index":1,"item":{"id":"rs_b","type":"reasoning","summary":[],"encrypted_content":"gAAAAABoIPOy"}}',
  '{"type":"response.output_item.added","output_index":2,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"get_weather","arguments":""}}',
  '{"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\\"location\\":"}',
  '{"type":"response.function_call_arguments.done","item_id":"fc_1","arguments":"{\\"location\\":\\"Paris\\"}"}',
  '{"type":"response.output_item.done","output_index":2,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"get_weather","arguments":"{\\"location\\":\\"Paris\\"}"}}',
  '{"type":"response.completed","response":{"id":"resp_1","status":"completed","output":[],"usage":{"input_tokens":120,"output_tokens":30,"input_tokens_details":{"cached_tokens":100}}}}',
];

describe("decoding a Responses stream", () => {
  test("summaries, a call with its finished arguments, the stop and usage; nothing sealed (magpie reasoning_state_responses_test.go)", () => {
    const reply = decodeResponses(SEALED_STREAM).finish();
    expect(reply).toEqual({
      id: "resp_1",
      parts: [
        { kind: "thinking", text: "**Checking the weather**", signature: "" },
        { kind: "tool_call", id: "call_1", name: "get_weather", args: '{"location":"Paris"}' },
      ],
      stop: "tool",
      usage: {
        input: 20,
        output: 30,
        cacheRead: 100,
        cacheWrite: 0,
        cacheWrite1h: 0,
        reasoning: 0,
      },
    });
    expect(JSON.stringify(reply)).not.toContain("gAAAA");
  });

  test("an incomplete reply is cut short; for the content filter it is filtered", () => {
    const stopOf = (details: string) =>
      decodeResponses([
        '{"type":"response.output_text.delta","delta":"Half"}',
        `{"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":${details}}}`,
      ]).finish().stop;
    expect(stopOf('{"reason":"max_output_tokens"}')).toBe("length");
    expect(stopOf('{"reason":"content_filter"}')).toBe("filter");
  });

  test("a failed response and an error event are errors, with or without words", () => {
    const failed = decodeResponses([
      '{"type":"response.failed","response":{"status":"failed","error":{"code":"server_error","message":"overloaded"}}}',
    ]);
    expect(failed.error).toEqual({
      message: "overloaded",
      code: "server_error",
      vendorError: null,
    });
    const bare = decodeResponses(['{"type":"error","message":"rate limited"}']);
    expect(bare.error).toEqual({ message: "rate limited", code: null, vendorError: null });
    const shapeless = decodeResponses(['{"error":"quota exhausted"}']);
    expect(shapeless.error).toEqual({ message: "quota exhausted", code: null, vendorError: null });
  });

  test("an error the vendor types invalid_request_error keeps its type, code and param (magpie requestRefused)", () => {
    const refused = decodeResponses([
      '{"type":"error","error":{"message":"not authorized","type":"invalid_request_error","param":"access_programs.cyber","code":"access_program_not_enabled"}}',
    ]);
    const failed = decodeResponses([
      '{"type":"response.failed","response":{"status":"failed","error":{"message":"bad input","type":"invalid_request_error"}}}',
    ]);
    expect(refused.error).toEqual({
      message: "not authorized",
      code: "access_program_not_enabled",
      vendorError: {
        type: "invalid_request_error",
        code: "access_program_not_enabled",
        param: "access_programs.cyber",
      },
    });
    expect(failed.error).toEqual({
      message: "bad input",
      code: null,
      vendorError: { type: "invalid_request_error", code: null, param: null },
    });
  });
});

describe("a Responses stream told to Claude Code and to a Chat client", () => {
  test("Claude Code gets the summary as thinking and the call as tool_use, never the sealed reasoning", () => {
    let written = "";
    const encoder = new AnthropicEncoder({
      model: "relay-a/gpt-5",
      write: (piece) => (written += piece),
    });
    const decoder = new ResponsesDecoder();
    for (const chunk of SEALED_STREAM) decoder.decode(chunk, (event) => encoder.event(event));
    encoder.finish();
    expect(written).not.toContain("gAAAA");
    const sent = events(written);
    expect(sent.filter((event) => event.type === "content_block_start")).toEqual([
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "call_1", name: "get_weather", input: {} },
      },
    ]);
    expect(sent.at(-2)).toMatchObject({ delta: { stop_reason: "tool_use" } });
  });
});

describe("a stream told to Codex", () => {
  test("text, a call, the stop and usage become Responses events under the asked model name", () => {
    const sent = toCodex(codexRequest({}), (emit) => {
      emit({ kind: "start", id: "chatcmpl-9", usage: emptyUsage() });
      emit({ kind: "text", text: "Let me look." });
      emit({ kind: "tool_start", id: "call_ls", name: "exec_command" });
      emit({ kind: "tool_args", text: '{"cmd":"ls"}' });
      emit({ kind: "stop", stop: "tool" });
      emit({
        kind: "usage",
        usage: {
          input: 20,
          output: 30,
          cacheRead: 100,
          cacheWrite: 0,
          cacheWrite1h: 0,
          reasoning: 0,
        },
      });
    });
    expect(sent.map((event) => event.type)).toEqual([
      "response.created",
      "response.in_progress",
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
    expect(sent.map((event) => event.sequence_number)).toEqual(sent.map((_, index) => index));
    const completed = sent.at(-1)!.response as Record<string, unknown>;
    expect(completed).toMatchObject({
      id: "resp_chatcmpl-9",
      status: "completed",
      model: "relay-a/kimi-k2",
      usage: {
        input_tokens: 120,
        output_tokens: 30,
        total_tokens: 150,
        input_tokens_details: { cached_tokens: 100, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    });
    expect(completed.output).toEqual([
      {
        id: expect.stringMatching(/^msg_/),
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Let me look.", annotations: [], logprobs: [] }],
        phase: "commentary",
      },
      {
        id: expect.stringMatching(/^fc_/),
        type: "function_call",
        status: "completed",
        call_id: "call_ls",
        name: "exec_command",
        arguments: '{"cmd":"ls"}',
      },
    ]);
  });

  test("a namespaced call goes back under its namespace with plain arguments (magpie TestNamespacedCallStreamed)", () => {
    const sent = toCodex(codexRequest({ tools: NAMESPACED_TOOLS }), (emit) => {
      emit({ kind: "tool_start", id: "c1", name: "collaboration__spawn_agent" });
      emit({ kind: "tool_args", text: '{"message":"x"}' });
      emit({ kind: "tool_start", id: "c2", name: "exec_command" });
      emit({ kind: "tool_args", text: "{}" });
    });
    const done = sent
      .filter((event) => event.type === "response.output_item.done")
      .map((event) => event.item);
    expect(done).toEqual([
      expect.objectContaining({
        call_id: "c1",
        name: "spawn_agent",
        namespace: "collaboration",
        encrypted_function_args: [],
      }),
      expect.not.objectContaining({ namespace: expect.anything() }),
    ]);
  });

  test("a custom tool's call goes back as the custom_tool_call Codex runs, never streamed as a function's (magpie TestCodexCustomToolsTranslated)", () => {
    const request = codexRequest({
      tools: [{ type: "custom", name: "exec", description: "Run JavaScript." }],
    });
    const sent = toCodex(request, (emit) => {
      emit({ kind: "tool_start", id: "call_2", name: "exec" });
      emit({ kind: "tool_args", text: '{"input":"text(await ' });
      emit({ kind: "tool_args", text: 'tools.read({path: \\"a.txt\\"}))"}' });
      emit({ kind: "stop", stop: "tool" });
    });
    expect(
      sent.some((event) => String(event.type).startsWith("response.function_call_arguments")),
    ).toBe(false);
    const done = sent.find((event) => event.type === "response.output_item.done")!.item;
    expect(done).toEqual({
      id: expect.stringMatching(/^ctc_/),
      type: "custom_tool_call",
      status: "completed",
      call_id: "call_2",
      name: "exec",
      input: 'text(await tools.read({path: "a.txt"}))',
    });
  });

  test("an upstream error ends the stream as response.failed", () => {
    const sent = toCodex(codexRequest({}), (emit) => {
      emit({ kind: "text", text: "Hm" });
      emit({ kind: "error", message: "overloaded", code: null, vendorError: null });
    });
    expect(sent.find((event) => event.type === "response.failed")).toMatchObject({
      response: { status: "failed", error: { code: "server_error", message: "overloaded" } },
    });
  });
});

describe("a whole reply for a Codex request that did not stream", () => {
  test("text, thinking and calls are output items; a namespaced or custom call goes back as Codex knows it", () => {
    const request = codexRequest({
      tools: [
        ...NAMESPACED_TOOLS,
        { type: "custom", name: "apply_patch", description: "Patch files" },
      ],
    });
    const rendered = renderResponses(
      {
        id: "msg_1",
        parts: [
          { kind: "thinking", text: "Plan.", signature: "c2ln" },
          { kind: "text", text: "On it." },
          { kind: "tool_call", id: "c1", name: "collaboration__spawn_agent", args: "{}" },
          {
            kind: "tool_call",
            id: "c2",
            name: "apply_patch",
            args: '{"input":"*** Begin Patch\\n*** End Patch"}',
          },
        ],
        stop: "tool",
        usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 },
      },
      { model: "relay-a/kimi-k2", request },
    );
    expect(rendered).toMatchObject({
      id: "resp_msg_1",
      object: "response",
      status: "completed",
      model: "relay-a/kimi-k2",
      incomplete_details: null,
      usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
    });
    expect(rendered.output).toEqual([
      {
        id: expect.stringMatching(/^rs_/),
        type: "reasoning",
        status: "completed",
        summary: [{ type: "summary_text", text: "Plan." }],
      },
      {
        id: expect.stringMatching(/^msg_/),
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "On it.", annotations: [] }],
        phase: "commentary",
      },
      {
        id: expect.stringMatching(/^fc_/),
        type: "function_call",
        status: "completed",
        call_id: "c1",
        name: "spawn_agent",
        namespace: "collaboration",
        encrypted_function_args: [],
        arguments: "{}",
      },
      {
        id: expect.stringMatching(/^ctc_/),
        type: "custom_tool_call",
        status: "completed",
        call_id: "c2",
        name: "apply_patch",
        input: "*** Begin Patch\n*** End Patch",
      },
    ]);
  });

  test("a reply cut at the context window is incomplete (magpie stop_context_test.go)", () => {
    const reply = new ReplyCollector();
    const decoder = new AnthropicDecoder();
    for (const chunk of [
      '{"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4-5","usage":{"input_tokens":10}}}',
      '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Half an ans"}}',
      '{"type":"content_block_stop","index":0}',
      '{"type":"message_delta","delta":{"stop_reason":"model_context_window_exceeded"},"usage":{"output_tokens":5}}',
    ]) {
      decoder.decode(chunk, (event) => reply.add(event));
    }
    expect(
      renderResponses(reply.finish(), { model: "m", request: codexRequest({}) }),
    ).toMatchObject({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    });
  });
});

describe("Codex's structured output asked of another API (magpie format_test.go)", () => {
  const CALENDAR = {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  };

  test("text.format becomes Chat's response_format and Anthropic's output_config.format", () => {
    const parsed = parseResponsesRequest({
      model: "m",
      input: [
        { role: "system", content: "Extract the event information." },
        { role: "user", content: "Alice and Bob are going to a science fair on Friday." },
      ],
      text: {
        format: { type: "json_schema", strict: true, name: "CalendarEvent", schema: CALENDAR },
      },
    });
    expect(parsed.system).toBe("Extract the event information.");
    expect(buildChatRequest(parsed, "gpt-4o-mini").response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "CalendarEvent", schema: CALENDAR, strict: true },
    });
    expect(buildAnthropicRequest(parsed, "claude-sonnet-4-5").output_config).toEqual({
      format: { type: "json_schema", schema: CALENDAR },
    });
  });

  test("Anthropic's schema becomes text.format on a Responses upstream", () => {
    const parsed = parseAnthropicRequest({
      model: "m",
      max_tokens: 1024,
      messages: [{ role: "user", content: "go" }],
      output_config: { format: { type: "json_schema", schema: CALENDAR } },
    });
    expect(buildResponsesRequest(parsed, "gpt-5").text).toEqual({
      format: { type: "json_schema", name: "response", schema: CALENDAR },
    });
  });
});

/** Responses input 的形状：推理项带它的 reasoning_text，消息带角色（magpie deepseek_step_lead_test.go stepShape）。 */
function stepShape(input: unknown): string {
  return (input as Record<string, unknown>[])
    .map((item) => {
      if (item.type === "reasoning") {
        const text = (item.content as { type: string; text: string }[] | null)?.find(
          (part) => part.type === "reasoning_text",
        )?.text;
        return text === undefined ? "reasoning" : `reasoning=${JSON.stringify(text)}`;
      }
      return item.type === "message" ? `message:${String(item.role)}` : String(item.type);
    })
    .join(",");
}

describe("reasoning replayed to a DeepSeek model on a Responses upstream", () => {
  const user = {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "fix the login bug" }],
  };
  const said = (text: string) => ({
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
  });
  const call = (id: string) => [
    { type: "function_call", call_id: id, name: "shell", arguments: '{"command":["ls"]}' },
    { type: "function_call_output", call_id: id, output: "main.go" },
  ];
  const sealed = {
    type: "reasoning",
    id: "rs_0d1f",
    summary: [],
    content: null,
    encrypted_content: "gAAAAABpZm9vYmFy",
  };
  const summed = {
    type: "reasoning",
    id: "rs_2",
    summary: [{ type: "summary_text", text: "Run the tests." }],
    content: null,
    encrypted_content: null,
  };

  test("the sealed item keeps its encrypted_content beside the text it is given", () => {
    const replayed = replayedReasoningInput([user, sealed, ...call("c1")]);
    expect(replayed?.input[1]).toEqual({
      ...sealed,
      content: [{ type: "reasoning_text", text: " " }],
    });
  });

  test.each([
    [
      "said, then called, no reasoning",
      [user, sealed, ...call("c1"), said("I'll run the tests."), ...call("c2")],
      'message:user,reasoning=" ",function_call,function_call_output,reasoning=" ",message:assistant,function_call,function_call_output',
    ],
    [
      "said, reasoning, called",
      [user, said("Looking."), summed, ...call("c1")],
      'message:user,reasoning="Run the tests.",message:assistant,function_call,function_call_output',
    ],
    [
      "said after a tool output",
      [user, ...call("c1"), said("It passes.")],
      'message:user,reasoning=" ",function_call,function_call_output,reasoning=" ",message:assistant',
    ],
  ])(
    "passed through, each step leads with reasoning text: %s (magpie TestDeepSeekStepSaysBeforeItsCall)",
    (_, input, want) => {
      expect(stepShape(replayedReasoningInput(input)?.input)).toBe(want);
    },
  );

  test("a request whose steps all lead with reasoning text is left alone (magpie TestWithReasoningTextLedStepsUnchanged)", () => {
    const thought = (text: string) => ({
      type: "reasoning",
      summary: [],
      content: [{ type: "reasoning_text", text }],
    });
    expect(replayedReasoningInput([user, said("Hello!"), user])).toBeNull();
    expect(
      replayedReasoningInput([
        user,
        thought("x"),
        said("Looking."),
        ...call("c1"),
        thought("y"),
        said("Done."),
      ]),
    ).toBeNull();
  });

  test("translated to DeepSeek, a call with no thinking still follows a reasoning item; another model gets none (magpie TestTranslatedDeepSeekCallWithoutReasoning)", () => {
    const parsed = parseAnthropicRequest({
      model: "m",
      max_tokens: 1024,
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "sh", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "ok" }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Once more.", signature: "c2ln" },
            { type: "tool_use", id: "c2", name: "sh", input: {} },
          ],
        },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "c2", content: "ok" }] },
      ],
    });
    expect(stepShape(buildResponsesRequest(parsed, "deepseek-flash").input)).toBe(
      'message:user,reasoning=" ",function_call,function_call_output,reasoning="Once more.",function_call,function_call_output',
    );
    expect(JSON.stringify(buildResponsesRequest(parsed, "gpt-5.4"))).not.toContain(
      "reasoning_text",
    );
  });
});

describe("Codex turning reasoning off, asked of another API", () => {
  const codexOff = parseResponsesRequest({
    model: "gpt-6.1-sol",
    input: "hi",
    reasoning: { effort: "none", summary: "auto" },
  });

  test("effort none goes to a Chat or Responses endpoint as none", () => {
    expect(buildChatRequest(codexOff, "gpt-6.1-sol").reasoning_effort).toBe("none");
    expect(buildResponsesRequest(codexOff, "gpt-6.1-sol").reasoning).toEqual({
      effort: "none",
      summary: "auto",
    });
  });

  test("turned back on, it goes at low", () => {
    expect(buildChatRequest(thinkingBackOn(codexOff), "gpt-6.1-sol").reasoning_effort).toBe("low");
    expect(buildResponsesRequest(thinkingBackOn(codexOff), "gpt-6.1-sol").reasoning).toEqual({
      effort: "low",
      summary: "auto",
    });
  });

  test("Claude Code's thinking turned off goes to a Chat endpoint with no effort, as before", () => {
    const claudeOff = parseAnthropicRequest({
      model: "gpt-6.1-sol",
      max_tokens: 64,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: "hi" }],
    });
    expect(buildChatRequest(claudeOff, "gpt-6.1-sol").reasoning_effort).toBeUndefined();
  });

  test("Claude Code's thinking turned off, turned back on for an always-thinking model, thinks at the least", () => {
    const claudeOff = parseAnthropicRequest({
      model: "glm-5.3",
      max_tokens: 8000,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: "hi" }],
    });
    expect(buildAnthropicRequest(thinkingBackOn(claudeOff), "glm-5.3").thinking).toEqual({
      type: "enabled",
      budget_tokens: 4096,
    });
    expect(buildAnthropicRequest(thinkingBackOn(claudeOff), "claude-opus-5-5")).toMatchObject({
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "low" },
    });
  });
});

describe("Codex's cache key, include, client metadata and text options asked of another API (magpie ir.go Request.CacheKey, Include, ClientMetadata, Text)", () => {
  const CODEX_FIELDS = {
    model: "kimi-k2",
    input: "hi",
    prompt_cache_key: "thread-1",
    include: ["reasoning.encrypted_content"],
    client_metadata: { "x-codex-installation-id": "inst-1" },
    text: { verbosity: "low" },
    reasoning: { effort: "high", summary: "auto" },
  };

  test("a Chat upstream gets the cache key alone", () => {
    expect(buildChatRequest(parseResponsesRequest(CODEX_FIELDS), "kimi-k2")).toEqual({
      model: "kimi-k2",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      prompt_cache_key: "thread-1",
      reasoning_effort: "high",
    });
  });

  test("an Anthropic upstream gets none of them", () => {
    expect(buildAnthropicRequest(parseResponsesRequest(CODEX_FIELDS), "glm-4.6")).toEqual({
      model: "glm-4.6",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }],
        },
      ],
      stream: false,
      thinking: { type: "enabled", budget_tokens: 24_000 },
      max_tokens: 28_096,
    });
  });

  test("a Responses upstream gets all four as Codex sent them, the format beside the text options", () => {
    const request = parseResponsesRequest({
      ...CODEX_FIELDS,
      text: {
        verbosity: "low",
        format: { type: "json_schema", name: "plan", schema: { type: "object" }, strict: true },
      },
    });
    expect(buildResponsesRequest(request, "kimi-k2")).toEqual({
      model: "kimi-k2",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      stream: false,
      store: false,
      client_metadata: { "x-codex-installation-id": "inst-1" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "plan",
          schema: { type: "object" },
          strict: true,
        },
      },
      prompt_cache_key: "thread-1",
      reasoning: { effort: "high", summary: "auto" },
      include: ["reasoning.encrypted_content"],
    });
  });

  test("sealed reasoning is asked for only with reasoning, and an include asked twice goes once", () => {
    const request = parseResponsesRequest({
      model: "kimi-k2",
      input: "hi",
      include: [
        "reasoning.encrypted_content",
        "message.output_text.logprobs",
        "message.output_text.logprobs",
      ],
    });
    expect(buildResponsesRequest(request, "kimi-k2")).toEqual({
      model: "kimi-k2",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      stream: false,
      store: false,
      include: ["message.output_text.logprobs"],
    });
  });
});

describe("the phase of each message a translated model says to Codex (magpie phase_test.go)", () => {
  /** 每条 assistant 消息的 phase：先按流里 output_item.done 的，再按最后一个事件 output 里的。 */
  function phases(sent: Record<string, unknown>[]): { streamed: unknown[]; ended: unknown[] } {
    const isMessage = (item: unknown) => (item as Record<string, unknown>).type === "message";
    const phaseOf = (item: unknown) => (item as Record<string, unknown>).phase;
    const streamed = sent
      .filter((event) => event.type === "response.output_item.done" && isMessage(event.item))
      .map((event) => phaseOf(event.item));
    const last = sent.at(-1)!.response as { output: unknown[] };
    return { streamed, ended: last.output.filter(isMessage).map(phaseOf) };
  }

  const call: StreamEvent[] = [
    { kind: "tool_start", id: "c1", name: "shell" },
    { kind: "tool_args", text: "{}" },
  ];

  test.each<[string, StreamEvent[], string | undefined]>([
    [
      "said before a call",
      [{ kind: "text", text: "Let me look." }, ...call, { kind: "stop", stop: "tool" }],
      "commentary",
    ],
    [
      "said before reasoning and a call",
      [
        { kind: "text", text: "Let me look." },
        { kind: "think", text: "hm" },
        ...call,
        { kind: "stop", stop: "tool" },
      ],
      "commentary",
    ],
    [
      "said last",
      [
        { kind: "text", text: "Done." },
        { kind: "stop", stop: "stop" },
      ],
      "final_answer",
    ],
    [
      "said last, reasoning after",
      [
        { kind: "text", text: "Done." },
        { kind: "think", text: "hm" },
        { kind: "stop", stop: "stop" },
      ],
      "final_answer",
    ],
    [
      "cut at the length",
      [
        { kind: "text", text: "Done" },
        { kind: "stop", stop: "length" },
      ],
      undefined,
    ],
  ])("%s", (_name, feed, phase) => {
    const sent = toCodex(codexRequest({}), (emit) => {
      for (const event of feed) emit(event);
    });
    expect(phases(sent)).toEqual({ streamed: [phase], ended: [phase] });
  });

  test("two messages around a call: the first is commentary, the last the answer", () => {
    const sent = toCodex(codexRequest({}), (emit) => {
      emit({ kind: "text", text: "Checking." });
      for (const event of call) emit(event);
      emit({ kind: "text", text: "Found it." });
      emit({ kind: "stop", stop: "stop" });
    });
    expect(phases(sent)).toEqual({
      streamed: ["commentary", "final_answer"],
      ended: ["commentary", "final_answer"],
    });
  });

  test("a held message keeps the events after it in order, numbered as they are written", () => {
    const sent = toCodex(codexRequest({}), (emit) => {
      emit({ kind: "text", text: "Checking." });
      emit({ kind: "think", text: "hm" });
      for (const event of call) emit(event);
    });
    expect(sent.map((event) => event.type)).toEqual([
      "response.created",
      "response.in_progress",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      // 消息的 done 等到下一个不是推理的项，推理的事件跟在它后面。
      "response.output_item.done",
      "response.output_item.added",
      "response.reasoning_summary_part.added",
      "response.reasoning_summary_text.delta",
      "response.reasoning_summary_text.done",
      "response.reasoning_summary_part.done",
      "response.output_item.done",
      "response.output_item.added",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.done",
      "response.output_item.done",
      "response.completed",
    ]);
    expect(sent.map((event) => event.sequence_number)).toEqual(sent.map((_, index) => index));
    expect(phases(sent).streamed).toEqual(["commentary"]);
  });

  test("an error after a message leaves it without a phase", () => {
    const sent = toCodex(codexRequest({}), (emit) => {
      emit({ kind: "text", text: "Hm" });
      emit({ kind: "error", message: "overloaded", code: null, vendorError: null });
    });
    const done = sent.find((event) => event.type === "response.output_item.done")!;
    expect(done.item).not.toHaveProperty("phase");
  });

  test("a whole reply's messages say their phase too", () => {
    const usage = emptyUsage();
    const render = (reply: Parameters<typeof renderResponses>[0]) =>
      (renderResponses(reply, { model: "m", request: codexRequest({}) }).output as unknown[])
        .filter((item) => (item as Record<string, unknown>).type === "message")
        .map((item) => (item as Record<string, unknown>).phase);
    const withCall = {
      id: "r",
      stop: "tool" as const,
      usage,
      parts: [
        { kind: "text" as const, text: "Checking." },
        { kind: "tool_call" as const, id: "c1", name: "shell", args: "{}" },
      ],
    };
    expect(render(withCall)).toEqual(["commentary"]);
    const answer = {
      id: "r",
      stop: "stop" as const,
      usage,
      parts: [{ kind: "text" as const, text: "Done." }],
    };
    expect(render(answer)).toEqual(["final_answer"]);
    expect(render({ ...answer, stop: "length" })).toEqual([undefined]);
  });
});

/*
 * Claude Code 的搜索子请求交给只有 Responses 地址、自己会搜的接口（工单 06，ADR 0009）：
 * 请求照 magpie anthropic.go 读 tools 与 responses.go buildResponses 写成原生 web_search，
 * 回复照 responses.go 读 web_search_call、anthropic.go 的 anthropicEncoder（KSearch）与 searchResultBlock 写回。
 */
describe("Claude Code's web search asked of a Responses endpoint", () => {
  const SEARCH_REQUEST = {
    model: "gpt-5",
    max_tokens: 32000,
    stream: true,
    system: "You run a web search for another Claude model.",
    messages: [{ role: "user", content: "Perform a web search for the query: osuna" }],
    thinking: { type: "disabled" },
    tool_choice: { type: "tool", name: "web_search" },
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
  };
  const SEARCHED = {
    id: "ws_1",
    type: "web_search_call",
    status: "completed",
    action: {
      type: "search",
      query: "osuna",
      sources: [
        { type: "url", url: "https://osuna.dev/" },
        { type: "url", url: "https://example.com/osuna" },
      ],
    },
  };
  const ANSWER = {
    id: "msg_1",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "Osuna is an app.", annotations: [] }],
  };
  const RESULTS = {
    type: "web_search_tool_result",
    tool_use_id: expect.stringMatching(/^srvtoolu_/),
    content: [
      {
        type: "web_search_result",
        title: "https://osuna.dev/",
        url: "https://osuna.dev/",
        encrypted_content: "",
        page_age: null,
      },
      {
        type: "web_search_result",
        title: "https://example.com/osuna",
        url: "https://example.com/osuna",
        encrypted_content: "",
        page_age: null,
      },
    ],
  };

  test("the search tool goes out as Responses' own web_search, the sources asked for, and the forced choice names it as magpie does", () => {
    const built = buildResponsesRequest(parseAnthropicRequest(SEARCH_REQUEST), "gpt-5");

    expect(built.tools).toEqual([{ type: "web_search" }]);
    expect(built.tool_choice).toEqual({ type: "function", name: "web_search" });
    expect(built.include).toEqual(["web_search_call.action.sources"]);
  });

  test("a streamed search reaches Claude Code as server_tool_use and web_search_tool_result with title and url", () => {
    let written = "";
    const encoder = new AnthropicEncoder({ model: "gpt-5", write: (piece) => (written += piece) });
    const decoder = new ResponsesDecoder();
    const stream = [
      { type: "response.created", response: { id: "resp_1" } },
      { type: "response.output_item.added", item: { ...SEARCHED, status: "in_progress" } },
      { type: "response.output_item.done", item: SEARCHED },
      { type: "response.output_item.added", item: { ...ANSWER, content: [] } },
      { type: "response.output_text.delta", delta: "Osuna is an app." },
      { type: "response.output_item.done", item: ANSWER },
      { type: "response.completed", response: { id: "resp_1", status: "completed" } },
    ];
    for (const event of stream) {
      decoder.decode(JSON.stringify(event), (decoded) => encoder.event(decoded));
    }
    encoder.finish();

    const sent = events(written);
    const starts = sent.filter((event) => event.type === "content_block_start");
    expect(starts.map((event) => event.content_block)).toEqual([
      {
        type: "server_tool_use",
        id: expect.stringMatching(/^srvtoolu_/),
        name: "web_search",
        input: {},
      },
      RESULTS,
      { type: "text", text: "" },
    ]);
    const [use, results] = starts.map((event) => event.content_block as Record<string, unknown>);
    expect(results?.tool_use_id).toBe(use?.id);
    expect(sent).toContainEqual({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"query":"osuna"}' },
    });
    expect(sent.at(-2)).toMatchObject({ delta: { stop_reason: "end_turn" } });
  });

  test("a whole reply with a search renders the same blocks for Claude Code", () => {
    const collector = new ReplyCollector();
    new ResponsesDecoder().whole(
      { id: "resp_1", status: "completed", output: [SEARCHED, ANSWER] },
      (event) => collector.add(event),
    );

    const rendered = renderAnthropic(collector.finish(), "gpt-5");

    expect(rendered.content).toEqual([
      {
        type: "server_tool_use",
        id: expect.stringMatching(/^srvtoolu_/),
        name: "web_search",
        input: { query: "osuna" },
      },
      RESULTS,
      { type: "text", text: "Osuna is an app." },
    ]);
    expect(rendered.stop_reason).toBe("end_turn");
  });
});
