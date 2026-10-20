// 用例取自 magpie（https://github.com/yetone/magpie，internal/provider/test_as.go 的 shapeHeader、SawClient）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { describe, expect, test } from "vitest";
import {
  cliHeaderSample,
  codexSignHeaders,
  codexVersionOf,
  isFromClaudeCode,
  isFromCodex,
  newerCodexVersion,
  newestCodexVersion,
  SeenCodexVersion,
} from "./cli-header-samples.js";

describe("CLI header samples", () => {
  test("Claude Code keeps only the headers that say it is Claude Code, never a key, session or beta", () => {
    const sample = cliHeaderSample({
      client: "claude_code",
      headers: {
        "user-agent": "claude-cli/2.1.302 (external, cli)",
        "x-app": "cli",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
        "anthropic-dangerous-direct-browser-access": "true",
        "x-stainless-lang": "js",
        "x-stainless-retry-count": "0",
        "x-claude-code-session-id": "sess-1",
        "x-claude-code-entrypoint": "cli",
        authorization: "Bearer token-1",
        "x-api-key": "sk-1",
        cookie: "a=b",
        "content-type": "application/json",
        "x-client-request-id": "req-1",
      },
    });
    expect(sample).toEqual({
      "user-agent": "claude-cli/2.1.302 (external, cli)",
      "x-app": "cli",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "x-stainless-lang": "js",
      "x-stainless-retry-count": "0",
      "x-claude-code-entrypoint": "cli",
    });
  });

  test("Codex keeps its User-Agent, originator, version and own headers, never its session, thread, turn or sign-in", () => {
    const sample = cliHeaderSample({
      client: "codex",
      headers: {
        "User-Agent": "codex_cli_rs/0.162.3 (Mac OS 26.6.0; arm64) kitty",
        originator: "codex_cli_rs",
        version: "0.162.3",
        "session-id": "s",
        "thread-id": "t",
        session_id: "s",
        conversation_id: "c",
        "x-client-request-id": "r",
        "x-codex-beta-features": "a",
        "x-codex-turn-metadata": "{}",
        "x-codex-turn-state": "x",
        "x-openai-subagent": "review",
        "x-openai-codex-luna-reserve": "1",
        "x-oai-attestation": "att",
        "x-openai-internal-flag": "1",
        authorization: "Bearer sk-1",
        "chatgpt-account-id": "acct",
        cookie: "a=b",
      },
    });
    expect(sample).toEqual({
      "user-agent": "codex_cli_rs/0.162.3 (Mac OS 26.6.0; arm64) kitty",
      originator: "codex_cli_rs",
      version: "0.162.3",
      "x-codex-beta-features": "a",
      "x-openai-internal-flag": "1",
    });
  });

  test("a request without a User-Agent leaves no sample", () => {
    expect(cliHeaderSample({ client: "claude_code", headers: { "x-app": "cli" } })).toBeNull();
  });

  test("tells Claude Code and Codex by their User-Agent or originator", () => {
    expect(isFromClaudeCode({ "user-agent": "claude-cli/2.1.302 (external, cli)" })).toBe(true);
    expect(isFromClaudeCode({ "user-agent": "curl/8.4.0" })).toBe(false);
    expect(isFromCodex({ "user-agent": "Codex Desktop/0.162.3" })).toBe(true);
    expect(isFromCodex({ "user-agent": "node", originator: "acp-extension-codex" })).toBe(true);
    expect(isFromCodex({ "user-agent": "claude-cli/2.1.302" })).toBe(false);
  });

  test("without a Codex sample, a test says it is Codex CLI as a ChatGPT account's requests do", () => {
    expect(
      codexSignHeaders({
        version: "0.160.1",
        system: { os: "Mac OS 26.6.0", arch: "arm64", platform: "darwin" },
      }),
    ).toEqual({
      "user-agent": "codex_cli_rs/0.160.1 (Mac OS 26.6.0; arm64) Apple_Terminal/455",
      originator: "codex_cli_rs",
      version: "0.160.1",
    });
    expect(
      codexSignHeaders({
        version: "0.160.1",
        system: { os: "Linux 6.8.0", arch: "x64", platform: "linux" },
      })["user-agent"],
    ).toBe("codex_cli_rs/0.160.1 (Linux 6.8.0; x86_64) xterm-256color");
  });

  test("the Codex version is the newer of the built-in one and the one Codex last cached", () => {
    expect(newerCodexVersion("0.159.0", "0.162.3")).toBe("0.162.3");
    expect(newerCodexVersion("0.159.0", "0.99.9")).toBe("0.159.0");
    expect(newerCodexVersion("0.159.0", null)).toBe("0.159.0");
    expect(newerCodexVersion("0.159.0", "not a version")).toBe("0.159.0");
  });

  test("a Codex request says its version in its version header, else at the start of its User-Agent's version", () => {
    expect(
      codexVersionOf({ "user-agent": "codex_cli_rs/0.162.3 (Mac OS)", version: "0.163.0" }),
    ).toBe("0.163.0");
    expect(
      codexVersionOf({ "user-agent": "Codex Desktop/0.162.3", originator: "Codex Desktop" }),
    ).toBe("0.162.3");
    expect(codexVersionOf({ "user-agent": "claude-cli/2.1.302" })).toBeNull();
    expect(codexVersionOf({ "user-agent": "codex_cli_rs/dev-0.1.2" })).toBeNull();
  });

  test("without a Codex sample, the version is the newest of the built-in, cached, installed and seen ones", () => {
    const seen = new SeenCodexVersion();
    seen.saw({ "user-agent": "codex_cli_rs/0.171.0" });
    seen.saw({ "user-agent": "codex_cli_rs/0.165.0" });
    seen.saw({ "user-agent": "curl/8.4.0" });
    expect(seen.version()).toBe("0.171.0");
    expect(newestCodexVersion(["0.160.0", "0.170.2", seen.version()])).toBe("0.171.0");
    expect(newestCodexVersion([null, null, null])).toBe("0.159.0");
  });
});
