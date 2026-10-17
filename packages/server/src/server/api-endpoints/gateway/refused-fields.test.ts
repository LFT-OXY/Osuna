// 用例取自 magpie（https://github.com/yetone/magpie，出处见下方注释）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import {
  foldsRootsUpFront,
  offersImageTool,
  refusedFields,
  withoutRefusedFields,
  type DroppedField,
} from "./refused-fields.js";

/*
 * 上游不收的字段：自动模式的审查字段、display、已弃用的采样参数、延后加载工具块、只剩 tool_reference 的工具结果、
 * 工具的 strict、Codex 的画图工具。厂商原话与改法照 magpie（MIT，THIRD_PARTY_NOTICES）的 safeguards_refused_test.go、
 * thinking_display_test.go、anthropic_shapes_test.go、thinking_off_test.go、deferred_tools_test.go、
 * tool_reference_result_test.go、strict_refused_test.go（TestToolStrictRefusalWordings）、image_tool_test.go，
 * prompt_cache_test.go（TestPromptCacheKeyRefused）、object_root_test.go（rootUnionRefusals）与
 * internal/provider/grok_test.go（TestGrokBodyObjectRoot）。
 */

const SAFEGUARDS_REFUSED = `{"error":{"message":"safeguards: Extra inputs are not permitted","type":"invalid_request_error"}}`;
const DISPLAY_REFUSED = `{"type":"error","error":{"type":"invalid_request_error","message":"thinking.adaptive.display: Extra inputs are not permitted"}}`;
const DISPLAY_VALUE_REFUSED = `{"type":"error","error":{"type":"invalid_request_error","message":"thinking.adaptive.display: Input should be 'summarized', 'omitted'"}}`;
const DEFERRED_REFUSED = `{"error":{"message":"Failed to deserialize the JSON body into the target type: messages[1].content: unknown variant \`tool_removal\`, expected one of \`text\`, \`image\`, \`document\`, \`thinking\`, \`server_tool_use\`, \`tool_use\`, \`tool_result\`, \`web_search_tool_result\`, \`tool_addition\` at line 1 column 233","type":"invalid_request_error","param":null,"code":"invalid_request_error"}}`;
const REFS_ONLY_REFUSED =
  "Failed to deserialize the JSON body into the target type: messages[4]: missing field `content` at line 38 column 3";
const STRICT_REFUSED = `{"error":{"message":"Unsupported Chat Completions API field: tools[0].function.strict","type":"invalid_request_error"}}`;

const IMAGE_TOOL = {
  type: "namespace",
  name: "image_gen",
  description: "Tools in the image_gen namespace.",
  tools: [{ type: "function", name: "imagegen", strict: false, parameters: { type: "object" } }],
};

const REFS_ONLY_RESULT = {
  role: "user",
  content: [
    {
      type: "tool_result",
      tool_use_id: "a",
      content: [
        { type: "tool_reference", tool_name: "WebFetch" },
        { type: "tool_reference", tool_name: "WebSearch" },
      ],
    },
  ],
};

function readOff(input: {
  format: "anthropic_messages" | "openai_chat" | "openai_responses";
  body: unknown;
  text: string;
  status?: number;
}): DroppedField[] {
  return refusedFields({ ...input, status: input.status ?? 400 });
}

function dropped(input: {
  format: "anthropic_messages" | "openai_chat" | "openai_responses";
  body: Record<string, unknown>;
  fields: DroppedField[];
}): Record<string, unknown> {
  return withoutRefusedFields({
    format: input.format,
    body: input.body,
    refused: (field) => input.fields.includes(field),
  });
}

