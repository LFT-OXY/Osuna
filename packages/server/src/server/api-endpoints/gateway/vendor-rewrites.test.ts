// 用例照 magpie（MIT，THIRD_PARTY_NOTICES）的 kimi_schema_test.go、deepseek_schema_test.go、grok_schema_test.go、
// kimi_reasoning_details_test.go、minimax_think_test.go。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { isRecord } from "../upstream-http.js";
import type { ShapeRefusals } from "./refusals.js";
import { translatedBody } from "./translated.js";
import { parseAnthropicRequest } from "./translation/anthropic.js";
import { withVendorRewrites } from "./vendor-rewrites.js";

/*
 * 翻译的请求按厂商改：Kimi、MiniMax、DeepSeek 只认官方地址，Grok 按模型名认；别的地址、别家的模型，翻出的请求体照旧。
 */

const RELAY_URL = "https://relay.example/v1";

const NO_REFUSALS: ShapeRefusals = { has: () => false, add: () => {} };

// Claude Code 的一轮：上一轮带着思考；工具 schema 里有没写 type 的 enum、`\0`、字符类里的 `[`。
const claudeCodeTurn = parseAnthropicRequest({
  model: "m",
  max_tokens: 1000,
  stream: true,
  tools: [
    {
      name: "find",
      description: "d",
      input_schema: {
        type: "object",
        properties: {
          kind: { enum: ["a", "b"] },
          q: { type: "string", pattern: "^[^\\0]*$" },
          selector: { type: "string", pattern: "^[^\\s[\\]]+$" },
        },
      },
    },
  ],
  messages: [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "\nThe user greets me.\n", signature: "sig" },
        { type: "text", text: "Hello!" },
      ],
    },
    { role: "user", content: "again" },
  ],
});

/** claudeCodeTurn 翻成 `to` 发给 `baseUrl` 上的 `model`。 */
function translated(input: {
  to: ApiEndpointRequestFormat;
  baseUrl: string;
  model: string;
}): Record<string, unknown> {
  const text = translatedBody({
    ...input,
    request: claudeCodeTurn,
    from: "anthropic_messages",
    facts: {},
    refusals: NO_REFUSALS,
    continuation: null,
  });
  const body: unknown = JSON.parse(text);
  if (!isRecord(body)) throw new Error(`not a JSON object: ${text}`);
  return body;
}

/** 翻成 Chat 的工具，参数的 properties 换成 `changed` 里给的。 */
function chatTools(changed: Record<string, unknown>) {
  const properties = {
    kind: { enum: ["a", "b"] },
    q: { type: "string", pattern: "^[^\\0]*$" },
    selector: { type: "string", pattern: "^[^\\s[\\]]+$" },
    ...changed,
  };
  const parameters = { type: "object", properties };
  return [{ type: "function", function: { name: "find", description: "d", parameters } }];
}

/** 翻成 Chat 的整个请求体，messages 与 tools 由调用方给。 */
function chatBody(input: { model: string; assistant: string; tools: unknown[] }) {
  return {
    model: input.model,
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: input.assistant },
      { role: "user", content: "again" },
    ],
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 1000,
    tools: input.tools,
  };
}

