import { describe, expect, test } from "vitest";
import {
  AnthropicDecoder,
  anthropicInId,
  anthropicOutId,
  buildAnthropicRequest,
  parseAnthropicRequest,
  renderAnthropic,
  usageFromAnthropic,
  usageToAnthropic,
} from "./anthropic.js";
import { ChatDecoder, parseChatRequest, renderChat } from "./chat.js";
import { ReplyCollector, type GatewayRequest, type Message, type Part } from "./ir.js";

/*
 * Anthropic Messages 这一侧的翻译。例子照 magpie（MIT，THIRD_PARTY_NOTICES）的
 * anthropic_tool_pairing_test.go、devin_tool_ids_test.go、anthropic_cache_ttl_test.go、stop_context_test.go。
 */

const INTERRUPTED = "[The result of this tool call is unavailable: the turn was interrupted.]";

function request(messages: Message[]): GatewayRequest {
  return {
    model: "claude-sonnet-4-5",
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
  };
}

function call(id: string): Part {
  return { kind: "tool_call", id, name: "run", args: "{}" };
}

function result(id: string, output: string): Part {
  return { kind: "tool_result", callId: id, text: output, isError: false };
}

function text(value: string): Part {
  return { kind: "text", text: value };
}

interface SentBlock {
  type: string;
  id?: string;
  tool_use_id?: string;
  text?: string;
  content?: unknown;
  is_error?: boolean;
}

interface SentMessage {
  role: string;
  content: SentBlock[];
}

/** 角色序列，带上调用与回答的 id：「user assistant(A) user[A]」。 */
function messagesTrace(messages: Message[]): { trace: string; sent: SentMessage[] } {
  const sent = buildAnthropicRequest(request(messages), "claude-sonnet-4-5")
    .messages as SentMessage[];
  const trace = sent
    .map((message) => {
      const calls = message.content.flatMap((block) =>
        block.type === "tool_use" ? [block.id] : [],
      );
      const results = message.content.flatMap((block) =>
        block.type === "tool_result" ? [block.tool_use_id] : [],
      );
      return `${message.role}${calls.length > 0 ? `(${calls.join(",")})` : ""}${
        results.length > 0 ? `[${results.join(",")}]` : ""
      }`;
    })
    .join(" ");
  return { trace, sent };
}

/** Anthropic 的校验：每个结果回答前一条 assistant 的调用，每个调用都被下一条消息回答。 */
function anthropicValid(sent: SentMessage[]): boolean {
  let pending = new Set<string>();
  for (const message of sent) {
    if (message.role === "assistant") {
      pending = new Set(
        message.content.flatMap((block) => (block.type === "tool_use" ? [String(block.id)] : [])),
      );
      continue;
    }
    for (const block of message.content) {
      if (block.type !== "tool_result") continue;
      if (!pending.delete(String(block.tool_use_id))) return false;
    }
    if (pending.size > 0) return false;
  }
  return true;
}