describe("auto mode's safeguards and the thinking display refused", () => {
  const body = {
    model: "claude-opus-5.5",
    thinking: { type: "adaptive", display: "updates" },
    safeguards: { dangerous_tool_use: { enabled: true } },
    messages: [{ role: "user", content: "say pong" }],
  };

  test("are read off the 400 that names them, for a body that has them", () => {
    const format = "anthropic_messages";
    expect(readOff({ format, body, text: SAFEGUARDS_REFUSED })).toEqual(["safeguards"]);
    expect(readOff({ format, body, text: DISPLAY_REFUSED })).toEqual(["display"]);
    expect(readOff({ format, body, text: DISPLAY_VALUE_REFUSED })).toEqual(["displayValue"]);
    const without = { messages: body.messages, thinking: { type: "adaptive" } };
    expect(readOff({ format, body: without, text: SAFEGUARDS_REFUSED })).toEqual([]);
    expect(readOff({ format, body: without, text: DISPLAY_REFUSED })).toEqual([]);
    // 上游列出的值它本来就收：不是 display 的事。
    const summarized = { ...body, thinking: { type: "adaptive", display: "summarized" } };
    expect(readOff({ format, body: summarized, text: DISPLAY_VALUE_REFUSED })).toEqual([]);
    expect(readOff({ format, body, text: SAFEGUARDS_REFUSED, status: 500 })).toEqual([]);
  });

  test("go, the rest of the request as it was", () => {
    const format = "anthropic_messages";
    expect(dropped({ format, body, fields: ["safeguards"] })).toEqual({
      model: body.model,
      thinking: body.thinking,
      messages: body.messages,
    });
    expect(dropped({ format, body, fields: ["display"] }).thinking).toEqual({ type: "adaptive" });
    // 只是值不收：highlights 改成 summarized，其他新值去掉，summarized 与 omitted 不动。
    const valueOf = (display: string) =>
      dropped({
        format,
        body: { ...body, thinking: { type: "adaptive", display } },
        fields: ["displayValue"],
      }).thinking;
    expect(valueOf("updates")).toEqual({ type: "adaptive" });
    expect(valueOf("highlights")).toEqual({ type: "adaptive", display: "summarized" });
    expect(valueOf("omitted")).toEqual({ type: "adaptive", display: "omitted" });
    expect(dropped({ format, body, fields: [] })).toBe(body);
  });
});

describe("sampling a model says is deprecated", () => {
  test.each([
    '"`temperature` is deprecated for this model. (tid: 2026101003072022550024879833267)"',
    '"`top_p` is deprecated for this model. (tid: 2026101003072327076516219357568)"',
    '"`top_k` is deprecated for this model. (tid: 2026101003072467419049331484203)"',
  ])("is read off %s and all three go", (text) => {
    const body = { model: "claude-haiku-5.5", temperature: 0, top_p: 0.9, top_k: 5, messages: [] };
    expect(readOff({ format: "anthropic_messages", body, text })).toEqual(["sampling"]);
    expect(dropped({ format: "anthropic_messages", body, fields: ["sampling"] })).toEqual({
      model: "claude-haiku-5.5",
      messages: [],
    });
  });

  test("is not read off a body without sampling, or another 400", () => {
    const text = '"`temperature` is deprecated for this model."';
    expect(readOff({ format: "anthropic_messages", body: { messages: [] }, text })).toEqual([]);
    const body = { temperature: 0, messages: [] };
    expect(readOff({ format: "anthropic_messages", body, text: "max_tokens: too large" })).toEqual(
      [],
    );
  });
});

