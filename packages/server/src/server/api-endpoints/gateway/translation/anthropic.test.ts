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
import { ChatDecoder, buildChatRequest, parseChatRequest, renderChat } from "./chat.js";
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

/** 发出的消息去掉缓存标记：配对的用例只看形状，标记另有用例。 */
function unmarked(messages: unknown): SentMessage[] {
  return JSON.parse(
    JSON.stringify(messages, (key, value: unknown) =>
      key === "cache_control" ? undefined : value,
    ),
  ) as SentMessage[];
}

/** 角色序列，带上调用与回答的 id：「user assistant(A) user[A]」。 */
function messagesTrace(messages: Message[]): { trace: string; sent: SentMessage[] } {
  const sent = unmarked(buildAnthropicRequest(request(messages), "claude-sonnet-4-5").messages);
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
    const sent = unmarked(buildAnthropicRequest(parsed, "m1").messages);
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
      { kind: "tool_result", callId: "Bash:0#1", text: "ok", isError: false, images: [] },
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

describe("prompt cache marks on a request built for Anthropic (magpie anthropic.go anthropicBody)", () => {
  const EPHEMERAL = { type: "ephemeral" };
  const tools = [
    { name: "Read", description: "Reads", schema: { type: "object" } },
    { name: "Bash", description: "Runs", schema: { type: "object" } },
  ];

  test("the system prompt and the last message's last block that is not thinking are marked; the tools are not", () => {
    const built = buildAnthropicRequest(
      {
        ...request([]),
        system: "be brief",
        tools,
        messages: [
          { role: "user", parts: [text("hi")] },
          {
            role: "assistant",
            parts: [text("ok"), { kind: "thinking", text: "hmm", signature: "c2ln" }],
          },
        ],
      },
      "claude-sonnet-4-5",
    );
    expect(built.system).toEqual([{ type: "text", text: "be brief", cache_control: EPHEMERAL }]);
    expect(built.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "ok", cache_control: EPHEMERAL },
          { type: "thinking", thinking: "hmm", signature: "c2ln" },
        ],
      },
    ]);
    expect(built.tools).toEqual([
      { name: "Read", description: "Reads", input_schema: { type: "object" } },
      { name: "Bash", description: "Runs", input_schema: { type: "object" } },
    ]);
  });

  test("without a system prompt the last tool is marked in its place", () => {
    const built = buildAnthropicRequest(
      { ...request([{ role: "user", parts: [text("hi")] }]), tools },
      "claude-sonnet-4-5",
    );
    expect(built.system).toBeUndefined();
    expect(built.tools).toEqual([
      { name: "Read", description: "Reads", input_schema: { type: "object" } },
      {
        name: "Bash",
        description: "Runs",
        input_schema: { type: "object" },
        cache_control: EPHEMERAL,
      },
    ]);
    expect(built.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hi", cache_control: EPHEMERAL }] },
    ]);
  });
});

describe("thinking on a request built for Anthropic (magpie anthropic.go anthropicBody)", () => {
  function built(model: string, fields: Partial<GatewayRequest>) {
    const out = buildAnthropicRequest(
      { ...request([{ role: "user", parts: [text("hi")] }]), temperature: 0.7, ...fields },
      model,
    );
    return {
      thinking: out.thinking,
      output_config: out.output_config,
      max_tokens: out.max_tokens,
      temperature: out.temperature,
    };
  }

  test("a Claude from 4.6 on thinks adaptively, shows its thinking and takes the effort", () => {
    expect(built("claude-opus-5-5", { thinking: true, effort: "high" })).toEqual({
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" },
      max_tokens: 16_384,
      temperature: undefined,
    });
  });

  test("Opus and Sonnet 4.6 have no xhigh and are asked max", () => {
    expect(built("claude-sonnet-4-6", { thinking: true, effort: "xhigh" }).output_config).toEqual({
      effort: "max",
    });
    expect(built("claude-opus-4-7", { thinking: true, effort: "xhigh" }).output_config).toEqual({
      effort: "xhigh",
    });
  });

  test("another model is given the effort's budget, with room left for the answer", () => {
    expect(built("deepseek-chat", { thinking: true, effort: "high" })).toEqual({
      thinking: { type: "enabled", budget_tokens: 24_000 },
      output_config: undefined,
      max_tokens: 28_096,
      temperature: undefined,
    });
    expect(
      built("claude-sonnet-4-5", { thinking: true, effort: "medium", maxTokens: 8000 }),
    ).toEqual({
      thinking: { type: "enabled", budget_tokens: 6976 },
      output_config: undefined,
      max_tokens: 8000,
      temperature: undefined,
    });
  });

  test("a cap too small to think in is sent without thinking, at the client's temperature", () => {
    expect(built("claude-sonnet-4-5", { thinking: true, effort: "low", maxTokens: 1024 })).toEqual({
      thinking: undefined,
      output_config: undefined,
      max_tokens: 1024,
      temperature: 0.7,
    });
  });

  test("reasoning turned off is thinking disabled", () => {
    expect(built("claude-sonnet-4-5", { thinkOff: true }).thinking).toEqual({ type: "disabled" });
  });

  test("a translated request that never mentioned thinking says nothing of it, to any model", () => {
    // 跟 magpie：只有直通才对别家模型补 disabled（fitAnthropicBody）。
    expect(built("glm-4.6", {}).thinking).toBeUndefined();
    expect(built("claude-sonnet-4-5", {}).thinking).toBeUndefined();
  });
});

