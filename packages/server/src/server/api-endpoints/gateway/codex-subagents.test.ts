// 用例照 magpie（https://github.com/yetone/magpie，internal/gateway/codex_subagent_test.go、codex_backend.go 的 withoutSealedMessages）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, it } from "vitest";
import { hasSealedAgentTask, pickCodexSubagentModel } from "./codex-subagents.js";

const SEALED = { type: "encrypted_content", encrypted_content: "gAAAAABabc_-123=" };

function agentMessage(header: string) {
  return { type: "agent_message", content: [{ type: "input_text", text: header }, SEALED] };
}

function pick(input: { headers: Record<string, string>; asked?: string; forced: string | null }) {
  return pickCodexSubagentModel({
    headers: input.headers,
    asked: input.asked ?? "gpt-5.5",
    forced: input.forced,
    parsed: { input: "hi" },
    isServed: (model) => model !== "gone",
    opensSealed: () => false,
  });
}

describe("pickCodexSubagentModel", () => {
  it("moves a Subagent's request, by any of Codex's spellings of it, to the forced model", () => {
    for (const kind of ["thread_spawn", "collab_spawn", "agent_job"]) {
      expect(pick({ headers: { "x-openai-subagent": kind }, forced: "glm-5" })).toEqual({
        kind: "moved",
        to: "glm-5",
      });
    }
  });

  it("leaves other calls, an unset forced model and one already asked for alone", () => {
    expect(pick({ headers: {}, forced: "glm-5" })).toEqual({ kind: "none" });
    expect(pick({ headers: { "x-openai-subagent": "review" }, forced: "glm-5" })).toEqual({
      kind: "none",
    });
    expect(pick({ headers: { "x-openai-subagent": "thread_spawn" }, forced: null })).toEqual({
      kind: "none",
    });
    expect(
      pick({ headers: { "x-openai-subagent": "thread_spawn" }, asked: "glm-5", forced: "glm-5" }),
    ).toEqual({
      kind: "none",
    });
  });

  it("keeps the asked model when the forced one isn't served", () => {
    expect(pick({ headers: { "x-openai-subagent": "thread_spawn" }, forced: "gone" })).toEqual({
      kind: "kept",
      to: "gone",
      why: "no API endpoint that is on serves it now",
    });
  });
});

describe("hasSealedAgentTask", () => {
  it("is a sealed task, not a sealed message, and not a token that isn't the ChatGPT backend's", () => {
    expect(hasSealedAgentTask({ input: [agentMessage("Message Type: NEW_TASK\n")] })).toBe(true);
    expect(hasSealedAgentTask({ input: [agentMessage("no header")] })).toBe(true);
    expect(hasSealedAgentTask({ input: [agentMessage("Message Type: MESSAGE\n")] })).toBe(false);
    const plain = {
      type: "agent_message",
      content: [{ type: "encrypted_content", encrypted_content: "osuna1:abc" }],
    };
    expect(hasSealedAgentTask({ input: [plain] })).toBe(false);
    expect(hasSealedAgentTask({ input: "hi" })).toBe(false);
  });
});
