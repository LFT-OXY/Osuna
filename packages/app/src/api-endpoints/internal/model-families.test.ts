import { describe, expect, it } from "vitest";
import { MODEL_FAMILIES, modelFamilyOf } from "./model-families";

// 前缀表照 ui-direction.md「接口详情页」与 magpie（MIT，THIRD_PARTY_NOTICES）internal/agent/icons.go。
describe("modelFamilyOf", () => {
  it.each([
    ["claude-sonnet-4-5", "claude"],
    ["gpt-5", "gpt"],
    ["o1-preview", "gpt"],
    ["o3-mini", "gpt"],
    ["o4-mini", "gpt"],
    ["codex-mini-latest", "gpt"],
    ["gemini-2.5-pro", "gemini"],
    ["gemma-3-27b", "gemini"],
    ["deepseek-chat", "deepseek"],
    ["grok-4", "grok"],
    ["kimi-k2", "kimi"],
    ["moonshot-v1-8k", "kimi"],
    ["glm-4.6", "glm"],
    ["qwen3-coder-plus", "qwen"],
    ["qwq-32b", "qwen"],
    ["mistral-large", "mistral"],
    ["codestral-latest", "mistral"],
    ["devstral-medium", "mistral"],
    ["magistral-small", "mistral"],
    ["MiniMax-M2", "minimax"],
    ["mimo-v2", "mimo"],
    ["xiaomi-mimo-7b", "mimo"],
    ["step-2-16k", "step"],
  ])("%s is %s", (modelId, family) => {
    expect(modelFamilyOf(modelId)).toBe(family);
  });

  it("reads the prefix after the last slash, case-insensitively", () => {
    expect(modelFamilyOf("anthropic/Claude-Opus-4")).toBe("claude");
    expect(modelFamilyOf("openrouter/openai/gpt-5")).toBe("gpt");
  });

  it("puts anything it does not recognise under other", () => {
    expect(modelFamilyOf("llama-3.3-70b")).toBe("other");
    expect(modelFamilyOf("my-gpt-5")).toBe("other");
    expect(modelFamilyOf("")).toBe("other");
  });
});

describe("MODEL_FAMILIES", () => {
  it("lists the main families first, the other recognised ones next, and other last", () => {
    expect(MODEL_FAMILIES.map((family) => family.id)).toEqual([
      "claude",
      "gpt",
      "gemini",
      "deepseek",
      "kimi",
      "glm",
      "qwen",
      "grok",
      "mistral",
      "minimax",
      "mimo",
      "step",
      "other",
    ]);
  });
});
