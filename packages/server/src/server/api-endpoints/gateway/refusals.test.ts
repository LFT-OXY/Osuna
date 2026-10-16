import { describe, expect, test } from "vitest";
import {
  RefusedShapes,
  askWithOneKeyHeader,
  keyHeadersFor,
  refusedShape,
  refusesBothKeyHeaders,
  refusesFormat,
  type KeyHeaders,
  type RefusedShape,
  type ShapeRefusals,
} from "./refusals.js";
import { failedBySelf, type FailedAttempt } from "./upstream-call.js";

/*
 * 上游不收的写法：effort none、关掉思考、这个格式的地址、两个认证头一起带。错误原文照 magpie（MIT，THIRD_PARTY_NOTICES）的
 * sub2api_think_off_test.go（TestRefusesThinkingOff）、gateway_test.go（含 TestWrongEndpoint）、thinking_off_test.go、
 * tools_need_responses_test.go，与 internal/provider/authheader_test.go（TestBothAuthRefused、TestRetryOneAuth*）。
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

// magpie 的 toolsOnChatRefused（#1308）与 bothRefusedZH（Aloha on Discord）。
const TOOLS_ON_CHAT_REFUSED = `{"error":{"message":"status_code=400, gpt-6.1-sol requires Responses for tool calls; this account only supports Chat Completions","type":"invalid_request_error"}}`;
const BOTH_REFUSED_ZH = `{"error":{"type":"authentication_error","message":"鉴权 header， x-api-key 和 Authorization 不可以同时存在"}}`;

describe("an address that does not serve the model in its format", () => {
  test.each([
    { status: 400, text: `{"error":{"message":"not a chat model; use /v1/responses"}}` },
    { status: 404, text: "use v1/completions" },
    {
      status: 400,
      text: `{"code":null,"message":"model \\"gpt-6-sol\\" is not accessible via the /chat/completions endpoint","type":"invalid_request_error"}`,
    },
    {
      status: 400,
      text: `{"error":{"message":"model not accessible","code":"unsupported_api_for_model"}}`,
    },
    {
      status: 400,
      text: `{"type":"error","error":{"type":"ModelError","message":"Model grok-4.7 is not supported for format anthropic"}}`,
    },
    {
      status: 400,
      text: `{"type":"error","error":{"type":"invalid_request_error","message":"Model does not support this protocol."}}`,
    },
    { status: 400, text: "no model endpoints available given user constraints\n" },
    { status: 400, text: TOOLS_ON_CHAT_REFUSED },
  ])("is read off $status $text", ({ status, text }) => {
    expect(refusesFormat({ status, text })).toBe(true);
  });

  test.each([
    {
      status: 400,
      text: `{"error":{"message":"The requested model is not supported.","code":"model_not_supported"}}`,
    },
    { status: 429, text: "rate limit" },
    { status: 500, text: "use v1/responses" },
    { status: 200, text: "use v1/responses" },
  ])("is not read off $status $text", ({ status, text }) => {
    expect(refusesFormat({ status, text })).toBe(false);
  });
});

describe("an endpoint refusing both key headers together", () => {
  test.each([
    BOTH_REFUSED_ZH,
    `{"error":"x-api-key 和 Authorization 不能同时存在"}`,
    `{"error":{"message":"x-api-key and Authorization cannot both be present"}}`,
    `{"message":"Only one of x-api-key or Authorization header may be provided"}`,
    `{"message":"Headers x-api-key and Authorization are mutually exclusive"}`,
  ])("is read off a 401 saying %s", (text) => {
    expect(refusesBothKeyHeaders({ status: 401, text })).toBe(true);
  });

  test.each([
    { status: 401, text: `{"error":{"message":"invalid x-api-key"}}` },
    { status: 401, text: `{"error":{"message":"Authorization failed"}}` },
    { status: 400, text: BOTH_REFUSED_ZH },
    { status: 403, text: BOTH_REFUSED_ZH },
  ])("is not read off $status $text", ({ status, text }) => {
    expect(refusesBothKeyHeaders({ status, text })).toBe(false);
  });
});

/** 一家接口的一个模型记住的写法，和每次记住时的写法。 */
function memory(): ShapeRefusals & { added: RefusedShape[] } {
  const refused = new Set<RefusedShape>();
  const added: RefusedShape[] = [];
  return {
    added,
    has: (shape) => refused.has(shape),
    add: (shape) => {
      refused.add(shape);
      added.push(shape);
    },
  };
}

function failed(status: number, text: string): FailedAttempt {
  return failedBySelf({ status, detail: text });
}

type Asked = FailedAttempt | { kind: "opened"; status: number };

/** 一家只收单带 `takes` 那个头的接口：两个头一起带回 BOTH_REFUSED_ZH，带错的那个回 401。 */
function oneHeaderOnly(takes: KeyHeaders) {
  const asked: KeyHeaders[] = [];
  const ask = (keys: KeyHeaders): Promise<Asked> => {
    asked.push(keys);
    if (keys === takes) return Promise.resolve({ kind: "opened", status: 200 });
    return Promise.resolve(failed(401, keys === "both" ? BOTH_REFUSED_ZH : "invalid api key"));
  };
  return { asked, ask };
}

describe("asking again with the key in one header", () => {
  test("tries x-api-key alone first and remembers it when it is taken", async () => {
    const refusals = memory();
    const upstream = oneHeaderOnly("xApiKey");
    const outcome = await askWithOneKeyHeader({
      refusals,
      sent: "both",
      failed: failed(401, BOTH_REFUSED_ZH),
      ask: upstream.ask,
    });

    expect(outcome.kind).toBe("opened");
    expect(upstream.asked).toEqual(["xApiKey"]);
    expect(refusals.added).toEqual(["bothKeyHeaders"]);
    expect(keyHeadersFor({ format: "anthropic_messages", refusals })).toBe("xApiKey");
  });

  test("goes on to Bearer alone when x-api-key alone is refused too, and remembers that", async () => {
    const refusals = memory();
    const upstream = oneHeaderOnly("bearer");
    await askWithOneKeyHeader({
      refusals,
      sent: "both",
      failed: failed(401, BOTH_REFUSED_ZH),
      ask: upstream.ask,
    });

    expect(upstream.asked).toEqual(["xApiKey", "bearer"]);
    expect(refusals.added).toEqual(["xApiKeyAlone"]);
    expect(keyHeadersFor({ format: "anthropic_messages", refusals })).toBe("bearer");
  });

  test("hands the failure back as it came for another 401, or when one header was sent already", async () => {
    const refusals = memory();
    const upstream = oneHeaderOnly("xApiKey");
    const invalid = failed(401, "invalid api key");
    const once = await askWithOneKeyHeader({
      refusals,
      sent: "both",
      failed: invalid,
      ask: upstream.ask,
    });
    const refusedAgain = failed(401, BOTH_REFUSED_ZH);
    const narrowed = await askWithOneKeyHeader({
      refusals,
      sent: "xApiKey",
      failed: refusedAgain,
      ask: upstream.ask,
    });

    expect(once).toBe(invalid);
    expect(narrowed).toBe(refusedAgain);
    expect(upstream.asked).toEqual([]);
    expect(refusals.added).toEqual([]);
  });

  test("only an Anthropic address gets both headers; OpenAI formats send Bearer", () => {
    expect(keyHeadersFor({ format: "anthropic_messages", refusals: memory() })).toBe("both");
    expect(keyHeadersFor({ format: "openai_chat", refusals: memory() })).toBe("bearer");
    expect(keyHeadersFor({ format: "openai_responses", refusals: undefined })).toBe("bearer");
  });
});
