// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/codex_backend.go 的 codexModels：
// ChatGPT 的清单在前，magpie 的模型排在 len(own)+100 之后）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import { mergeChatGptModels } from "./chatgpt-models.js";

describe("the model list a Codex signed in with ChatGPT gets", () => {
  test("is ChatGPT's own models as they came, then the endpoint models after them", () => {
    const own = [
      { slug: "gpt-5.5", priority: 0, extra: { kept: true } },
      { slug: "codex-auto-review", visibility: "hide", priority: 9 },
    ];
    const endpoints = [
      { slug: "relay-a/kimi-k2", priority: 1 },
      { slug: "relay-b/glm-4.6", priority: 2 },
    ];
    expect(mergeChatGptModels({ own, endpoints })).toEqual([
      { slug: "gpt-5.5", priority: 0, extra: { kept: true } },
      { slug: "codex-auto-review", visibility: "hide", priority: 9 },
      { slug: "relay-a/kimi-k2", priority: 103 },
      { slug: "relay-b/glm-4.6", priority: 104 },
    ]);
  });
});
