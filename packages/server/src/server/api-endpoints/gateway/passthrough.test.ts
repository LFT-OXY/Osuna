import { describe, expect, test } from "vitest";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { fitAnthropicBody, fitResponsesBody, fitThinkingOff } from "./passthrough.js";
import { ReplyTap, type TappedReply } from "./reply-tap.js";
import { sseEvent } from "./translation/sse.js";

/*
 * 直通给 Anthropic 地址的请求体，按这家的模型改的几处；其余字节原样。
 * DeepSeek 的例子照 magpie（MIT，THIRD_PARTY_NOTICES）的 deepseek_anthropic_thinking_test.go。
 */

describe("a Claude Code request passed through to another vendor's model", () => {
  test("a Claude model gets the body byte for byte", () => {
    const body = `{"model":"claude-sonnet-4-5", "thinking":{"type":"adaptive"},"output_config":{"effort":"high"},"messages":[]}`;
    expect(fitAnthropicBody(body, "claude-sonnet-4-5")).toBe(body);
  });

  test("Claude's adaptive thinking and effort are taken out, the rest left as it was", () => {
    const body = `{"model":"glm-4.6", "max_tokens" : 32000,"thinking":{"type":"adaptive"},"output_config":{"effort":"high"},"messages":[{"role":"user","content":"hi"}]}`;
    expect(fitAnthropicBody(body, "glm-4.6")).toBe(
      `{"model":"glm-4.6", "max_tokens" : 32000,"messages":[{"role":"user","content":"hi"}]}`,
    );
  });

  test("the effort goes and a structured output format beside it stays", () => {
    const body = `{"model":"kimi-k2","thinking":{"type":"adaptive"},"output_config":{"effort":"low","format":{"type":"json_schema","schema":{"type":"object"}}},"messages":[]}`;
    expect(JSON.parse(fitAnthropicBody(body, "kimi-k2"))).toEqual({
      model: "kimi-k2",
      output_config: { format: { type: "json_schema", schema: { type: "object" } } },
      messages: [],
    });
  });

  test("a request that doesn't mention thinking is told thinking is off", () => {
    const body = `{"model":"kimi-k2","max_tokens":512,"messages":[{"role":"user","content":"Title this"}]}`;
    expect(JSON.parse(fitAnthropicBody(body, "kimi-k2"))).toEqual({
      model: "kimi-k2",
      max_tokens: 512,
      messages: [{ role: "user", content: "Title this" }],
      thinking: { type: "disabled" },
    });
  });

  test("thinking with a budget, or turned off, goes as the agent sent it", () => {
    const enabled = `{"model":"kimi-k2","thinking":{"type":"enabled","budget_tokens":4096},"messages":[]}`;
    const disabled = `{"model":"kimi-k2","thinking":{"type":"disabled"},"messages":[]}`;
    expect(fitAnthropicBody(enabled, "kimi-k2")).toBe(enabled);
    expect(fitAnthropicBody(disabled, "kimi-k2")).toBe(disabled);
  });
});

