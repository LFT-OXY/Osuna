// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway 的 format_refused_test.go、prefill_test.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import {
  downgradedRequest,
  refusedDowngrades,
  withDowngrades,
  type DowngradedShape,
} from "./refused-downgrades.js";
import type { GatewayRequest } from "./translation/ir.js";

/*
 * 上游不收、要降级的写法：结构化输出（先降到 json_object 加 system 里的 schema，再降到只用文字说明）与预填（补一个 user 轮）。
 * 厂商原话与改法照 magpie 的 format_refused_test.go（mimoSchemaRefusal、formatRefuser）
 * 与 prefill_test.go（openCodeGoPrefillRefusal、volcenginePrefillRefusal、TestUserLastBody）。
 */

const SCHEMA_REFUSED = `{"error":{"message":"text.format type 'json_schema' is not supported, only 'text' and 'json_object' are allowed.","type":"invalid_request_error","param":null,"code":"400"}}`;
const OBJECT_REFUSED = `{"error":{"message":"This response_format type is unavailable now","type":"invalid_request_error","param":null,"code":"invalid_request_error"}}`;
const ANTHROPIC_FORMAT_REFUSED = `{"type":"error","error":{"type":"invalid_request_error","message":"output_config.format: Extra inputs are not permitted"}}`;
const OPENCODE_PREFILL_REFUSED = `{"type":"error","error":{"type":"api_error","message":"Upstream request failed: [invalid_request_error] This model does not support assistant message prefill. The conversation must end with a user message."}}`;
const VOLCENGINE_PREFILL_REFUSED = `{"error":{"code":"InvalidParameter","message":"The parameter input[194].role specified in the request are not valid: The last message cannot be from the assistant for a model that does not support prefill","param":"input[194].role","type":"BadRequest"}}`;

const SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};
const SCHEMA_LINE = `Respond with a single JSON value and nothing else, matching this JSON schema:\n${JSON.stringify(SCHEMA)}.`;
const OBJECT_LINE = "Respond with a single JSON object and nothing else.";

const RESPONSES_SCHEMA = {
  model: "mimo-v2.6-flash",
  instructions: "You are Codex.",
  input: "Return a JSON object whose ok field is true.",
  text: {
    format: { type: "json_schema", name: "compat_probe", strict: true, schema: SCHEMA },
    verbosity: "low",
  },
};
const CHAT_SCHEMA = {
  model: "deepseek-v3",
  messages: [
    { role: "system", content: "Be brief." },
    { role: "user", content: "hi" },
  ],
  response_format: { type: "json_schema", json_schema: { name: "probe", schema: SCHEMA } },
};
const ANTHROPIC_SCHEMA = {
  model: "glm-4.6",
  system: [{ type: "text", text: "Extract the event information." }],
  messages: [{ role: "user", content: "Alice and Bob are going to a science fair on Friday." }],
  output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
};

type ApiFormat = "anthropic_messages" | "openai_chat" | "openai_responses" | "gemini";

function readOff(input: {
  format: ApiFormat;
  body: unknown;
  text: string;
  status?: number;
}): DowngradedShape[] {
  return refusedDowngrades({ ...input, status: input.status ?? 400 });
}

function downgraded(input: {
  format: ApiFormat;
  body: Record<string, unknown>;
  shapes: DowngradedShape[];
}): Record<string, unknown> {
  const { shapes } = input;
  return withDowngrades({
    format: input.format,
    body: input.body,
    refused: (shape) => shapes.includes(shape),
  });
}

