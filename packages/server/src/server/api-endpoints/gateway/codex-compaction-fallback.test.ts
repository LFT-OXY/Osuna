// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/codex_backend.go 的 plainCompact、localSummary、
// itemText、upstreamFailed、itemNotFound，fallback.go 的 protectionRefused，codex_compact_guard.go 的 compactFails）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import { CODEX_COMPACT_PROMPT } from "./codex-compaction.js";
import {
  CompactionFailures,
  compactionKey,
  isAskedAgainAsText,
  localSummary,
  plainCompact,
} from "./codex-compaction-fallback.js";

function userText(text: string) {
  return { type: "message", role: "user", content: [{ type: "input_text", text }] };
}

const CONVERSATION = {
  model: "relay-a/kimi-k2",
  prompt_cache_key: "thread-1",
  previous_response_id: "resp_0",
  tools: [],
  input: [
    userText("fix the parser"),
    { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "thinking" }] },
    { type: "function_call", id: "fc_1", name: "shell", arguments: '{"cmd":"ls"}' },
    { type: "function_call_output", call_id: "c1", output: "a.ts" },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Parser fixed." }],
    },
    userText(CODEX_COMPACT_PROMPT),
  ],
};

describe("plainCompact", () => {
  test("asks for the summary with the conversation as text, no item ids or sealed reasoning", () => {
    const plain = JSON.parse(plainCompact(JSON.stringify(CONVERSATION))) as Record<string, unknown>;
    expect(plain.previous_response_id).toBeUndefined();
    expect(plain.prompt_cache_key).toBe("thread-1");
    expect(plain.input).toEqual([
      userText(
        "This is the conversation so far:\n\n" +
          "[user]\nfix the parser\n\n" +
          "[reasoning]\nthinking\n\n" +
          '[tool call]\nshell {"cmd":"ls"}\n\n' +
          "[tool output]\na.ts\n\n" +
          "[assistant]\nParser fixed.\n\n",
      ),
      userText(CODEX_COMPACT_PROMPT),
    ]);
  });
});

describe("localSummary", () => {
  test("is what the user asked and the last reply, saying no model wrote it", () => {
    expect(localSummary(JSON.stringify(CONVERSATION), "RELAY-A answered 404")).toBe(
      "Osuna compacted this conversation without a model (RELAY-A answered 404), so this is no summary: " +
        "it is what the user asked and the last reply. Look at the workspace for where the work stands before going on.\n\n" +
        "## The user's messages\n\nfix the parser\n\n## The last reply\n\nParser fixed.\n",
    );
  });
});

describe("isAskedAgainAsText", () => {
  test("is a 404, an item not found, a relay's 'Upstream request failed', or response protection", () => {
    expect(isAskedAgainAsText({ status: 404, said: "Not Found" })).toBe(true);
    expect(isAskedAgainAsText({ status: 400, said: "Item with id 'rs_abc123' not found." })).toBe(
      true,
    );
    expect(isAskedAgainAsText({ status: 400, said: "apex: Upstream request failed" })).toBe(true);
    expect(isAskedAgainAsText({ status: 502, said: "response protection is unavailable" })).toBe(
      true,
    );
  });

  test("is not a sign-in failure, a rate limit or a plain server error", () => {
    expect(isAskedAgainAsText({ status: 401, said: "Upstream request failed" })).toBe(false);
    expect(isAskedAgainAsText({ status: 429, said: "Upstream request failed" })).toBe(false);
    expect(isAskedAgainAsText({ status: 500, said: "boom" })).toBe(false);
  });
});

describe("CompactionFailures", () => {
  test("holds a conversation's compaction after 3 failures in a row within 5 minutes, until 5 minutes pass", () => {
    let now = 1_000_000;
    const failures = new CompactionFailures(() => now);
    const key = compactionKey(JSON.stringify(CONVERSATION));
    for (let i = 0; i < 3; i++) {
      expect(failures.held({ key, model: "relay-a/kimi-k2" })).toBeNull();
      failures.failed({ key, status: 502, why: "the reply ended incomplete" });
      now += 1000;
    }
    expect(failures.held({ key, model: "relay-a/kimi-k2" })).toBe(
      "compaction: relay-a/kimi-k2 failed to summarise this conversation 3 times in a row (last: the reply ended incomplete); " +
        "Osuna doesn't ask it again for 4m59s, so a compaction that can't succeed isn't paid for over and over. " +
        "Pick another model for this conversation",
    );
    now += 5 * 60_000;
    expect(failures.held({ key, model: "relay-a/kimi-k2" })).toBeNull();
  });

  test("doesn't count sign-in failures or a request without a conversation, and a summary clears the count", () => {
    const failures = new CompactionFailures(() => 0);
    const key = compactionKey(JSON.stringify(CONVERSATION));
    for (let i = 0; i < 3; i++) failures.failed({ key, status: 401, why: "bad key" });
    expect(failures.held({ key, model: "m" })).toBeNull();
    for (let i = 0; i < 3; i++) failures.failed({ key, status: 502, why: "x" });
    failures.done(key);
    expect(failures.held({ key, model: "m" })).toBeNull();
    expect(compactionKey('{"model":"m"}')).toBeNull();
  });
});
