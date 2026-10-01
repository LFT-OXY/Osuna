import { describe, expect, it } from "vitest";
import { groupProvidersByEnabled } from "./provider-placement";

describe("groupProvidersByEnabled", () => {
  it("keeps every enabled provider in Enabled, whatever its status", () => {
    const entries = [
      { provider: "claude", status: "ready", enabled: true },
      { provider: "codex", status: "unavailable", enabled: true },
      { provider: "pi", status: "loading", enabled: true },
      { provider: "omp", status: "error", enabled: true },
    ] as const;

    expect(groupProvidersByEnabled(entries)).toEqual({ enabled: entries, disabled: [] });
  });

  it("puts turned-off providers in Disabled, keeping snapshot order in both groups", () => {
    const claude = { provider: "claude", enabled: true };
    const copilot = { provider: "copilot", enabled: false };
    const codex = { provider: "codex", enabled: true };
    const opencode = { provider: "opencode", enabled: false };

    expect(groupProvidersByEnabled([claude, copilot, codex, opencode])).toEqual({
      enabled: [claude, codex],
      disabled: [copilot, opencode],
    });
  });
});