describe("an endpoint refusing structured output", () => {
  test.each([
    { format: "openai_responses", body: RESPONSES_SCHEMA, text: SCHEMA_REFUSED },
    { format: "openai_chat", body: CHAT_SCHEMA, text: SCHEMA_REFUSED },
  ] as const)("refusing a $format schema is asked for a JSON object first", (refused) => {
    expect(readOff(refused)).toEqual(["jsonSchema"]);
  });

  test.each([
    {
      why: "a Responses JSON object",
      format: "openai_responses",
      body: { ...RESPONSES_SCHEMA, text: { format: { type: "json_object" } } },
      text: OBJECT_REFUSED,
    },
    {
      why: "a Chat JSON object",
      format: "openai_chat",
      body: { ...CHAT_SCHEMA, response_format: { type: "json_object" } },
      text: OBJECT_REFUSED,
    },
    // Anthropic 的 output_config.format 只收 schema：没有 json_object 这一步。
    {
      why: "an Anthropic schema",
      format: "anthropic_messages",
      body: ANTHROPIC_SCHEMA,
      text: ANTHROPIC_FORMAT_REFUSED,
    },
  ] as const)("refusing $why is told the format in words", (refused) => {
    expect(readOff(refused)).toEqual(["structuredOutput"]);
  });

  test("a Gemini schema refused (generationConfig.responseJsonSchema) is asked for a JSON object first, an object told in words", () => {
    const schema = { responseMimeType: "application/json", responseJsonSchema: SCHEMA };
    const refusedSchema = `{"error":{"code":400,"message":"Invalid JSON payload received. Unknown name \\"responseJsonSchema\\" at 'generation_config'","status":"INVALID_ARGUMENT"}}`;
    const refusedObject = `{"error":{"code":400,"message":"response_mime_type application/json is not supported","status":"INVALID_ARGUMENT"}}`;
    expect(
      readOff({ format: "gemini", body: { generationConfig: schema }, text: refusedSchema }),
    ).toEqual(["jsonSchema"]);
    expect(
      readOff({
        format: "gemini",
        body: { generationConfig: { responseMimeType: "application/json" } },
        text: refusedObject,
      }),
    ).toEqual(["structuredOutput"]);
  });

  test.each([
    { why: "another status", body: RESPONSES_SCHEMA, text: SCHEMA_REFUSED, status: 500 },
    {
      why: "a request with no format",
      body: { ...RESPONSES_SCHEMA, text: undefined },
      text: SCHEMA_REFUSED,
      status: 400,
    },
    {
      why: "a refusal that names no format",
      body: RESPONSES_SCHEMA,
      text: `{"error":{"message":"model not found"}}`,
      status: 400,
    },
  ])("is not read off $why", ({ body, text, status }) => {
    expect(readOff({ format: "openai_responses", body, text, status })).toEqual([]);
  });

  test("a Responses schema is asked as a JSON object with the schema in the instructions", () => {
    expect(
      downgraded({ format: "openai_responses", body: RESPONSES_SCHEMA, shapes: ["jsonSchema"] }),
    ).toEqual({
      ...RESPONSES_SCHEMA,
      instructions: `You are Codex.\n\n${SCHEMA_LINE}`,
      text: { format: { type: "json_object" }, verbosity: "low" },
    });
  });

  test("told in words, a Responses format leaves text.format and keeps the rest of text", () => {
    const shapes: DowngradedShape[] = ["jsonSchema", "structuredOutput"];
    expect(downgraded({ format: "openai_responses", body: RESPONSES_SCHEMA, shapes })).toEqual({
      ...RESPONSES_SCHEMA,
      instructions: `You are Codex.\n\n${SCHEMA_LINE}`,
      text: { verbosity: "low" },
    });
    const bare = { model: "m", input: "hi", text: { format: { type: "json_object" } } };
    expect(downgraded({ format: "openai_responses", body: bare, shapes })).toEqual({
      model: "m",
      input: "hi",
      instructions: OBJECT_LINE,
    });
  });

  test("a Chat schema is asked as a JSON object, the schema said in its system message", () => {
    expect(
      downgraded({ format: "openai_chat", body: CHAT_SCHEMA, shapes: ["jsonSchema"] }),
    ).toEqual({
      ...CHAT_SCHEMA,
      messages: [
        { role: "system", content: `Be brief.\n\n${SCHEMA_LINE}` },
        { role: "user", content: "hi" },
      ],
      response_format: { type: "json_object" },
    });
  });

  test("told in words, a Chat format with no system message gets one of its own first", () => {
    const body = { ...CHAT_SCHEMA, messages: [{ role: "user", content: "hi" }] };
    expect(downgraded({ format: "openai_chat", body, shapes: ["structuredOutput"] })).toEqual({
      model: "deepseek-v3",
      messages: [
        { role: "system", content: SCHEMA_LINE },
        { role: "user", content: "hi" },
      ],
    });
  });

  test("an Anthropic schema is never asked as an object; told in words it goes into the system blocks", () => {
    expect(
      downgraded({ format: "anthropic_messages", body: ANTHROPIC_SCHEMA, shapes: ["jsonSchema"] }),
    ).toBe(ANTHROPIC_SCHEMA);
    expect(
      downgraded({
        format: "anthropic_messages",
        body: ANTHROPIC_SCHEMA,
        shapes: ["structuredOutput"],
      }),
    ).toEqual({
      ...ANTHROPIC_SCHEMA,
      system: [
        { type: "text", text: "Extract the event information." },
        { type: "text", text: SCHEMA_LINE },
      ],
      output_config: { effort: "low" },
    });
    const plain = {
      messages: [],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    };
    expect(
      downgraded({ format: "anthropic_messages", body: plain, shapes: ["structuredOutput"] }),
    ).toEqual({ messages: [], system: SCHEMA_LINE });
  });
});