describe("a Claude Code request turning thinking off, passed through to a Claude", () => {
  test("Sonnet 5.5 gets between_tools, the rest byte for byte", () => {
    const body = `{"model":"claude-sonnet-5-5", "max_tokens" : 64,"thinking":{"type":"disabled"},"system":[{"type":"text","text":"sys","cache_control":{"type":"ephemeral"}}],"messages":[]}`;
    expect(fitThinkingOff({ text: body, model: "claude-sonnet-5-5", leftOn: false })).toBe(
      `{"model":"claude-sonnet-5-5", "max_tokens" : 64,"thinking":{"type":"between_tools"},"system":[{"type":"text","text":"sys","cache_control":{"type":"ephemeral"}}],"messages":[]}`,
    );
  });

  test("Opus 5.5 gets no thinking, effort low and room to think", () => {
    const body = `{"model":"claude-opus-5-5","max_tokens":64,"thinking":{"type":"disabled"},"messages":[]}`;
    expect(
      JSON.parse(fitThinkingOff({ text: body, model: "claude-opus-5-5", leftOn: false })),
    ).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 2112,
      messages: [],
      output_config: { effort: "low" },
    });
  });

  test("a request that thinks, or a Claude that takes disabled, goes byte for byte", () => {
    const thinking = `{"model":"claude-sonnet-5-5", "thinking":{"type":"adaptive"},"output_config":{"effort":"high"},"messages":[]}`;
    const untold = `{"model":"claude-opus-5-5","max_tokens":64,"messages":[]}`;
    const older = `{"model":"claude-opus-4-8", "thinking":{"type":"disabled"},"messages":[]}`;
    expect(fitThinkingOff({ text: thinking, model: "claude-sonnet-5-5", leftOn: false })).toBe(
      thinking,
    );
    expect(fitThinkingOff({ text: untold, model: "claude-opus-5-5", leftOn: false })).toBe(untold);
    expect(fitThinkingOff({ text: older, model: "claude-opus-4-8", leftOn: false })).toBe(older);
  });

  test("a model the endpoint said cannot stop thinking is left to think, a Claude at its lowest", () => {
    const glm = `{"model":"glm-5.3","max_tokens":8000,"thinking":{"type":"disabled"},"messages":[]}`;
    const claude = `{"model":"claude-opus-6","max_tokens":8000,"thinking":{"type":"disabled"},"messages":[]}`;
    expect(fitThinkingOff({ text: glm, model: "glm-5.3", leftOn: true })).toBe(
      `{"model":"glm-5.3","max_tokens":8000,"messages":[]}`,
    );
    expect(
      JSON.parse(fitThinkingOff({ text: claude, model: "claude-opus-6", leftOn: true })),
    ).toEqual({
      model: "claude-opus-6",
      max_tokens: 8000,
      messages: [],
      output_config: { effort: "low" },
    });
  });
});

