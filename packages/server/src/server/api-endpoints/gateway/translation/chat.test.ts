// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway 的 chat_tool_pairing_test.go、translate_stream_test.go、chat_inbound_reasoning_test.go、gemini_thought_tag_test.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import type { ModelFacts } from "../../model-facts.js";
import { AnthropicEncoder, parseAnthropicRequest } from "./anthropic.js";
import { ChatDecoder, buildChatRequest, parseChatRequest, usageFromChat } from "./chat.js";
import {
  requestForModel,
  type Effort,
  type GatewayRequest,
  type Message,
  type Part,
  type StreamEvent,
} from "./ir.js";

/*
 * OpenAI Chat 这一侧的翻译：Claude Code 的请求翻成 Chat 请求、Chat 流解码。
 * 例子照 magpie 的 chat_tool_pairing_test.go、translate_stream_test.go、
 * chat_inbound_reasoning_test.go 与 gemini_thought_tag_test.go。
 */

describe("a Claude Code request asked of a Chat endpoint", () => {
  test("system, turns, tool definitions, tool calls and results become Chat messages", () => {
    const parsed = parseAnthropicRequest({
      model: "relay-a/kimi-k2",
      max_tokens: 1024,
      stream: true,
      temperature: 1,
      system: [
        { type: "text", text: "You are Claude Code.", cache_control: { type: "ephemeral" } },
        { type: "text", text: "\nBe brief." },
      ],
      messages: [
        { role: "user", content: "list files" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Sure." },
            { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [{ type: "text", text: "a.txt" }],
            },
            { type: "text", text: "thanks" },
          ],
        },
      ],
      tools: [
        {
          name: "Bash",
          description: "Run a command",
          input_schema: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
          },
        },
      ],
      tool_choice: { type: "auto" },
      metadata: { user_id: "user-1" },
    });

    expect(buildChatRequest(parsed, "kimi-k2")).toEqual({
      model: "kimi-k2",
      messages: [
        { role: "system", content: "You are Claude Code.\nBe brief." },
        { role: "user", content: "list files" },
        {
          role: "assistant",
          content: "Sure.",
          tool_calls: [
            {
              id: "toolu_1",
              type: "function",
              function: { name: "Bash", arguments: '{"command":"ls"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "toolu_1", content: "a.txt" },
        { role: "user", content: "thanks" },
      ],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 1024,
      temperature: 1,
      tools: [
        {
          type: "function",
          function: {
            name: "Bash",
            description: "Run a command",
            parameters: {
              type: "object",
              properties: { command: { type: "string" } },
              required: ["command"],
            },
          },
        },
      ],
      tool_choice: "auto",
    });
  });
});

function request(messages: Message[]): GatewayRequest {
  return {
    model: "kimi-k3",
    system: "",
    messages,
    tools: [],
    toolChoice: "",
    maxTokens: 0,
    temperature: null,
    topP: null,
    stop: [],
    stream: true,
    effort: "",
    thinking: false,
    thinkOff: false,
    parallel: null,
    metadata: null,
    cacheKey: "",
    include: [],
    clientMetadata: null,
    text: null,
    format: null,
    named: {},
  };
}

function call(id: string): Part {
  return { kind: "tool_call", id, name: "run", args: "{}" };
}

function result(id: string, output: string): Part {
  return { kind: "tool_result", callId: id, text: output, isError: false, images: [] };
}

function text(value: string): Part {
  return { kind: "text", text: value };
}

type ChatMessage = Record<string, unknown>;

/** 角色序列，带上调用与回答的 id：「user assistant(A,B) tool(A) tool(B)」。 */
function chatTrace(messages: Message[]): { trace: string; sent: ChatMessage[] } {
  const sent = buildChatRequest(request(messages), "kimi-k3").messages as ChatMessage[];
  const trace = sent
    .map((message) => {
      const calls = Array.isArray(message.tool_calls)
        ? `(${message.tool_calls.map((entry: { id: string }) => entry.id).join(",")})`
        : "";
      const answer = typeof message.tool_call_id === "string" ? `(${message.tool_call_id})` : "";
      return `${String(message.role)}${calls}${answer}`;
    })
    .join(" ");
  return { trace, sent };
}

/** Kimi 的校验：tool 消息只能回答紧挨着的那条 assistant 消息发起的调用。 */
function kimiValid(sent: ChatMessage[]): boolean {
  let pending = new Set<string>();
  for (const message of sent) {
    if (message.role === "assistant") {
      pending = new Set(
        Array.isArray(message.tool_calls)
          ? message.tool_calls.map((entry: { id: string }) => entry.id)
          : [],
      );
    } else if (message.role === "tool") {
      if (!pending.has(String(message.tool_call_id))) return false;
    } else {
      pending = new Set();
    }
  }
  return true;
}

describe("mending the tool exchange of a Chat request (magpie chat_tool_pairing_test.go)", () => {
  test("results lead the user's text and go in the calls' order", () => {
    const { trace, sent } = chatTrace([
      { role: "user", parts: [text("run them")] },
      { role: "assistant", parts: [call("A"), call("B"), call("C"), call("D")] },
      {
        role: "user",
        parts: [
          text("note from an attachment"),
          result("C", "3"),
          result("A", "1"),
          result("D", "4"),
          result("B", "2"),
        ],
      },
    ]);
    expect(trace).toBe("user assistant(A,B,C,D) tool(A) tool(B) tool(C) tool(D) user");
    expect(kimiValid(sent)).toBe(true);
  });

  test("results split over two user messages are gathered", () => {
    const { trace } = chatTrace([
      { role: "assistant", parts: [call("A"), call("B")] },
      { role: "user", parts: [result("B", "2")] },
      { role: "user", parts: [result("A", "1")] },
    ]);
    expect(trace).toBe("assistant(A,B) tool(A) tool(B)");
  });

  test("a result that answers no call becomes a user message", () => {
    const { trace, sent } = chatTrace([
      { role: "user", parts: [result("X", "kept")] },
      { role: "user", parts: [text("go on")] },
    ]);
    expect(trace).toBe("user user");
    expect(sent[0]?.content).toBe("kept");
  });

  test("a late result joins the user message after the exchange closed", () => {
    const { trace, sent } = chatTrace([
      { role: "assistant", parts: [call("A")] },
      { role: "user", parts: [text("note")] },
      { role: "user", parts: [result("A", "real result")] },
    ]);
    expect(trace).toBe("assistant(A) tool(A) user");
    expect(sent[1]?.content).toBe(
      "[The result of this tool call is unavailable: the turn was interrupted.]",
    );
    expect(sent[2]?.content).toBe("note\n\nreal result");
    expect(kimiValid(sent)).toBe(true);
  });

  test("a second answer to the same call is dropped", () => {
    const { trace, sent } = chatTrace([
      { role: "assistant", parts: [call("A")] },
      { role: "user", parts: [result("A", "1"), result("A", "1 again")] },
    ]);
    expect(trace).toBe("assistant(A) tool(A)");
    expect(sent[1]?.content).toBe("1");
  });

  test("a result with an empty call id becomes a user message", () => {
    const { trace, sent } = chatTrace([{ role: "user", parts: [result("", "no call")] }]);
    expect(trace).toBe("user");
    expect(sent[0]?.content).toBe("no call");
  });

  test("an unanswered call gets a synthetic result before what the user said", () => {
    const { trace, sent } = chatTrace([
      { role: "assistant", parts: [call("A")] },
      { role: "user", parts: [text("继续")] },
    ]);
    expect(trace).toBe("assistant(A) tool(A) user");
    expect(sent[1]).toEqual({
      role: "tool",
      tool_call_id: "A",
      content: "[The result of this tool call is unavailable: the turn was interrupted.]",
    });
  });

  test("a thinking-only assistant turn inside an exchange is dropped, outside it is kept", () => {
    const thought: Part = { kind: "thinking", text: "hmm", signature: "sig" };
    expect(
      chatTrace([
        { role: "assistant", parts: [call("A")] },
        { role: "assistant", parts: [thought] },
        { role: "user", parts: [result("A", "1")] },
      ]).trace,
    ).toBe("assistant(A) tool(A)");
    expect(
      chatTrace([
        { role: "user", parts: [text("hi")] },
        { role: "assistant", parts: [thought] },
        { role: "user", parts: [text("继续")] },
      ]).trace,
    ).toBe("user assistant user");
  });

  test("a whole session keeps a valid shape", () => {
    const { trace, sent } = chatTrace([
      { role: "user", parts: [text("look into it")] },
      { role: "assistant", parts: [text("on it")] },
      { role: "assistant", parts: [call("A"), call("B")] },
      { role: "user", parts: [result("B", "2")] },
      { role: "user", parts: [result("A", "1")] },
      { role: "assistant", parts: [text("one more")] },
      { role: "assistant", parts: [call("C")] },
      { role: "user", parts: [text("interrupted")] },
      { role: "user", parts: [result("C", "late")] },
      { role: "assistant", parts: [text("done")] },
      { role: "user", parts: [text("thanks")] },
    ]);
    expect(trace).toBe(
      "user assistant assistant(A,B) tool(A) tool(B) assistant assistant(C) tool(C) user assistant user",
    );
    expect(kimiValid(sent)).toBe(true);
  });

  test("a clean exchange is built as it was", () => {
    const { trace } = chatTrace([
      { role: "user", parts: [text("hi")] },
      { role: "assistant", parts: [text("hello")] },
      { role: "assistant", parts: [call("A"), call("B")] },
      { role: "user", parts: [result("A", "1"), result("B", "2")] },
      { role: "user", parts: [text("thanks")] },
    ]);
    expect(trace).toBe("user assistant assistant(A,B) tool(A) tool(B) user");
  });
});

function decodeChat(chunks: string[]): StreamEvent[] {
  const decoder = new ChatDecoder();
  const events: StreamEvent[] = [];
  for (const chunk of chunks) decoder.decode(chunk, (event) => events.push(event));
  return events;
}

/** 解码出的文字、推理、调用与结束原因，拼起来看。 */
function summary(events: StreamEvent[]) {
  const out = { text: "", think: "", calls: [] as string[], args: "", stop: "" };
  for (const event of events) {
    if (event.kind === "text") out.text += event.text;
    else if (event.kind === "think") out.think += event.text;
    else if (event.kind === "tool_start") out.calls.push(`${event.id}/${event.name}`);
    else if (event.kind === "tool_args") out.args += event.text;
    else if (event.kind === "stop") out.stop = event.stop;
  }
  return out;
}

describe("decoding a Chat stream (magpie translate_stream_test.go)", () => {
  test("only the first choice is kept", () => {
    const events = decodeChat([
      '{"id":"x","choices":[{"index":0,"delta":{"reasoning_content":"First thought","content":"Alpha","tool_calls":[{"index":0,"id":"first","function":{"name":"right","arguments":"{\\"ok\\":true}"}}]}},{"index":1,"delta":{"reasoning_content":"Other thought","content":"Beta","tool_calls":[{"index":0,"id":"other","function":{"name":"wrong","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}',
      '{"id":"x","choices":[{"index":1,"delta":{"content":" again","tool_calls":[{"index":0,"function":{"arguments":"not mine"}}]},"finish_reason":"stop"},{"index":0,"delta":{"content":" done","tool_calls":[{"index":0,"function":{"arguments":" more"}}]},"finish_reason":"tool_calls"}]}',
      '{"id":"x","choices":[{"delta":{"content":"!"}}]}',
    ]);
    expect(summary(events)).toEqual({
      text: "Alpha done!",
      think: "First thought",
      calls: ["first/right"],
      args: '{"ok":true} more',
      stop: "tool",
    });
  });

  test("the choice is told by its index whether it is a number, a numeric string or 1.0", () => {
    expect(
      summary(
        decodeChat([
          '{"id":"x","choices":[{"index":"1","delta":{"content":"Hel"}}]}',
          '{"id":"x","choices":[{"index":0,"delta":{"content":"not mine"}},{"index":1.0,"delta":{"content":"lo"},"finish_reason":"stop"}]}',
        ]),
      ).text,
    ).toBe("Hello");
  });

  test("chunks without a readable index continue the chosen choice", () => {
    expect(
      summary(
        decodeChat([
          '{"id":"x","choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}',
          '{"id":"x","choices":[{"delta":{"role":"assistant"}}]}',
          '{"id":"x","choices":[{"index":1,"delta":{"content":"H"}}]}',
          '{"id":"x","choices":[{"delta":{"content":"e"}}]}',
          '{"id":"x","choices":[{"index":null,"delta":{"content":"l"}}]}',
          '{"id":"x","choices":[{"index":{},"delta":{"content":"l"}}]}',
          '{"id":"x","choices":[{"index":1,"delta":{"content":"o"},"finish_reason":"stop"}]}',
        ]),
      ).text,
    ).toBe("Hello");
  });

  test("reasoning sent under both names is read once", () => {
    expect(
      summary(
        decodeChat([
          '{"id":"x","choices":[{"delta":{"reasoning_content":"The ","reasoning":"The "}}]}',
          '{"id":"x","choices":[{"delta":{"reasoning_content":"user","reasoning":"user"}}]}',
          '{"id":"x","choices":[{"delta":{"reasoning":" wants"}}]}',
          '{"id":"x","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
        ]),
      ).think,
    ).toBe("The user wants");
  });

  test("parallel calls keep their own ids, and a repeated id stays one call", () => {
    const events = decodeChat([
      '{"id":"x","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"one","arguments":""}}]}}]}',
      '{"id":"x","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"arguments":"{\\"n\\":1}"}}]}}]}',
      '{"id":"x","choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_b","type":"function","function":{"name":"two","arguments":"{\\"n\\":2}"}}]}}]}',
      '{"id":"x","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
    ]);
    expect(summary(events)).toEqual({
      text: "",
      think: "",
      calls: ["call_a/one", "call_b/two"],
      args: '{"n":1}{"n":2}',
      stop: "tool",
    });
  });

  test("an error chunk ends the reply as an error", () => {
    expect(decodeChat(['{"error":{"message":"upstream overloaded"}}'])).toEqual([
      { kind: "error", message: "upstream overloaded", code: null, vendorError: null },
    ]);
  });
});

/** Chat 流经 Anthropic 编码器写给 Claude Code 的事件（data 部分）。 */
function chatToAnthropic(chunks: string[]): Record<string, unknown>[] {
  let written = "";
  const encoder = new AnthropicEncoder({
    model: "relay-a/kimi-k2",
    write: (piece) => {
      written += piece;
    },
  });
  const decoder = new ChatDecoder();
  for (const chunk of chunks) decoder.decode(chunk, (event) => encoder.event(event));
  encoder.finish();
  return written
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

describe("a Chat stream told to Claude Code", () => {
  test("a repeated call id opens one tool_use block whose input is one JSON object", () => {
    const events = chatToAnthropic([
      '{"id":"x","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}',
      '{"id":"x","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"arguments":"{\\"city\\":"}}]}}]}',
      '{"id":"x","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"arguments":"\\"SF\\"}"}}]}}]}',
      '{"id":"x","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
    ]);
    const blocks = events.filter((event) => event.type === "content_block_start");
    const input = events
      .flatMap((event) =>
        event.type === "content_block_delta"
          ? [(event.delta as { partial_json: string }).partial_json]
          : [],
      )
      .join("");
    expect(blocks).toEqual([
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "call_1", name: "get_weather", input: {} },
      },
    ]);
    expect(JSON.parse(input)).toEqual({ city: "SF" });
  });

  test("text, a call, the stop reason and usage come out as Anthropic events with the asked model name", () => {
    const events = chatToAnthropic([
      '{"id":"chatcmpl-9","model":"kimi-k2-0905","choices":[{"index":0,"delta":{"role":"assistant","content":"Let me look."}}]}',
      '{"id":"chatcmpl-9","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_ls","type":"function","function":{"name":"Bash","arguments":"{\\"command\\":\\"ls\\"}"}}]}}]}',
      '{"id":"chatcmpl-9","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
      '{"id":"chatcmpl-9","choices":[],"usage":{"prompt_tokens":120,"completion_tokens":30,"prompt_tokens_details":{"cached_tokens":100}}}',
    ]);
    expect(events).toEqual([
      {
        type: "message_start",
        message: {
          id: "msg_9",
          type: "message",
          role: "assistant",
          model: "relay-a/kimi-k2",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Let me look." },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "call_ls", name: "Bash", input: {} },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' },
      },
      { type: "content_block_stop", index: 1 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: {
          input_tokens: 20,
          output_tokens: 30,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 0,
        },
      },
      { type: "message_stop" },
    ]);
  });
});

describe("Chat usage (magpie chat.go cUsage)", () => {
  test("cached tokens are taken out of the prompt, whichever name a vendor gives them", () => {
    expect(
      usageFromChat({ prompt_tokens: 120, completion_tokens: 30, prompt_cache_hit_tokens: 100 }),
    ).toEqual({
      input: 20,
      output: 30,
      cacheRead: 100,
      cacheWrite: 0,
      cacheWrite1h: 0,
      reasoning: 0,
    });
    expect(
      usageFromChat({
        prompt_tokens: 10,
        completion_tokens: 5,
        cache_read_input_tokens: 400,
        cache_creation_input_tokens: 50,
        completion_tokens_details: { reasoning_tokens: 3 },
      }),
    ).toEqual({
      input: 10,
      output: 5,
      cacheRead: 400,
      cacheWrite: 50,
      cacheWrite1h: 0,
      reasoning: 3,
    });
  });
});

describe("magpie's anthropic-to-chat upstream body (testdata/upstream_bodies)", () => {
  test("Claude Code's request reaches a Chat upstream as magpie builds it", () => {
    const parsed = parseAnthropicRequest(
      JSON.parse(`{ "max_tokens" : 1024,"model":"fake/m1", "metadata":{"user_id":"u_1"},
 "system":[{"type":"text","text":"You are é \\/ \\"careful\\"\\n\\ttabs","cache_control":{"type":"ephemeral"}}],
 "tools":[{"name":"Read","description":"Reads a file","input_schema":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}],
 "messages":[{"role":"user","content":"read it"},
  {"role":"assistant","content":[{"type":"thinking","thinking":"hmm","signature":"c2ln"},{"type":"text","text":"ok 漢字 😀"},{"type":"tool_use","id":"toolu_1","name":"Read","input":{"path":"/a b/c.go","n":1.50e2}}]},
  {"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":[{"type":"text","text":"line\\u0001one\\r\\nline two"}]},{"type":"text","text":"go on"}]}],
 "temperature":0.70, "stream":false, "unknown_field":{"kept":[1,2,{"x":null}]}}`),
    );
    const built = buildChatRequest({ ...parsed, stream: true }, "m1");
    // magpie 逐字节比对；JSON.parse 读不回参数原文（1.50e2 写回成 150），这里按值比对。
    expect(built).toEqual(
      JSON.parse(
        '{"max_tokens":1024,"messages":[{"content":"You are é / \\"careful\\"\\n\\ttabs","role":"system"},{"content":"read it","role":"user"},{"content":"ok 漢字 😀","role":"assistant","tool_calls":[{"function":{"arguments":"{\\"path\\":\\"/a b/c.go\\",\\"n\\":150}","name":"Read"},"id":"toolu_1","type":"function"}]},{"content":"line\\u0001one\\r\\nline two","role":"tool","tool_call_id":"toolu_1"},{"content":"go on","role":"user"}],"model":"m1","stream":true,"stream_options":{"include_usage":true},"temperature":0.7,"tools":[{"function":{"description":"Reads a file","name":"Read","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}},"type":"function"}]}',
      ),
    );
  });
});

describe("stop reasons between Chat and Anthropic (magpie anthropic.go / chat.go stop maps)", () => {
  test.each([
    ["stop", "end_turn"],
    ["length", "max_tokens"],
    ["tool_calls", "tool_use"],
    ["function_call", "tool_use"],
    ["content_filter", "refusal"],
  ])("a Chat finish_reason %s reaches Claude Code as %s", (finish, stopReason) => {
    const events = chatToAnthropic([
      `{"id":"x","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":"${finish}"}]}`,
    ]);
    expect(events.find((event) => event.type === "message_delta")?.delta).toEqual({
      stop_reason: stopReason,
      stop_sequence: null,
    });
  });
});

describe("thinking at the head of a Chat reply's text (magpie minimax_think_test.go)", () => {
  function thinkAndText(parts: string[]) {
    const chunks = parts.map((content, index) =>
      JSON.stringify({
        id: "x",
        choices: [
          {
            index: 0,
            delta: { content },
            ...(index === parts.length - 1 ? { finish_reason: "stop" } : {}),
          },
        ],
      }),
    );
    const { think, text: said } = summary(decodeChat(chunks));
    return { think, text: said };
  }

  test.each([
    ["whole", ["<think>Greeting.</think>\n\nHello"], "Greeting.", "Hello"],
    ["one character a chunk", "<think>ab</think>cd".split(""), "ab", "cd"],
    ["a <thought> block", ["<thought>Plan.</thought>Done"], "Plan.", "Done"],
    [
      "a thought's close doesn't end a think",
      ["<think>a</thought>b</think>c"],
      "a</thought>b",
      "c",
    ],
    ["a think tag later in the text", ["Hi <think>no</think>"], "", "Hi <think>no</think>"],
    ["<thin is text", ["<thin", "g>"], "", "<thing>"],
  ])("%s", (_name, parts, think, said) => {
    expect(thinkAndText(parts)).toEqual({ think, text: said });
  });

  test("MiniMax's stream, its tags split across chunks, reaches Claude Code as a thinking block then the answer", () => {
    const events = chatToAnthropic([
      '{"id":"0581e2a0","choices":[{"index":0,"delta":{"content":"<th","role":"assistant"}}]}',
      '{"id":"0581e2a0","choices":[{"index":0,"delta":{"content":"ink>\\nThe user greets me","role":"assistant"}}]}',
      '{"id":"0581e2a0","choices":[{"index":0,"delta":{"content":". Reply briefly.\\n</thi","role":"assistant"}}]}',
      '{"id":"0581e2a0","choices":[{"index":0,"delta":{"content":"nk>\\n\\nHello!","role":"assistant"}}]}',
      '{"id":"0581e2a0","choices":[{"finish_reason":"stop","index":0,"delta":{"content":""}}],"usage":{"total_tokens":40,"prompt_tokens":20,"completion_tokens":20}}',
    ]);
    const blocks = events.flatMap((event) =>
      event.type === "content_block_start" ? [event.content_block] : [],
    );
    const deltas = events.flatMap((event) =>
      event.type === "content_block_delta" ? [event.delta] : [],
    );
    expect(blocks).toEqual([
      { type: "thinking", thinking: "" },
      { type: "text", text: "" },
    ]);
    expect(deltas).toEqual([
      { type: "thinking_delta", thinking: "\nThe user greets me" },
      { type: "thinking_delta", thinking: ". Reply briefly.\n" },
      { type: "text_delta", text: "Hello!" },
    ]);
  });

  test("a stream that ends while a tag could still be starting gives the held text back", () => {
    const decoder = new ChatDecoder();
    const events: StreamEvent[] = [];
    decoder.decode('{"id":"x","choices":[{"index":0,"delta":{"content":"<thi"}}]}', (event) =>
      events.push(event),
    );
    decoder.end((event) => events.push(event));
    expect(summary(events).text).toBe("<thi");
  });
});

describe("images in a Claude Code request asked of a Chat endpoint", () => {
  const PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  test("an inline image becomes a data URL and an image by URL stays that URL, not fetched", () => {
    const parsed = parseAnthropicRequest({
      model: "m",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what are these" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
            { type: "image", source: { type: "url", url: "https://example.com/cat.jpg" } },
          ],
        },
      ],
    });
    expect(buildChatRequest(parsed, "m").messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "what are these" },
          { type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } },
          { type: "image_url", image_url: { url: "https://example.com/cat.jpg" } },
        ],
      },
    ]);
  });

  test("a tool's images follow its result in a user message that says whose they are", () => {
    const parsed = parseAnthropicRequest({
      model: "m",
      messages: [
        { role: "user", content: "look at the screen" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "Screenshot", input: {} }],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [
                { type: "text", text: "taken" },
                { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
              ],
            },
            { type: "text", text: "what do you see" },
          ],
        },
      ],
    });
    expect(buildChatRequest(parsed, "m").messages).toEqual([
      { role: "user", content: "look at the screen" },
      {
        role: "assistant",
        tool_calls: [
          { id: "toolu_1", type: "function", function: { name: "Screenshot", arguments: "{}" } },
        ],
      },
      {
        role: "tool",
        tool_call_id: "toolu_1",
        content: "taken\n\n[The tool returned an image; it follows in the next message.]",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "[From the result of Screenshot (tool call toolu_1):]" },
          { type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } },
          { type: "text", text: "what do you see" },
        ],
      },
    ]);
  });
});