describe("Claude Code's deferred-tool blocks refused", () => {
  const definition = { name: "mcp__docs__search", input_schema: { type: "object" } };
  const body = {
    tools: [{ name: "Read", input_schema: { type: "object" } }],
    messages: [
      { role: "user", content: "hi" },
      {
        role: "user",
        content: [
          { type: "tool_addition", tool: { type: "tool_definition", definition } },
          { type: "tool_removal", tool: { type: "tool_reference", name: "Gone" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "text", text: "go on" },
          { type: "tool_reference", tool_name: "Read" },
        ],
      },
    ],
  };

  test("are read off DeepSeek's 422, for a body that has them", () => {
    const format = "anthropic_messages";
    expect(readOff({ format, body, text: DEFERRED_REFUSED, status: 422 })).toEqual([
      "deferredTools",
    ]);
    const plain = { messages: [{ role: "user", content: "hi" }] };
    expect(readOff({ format, body: plain, text: DEFERRED_REFUSED, status: 422 })).toEqual([]);
  });

  test("go with the messages they leave empty; a definition carried inline joins the tools", () => {
    expect(dropped({ format: "anthropic_messages", body, fields: ["deferredTools"] })).toEqual({
      tools: [...body.tools, definition],
      messages: [
        { role: "user", content: "hi" },
        { role: "user", content: [{ type: "text", text: "go on" }] },
      ],
    });
  });

  test("a tool_reference inside a tool_result stays: it is the tool's answer", () => {
    const answered = { messages: [REFS_ONLY_RESULT] };
    expect(
      dropped({ format: "anthropic_messages", body: answered, fields: ["deferredTools"] }),
    ).toBe(answered);
  });
});

describe("a tool result holding only tool_reference blocks refused", () => {
  const body = { messages: [{ role: "user", content: "find it" }, REFS_ONLY_RESULT] };

  test("is read off the 422 that misses its content", () => {
    expect(
      readOff({ format: "anthropic_messages", body, text: REFS_ONLY_REFUSED, status: 422 }),
    ).toEqual(["toolResultRefs"]);
    const withText = {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "a",
              content: [
                { type: "text", text: "x" },
                { type: "tool_reference", tool_name: "check" },
              ],
            },
          ],
        },
      ],
    };
    expect(
      readOff({
        format: "anthropic_messages",
        body: withText,
        text: REFS_ONLY_REFUSED,
        status: 422,
      }),
    ).toEqual([]);
  });

  test("gets a text block first naming the tools loaded; the references and the pairing stay", () => {
    expect(dropped({ format: "anthropic_messages", body, fields: ["toolResultRefs"] })).toEqual({
      messages: [
        { role: "user", content: "find it" },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "a",
              content: [
                {
                  type: "text",
                  text: "Tool WebFetch is loaded and can be called now.\nTool WebSearch is loaded and can be called now.",
                },
                { type: "tool_reference", tool_name: "WebFetch" },
                { type: "tool_reference", tool_name: "WebSearch" },
              ],
            },
          ],
        },
      ],
    });
  });
});

describe("a tool's strict refused", () => {
  test.each([
    STRICT_REFUSED,
    "Unsupported Chat Completions API field: tools[0].***.strict",
    `{"error":{"message":"Unknown parameter: 'tools[3].function.strict'.","type":"invalid_request_error","param":"tools[3].function.strict","code":"unknown_parameter"}}`,
    `{"error":{"message":"tools.0.function.strict: Extra inputs are not permitted"}}`,
    `{"detail":[{"type":"extra_forbidden","loc":["body","tools",0,"function","strict"],"msg":"Extra inputs are not permitted","input":false}]}`,
    `{"error":{"message":"Unrecognized request argument supplied: tools[0].strict"}}`,
    `{"error":{"message":"Unsupported Responses API field: tools[0].strict","type":"invalid_request_error"}}`,
  ])("is read off %s", (text) => {
    const chat = { tools: [{ type: "function", function: { name: "read", strict: false } }] };
    expect(readOff({ format: "openai_chat", body: chat, text })).toEqual(["toolStrict"]);
  });

  test.each([
    `{"error":{"message":"Invalid schema for function 'read': In context=(), 'additionalProperties' is required to be supplied and to be false.","type":"invalid_request_error","param":"tools[0].function.parameters","code":"invalid_function_parameters"}}`,
    `{"error":{"message":"Invalid type for 'tools[0].function.strict': expected a boolean, but got a string instead.","type":"invalid_request_error","param":"tools[0].function.strict","code":"invalid_type"}}`,
    `{"error":{"message":"Unsupported parameter: 'store'.","type":"invalid_request_error"}}`,
  ])("is not read off %s", (text) => {
    const chat = { tools: [{ type: "function", function: { name: "read", strict: false } }] };
    expect(readOff({ format: "openai_chat", body: chat, text })).toEqual([]);
  });

  test("goes from Chat's functions and Responses' tools, a namespace's included", () => {
    const chat = {
      tools: [
        { type: "function", function: { name: "read", strict: false, parameters: {} } },
        { type: "function", function: { name: "edit" } },
      ],
    };
    expect(dropped({ format: "openai_chat", body: chat, fields: ["toolStrict"] })).toEqual({
      tools: [
        { type: "function", function: { name: "read", parameters: {} } },
        { type: "function", function: { name: "edit" } },
      ],
    });
    const responses = { tools: [{ type: "function", name: "exec", strict: false }, IMAGE_TOOL] };
    expect(
      dropped({ format: "openai_responses", body: responses, fields: ["toolStrict"] }),
    ).toEqual({
      tools: [
        { type: "function", name: "exec" },
        {
          ...IMAGE_TOOL,
          tools: [{ type: "function", name: "imagegen", parameters: { type: "object" } }],
        },
      ],
    });
    const none = { tools: [{ type: "function", name: "exec" }] };
    expect(readOff({ format: "openai_responses", body: none, text: STRICT_REFUSED })).toEqual([]);
  });
});