describe("a Claude Code conversation passed through to DeepSeek's Anthropic endpoint", () => {
  // Claude 先答过的对话：一次调用前是封存的思考，一次前是签名的思考，一步没有思考，最后的回答也没有。
  const conversation = (
    model: string,
  ) => `{"model":"${model}","max_tokens":32000,"stream":false,"thinking":{"type":"enabled","budget_tokens":4096},
	"tools":[{"name":"Bash","input_schema":{"type":"object","properties":{"command":{"type":"string"}}}}],
	"messages":[
	{"role":"user","content":"fix the login bug"},
	{"role":"assistant","content":[{"type":"redacted_thinking","data":"EmwKAhgBEgy3va3pzix"},{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls"}}]},
	{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"main.go"}]},
	{"role":"assistant","content":[{"type":"thinking","thinking":"Read main.go.","signature":"EqQBCkgIBxABGAIiQL"},{"type":"tool_use","id":"toolu_2","name":"Bash","input":{"command":"cat main.go"}}]},
	{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_2","content":"package main"}]},
	{"role":"assistant","content":[{"type":"text","text":"Checking the test."},{"type":"tool_use","id":"toolu_3","name":"Bash","input":{"command":"go test"}}]},
	{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_3","content":"ok"}]},
	{"role":"assistant","content":[{"type":"redacted_thinking","data":"EmwKAhgBEgy3va3pzix"},{"type":"thinking","thinking":"Fine.","signature":"EqQBCkgIBxAB"},{"type":"text","text":"It passes."}]},
	{"role":"user","content":"thanks, now commit"}]}`;

  test("each tool turn goes with a thinking block, Claude's sealed thinking as a space; the rest as it came", () => {
    const sent = JSON.parse(fitAnthropicBody(conversation("deepseek-flash"), "deepseek-flash")) as {
      messages: unknown[];
    };
    const original = JSON.parse(conversation("deepseek-flash")) as { messages: unknown[] };
    const space = { type: "thinking", thinking: " " };
    expect(sent.messages).toEqual([
      original.messages[0],
      {
        role: "assistant",
        content: [
          space,
          { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
        ],
      },
      original.messages[2],
      original.messages[3],
      original.messages[4],
      {
        role: "assistant",
        content: [
          space,
          { type: "text", text: "Checking the test." },
          { type: "tool_use", id: "toolu_3", name: "Bash", input: { command: "go test" } },
        ],
      },
      original.messages[6],
      {
        role: "assistant",
        content: [
          space,
          { type: "thinking", thinking: "Fine.", signature: "EqQBCkgIBxAB" },
          { type: "text", text: "It passes." },
        ],
      },
      original.messages[8],
    ]);
  });

  test("another vendor's model is sent the conversation as it came", () => {
    expect(fitAnthropicBody(conversation("glm-5.2"), "glm-5.2")).toBe(conversation("glm-5.2"));
  });
});

describe("a Codex request passed through to a DeepSeek model's Responses endpoint (magpie reasoning_passthrough_test.go)", () => {
  const codex = (reasoning: string) =>
    `{"model":"deepseek-v4.1-flash", "stream":true,"store":false,"reasoning":{"effort":"max","summary":"auto"},"input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"fix the login bug"}]},${reasoning},{"type":"function_call","call_id":"call_1","name":"shell","arguments":"{\\"command\\":[\\"ls\\"]}"},{"type":"function_call_output","call_id":"call_1","output":"main.go"}]}`;
  const reasoningText = (body: string) =>
    (JSON.parse(body) as { input: { type: string; content?: { text: string }[] }[] }).input.find(
      (item) => item.type === "reasoning",
    )?.content?.[0]?.text;

  test("a reasoning item with only a summary gets the summary as its text, the rest of the body as it was", () => {
    const fitted = fitResponsesBody(
      codex(
        `{"type":"reasoning","id":"rs_1","summary":[{"type":"summary_text","text":"Looking at main.go"}],"content":null,"encrypted_content":null}`,
      ),
      "deepseek-v4.1-flash",
    );
    expect(reasoningText(fitted)).toBe("Looking at main.go");
    expect(fitted.startsWith(`{"model":"deepseek-v4.1-flash", "stream":true,`)).toBe(true);
  });

  test("an empty reasoning item gets a space, and its own reasoning text goes back as it was", () => {
    expect(
      reasoningText(
        fitResponsesBody(
          codex(
            `{"type":"reasoning","id":"rs_2","summary":[],"content":null,"encrypted_content":null}`,
          ),
          "deepseek-v4.1-flash",
        ),
      ),
    ).toBe(" ");
    const own = codex(
      `{"type":"reasoning","id":"rs_3","summary":[],"content":[{"type":"reasoning_text","text":"I should list the files first."}],"encrypted_content":null}`,
    );
    expect(fitResponsesBody(own, "deepseek-v4.1-flash")).toBe(own);
  });

  test("only the reasoning item's content changes when nothing has to move; a step that has to lead with reasoning is reordered", () => {
    const filled = fitResponsesBody(
      codex(`{"type":"reasoning","id":"rs_2", "summary":[],"content":null}`),
      "deepseek-v4.1-flash",
    );
    expect(filled).toContain(`"id":"rs_2", "summary":[],"content":[`);
    const bare = `{"model":"deepseek-v4.1-flash","input":[{"type":"message","role":"user","content":"ls"},{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Looking."}]},{"type":"reasoning","summary":[],"content":[{"type":"reasoning_text","text":"Need ls."}]},{"type":"function_call","call_id":"c1","name":"sh","arguments":"{}"},{"type":"function_call_output","call_id":"c1","output":"ok"}]}`;
    const order = (
      JSON.parse(fitResponsesBody(bare, "deepseek-v4.1-flash")) as {
        input: { type: string; role?: string }[];
      }
    ).input.map((item) => item.role ?? item.type);
    expect(order).toEqual([
      "user",
      "reasoning",
      "assistant",
      "function_call",
      "function_call_output",
    ]);
  });

  test("another vendor's model is sent the request as it came", () => {
    const body = codex(`{"type":"reasoning","id":"rs_2","summary":[],"encrypted_content":"ZW5j"}`);
    expect(fitResponsesBody(body, "gpt-5.4")).toBe(body);
  });
});

/*
 * 直通回复边转边读：喂给读取器的是上游原样的字节，按段到达；段的边界可以落在事件、数字或一个汉字中间。
 */

/** 按字节位置切成几段。 */
function cutAt(text: string, offsets: number[]): Buffer[] {
  const bytes = Buffer.from(text);
  return [0, ...offsets].map((start, index) => bytes.subarray(start, offsets[index]));
}

/** `piece` 在 `text` 里第一次出现处再往后 `into` 个字节：切在数字或汉字中间用。 */
function inside(text: string, piece: string, into: number): number {
  return Buffer.from(text).indexOf(piece) + into;
}

function tapped(input: {
  format: ApiEndpointRequestFormat;
  stream: boolean;
  chunks: Buffer[];
}): TappedReply {
  const tap = new ReplyTap({ format: input.format, stream: input.stream });
  for (const chunk of input.chunks) tap.feed(chunk);
  return tap.end();
}

const NO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cacheWrite1h: 0,
  reasoning: 0,
};