describe("mending the tool exchange of a Messages request (magpie anthropic_tool_pairing_test.go)", () => {
  test("an unanswered call gets the synthetic result before what the user said", () => {
    const { trace, sent } = messagesTrace([
      { role: "user", parts: [text("run it")] },
      { role: "assistant", parts: [call("A")] },
      { role: "user", parts: [text("go on")] },
    ]);
    expect(trace).toBe("user assistant(A) user[A]");
    expect(anthropicValid(sent)).toBe(true);
    expect(sent[2]?.content).toEqual([
      { type: "tool_result", tool_use_id: "A", content: INTERRUPTED, is_error: true },
      { type: "text", text: "go on" },
    ]);
  });

  test("a result that answers no call becomes a text block that keeps what it said", () => {
    const { trace, sent } = messagesTrace([
      { role: "user", parts: [text("run it")] },
      { role: "assistant", parts: [call("A")] },
      { role: "user", parts: [result("A", "ok"), result("gone", "late")] },
    ]);
    expect(trace).toBe("user assistant(A) user[A]");
    expect(sent[2]?.content).toEqual([
      { type: "tool_result", tool_use_id: "A", content: "ok" },
      { type: "text", text: "late" },
    ]);
  });

  test("a result with no call anywhere stays as text beside the user's own", () => {
    const { trace, sent } = messagesTrace([
      { role: "user", parts: [result("gone", "late"), text("go on")] },
    ]);
    expect(trace).toBe("user");
    expect(sent[0]?.content).toEqual([
      { type: "text", text: "late" },
      { type: "text", text: "go on" },
    ]);
  });

  test("a conversation that ends on its calls ends on their synthetic results", () => {
    const { trace, sent } = messagesTrace([
      { role: "user", parts: [text("run it")] },
      { role: "assistant", parts: [call("A")] },
    ]);
    expect(trace).toBe("user assistant(A) user[A]");
    expect(anthropicValid(sent)).toBe(true);
  });

  test("a clean exchange keeps its order, results before the text beside them", () => {
    const { trace, sent } = messagesTrace([
      { role: "user", parts: [text("run them")] },
      { role: "assistant", parts: [call("A"), call("B")] },
      { role: "user", parts: [result("B", "second"), result("A", "first"), text("done")] },
    ]);
    expect(trace).toBe("user assistant(A,B) user[B,A]");
    expect(sent[2]?.content.at(-1)).toEqual({ type: "text", text: "done" });
  });

  test("another vendor's call id is encoded and its synthetic result names it the same way", () => {
    const { sent } = messagesTrace([
      { role: "user", parts: [text("run it")] },
      { role: "assistant", parts: [call("Bash:0#a65b6a5e")] },
      { role: "user", parts: [result("gone", "late")] },
    ]);
    const id = anthropicOutId("Bash:0#a65b6a5e");
    expect(sent[1]?.content[0]?.id).toBe(id);
    expect(sent[2]?.content).toEqual([
      { type: "tool_result", tool_use_id: id, content: INTERRUPTED, is_error: true },
      { type: "text", text: "late" },
    ]);
  });

  test("a call answered twice keeps its first answer", () => {
    const { trace, sent } = messagesTrace([
      { role: "user", parts: [text("run it")] },
      { role: "assistant", parts: [call("A")] },
      { role: "user", parts: [result("A", "first"), result("A", "again")] },
    ]);
    expect(trace).toBe("user assistant(A) user[A]");
    expect(sent[2]?.content).toEqual([{ type: "tool_result", tool_use_id: "A", content: "first" }]);
  });

  test("a Chat request with an interrupted call and a late result is asked as a mended exchange", () => {
    const parsed = parseChatRequest({
      model: "fake/m1",
      stream: true,
      messages: [
        { role: "user", content: "run it" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "run", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "call_gone", content: "late" },
        { role: "user", content: "go on" },
      ],
    });
    const sent = buildAnthropicRequest(parsed, "m1").messages as SentMessage[];
    expect(anthropicValid(sent)).toBe(true);
    expect(sent).toEqual([
      { role: "user", content: [{ type: "text", text: "run it" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "run", input: {} }] },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "call_1", content: INTERRUPTED, is_error: true },
          { type: "text", text: "late" },
          { type: "text", text: "go on" },
        ],
      },
    ]);
  });
});

describe("call ids Claude Code can read (magpie devin_tool_ids_test.go)", () => {
  test("a safe id goes both ways as it is", () => {
    expect(anthropicOutId("toolu_01ABC-x")).toBe("toolu_01ABC-x");
    expect(anthropicInId("toolu_01ABC-x")).toBe("toolu_01ABC-x");
  });

  test("an id with other characters is encoded and comes back as it was", () => {
    const out = anthropicOutId("Bash:0#a65b6a5e");
    expect(out).toMatch(/^mp_[A-Za-z0-9_-]+$/);
    expect(anthropicInId(out)).toBe("Bash:0#a65b6a5e");
  });

  test("an id that only looks encoded is left alone", () => {
    expect(anthropicInId("mp_")).toBe("mp_");
    expect(anthropicOutId("mp_abc")).not.toBe("mp_abc");
    expect(anthropicInId(anthropicOutId("mp_abc"))).toBe("mp_abc");
  });

  test("an encoded id in Claude Code's next request reaches the upstream as its own", () => {
    const parsed = parseAnthropicRequest({
      model: "m",
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: anthropicOutId("Bash:0#1"), name: "run", input: {} }],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: anthropicOutId("Bash:0#1"), content: "ok" },
          ],
        },
      ],
    });
    expect(parsed.messages.flatMap((message) => message.parts)).toEqual([
      { kind: "tool_call", id: "Bash:0#1", name: "run", args: "{}" },
      { kind: "tool_result", callId: "Bash:0#1", text: "ok", isError: false },
    ]);
  });
});

describe("reading a Claude Code request", () => {
  test("tool_choice, server tools and the thinking budget are read into the request", () => {
    const parsed = parseAnthropicRequest({
      model: "kimi-k2",
      max_tokens: 32000,
      thinking: { type: "enabled", budget_tokens: 31999 },
      tool_choice: { type: "tool", name: "Bash", disable_parallel_tool_use: true },
      tools: [
        { name: "Bash", input_schema: { type: "object" } },
        { type: "web_search_20250305", name: "web_search", max_uses: 5 },
        { name: "DeferredToolPlaceholder", input_schema: { type: "object" } },
      ],
      messages: [{ role: "user", content: "hi" }],
    });
    expect(parsed).toMatchObject({
      toolChoice: "name:Bash",
      parallel: false,
      thinking: true,
      effort: "xhigh",
      tools: [{ name: "Bash", description: "", schema: { type: "object" } }],
    });
  });

  test("a body without messages is refused", () => {
    expect(() => parseAnthropicRequest({ model: "m" })).toThrow(
      "invalid request: messages must be an array",
    );
  });
});

