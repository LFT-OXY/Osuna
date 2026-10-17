// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/continuation_test.go 的 TestChatPrefill、TestPrefillHow、TestContinuationUnecho、TestBuildChatResumePrefillMarks、TestStreamCutTrimsPrefillWhitespace）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import {
  ReplySoFar,
  continuationUrl,
  prefillMode,
  withPrefillMark,
  type PrefillMode,
} from "./continuation.js";
import type { ShapeRefusals } from "./refusals.js";
import type { Message, StreamEvent } from "./translation/ir.js";

const NO_REFUSALS: ShapeRefusals = { has: () => false, add: () => {} };
const PREFILL_REFUSED: ShapeRefusals = { has: (shape) => shape === "prefill", add: () => {} };

describe("how an upstream goes on from the part of a reply sent back (magpie prefillHow, chatPrefill)", () => {
  test.each([
    { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", mode: "prefix" },
    { baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k3", mode: "partial" },
    { baseUrl: "https://api.moonshot.ai/v1", model: "kimi-k3", mode: "partial" },
    { baseUrl: "https://api.kimi.ai/v1", model: "kimi-for-coding", mode: "partial" },
    { baseUrl: "https://api.openai.com/v1", model: "gpt-5", mode: null },
    // 别处的中转服务不当作在转这家。
    { baseUrl: "https://openrouter.ai/api/v1", model: "moonshotai/kimi-k3", mode: null },
    { baseUrl: "https://relay.example.com/v1", model: "kimi-k3", mode: null },
    { baseUrl: "http://127.0.0.1:8080/v1", model: "kimi-k3", mode: "partial" },
    { baseUrl: "http://127.0.0.1:8080/v1", model: "deepseek-chat", mode: "prefix" },
    { baseUrl: "http://[::1]:8080/v1", model: "kimi-k3", mode: "partial" },
    { baseUrl: "http://192.168.1.5:8080/v1", model: "kimi-k3", mode: "partial" },
    { baseUrl: "http://localhost:8317/v1", model: "kimi-for-coding", mode: "partial" },
    { baseUrl: "http://127.0.0.1:8080/v1", model: "gpt-5", mode: null },
  ])("a Chat upstream at $baseUrl serving $model: $mode", ({ baseUrl, model, mode }) => {
    expect(prefillMode({ to: "openai_chat", baseUrl, model, refusals: NO_REFUSALS })).toBe(mode);
  });

  test("an Anthropic upstream natively, a Responses one not at all", () => {
    const baseUrl = "https://api.moonshot.cn";
    const ask = { baseUrl, model: "kimi-k3", refusals: NO_REFUSALS };
    expect(prefillMode({ ...ask, to: "anthropic_messages" })).toBe("anthropic");
    expect(prefillMode({ ...ask, to: "openai_responses" })).toBeNull();
  });

  test("a model that turned a prefill away is not asked to go on", () => {
    const ask = { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" };
    const refused = { ...ask, refusals: PREFILL_REFUSED };
    expect(prefillMode({ ...refused, to: "openai_chat" })).toBeNull();
    expect(prefillMode({ ...refused, to: "anthropic_messages" })).toBeNull();
  });
});

describe("where a continuation is asked", () => {
  test("DeepSeek's prefix mode is served under /beta beside the base's /v1", () => {
    const at = continuationUrl({
      baseUrl: "https://api.deepseek.com/v1",
      to: "openai_chat",
      mode: "prefix",
    });
    expect(at.href).toBe("https://api.deepseek.com/beta/chat/completions");
  });

  test.each<{ mode: PrefillMode; baseUrl: string; href: string }>([
    {
      mode: "partial",
      baseUrl: "https://api.moonshot.cn/v1",
      href: "https://api.moonshot.cn/v1/chat/completions",
    },
    {
      mode: "anthropic",
      baseUrl: "https://api.anthropic.com",
      href: "https://api.anthropic.com/v1/messages",
    },
  ])("$mode goes to the usual address", ({ mode, baseUrl, href }) => {
    const to = mode === "anthropic" ? "anthropic_messages" : "openai_chat";
    expect(continuationUrl({ baseUrl, to, mode }).href).toBe(href);
  });
});

describe("the Chat prefill mark (magpie buildChat with Resume)", () => {
  const body = {
    model: "m",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hel" },
    ],
  };

  test("DeepSeek's prefix and Kimi's partial go on the last message, with the reasoning", () => {
    expect(withPrefillMark({ body, mode: "prefix", thinking: "think-1" })).toEqual({
      model: "m",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hel", prefix: true, reasoning_content: "think-1" },
      ],
    });
    expect(withPrefillMark({ body, mode: "partial", thinking: "" })).toEqual({
      model: "m",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hel", partial: true },
      ],
    });
  });

  test("an Anthropic continuation needs no mark", () => {
    expect(withPrefillMark({ body, mode: "anthropic", thinking: "think-1" })).toBe(body);
  });
});