describe("Codex's image tool", () => {
  const exec = { type: "function", name: "exec_command", parameters: { type: "object" } };

  test("is offered in a Responses body in its namespace", () => {
    expect(offersImageTool({ tools: [exec, IMAGE_TOOL] })).toBe(true);
    expect(offersImageTool({ tools: [exec] })).toBe(false);
  });

  test("goes from the tools; with no tool left the tool choice goes too", () => {
    const body = { tools: [exec, IMAGE_TOOL], tool_choice: "auto", input: [] };
    expect(dropped({ format: "openai_responses", body, fields: ["imageTool"] })).toEqual({
      tools: [exec],
      tool_choice: "auto",
      input: [],
    });
    const alone = { tools: [IMAGE_TOOL], tool_choice: "auto", input: [] };
    expect(dropped({ format: "openai_responses", body: alone, fields: ["imageTool"] })).toEqual({
      input: [],
    });
  });
});

describe("Codex's prompt cache key refused (magpie prompt_cache_test.go TestPromptCacheKeyRefused)", () => {
  const CACHE_KEY_REFUSED = `{"error":{"message":"Invalid JSON payload received. Unknown name \\"prompt_cache_key\\": Cannot find field."}}`;
  const chat = { model: "m1", messages: [], prompt_cache_key: "thread-1" };

  test("is read off a 400 that names it, for a body that has it", () => {
    expect(readOff({ format: "openai_chat", body: chat, text: CACHE_KEY_REFUSED })).toEqual([
      "cacheKey",
    ]);
    expect(
      readOff({ format: "openai_responses", body: chat, text: CACHE_KEY_REFUSED, status: 422 }),
    ).toEqual(["cacheKey"]);
  });

  test("is not read off a body without it, another error or a 429", () => {
    const without = { model: "m1", messages: [] };
    expect(readOff({ format: "openai_chat", body: without, text: CACHE_KEY_REFUSED })).toEqual([]);
    const other = `{"error":{"message":"context too long"}}`;
    expect(readOff({ format: "openai_chat", body: chat, text: other })).toEqual([]);
    expect(
      readOff({ format: "openai_chat", body: chat, text: CACHE_KEY_REFUSED, status: 429 }),
    ).toEqual([]);
  });

  test("goes, the rest of the request as it was", () => {
    expect(dropped({ format: "openai_chat", body: chat, fields: ["cacheKey"] })).toEqual({
      model: "m1",
      messages: [],
    });
  });
});

