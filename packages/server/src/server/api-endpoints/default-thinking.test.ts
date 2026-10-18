// 档位表的用例照 magpie（https://github.com/yetone/magpie，internal/agent/claude.go 的 claudeEffortsFor 与 claudeName）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, it } from "vitest";
import { claudeModelName } from "./claude-model-name.js";
import {
  defaultThinkingLevels,
  settleDefaultThinking,
  thinkingOptionsOf,
} from "./default-thinking.js";

describe("defaultThinkingLevels", () => {
  it("offers another vendor's model the Claude Code levels it takes, xhigh when it reaches max, and Ultra Code with xhigh", () => {
    expect(
      defaultThinkingLevels({
        provider: "claude",
        modelId: "glm-5.3",
        facts: { efforts: ["low", "high", "max"] },
      }),
    ).toEqual(["low", "high", "xhigh", "max", "ultracode"]);
    expect(
      defaultThinkingLevels({
        provider: "claude",
        modelId: "relay-a/kimi-k2",
        facts: { efforts: ["low", "medium", "high"] },
      }),
    ).toEqual(["low", "medium", "high"]);
  });

  it("offers every Claude Code level for a model without known levels and none for a levelless one", () => {
    expect(defaultThinkingLevels({ provider: "claude", modelId: "mystery", facts: {} })).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultracode",
    ]);
    expect(
      defaultThinkingLevels({ provider: "claude", modelId: "plain", facts: { efforts: [] } }),
    ).toEqual([]);
  });

  it("offers a Claude model the levels Claude Code sends it at, as magpie's claudeEffortsFor", () => {
    expect(
      defaultThinkingLevels({ provider: "claude", modelId: "claude-opus-4-6", facts: {} }),
    ).toEqual(["low", "medium", "high", "max"]);
    expect(
      defaultThinkingLevels({ provider: "claude", modelId: "claude-opus-4.5", facts: {} }),
    ).toEqual(["low", "medium", "high"]);
    expect(
      defaultThinkingLevels({ provider: "claude", modelId: "claude-haiku-4-5", facts: {} }),
    ).toEqual([]);
    expect(
      defaultThinkingLevels({
        provider: "claude",
        modelId: "relay/claude-opus-5-5[1m]",
        facts: {},
      }),
    ).toEqual(["low", "medium", "high", "xhigh", "max", "ultracode"]);
  });

  it("offers Codex every level the model takes, and four when none are known", () => {
    expect(
      defaultThinkingLevels({
        provider: "codex",
        modelId: "glm-5.3",
        facts: { efforts: ["minimal", "high", "max"] },
      }),
    ).toEqual(["minimal", "high", "max"]);
    expect(defaultThinkingLevels({ provider: "codex", modelId: "x", facts: {} })).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });
});

describe("settleDefaultThinking", () => {
  it("keeps a level the model takes and moves one it doesn't to the nearest, a tie going up", () => {
    const levels = ["low", "high", "max"];
    expect(settleDefaultThinking({ levels, chosen: "high" })).toBe("high");
    expect(settleDefaultThinking({ levels, chosen: "medium" })).toBe("high");
    expect(settleDefaultThinking({ levels, chosen: "xhigh" })).toBe("max");
    expect(settleDefaultThinking({ levels, chosen: null })).toBeNull();
  });

  it("moves Ultra Code to the level nearest xhigh when the model has no xhigh", () => {
    expect(settleDefaultThinking({ levels: ["low", "medium", "high"], chosen: "ultracode" })).toBe(
      "high",
    );
  });

  it("drops the choice when the model has no level near it", () => {
    expect(settleDefaultThinking({ levels: [], chosen: "high" })).toBeNull();
    expect(settleDefaultThinking({ levels: ["low"], chosen: "turbo" })).toBeNull();
  });
});

describe("claudeModelName", () => {
  it("finds the Claude model an id names, as Claude Code keys modelSettings", () => {
    expect(claudeModelName("relay/claude-opus-5-5[1m]")).toBe("claude-opus-5-5");
    expect(claudeModelName("claude-sonnet-4.6")).toBe("claude-sonnet-4-6");
    expect(claudeModelName("claude-opus-4-20250514")).toBe("claude-opus-4");
    expect(claudeModelName("glm-4.6")).toBe("");
  });
});

describe("thinkingOptionsOf", () => {
  it("labels Claude Code's levels as the chat does and marks the default", () => {
    expect(
      thinkingOptionsOf({ provider: "claude", levels: ["high", "xhigh", "ultracode"] }),
    ).toEqual([
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
      { id: "ultracode", label: "Ultra Code" },
    ]);
    expect(thinkingOptionsOf({ provider: "codex", levels: ["minimal"] })).toEqual([
      { id: "minimal", label: "minimal" },
    ]);
  });
});
