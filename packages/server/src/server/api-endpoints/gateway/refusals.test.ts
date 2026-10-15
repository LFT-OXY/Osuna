import { describe, expect, test } from "vitest";
import { RefusedShapes, refusedShape } from "./refusals.js";

/*
 * 上游不收「不思考」的写法：effort none、或关掉思考。错误原文照 magpie（MIT，THIRD_PARTY_NOTICES）的
 * sub2api_think_off_test.go（TestRefusesThinkingOff）、gateway_test.go、thinking_off_test.go。
 */

const NONE_REFUSED = `{"type":"error","error":{"type":"invalid_request_error","message":"gpt-6.1-sol does not support reasoning effort \\"none\\"; use low, medium, high, xhigh or max"}}`;

const OFF = { model: "glm-5.3", thinking: { type: "disabled" }, messages: [] };

describe("an endpoint refusing effort none", () => {
  test.each([
    { format: "openai_responses", body: { reasoning: { effort: "none" } } },
    { format: "openai_chat", body: { reasoning_effort: "none" } },
  ] as const)("is read off a 400 that lists the levels it takes ($format)", ({ format, body }) => {
    expect(refusedShape({ format, body, status: 400, text: NONE_REFUSED })).toBe("none");
  });

  test.each([
    { why: "another status", status: 500, text: NONE_REFUSED, effort: "none" },
    { why: "an effort that is not none", status: 400, text: NONE_REFUSED, effort: "low" },
    {
      why: "levels listed without none",
      status: 400,
      text: `{"error":{"message":"reasoning effort \\"xhigh\\" exceeds this group's limit; use low, medium or high"}}`,
      effort: "none",
    },
    {
      why: "a sentence that only says None",
      status: 400,
      text: `{"error":{"message":"None of the tools match; use low, medium or high"}}`,
      effort: "none",
    },
  ])("is not read off $why", ({ status, text, effort }) => {
    const body = { reasoning: { effort } };
    expect(refusedShape({ format: "openai_responses", body, status, text })).toBeNull();
  });
});

describe("an endpoint refusing thinking turned off", () => {
  test.each([
    `{"type":"error","error":{"type":"1210","message":"GLM-5.3 always engages in thinking; use low, high, or max"}}`,
    `{"type":"error","error":{"type":"invalid_request_error","message":"该模型始终支持思考，不可关闭"}}`,
    `{"type":"error","error":{"message":"\\u8be5\\u6a21\\u578b\\u59cb\\u7ec8\\u652f\\u6301\\u601d\\u8003\\uff0c\\u4e0d\\u53ef\\u5173\\u95ed"}}`,
    `{"error":{"message":"OpenRouter: Reasoning is mandatory for this endpoint and cannot be disabled.","type":"invalid_request_error"},"type":"error"}`,
    `{"type":"error","error":{"message":"\\"thinking.type.disabled\\" is not supported for this model. Use \\"thinking.type.adaptive\\" instead."}}`,
    `{"error":{"message":"The value of the enable_thinking parameter is restricted to True."}}`,
    `{"error":{"message":"thinking.type \`disabled\` is not supported by this model"}}`,
    NONE_REFUSED,
  ])("is read off %s", (text) => {
    expect(refusedShape({ format: "anthropic_messages", body: OFF, status: 400, text })).toBe(
      "thinkingOff",
    );
    const betweenTools = { ...OFF, thinking: { type: "between_tools" } };
    expect(
      refusedShape({ format: "anthropic_messages", body: betweenTools, status: 400, text }),
    ).toBe("thinkingOff");
  });

  test("is not read off a request that thinks, or another refusal", () => {
    const text = "GLM-5.3 always engages in thinking and cannot be disabled";
    const thinking = { ...OFF, thinking: { type: "enabled", budget_tokens: 4096 } };
    expect(
      refusedShape({ format: "anthropic_messages", body: thinking, status: 400, text }),
    ).toBeNull();
    expect(
      refusedShape({
        format: "anthropic_messages",
        body: OFF,
        status: 400,
        text: "prompt is too long: 210000 tokens > 200000",
      }),
    ).toBeNull();
  });
});

describe("remembering a refusal", () => {
  test("holds for that endpoint's model and that shape only", () => {
    const refused = new RefusedShapes();
    refused.add("ep_a", "gpt-6.1-sol", "none");

    expect(refused.has("ep_a", "gpt-6.1-sol", "none")).toBe(true);
    expect(refused.has("ep_a", "gpt-6.1-sol", "thinkingOff")).toBe(false);
    expect(refused.has("ep_a", "gpt-5.5", "none")).toBe(false);
    expect(refused.has("ep_b", "gpt-6.1-sol", "none")).toBe(false);
  });
});
