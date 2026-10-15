import { describe, expect, test } from "vitest";
import { claudeHintEnv, markOneMillion } from "./claude-model-hints.js";

const GPT_6 = {
  context: 922_000,
  output: 128_000,
  efforts: ["none", "low", "high", "xhigh", "max"],
};
const DEEPSEEK = { context: 1_000_000, output: 384_000, efforts: ["high", "max"] };
const KIMI = { context: 262_144, output: 98_304 };

describe("markOneMillion", () => {
  test("marks a model known to hold a million tokens or more", () => {
    expect(markOneMillion({ id: "relay/deepseek-v4-pro", facts: DEEPSEEK })).toBe(
      "relay/deepseek-v4-pro[1m]",
    );
    expect(markOneMillion({ id: "relay/gpt-6-sol", facts: GPT_6 })).toBe("relay/gpt-6-sol");
    expect(markOneMillion({ id: "relay/unknown", facts: {} })).toBe("relay/unknown");
  });

  test("marks a Claude model too: [1m] is how Claude Code reaches 1M on one that needs it", () => {
    expect(markOneMillion({ id: "relay/claude-opus-4-6", facts: { context: 1_000_000 } })).toBe(
      "relay/claude-opus-4-6[1m]",
    );
  });
});

describe("claudeHintEnv", () => {
  test("the start model's window, the least reply length, and each model's effort levels", () => {
    expect(
      claudeHintEnv({
        start: { id: "gpt-6-sol", facts: GPT_6 },
        listed: [
          { id: "relay/gpt-6-sol", facts: GPT_6 },
          { id: "relay/DeepSeek-V4-Pro", facts: DEEPSEEK },
          { id: "relay/claude-opus-5-5", facts: { output: 8000 } },
        ],
      }),
    ).toEqual({
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: "922000",
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: "128000",
      // 模型名小写（Claude Code 比较前会把模型转成小写，模式不转）；起始模型在前。
      CLAUDE_CODE_MODEL_CAPABILITIES:
        "gpt-6-sol=effort,xhigh_effort,max_effort;relay/gpt-6-sol=effort,xhigh_effort,max_effort;relay/deepseek-v4-pro=effort,max_effort",
    });
  });

  test("no window when the start model is marked [1m], a Claude model, or unknown", () => {
    const listed = [{ id: "relay/kimi-k2.5", facts: KIMI }];
    for (const start of [
      { id: "deepseek-v4-pro", facts: DEEPSEEK },
      { id: "claude-sonnet-5-5", facts: { context: 200_000 } },
      { id: "mystery", facts: {} },
    ]) {
      expect(claudeHintEnv({ start, listed }).CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
    }
  });

  test("no reply length when one model's is unknown or the least is no more than 32000", () => {
    expect(
      claudeHintEnv({
        start: { id: "gpt-6-sol", facts: GPT_6 },
        listed: [{ id: "relay/mystery", facts: { context: 200_000 } }],
      }).CLAUDE_CODE_MAX_OUTPUT_TOKENS,
    ).toBeUndefined();
    expect(
      claudeHintEnv({
        start: { id: "gpt-6-sol", facts: GPT_6 },
        listed: [{ id: "relay/small", facts: { output: 32_000 } }],
      }).CLAUDE_CODE_MAX_OUTPUT_TOKENS,
    ).toBeUndefined();
  });

  test("no reply length when the start model is a Claude model, which Claude Code knows", () => {
    expect(
      claudeHintEnv({
        start: { id: "claude-sonnet-5-5", facts: { output: 64_000 } },
        listed: [{ id: "relay/gpt-6-sol", facts: GPT_6 }],
      }).CLAUDE_CODE_MAX_OUTPUT_TOKENS,
    ).toBeUndefined();
  });

  test("names only models with levels Claude Code has, and none it cannot parse", () => {
    expect(
      claudeHintEnv({
        start: { id: "kimi-k2.5", facts: KIMI },
        listed: [
          { id: "relay/switch-only", facts: { efforts: ["none"] } },
          { id: "relay/odd;name", facts: { efforts: ["high"] } },
          { id: "relay/prefix*", facts: { efforts: ["high"] } },
        ],
      }),
    ).toEqual({ CLAUDE_CODE_MAX_CONTEXT_TOKENS: "262144" });
  });
});
