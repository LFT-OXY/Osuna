import { describe, expect, it } from "vitest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { selectActiveApiEndpoint, selectInheritedApiEndpoint } from "./notices";

const RELAY = { id: "ep_1", name: "Relay" };

function entry(provider: string, activeApiEndpoint?: typeof RELAY): ProviderSnapshotEntry {
  return { provider, status: "ready", enabled: true, activeApiEndpoint };
}

describe("selectActiveApiEndpoint", () => {
  it("returns the endpoint the provider currently uses", () => {
    const entries = [entry("claude", RELAY), entry("codex")];
    expect(selectActiveApiEndpoint(entries, "claude")).toEqual(RELAY);
    expect(selectActiveApiEndpoint(entries, "codex")).toBeNull();
  });

  it("treats an unknown provider, missing entries, or an older host as Official", () => {
    expect(selectActiveApiEndpoint([entry("claude", RELAY)], "opencode")).toBeNull();
    expect(selectActiveApiEndpoint(undefined, "claude")).toBeNull();
    expect(selectActiveApiEndpoint([entry("claude", RELAY)], null)).toBeNull();
    expect(selectActiveApiEndpoint([entry("claude")], "claude")).toBeNull();
  });
});

describe("selectInheritedApiEndpoint", () => {
  const withClaudeEndpoint = [entry("claude", RELAY), entry("my-relay")];

  it("marks a custom provider that extends claude while Claude uses an endpoint", () => {
    expect(
      selectInheritedApiEndpoint({
        provider: "my-relay",
        extendsProvider: "claude",
        entries: withClaudeEndpoint,
      }),
    ).toEqual(RELAY);
  });

  it("shows nothing on Official", () => {
    expect(
      selectInheritedApiEndpoint({
        provider: "my-relay",
        extendsProvider: "claude",
        entries: [entry("claude"), entry("my-relay")],
      }),
    ).toBeNull();
  });

  it("leaves Claude itself and providers that don't extend claude alone", () => {
    expect(
      selectInheritedApiEndpoint({ provider: "claude", entries: withClaudeEndpoint }),
    ).toBeNull();
    // 只提示 claude（PRD「继承 claude 的自定义提供方」）。
    expect(
      selectInheritedApiEndpoint({
        provider: "my-codex",
        extendsProvider: "codex",
        entries: [entry("codex", RELAY), entry("my-codex")],
      }),
    ).toBeNull();
  });
});
