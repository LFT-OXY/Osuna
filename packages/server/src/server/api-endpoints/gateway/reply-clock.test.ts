import { describe, expect, test } from "vitest";
import { ReplyClock } from "./reply-clock.js";

/*
 * 交给 Agent 的回复怎么计时（magpie internal/gateway/ttft.go）：事件的时刻显式给出，结果每次一样。
 */

const TEXT = (text: string) => ({ kind: "text" as const, text });
const THINK = (text: string) => ({ kind: "think" as const, text });

describe("timing a reply as it goes to the agent", () => {
  test("a reply that came evenly has a flow about its window", () => {
    const clock = new ReplyClock("anthropic_messages");
    clock.saw({ kind: "start", id: "msg_1", usage: emptyUsage() }, 900);
    for (let i = 0; i <= 10; i += 1) clock.saw(TEXT("abcdefgh"), 1000 + i * 100);
    const times = clock.times({ reasoning: 0 });
    expect(times.firstContentAt).toBe(1000);
    expect(times.firstTextAt).toBe(1000);
    // 10% 到 90% 的内容用了 800ms，放大到整份是 1000ms。
    expect(times.flowMs).toBe(1000);
    expect(times.firstReasoningAt).toBeNull();
    expect(times.reasoningHidden).toBe(false);
  });

  test("a reply held and let go in one burst has next to no flow", () => {
    const clock = new ReplyClock("anthropic_messages");
    clock.saw(TEXT("a"), 1000);
    clock.saw(TEXT("x".repeat(2000)), 1600);
    expect(clock.times({ reasoning: 0 }).flowMs).toBe(1);
  });

  test("passthrough frames held before the first write count from that write", () => {
    const clock = new ReplyClock("anthropic_messages");
    clock.saw(TEXT("abcdefgh"), 1000);
    clock.saw(TEXT("abcdefgh"), 1100);
    clock.saw(TEXT("abcdefgh"), 1500);
    const times = clock.times({ reasoning: 0, notBefore: 1200 });
    expect(times.firstContentAt).toBe(1200);
    expect(times.flowMs).toBe(375);
  });

  test("reasoning that came first and streamed for a while has its start kept; the flow of a reply that reasoned runs from its text", () => {
    const clock = new ReplyClock("openai_chat");
    clock.saw(THINK("hmm"), 1000);
    clock.saw(THINK("hmm"), 1200);
    for (let i = 0; i <= 10; i += 1) clock.saw(TEXT("abcdefgh"), 2000 + i * 50);
    const times = clock.times({ reasoning: 20 });
    expect(times.firstReasoningAt).toBe(1000);
    expect(times.firstTextAt).toBe(2000);
    expect(times.flowMs).toBe(500);
  });

  test("reasoning that streamed under 100 ms, or after a tool call, has no start", () => {
    const short = new ReplyClock("openai_chat");
    short.saw(THINK("hmm"), 1000);
    short.saw(THINK("hmm"), 1099);
    expect(short.times({ reasoning: 5 }).firstReasoningAt).toBeNull();
    const late = new ReplyClock("anthropic_messages");
    late.saw({ kind: "tool_start", id: "t1", name: "Read" }, 900);
    late.saw(THINK("hmm"), 1000);
    late.saw(THINK("hmm"), 1500);
    expect(late.times({ reasoning: 5 }).firstReasoningAt).toBeNull();
  });

  test("redacted thinking and Responses reasoning summaries hide the reasoning", () => {
    const redacted = new ReplyClock("anthropic_messages");
    redacted.sawRaw(
      JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "redacted_thinking", data: "sealed" },
      }),
    );
    redacted.saw({ kind: "tool_start", id: "t1", name: "Read" }, 1000);
    expect(redacted.times({ reasoning: 0 }).reasoningHidden).toBe(true);
    const summary = new ReplyClock("openai_responses");
    summary.saw(THINK("summary"), 1000);
    summary.saw(THINK("summary"), 1500);
    const times = summary.times({ reasoning: 30 });
    expect(times.reasoningHidden).toBe(true);
    expect(times.firstReasoningAt).toBeNull();
  });
});

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 };
}
