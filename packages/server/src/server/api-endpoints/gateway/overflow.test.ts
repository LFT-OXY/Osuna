// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/fallback.go 的 tooLongUnsaid、roomy 注释里的厂商原话与 overflow_cap_test.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import type { StoredApiEndpoint } from "../store.js";
import { largerWindows, overflowOf, roomyCandidates } from "./overflow.js";
import type { GatewayCandidate } from "./routing.js";

function candidate(slug: string): GatewayCandidate {
  const endpoint: StoredApiEndpoint = {
    id: `ep_${slug}`,
    slug,
    name: slug.toUpperCase(),
    baseUrls: [{ format: "anthropic_messages", url: `https://${slug}.example` }],
    models: [{ id: "kimi-k2" }],
    enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
  return { endpoint, upstreamModel: "kimi-k2" };
}

const small = candidate("small");
const big = candidate("big");
const unknown = candidate("unknown");
const WINDOWS: Record<string, number> = { small: 4096, big: 1_000_000 };
const windowOf = (of: GatewayCandidate) => WINDOWS[of.endpoint.slug];

describe("candidates skipped before any is asked", () => {
  test("one known too small for the request is left out; one whose window is unknown stays", () => {
    expect(roomyCandidates({ plan: [small, unknown, big], tokens: 5000, windowOf })).toEqual({
      plan: [unknown, big],
      skipped: [small],
    });
  });

  test("a request exactly the window's size does not fit (magpie: tokens >= window)", () => {
    expect(roomyCandidates({ plan: [small, big], tokens: 4096, windowOf })).toEqual({
      plan: [big],
      skipped: [small],
    });
  });

  test.each([
    { case: "no estimate", plan: [small, big], tokens: null },
    { case: "every one holds it", plan: [small, big], tokens: 100 },
    {
      case: "none holds it: the first is asked, the agent told to compact",
      plan: [small],
      tokens: 5000,
    },
  ])("nothing is left out with $case", ({ plan, tokens }) => {
    expect(roomyCandidates({ plan, tokens, windowOf })).toEqual({ plan, skipped: [] });
  });
});

describe("where a conversation too long for one endpoint goes", () => {
  test("only to those after it whose known window is larger and holds the estimate", () => {
    expect(
      largerWindows({ left: [unknown, small, big], window: 4096, tokens: 5000, windowOf }),
    ).toEqual([big]);
  });

  test("a larger window still past the estimate is not gone to", () => {
    expect(largerWindows({ left: [big], window: 4096, tokens: 2_000_000, windowOf })).toEqual([]);
  });

  test("with the refusing endpoint's window unknown, nowhere: the sizes can't be compared", () => {
    expect(largerWindows({ left: [big], window: undefined, tokens: null, windowOf })).toEqual([]);
  });
});

describe("whether a failure was the conversation being too long", () => {
  const base = {
    tokens: 5000,
    window: 4096,
    model: "kimi-k2",
    endpointName: "WorkBuddy",
  };

  test("the vendor saying so, its own input cap too (magpie #2445)", () => {
    const capped = '{"error":{"message":"Input token exceed the limit (request id: 2026…)"}}';
    expect(overflowOf({ ...base, status: 400, text: capped, detail: "x" })).toEqual({
      kind: "said",
    });
  });

  test("a 400 saying no reason, past 1.2 times the window, with the vendor's words", () => {
    expect(
      overflowOf({
        ...base,
        status: 400,
        text: '{"error":{"message":"Invalid request parameters"}}',
        detail: "Invalid request parameters",
      }),
    ).toEqual({
      kind: "unsaid",
      message:
        "prompt is too long: about 5000 tokens, more than kimi-k2's context window of 4096 (WorkBuddy answered 400: Invalid request parameters)",
    });
  });

  test("the vendor's words left out when they would read as a limit of another kind", () => {
    expect(
      overflowOf({ ...base, status: 502, text: "capacity issues", detail: "max_tokens too big" }),
    ).toEqual({
      kind: "unsaid",
      message:
        "prompt is too long: about 5000 tokens, more than kimi-k2's context window of 4096 (WorkBuddy answered 502)",
    });
  });

  test.each([
    { case: "under 1.2 times the window", tokens: 4900, window: 4096, text: "Invalid request" },
    { case: "the window unknown", tokens: 5000, window: undefined, text: "Invalid request" },
    { case: "no estimate", tokens: null, window: 4096, text: "Invalid request" },
    { case: "a rate limit", tokens: 5000, window: 4096, text: "rate limit, try again later" },
    { case: "a model it doesn't serve", tokens: 5000, window: 4096, text: "model_not_found" },
    {
      case: "a region it doesn't serve",
      tokens: 5000,
      window: 4096,
      text: "unsupported_country_region_territory",
    },
  ])("not with $case", ({ tokens, window, text }) => {
    expect(overflowOf({ ...base, status: 400, tokens, window, text, detail: text })).toBeNull();
  });

  test("not for a status that isn't a request or server error", () => {
    expect(
      overflowOf({ ...base, status: 401, text: "Invalid request", detail: "Invalid request" }),
    ).toBeNull();
  });
});