describe("reading an Anthropic stream passed through", () => {
  test("thinking, text and a tool call, the stop reason, the end and the cache, read across cut chunks", () => {
    const stream = [
      sseEvent("message_start", {
        type: "message_start",
        message: {
          id: "msg_1",
          usage: {
            input_tokens: 12,
            cache_read_input_tokens: 2048,
            cache_creation_input_tokens: 300,
            cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
          },
        },
      }),
      sseEvent("ping", { type: "ping" }),
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      }),
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "先读文件" },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" },
      }),
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "你好" },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 1 }),
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 2,
        content_block: { type: "tool_use", id: "toolu_1", name: "Read", input: {} },
      }),
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: 2,
        delta: { type: "input_json_delta", partial_json: '{"path":"a.ts"}' },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index: 2 }),
      sseEvent("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 42 },
      }),
      sseEvent("message_stop", { type: "message_stop" }),
    ].join("");

    const reply = tapped({
      format: "anthropic_messages",
      stream: true,
      chunks: cutAt(stream, [
        inside(stream, "2048", 2),
        inside(stream, "你好", 1),
        inside(stream, '"tool_use"},', 4),
      ]),
    });

    expect(reply).toEqual({
      content: ["thinking", "text", "tool_call"],
      stop: "tool",
      ended: true,
      error: null,
      usage: {
        input: 12,
        output: 42,
        cacheRead: 2048,
        cacheWrite: 300,
        cacheWrite1h: 200,
        reasoning: 0,
      },
    });
  });

  test("a refusal before any content, an error event, and a stream that stops short; a ping is no content", () => {
    const opening =
      sseEvent("message_start", {
        type: "message_start",
        message: { id: "msg_2", usage: { input_tokens: 5 } },
      }) + sseEvent("ping", { type: "ping" });
    const read = (rest: string) =>
      tapped({ format: "anthropic_messages", stream: true, chunks: [Buffer.from(opening + rest)] });
    const usage = {
      input: 5,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cacheWrite1h: 0,
      reasoning: 0,
    };

    expect(
      read(
        sseEvent("message_delta", {
          type: "message_delta",
          delta: { stop_reason: "refusal" },
          usage: { output_tokens: 0 },
        }) + sseEvent("message_stop", { type: "message_stop" }),
      ),
    ).toEqual({ content: [], stop: "filter", ended: true, error: null, usage });
    expect(
      read(
        sseEvent("error", {
          type: "error",
          error: { type: "overloaded_error", message: "Overloaded" },
        }),
      ),
    ).toEqual({
      content: [],
      stop: null,
      ended: false,
      error: {
        message: "Overloaded",
        code: "overloaded_error",
        raw: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      },
      usage,
    });
    expect(
      read(
        sseEvent("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Half an ans" },
        }),
      ),
    ).toEqual({ content: ["text"], stop: null, ended: false, error: null, usage });
    expect(read("")).toEqual({ content: [], stop: null, ended: false, error: null, usage });
  });
});

