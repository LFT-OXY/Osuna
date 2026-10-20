// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway 的 sub2api_think_off_test.go、gateway_test.go、thinking_off_test.go、tools_need_responses_test.go、prefill_test.go，internal/provider/authheader_test.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import {
  RefusedShapes,
  askRefitted,
  askWithOneKeyHeader,
  keyHeadersFor,
  noteRefusal,
  refusedShape,
  refusesPrefill,
  refusesBothKeyHeaders,
  refusesFormat,
  type KeyHeaders,
  type RefusedShape,
  type ShapeRefusals,
} from "./refusals.js";
import { failedBySelf, type FailedAttempt } from "./upstream-call.js";
import { NO_REQUEST_EXTRAS } from "../request-extras.js";

const RELAY = "https://relay.example";

/*
 * 上游不收的写法：effort none、关掉思考、这个格式的地址、两个认证头一起带。错误原文照 magpie 的
 * sub2api_think_off_test.go（TestRefusesThinkingOff）、gateway_test.go（含 TestWrongEndpoint）、thinking_off_test.go、
 * tools_need_responses_test.go，与 internal/provider/authheader_test.go（TestBothAuthRefused、TestRetryOneAuth*）；
 * 预填的拒绝照 prefill_test.go 的 openCodeGoPrefillRefusal。
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
  test("holds for that endpoint's model, that format and that shape only", () => {
    const refused = new RefusedShapes();
    const at = (input: {
      endpointId?: string;
      model?: string;
      format?: "openai_chat" | "openai_responses";
      shape?: "none" | "thinkingOff" | "cacheKey";
    }) => ({
      endpointId: input.endpointId ?? "ep_a",
      model: input.model ?? "gpt-6.1-sol",
      format: input.format ?? "openai_chat",
      shape: input.shape ?? "none",
    });
    refused.add(at({}));
    refused.add(at({ shape: "cacheKey" }));

    expect(refused.has(at({}))).toBe(true);
    expect(refused.has(at({ shape: "thinkingOff" }))).toBe(false);
    expect(refused.has(at({ model: "gpt-5.5" }))).toBe(false);
    expect(refused.has(at({ endpointId: "ep_b" }))).toBe(false);
    // 在 Chat 上不收的字段，同一家同一模型的 Responses 照常发（magpie 的 fits 按协议记）。
    expect(refused.has(at({ format: "openai_responses", shape: "cacheKey" }))).toBe(false);
  });

  test("a format's own refusal is kept for the endpoint's model whatever format asks", () => {
    const refused = new RefusedShapes();
    const shape = "format:openai_chat" as const;
    refused.add({ endpointId: "ep_a", model: "glm-5", format: "openai_chat", shape });
    expect(refused.has({ endpointId: "ep_a", model: "glm-5", format: null, shape })).toBe(true);
    refused.forget({ endpointId: "ep_a", model: "glm-5", shapes: [shape] });
    expect(refused.has({ endpointId: "ep_a", model: "glm-5", format: null, shape })).toBe(false);
  });

  test("a refused prefill can be looked up for that endpoint's model only", () => {
    const refused = new RefusedShapes();
    const of = (endpointId: string, model: string): ShapeRefusals => ({
      has: (shape) => refused.has({ endpointId, model, format: "openai_chat", shape }),
      add: (shape) => refused.add({ endpointId, model, format: "openai_chat", shape }),
    });
    const body = {
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
    };

    const noted = noteRefusal({
      refusals: of("ep_a", "claude-sonnet-4-6"),
      format: "openai_chat",
      body,
      failed: { status: 400, text: PREFILL_REFUSED },
    });

    expect(noted).toBe(true);
    expect(refusesPrefill(of("ep_a", "claude-sonnet-4-6"))).toBe(true);
    expect(refusesPrefill(of("ep_a", "claude-opus-4-8"))).toBe(false);
    expect(refusesPrefill(of("ep_b", "claude-sonnet-4-6"))).toBe(false);
  });
});

const PREFILL_REFUSED = `{"type":"error","error":{"type":"api_error","message":"Upstream request failed: [invalid_request_error] This model does not support assistant message prefill. The conversation must end with a user message."}}`;

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
      extras: NO_REQUEST_EXTRAS,
      failed: failed(401, BOTH_REFUSED_ZH),
      ask: upstream.ask,
    });

    expect(outcome.kind).toBe("opened");
    expect(upstream.asked).toEqual(["xApiKey"]);
    expect(refusals.added).toEqual(["bothKeyHeaders"]);
    expect(
      keyHeadersFor({
        format: "anthropic_messages",
        templateId: undefined,
        baseUrl: RELAY,
        extras: NO_REQUEST_EXTRAS,
        refusals,
      }),
    ).toBe("xApiKey");
  });

  test("goes on to Bearer alone when x-api-key alone is refused too, and remembers that", async () => {
    const refusals = memory();
    const upstream = oneHeaderOnly("bearer");
    await askWithOneKeyHeader({
      refusals,
      sent: "both",
      extras: NO_REQUEST_EXTRAS,
      failed: failed(401, BOTH_REFUSED_ZH),
      ask: upstream.ask,
    });

    expect(upstream.asked).toEqual(["xApiKey", "bearer"]);
    expect(refusals.added).toEqual(["xApiKeyAlone"]);
    expect(
      keyHeadersFor({
        format: "anthropic_messages",
        templateId: undefined,
        baseUrl: RELAY,
        extras: NO_REQUEST_EXTRAS,
        refusals,
      }),
    ).toBe("bearer");
  });

  test("hands the failure back as it came for another 401, or when one header was sent already", async () => {
    const refusals = memory();
    const upstream = oneHeaderOnly("xApiKey");
    const invalid = failed(401, "invalid api key");
    const once = await askWithOneKeyHeader({
      refusals,
      sent: "both",
      extras: NO_REQUEST_EXTRAS,
      failed: invalid,
      ask: upstream.ask,
    });
    const refusedAgain = failed(401, BOTH_REFUSED_ZH);
    const narrowed = await askWithOneKeyHeader({
      refusals,
      sent: "xApiKey",
      extras: NO_REQUEST_EXTRAS,
      failed: refusedAgain,
      ask: upstream.ask,
    });

    expect(once).toBe(invalid);
    expect(narrowed).toBe(refusedAgain);
    expect(upstream.asked).toEqual([]);
    expect(refusals.added).toEqual([]);
  });

  test("only an Anthropic address gets both headers; OpenAI formats send Bearer", () => {
    expect(
      keyHeadersFor({
        format: "anthropic_messages",
        templateId: undefined,
        baseUrl: RELAY,
        extras: NO_REQUEST_EXTRAS,
        refusals: memory(),
      }),
    ).toBe("both");
    expect(
      keyHeadersFor({
        format: "openai_chat",
        templateId: undefined,
        baseUrl: RELAY,
        extras: NO_REQUEST_EXTRAS,
        refusals: memory(),
      }),
    ).toBe("bearer");
    expect(
      keyHeadersFor({
        format: "openai_responses",
        templateId: undefined,
        baseUrl: RELAY,
        extras: NO_REQUEST_EXTRAS,
        refusals: undefined,
      }),
    ).toBe("bearer");
  });

  test("a key header the user picked wins on a third-party Anthropic address only", () => {
    const refusals = memory();
    refusals.add("bothKeyHeaders");
    const bearer = { ...NO_REQUEST_EXTRAS, keyHeader: "bearer" as const };
    const anthropic = { format: "anthropic_messages" as const, templateId: undefined, refusals };
    expect(keyHeadersFor({ ...anthropic, baseUrl: RELAY, extras: bearer })).toBe("bearer");
    // Anthropic 自己的地址不看这一项，照通常的规则。
    expect(
      keyHeadersFor({ ...anthropic, baseUrl: "https://api.anthropic.com", extras: bearer }),
    ).toBe("xApiKey");
  });

  test("does not ask again with one header when the user wrote an auth header of their own", async () => {
    const refusals = memory();
    const upstream = oneHeaderOnly("xApiKey");
    const own = failed(401, BOTH_REFUSED_ZH);
    const outcome = await askWithOneKeyHeader({
      refusals,
      sent: "both",
      extras: { ...NO_REQUEST_EXTRAS, headers: { "X-Api-Key": "mine" } },
      failed: own,
      ask: upstream.ask,
    });
    expect(outcome).toBe(own);
    expect(upstream.asked).toEqual([]);
  });
});

describe("a refusal is not a rejected shape", () => {
  const sent = JSON.stringify({ reasoning: { effort: "none" } });
  const asking = () => {
    const bodies: string[] = [];
    const ask = (body: string) => {
      bodies.push(body);
      return Promise.resolve(failed(500, "upstream busy"));
    };
    return { bodies, ask };
  };

  test("a refusal whose words also name a rejected shape is handed back as it came, nothing asked again or recorded", async () => {
    const refusals = memory();
    const upstream = asking();
    const refused: FailedAttempt = {
      ...failed(400, NONE_REFUSED),
      cause: "refused",
      handBack: null,
    };

    const asked = await askRefitted({
      refusals,
      format: "openai_responses",
      sent,
      outcome: refused,
      refit: () => JSON.stringify({ reasoning: { effort: "low" } }),
      ask: upstream.ask,
    });

    expect(asked).toEqual({ outcome: refused, sent });
    expect(upstream.bodies).toEqual([]);
    expect(refusals.added).toEqual([]);
  });

  test("the same words as an error are a rejected shape: recorded and asked again", async () => {
    const refusals = memory();
    const upstream = asking();

    await askRefitted({
      refusals,
      format: "openai_responses",
      sent,
      outcome: failed(400, NONE_REFUSED),
      refit: () => JSON.stringify({ reasoning: { effort: "low" } }),
      ask: upstream.ask,
    });

    expect(upstream.bodies).toEqual(['{"reasoning":{"effort":"low"}}']);
    expect(refusals.added).toEqual(["none"]);
  });
});