describe("vendor rewrites of a translated request", () => {
  test("Kimi's own address: an untyped enum gets its values' type", () => {
    const body = translated({
      to: "openai_chat",
      baseUrl: "https://api.moonshot.ai/v1",
      model: "kimi-k2.6",
    });
    expect(body).toEqual(
      chatBody({
        model: "kimi-k2.6",
        assistant: "Hello!",
        tools: chatTools({ kind: { type: "string", enum: ["a", "b"] } }),
      }),
    );
  });

  test.each(["https://api.minimax.io/v1", "https://api.minimaxi.com/v1"])(
    "MiniMax at %s gets the thinking back in <think> at the head of the text",
    (baseUrl) => {
      expect(translated({ to: "openai_chat", baseUrl, model: "MiniMax-M2.7" })).toEqual(
        chatBody({
          model: "MiniMax-M2.7",
          assistant: "<think>\nThe user greets me.\n</think>\n\nHello!",
          tools: chatTools({}),
        }),
      );
    },
  );

  test("MiniMax's thinking goes in <think> only on Chat: its Anthropic address gets the thinking block as before", () => {
    const body = { to: "anthropic_messages", model: "MiniMax-M2.7" } as const;
    expect(translated({ ...body, baseUrl: "https://api.minimax.io/anthropic" })).toEqual(
      translated({ ...body, baseUrl: RELAY_URL }),
    );
  });

  test("DeepSeek's own address: `\\0` in a pattern becomes `\\u0000`", () => {
    const body = translated({
      to: "openai_chat",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-v4",
    });
    expect(body.tools).toEqual(chatTools({ q: { type: "string", pattern: "^[^\\u0000]*$" } }));
  });

  test.each(["openai_chat", "openai_responses", "anthropic_messages"] as const)(
    "Grok through a relay, translated to %s: a `[` in a character class is escaped",
    (to) => {
      const grok = translated({ to, baseUrl: RELAY_URL, model: "xai/grok-4.7" });
      const other = translated({ to, baseUrl: RELAY_URL, model: "gpt-5.5" });
      const escaped = JSON.stringify(other)
        .replaceAll(`"gpt-5.5"`, `"xai/grok-4.7"`)
        .replace(`"^[^\\\\s[\\\\]]+$"`, `"^[^\\\\s\\\\[\\\\]]+$"`);
      expect(grok).toEqual(JSON.parse(escaped));
    },
  );

  test.each([
    ["kimi-k2.6", RELAY_URL],
    ["MiniMax-M2.7", "https://openrouter.ai/api/v1"],
    ["mistral-large", "https://api.mistral.ai/v1"],
  ])("%s at %s gets the request translated as before", (model, baseUrl) => {
    expect(translated({ to: "openai_chat", baseUrl, model })).toEqual(
      chatBody({ model, assistant: "Hello!", tools: chatTools({}) }),
    );
  });

  test("DeepSeek through a relay keeps its `\\0` (its thinking is replayed by model name, as before)", () => {
    const body = translated({ to: "openai_chat", baseUrl: RELAY_URL, model: "deepseek-v4" });
    expect(body.tools).toEqual(chatTools({}));
  });
});

describe("Kimi and a Chat message's reasoning_details (magpie #1765)", () => {
  const messages = [
    { role: "user", content: "Is 91 prime?" },
    {
      role: "assistant",
      content: "91 = 7 x 13.",
      reasoning_details: [
        {
          type: "reasoning.text",
          text: "Check divisibility by 7: 7*13=91.",
          format: "unknown",
          index: 0,
        },
      ],
    },
    { role: "user", content: "And 93?" },
    {
      role: "assistant",
      content: "93 = 3 x 31.",
      reasoning_content: "Digits sum to 12.",
      reasoning_details: [
        { type: "reasoning.text", text: "Digits sum to 12.", format: "unknown", index: 0 },
      ],
    },
  ];
  const rewritten = (baseUrl: string) =>
    withVendorRewrites({
      format: "openai_chat",
      baseUrl,
      model: "k3",
      body: { model: "k3", messages },
    });

  test("go to Kimi as reasoning_content; a turn's own reasoning_content is kept", () => {
    expect(rewritten("https://api.kimi.com/coding/v1")).toEqual({
      model: "k3",
      messages: [
        messages[0],
        {
          role: "assistant",
          content: "91 = 7 x 13.",
          reasoning_content: "Check divisibility by 7: 7*13=91.",
        },
        messages[2],
        { role: "assistant", content: "93 = 3 x 31.", reasoning_content: "Digits sum to 12." },
      ],
    });
  });

  test("go to a relay as they came", () => {
    const body = { model: "k3", messages };
    expect(
      withVendorRewrites({ format: "openai_chat", baseUrl: RELAY_URL, model: "k3", body }),
    ).toBe(body);
  });
});

