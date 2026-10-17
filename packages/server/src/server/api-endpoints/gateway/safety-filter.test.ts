// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/refusal_error_test.go、refusal_accounts_test.go、refusal_details_test.go 与 refusal_test.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import type { TappedReply } from "./reply-tap.js";
import { HIGH_RISK_REFUSAL, errorRefusal, replyRefusal, saysRefusal } from "./safety-filter.js";
import { emptyUsage } from "./translation/ir.js";

const BIO_POLICY = `{"error":{"type":"invalid_request_error","code":"bio_policy","message":"This content was flagged for possible biological risk. If this seems wrong, try rephrasing your request.","param":null}}`;

describe("a refusal said as an error (magpie policyRefusal)", () => {
  test.each([
    {
      body: BIO_POLICY,
      note: "safety filter: bio_policy — This content was flagged for possible biological risk. If this seems wrong, try rephrasing your request.",
    },
    {
      body: `{"type":"invalid_request_error","code":"bio_policy","message":"flagged"}`,
      note: "safety filter: bio_policy — flagged",
    },
    {
      body: `{"error":{"code":"cyber_policy","message":"x"}}`,
      note: "safety filter: cyber_policy — x",
    },
    {
      body: `{"error":{"code":"content_filter","message":"The response was filtered","innererror":{"code":"ResponsibleAIPolicyViolation"}}}`,
      note: "safety filter: content_filter — The response was filtered",
    },
    {
      body: `{"error":{"code":"invalid_prompt","message":"Invalid prompt: your prompt was flagged as potentially violating our usage policy."}}`,
      note: "safety filter: invalid_prompt — Invalid prompt: your prompt was flagged as potentially violating our usage policy.",
    },
    {
      body: `{"error":{"type":"content_policy_violation"}}`,
      note: "safety filter: content_filter",
    },
  ])("$body is a refusal", ({ body, note }) => {
    expect(errorRefusal(body)).toBe(note);
  });

  test.each([
    `{"error":{"code":"invalid_prompt","message":"Invalid prompt: missing field"}}`,
    `{"error":{"type":"invalid_request_error","message":"max_tokens: too large"}}`,
    "not json",
  ])("%s is not", (body) => {
    expect(errorRefusal(body)).toBeNull();
  });

  test("the high risk sentence is a refusal only as an error's whole message", () => {
    const said = `safety filter: high risk — ${HIGH_RISK_REFUSAL}`;
    for (const message of [HIGH_RISK_REFUSAL, ` \n${HIGH_RISK_REFUSAL}\n`]) {
      expect(errorRefusal(JSON.stringify({ error: { message } }))).toBe(said);
    }
    for (const message of [
      "high risk",
      `not ${HIGH_RISK_REFUSAL}`,
      `${HIGH_RISK_REFUSAL}; please explain this message`,
      `The server quoted "${HIGH_RISK_REFUSAL}"`,
      "invalid API key",
    ]) {
      expect(errorRefusal(JSON.stringify({ error: { message } }))).toBeNull();
    }
  });

  test("each stream error shape carrying it is read: error, its data alone, a typed error, response.failed", () => {
    const said = `safety filter: high risk — ${HIGH_RISK_REFUSAL}`;
    for (const data of [
      { error: { message: HIGH_RISK_REFUSAL } },
      { message: HIGH_RISK_REFUSAL },
      { type: "error", error: { type: "invalid_request_error", message: HIGH_RISK_REFUSAL } },
      { type: "response.failed", response: { error: { message: HIGH_RISK_REFUSAL } } },
    ]) {
      expect(errorRefusal(JSON.stringify(data))).toBe(said);
    }
    expect(
      errorRefusal(
        JSON.stringify({ type: "error", error: { code: "content_filter", message: "filtered" } }),
      ),
    ).toBe("safety filter: content_filter — filtered");
  });

  test("a decoded error is a refusal by its code or its whole message", () => {
    expect(saysRefusal({ code: "content_filter", message: "filtered" })).toBe(true);
    expect(saysRefusal({ code: null, message: HIGH_RISK_REFUSAL })).toBe(true);
    expect(saysRefusal({ code: "overloaded_error", message: "Overloaded" })).toBe(false);
  });
});

describe("a reply that ended in a refusal with nothing said (magpie refusedReply, refusedDetail)", () => {
  const refused = (reply: Partial<TappedReply>): TappedReply => ({
    content: [],
    stop: "filter",
    ended: true,
    error: null,
    usage: emptyUsage(),
    ...reply,
  });

  test.each([
    {
      case: "category and explanation",
      details: {
        type: "refusal",
        category: "cyber",
        explanation: "This request was declined because it could enable cyber harm.",
      },
      note: "safety filter: refusal (category cyber: This request was declined because it could enable cyber harm.)",
    },
    {
      case: "a category unknown today",
      details: { type: "refusal", category: "frontier_llm_v2", explanation: null },
      note: "safety filter: refusal (category frontier_llm_v2)",
    },
    {
      case: "nulls",
      details: { type: "refusal", category: null, explanation: null },
      note: "safety filter: refusal",
    },
    { case: "none", details: undefined, note: "safety filter: refusal" },
  ])("Anthropic, $case", ({ details, note }) => {
    const reply = refused(details ? { stopDetails: details } : {});
    expect(replyRefusal(reply, "anthropic_messages")).toBe(note);
  });

  test("an explanation is kept to a line", () => {
    const reply = refused({
      stopDetails: { category: "general_harms", explanation: "x".repeat(1000) },
    });
    expect(replyRefusal(reply, "anthropic_messages")).toBe(
      `safety filter: refusal (category general_harms: ${"x".repeat(200)}…)`,
    );
  });

  test("Chat and Responses say content_filter", () => {
    expect(replyRefusal(refused({}), "openai_chat")).toBe("safety filter: content_filter");
    expect(replyRefusal(refused({}), "openai_responses")).toBe("safety filter: content_filter");
  });

  test("a reply that said something, or stopped for another reason, is not a refusal", () => {
    expect(replyRefusal(refused({ content: ["text"] }), "openai_chat")).toBeNull();
    expect(replyRefusal(refused({ stop: "length" }), "openai_responses")).toBeNull();
  });
});