describe("what counts as said in an Anthropic stream (magpie fallback.go streamPart.said)", () => {
  const read = (...events: string[]) =>
    tapped({ format: "anthropic_messages", stream: true, chunks: [Buffer.from(events.join(""))] });

  test("a thinking block with only its signature says nothing", () => {
    expect(
      read(
        sseEvent("content_block_start", {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        }),
        sseEvent("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "EqQBCkgIBxAB" },
        }),
        sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
      ),
    ).toEqual({ content: [], stop: null, ended: false, error: null, usage: NO_USAGE });
  });

  test("a server tool's call is a tool call", () => {
    expect(
      read(
        sseEvent("content_block_start", {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "server_tool_use",
            id: "srvtoolu_1",
            name: "web_search",
            input: {},
          },
        }),
      ),
    ).toEqual({ content: ["tool_call"], stop: null, ended: false, error: null, usage: NO_USAGE });
  });
});

describe("reading a Chat stream passed through", () => {
  const chunk = (data: Record<string, unknown>) => sseEvent(null, data);

  test("reasoning, text and a tool call, the stop reason, [DONE] and the cache, read across cut chunks", () => {
    const stream = [
      chunk({
        id: "chatcmpl-1",
        choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "先看看" } }],
      }),
      chunk({ id: "chatcmpl-1", choices: [{ index: 0, delta: { content: "好的" } }] }),
      chunk({
        id: "chatcmpl-1",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "read", arguments: '{"path":"a.ts"}' },
                },
              ],
            },
          },
        ],
      }),
      chunk({ id: "chatcmpl-1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
      chunk({
        id: "chatcmpl-1",
        choices: [],
        usage: {
          prompt_tokens: 3000,
          completion_tokens: 40,
          prompt_tokens_details: { cached_tokens: 2048, cache_write_tokens: 500 },
        },
      }),
      sseEvent(null, "[DONE]"),
    ].join("");

    const reply = tapped({
      format: "openai_chat",
      stream: true,
      chunks: cutAt(stream, [
        inside(stream, "好的", 2),
        inside(stream, "2048", 1),
        inside(stream, "[DONE]", 3),
      ]),
    });

    expect(reply).toEqual({
      content: ["thinking", "text", "tool_call"],
      stop: "tool",
      ended: true,
      error: null,
      usage: {
        input: 452,
        output: 40,
        cacheRead: 2048,
        cacheWrite: 500,
        cacheWrite1h: 0,
        reasoning: 0,
      },
    });
  });

  test("a content filter stop, an error chunk, and a stream without [DONE]", () => {
    const read = (...chunks: Record<string, unknown>[]) =>
      tapped({
        format: "openai_chat",
        stream: true,
        chunks: [Buffer.from(chunks.map(chunk).join(""))],
      });

    expect(
      read({
        id: "chatcmpl-2",
        choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }],
      }),
    ).toEqual({ content: [], stop: "filter", ended: false, error: null, usage: NO_USAGE });
    expect(read({ error: { message: "upstream overloaded" } })).toEqual({
      content: [],
      stop: null,
      ended: false,
      error: {
        message: "upstream overloaded",
        code: null,
        raw: '{"error":{"message":"upstream overloaded"}}',
      },
      usage: NO_USAGE,
    });
    expect(read({ id: "chatcmpl-3", choices: [{ index: 0, delta: { content: "Half" } }] })).toEqual(
      { content: ["text"], stop: null, ended: false, error: null, usage: NO_USAGE },
    );
  });
});

