import { describe, expect, it } from "vitest";
import type {
  ApiEndpoint,
  ApiEndpointAgentIssue,
  ApiEndpointReopenHint,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { ApiEndpointModelGroup } from "@getpaseo/protocol/agent-types";
import type { ApiEndpointNameDisplay } from "@getpaseo/protocol/api-endpoint/endpoint-names";
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
  provider?: string;
  endpoints: ApiEndpoint[];
  endpointModelGroups?: ApiEndpointModelGroup[] | null;
  enabled?: boolean;
  defaultModelId?: string | null;
  defaultThinkingOptionId?: string | null;
  usesUltraCode?: boolean;
  backgroundModelId?: string | null;
  subagentModelId?: string | null;
  subagentThinkingOptionId?: string | null;
  memoryModelId?: string | null;
  forcedSubagentModelId?: string | null;
  allowsAnySubagentModel?: boolean;
  lockedThinkingOptionId?: string | null;
  subagentThinkingOptions?: { id: string; label: string }[] | null;
  sideModelOptions?: { id: string; model: string; endpointName: string | null }[];
  gatewayUnavailable?: { code: string; message: string } | null;
  agentIssues?: Record<string, ApiEndpointAgentIssue[]>;
  reopenHints?: Record<string, ApiEndpointReopenHint[]>;
  endpointNameDisplay?: ApiEndpointNameDisplay;
}) {
  return selectAgentApiEndpointsView({
    state: {
      status: "ready",
      endpoints: input.endpoints,
      agents: {
        [input.provider ?? "claude"]: {
          enabled: input.enabled ?? false,
          defaultModelId: input.defaultModelId ?? null,
          defaultThinkingOptionId: input.defaultThinkingOptionId,
          usesUltraCode: input.usesUltraCode,
          backgroundModelId: input.backgroundModelId,
          subagentModelId: input.subagentModelId,
          subagentThinkingOptionId: input.subagentThinkingOptionId,
          memoryModelId: input.memoryModelId,
          forcedSubagentModelId: input.forcedSubagentModelId,
          allowsAnySubagentModel: input.allowsAnySubagentModel,
        },
      },
      gatewayUnavailable: input.gatewayUnavailable ?? null,
      agentIssues: input.agentIssues ?? {},
      reopenHints: input.reopenHints ?? {},
      longConversations: {},
      disabledModels: [],
      endpointNameDisplay: input.endpointNameDisplay ?? "always",
      endpointNamesUnreached: [],
      balanceAutoRefresh: true,
    },
    provider: input.provider ?? "claude",
    endpointModelGroups: input.endpointModelGroups ?? null,
    lockedThinkingOptionId: input.lockedThinkingOptionId ?? null,
    subagentThinkingOptions: input.subagentThinkingOptions ?? null,
    sideModelOptions: input.sideModelOptions ?? [],
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

  it("the endpoint's name follows a model as the host's Endpoint name in model lists says: always, only when names clash, never", () => {
    const groupModel = (id: string, label: string) => ({ provider: "claude", id, label });
    const shown = (endpointNameDisplay: ApiEndpointNameDisplay) =>
      view({
        enabled: true,
        defaultModelId: "relay-a/glm-5",
        endpointNameDisplay,
        endpoints: [
          endpoint({ id: "a", name: "Relay A", models: [{ id: "Shared" }, { id: "glm-5" }] }),
          endpoint({ id: "b", name: "Relay B", models: [{ id: "shared" }] }),
        ],
        endpointModelGroups: [
          {
            name: "Relay A",
            models: [groupModel("relay-a/Shared", "Shared"), groupModel("relay-a/glm-5", "glm-5")],
          },
          { name: "Relay B", models: [groupModel("relay-b/shared", "shared")] },
        ],
      });
    const named = (endpointNameDisplay: ApiEndpointNameDisplay) =>
      shown(endpointNameDisplay).modelOptions.map((option) => [option.id, option.endpointName]);
    expect(named("always")).toEqual([
      ["Shared", null],
      ["glm-5", null],
      ["shared", null],
      ["relay-a/Shared", "Relay A"],
      ["relay-a/glm-5", "Relay A"],
      ["relay-b/shared", "Relay B"],
    ]);
    // 同名按整个下拉里显示的名字算、不分大小写（照 magpie）：光秃秃的 glm-5 与 relay-a/glm-5 都叫 glm-5。
    expect(named("clash")).toEqual([
      ["Shared", null],
      ["glm-5", null],
      ["shared", null],
      ["relay-a/Shared", "Relay A"],
      ["relay-a/glm-5", "Relay A"],
      ["relay-b/shared", "Relay B"],
    ]);
    expect(shown("clash").defaultModel).toEqual({
      id: "relay-a/glm-5",
      model: "glm-5",
      endpointName: "Relay A",
    });
    // 只有指定某一家的选项、没有同名的：不带。
    const lone = view({
      enabled: true,
      endpointNameDisplay: "clash",
      endpoints: [endpoint({ id: "a", name: "Relay A", models: [] })],
      endpointModelGroups: [
        { name: "Relay A", models: [groupModel("relay-a/kimi-k2", "kimi-k2")] },
      ],
    });
    expect(lone.modelOptions).toEqual([
      { id: "relay-a/kimi-k2", model: "kimi-k2", endpointName: null },
    ]);
    expect(named("never").every(([, endpointName]) => endpointName === null)).toBe(true);
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

  it("offers fix steps, not actions, when Codex's own multi_agent_v2 overrides Subagents on any model or can't be checked", () => {
    const result = view({
      provider: "codex",
      endpoints: [],
      agentIssues: {
        codex: [
          { code: "codex_multi_agent_v2_on", params: { file: "c.toml" }, message: "on" },
          {
            code: "codex_multi_agent_v2_unreadable",
            params: { file: "c.toml", detail: "bad" },
            message: "unreadable",
          },
        ],
      },
    });
    expect(result.issues).toEqual([
      {
        kind: "codexMultiAgentV2On",
        params: { file: "c.toml" },
        message: "on",
        actions: [],
        hasFixSteps: true,
      },
      {
        kind: "codexMultiAgentV2Unreadable",
        params: { file: "c.toml", detail: "bad" },
        message: "unreadable",
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

  it("offers to apply again or keep the CLI's model when it was switched to one no endpoint serves", () => {
    const result = view({
      endpoints: [],
      agentIssues: {
        claude: [
          {
            code: "model_replaced",
            params: { file: "f", model: "gpt-9", defaultModel: "glm-4.6" },
            message: "replaced",
          },
        ],
      },
    });
    expect(result.issues.map((item) => [item.kind, item.actions, item.hasFixSteps])).toEqual([
      ["modelReplaced", ["reapply", "keepReplacedModel"], false],
    ]);
  });

  it("offers to apply again or switch to official when the CLI was used without going through the gateway", () => {
    const params = { how: "used", at: "2026-10-18T09:12:00.000Z" };
    const result = view({
      endpoints: [],
      agentIssues: { codex: [{ code: "bypassed", params, message: "bypassed" }] },
      provider: "codex",
    });
    expect(result.issues).toEqual([
      {
        kind: "bypassed",
        params,
        message: "bypassed",
        actions: ["reapply", "switchToOfficial"],
        hasFixSteps: false,
      },
    ]);
  });

  it("Codex behind a proxy that doesn't pass its requests on: How to fix and Switch to official", () => {
    const params = {
      host: "127.0.0.1:6769",
      proxy: "http://127.0.0.1:7890",
      from: "HTTP_PROXY",
      fix: "environment",
    };
    const result = view({
      endpoints: [],
      agentIssues: { codex: [{ code: "codex_proxied", params, message: "proxied" }] },
      provider: "codex",
    });
    expect(result.issues).toEqual([
      {
        kind: "codexProxied",
        params,
        message: "proxied",
        actions: ["switchToOfficial"],
        hasFixSteps: true,
      },
    ]);
  });
});

describe("who to reopen on an agent page", () => {
  it("reads each kind the host reports, and keeps one it doesn't know, or one missing what it needs, as its message", () => {
    const result = view({
      endpoints: [],
      provider: "codex",
      reopenHints: {
        claude: [{ kind: "cli", count: 9, since: "2026-10-19T08:00:00.000Z", message: "claude" }],
        codex: [
          { kind: "osuna_sessions", count: 2, message: "2 sessions" },
          { kind: "cli", count: 1, since: "2026-10-19T08:00:00.000Z", message: "terminal" },
          { kind: "ide", count: 1, since: "not a time", message: "editor" },
          {
            kind: "app",
            count: 1,
            since: "2026-10-19T07:30:00.000Z",
            app: "ChatGPT",
            message: "app",
          },
          {
            kind: "embedded",
            count: 1,
            since: "2026-10-19T07:00:00.000Z",
            app: "Agents Anywhere",
            message: "embedded",
          },
          {
            kind: "app_server",
            since: "2026-10-19T06:00:00.000Z",
            command: "codex app-server daemon restart",
            message: "app-server",
          },
          { kind: "app_server_restarted", since: "2026-10-19T06:00:00.000Z", message: "restarted" },
          { kind: "claude_live_env", message: "env" },
          { kind: "a_future_kind", message: "something new" },
        ],
      },
    });
    expect(result.reopen).toEqual([
      { kind: "osunaSessions", count: 2 },
      { kind: "cli", count: 1, since: new Date("2026-10-19T08:00:00.000Z") },
      { kind: "unknown", message: "editor" },
      { kind: "app", app: "ChatGPT", since: new Date("2026-10-19T07:30:00.000Z") },
      { kind: "embedded", app: "Agents Anywhere", since: new Date("2026-10-19T07:00:00.000Z") },
      {
        kind: "appServer",
        since: new Date("2026-10-19T06:00:00.000Z"),
        command: "codex app-server daemon restart",
      },
      { kind: "appServerRestarted" },
      { kind: "liveEnv" },
      { kind: "unknown", message: "something new" },
    ]);
  });

  it("is empty for a host that doesn't report it", () => {
    expect(view({ endpoints: [] }).reopen).toEqual([]);
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
        reopenHints: {},
        longConversations: {},
        disabledModels: [],
        endpointNameDisplay: "always",
        endpointNamesUnreached: [],
        balanceAutoRefresh: true,
      },
      provider: "claude",
      endpointModelGroups: null,
      lockedThinkingOptionId: null,
      subagentThinkingOptions: null,
      sideModelOptions: [],
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
        reopenHints: {},
        longConversations: {},
        disabledModels: [],
        endpointNameDisplay: "always",
        endpointNamesUnreached: [],
        balanceAutoRefresh: true,
      },
      provider: "codex",
      endpointModelGroups: null,
      lockedThinkingOptionId: null,
      subagentThinkingOptions: null,
      sideModelOptions: [],
      now: NOW,
    });
    expect(codex.keepsClaudeAiLogin).toBeNull();
  });
});

describe("the default thinking on an agent page", () => {
  const thinkingOptions = [
    { id: "low", label: "Low" },
    { id: "high", label: "High" },
    { id: "xhigh", label: "Extra High" },
    { id: "ultracode", label: "Ultra Code" },
  ];
  const groups: ApiEndpointModelGroup[] = [
    {
      name: "Relay A",
      models: [
        { provider: "claude", id: "relay-a/glm-5.3", label: "glm-5.3", thinkingOptions },
        {
          provider: "claude",
          id: "relay-a/claude-opus-4-6",
          label: "claude-opus-4-6",
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
            { id: "max", label: "Max" },
          ],
        },
      ],
    },
  ];
  const endpoints = [endpoint({ id: "a", models: [{ id: "glm-5.3" }, { id: "claude-opus-4-6" }] })];

  it("offers the default model's levels and Ultra Code as its own switch", () => {
    const shown = view({
      endpoints,
      endpointModelGroups: groups,
      enabled: true,
      defaultModelId: "glm-5.3",
      defaultThinkingOptionId: "high",
      usesUltraCode: true,
    });
    expect(shown.defaultThinking).toEqual({
      value: "high",
      options: thinkingOptions.slice(0, 3),
      usesUltraCode: true,
      lockedAt: null,
    });
  });

  it("shows the level the host reports, and no Ultra Code without xhigh", () => {
    const shown = view({
      endpoints,
      endpointModelGroups: groups,
      enabled: true,
      defaultModelId: "relay-a/claude-opus-4-6",
      defaultThinkingOptionId: "high",
      usesUltraCode: true,
    });
    expect(shown.defaultThinking).toMatchObject({ value: "high", usesUltraCode: null });
  });

  it("says every session is locked when the host says so", () => {
    const shown = view({
      endpoints,
      endpointModelGroups: groups,
      enabled: true,
      defaultModelId: "glm-5.3",
      lockedThinkingOptionId: "max",
    });
    expect(shown.defaultThinking?.lockedAt).toBe("max");
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

describe("the background task and Subagent models on the Claude Code page", () => {
  const endpoints = [endpoint({ id: "a", models: [{ id: "glm-5.3" }, { id: "claude-opus-4-6" }] })];
  const groups: ApiEndpointModelGroup[] = [
    {
      name: "Relay A",
      models: [
        { provider: "claude", id: "relay-a/glm-5.3", label: "glm-5.3" },
        { provider: "claude", id: "relay-a/claude-opus-4-6", label: "claude-opus-4-6" },
      ],
    },
  ];
  const levels = [
    { id: "low", label: "Low" },
    { id: "max", label: "Max" },
  ];

  it("shows the models the host reports, and the Subagent thinking's levels as the host gives them", () => {
    const shown = view({
      endpoints,
      endpointModelGroups: groups,
      enabled: true,
      defaultModelId: "glm-5.3",
      backgroundModelId: "relay-a/claude-opus-4-6",
      subagentModelId: "claude-opus-4-6",
      subagentThinkingOptionId: "max",
      subagentThinkingOptions: levels,
    });
    expect(shown.sideModels).toEqual({
      backgroundModel: {
        id: "relay-a/claude-opus-4-6",
        model: "claude-opus-4-6",
        endpointName: "Relay A",
      },
      subagentModel: { id: "claude-opus-4-6", model: "claude-opus-4-6", endpointName: null },
      subagentThinking: { value: "max", options: levels },
    });
  });

  it("follows the default model while nothing is set", () => {
    const shown = view({
      endpoints,
      endpointModelGroups: groups,
      enabled: true,
      defaultModelId: "glm-5.3",
      subagentThinkingOptions: levels,
    });
    expect(shown.sideModels).toEqual({
      backgroundModel: null,
      subagentModel: null,
      subagentThinking: { value: null, options: levels },
    });
  });

  it("is not offered while the switch is off, or by a host without them", () => {
    const off = view({ endpoints, endpointModelGroups: groups, subagentThinkingOptions: levels });
    expect(off.sideModels).toBeNull();
    const old = view({
      endpoints,
      endpointModelGroups: groups,
      enabled: true,
      defaultModelId: "glm-5.3",
      subagentThinkingOptions: null,
    });
    expect(old.sideModels).toBeNull();
  });
});

describe("Codex's default Subagent model and memory model", () => {
  const endpoints = [endpoint({ id: "a", models: [{ id: "glm-5.3" }, { id: "kimi-k2" }] })];
  const groups: ApiEndpointModelGroup[] = [
    {
      name: "Relay A",
      models: [
        { provider: "codex", id: "relay-a/glm-5.3", label: "glm-5.3" },
        { provider: "codex", id: "relay-a/kimi-k2", label: "kimi-k2" },
      ],
    },
  ];
  const levels = [
    { id: "low", label: "Low" },
    { id: "high", label: "High" },
  ];
  // 主机合好的选项：Codex 自己的模型在前。
  const own = { id: "gpt-5.5", model: "GPT-5.5", endpointName: "ChatGPT" };
  const named = { id: "relay-a/kimi-k2", model: "kimi-k2", endpointName: "Relay A" };
  const bare = { id: "glm-5.3", model: "glm-5.3", endpointName: null };
  const sideModelOptions = [own, bare, named];

  it("shows the options, models and Subagent levels the host reports", () => {
    const shown = view({
      provider: "codex",
      endpoints,
      endpointModelGroups: groups,
      enabled: true,
      defaultModelId: "glm-5.3",
      subagentModelId: "relay-a/kimi-k2",
      subagentThinkingOptionId: "high",
      memoryModelId: "gpt-5.5",
      forcedSubagentModelId: "glm-5.3",
      allowsAnySubagentModel: true,
      subagentThinkingOptions: levels,
      sideModelOptions,
    });
    expect(shown.codexSideModels).toEqual({
      modelOptions: sideModelOptions,
      subagentModel: named,
      subagentThinking: { value: "high", options: levels },
      memoryModel: own,
      forcedSubagentModel: bare,
      allowsAnySubagentModel: true,
    });
    expect(shown.sideModels).toBeNull();
    // 接口名显示方式同样管这几项：只有一个 gpt-5.5 / kimi-k2，同名时显示就都不带。
    const clash = view({
      provider: "codex",
      endpoints,
      endpointModelGroups: groups,
      enabled: true,
      defaultModelId: "glm-5.3",
      subagentThinkingOptions: levels,
      sideModelOptions,
      endpointNameDisplay: "clash",
    });
    expect(clash.codexSideModels?.modelOptions.map((option) => option.endpointName)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("leaves both to Codex while nothing is set", () => {
    const shown = view({
      provider: "codex",
      endpoints,
      endpointModelGroups: groups,
      enabled: true,
      defaultModelId: "glm-5.3",
      subagentThinkingOptions: levels,
      sideModelOptions,
    });
    expect(shown.codexSideModels).toEqual({
      modelOptions: sideModelOptions,
      subagentModel: null,
      subagentThinking: { value: null, options: levels },
      memoryModel: null,
      forcedSubagentModel: null,
      allowsAnySubagentModel: false,
    });
  });

  it("is not offered while the switch is off, by a host without it, or on Claude Code", () => {
    const off = view({ provider: "codex", endpoints, subagentThinkingOptions: levels });
    expect(off.codexSideModels).toBeNull();
    const old = view({
      provider: "codex",
      endpoints,
      enabled: true,
      defaultModelId: "glm-5.3",
      subagentThinkingOptions: null,
    });
    expect(old.codexSideModels).toBeNull();
    const claude = view({
      endpoints,
      enabled: true,
      defaultModelId: "glm-5.3",
      subagentThinkingOptions: levels,
    });
    expect(claude.codexSideModels).toBeNull();
  });
});

describe("Pi's Use API endpoints block", () => {
  it("picks the default model and its thinking from Pi's groups, whose ids Pi names osuna/…", () => {
    const shown = view({
      provider: "pi",
      enabled: true,
      defaultModelId: "relay/glm-5",
      defaultThinkingOptionId: "high",
      endpoints: [endpoint({ id: "relay", name: "Relay", models: [{ id: "glm-5" }] })],
      endpointModelGroups: [
        {
          name: "Relay",
          models: [
            {
              provider: "pi",
              id: "osuna/relay/glm-5",
              label: "glm-5",
              thinkingOptions: [
                { id: "low", label: "Low" },
                { id: "high", label: "High" },
              ],
            },
          ],
        },
      ],
    });
    expect(shown.modelOptions.map((option) => option.id)).toEqual(["glm-5", "relay/glm-5"]);
    expect(shown.defaultModel).toMatchObject({ id: "relay/glm-5", model: "glm-5" });
    expect(shown.defaultThinking).toEqual({
      value: "high",
      options: [
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
      ],
      usesUltraCode: null,
      lockedAt: null,
    });
  });
});
