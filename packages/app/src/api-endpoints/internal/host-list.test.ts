import { describe, expect, it } from "vitest";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  agentsReturningToOfficial,
  endpointRowStatus,
  endpointSummary,
  groupHostEndpoints,
  previewAgentSettlements,
  selectHostEndpointsState,
} from "./host-list";

const NOW = new Date("2026-10-14T12:00:00.000Z");

function endpoint(overrides: Partial<ApiEndpoint> & { id: string }): ApiEndpoint {
  return {
    provider: "claude",
    name: overrides.id,
    baseUrl: "https://relay.example",
    baseUrls: [{ format: "anthropic_messages", url: "https://relay.example" }],
    models: [{ id: "claude-sonnet-4-5" }],
    defaultModelId: "claude-sonnet-4-5",
    hasApiKey: true,
    enabled: true,
    cooldown: null,
    ...overrides,
  };
}

describe("selectHostEndpointsState", () => {
  it("is loading until the list arrives, and reads every agent's switch once it does", () => {
    expect(selectHostEndpointsState({ data: undefined, error: null })).toEqual({
      status: "loading",
    });
    const ready = selectHostEndpointsState({
      data: {
        requestId: "r",
        provider: "claude",
        endpoints: [endpoint({ id: "a" })],
        activeEndpointId: null,
        agents: { claude: { enabled: true, defaultModelId: "claude-sonnet-4-5" } },
        error: null,
      },
      error: null,
    });
    expect(ready).toEqual({
      status: "ready",
      endpoints: [endpoint({ id: "a" })],
      agents: { claude: { enabled: true, defaultModelId: "claude-sonnet-4-5" } },
      gatewayUnavailable: null,
    });
  });

  it("reports the daemon's error, and a failed request", () => {
    const fromDaemon = selectHostEndpointsState({
      data: {
        requestId: "r",
        provider: "claude",
        endpoints: [],
        activeEndpointId: null,
        error: { code: "endpoints_unparsable", message: "endpoints.json could not be parsed" },
      },
      error: null,
    });
    expect(fromDaemon).toEqual({
      status: "error",
      message: "endpoints.json could not be parsed",
    });
    expect(selectHostEndpointsState({ data: undefined, error: new Error("offline") })).toEqual({
      status: "error",
      message: "offline",
    });
  });
});