describe("reading a Responses stream passed through", () => {
  const event = (type: string, data: Record<string, unknown>) => sseEvent(type, { type, ...data });
  const created = event("response.created", {
    response: { id: "resp_1", status: "in_progress", output: [] },
  });
  const read = (...events: string[]) =>
    tapped({
      format: "openai_responses",
      stream: true,
      chunks: [Buffer.from(created + events.join(""))],
    });

  test("reasoning, text and a call, the stop reason, the completed response and the cache, read across cut chunks", () => {
    const call = { id: "fc_1", type: "function_call", call_id: "call_1", name: "shell" };
    const stream = [
      created,
      event("response.in_progress", { response: { id: "resp_1", status: "in_progress" } }),
      event("response.output_item.added", {
        output_index: 0,
        item: { id: "rs_1", type: "reasoning", summary: [] },
      }),
      event("response.reasoning_summary_text.delta", { item_id: "rs_1", delta: "**看一下文件**" }),
      event("response.output_item.added", {
        output_index: 1,
        item: { id: "msg_1", type: "message", role: "assistant", content: [] },
      }),
      event("response.output_text.delta", { item_id: "msg_1", delta: "好的" }),
      event("response.output_item.added", { output_index: 2, item: { ...call, arguments: "" } }),
      event("response.function_call_arguments.delta", { item_id: "fc_1", delta: '{"cmd":"ls"}' }),
      event("response.output_item.done", {
        output_index: 2,
        item: { ...call, arguments: '{"cmd":"ls"}' },
      }),
      event("response.completed", {
        response: {
          id: "resp_1",
          status: "completed",
          output: [],
          usage: {
            input_tokens: 3000,
            output_tokens: 40,
            input_tokens_details: { cached_tokens: 2048, cache_write_tokens: 500 },
            output_tokens_details: { reasoning_tokens: 12 },
          },
        },
      }),
    ].join("");

    const reply = tapped({
      format: "openai_responses",
      stream: true,
      chunks: cutAt(stream, [
        inside(stream, "response.created", 5),
        inside(stream, "好的", 4),
        inside(stream, "2048", 3),
      ]),
    });

    expect(reply).toEqual({
      content: ["thinking", "text", "tool_call"],
      stop: "tool",
      ended: true,
      error: null,
      usage: {
        input: 452,
        output: 40,
        cacheRead: 2048,
        cacheWrite: 500,
        cacheWrite1h: 0,
        reasoning: 12,
      },
    });
  });

  test("a reply cut short by the content filter, a failed response, and one that only began", () => {
    expect(
      read(
        event("response.incomplete", {
          response: { status: "incomplete", incomplete_details: { reason: "content_filter" } },
        }),
      ),
    ).toEqual({ content: [], stop: "filter", ended: true, error: null, usage: NO_USAGE });
    expect(
      read(
        event("response.failed", {
          response: { status: "failed", error: { code: "server_error", message: "overloaded" } },
        }),
      ),
    ).toEqual({
      content: [],
      stop: null,
      ended: false,
      error: {
        message: "overloaded",
        code: "server_error",
        raw: '{"type":"response.failed","response":{"status":"failed","error":{"code":"server_error","message":"overloaded"}}}',
      },
      usage: NO_USAGE,
    });
    expect(read()).toEqual({ content: [], stop: null, ended: false, error: null, usage: NO_USAGE });
  });

  test("Codex's own call (apply_patch) is a tool call it stops for; a server tool's call is a tool call", () => {
    const patch = {
      id: "ctc_1",
      type: "custom_tool_call",
      call_id: "call_2",
      name: "apply_patch",
      input: "*** Begin Patch",
    };
    expect(
      read(
        event("response.output_item.added", { output_index: 0, item: { ...patch, input: "" } }),
        event("response.custom_tool_call_input.delta", {
          item_id: "ctc_1",
          delta: "*** Begin Patch",
        }),
        event("response.output_item.done", { output_index: 0, item: patch }),
        event("response.completed", {
          response: { id: "resp_1", status: "completed", output: [] },
        }),
      ),
    ).toEqual({ content: ["tool_call"], stop: "tool", ended: true, error: null, usage: NO_USAGE });
    expect(
      read(
        event("response.output_item.added", {
          output_index: 0,
          item: { id: "ws_1", type: "web_search_call", status: "in_progress" },
        }),
      ),
    ).toEqual({ content: ["tool_call"], stop: null, ended: false, error: null, usage: NO_USAGE });
  });
});