/** 一个 ReplySoFar 和它往下交的事件。 */
interface SoFarPassing {
  soFar: ReplySoFar;
  passed: StreamEvent[];
}

function soFarPassing(): SoFarPassing {
  const passed: StreamEvent[] = [];
  return { soFar: new ReplySoFar((event) => passed.push(event)), passed };
}

function feed(soFar: ReplySoFar, events: StreamEvent[]): void {
  for (const event of events) soFar.event(event);
}

function texts(chunks: string[]): StreamEvent[] {
  return chunks.map((text) => ({ kind: "text", text }));
}

/** 已经交给 Agent 的是 `prefilled`，接着写的这一次说了 `chunks`。 */
function continuedWith(input: { prefilled: string; chunks: string[] }): string {
  const { soFar, passed } = soFarPassing();
  feed(soFar, texts([input.prefilled]));
  soFar.resume({ messages: [] });
  passed.length = 0;
  feed(soFar, texts(input.chunks));
  return passed.map((event) => (event.kind === "text" ? event.text : "")).join("");
}

describe("what the agent already has of a reply (magpie continuation)", () => {
  test("it can go on once something was said and no tool call began", () => {
    const { soFar } = soFarPassing();
    expect(soFar.canGoOn()).toBe(false);
    feed(soFar, texts(["hel"]));
    expect(soFar.canGoOn()).toBe(true);
    feed(soFar, [{ kind: "tool_start", id: "call_1", name: "Bash" }]);
    expect(soFar.canGoOn()).toBe(false);
  });

  test("a reply that ended as a refusal does not go on", () => {
    const { soFar } = soFarPassing();
    feed(soFar, [...texts(["hel"]), { kind: "stop", stop: "filter" }]);
    expect(soFar.canGoOn()).toBe(false);
  });

  test("thinking alone is something to go on from", () => {
    const { soFar } = soFarPassing();
    feed(soFar, [{ kind: "think", text: "hmm" }]);
    expect(soFar.canGoOn()).toBe(true);
  });

  test("the continuation carries the thinking and the text, trailing whitespace trimmed", () => {
    const { soFar } = soFarPassing();
    feed(soFar, [
      { kind: "think", text: "think-1" },
      { kind: "text", text: "hel\n" },
    ]);
    const messages: Message[] = [{ role: "user", parts: [{ kind: "text", text: "hi" }] }];
    const asked = { messages };
    expect(soFar.resume(asked)).toEqual({
      messages: [
        { role: "user", parts: [{ kind: "text", text: "hi" }] },
        {
          role: "assistant",
          parts: [
            { kind: "thinking", text: "think-1", signature: "" },
            { kind: "text", text: "hel" },
          ],
        },
      ],
    });
  });

  test("a continuation's thinking is not shown again", () => {
    const { soFar, passed } = soFarPassing();
    feed(soFar, texts(["hel"]));
    soFar.resume({ messages: [] });
    passed.length = 0;
    feed(soFar, [
      { kind: "think_start" },
      { kind: "think", text: "again" },
      { kind: "sig", text: "sig" },
      { kind: "text", text: "lo" },
    ]);
    expect(passed).toEqual([{ kind: "text", text: "lo" }]);
  });

  test.each([
    { prefilled: "hel", chunks: ["lo"], passed: "lo" },
    { prefilled: "hel", chunks: ["hel", "lo"], passed: "lo" },
    { prefilled: "hel", chunks: ["h", "e", "llo"], passed: "lo" },
    { prefilled: "hel", chunks: ["he", "lp"], passed: "p" },
    { prefilled: "hel", chunks: ["x", "yz"], passed: "xyz" },
    { prefilled: "hel", chunks: ["hel"], passed: "" },
    { prefilled: "hel", chunks: ["he"], passed: "" },
  ])(
    "prefilled with $prefilled, a continuation saying $chunks passes $passed",
    ({ prefilled, chunks, passed }) => {
      expect(continuedWith({ prefilled, chunks })).toBe(passed);
    },
  );
});
