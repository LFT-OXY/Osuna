// 用例取自 magpie（https://github.com/yetone/magpie，internal/agent 的 pi_thinking_test.go、pi_api_test.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, it } from "vitest";
import {
  piBareFormat,
  piClamp,
  piEndpointFormat,
  piModelEntry,
  piOfferedLevels,
  piThinkingLevels,
} from "./pi-model-entries.js";

const ROOT = "http://127.0.0.1:6767/api-endpoint-gateway";

describe("the format each Pi model asks the gateway in", () => {
  it("is Chat unless a GPT has Responses or a Claude has Anthropic", () => {
    const all = ["anthropic_messages", "openai_chat", "openai_responses"] as const;
    expect(piEndpointFormat({ modelId: "glm-5", served: all, pinned: null })).toBe("openai_chat");
    expect(piEndpointFormat({ modelId: "gpt-6", served: all, pinned: null })).toBe(
      "openai_responses",
    );
    expect(piEndpointFormat({ modelId: "gpt-6", served: ["openai_chat"], pinned: null })).toBe(
      "openai_chat",
    );
    expect(piEndpointFormat({ modelId: "claude-opus-5-5", served: all, pinned: null })).toBe(
      "anthropic_messages",
    );
    expect(piEndpointFormat({ modelId: "glm-5", served: all, pinned: "anthropic_messages" })).toBe(
      "anthropic_messages",
    );
  });

  it("asks a model pinned to Gemini on Chat: Pi doesn't speak Gemini", () => {
    const served = ["openai_responses", "gemini"] as const;
    expect(piEndpointFormat({ modelId: "gpt-6", served, pinned: "gemini" })).toBe("openai_chat");
  });

  it("puts a bare name on Responses only when every endpoint serving it is", () => {
    expect(piBareFormat(["openai_responses", "openai_responses"])).toBe("openai_responses");
    expect(piBareFormat(["openai_responses", "openai_chat"])).toBe("openai_chat");
    expect(piBareFormat(["anthropic_messages"])).toBe("openai_chat");
  });
});

describe("a Pi model entry", () => {
  it("lists all seven levels, null where the model has none", () => {
    expect(piThinkingLevels({ efforts: ["low", "high", "max"], claudeOff: false })).toEqual({
      off: null,
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: null,
      max: "max",
    });
    expect(piThinkingLevels({ efforts: ["none", "high"], claudeOff: false })?.off).toBe("none");
    expect(piThinkingLevels({ efforts: [], claudeOff: false })).toBeNull();
    // 走 Anthropic 的 Claude 留着 off 给 Pi 自己给。
    expect(piThinkingLevels({ efforts: ["high"], claudeOff: true })).not.toHaveProperty("off");
  });

  it("writes only what is known and keeps the reply within the window", () => {
    expect(
      piModelEntry(
        {
          id: "relay/deepseek-chat",
          name: "DeepSeek Chat (Relay)",
          facts: { context: 128_000, output: 384_000 },
          format: "openai_chat",
          cost: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 },
        },
        ROOT,
      ),
    ).toEqual({
      id: "relay/deepseek-chat",
      name: "DeepSeek Chat (Relay)",
      reasoning: false,
      contextWindow: 128_000,
      maxTokens: 128_000,
      cost: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 },
    });
  });

  it("sends a Claude to the gateway's root on Anthropic, adaptive and cached", () => {
    expect(
      piModelEntry(
        {
          id: "claude-opus-5-5",
          name: "Claude Opus 5.5",
          facts: { efforts: ["low", "medium", "high", "max"], images: true },
          format: "anthropic_messages",
          cost: null,
        },
        ROOT,
      ),
    ).toEqual({
      id: "claude-opus-5-5",
      name: "Claude Opus 5.5",
      reasoning: true,
      api: "anthropic-messages",
      baseUrl: ROOT,
      compat: { forceAdaptiveThinking: true },
      input: ["text", "image"],
      thinkingLevelMap: {
        minimal: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: null,
        max: "max",
      },
      promptCache: { short: 300, long: 3600 },
    });
  });

  it("lets Pi offer its own levels for a model that thinks with none known", () => {
    const entry = piModelEntry(
      {
        id: "kimi-k3-max",
        name: "Kimi K3 Max",
        facts: { efforts: [], thinks: true },
        format: "openai_chat",
        cost: null,
      },
      ROOT,
    );
    expect(entry).toEqual({ id: "kimi-k3-max", name: "Kimi K3 Max", reasoning: true });
  });

  it("asks a GPT on Responses with a five-minute cache", () => {
    const entry = piModelEntry(
      { id: "gpt-6", name: "GPT 6", facts: {}, format: "openai_responses", cost: null },
      ROOT,
    );
    expect(entry).toEqual({
      id: "gpt-6",
      name: "GPT 6",
      reasoning: false,
      api: "openai-responses",
      promptCache: { short: 300 },
    });
  });
});

describe("the levels Pi offers for an Osuna model", () => {
  it("is off alone for a model that does not think, and every level mapped otherwise", () => {
    expect(piOfferedLevels({ reasoning: false })).toEqual(["off"]);
    // 档位不知道：Pi 给 off 到 high，xhigh 与 max 要映射了才有。
    expect(piOfferedLevels({ reasoning: true })).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    const map = {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: null,
    };
    expect(piOfferedLevels({ reasoning: true, thinkingLevelMap: map })).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("clamps a level up first, then down (magpie piClamp)", () => {
    expect(piClamp("high", ["low", "high"])).toBe("high");
    expect(piClamp("minimal", ["low", "high"])).toBe("low");
    expect(piClamp("max", ["low", "high"])).toBe("high");
    expect(piClamp("medium", ["off"])).toBe("off");
  });
});