describe("file attachments in a Claude Code request asked of a Chat endpoint", () => {
  test("a document block, in the message or in a tool result, is left out", () => {
    const pdf = { type: "base64", media_type: "application/pdf", data: "JVBERi0x" };
    const parsed = parseAnthropicRequest({
      model: "m",
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: pdf },
            { type: "text", text: "summarise it" },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: {} }],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [
                { type: "text", text: "read" },
                { type: "document", source: pdf },
              ],
            },
          ],
        },
      ],
    });
    expect(buildChatRequest(parsed, "m").messages).toEqual([
      { role: "user", content: "summarise it" },
      {
        role: "assistant",
        tool_calls: [
          { id: "toolu_1", type: "function", function: { name: "Read", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "toolu_1", content: "read" },
    ]);
  });
});

describe("earlier thinking in a Claude Code request asked of a Chat endpoint (magpie reasoning_replay_test.go)", () => {
  const conversation = {
    model: "m",
    messages: [
      { role: "user", content: "fix the bug" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Read main.go.", signature: "EqQBCkgIBxAB" },
          { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "cat main.go" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "package main" }],
      },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_2", name: "Bash", input: { command: "go test" } }],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "ok" }] },
      { role: "assistant", content: [{ type: "text", text: "It passes." }] },
      { role: "user", content: "thanks" },
      { role: "assistant", content: [{ type: "text", text: "Welcome." }] },
      { role: "user", content: "bye" },
    ],
  };
  const reasoning = (model: string) =>
    (buildChatRequest(parseAnthropicRequest(conversation), model).messages as ChatSent[])
      .filter((message) => message.role === "assistant")
      .map((message) => message.reasoning_content);

  test("another model is sent none of it, Claude's signed thinking included", () => {
    expect(reasoning("glm-4.6")).toEqual([undefined, undefined, undefined, undefined]);
  });

  test("a DeepSeek model gets it back, and a space on a call or a reply to tool results that had none", () => {
    expect(reasoning("deepseek-v3")).toEqual(["Read main.go.", " ", " ", undefined]);
    expect(reasoning("Pro/DeepSeek-V3.2")).toEqual(["Read main.go.", " ", " ", undefined]);
  });
});

