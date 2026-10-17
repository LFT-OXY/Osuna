import { describe, expect, test } from "vitest";
import { fenceFilter, unfence, unfencedReply } from "./fence.js";
import { emptyUsage, type GatewayRequest, type Reply, type StreamEvent } from "./ir.js";
import { parseResponsesRequest } from "./responses.js";

/*
 * 要 JSON 的回复剥掉模型包的 ``` 代码块。例子照 magpie（MIT，THIRD_PARTY_NOTICES）的 format_fence_test.go。
 */

const MEMORY = '{"raw_memory":"Keep ``` examples","rollout_summary":"test"}';

function askedFor(format: unknown): GatewayRequest {
  const text = format === null ? {} : { text: { format } };
  return parseResponsesRequest({ model: "m", input: "hi", stream: true, ...text });
}

const JSON_OBJECT = askedFor({ type: "json_object" });

function filtered(request: GatewayRequest, events: StreamEvent[]): StreamEvent[] {
  const out: StreamEvent[] = [];
  const filter = fenceFilter({ request, emit: (event) => out.push(event) });
  for (const event of events) filter.event(event);
  filter.end();
  return out;
}

describe("unfence", () => {
  test.each([
    ['```json\n{"a":1}\n```', '{"a":1}'],
    ["  ```\n[1,2]\n```  \n", "[1,2]"],
    ['```JSON\r\n{"a":1}\r\n```', '{"a":1}'],
    [
      '```json\n{"raw_memory":"Keep ``` code samples","rollout_summary":"test"}\n```',
      '{"raw_memory":"Keep ``` code samples","rollout_summary":"test"}',
    ],
  ])("a whole JSON value in an unlabelled or json fence is unwrapped: %j", (said, json) => {
    expect(unfence(said)).toBe(json);
  });

  test.each([
    '```json\n{"a":}\n```',
    '```json\n{"a":1',
    "```python\n{}\n```",
    "```json\n{} {}\n```",
    // 不是包住整个回答的代码块：原样留着。
    '{"a":"```"}',
    "Here it is:\n```json\n{}\n```",
    '```json {"a":1}```',
    "```json\n{}\n```\nand\n```json\n{}\n```",
    "```\n```",
  ])("anything else is not unfenced: %j", (said) => {
    expect(unfence(said)).toBeNull();
  });
});

describe("a structured-output reply streamed", () => {
  test("a fenced answer split across pieces reaches the agent unfenced, thinking and usage kept in place", () => {
    const events: StreamEvent[] = [
      { kind: "start", id: "resp_fence", usage: emptyUsage() },
      { kind: "think", text: "reasoning" },
      { kind: "text", text: "``" },
      { kind: "text", text: `\`json\n${MEMORY}` },
      { kind: "usage", usage: { ...emptyUsage(), input: 5, output: 8 } },
      { kind: "text", text: "\n```" },
      { kind: "stop", stop: "stop" },
      { kind: "done" },
    ];

    expect(filtered(JSON_OBJECT, events)).toEqual([
      { kind: "start", id: "resp_fence", usage: emptyUsage() },
      { kind: "think", text: "reasoning" },
      { kind: "usage", usage: { ...emptyUsage(), input: 5, output: 8 } },
      { kind: "text", text: MEMORY },
      { kind: "stop", stop: "stop" },
      { kind: "done" },
    ]);
  });

  test("a reply that does not begin with a fence passes on as it comes", () => {
    const events: StreamEvent[] = [
      { kind: "text", text: '{"raw_memory":' },
      { kind: "text", text: '"```"}' },
      { kind: "stop", stop: "stop" },
    ];

    expect(filtered(JSON_OBJECT, events)).toEqual(events);
  });

  test.each([
    { name: "cut at its limit", last: { kind: "stop", stop: "length" } },
    { name: "broken by an error", last: { kind: "error", message: "interrupted", code: null } },
  ] satisfies { name: string; last: StreamEvent }[])(
    "a fenced answer $name is handed on as it came",
    ({ last }) => {
      const partial = '```json\n{"raw_memory":';

      expect(filtered(JSON_OBJECT, [{ kind: "text", text: partial }, last])).toEqual([
        { kind: "text", text: partial },
        last,
      ]);
    },
  );

  test("a json_schema request is unfenced too, a plain one is not", () => {
    const fenced: StreamEvent[] = [
      { kind: "text", text: "```json\n" },
      { kind: "text", text: '{"a":1}\n```' },
      { kind: "stop", stop: "stop" },
    ];
    const schema = askedFor({ type: "json_schema", name: "Answer", schema: { type: "object" } });

    expect(filtered(schema, fenced)).toEqual([
      { kind: "text", text: '{"a":1}' },
      { kind: "stop", stop: "stop" },
    ]);
    expect(filtered(askedFor(null), fenced)).toEqual(fenced);
  });
});

describe("a structured-output reply asked for whole", () => {
  const reply: Reply = {
    id: "r1",
    parts: [
      { kind: "thinking", text: "reasoning", signature: "" },
      { kind: "text", text: `\`\`\`json\n${MEMORY}\n\`\`\`` },
    ],
    stop: "stop",
    usage: emptyUsage(),
  };

  test("its fenced text is unfenced", () => {
    expect(unfencedReply({ reply, request: JSON_OBJECT })).toEqual({
      ...reply,
      parts: [
        { kind: "thinking", text: "reasoning", signature: "" },
        { kind: "text", text: MEMORY },
      ],
    });
  });

  test("a client that asked for plain text gets the model's words as they came", () => {
    expect(unfencedReply({ reply, request: askedFor(null) })).toEqual(reply);
  });
});