describe("magpie's Anthropic image sources (anthropic_image_source_test.go)", () => {
  const PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  test.each([
    [
      "base64",
      { kind: "image", mediaType: "image/png", data: PNG, url: "" },
      { type: "base64", media_type: "image/png", data: PNG },
    ],
    [
      "a data URL beside its data",
      { kind: "image", mediaType: "image/png", data: PNG, url: `data:image/png;base64,${PNG}` },
      { type: "base64", media_type: "image/png", data: PNG },
    ],
    [
      "url",
      { kind: "image", mediaType: "", data: "", url: "https://example.test/screenshot.png" },
      { type: "url", url: "https://example.test/screenshot.png" },
    ],
  ] as const)(
    "%s carries only its own source fields, in the message and in a tool result",
    (_name, image, source) => {
      const built = unmarked(
        buildAnthropicRequest(
          request([
            { role: "user", parts: [{ ...image }] },
            { role: "assistant", parts: [call("A")] },
            { role: "user", parts: [{ ...result("A", ""), images: [{ ...image }] }] },
          ]),
          "claude-sonnet-4-5",
        ).messages,
      );
      expect(built[0]?.content).toEqual([{ type: "image", source }]);
      expect(built[2]?.content).toEqual([
        { type: "tool_result", tool_use_id: "A", content: [{ type: "image", source }] },
      ]);
    },
  );
});

describe("images in a Chat request asked of an Anthropic endpoint", () => {
  const PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  test("a data URL is an inline image with its media type and any other URL an image by URL", () => {
    const parsed = parseChatRequest({
      model: "m",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } },
            { type: "image_url", image_url: { url: "https://example.com/cat.jpg" } },
          ],
        },
      ],
    });
    expect(unmarked(buildAnthropicRequest(parsed, "m").messages)).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
          { type: "image", source: { type: "url", url: "https://example.com/cat.jpg" } },
        ],
      },
    ]);
  });

  test("a tool message's images go inside its tool_result beside the text", () => {
    const parsed = parseChatRequest({
      model: "m",
      messages: [
        { role: "user", content: "shoot" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "Shot", arguments: "{}" } },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: [
            { type: "text", text: "taken" },
            { type: "image_url", image_url: { url: "https://example.com/s.png" } },
          ],
        },
      ],
    });
    expect(unmarked(buildAnthropicRequest(parsed, "m").messages)[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "call_1",
          content: [
            { type: "text", text: "taken" },
            { type: "image", source: { type: "url", url: "https://example.com/s.png" } },
          ],
        },
      ],
    });
  });
});

describe("magpie's Chat file parts (attachments_test.go TestChatFilePart)", () => {
  test("a data URL, bare base64 and a file id each reach Messages as a line naming the attachment", () => {
    const parsed = parseChatRequest(
      JSON.parse(`{"model":"m","messages":[{"role":"user","content":[
		{"type":"text","text":"Transcribe every page."},
		{"type":"file","file":{"filename":"excerpt.pdf","file_data":"data:application/pdf;base64,UERG"}},
		{"type":"file","file":{"filename":"notes.pdf","file_data":"QkFSRQ=="}},
		{"type":"file","file":{"file_id":"file-abc","filename":"x.pdf"}}]}]}`),
    );
    expect(parsed.messages[0]?.parts).toEqual([
      { kind: "text", text: "Transcribe every page." },
      { kind: "file", mediaType: "application/pdf", data: "UERG", url: "" },
      { kind: "file", mediaType: "application/pdf", data: "QkFSRQ==", url: "" },
      { kind: "file", mediaType: "application/pdf", data: "", url: "file-abc" },
    ]);
    expect(unmarked(buildAnthropicRequest(parsed, "m").messages)[0]?.content).toEqual([
      { type: "text", text: "Transcribe every page." },
      { type: "text", text: "[attachment application/pdf]" },
      { type: "text", text: "[attachment application/pdf]" },
      { type: "text", text: "[attachment application/pdf: file-abc]" },
    ]);
  });
});