interface ChatSent {
  role: string;
  reasoning_content?: string;
}

describe("this turn's thinking and server tools between Claude Code and a Chat endpoint", () => {
  test("reasoning streamed by a Chat endpoint reaches Claude Code as a thinking block as it comes", () => {
    const events = chatToAnthropic([
      '{"id":"x","choices":[{"index":0,"delta":{"reasoning_content":"Let me "}}]}',
      '{"id":"x","choices":[{"index":0,"delta":{"reasoning_content":"think."}}]}',
      '{"id":"x","choices":[{"index":0,"delta":{"content":"Done."},"finish_reason":"stop"}]}',
    ]);
    expect(events.filter((event) => String(event.type).startsWith("content_block"))).toEqual([
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Let me " },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "think." },
      },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Done." } },
      { type: "content_block_stop", index: 1 },
    ]);
  });

  test("Anthropic's web search tool is left out of the tools a Chat endpoint is offered", () => {
    const parsed = parseAnthropicRequest({
      model: "m",
      messages: [{ role: "user", content: "news?" }],
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 5 },
        { name: "Bash", description: "Run", input_schema: { type: "object" } },
      ],
    });
    expect(buildChatRequest(parsed, "m").tools).toEqual([
      {
        type: "function",
        function: { name: "Bash", description: "Run", parameters: { type: "object" } },
      },
    ]);
  });
});