describe("an endpoint refusing a conversation ending with the assistant's message", () => {
  const chatPrefill = {
    messages: [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ],
  };
  const responsesPrefill = { input: [{ role: "assistant", content: "b" }] };
  const anthropicPrefill = {
    messages: [
      { role: "user", content: "a" },
      { role: "assistant", content: [{ type: "text", text: "b" }] },
    ],
  };

  test.each([
    { format: "openai_chat", body: chatPrefill, text: OPENCODE_PREFILL_REFUSED },
    { format: "openai_responses", body: responsesPrefill, text: VOLCENGINE_PREFILL_REFUSED },
    { format: "anthropic_messages", body: anthropicPrefill, text: OPENCODE_PREFILL_REFUSED },
    {
      format: "openai_chat",
      body: chatPrefill,
      text: `{"error":{"message":"Requests ending with a model turn are not supported."}}`,
    },
  ] as const)("is read off a $format refusal", (refused) => {
    expect(readOff(refused)).toEqual(["prefill"]);
  });

  test.each([
    {
      why: "a conversation ending with the user",
      format: "openai_chat",
      body: { messages: [{ role: "user", content: "a" }] },
    },
    {
      why: "a Chat assistant message that calls a tool",
      format: "openai_chat",
      body: { messages: [{ role: "assistant", content: null, tool_calls: [{ id: "c" }] }] },
    },
    {
      why: "a Responses function call last",
      format: "openai_responses",
      body: { input: [{ type: "function_call", call_id: "c", name: "x", arguments: "{}" }] },
    },
    { why: "a Responses input given as text", format: "openai_responses", body: { input: "hi" } },
    {
      why: "an Anthropic assistant message that calls a tool",
      format: "anthropic_messages",
      body: {
        messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t", name: "x" }] }],
      },
    },
  ] as const)("is not read off $why", ({ format, body }) => {
    expect(readOff({ format, body, text: OPENCODE_PREFILL_REFUSED })).toEqual([]);
  });

  test("Chat and Responses conversations get a user turn after the assistant's message", () => {
    expect(downgraded({ format: "openai_chat", body: chatPrefill, shapes: ["prefill"] })).toEqual({
      messages: [...chatPrefill.messages, { role: "user", content: "Continue." }],
    });
    expect(
      downgraded({ format: "openai_responses", body: responsesPrefill, shapes: ["prefill"] }),
    ).toEqual({
      input: [
        ...responsesPrefill.input,
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Continue." }],
        },
      ],
    });
    const userLast = { messages: [{ role: "user", content: "a" }] };
    expect(downgraded({ format: "openai_chat", body: userLast, shapes: ["prefill"] })).toBe(
      userLast,
    );
  });

  test("an Anthropic client's prefill is its own ask and goes as it came", () => {
    expect(
      downgraded({ format: "anthropic_messages", body: anthropicPrefill, shapes: ["prefill"] }),
    ).toBe(anthropicPrefill);
  });
});

describe("a translated request downgraded", () => {
  const request: GatewayRequest = {
    model: "m",
    system: "Be brief.",
    messages: [
      { role: "user", parts: [{ kind: "text", text: "a" }] },
      { role: "assistant", parts: [{ kind: "text", text: "b" }] },
    ],
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
    format: { type: "json_schema", name: "probe", description: "", schema: SCHEMA, strict: null },
    named: {},
    webSearch: false,
  };
  const refusedOnly =
    (...shapes: DowngradedShape[]) =>
    (shape: DowngradedShape) =>
      shapes.includes(shape);

  test("a schema is asked as an object with it in the system prompt, except of Anthropic", () => {
    const refused = refusedOnly("jsonSchema");
    expect(downgradedRequest({ request, to: "openai_chat", refused, lastIsTurn: true })).toEqual({
      ...request,
      system: `Be brief.\n\n${SCHEMA_LINE}`,
      format: { type: "json_object" },
    });
    expect(
      downgradedRequest({ request, to: "anthropic_messages", refused, lastIsTurn: true }),
    ).toBe(request);
  });

  test("told in words, the format leaves the request for the system prompt", () => {
    const refused = refusedOnly("jsonSchema", "structuredOutput");
    expect(
      downgradedRequest({ request, to: "anthropic_messages", refused, lastIsTurn: false }),
    ).toEqual({ ...request, system: `Be brief.\n\n${SCHEMA_LINE}`, format: null });
  });

  test("a prefill gets a user turn only when the agent's own API reads it as a turn said", () => {
    const refused = refusedOnly("prefill");
    const plain = { ...request, format: null };
    expect(
      downgradedRequest({ request: plain, to: "openai_chat", refused, lastIsTurn: true }),
    ).toEqual({
      ...plain,
      messages: [...plain.messages, { role: "user", parts: [{ kind: "text", text: "Continue." }] }],
    });
    expect(
      downgradedRequest({ request: plain, to: "openai_chat", refused, lastIsTurn: false }),
    ).toBe(plain);
  });
});