describe("file attachments in a Chat request asked of an Anthropic endpoint", () => {
  test("a file part becomes a line saying an attachment was there, by its type and any file id", () => {
    const parsed = parseChatRequest({
      model: "m",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "read these" },
            {
              type: "file",
              file: { filename: "a.pdf", file_data: "data:application/pdf;base64,JVBERi0x" },
            },
            { type: "file", file: { filename: "notes.txt", file_data: "aGk=" } },
            { type: "file", file: { filename: "b.pdf", file_id: "file-abc" } },
            { type: "file", file: { file_id: "file-xyz" } },
          ],
        },
      ],
    });
    expect(unmarked(buildAnthropicRequest(parsed, "m").messages)).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "read these" },
          { type: "text", text: "[attachment application/pdf]" },
          { type: "text", text: "[attachment text/plain]" },
          { type: "text", text: "[attachment application/pdf: file-abc]" },
          { type: "text", text: "[attachment application/octet-stream: file-xyz]" },
        ],
      },
    ]);
  });
});

describe("structured output across Anthropic and Chat (magpie format_test.go)", () => {
  // OpenAI SDK 为文档里的 CalendarEvent 发的 schema：strict，每个属性必填。
  const CALENDAR = {
    type: "object",
    properties: {
      name: { title: "Name", type: "string" },
      date: { title: "Date", type: "string" },
      participants: { items: { type: "string" }, title: "Participants", type: "array" },
    },
    required: ["name", "date", "participants"],
    title: "CalendarEvent",
    additionalProperties: false,
  };
  const ASK = [{ role: "user", content: "Alice and Bob are going to a science fair on Friday." }];

  test("chat.completions.parse to Messages asks for the schema in output_config.format", () => {
    const parsed = parseChatRequest({
      model: "m",
      messages: [{ role: "system", content: "Extract the event information." }, ...ASK],
      response_format: {
        type: "json_schema",
        json_schema: { schema: CALENDAR, name: "CalendarEvent", strict: true },
      },
    });
    const built = buildAnthropicRequest(parsed, "claude-sonnet-4-5");
    expect(built.output_config).toEqual({ format: { type: "json_schema", schema: CALENDAR } });
    expect(built.system).toEqual([
      {
        type: "text",
        text: "Extract the event information.",
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  test("any JSON object, which Messages can't be asked for, is said in the system prompt", () => {
    const parsed = parseChatRequest({
      model: "m",
      messages: [{ role: "user", content: "List three colors as JSON." }],
      response_format: { type: "json_object" },
    });
    const built = buildAnthropicRequest(parsed, "claude-sonnet-4-5");
    expect(built.output_config).toBeUndefined();
    expect(built.system).toEqual([
      {
        type: "text",
        text: "Respond with a single JSON object and nothing else.",
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  test("the schema goes beside the effort a Claude thinks at", () => {
    const parsed = parseAnthropicRequest({
      model: "m",
      max_tokens: 1024,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: CALENDAR } },
      messages: ASK,
    });
    expect(buildAnthropicRequest(parsed, "claude-opus-5-5").output_config).toEqual({
      effort: "high",
      format: { type: "json_schema", schema: CALENDAR },
    });
  });

  test("Anthropic's schema to a Chat upstream is a json_schema response_format named response", () => {
    const parsed = parseAnthropicRequest({
      model: "m",
      max_tokens: 1024,
      messages: ASK,
      output_config: { format: { type: "json_schema", schema: CALENDAR } },
    });
    expect(buildChatRequest(parsed, "gpt-4o-mini").response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "response", schema: CALENDAR },
    });
  });

  test("a Chat format goes on to a Chat upstream as it was, and a schema of no shape is any JSON object", () => {
    const named = parseChatRequest({
      model: "m",
      messages: ASK,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "CalendarEvent",
          description: "An event",
          schema: CALENDAR,
          strict: true,
        },
      },
    });
    expect(buildChatRequest(named, "m").response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "CalendarEvent",
        description: "An event",
        schema: CALENDAR,
        strict: true,
      },
    });
    const shapeless = parseChatRequest({
      model: "m",
      messages: ASK,
      response_format: { type: "json_schema", json_schema: { name: "x" } },
    });
    expect(buildChatRequest(shapeless, "m").response_format).toEqual({ type: "json_object" });
    const plain = parseChatRequest({
      model: "m",
      messages: ASK,
      response_format: { type: "text" },
    });
    expect(buildChatRequest(plain, "m").response_format).toBeUndefined();
  });
});

describe("earlier thinking in a Chat request asked of an Anthropic endpoint (magpie deepseek_anthropic_thinking_test.go)", () => {
  const chat = {
    model: "m",
    reasoning_effort: "high",
    tools: [
      {
        type: "function",
        function: { name: "get_time", parameters: { type: "object", properties: {} } },
      },
    ],
    messages: [
      { role: "user", content: "what time is it? twice" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "get_time", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "12:00" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_2", type: "function", function: { name: "get_time", arguments: "{}" } },
        ],
        reasoning_content: "Once more.",
      },
      { role: "tool", tool_call_id: "call_2", content: "12:01" },
    ],
  };
  const thinking = (model: string) =>
    unmarked(buildAnthropicRequest(parseChatRequest(chat), model).messages)
      .flatMap((message) => message.content)
      .filter((block) => block.type === "thinking");

  test("DeepSeek gets a call with no thinking after a block holding a space, and its own reasoning as unsigned thinking", () => {
    expect(thinking("deepseek-flash")).toEqual([
      { type: "thinking", thinking: " " },
      { type: "thinking", thinking: "Once more." },
    ]);
  });

  test("another model is sent no unsigned thinking", () => {
    expect(thinking("glm-5.2")).toEqual([]);
  });

  test("Claude's signed thinking goes back to Anthropic as it came", () => {
    const parsed = parseAnthropicRequest({
      model: "m",
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Greeting.", signature: "c2ln" },
            { type: "text", text: "Hello" },
          ],
        },
        { role: "user", content: "again" },
      ],
    });
    expect(unmarked(buildAnthropicRequest(parsed, "claude-sonnet-4-5").messages)[1]).toEqual({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Greeting.", signature: "c2ln" },
        { type: "text", text: "Hello" },
      ],
    });
  });
});

