import { describe, expect, test } from "vitest";

import { buildProviderCommand, buildProviderCommandArgv } from "@/utils/provider-command-templates";

describe("buildProviderCommand", () => {
  test("builds Hermes resume commands from native session ids", () => {
    expect(
      buildProviderCommand({
        provider: "hermes",
        id: "resume",
        sessionId: "20260813_111500_abc123",
      }),
    ).toBe("hermes --resume 20260813_111500_abc123");
  });

  test("builds OpenCode resume commands from native session ids", () => {
    expect(
      buildProviderCommand({
        provider: "opencode",
        id: "resume",
        sessionId: "ses_abc123",
      }),
    ).toBe("opencode --session ses_abc123");
  });

  test("builds Copilot resume commands with the id attached to the flag", () => {
    expect(
      buildProviderCommand({
        provider: "copilot",
        id: "resume",
        sessionId: "sess-1",
      }),
    ).toBe("copilot --resume=sess-1");
  });

  test("returns null for a provider without a template", () => {
    expect(buildProviderCommand({ provider: "gemini", id: "resume", sessionId: "x" })).toBeNull();
  });
});

describe("buildProviderCommandArgv", () => {
  test("splits the template into a command and argv without splitting the session id", () => {
    expect(
      buildProviderCommandArgv({
        provider: "claude",
        id: "resume",
        sessionId: "id with spaces",
      }),
    ).toEqual({ command: "claude", args: ["--resume", "id with spaces"] });
  });

  test("substitutes inside a single token", () => {
    expect(
      buildProviderCommandArgv({ provider: "copilot", id: "resume", sessionId: "sess-1" }),
    ).toEqual({ command: "copilot", args: ["--resume=sess-1"] });
  });

  test("returns null for a provider without a template", () => {
    expect(
      buildProviderCommandArgv({ provider: "gemini", id: "resume", sessionId: "x" }),
    ).toBeNull();
  });
});