describe("a Chat request built for the model as its facts say (magpie fitFor, catalog.NearestEffort, Levelless, RejectsTemperature)", () => {
  function built(input: { effort: Effort; facts: ModelFacts }) {
    const asked = {
      ...request([{ role: "user", parts: [{ kind: "text", text: "hi" }] }]),
      effort: input.effort,
      thinking: true,
      temperature: 0.2,
      topP: 0.9,
    };
    const fitted = requestForModel({ request: asked, to: "openai_chat", facts: input.facts });
    return buildChatRequest(fitted, "glm-5.3");
  }

  function body(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      model: "glm-5.3",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
      top_p: 0.9,
      ...extra,
    };
  }

  test("a model listing xhigh is asked xhigh", () => {
    const facts = { efforts: ["low", "medium", "high", "xhigh"] };
    expect(built({ effort: "xhigh", facts })).toEqual(body({ reasoning_effort: "xhigh" }));
  });

  test("a model without the level asked gets its nearest, a tie going up", () => {
    // GLM-5.3 只有 low、high、max（magpie fitEffort 的注释）。
    const facts = { efforts: ["low", "high", "max"] };
    expect(built({ effort: "xhigh", facts })).toEqual(body({ reasoning_effort: "max" }));
    expect(built({ effort: "medium", facts })).toEqual(body({ reasoning_effort: "high" }));
    expect(built({ effort: "low", facts })).toEqual(body({ reasoning_effort: "low" }));
  });

  test("the whole ladder counts, minimal included (magpie EffortRank)", () => {
    expect(built({ effort: "xhigh", facts: { efforts: ["minimal"] } })).toEqual(
      body({ reasoning_effort: "minimal" }),
    );
    expect(built({ effort: "low", facts: { efforts: ["minimal", "high"] } })).toEqual(
      body({ reasoning_effort: "minimal" }),
    );
  });

  test("never none, which only turning reasoning off asks", () => {
    const facts = { efforts: ["none", "high"] };
    expect(built({ effort: "low", facts })).toEqual(body({ reasoning_effort: "high" }));
  });

  test("a model known to have no levels is asked no more than high; one whose levels are not known, as asked", () => {
    expect(built({ effort: "max", facts: { efforts: [] } })).toEqual(
      body({ reasoning_effort: "high" }),
    );
    expect(built({ effort: "medium", facts: { efforts: [] } })).toEqual(
      body({ reasoning_effort: "medium" }),
    );
    expect(built({ effort: "max", facts: {} })).toEqual(body({ reasoning_effort: "max" }));
  });

  test("a model known to refuse temperature and top_p is sent neither; one that takes them or is unknown keeps them", () => {
    const effort = "high";
    expect(built({ effort, facts: { takesSampling: false } })).toEqual({
      model: "glm-5.3",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      stream_options: { include_usage: true },
      reasoning_effort: "high",
    });
    expect(built({ effort, facts: { takesSampling: true } })).toEqual(
      body({ reasoning_effort: "high" }),
    );
    expect(built({ effort, facts: {} })).toEqual(body({ reasoning_effort: "high" }));
  });
});