describe("reading a reply passed through whole", () => {
  // 切在正中间：整份回复要攒齐了才读。
  const whole = (format: ApiEndpointRequestFormat, body: unknown) => {
    const text = JSON.stringify(body);
    return tapped({ format, stream: false, chunks: cutAt(text, [Buffer.byteLength(text) >> 1]) });
  };

  test("it is read as its stream would be, in each format", () => {
    expect(
      whole("anthropic_messages", {
        id: "msg_9",
        type: "message",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "先读文件", signature: "EqQB" },
          { type: "text", text: "好的" },
          { type: "tool_use", id: "toolu_9", name: "Read", input: { path: "a.ts" } },
        ],
        stop_reason: "tool_use",
        usage: {
          input_tokens: 12,
          output_tokens: 3,
          cache_read_input_tokens: 2048,
          cache_creation_input_tokens: 300,
        },
      }),
    ).toEqual({
      content: ["thinking", "text", "tool_call"],
      stop: "tool",
      ended: true,
      error: null,
      usage: {
        input: 12,
        output: 3,
        cacheRead: 2048,
        cacheWrite: 300,
        cacheWrite1h: 0,
        reasoning: 0,
      },
    });
    expect(
      whole("openai_responses", {
        id: "resp_9",
        object: "response",
        status: "completed",
        output: [
          {
            id: "rs_9",
            type: "reasoning",
            summary: [{ type: "summary_text", text: "**看一下**" }],
          },
          {
            id: "msg_9",
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "好的" }],
          },
          {
            id: "ctc_9",
            type: "custom_tool_call",
            call_id: "call_9",
            name: "apply_patch",
            input: "*** Begin Patch",
          },
        ],
        usage: {
          input_tokens: 3000,
          output_tokens: 40,
          input_tokens_details: { cached_tokens: 2048 },
        },
      }),
    ).toEqual({
      content: ["thinking", "text", "tool_call"],
      stop: "tool",
      ended: true,
      error: null,
      usage: {
        input: 952,
        output: 40,
        cacheRead: 2048,
        cacheWrite: 0,
        cacheWrite1h: 0,
        reasoning: 0,
      },
    });
    // DeepSeek 的缓存命中字段。
    expect(
      whole("openai_chat", {
        id: "chatcmpl-9",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              reasoning_content: "先看看",
              content: "好的",
              tool_calls: [
                { id: "call_9", type: "function", function: { name: "read", arguments: "{}" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 3000, completion_tokens: 40, prompt_cache_hit_tokens: 2048 },
      }),
    ).toEqual({
      content: ["thinking", "text", "tool_call"],
      stop: "tool",
      ended: true,
      error: null,
      usage: {
        input: 952,
        output: 40,
        cacheRead: 2048,
        cacheWrite: 0,
        cacheWrite1h: 0,
        reasoning: 0,
      },
    });
  });

  test("a refusal and an error that came whole", () => {
    expect(
      whole("anthropic_messages", {
        id: "msg_10",
        type: "message",
        role: "assistant",
        content: [],
        stop_reason: "refusal",
        usage: { input_tokens: 5, output_tokens: 0 },
      }),
    ).toEqual({
      content: [],
      stop: "filter",
      ended: true,
      error: null,
      usage: { ...NO_USAGE, input: 5 },
    });
    expect(
      whole("anthropic_messages", {
        type: "error",
        error: { type: "overloaded_error", message: "Overloaded" },
      }),
    ).toEqual({
      content: [],
      stop: null,
      ended: false,
      error: {
        message: "Overloaded",
        code: "overloaded_error",
        raw: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      },
      usage: NO_USAGE,
    });
    expect(
      whole("openai_responses", {
        error: { message: "quota exhausted", code: "insufficient_quota" },
      }),
    ).toEqual({
      content: [],
      stop: null,
      ended: false,
      error: {
        message: "quota exhausted",
        code: "insufficient_quota",
        raw: '{"error":{"message":"quota exhausted","code":"insufficient_quota"}}',
      },
      usage: NO_USAGE,
    });
  });

  test("a body that is not JSON, or bigger than 8 MB (magpie sniff.go), is not read", () => {
    const unread = { content: [], stop: null, ended: false, error: null, usage: NO_USAGE };
    expect(
      tapped({
        format: "anthropic_messages",
        stream: false,
        chunks: [Buffer.from("<html><title>Just a moment...</title></html>")],
      }),
    ).toEqual(unread);
    expect(
      whole("anthropic_messages", {
        id: "msg_11",
        type: "message",
        content: [{ type: "text", text: "x".repeat(8 * 1024 * 1024) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, cache_read_input_tokens: 2048 },
      }),
    ).toEqual(unread);
  });
});
