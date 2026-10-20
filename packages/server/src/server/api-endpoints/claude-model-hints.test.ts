import { describe, expect, test } from "vitest";
import { claudeHints, markOneMillion, type ClaudeHintInput } from "./claude-model-hints.js";

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

function hints(input: Partial<ClaudeHintInput> & Pick<ClaudeHintInput, "start">) {
  return claudeHints({
    tiers: [],
    subagent: null,
    listed: [],
    longConversations: undefined,
    ...input,
  });
}

describe("claudeHints", () => {
  test("a model that reaches max without xhigh is said to have xhigh, so Claude Code allows Ultra Code", () => {
    // 照 magpie d1c485f7：中转站把 xhigh 按模型自己的档位发出（最近一档、平局取高，即 max）。
    expect(
      hints({
        start: { id: "glm-5.3", facts: { efforts: ["low", "high", "max"] } },
        listed: [{ id: "relay/kimi-k3", facts: { efforts: ["low", "high"] } }],
      }).env.CLAUDE_CODE_MODEL_CAPABILITIES,
    ).toBe("glm-5.3=effort,xhigh_effort,max_effort;relay/kimi-k3=effort");
  });

  test("the start model's window and reply length, each model's levels, and where to compact", () => {
    expect(
      hints({
        start: { id: "gpt-6-sol", facts: GPT_6 },
        listed: [
          { id: "relay/gpt-6-sol", facts: GPT_6 },
          { id: "relay/DeepSeek-V4-Pro", facts: DEEPSEEK },
          { id: "relay/claude-opus-5-5", facts: { output: 8000 } },
        ],
      }),
    ).toEqual({
      env: {
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: "922000",
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: "128000",
        // 模型名小写（Claude Code 比较前会把模型转成小写，模式不转）；起始模型在前。
        CLAUDE_CODE_MODEL_CAPABILITIES:
          "gpt-6-sol=effort,xhigh_effort,max_effort;relay/gpt-6-sol=effort,xhigh_effort,max_effort;relay/deepseek-v4-pro=effort,xhigh_effort,max_effort",
        // magpie WorkingWindow：别家模型在 272K 压缩。
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: "272000",
      },
      compactYieldsToOwn: true,
    });
  });

  test("the window is the start model's, a Claude model's too; a [1m] start takes the least unmarked tier's (magpie claudeWindow)", () => {
    const window = (input: Parameters<typeof hints>[0]) =>
      hints(input).env.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
    expect(window({ start: { id: "claude-sonnet-5-5", facts: { context: 200_000 } } })).toBe(
      "200000",
    );
    expect(window({ start: { id: "mystery", facts: {} } })).toBeUndefined();
    expect(window({ start: { id: "deepseek-v4-pro", facts: DEEPSEEK } })).toBeUndefined();
    expect(
      window({
        start: { id: "deepseek-v4-pro", facts: DEEPSEEK },
        tiers: [
          { id: "relay/kimi-k2.5", facts: KIMI },
          { id: "relay/deepseek-v4-pro", facts: DEEPSEEK },
        ],
      }),
    ).toBe("262144");
  });

  test("the reply length counts the models Claude Code runs on, not every /model row (magpie claudeOutput)", () => {
    const output = (input: Parameters<typeof hints>[0]) =>
      hints(input).env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;
    // /model 里不知道回复上限的不挡；起始、后台小任务与 Subagent 模型里取最小的。
    expect(
      output({
        start: { id: "gpt-6-sol", facts: GPT_6 },
        listed: [{ id: "relay/mystery", facts: {} }],
      }),
    ).toBe("128000");
    expect(
      output({
        start: { id: "deepseek-v4-pro", facts: DEEPSEEK },
        tiers: [{ id: "relay/kimi-k2.5", facts: KIMI }],
        subagent: { id: "relay/gpt-6-sol", facts: GPT_6 },
      }),
    ).toBe("98304");
    // 跑的模型里有一个不知道、最小的不过 32000，都不写；Claude 模型不算。
    expect(
      output({ start: { id: "gpt-6-sol", facts: GPT_6 }, subagent: { id: "x", facts: {} } }),
    ).toBeUndefined();
    expect(
      output({
        start: { id: "gpt-6-sol", facts: GPT_6 },
        tiers: [{ id: "relay/small", facts: { output: 32_000 } }],
      }),
    ).toBeUndefined();
    expect(
      output({
        start: { id: "gpt-6-sol", facts: GPT_6 },
        tiers: [{ id: "relay/claude-haiku-4-5", facts: { output: 8000 } }],
      }),
    ).toBe("128000");
  });

  test("no reply length when the start model is a Claude model, which Claude Code knows", () => {
    expect(
      hints({
        start: { id: "claude-sonnet-5-5", facts: { output: 64_000 } },
        tiers: [{ id: "relay/gpt-6-sol", facts: GPT_6 }],
      }).env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
    ).toBeUndefined();
  });

  test("a Claude model is named with no more levels than Claude Code gives it; the models it runs on go first (magpie claudeCapabilities)", () => {
    expect(
      hints({
        start: { id: "kimi-k2.5", facts: { efforts: ["high"] } },
        tiers: [{ id: "relay/glm-5", facts: { efforts: ["low", "high"] } }],
        listed: [
          { id: "relay/claude-opus-4-6", facts: { efforts: ["low", "high", "xhigh", "max"] } },
          { id: "relay/claude-haiku-4-5", facts: { efforts: ["low", "high"] } },
          { id: "relay/glm-5", facts: { efforts: ["low", "high"] } },
        ],
      }).env.CLAUDE_CODE_MODEL_CAPABILITIES,
    ).toBe("kimi-k2.5=effort;relay/glm-5=effort;relay/claude-opus-4-6=effort,max_effort");
  });

  test("names only models with levels Claude Code has, and none it cannot parse", () => {
    expect(
      hints({
        start: { id: "kimi-k2.5", facts: KIMI },
        listed: [
          { id: "relay/switch-only", facts: { efforts: ["none"] } },
          { id: "relay/odd;name", facts: { efforts: ["high"] } },
          { id: "relay/prefix*", facts: { efforts: ["high"] } },
        ],
      }).env.CLAUDE_CODE_MODEL_CAPABILITIES,
    ).toBeUndefined();
  });

  describe("where Claude Code compacts (magpie writeCompact)", () => {
    const compact = (input: Parameters<typeof hints>[0]) => {
      const result = hints(input);
      return [result.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, result.compactYieldsToOwn];
    };

    test("a threshold set on the start model comes first, a Claude model's too, and doesn't give way", () => {
      expect(
        compact({ start: { id: "gpt-6-sol", facts: { ...GPT_6, compact: 500_000 } } }),
      ).toEqual(["500000", false]);
      expect(compact({ start: { id: "claude-opus-5-5", facts: { compact: 300_000 } } })).toEqual([
        "300000",
        false,
      ]);
      expect(
        compact({
          start: { id: "gpt-6-sol", facts: { ...GPT_6, compact: 500_000 } },
          longConversations: { fullContext: true },
        }),
      ).toEqual(["500000", false]);
    });

    test("a Claude start model runs to its own window", () => {
      expect(compact({ start: { id: "claude-opus-5-5", facts: { context: 1_000_000 } } })).toEqual([
        undefined,
        false,
      ]);
    });

    test("Full window leaves it out; a host Compact at replaces 272K and doesn't give way", () => {
      expect(
        compact({
          start: { id: "gpt-6-sol", facts: GPT_6 },
          longConversations: { fullContext: true },
        }),
      ).toEqual([undefined, false]);
      expect(
        compact({
          start: { id: "gpt-6-sol", facts: GPT_6 },
          longConversations: { compactAt: 400_000 },
        }),
      ).toEqual(["400000", false]);
    });

    test("a window the user typed runs whole unless a host Compact at is typed (magpie WindowTyped, #1809)", () => {
      const typed = { ...GPT_6, contextSet: true };
      expect(compact({ start: { id: "gpt-6-sol", facts: typed } })).toEqual([undefined, false]);
      expect(
        compact({
          start: { id: "gpt-6-sol", facts: typed },
          longConversations: { compactAt: 400_000 },
        }),
      ).toEqual(["400000", false]);
    });
  });
});