describe("an earlier turn's thinking in any of a Chat client's three spellings (magpie chat_inbound_reasoning_test.go)", () => {
  const ASKED = { role: "user", content: "Read go.mod and bump the go directive." };
  const CALL = {
    id: "call_1",
    type: "function",
    function: { name: "read_file", arguments: '{"path":"go.mod"}' },
  };
  const RESULT = { role: "tool", tool_call_id: "call_1", content: "go 1.24\n" };

  function assistantTurn(reasoning: Record<string, unknown>): Message {
    const assistant = { role: "assistant", ...reasoning, tool_calls: [CALL] };
    const parsed = parseChatRequest({ model: "m", messages: [ASKED, assistant, RESULT] });
    return parsed.messages[1]!;
  }

  function thinkingThenCall(thought: string): Message {
    return {
      role: "assistant",
      parts: [
        { kind: "thinking", text: thought, signature: "" },
        { kind: "tool_call", id: "call_1", name: "read_file", args: '{"path":"go.mod"}' },
      ],
    };
  }

  test.each([
    ["reasoning_content", { reasoning_content: "go.mod has to be read before it is changed." }],
    ["reasoning", { reasoning: "go.mod has to be read before it is changed." }],
    [
      "reasoning_details",
      {
        reasoning_details: [
          {
            type: "reasoning.text",
            text: "go.mod has to be read before it is changed.",
            signature: null,
            format: "unknown",
            index: 0,
          },
        ],
      },
    ],
  ])("%s is read as the turn's thinking", (_name, reasoning) => {
    expect(assistantTurn(reasoning)).toEqual(
      thinkingThenCall("go.mod has to be read before it is changed."),
    );
  });

  test("reasoning_details without text gives its summary", () => {
    const details = { reasoning_details: [{ type: "reasoning.summary", summary: "Read first." }] };
    expect(assistantTurn(details)).toEqual(thinkingThenCall("Read first."));
  });

  test("several spellings are one thinking, read in magpie's order", () => {
    const parsed = parseChatRequest({
      model: "m",
      messages: [
        ASKED,
        {
          role: "assistant",
          reasoning_content: "the reasoning_content one",
          reasoning: "the reasoning one",
          reasoning_details: [{ type: "reasoning.text", text: "the reasoning_details one" }],
          content: "done",
        },
      ],
    });
    expect(parsed.messages[1]).toEqual({
      role: "assistant",
      parts: [
        { kind: "thinking", text: "the reasoning_content one", signature: "" },
        { kind: "text", text: "done" },
      ],
    });
  });
});