describe("groupHostEndpoints", () => {
  it("splits by the endpoint switch and keeps creation order inside each group", () => {
    const groups = groupHostEndpoints([
      endpoint({ id: "a" }),
      endpoint({ id: "b", enabled: false }),
      endpoint({ id: "c" }),
    ]);
    expect(groups.enabled.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(groups.disabled.map((entry) => entry.id)).toEqual(["b"]);
  });
});

describe("endpointRowStatus", () => {
  it("is available when on and not resting", () => {
    expect(endpointRowStatus(endpoint({ id: "a" }), NOW)).toEqual({
      kind: "available",
      tone: "success",
    });
  });

  it("counts the cooldown down in whole minutes, rounding up, and in hours past an hour", () => {
    const cooling = endpoint({
      id: "a",
      cooldown: { state: "cooling_down", reason: "rate", until: "2026-10-14T12:11:01.000Z" },
    });
    expect(endpointRowStatus(cooling, NOW)).toEqual({
      kind: "cooling",
      tone: "warning",
      remaining: { unit: "minutes", value: 12 },
    });
    const long = endpoint({
      id: "a",
      cooldown: { state: "cooling_down", reason: "quota", until: "2026-10-14T14:30:00.000Z" },
    });
    expect(endpointRowStatus(long, NOW)).toEqual({
      kind: "cooling",
      tone: "warning",
      remaining: { unit: "hours", value: 3 },
    });
    const elapsed = endpoint({
      id: "a",
      cooldown: { state: "cooling_down", reason: "rate", until: "2026-10-14T11:59:00.000Z" },
    });
    expect(endpointRowStatus(elapsed, NOW)).toEqual({
      kind: "cooling",
      tone: "warning",
      remaining: { unit: "minutes", value: 1 },
    });
  });

  it("needs a check after a rejected key, and an unknown state reads as available", () => {
    const rejected = endpoint({
      id: "a",
      cooldown: { state: "needs_check", reason: "auth", until: null },
    });
    expect(endpointRowStatus(rejected, NOW)).toEqual({ kind: "needsCheck", tone: "danger" });
    const future = endpoint({
      id: "a",
      cooldown: { state: "a_future_state", reason: "other", until: null },
    });
    expect(endpointRowStatus(future, NOW)).toEqual({ kind: "available", tone: "success" });
  });

  it("is off whatever its cooldown when the switch is off", () => {
    const off = endpoint({
      id: "a",
      enabled: false,
      cooldown: { state: "needs_check", reason: "auth", until: null },
    });
    expect(endpointRowStatus(off, NOW)).toEqual({ kind: "disabled", tone: "muted" });
  });
});

describe("endpointSummary", () => {
  it("lists the known formats in a fixed order, the host of the first base URL and the model count", () => {
    const summary = endpointSummary(
      endpoint({
        id: "a",
        baseUrls: [
          { format: "openai_chat", url: "https://api.yunwu.ai/v1" },
          { format: "a_future_format", url: "https://api.yunwu.ai/future" },
          { format: "anthropic_messages", url: "https://api.yunwu.ai" },
        ],
        models: [{ id: "a" }, { id: "b" }],
      }),
    );
    expect(summary).toEqual({
      formats: ["anthropic_messages", "openai_chat"],
      host: "api.yunwu.ai",
      modelCount: 2,
    });
  });
});

describe("agentsReturningToOfficial", () => {
  const agents = {
    claude: { enabled: true, defaultModelId: "claude-sonnet-4-5" },
    codex: { enabled: false, defaultModelId: null },
  };

  it("names every agent that is on when the last endpoint with models is switched off", () => {
    const endpoints = [endpoint({ id: "a" }), endpoint({ id: "b", models: [] })];
    expect(agentsReturningToOfficial({ endpoints, agents, switchedOffId: "a" })).toEqual([
      "claude",
    ]);
  });

  it("names nobody while another endpoint that is on still has models", () => {
    const endpoints = [endpoint({ id: "a" }), endpoint({ id: "b", models: [{ id: "glm-4.6" }] })];
    expect(agentsReturningToOfficial({ endpoints, agents, switchedOffId: "a" })).toEqual([]);
    const othersOff = [endpoint({ id: "a" }), endpoint({ id: "b", enabled: false })];
    expect(agentsReturningToOfficial({ endpoints: othersOff, agents, switchedOffId: "a" })).toEqual(
      ["claude"],
    );
  });
});

describe("previewAgentSettlements", () => {
  const agents = {
    claude: { enabled: true, defaultModelId: "glm-4.6" },
    codex: { enabled: true, defaultModelId: "gpt-5" },
    copilot: { enabled: false, defaultModelId: null },
  };

  it("keeps a default that is still offered and moves a missing one to the earliest endpoint's first model", () => {
    const after = [
      endpoint({ id: "off", enabled: false, models: [{ id: "gpt-5" }] }),
      endpoint({ id: "a", models: [{ id: "kimi-k2" }, { id: "glm-4.6" }] }),
      endpoint({ id: "b", models: [{ id: "deepseek-chat" }] }),
    ];

    expect(previewAgentSettlements({ endpoints: after, agents })).toEqual([
      { provider: "claude", kind: "kept" },
      { provider: "codex", kind: "defaultChanged", from: "gpt-5", to: "kimi-k2" },
    ]);
  });

  it("sends every agent that is on back to official when no model is left", () => {
    const after = [endpoint({ id: "a", models: [] })];

    expect(previewAgentSettlements({ endpoints: after, agents })).toEqual([
      { provider: "claude", kind: "official" },
      { provider: "codex", kind: "official" },
    ]);
  });
});