describe("magpie's chat-to-anthropic upstream body (testdata/upstream_bodies)", () => {
  test("a Chat request with an image, a tool exchange and an effort reaches Messages as magpie builds it", () => {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const parsed = parseChatRequest(
      JSON.parse(`{"model":"fake/m1","messages":[{"role":"system","content":"be brief"},{"role":"user","content":[{"type":"text","text":"look"},{"type":"image_url","image_url":{"url":"data:image/png;base64,${png}"}}]},
 {"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"Read","arguments":"{\\"path\\":\\"/x\\"}"}}]},
 {"role":"tool","tool_call_id":"call_1","content":"file \\"body\\"\\n"},{"role":"user","content":"go on é"}],
 "tools":[{"type":"function","function":{"name":"Read","description":"Reads","parameters":{"type":"object","properties":{"path":{"type":"string"}}}}}],
 "tool_choice":"auto","reasoning_effort":"high","temperature":1,"stop":["\\n\\n"],"stream":false,"user":"u"}`),
    );
    const built = buildAnthropicRequest({ ...parsed, stream: true }, "m1");
    // magpie 逐字节比对（Go 的键按字母序）；这里按值比对。
    expect(built).toEqual(
      JSON.parse(
        `{"max_tokens":28096,"messages":[{"role":"user","content":[{"type":"text","text":"look"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"${png}"}}]},{"role":"assistant","content":[{"type":"tool_use","id":"call_1","name":"Read","input":{"path":"/x"}}]},{"role":"user","content":[{"type":"tool_result","tool_use_id":"call_1","content":"file \\"body\\"\\n"},{"type":"text","text":"go on é","cache_control":{"type":"ephemeral"}}]}],"model":"m1","stop_sequences":["\\n\\n"],"stream":true,"system":[{"type":"text","text":"be brief","cache_control":{"type":"ephemeral"}}],"thinking":{"budget_tokens":24000,"type":"enabled"},"tools":[{"description":"Reads","input_schema":{"type":"object","properties":{"path":{"type":"string"}}},"name":"Read"}]}`,
      ),
    );
  });
});