describe("Gemini's thoughts marked in a Chat stream's extra_content (magpie gemini_thought_tag_test.go TestChatMarkedThoughtTags)", () => {
  function decoded(parts: [string, boolean][]): { think: string; text: string } {
    const decoder = new ChatDecoder();
    const out = { think: "", text: "" };
    parts.forEach(([content, marked], index) => {
      const delta: Record<string, unknown> = { content };
      if (marked) delta.extra_content = { google: { thought: true } };
      const choice: Record<string, unknown> = { index: 0, delta };
      if (index === parts.length - 1) choice.finish_reason = "stop";
      decoder.decode(JSON.stringify({ id: "x", choices: [choice] }), (event) => {
        if (event.kind === "think") out.think += event.text;
        if (event.kind === "text") out.text += event.text;
      });
    });
    return out;
  }

  test.each<[string, [string, boolean][], string, string]>([
    [
      "close unmarked",
      [
        ["<thought>hm", true],
        ["</thought>Hi", false],
      ],
      "hm",
      "Hi",
    ],
    [
      "more thought marked",
      [
        ["<thought>a", true],
        ["b", true],
        ["</thought>\nHi", false],
      ],
      "ab",
      "Hi",
    ],
    [
      "open split",
      [
        ["<tho", true],
        ["ught>a", true],
        ["</thought>Hi", false],
      ],
      "a",
      "Hi",
    ],
    [
      "close split",
      [
        ["<thought>a", true],
        ["</tho", false],
        ["ught>Hi", false],
      ],
      "a",
      "Hi",
    ],
    [
      "close marked",
      [
        ["<thought>a</thought>", true],
        ["Hi", false],
      ],
      "a",
      "Hi",
    ],
    [
      "only the close",
      [
        ["<thought>a", true],
        ["</thought>", false],
        ["Hi", false],
      ],
      "a",
      "Hi",
    ],
    [
      "no tags",
      [
        ["**Plan**\n\nthink", true],
        ["Hi", false],
      ],
      "**Plan**\n\nthink",
      "Hi",
    ],
    [
      "no tags, then a quoted tag",
      [
        ["think", true],
        ["Use <thought> here", false],
      ],
      "think",
      "Use <thought> here",
    ],
    [
      "answer quotes a close",
      [
        ["think", true],
        ["Hi", false],
        [" </thought>", false],
      ],
      "think",
      "Hi </thought>",
    ],
  ])("%s", (_name, parts, think, answer) => {
    expect(decoded(parts)).toEqual({ think, text: answer });
  });
});
