// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/affinity.go 的 auto 模式，affinity_cache_write_test.go、affinity_silent_cache_test.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import {
  AFFINITY,
  ConversationSticks,
  affinityWhy,
  conversationId,
  turnOf,
  type AffinityInput,
  type StickUsage,
} from "./affinity.js";
import type { Effort } from "./translation/ir.js";

/*
 * 粘性照 magpie 的 auto 模式（research/magpie-port-inventory.md 第 3 节）：
 * 12 步判定逐条一例，轮次计数与对话识别各几例，再看候选怎么重排。缓存写入、悄悄缓存、1 小时缓存与推理档
 * 照 affinity_cache_write_test.go（TestAffinityKeepsACacheJustWritten、TestAffinityKeepsAnHourCachePastFiveMinutes、
 * TestHourCacheAfter）与 affinity_silent_cache_test.go 的用例。
 */

const MINUTE = 60_000;

describe("the stickiness constants", () => {
  test("are magpie's", () => {
    expect(AFFINITY).toEqual({
      cacheWorth: 1024,
      cacheCold: 5 * MINUTE,
      cacheHour: 60 * MINUTE,
      stickKeep: 24 * 60 * MINUTE,
      sticksKept: 512,
    });
  });
});

describe("whether a conversation stays with the endpoint that answered it last", () => {
  const base: AffinityInput = {
    mode: "auto",
    rotate: false,
    had: true,
    at: 1,
    resting: false,
    spent: false,
    within: false,
    cacheRead: 2048,
    cacheWrite: 0,
    hourWarm: false,
    sinceAnsweredMs: MINUTE,
  };

  test.each<[string, Partial<AffinityInput>]>([
    ["off", { mode: "off" }],
    ["first", { had: false }],
    ["gone", { at: -1 }],
    ["strict", { mode: "strict", resting: true }],
    ["resting", { resting: true }],
    ["spent", { spent: true }],
    ["session", { mode: "session" }],
    ["turn", { within: true }],
    ["new-turn", { mode: "turn" }],
    ["no-cache", { cacheRead: 1000, cacheWrite: 23 }],
    ["cold", { sinceAnsweredMs: 5 * MINUTE + 1 }],
    ["cache", {}],
  ])("%s", (why, change) => {
    expect(affinityWhy({ ...base, ...change })).toBe(why);
  });

  test("a rotating group starts a new turn elsewhere instead of reading the cache", () => {
    expect(affinityWhy({ ...base, rotate: true })).toBe("new-turn");
  });

  test("what the last answer wrote to the cache counts with what it read", () => {
    expect(affinityWhy({ ...base, cacheRead: 0, cacheWrite: 1024 })).toBe("cache");
  });

  test("past five minutes it stays while an hour's cache is still warm", () => {
    expect(affinityWhy({ ...base, sinceAnsweredMs: 30 * MINUTE, hourWarm: true })).toBe("cache");
  });

  test("an answerer still first is never spent", () => {
    expect(affinityWhy({ ...base, at: 0, spent: true })).toBe("cache");
  });
});

describe("counting the user's turns", () => {
  test("Claude: a user's words start a turn; tool results and the agent's own notes carry it on", () => {
    const body: { messages: object[] } = {
      messages: [
        { role: "user", content: "fix the bug" },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
      ],
    };
    expect(turnOf("anthropic", body)).toEqual({ turn: 1, within: true });
    body.messages.push(
      { role: "assistant", content: "done" },
      {
        role: "user",
        content: [{ type: "text", text: "<system-reminder>todo</system-reminder>" }],
      },
    );
    expect(turnOf("anthropic", body)).toEqual({ turn: 1, within: true });
    body.messages.push({ role: "user", content: [{ type: "text", text: "now the tests" }] });
    expect(turnOf("anthropic", body)).toEqual({ turn: 2, within: false });
  });

  test("Claude: an image alone is the user saying something", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "image", source: { type: "base64", data: "x" } }] },
      ],
    };
    expect(turnOf("anthropic", body)).toEqual({ turn: 1, within: false });
  });

  test("Codex: function call outputs carry the turn; a developer note after a reply is not the user", () => {
    const body: { input: object[] } = {
      input: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "rules" }] },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<environment_context>cwd</environment_context>" }],
        },
        { type: "message", role: "user", content: [{ type: "input_text", text: "list files" }] },
        { type: "function_call", call_id: "c1", name: "shell", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "a b" },
      ],
    };
    expect(turnOf("openai", body)).toEqual({ turn: 1, within: true });
    body.input.push(
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "a, b" }] },
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "model changed" }],
      },
    );
    expect(turnOf("openai", body)).toEqual({ turn: 1, within: true });
    expect(turnOf("openai", { input: "hello" })).toEqual({ turn: 1, within: false });
  });

  test("Chat: tool messages carry the turn; the user's words, or an image alone, start one", () => {
    const body: { messages: object[] } = {
      messages: [
        { role: "system", content: "You are Pi." },
        { role: "user", content: "list files" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "c1", type: "function", function: { name: "ls", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "c1", content: "a b" },
      ],
    };
    expect(turnOf("chat", body)).toEqual({ turn: 1, within: true });
    body.messages.push(
      { role: "assistant", content: "a, b" },
      { role: "user", content: [{ type: "image_url", image_url: { url: "data:x" } }] },
    );
    expect(turnOf("chat", body)).toEqual({ turn: 2, within: false });
  });
});