describe("tool schemas rewritten for Kimi, DeepSeek and Grok", () => {
  const anthropicTool = (schema: Record<string, unknown>) => ({
    format: "anthropic_messages" as const,
    model: "m",
    body: { tools: [{ name: "x", input_schema: schema }] },
  });
  /** 只带这一个工具的请求体，按厂商改过之后。 */
  const sentBody = (input: {
    baseUrl: string;
    schema: Record<string, unknown>;
    model?: string;
  }) => {
    const target = { ...anthropicTool(input.schema), model: input.model ?? "m" };
    return withVendorRewrites({ ...target, baseUrl: input.baseUrl });
  };
  /** 只带一个工具、参数是 `schema` 的请求体。 */
  const toolBody = (schema: Record<string, unknown>) => anthropicTool(schema).body;

  test("Kimi: each schema's type from its values; mixed, null, typed, and a property called enum left as they were", () => {
    const schema = {
      type: "object",
      properties: {
        kinds: {
          anyOf: [
            { items: { enum: ["text", "icon"] }, maxItems: 2, type: "array" },
            { type: "null" },
          ],
        },
        level: { enum: [1, 2, 3] },
        scale: { enum: [1, 1.5] },
        on: { const: true },
        mixed: { enum: ["a", 1] },
        maybe: { enum: ["a", null] },
        typed: { type: "string", enum: ["x"] },
        enum: { type: "string" },
      },
      $defs: { mode: { enum: ["fast", "slow"] } },
    };
    expect(sentBody({ baseUrl: "https://api.kimi.com/coding/v1", schema })).toEqual(
      toolBody({
        type: "object",
        properties: {
          kinds: {
            anyOf: [
              { items: { type: "string", enum: ["text", "icon"] }, maxItems: 2, type: "array" },
              { type: "null" },
            ],
          },
          level: { type: "integer", enum: [1, 2, 3] },
          scale: { type: "number", enum: [1, 1.5] },
          on: { type: "boolean", const: true },
          mixed: { enum: ["a", 1] },
          maybe: { enum: ["a", null] },
          typed: { type: "string", enum: ["x"] },
          enum: { type: "string" },
        },
        $defs: { mode: { type: "string", enum: ["fast", "slow"] } },
      }),
    );
  });

  test.each([
    ["^[^\\0]*$", "^[^\\u0000]*$"],
    ["\\\\0", "\\\\0"],
    ["\\01", "\\01"],
    ["\\u0000", "\\u0000"],
    ["^https?://", "^https?://"],
    ["\\\\\\0", "\\\\\\u0000"],
  ])("DeepSeek: pattern %s is sent as %s", (pattern, sent) => {
    const schema = { type: "string", pattern };
    expect(sentBody({ baseUrl: "https://api.deepseek.com", schema })).toEqual(
      toolBody({
        type: "string",
        pattern: sent,
      }),
    );
  });

  test("DeepSeek: only the schemas' patterns, never a default or a const value", () => {
    const schema = {
      type: "object",
      properties: {
        content: { type: "string", pattern: "^[^\\0]*$", default: { pattern: "\\0" } },
      },
      const: { pattern: "\\0" },
    };
    expect(sentBody({ baseUrl: "https://api.deepseek.com", schema })).toEqual(
      toolBody({
        type: "object",
        properties: {
          content: { type: "string", pattern: "^[^\\u0000]*$", default: { pattern: "\\0" } },
        },
        const: { pattern: "\\0" },
      }),
    );
  });

  test.each([
    ["^[^\\s[\\]]+$", "^[^\\s\\[\\]]+$"],
    ["^[^\\s\\[\\]]+$", "^[^\\s\\[\\]]+$"],
    ["[[:alpha:]]", "[\\[:alpha:]]"],
    ["[a&&b]", "[a&\\&b]"],
    ["[+--]", "[+-\\-]"],
    ["[~~]", "[~\\~]"],
    ["a&&b--c~~d\\[x", "a&&b--c~~d\\[x"],
    ["^https?://[a-z]+\\.[a-z]{2,}$", "^https?://[a-z]+\\.[a-z]{2,}$"],
    ["\\\\[a[b]", "\\\\[a\\[b]"],
  ])("Grok: pattern %s is sent as %s", (pattern, sent) => {
    const schema = { type: "string", pattern };
    expect(sentBody({ baseUrl: RELAY_URL, model: "grok-4.6", schema })).toEqual(
      toolBody({
        type: "string",
        pattern: sent,
      }),
    );
  });

  test("another model through a relay gets the same object back", () => {
    const input = { ...anthropicTool({ type: "string", pattern: "[a&&b]" }), baseUrl: RELAY_URL };
    expect(withVendorRewrites(input)).toBe(input.body);
  });
});

/* 搜到的页面只对 xAI 以外的 Responses 地址要（magpie responses.go buildResponses：xAI 的接口不知道收不收）。 */
describe("the search sources asked of a Responses address", () => {
  const search = parseAnthropicRequest({
    model: "m",
    max_tokens: 1000,
    messages: [{ role: "user", content: "Perform a web search for the query: osuna" }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
  });
  const includeFor = (baseUrl: string) => {
    const text = translatedBody({
      request: search,
      baseUrl,
      from: "anthropic_messages",
      to: "openai_responses",
      model: "grok-4",
      facts: {},
      refusals: NO_REFUSALS,
      continuation: null,
    });
    return (JSON.parse(text) as { include?: unknown }).include;
  };

  test("a relay is asked for them; xAI's own address is not", () => {
    expect(includeFor(RELAY_URL)).toEqual(["web_search_call.action.sources"]);
    expect(includeFor("https://api.x.ai/v1")).toBeUndefined();
  });
});
