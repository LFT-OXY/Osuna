import { describe, expect, it } from "vitest";
import type {
  ApiEndpoint,
  ApiEndpointAgentIssue,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { ApiEndpointModelGroup } from "@getpaseo/protocol/agent-types";
import { selectAgentApiEndpointsView } from "./agent-settings";

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

function view(input: {
  endpoints: ApiEndpoint[];
  endpointModelGroups?: ApiEndpointModelGroup[] | null;
  enabled?: boolean;
  defaultModelId?: string | null;
  defaultThinkingOptionId?: string | null;
  gatewayUnavailable?: { code: string; message: string } | null;
  agentIssues?: Record<string, ApiEndpointAgentIssue[]>;
}) {
  return selectAgentApiEndpointsView({
    state: {
      status: "ready",
      endpoints: input.endpoints,
      agents: {
        claude: {
          enabled: input.enabled ?? false,
          defaultModelId: input.defaultModelId ?? null,
          defaultThinkingOptionId: input.defaultThinkingOptionId,
        },
      },
      gatewayUnavailable: input.gatewayUnavailable ?? null,
      agentIssues: input.agentIssues ?? {},
    },
    provider: "claude",
    endpointModelGroups: input.endpointModelGroups ?? null,
    now: NOW,
  });
}

describe("the Use API endpoints switch on an agent page", () => {
  it("can be turned on when an endpoint that is on has a model selected", () => {
    expect(view({ endpoints: [endpoint({ id: "a" })] })).toMatchObject({
      enabled: false,
      enableBlockedBy: null,
    });
  });

  it("cannot be turned on while every endpoint is off or has no model selected", () => {
    expect(view({ endpoints: [] }).enableBlockedBy).toEqual({ kind: "noUsableEndpoint" });
    expect(
      view({
        endpoints: [endpoint({ id: "a", enabled: false }), endpoint({ id: "b", models: [] })],
      }).enableBlockedBy,
    ).toEqual({ kind: "noUsableEndpoint" });
  });

  it("cannot be turned on while the gateway is unavailable, and says why", () => {
    const issue = { code: "gateway_requires_tcp", message: "needs TCP" };
    expect(
      view({ endpoints: [endpoint({ id: "a" })], gatewayUnavailable: issue }).enableBlockedBy,
    ).toEqual({ kind: "gateway", issue });
  });

  it("can always be turned off", () => {
    expect(view({ endpoints: [], enabled: true }).enableBlockedBy).toBeNull();
  });
});

describe("the default model on an agent page", () => {
  it("lists each selected model of the endpoints that are on once, in creation order", () => {
    const result = view({
      enabled: true,
      defaultModelId: "b1",
      endpoints: [
        endpoint({ id: "a", models: [{ id: "shared" }, { id: "a1" }] }),
        endpoint({ id: "off", enabled: false, models: [{ id: "off1" }] }),
        endpoint({ id: "b", models: [{ id: "b1" }, { id: "shared" }] }),
      ],
    });
    expect(result.modelOptions.map((option) => option.id)).toEqual(["shared", "a1", "b1"]);
    expect(result.defaultModelId).toBe("b1");
  });

  it("lists each endpoint's models after the bare names, from the model selector's groups", () => {
    const groupModel = (id: string) => ({ provider: "claude", id, label: "shared" });
    const result = view({
      enabled: true,
      defaultModelId: "relay-b/shared",
      endpoints: [
        endpoint({ id: "a", name: "Relay A", models: [{ id: "shared" }] }),
        endpoint({ id: "b", name: "Relay B", models: [{ id: "shared" }] }),
      ],
      endpointModelGroups: [
        { name: "Relay A", models: [groupModel("relay-a/shared")] },
        { name: "Relay B", models: [groupModel("relay-b/shared")] },
      ],
    });
    expect(result.modelOptions).toEqual([
      { id: "shared", model: "shared", endpointName: null },
      { id: "relay-a/shared", model: "shared", endpointName: "Relay A" },
      { id: "relay-b/shared", model: "shared", endpointName: "Relay B" },
    ]);
    expect(result.defaultModel).toEqual({
      id: "relay-b/shared",
      model: "shared",
      endpointName: "Relay B",
    });
  });

  it("shows a default model no option names as it is", () => {
    const result = view({
      enabled: true,
      defaultModelId: "gone/x",
      endpoints: [endpoint({ id: "a" })],
    });
    expect(result.defaultModel).toEqual({ id: "gone/x", model: "gone/x", endpointName: null });
  });
});

describe("the manage API endpoints summary", () => {
  it("counts the endpoints that are on and names the one cooling down that recovers first", () => {
    const result = view({
      endpoints: [
        endpoint({ id: "a" }),
        endpoint({
          id: "Kimi",
          cooldown: { state: "cooling_down", reason: "quota", until: "2026-10-14T12:12:00.000Z" },
        }),
        endpoint({
          id: "c",
          cooldown: { state: "cooling_down", reason: "rate", until: "2026-10-14T12:40:00.000Z" },
        }),
        endpoint({
          id: "off",
          enabled: false,
          cooldown: { state: "cooling_down", reason: "rate", until: "2026-10-14T12:01:00.000Z" },
        }),
      ],
    });
    expect(result.summary).toEqual({
      enabledCount: 3,
      cooling: { name: "Kimi", remaining: { unit: "minutes", value: 12 } },
    });
  });

  it("has no cooling part when nothing is cooling down", () => {
    expect(view({ endpoints: [endpoint({ id: "a" })] }).summary).toEqual({
      enabledCount: 1,
      cooling: null,
    });
  });
});

describe("the settings issues on an agent page", () => {
  const notThroughGateway: ApiEndpointAgentIssue = {
    code: "not_through_gateway",
    params: { file: "/home/me/.claude/settings.json", keys: "env.ANTHROPIC_BASE_URL" },
    message: "Claude Code no longer goes through the gateway",
  };

  it("shows only this agent's issues, each with what it can do", () => {
    const result = view({
      endpoints: [endpoint({ id: "a" })],
      enabled: true,
      agentIssues: {
        claude: [notThroughGateway],
        codex: [{ code: "config_unparsable", params: { file: "c", detail: "d" }, message: "x" }],
      },
    });
    expect(result.issues).toEqual([
      {
        kind: "notThroughGateway",
        params: notThroughGateway.params,
        message: notThroughGateway.message,
        actions: ["reapply", "switchToOfficial", "keepCurrent"],
        hasFixSteps: false,
      },
    ]);
  });

  it("explains a file it can't read and a Codex profile without offering actions", () => {
    const result = view({
      endpoints: [],
      agentIssues: {
        claude: [
          { code: "config_unparsable", params: { file: "f", detail: "bad" }, message: "m1" },
          {
            code: "codex_profile_override",
            params: { file: "f", profile: "work", keys: "model" },
            message: "m2",
          },
        ],
      },
    });
    expect(result.issues.map((issue) => [issue.kind, issue.actions])).toEqual([
      ["configUnparsable", []],
      ["codexProfileOverride", []],
    ]);
  });

  it("offers fix steps with Switch to official and Keep current for a bypass Osuna can't undo", () => {
    const issue = (source: string) => ({
      code: "cloud_switch_on",
      params: { source, key: "CLAUDE_CODE_USE_BEDROCK", cloud: "Amazon Bedrock" },
      message: "cloud",
    });
    const result = view({
      endpoints: [],
      agentIssues: {
        claude: [
          { code: "managed_base_url", params: { file: "f", url: "u" }, message: "managed" },
          issue("managed"),
          issue("shell"),
          issue("settings"),
        ],
      },
    });
    expect(result.issues.map((item) => [item.kind, item.actions, item.hasFixSteps])).toEqual([
      ["managedBaseUrl", ["switchToOfficial", "keepCurrent"], true],
      ["cloudSwitchOn", ["switchToOfficial", "keepCurrent"], true],
      ["cloudSwitchOn", ["switchToOfficial", "keepCurrent"], true],
      // 又写回 settings.json 的：重新应用会再拿掉它。
      ["cloudSwitchOn", ["reapply", "switchToOfficial", "keepCurrent"], false],
    ]);
  });

  it("offers fix steps, not actions, for a settings file with comments", () => {
    const result = view({
      endpoints: [],
      agentIssues: {
        claude: [
          {
            code: "settings_has_comments",
            params: { file: "/home/me/.claude/settings.json" },
            message: "has comments",
          },
        ],
      },
    });
    expect(result.issues).toEqual([
      {
        kind: "settingsHasComments",
        params: { file: "/home/me/.claude/settings.json" },
        message: "has comments",
        actions: [],
        hasFixSteps: true,
      },
    ]);
  });

  it("shows the host's own words for a case it does not know", () => {
    const result = view({
      endpoints: [],
      agentIssues: { claude: [{ code: "a_future_case", message: "Something new happened" }] },
    });
    expect(result.issues).toEqual([
      {
        kind: "unknown",
        params: {},
        message: "Something new happened",
        actions: [],
        hasFixSteps: false,
      },
    ]);
  });

  it("has no issues when the host sends none", () => {
    expect(view({ endpoints: [] }).issues).toEqual([]);
  });

  it("offers to apply again or change Keep claude.ai sign-in when the token doesn't match it", () => {
    const result = view({
      endpoints: [],
      agentIssues: {
        claude: [
          { code: "claude_ai_login_token_set", params: { file: "f" }, message: "set" },
          {
            code: "claude_ai_login_token_empty",
            params: { file: "f", how: "missing" },
            message: "empty",
          },
        ],
      },
    });
    expect(result.issues.map((item) => [item.kind, item.actions, item.hasFixSteps])).toEqual([
      ["claudeAiLoginTokenSet", ["reapply", "stopKeepingClaudeAiLogin"], false],
      ["claudeAiLoginTokenEmpty", ["keepClaudeAiLogin", "reapply"], false],
    ]);
  });
});

describe("Keep claude.ai sign-in on an agent page", () => {
  it("is off unless the host says it is on, and Codex has no such option", () => {
    expect(view({ endpoints: [] }).keepsClaudeAiLogin).toBe(false);
    const kept = selectAgentApiEndpointsView({
      state: {
        status: "ready",
        endpoints: [],
        agents: {
          claude: { enabled: false, defaultModelId: null, keepsClaudeAiLogin: true },
          codex: { enabled: false, defaultModelId: null },
        },
        gatewayUnavailable: null,
        agentIssues: {},
      },
      provider: "claude",
      endpointModelGroups: null,
      now: NOW,
    });
    expect(kept.keepsClaudeAiLogin).toBe(true);
    const codex = selectAgentApiEndpointsView({
      state: {
        status: "ready",
        endpoints: [],
        agents: { codex: { enabled: false, defaultModelId: null } },
        gatewayUnavailable: null,
        agentIssues: {},
      },
      provider: "codex",
      endpointModelGroups: null,
      now: NOW,
    });
    expect(codex.keepsClaudeAiLogin).toBeNull();
  });
});

describe("the default thinking on an agent page", () => {
  const thinkingOptions = [
    { id: "low", label: "Low" },
    { id: "high", label: "High" },
    { id: "max", label: "Max" },
  ];
  const groups: ApiEndpointModelGroup[] = [
    {
      name: "Relay A",
      models: [
        { provider: "claude", id: "relay-a/glm-5.3", label: "glm-5.3", thinkingOptions },
        {
          provider: "claude",
          id: "relay-a/kimi-k2",
          label: "kimi-k2",
          thinkingOptions: [{ id: "high", label: "High" }],
        },
      ],
    },
  ];
  const endpoints = [endpoint({ id: "a", models: [{ id: "glm-5.3" }, { id: "kimi-k2" }] })];

  it("offers the default model's levels, as the chat model selector has them", () => {
    const shown = view({
      endpoints,
      endpointModelGroups: groups,
      enabled: true,
      defaultModelId: "glm-5.3",
      defaultThinkingOptionId: "high",
    });
    expect(shown.defaultThinking).toEqual({ value: "high", options: thinkingOptions });
  });

  it("reads the levels of the endpoint a default model names", () => {
    const shown = view({
      endpoints,
      endpointModelGroups: groups,
      enabled: true,
      defaultModelId: "relay-a/kimi-k2",
    });
    expect(shown.defaultThinking).toEqual({
      value: null,
      options: [{ id: "high", label: "High" }],
    });
  });

  it("is not offered while the switch is off, the model has no levels, or the host is too old", () => {
    expect(
      view({ endpoints, endpointModelGroups: groups, defaultModelId: "glm-5.3" }).defaultThinking,
    ).toBeNull();
    expect(
      view({ endpoints, endpointModelGroups: null, enabled: true, defaultModelId: "glm-5.3" })
        .defaultThinking,
    ).toBeNull();
    const levelless: ApiEndpointModelGroup[] = [
      {
        name: "Relay A",
        models: [{ provider: "claude", id: "relay-a/glm-5.3", label: "glm-5.3" }],
      },
    ];
    expect(
      view({ endpoints, endpointModelGroups: levelless, enabled: true, defaultModelId: "glm-5.3" })
        .defaultThinking,
    ).toBeNull();
  });
});
