import { describe, expect, it } from "vitest";
import type { ProviderSnapshotEntry } from "@osuna/protocol/agent-types";
import {
  describeApiEndpointModeMismatch,
  selectActiveApiEndpoint,
  selectInheritedApiEndpoint,
} from "./notices";

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

describe("describeApiEndpointModeMismatch", () => {
  const prefix = "agentStream.apiEndpointMode";

  it("names the endpoint a session was created with when it's now Official", () => {
    expect(describeApiEndpointModeMismatch({ createdIn: RELAY, current: null })).toEqual({
      key: `${prefix}.endpointToOfficial`,
      params: { created: "Relay" },
    });
  });

  it("says the endpoint was deleted when the name is gone", () => {
    expect(
      describeApiEndpointModeMismatch({ createdIn: { id: "ep_1", name: null }, current: null }),
    ).toEqual({ key: `${prefix}.deletedToOfficial`, params: {} });
    expect(
      describeApiEndpointModeMismatch({
        createdIn: { id: "ep_1", name: null },
        current: { id: "ep_2", name: "Other" },
      }),
    ).toEqual({ key: `${prefix}.deletedToEndpoint`, params: { current: "Other" } });
  });

  it("names the current endpoint for a session created on Official", () => {
    expect(describeApiEndpointModeMismatch({ createdIn: null, current: RELAY })).toEqual({
      key: `${prefix}.officialToEndpoint`,
      params: { current: "Relay" },
    });
  });

  it("leaves the daemon's text for other notifications and when both sides are Official", () => {
    expect(describeApiEndpointModeMismatch(undefined)).toBeNull();
    expect(describeApiEndpointModeMismatch({ createdIn: null, current: null })).toBeNull();
  });

  it("names both endpoints when a session moves between two of them", () => {
    expect(
      describeApiEndpointModeMismatch({ createdIn: RELAY, current: { id: "ep_2", name: "Other" } }),
    ).toEqual({
      key: `${prefix}.endpointToEndpoint`,
      params: { created: "Relay", current: "Other" },
    });
  });
});
