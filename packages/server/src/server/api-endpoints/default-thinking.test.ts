// 档位表的用例照 magpie（https://github.com/yetone/magpie，internal/agent/claude.go 的 claudeEffortsFor、claudeName 与 claudeClamp）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, it } from "vitest";
import { claudeModelName } from "./claude-model-name.js";
import {
  claudeClamp,
  defaultThinkingLevels,
  settleCodexThinking,
  takesUltraCode,
  thinkingOptionsOf,
} from "./default-thinking.js";

describe("defaultThinkingLevels", () => {
  it("offers another vendor's model all five Claude Code levels, whatever its known levels, as magpie does", () => {
    expect(
      defaultThinkingLevels({
        provider: "claude",
        modelId: "glm-5.3",
        facts: { efforts: ["low", "high", "max"] },
      }),
    ).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(
      defaultThinkingLevels({ provider: "claude", modelId: "plain", facts: { efforts: [] } }),
    ).toEqual(["low", "medium", "high", "xhigh", "max"]);
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

  it("has Ultra Code only where the model takes xhigh", () => {
    expect(takesUltraCode(["low", "medium", "high", "max"])).toBe(false);
    expect(takesUltraCode(["low", "medium", "high", "xhigh", "max"])).toBe(true);
  });
});

describe("claudeClamp", () => {
  it("runs a level the model doesn't take at the highest one not above it", () => {
    expect(claudeClamp("xhigh", ["low", "medium", "high", "max"])).toBe("high");
    expect(claudeClamp("max", ["low", "medium", "high"])).toBe("high");
    expect(claudeClamp("high", ["low", "medium", "high"])).toBe("high");
    expect(claudeClamp("high", [])).toBeNull();
  });
});

describe("settleCodexThinking", () => {
  it("keeps a level the model takes and moves one it doesn't to the nearest, a tie going up", () => {
    const levels = ["low", "high", "max"];
    expect(settleCodexThinking({ levels, chosen: "high" })).toBe("high");
    expect(settleCodexThinking({ levels, chosen: "medium" })).toBe("high");
    expect(settleCodexThinking({ levels, chosen: "xhigh" })).toBe("max");
    expect(settleCodexThinking({ levels, chosen: null })).toBeNull();
  });

  it("falls back to medium, then high, then the first level when none is near, as ModelDefault", () => {
    expect(settleCodexThinking({ levels: ["low", "medium"], chosen: "turbo" })).toBe("medium");
    expect(settleCodexThinking({ levels: ["fast", "deep"], chosen: "turbo" })).toBe("fast");
  });

  it("leaves the level alone while the model's levels are unknown", () => {
    expect(settleCodexThinking({ levels: [], chosen: "high" })).toBe("high");
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
  it("labels both CLIs' levels the same way", () => {
    expect(
      thinkingOptionsOf({ levels: ["minimal", "high", "xhigh", "ultracode", "turbo"] }),
    ).toEqual([
      { id: "minimal", label: "Minimal" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
      { id: "ultracode", label: "Ultra Code" },
      { id: "turbo", label: "Turbo" },
    ]);
  });
});