describe("a tool whose parameters are a union at the root refused (magpie object_root_test.go, grok_test.go TestGrokBodyObjectRoot)", () => {
  const ROOT_UNION_REFUSALS = [
    // AiHubMix 的 grok-4.7（2026-10-08，原样）。
    `{"error":{"message":"Failed to start sampling: [invalid_client_tool_schema] mcp__codex_app__automation_update: tool parameter root must be an object type (root schema is an anyOf/oneOf union with a non-object branch) (tid: 2026100808425178410684649237042)","type":"upstream_error","param":"400","code":"bad_response_status_code"}}`,
    // 照 OpenAI 那样校验的上游（magpie #1493）。
    `{"error":{"message":"Invalid schema for function 'mcp__codex_app__automation_update': schema must have type 'object' and not have 'oneOf'/'anyOf'/'allOf'/'enum'/'const'/'not' at the top level.","type":"invalid_request_error","param":"tools[1].parameters","code":"invalid_function_parameters"}}`,
    // OpenAI 自己的 Responses API（2026-10-10，原样）。
    '{\n  "error": {\n    "message": "Invalid schema for function \'mcp__codex_app__automation_update\': schema must be a JSON Schema of \'type: \\"object\\"\', got \'type: \\"None\\"\'.",\n    "type": "invalid_request_error",\n    "param": "tools[0].parameters",\n    "code": "invalid_function_parameters"\n  }\n}',
  ];
  const UPDATE = {
    anyOf: [
      {
        type: "object",
        properties: { id: { type: "string" }, prompt: { type: "string" } },
        required: ["id", "prompt"],
      },
      { $ref: "#/$defs/pause" },
      { type: "null" },
    ],
    $defs: {
      pause: {
        type: "object",
        properties: { id: { type: "string" }, paused: { type: "boolean" } },
        required: ["id"],
      },
    },
  };
  const PICK = { oneOf: [{ type: "object", properties: { a: { type: "string" } } }] };
  const PLAIN = { type: "object", properties: { x: { type: "string" } } };
  const responses = {
    tools: [
      { type: "function", name: "mcp__codex_app__automation_update", parameters: UPDATE },
      {
        type: "namespace",
        name: "codex_app",
        tools: [{ type: "function", name: "pick", parameters: PICK }],
      },
      { type: "function", name: "plain", parameters: PLAIN },
    ],
  };

  test.each(ROOT_UNION_REFUSALS)("is read off %s, for a body that has one", (text) => {
    expect(readOff({ format: "openai_responses", body: responses, text })).toEqual(["rootUnion"]);
    const chat = { tools: [{ type: "function", function: { name: "u", parameters: UPDATE } }] };
    expect(readOff({ format: "openai_chat", body: chat, text })).toEqual(["rootUnion"]);
    const plain = { tools: [{ type: "function", name: "plain", parameters: PLAIN }] };
    expect(readOff({ format: "openai_responses", body: plain, text })).toEqual([]);
  });

  test("is asked again with every function's parameters an object root, a namespace's included", () => {
    expect(dropped({ format: "openai_responses", body: responses, fields: ["rootUnion"] })).toEqual(
      {
        tools: [
          {
            type: "function",
            name: "mcp__codex_app__automation_update",
            parameters: {
              type: "object",
              properties: {
                id: { type: "string" },
                prompt: { type: "string" },
                paused: { type: "boolean" },
              },
              required: ["id"],
              $defs: UPDATE.$defs,
            },
          },
          {
            type: "namespace",
            name: "codex_app",
            tools: [
              {
                type: "function",
                name: "pick",
                parameters: { type: "object", properties: { a: { type: "string" } } },
              },
            ],
          },
          { type: "function", name: "plain", parameters: PLAIN },
        ],
      },
    );
    const chat = { tools: [{ type: "function", function: { name: "pick", parameters: PICK } }] };
    expect(dropped({ format: "openai_chat", body: chat, fields: ["rootUnion"] })).toEqual({
      tools: [
        {
          type: "function",
          function: {
            name: "pick",
            parameters: { type: "object", properties: { a: { type: "string" } } },
          },
        },
      ],
    });
  });

  test("xAI's own API gets them folded from the start; another host only once it refused (magpie foldsRoots)", () => {
    expect(foldsRootsUpFront("https://api.x.ai/v1")).toBe(true);
    expect(foldsRootsUpFront("https://relay.example/v1")).toBe(false);
  });

  test("an object root is left as it came", () => {
    const plain = { tools: [{ type: "function", name: "plain", parameters: PLAIN }] };
    expect(dropped({ format: "openai_responses", body: plain, fields: ["rootUnion"] })).toBe(plain);
  });
});