function decodeAnthropic(chunks: string[]): ReplyCollector {
  const decoder = new AnthropicDecoder();
  const collector = new ReplyCollector();
  for (const chunk of chunks) decoder.decode(chunk, (event) => collector.add(event));
  return collector;
}

describe("decoding an Anthropic stream", () => {
  test("a context window stop is a truncation (magpie stop_context_test.go)", () => {
    const reply = decodeAnthropic([
      '{"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4-5","usage":{"input_tokens":10}}}',
      '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Half an ans"}}',
      '{"type":"content_block_stop","index":0}',
      '{"type":"message_delta","delta":{"stop_reason":"model_context_window_exceeded"},"usage":{"output_tokens":5}}',
    ]).finish();
    expect((renderChat(reply, "m").choices as { finish_reason: string }[])[0]?.finish_reason).toBe(
      "length",
    );
  });

  test("a tool_use whose start carries its input keeps it, and a server tool's blocks are skipped", () => {
    const reply = decodeAnthropic([
      '{"type":"message_start","message":{"id":"msg_2","usage":{"input_tokens":3}}}',
      '{"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","id":"srv","name":"web_search","input":{}}}',
      '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":\\"x\\"}"}}',
      '{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls"}}}',
      '{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":\\"ls\\"}"}}',
      '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}',
    ]).finish();
    expect(reply).toEqual({
      id: "msg_2",
      parts: [{ kind: "tool_call", id: "toolu_1", name: "Bash", args: '{"command":"ls"}' }],
      stop: "tool",
      usage: { input: 3, output: 7, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 },
    });
  });
});

describe("Anthropic usage (magpie anthropic_cache_ttl_test.go)", () => {
  test("cache writes keep their split by how long they are kept", () => {
    const usage = usageFromAnthropic({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 3000,
      cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 },
    });
    expect(usage).toEqual({
      input: 10,
      output: 5,
      cacheRead: 100,
      cacheWrite: 3000,
      cacheWrite1h: 2000,
      reasoning: 0,
    });
    expect(usageToAnthropic(usage).cache_creation).toEqual({
      ephemeral_5m_input_tokens: 1000,
      ephemeral_1h_input_tokens: 2000,
    });
  });

  test("usage without the split goes back without it", () => {
    const usage = usageFromAnthropic({
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 300,
    });
    expect(usage.cacheWrite1h).toBe(0);
    expect(usageToAnthropic(usage)).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 300,
    });
  });
});

describe("a whole reply for a Claude Code request that did not stream", () => {
  test("a Chat stream gathered whole renders as one Anthropic message with the asked model name", () => {
    const decoder = new ChatDecoder();
    const collector = new ReplyCollector();
    for (const chunk of [
      '{"id":"chatcmpl-7","model":"kimi-k2-0905","choices":[{"index":0,"delta":{"content":"Running it."}}]}',
      '{"id":"chatcmpl-7","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"Bash","arguments":"{\\"command\\":\\"ls\\"}"}}]},"finish_reason":"tool_calls"}]}',
      '{"id":"chatcmpl-7","choices":[],"usage":{"prompt_tokens":50,"completion_tokens":9}}',
    ]) {
      decoder.decode(chunk, (event) => collector.add(event));
    }
    expect(renderAnthropic(collector.finish(), "relay-a/kimi-k2")).toEqual({
      id: "msg_7",
      type: "message",
      role: "assistant",
      model: "relay-a/kimi-k2",
      content: [
        { type: "text", text: "Running it." },
        { type: "tool_use", id: "call_1", name: "Bash", input: { command: "ls" } },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: {
        input_tokens: 50,
        output_tokens: 9,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });
  });
});

describe("stop reasons from Anthropic to Chat (magpie stopFromAnthropic / stopToChat)", () => {
  test.each([
    ["end_turn", "stop"],
    ["stop_sequence", "stop"],
    ["max_tokens", "length"],
    ["tool_use", "tool_calls"],
    ["refusal", "content_filter"],
  ])("an Anthropic stop_reason %s is a Chat finish_reason %s", (stopReason, finish) => {
    const reply = decodeAnthropic([
      '{"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":1}}}',
      '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":"hi"}}',
      `{"type":"message_delta","delta":{"stop_reason":"${stopReason}"},"usage":{"output_tokens":1}}`,
    ]).finish();
    expect((renderChat(reply, "m").choices as { finish_reason: string }[])[0]?.finish_reason).toBe(
      finish,
    );
  });
});