describe("telling conversations apart", () => {
  test("by the agent's own session header, Codex's older names included", () => {
    expect(conversationId({ "x-claude-code-session-id": "s1" }, {})).toBe("s1");
    expect(conversationId({ "thread-id": "t1", "session-id": "root" }, {})).toBe("t1");
    // Pi 的 Chat 与 Anthropic、OMP 发 x-session-affinity。
    for (const name of [
      "thread_id",
      "session-id",
      "session_id",
      "x-session-affinity",
      "x-client-request-id",
    ]) {
      expect(conversationId({ [name]: "old" }, {})).toBe("old");
    }
  });

  test("without one, by the conversation's first user message, which every later request repeats", () => {
    const first = { role: "user", content: "hi" };
    const one = conversationId({}, { messages: [{ role: "system", content: "x" }, first] });
    const later = conversationId(
      {},
      {
        messages: [
          { role: "system", content: "x" },
          first,
          { role: "assistant", content: "hello" },
          { role: "user", content: "more" },
        ],
      },
    );
    expect(one).toBe(later);
    expect(one).toMatch(/^osuna-[0-9a-f]{24}$/);
    expect(conversationId({}, { messages: [{ role: "user", content: "other" }] })).not.toBe(one);
  });
});

describe("putting the answerer back first", () => {
  interface Candidate {
    endpoint: { id: string };
    upstreamModel: string;
    effort?: Effort;
  }
  const a: Candidate = { endpoint: { id: "ep_a" }, upstreamModel: "kimi-k2" };
  const b: Candidate = { endpoint: { id: "ep_b" }, upstreamModel: "kimi-k2" };

  // 一次回复的用量；缺省只发了 10 个 token 的提示词，不读不写缓存。
  const replied = (counts: Partial<StickUsage> = {}): StickUsage => ({
    input: 10,
    cacheRead: 0,
    cacheWrite: 0,
    cacheWrite1h: 0,
    ...counts,
  });

  function sticks() {
    const clock = { now: Date.parse("2026-10-14T12:00:00Z") };
    return { store: new ConversationSticks({ now: () => clock.now }), clock };
  }

  const order = (
    store: ConversationSticks,
    input: { within: boolean; resting?: (c: Candidate) => boolean },
  ) =>
    store.order({
      key: "claude|kimi-k2|s1",
      candidates: [a, b],
      within: input.within,
      resting: input.resting ?? (() => false),
    });

  test("within a turn the endpoint that took over keeps it; a new turn goes back to the user's choice", () => {
    const { store } = sticks();
    expect(order(store, { within: false })).toEqual([a, b]);
    store.answered("claude|kimi-k2|s1", { endpointId: "ep_b", model: "kimi-k2", usage: replied() });
    expect(order(store, { within: true })).toEqual([b, a]);
    expect(order(store, { within: false })).toEqual([a, b]);
  });

  test("a new turn stays where the cache is warm, until it goes cold", () => {
    const { store, clock } = sticks();
    store.answered("claude|kimi-k2|s1", {
      endpointId: "ep_b",
      model: "kimi-k2",
      usage: replied({ cacheRead: 1024 }),
    });
    clock.now += 4 * MINUTE;
    expect(order(store, { within: false })).toEqual([b, a]);
    clock.now += 2 * MINUTE;
    expect(order(store, { within: false })).toEqual([a, b]);
  });

  test("not to an endpoint cooling down", () => {
    const { store } = sticks();
    store.answered("claude|kimi-k2|s1", { endpointId: "ep_b", model: "kimi-k2", usage: replied() });
    expect(order(store, { within: true, resting: (c) => c === b })).toEqual([a, b]);
  });

  test("forgets a conversation after a day, and keeps at most 512", () => {
    const { store, clock } = sticks();
    store.answered("claude|kimi-k2|s1", { endpointId: "ep_b", model: "kimi-k2", usage: replied() });
    clock.now += 24 * 60 * MINUTE + 1;
    expect(order(store, { within: true })).toEqual([a, b]);

    store.answered("claude|kimi-k2|s1", { endpointId: "ep_b", model: "kimi-k2", usage: replied() });
    for (let i = 0; i < AFFINITY.sticksKept; i++) {
      store.answered(`other-${i}`, { endpointId: "ep_b", model: "kimi-k2", usage: replied() });
    }
    expect(order(store, { within: true })).toEqual([a, b]);
  });
  const newTurn = (store: ConversationSticks) => order(store, { within: false });

  test("a first turn that only wrote the cache stays for the next to read it", () => {
    const { store, clock } = sticks();
    store.answered("claude|kimi-k2|s1", {
      endpointId: "ep_b",
      model: "kimi-k2",
      usage: replied({ cacheWrite: 3000 }),
    });
    clock.now += 4 * MINUTE;
    expect(newTurn(store)).toEqual([b, a]);
  });

  test("a vendor that caches without saying so: the prompt it was sent counts as written", () => {
    const { store } = sticks();
    store.answered("claude|kimi-k2|s1", {
      endpointId: "ep_b",
      model: "kimi-k2",
      usage: replied({ input: 3000 }),
    });
    expect(newTurn(store)).toEqual([b, a]);
    store.answered("claude|kimi-k2|s1", {
      endpointId: "ep_b",
      model: "kimi-k2",
      usage: replied({ input: 600 }),
    });
    expect(newTurn(store)).toEqual([a, b]);
  });

  test("an hour's cache stays warm past five minutes, until the hour is up", () => {
    const { store, clock } = sticks();
    store.answered("claude|kimi-k2|s1", {
      endpointId: "ep_b",
      model: "kimi-k2",
      usage: replied({ cacheWrite: 3000, cacheWrite1h: 3000 }),
    });
    clock.now += 59 * MINUTE;
    expect(newTurn(store)).toEqual([b, a]);
    clock.now += 2 * MINUTE;
    expect(newTurn(store)).toEqual([a, b]);
  });

  test.each([
    ["a five-minute write", 0],
    ["too little for an hour", 500],
  ])("%s goes cold at five minutes", (_name, cacheWrite1h) => {
    const { store, clock } = sticks();
    store.answered("claude|kimi-k2|s1", {
      endpointId: "ep_b",
      model: "kimi-k2",
      usage: replied({ cacheWrite: 3000, cacheWrite1h }),
    });
    clock.now += 6 * MINUTE;
    expect(newTurn(store)).toEqual([a, b]);
  });

  test("reading all of an hour's cache keeps it another hour; reading less of it ends it", () => {
    const { store, clock } = sticks();
    const answer = (usage: StickUsage) =>
      store.answered("claude|kimi-k2|s1", { endpointId: "ep_b", model: "kimi-k2", usage });
    answer(replied({ cacheRead: 2000, cacheWrite: 3000, cacheWrite1h: 3000 }));
    clock.now += 40 * MINUTE;
    answer(replied({ cacheRead: 5200, cacheWrite: 300 }));
    clock.now += 59 * MINUTE;
    expect(newTurn(store)).toEqual([b, a]);

    answer(replied({ cacheRead: 1000, cacheWrite: 4000 }));
    clock.now += 6 * MINUTE;
    expect(newTurn(store)).toEqual([a, b]);
  });

  test("an hour's cache is the endpoint's, of its model: another answerer starts without it", () => {
    const { store, clock } = sticks();
    store.answered("claude|kimi-k2|s1", {
      endpointId: "ep_a",
      model: "kimi-k2",
      usage: replied({ cacheWrite: 3000, cacheWrite1h: 3000 }),
    });
    store.answered("claude|kimi-k2|s1", {
      endpointId: "ep_b",
      model: "kimi-k2",
      usage: replied({ cacheRead: 3000 }),
    });
    clock.now += 6 * MINUTE;
    expect(newTurn(store)).toEqual([a, b]);
  });

  test("two conversations at different reasoning levels each stay with the level that answered", () => {
    const { store } = sticks();
    const high: Candidate = { endpoint: { id: "ep_a" }, upstreamModel: "kimi-k2", effort: "high" };
    const low: Candidate = { endpoint: { id: "ep_a" }, upstreamModel: "kimi-k2", effort: "low" };
    const candidates = [high, low, b];
    const within = (key: string) =>
      store.order({ key, candidates, within: true, resting: () => false });
    store.answered("s-low", {
      endpointId: "ep_a",
      model: "kimi-k2",
      effort: "low",
      usage: replied(),
    });
    store.answered("s-high", {
      endpointId: "ep_a",
      model: "kimi-k2",
      effort: "high",
      usage: replied(),
    });

    expect(within("s-low")).toEqual([low, high, b]);
    expect(within("s-high")).toEqual([high, low, b]);
  });

  test("an answerer's level gone, it stays with its model, then with its endpoint", () => {
    const { store } = sticks();
    const other: Candidate = { endpoint: { id: "ep_b" }, upstreamModel: "glm-4.6" };
    store.answered("s1", { endpointId: "ep_b", model: "kimi-k2", effort: "max", usage: replied() });
    const within = (candidates: Candidate[]) =>
      store.order({ key: "s1", candidates, within: true, resting: () => false });

    expect(within([a, other, b])).toEqual([b, a, other]);
    expect(within([a, other])).toEqual([other, a]);
  });
});
