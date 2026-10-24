import { describe, expect, test } from "vitest";
import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { ReplyClock } from "./reply-clock.js";

/*
 * 交给 Agent 的回复怎么计时（magpie internal/gateway/ttft.go）：事件的时刻显式给出，结果每次一样。
 */

const TEXT = (text: string) => ({ kind: "text" as const, text });
const THINK = (text: string) => ({ kind: "think" as const, text });

describe("timing a reply as it goes to the agent", () => {
  test("a reply that came evenly has a flow about its window", () => {
    const clock = clockFor("anthropic_messages");
    clock.at(900).saw({ kind: "start", id: "msg_1", usage: emptyUsage() });
    for (let i = 0; i <= 10; i += 1) clock.at(1000 + i * 100).saw(TEXT("abcdefgh"));
    const times = clock.clock.times({ reasoning: 0 });
    expect(times.firstContentAt).toBe(1000);
    expect(times.firstTextAt).toBe(1000);
    // 10% 到 90% 的内容用了 800ms，放大到整份是 1000ms。
    expect(times.flowMs).toBe(1000);
    expect(times.firstReasoningAt).toBeNull();
    expect(times.reasoningHidden).toBe(false);
  });

  test("a reply held and let go in one burst has next to no flow", () => {
    const clock = clockFor("anthropic_messages");
    clock.at(1000).saw(TEXT("a"));
    clock.at(1600).saw(TEXT("x".repeat(2000)));
    expect(clock.clock.times({ reasoning: 0 }).flowMs).toBe(1);
  });

  test("passthrough frames held before the first write count from that write", () => {
    const clock = clockFor("anthropic_messages");
    clock.at(1000).saw(TEXT("abcdefgh"));
    clock.at(1100).saw(TEXT("abcdefgh"));
    clock.at(1500).saw(TEXT("abcdefgh"));
    const times = clock.clock.times({ reasoning: 0, notBefore: 1200 });
    expect(times.firstContentAt).toBe(1200);
    expect(times.flowMs).toBe(375);
  });

  test("reasoning that came first and streamed for a while has its start kept; the flow of a reply that reasoned runs from its text", () => {
    const clock = clockFor("openai_chat");
    clock.at(1000).saw(THINK("hmm"));
    clock.at(1200).saw(THINK("hmm"));
    for (let i = 0; i <= 10; i += 1) clock.at(2000 + i * 50).saw(TEXT("abcdefgh"));
    const times = clock.clock.times({ reasoning: 20 });
    expect(times.firstReasoningAt).toBe(1000);
    expect(times.firstTextAt).toBe(2000);
    expect(times.flowMs).toBe(500);
  });

  test("reasoning that streamed under 100 ms, or after a tool call, has no start", () => {
    const short = clockFor("openai_chat");
    short.at(1000).saw(THINK("hmm"));
    short.at(1099).saw(THINK("hmm"));
    expect(short.clock.times({ reasoning: 5 }).firstReasoningAt).toBeNull();
    const late = clockFor("anthropic_messages");
    late.at(900).saw({ kind: "tool_start", id: "t1", name: "Read" });
    late.at(1000).saw(THINK("hmm"));
    late.at(1500).saw(THINK("hmm"));
    expect(late.clock.times({ reasoning: 5 }).firstReasoningAt).toBeNull();
  });

  test("redacted thinking and Responses reasoning summaries hide the reasoning", () => {
    const redacted = clockFor("anthropic_messages");
    redacted.clock.sawRaw(
      JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "redacted_thinking", data: "sealed" },
      }),
    );
    redacted.at(1000).saw({ kind: "tool_start", id: "t1", name: "Read" });
    expect(redacted.clock.times({ reasoning: 0 }).reasoningHidden).toBe(true);
    const summary = clockFor("openai_responses");
    summary.at(1000).saw(THINK("summary"));
    summary.at(1500).saw(THINK("summary"));
    const times = summary.clock.times({ reasoning: 30 });
    expect(times.reasoningHidden).toBe(true);
    expect(times.firstReasoningAt).toBeNull();
  });
});

/** 计时器与拨它时钟的手：`at(ms)` 把时钟拨到那一刻再交出计时器。 */
interface TimedClock {
  clock: ReplyClock;
  at: (ms: number) => ReplyClock;
}

function clockFor(upstream: ApiEndpointRequestFormat): TimedClock {
  let now = 0;
  const clock = new ReplyClock({ upstream, now: () => now });
  return {
    clock,
    at: (ms) => {
      now = ms;
      return clock;
    },
  };
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 };
}
