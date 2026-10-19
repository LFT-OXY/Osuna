import { describe, expect, it } from "vitest";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  agentsReturningToOfficial,
  arrangeEndpoint,
  endpointMoves,
  endpointRowStatus,
  endpointSummary,
  findEndpoints,
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
      // 老主机不发 agentIssues、reopenHints：提示区为空。
      agentIssues: {},
      reopenHints: {},
    });
  });

  it("reads each agent's settings issues", () => {
    const issue = { code: "config_unparsable", params: { file: "f", detail: "d" }, message: "m" };
    const ready = selectHostEndpointsState({
      data: {
        requestId: "r",
        provider: "claude",
        endpoints: [],
        activeEndpointId: null,
        agentIssues: { claude: [], codex: [issue] },
        error: null,
      },
      error: null,
    });
    expect(ready).toMatchObject({ agentIssues: { claude: [], codex: [issue] } });
  });

  it("reads who to reopen for each agent", () => {
    const hint = { kind: "osuna_sessions", count: 1, message: "1 Codex session" };
    const ready = selectHostEndpointsState({
      data: {
        requestId: "r",
        provider: "claude",
        endpoints: [],
        activeEndpointId: null,
        reopenHints: { claude: [], codex: [hint] },
        error: null,
      },
      error: null,
    });
    expect(ready).toMatchObject({ reopenHints: { claude: [], codex: [hint] } });
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

describe("arrangeEndpoint", () => {
  // 开着的 a、c、e，关着的 b、d，交错排着。
  const list = [
    endpoint({ id: "a" }),
    endpoint({ id: "b", enabled: false }),
    endpoint({ id: "c" }),
    endpoint({ id: "d", enabled: false }),
    endpoint({ id: "e" }),
  ];

  it("moves an endpoint among its own group; the other group keeps its places", () => {
    expect(arrangeEndpoint(list, "e", "up")).toEqual(["a", "b", "e", "d", "c"]);
    expect(arrangeEndpoint(list, "e", "top")).toEqual(["e", "b", "a", "d", "c"]);
    expect(arrangeEndpoint(list, "a", "down")).toEqual(["c", "b", "a", "d", "e"]);
    expect(arrangeEndpoint(list, "a", "bottom")).toEqual(["c", "b", "e", "d", "a"]);
    expect(arrangeEndpoint(list, "d", "up")).toEqual(["a", "d", "c", "b", "e"]);
  });

  it("puts a dragged endpoint where the row it was dropped on was", () => {
    expect(arrangeEndpoint(list, "a", { index: 2 })).toEqual(["c", "b", "e", "d", "a"]);
    expect(arrangeEndpoint(list, "e", { index: 1 })).toEqual(["a", "b", "e", "d", "c"]);
  });

  it("is null when nothing would move", () => {
    expect(arrangeEndpoint(list, "a", "up")).toBeNull();
    expect(arrangeEndpoint(list, "a", "top")).toBeNull();
    expect(arrangeEndpoint(list, "e", "down")).toBeNull();
    expect(arrangeEndpoint(list, "d", "bottom")).toBeNull();
    expect(arrangeEndpoint(list, "c", { index: 1 })).toBeNull();
    expect(arrangeEndpoint(list, "missing", "up")).toBeNull();
  });
});

describe("arrangeEndpoint while a search shows some rows", () => {
  // 开着的 a、c、e、g，关着的 b；搜索只显示 a、e、g 与 b。
  const list = [
    endpoint({ id: "a" }),
    endpoint({ id: "b", enabled: false }),
    endpoint({ id: "c" }),
    endpoint({ id: "e" }),
    endpoint({ id: "g" }),
  ];
  const shown = new Set(["a", "b", "e", "g"]);

  it("steps past the row shown next to it, and the hidden ones keep their order (as magpie shownToOn)", () => {
    expect(arrangeEndpoint(list, "e", "up", shown)).toEqual(["e", "b", "a", "c", "g"]);
    expect(arrangeEndpoint(list, "a", "down", shown)).toEqual(["c", "b", "e", "a", "g"]);
  });

  it("puts a dragged row where the shown row it was dropped on was", () => {
    expect(arrangeEndpoint(list, "g", { index: 1 }, shown)).toEqual(["a", "b", "c", "g", "e"]);
    expect(arrangeEndpoint(list, "a", { index: 2 }, shown)).toEqual(["c", "b", "e", "g", "a"]);
  });

  it("moves to the top or the bottom of the whole group", () => {
    expect(arrangeEndpoint(list, "e", "top", shown)).toEqual(["e", "b", "a", "c", "g"]);
    expect(arrangeEndpoint(list, "a", "bottom", shown)).toEqual(["c", "b", "e", "g", "a"]);
  });

  it("offers up and down by the rows shown, top and bottom by the whole group", () => {
    const hiddenFirst = new Set(["c", "e"]);
    expect(endpointMoves(list, "c", hiddenFirst)).toEqual({
      top: true,
      up: false,
      down: true,
      bottom: true,
    });
    expect(endpointMoves(list, "e", hiddenFirst)).toEqual({
      top: true,
      up: true,
      down: false,
      bottom: true,
    });
  });
});

describe("findEndpoints", () => {
  const relay = endpoint({
    id: "relay",
    name: "OpenRouter",
    baseUrls: [
      { format: "anthropic_messages", url: "https://openrouter.ai/api" },
      { format: "openai_chat", url: "https://gateway.example/v1" },
    ],
    models: [{ id: "z-ai/glm-4.6", label: "GLM 4.6" }],
    catalog: { fetchedAt: "2026-10-14T00:00:00.000Z", models: [{ id: "moonshot/kimi-k2" }] },
    manualModels: [{ id: "qwen3-coder" }],
  });
  const local = endpoint({
    id: "local",
    name: "Ollama",
    baseUrls: [{ format: "openai_chat", url: "http://127.0.0.1:11434/v1" }],
    models: [{ id: "llama3" }],
  });
  const ids = (query: string) => findEndpoints([relay, local], query).map((entry) => entry.id);

  it("keeps every endpoint while the box is empty", () => {
    expect(ids("")).toEqual(["relay", "local"]);
    expect(ids("   ")).toEqual(["relay", "local"]);
  });

  it("finds by name, by address and by model name, whatever the case", () => {
    expect(ids("openrouter")).toEqual(["relay"]);
    expect(ids("gateway.example")).toEqual(["relay"]);
    expect(ids("11434")).toEqual(["local"]);
    expect(ids("GLM")).toEqual(["relay"]);
    expect(ids("kimi-k2")).toEqual(["relay"]);
    expect(ids("qwen3")).toEqual(["relay"]);
    expect(ids("llama")).toEqual(["local"]);
  });

  it("keeps the rows that say every word typed", () => {
    expect(ids("open glm")).toEqual(["relay"]);
    expect(ids("ollama glm")).toEqual([]);
  });
});

describe("endpointMoves", () => {
  it("offers the moves that would change the order within the endpoint's group", () => {
    const list = [
      endpoint({ id: "a" }),
      endpoint({ id: "b", enabled: false }),
      endpoint({ id: "c" }),
    ];
    expect(endpointMoves(list, "a")).toEqual({ top: false, up: false, down: true, bottom: true });
    expect(endpointMoves(list, "c")).toEqual({ top: true, up: true, down: false, bottom: false });
    expect(endpointMoves(list, "b")).toEqual({
      top: false,
      up: false,
      down: false,
      bottom: false,
    });
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
