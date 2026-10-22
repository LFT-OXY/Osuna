import { describe, expect, it } from "vitest";
import {
  AgentTimelineItemPayloadSchema,
  ProviderSnapshotEntrySchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages";
import {
  API_ENDPOINT_ICON_MAX_BASE64_LENGTH,
  ApiEndpointBalanceReadingSchema,
} from "./api-endpoint/rpc-schemas";

// 第三方接口 RPC。老客户端不认识 features.apiEndpoints 与这组消息，解析必须照常通过。
const ENDPOINT = {
  id: "ep_1",
  provider: "claude",
  name: "OpenRouter",
  baseUrl: "https://openrouter.ai/api",
  models: [{ id: "anthropic/claude-sonnet-4.5", label: "Sonnet" }, { id: "z-ai/glm-4.6" }],
  defaultModelId: "anthropic/claude-sonnet-4.5",
  hasApiKey: true,
};

describe("provider.api_endpoint.list", () => {
  it("parses the request and a response for Official mode", () => {
    const request = {
      type: "provider.api_endpoint.list.request" as const,
      requestId: "req-1",
      provider: "claude",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);

    const response = {
      type: "provider.api_endpoint.list.response" as const,
      payload: {
        requestId: "req-1",
        provider: "claude",
        endpoints: [ENDPOINT],
        activeEndpointId: null,
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  it("parses health issues and the CLI's own base URL, and an older host that sends neither", () => {
    const response = {
      type: "provider.api_endpoint.list.response" as const,
      payload: {
        requestId: "req-1b",
        provider: "claude",
        endpoints: [ENDPOINT],
        activeEndpointId: null,
        health: [
          { code: "config_unparsable", message: "settings.json could not be parsed" },
          { code: "some_future_code", message: "Something new" },
        ],
        cliBaseUrl: "https://hand-written.example",
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);

    const olderHost = SessionOutboundMessageSchema.parse({
      type: "provider.api_endpoint.list.response",
      payload: {
        requestId: "req-1c",
        provider: "claude",
        endpoints: [],
        activeEndpointId: null,
        error: null,
      },
    });
    expect(
      olderHost.type === "provider.api_endpoint.list.response" && olderHost.payload.health,
    ).toBe(undefined);
  });

  it("parses the live session count, and an older host that doesn't send it", () => {
    const response = {
      type: "provider.api_endpoint.list.response" as const,
      payload: {
        requestId: "req-1d",
        provider: "codex",
        endpoints: [],
        activeEndpointId: null,
        runningSessionCount: 3,
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);

    const olderHost = SessionOutboundMessageSchema.parse({
      ...response,
      payload: { ...response.payload, runningSessionCount: undefined },
    });
    expect(
      olderHost.type === "provider.api_endpoint.list.response" &&
        olderHost.payload.runningSessionCount,
    ).toBe(undefined);
  });

  it("parses an error response with a code the client has never seen", () => {
    const response = {
      type: "provider.api_endpoint.list.response" as const,
      payload: {
        requestId: "req-2",
        provider: "pi",
        endpoints: [],
        activeEndpointId: null,
        error: { code: "some_future_code", message: "Not supported" },
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});

describe("provider.api_endpoint.save", () => {
  it("parses a create request carrying the API key", () => {
    const request = {
      type: "provider.api_endpoint.save.request" as const,
      requestId: "req-3",
      provider: "claude",
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api",
      apiKey: "sk-or-secret",
      models: [{ id: "anthropic/claude-sonnet-4.5" }],
      defaultModelId: "anthropic/claude-sonnet-4.5",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  it("parses an update request that keeps the saved key by omitting it", () => {
    const request = {
      type: "provider.api_endpoint.save.request" as const,
      requestId: "req-4",
      provider: "claude",
      endpointId: "ep_1",
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api",
      models: [{ id: "anthropic/claude-sonnet-4.5" }],
      defaultModelId: "anthropic/claude-sonnet-4.5",
    };
    const parsed = SessionInboundMessageSchema.parse(request);
    expect(parsed).toEqual(request);
    expect("apiKey" in parsed).toBe(false);
  });

  it("parses the response, which carries hasApiKey and never the key", () => {
    const response = {
      type: "provider.api_endpoint.save.response" as const,
      payload: { requestId: "req-3", endpoint: ENDPOINT, error: null },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});

describe("provider.api_endpoint.delete and set_active", () => {
  it("parses delete request and response", () => {
    const request = {
      type: "provider.api_endpoint.delete.request" as const,
      requestId: "req-5",
      provider: "claude",
      endpointId: "ep_1",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const response = {
      type: "provider.api_endpoint.delete.response" as const,
      payload: { requestId: "req-5", activeEndpointId: null, error: null },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  it("parses set_active for an endpoint and for Official", () => {
    for (const endpointId of ["ep_1", null]) {
      const request = {
        type: "provider.api_endpoint.set_active.request" as const,
        requestId: "req-6",
        provider: "claude",
        endpointId,
      };
      expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    }
    const response = {
      type: "provider.api_endpoint.set_active.response" as const,
      payload: {
        requestId: "req-6",
        activeEndpointId: null,
        error: { code: "config_unparsable", message: "settings.json is not valid JSON" },
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  it("parses a rejection that carries params for the app to explain it", () => {
    const response = {
      type: "provider.api_endpoint.set_active.response" as const,
      payload: {
        requestId: "req-6b",
        activeEndpointId: null,
        error: {
          code: "config_unparsable",
          params: { file: "/u/.claude/settings.json", reason: "syntax", line: "4", column: "5" },
          message: "/u/.claude/settings.json could not be parsed",
        },
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});

describe("Claude model mapping", () => {
  it("parses an endpoint and a save request with some tiers mapped", () => {
    const endpoint = { ...ENDPOINT, modelMapping: { opus: "z-ai/glm-4.6", haiku: "z-ai/glm-4.6" } };
    const response = {
      type: "provider.api_endpoint.save.response" as const,
      payload: { requestId: "req-7", endpoint, error: null },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);

    const request = {
      type: "provider.api_endpoint.save.request" as const,
      requestId: "req-7",
      provider: "claude",
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api",
      models: [{ id: "z-ai/glm-4.6" }],
      defaultModelId: "z-ai/glm-4.6",
      modelMapping: { fable: "z-ai/glm-4.6" },
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });
});

describe("provider.api_endpoint.fetch_models", () => {
  it("parses a request with a typed key and one that reuses the saved key", () => {
    const typed = {
      type: "provider.api_endpoint.fetch_models.request" as const,
      requestId: "req-8",
      provider: "codex",
      baseUrl: "https://relay.example/v1",
      apiKey: "sk-typed",
    };
    expect(SessionInboundMessageSchema.parse(typed)).toEqual(typed);

    const saved = {
      type: "provider.api_endpoint.fetch_models.request" as const,
      requestId: "req-9",
      provider: "claude",
      endpointId: "ep_1",
      baseUrl: "https://openrouter.ai/api",
    };
    expect(SessionInboundMessageSchema.parse(saved)).toEqual(saved);
  });

  it("parses the listed models and an upstream failure", () => {
    const listed = {
      type: "provider.api_endpoint.fetch_models.response" as const,
      payload: {
        requestId: "req-8",
        models: [{ id: "gpt-5", label: "GPT-5" }, { id: "gpt-5-mini" }],
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(listed)).toEqual(listed);

    const failed = {
      type: "provider.api_endpoint.fetch_models.response" as const,
      payload: {
        requestId: "req-9",
        models: [],
        error: { code: "models_unsupported", message: "HTTP 404" },
      },
    };
    expect(SessionOutboundMessageSchema.parse(failed)).toEqual(failed);
  });
});

describe("provider.api_endpoint.test_connection", () => {
  it("parses a request that reuses the saved key", () => {
    const request = {
      type: "provider.api_endpoint.test_connection.request" as const,
      requestId: "req-11",
      provider: "codex",
      endpointId: "ep_1",
      baseUrl: "https://relay.example/v1",
      modelId: "gpt-5",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  it("parses a success, an upstream failure without a response, and a rejected request", () => {
    const success = {
      type: "provider.api_endpoint.test_connection.response" as const,
      payload: {
        requestId: "req-11",
        result: { ok: true, status: 200, durationMs: 812, error: null },
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(success)).toEqual(success);

    const timedOut = {
      type: "provider.api_endpoint.test_connection.response" as const,
      payload: {
        requestId: "req-12",
        result: {
          ok: false,
          status: null,
          durationMs: 30000,
          error: { code: "upstream_timeout", message: "No response within 30s" },
        },
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(timedOut)).toEqual(timedOut);

    const rejected = {
      type: "provider.api_endpoint.test_connection.response" as const,
      payload: {
        requestId: "req-13",
        result: null,
        error: { code: "invalid_input", message: "API key is required" },
      },
    };
    expect(SessionOutboundMessageSchema.parse(rejected)).toEqual(rejected);
  });
});

describe("provider.api_endpoint.cancel", () => {
  it("parses request and response", () => {
    const request = {
      type: "provider.api_endpoint.cancel.request" as const,
      requestId: "req-10",
      targetRequestId: "req-8",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const response = {
      type: "provider.api_endpoint.cancel.response" as const,
      payload: { requestId: "req-10", cancelled: true },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});

describe("server_info.features.apiEndpoints", () => {
  const base = { status: "server_info" as const, serverId: "srv_1" };

  it("parses a host that advertises the feature", () => {
    const parsed = ServerInfoStatusPayloadSchema.parse({
      ...base,
      features: { apiEndpoints: true },
    });
    expect(parsed.features?.apiEndpoints).toBe(true);
  });

  it("reads an older host without the flag as not supported", () => {
    const parsed = ServerInfoStatusPayloadSchema.parse({ ...base, features: { usage: true } });
    expect(parsed.features?.apiEndpoints).toBeUndefined();
  });
});

describe("providers snapshot isModelListAuthoritative", () => {
  const entry = {
    provider: "claude",
    status: "ready" as const,
    enabled: true,
    models: [{ provider: "claude", id: "relay/sonnet", label: "relay/sonnet", isDefault: true }],
  };

  it("parses an entry whose models come from an active API endpoint", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({ ...entry, isModelListAuthoritative: true });
    expect(parsed.isModelListAuthoritative).toBe(true);
  });

  it("reads an older host without the flag as a non-authoritative list", () => {
    expect(ProviderSnapshotEntrySchema.parse(entry).isModelListAuthoritative).toBeUndefined();
  });
});

describe("providers snapshot activeApiEndpoint", () => {
  const entry = { provider: "claude", status: "ready" as const, enabled: true };

  it("parses the endpoint a provider currently uses", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      ...entry,
      activeApiEndpoint: { id: "ep_1", name: "OpenRouter" },
    });
    expect(parsed.activeApiEndpoint).toEqual({ id: "ep_1", name: "OpenRouter" });
  });

  it("reads an older host without the field as Official", () => {
    expect(ProviderSnapshotEntrySchema.parse(entry).activeApiEndpoint).toBeUndefined();
  });
});

describe("providers snapshot apiEndpointModelGroups", () => {
  const entry = { provider: "claude", status: "ready" as const, enabled: true };

  it("parses the models grouped by endpoint, with the slashed id kept opaque", () => {
    const groups = [
      {
        name: "Relay A",
        models: [{ provider: "claude", id: "relay-a/kimi-k2", label: "kimi-k2", isDefault: true }],
      },
    ];
    expect(
      ProviderSnapshotEntrySchema.parse({ ...entry, apiEndpointModelGroups: groups })
        .apiEndpointModelGroups,
    ).toEqual(groups);
  });

  it("reads an older host without the field as ungrouped", () => {
    expect(ProviderSnapshotEntrySchema.parse(entry).apiEndpointModelGroups).toBeUndefined();
  });
});

describe("timeline notification apiEndpointModeMismatch", () => {
  const notification = {
    type: "notification" as const,
    level: "warning" as const,
    message:
      'This session was created with the API endpoint "OpenRouter", but the current mode is Official. It may not be able to continue.',
  };

  it("parses the modes of a resumed session, including a deleted endpoint", () => {
    const item = {
      ...notification,
      apiEndpointModeMismatch: { createdIn: { id: "ep_1", name: null }, current: null },
    };
    expect(AgentTimelineItemPayloadSchema.parse(item)).toEqual(item);
  });

  it("parses a notification from an older host without the field", () => {
    expect(AgentTimelineItemPayloadSchema.parse(notification)).toEqual(notification);
  });
});

// 主机级接口（apiEndpointGateway）：新字段全部可选，老客户端照旧读投影字段。
describe("host-wide API endpoints", () => {
  const hostWideEndpoint = {
    ...ENDPOINT,
    baseUrls: [
      { format: "anthropic_messages", url: "https://openrouter.ai/api" },
      { format: "openai_chat", url: "https://openrouter.ai/api/v1" },
      { format: "a_future_format", url: "https://openrouter.ai/future" },
    ],
    enabled: false,
  };

  it("parses a list response that carries every agent's switch and default model", () => {
    const response = {
      type: "provider.api_endpoint.list.response" as const,
      payload: {
        requestId: "req-h1",
        provider: "claude",
        endpoints: [hostWideEndpoint],
        activeEndpointId: null,
        agents: {
          claude: { enabled: true, defaultModelId: "z-ai/glm-4.6" },
          codex: { enabled: false, defaultModelId: null },
        },
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  it("parses a save request with format base URLs and no default model", () => {
    const request = {
      type: "provider.api_endpoint.save.request" as const,
      requestId: "req-h2",
      provider: "claude",
      name: "OpenRouter",
      apiKey: "sk-secret",
      baseUrls: [{ format: "openai_chat", url: "https://openrouter.ai/api/v1" }],
      models: [],
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  it("parses an endpoint with its upstream list and hand-added models, and a save that carries them", () => {
    const response = {
      type: "provider.api_endpoint.save.response" as const,
      payload: {
        requestId: "req-h5",
        endpoint: {
          ...hostWideEndpoint,
          catalog: { fetchedAt: "2026-10-14T08:00:00.000Z", models: [{ id: "gpt-5" }] },
          manualModels: [{ id: "hidden-model" }],
        },
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);

    const request = {
      type: "provider.api_endpoint.save.request" as const,
      requestId: "req-h6",
      provider: "claude",
      endpointId: "ep_1",
      name: "OpenRouter",
      baseUrls: [{ format: "openai_chat", url: "https://openrouter.ai/api/v1" }],
      models: [{ id: "hidden-model" }],
      manualModels: [{ id: "hidden-model" }],
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  it("parses fetch_models and test_connection by base URL and format, without a model to test", () => {
    for (const type of [
      "provider.api_endpoint.fetch_models.request",
      "provider.api_endpoint.test_connection.request",
    ] as const) {
      const request = {
        type,
        requestId: `req-${type}`,
        provider: "claude",
        endpointId: "ep_1",
        baseUrl: "https://openrouter.ai/api/v1",
        format: "openai_chat",
      };
      expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    }
  });

  it("parses a list response that says why the gateway can't be used, and one without it", () => {
    const base = {
      requestId: "req-h4",
      provider: "codex",
      endpoints: [hostWideEndpoint],
      activeEndpointId: null,
      error: null,
    };
    const unavailable = {
      type: "provider.api_endpoint.list.response" as const,
      payload: {
        ...base,
        gatewayUnavailable: { code: "gateway_requires_tcp", message: "socket" },
      },
    };
    const available = {
      type: "provider.api_endpoint.list.response" as const,
      payload: { ...base, gatewayUnavailable: null },
    };
    expect(SessionOutboundMessageSchema.parse(unavailable)).toEqual(unavailable);
    expect(SessionOutboundMessageSchema.parse(available)).toEqual(available);
  });

  it("parses endpoints cooling down, needing a check, and available", () => {
    const response = {
      type: "provider.api_endpoint.list.response" as const,
      payload: {
        requestId: "req-h5",
        provider: "claude",
        endpoints: [
          {
            ...hostWideEndpoint,
            cooldown: { state: "cooling_down", reason: "quota", until: "2026-10-14T12:15:00.000Z" },
          },
          {
            ...hostWideEndpoint,
            id: "ep_2",
            cooldown: { state: "needs_check", reason: "auth", until: null },
          },
          { ...hostWideEndpoint, id: "ep_3", cooldown: null },
        ],
        activeEndpointId: null,
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  it("parses set_agent_settings request and response", () => {
    const request = {
      type: "provider.api_endpoint.set_agent_settings.request" as const,
      requestId: "req-h3",
      provider: "codex",
      enabled: true,
      defaultModelId: "gpt-5",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const withoutDefault = { ...request, enabled: false, defaultModelId: undefined };
    expect(SessionInboundMessageSchema.parse(withoutDefault)).toMatchObject({ enabled: false });

    const response = {
      type: "provider.api_endpoint.set_agent_settings.response" as const,
      payload: {
        requestId: "req-h3",
        provider: "codex",
        agent: { enabled: true, defaultModelId: "gpt-5" },
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    const rejected = {
      ...response,
      payload: {
        ...response.payload,
        agent: { enabled: false, defaultModelId: null },
        error: { code: "no_usable_model", message: "No endpoint is on with a model selected" },
      },
    };
    expect(SessionOutboundMessageSchema.parse(rejected)).toEqual(rejected);
    // 打开时默认模型怎么挑的（ADR 0012）；默认模型可以指定某一家。
    const connected = {
      ...response,
      payload: {
        ...response.payload,
        agent: { enabled: true, defaultModelId: "relay-b/glm-4.6" },
        connection: { how: "same", model: "relay-b/glm-4.6", previousModel: "glm-4.6" },
      },
    };
    expect(SessionOutboundMessageSchema.parse(connected)).toEqual(connected);
  });

  it("parses set_endpoint_state for the switch and for resuming now", () => {
    const toggle = {
      type: "provider.api_endpoint.set_endpoint_state.request" as const,
      requestId: "req-h4",
      endpointId: "ep_1",
      enabled: false,
    };
    expect(SessionInboundMessageSchema.parse(toggle)).toEqual(toggle);
    const resume = {
      type: "provider.api_endpoint.set_endpoint_state.request" as const,
      requestId: "req-h5",
      endpointId: "ep_1",
      clearCooldown: true,
    };
    expect(SessionInboundMessageSchema.parse(resume)).toEqual(resume);

    const response = {
      type: "provider.api_endpoint.set_endpoint_state.response" as const,
      payload: { requestId: "req-h4", endpointId: "ep_1", error: null },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  it("parses detect_formats with a saved key, and per-format results including unknown ones", () => {
    const request = {
      type: "provider.api_endpoint.detect_formats.request" as const,
      requestId: "req-h6",
      endpointId: "ep_1",
      baseUrl: "https://relay.example",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);

    const response = {
      type: "provider.api_endpoint.detect_formats.response" as const,
      payload: {
        requestId: "req-h6",
        results: [
          {
            format: "anthropic_messages",
            url: "https://relay.example",
            status: "ok",
            httpStatus: 200,
            message: null,
          },
          {
            format: "openai_chat",
            url: "https://relay.example/v1",
            status: "auth_failed",
            httpStatus: 401,
            message: "HTTP 401: invalid key",
          },
          {
            format: "a_future_format",
            url: "https://relay.example/future",
            status: "a_future_status",
            httpStatus: null,
            message: "connection refused",
          },
        ],
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  it("parses a host that advertises apiEndpointGateway, and an older one without it", () => {
    const base = { status: "server_info" as const, serverId: "srv_1" };
    const current = ServerInfoStatusPayloadSchema.parse({
      ...base,
      features: { apiEndpoints: true, apiEndpointGateway: true },
    });
    expect(current.features?.apiEndpointGateway).toBe(true);
    const older = ServerInfoStatusPayloadSchema.parse({
      ...base,
      features: { apiEndpoints: true },
    });
    expect(older.features?.apiEndpointGateway).toBeUndefined();
  });
});

// 提示区（apiEndpointCliWiring）：新字段与新 RPC 都可选，老客户端照旧解析。
describe("API endpoint settings issues (apiEndpointCliWiring)", () => {
  const listResponse = {
    type: "provider.api_endpoint.list.response" as const,
    payload: {
      requestId: "req-1",
      provider: "claude",
      endpoints: [],
      activeEndpointId: null,
      health: [{ code: "modified_externally", message: "changed" }],
      error: null,
    },
  };

  it("parses a list with agentIssues, one without it, and an issue code it does not know", () => {
    const withIssues = {
      ...listResponse,
      payload: {
        ...listResponse.payload,
        agentIssues: {
          claude: [
            {
              code: "not_through_gateway",
              params: { file: "/home/me/.claude/settings.json", keys: "env.ANTHROPIC_BASE_URL" },
              message: "Claude Code no longer goes through the gateway",
            },
          ],
          codex: [{ code: "a_future_case", message: "something new" }],
        },
      },
    };
    expect(SessionOutboundMessageSchema.parse(withIssues)).toEqual(withIssues);
    expect(SessionOutboundMessageSchema.parse(listResponse)).toEqual(listResponse);
  });

  it("parses a list with reopenHints, and a hint kind it does not know", () => {
    const withHints = {
      ...listResponse,
      payload: {
        ...listResponse.payload,
        reopenHints: {
          claude: [{ kind: "osuna_sessions", count: 2, message: "2 Claude Code sessions" }],
          codex: [
            {
              kind: "app_server",
              since: "2026-10-19T08:00:00.000Z",
              command: "codex app-server daemon restart",
              message: "Codex's background app-server",
            },
            { kind: "a_future_kind", message: "something new" },
          ],
        },
      },
    };
    expect(SessionOutboundMessageSchema.parse(withHints)).toEqual(withHints);
  });

  it("parses set_agent_settings with and without reapply", () => {
    const base = {
      type: "provider.api_endpoint.set_agent_settings.request" as const,
      requestId: "req-2",
      provider: "codex",
      enabled: true,
    };
    expect(SessionInboundMessageSchema.parse(base)).toEqual(base);
    const reapply = { ...base, reapply: true };
    expect(SessionInboundMessageSchema.parse(reapply)).toEqual(reapply);
  });

  it("parses keep_current_settings and its response, success and failure", () => {
    const request = {
      type: "provider.api_endpoint.keep_current_settings.request" as const,
      requestId: "req-3",
      provider: "claude",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const kept = {
      type: "provider.api_endpoint.keep_current_settings.response" as const,
      payload: {
        requestId: "req-3",
        provider: "claude",
        agent: { enabled: false, defaultModelId: "glm-4.6" },
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(kept)).toEqual(kept);
    const failed = {
      ...kept,
      payload: { ...kept.payload, agent: null, error: { code: "unknown", message: "EACCES" } },
    };
    expect(SessionOutboundMessageSchema.parse(failed)).toEqual(failed);
  });

  it("parses preview_switch_off and its response, with changes and when none can be had", () => {
    const request = {
      type: "provider.api_endpoint.preview_switch_off.request" as const,
      requestId: "req-4",
      provider: "codex",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const previewed = {
      type: "provider.api_endpoint.preview_switch_off.response" as const,
      payload: {
        requestId: "req-4",
        provider: "codex",
        preview: {
          files: [
            {
              path: "~/.codex/config.toml",
              change: "edited",
              lines: [
                { op: "restored", text: 'model = "gpt-5"', was: 'model = "glm-4.6"' },
                { op: "removed", text: 'model_catalog_json = "/x/catalog.json"' },
                { op: "added", text: 'model_reasoning_effort = "high"' },
              ],
            },
            { path: "~/.codex/old.toml", change: "removed", lines: [] },
          ],
        },
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(previewed)).toEqual(previewed);
    const unavailable = {
      ...previewed,
      payload: {
        ...previewed.payload,
        preview: null,
        error: { code: "config_unparsable", params: { file: "/x" }, message: "bad" },
      },
    };
    expect(SessionOutboundMessageSchema.parse(unavailable)).toEqual(unavailable);
  });

  it("parses a host that advertises apiEndpointCliWiring, and an older one without it", () => {
    const base = { status: "server_info" as const, serverId: "srv_1" };
    const current = ServerInfoStatusPayloadSchema.parse({
      ...base,
      features: { apiEndpointGateway: true, apiEndpointCliWiring: true },
    });
    expect(current.features?.apiEndpointCliWiring).toBe(true);
    const older = ServerInfoStatusPayloadSchema.parse({
      ...base,
      features: { apiEndpointGateway: true },
    });
    expect(older.features?.apiEndpointCliWiring).toBeUndefined();
  });
});

// 接口管理（apiEndpointManagement）：key 选填，新字段都可选，老客户端的消息照常解析。
describe("API endpoint management (apiEndpointManagement)", () => {
  it("parses a save that creates an endpoint without a key, and an old-shape save", () => {
    const keyless = {
      type: "provider.api_endpoint.save.request" as const,
      requestId: "req-m1",
      provider: "claude",
      name: "Ollama",
      baseUrls: [{ format: "openai_chat", url: "http://127.0.0.1:11434/v1" }],
      models: [],
    };
    expect(SessionInboundMessageSchema.parse(keyless)).toEqual(keyless);

    const oldShape = {
      type: "provider.api_endpoint.save.request" as const,
      requestId: "req-m2",
      provider: "claude",
      endpointId: "ep_1",
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api",
      models: [{ id: "z-ai/glm-4.6" }],
      defaultModelId: "z-ai/glm-4.6",
    };
    expect(SessionInboundMessageSchema.parse(oldShape)).toEqual(oldShape);

    const saved = {
      type: "provider.api_endpoint.save.response" as const,
      payload: {
        requestId: "req-m1",
        endpoint: { ...ENDPOINT, hasApiKey: false },
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(saved)).toEqual(saved);
  });

  it("parses a host that advertises apiEndpointManagement, and an older one without it", () => {
    const base = { status: "server_info" as const, serverId: "srv_1" };
    const current = ServerInfoStatusPayloadSchema.parse({
      ...base,
      features: { apiEndpointCliWiring: true, apiEndpointManagement: true },
    });
    expect(current.features?.apiEndpointManagement).toBe(true);
    const older = ServerInfoStatusPayloadSchema.parse({
      ...base,
      features: { apiEndpointCliWiring: true },
    });
    expect(older.features?.apiEndpointManagement).toBeUndefined();
  });

  it("parses set_order with the whole endpoint order, and its response", () => {
    const request = {
      type: "provider.api_endpoint.set_order.request" as const,
      requestId: "req-m2",
      endpointIds: ["ep_2", "ep_1", "ep_3"],
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const response = {
      type: "provider.api_endpoint.set_order.response" as const,
      payload: {
        requestId: "req-m2",
        error: { code: "invalid_input", message: "ep_9 is not an API endpoint" },
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  it("parses set_long_conversations and a list carrying the host's long conversation settings, and an older host's list without them", () => {
    const request = {
      type: "provider.api_endpoint.set_long_conversations.request" as const,
      requestId: "req-lc",
      fullContext: false,
      compactAt: 400_000,
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const cleared = { ...request, compactAt: null };
    expect(SessionInboundMessageSchema.parse(cleared)).toEqual(cleared);
    const response = {
      type: "provider.api_endpoint.set_long_conversations.response" as const,
      payload: { requestId: "req-lc", error: null },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    const list = {
      type: "provider.api_endpoint.list.response" as const,
      payload: {
        requestId: "req-lc-list",
        provider: "claude",
        endpoints: [],
        activeEndpointId: null,
        longConversations: { fullContext: true, compactAt: 400_000 },
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(list)).toEqual(list);
    const { longConversations: _omitted, ...olderPayload } = list.payload;
    const older = { ...list, payload: olderPayload };
    expect(SessionOutboundMessageSchema.parse(older)).toEqual(older);
  });
  it("parses set_disabled_models and a list carrying the host's disabled models, and an older host's list without them", () => {
    const request = {
      type: "provider.api_endpoint.set_disabled_models.request" as const,
      requestId: "req-dm",
      models: ["*-preview", "relay/glm-5"],
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const response = {
      type: "provider.api_endpoint.set_disabled_models.response" as const,
      payload: { requestId: "req-dm", error: null },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    const list = {
      type: "provider.api_endpoint.list.response" as const,
      payload: {
        requestId: "req-dm-list",
        provider: "codex",
        endpoints: [],
        activeEndpointId: null,
        disabledModels: ["*-preview"],
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(list)).toEqual(list);
    const { disabledModels: _omitted, ...olderPayload } = list.payload;
    const older = { ...list, payload: olderPayload };
    expect(SessionOutboundMessageSchema.parse(older)).toEqual(older);
  });
  it("parses set_endpoint_name_display, a list and a snapshot carrying the host's setting, and an older host's without it", () => {
    const request = {
      type: "provider.api_endpoint.set_endpoint_name_display.request" as const,
      requestId: "req-nd",
      display: "clash",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const response = {
      type: "provider.api_endpoint.set_endpoint_name_display.response" as const,
      payload: { requestId: "req-nd", error: null },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    const list = {
      type: "provider.api_endpoint.list.response" as const,
      payload: {
        requestId: "req-nd-list",
        provider: "codex",
        endpoints: [],
        activeEndpointId: null,
        endpointNameDisplay: "never",
        endpointNamesUnreached: ["codex"],
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(list)).toEqual(list);
    const {
      endpointNameDisplay: _omitted,
      endpointNamesUnreached: _unreached,
      ...olderPayload
    } = list.payload;
    const older = { ...list, payload: olderPayload };
    expect(SessionOutboundMessageSchema.parse(older)).toEqual(older);
    const entry = { provider: "codex", status: "ready" as const, enabled: true };
    expect(
      ProviderSnapshotEntrySchema.parse({ ...entry, apiEndpointNameDisplay: "clash" })
        .apiEndpointNameDisplay,
    ).toBe("clash");
    expect(ProviderSnapshotEntrySchema.parse(entry).apiEndpointNameDisplay).toBeUndefined();
  });
  it("parses a list whose rows carry the key mask and whose default model goes there, and an older host's", () => {
    const response = {
      type: "provider.api_endpoint.list.response" as const,
      payload: {
        requestId: "req-m3",
        provider: "claude",
        endpoints: [
          {
            ...ENDPOINT,
            slug: "openrouter",
            apiKeyMask: "sk-o…a1b2",
            defaultModelProviders: ["claude", "codex"],
          },
          { ...ENDPOINT, id: "ep_2", hasApiKey: false, defaultModelProviders: [] },
          { ...ENDPOINT, id: "ep_3" },
        ],
        activeEndpointId: null,
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
  it("parses a save that duplicates another endpoint, and an older client's save without copyOf", () => {
    const duplicate = {
      type: "provider.api_endpoint.save.request" as const,
      requestId: "req-m4",
      provider: "claude",
      name: "Relay copy",
      baseUrls: [{ format: "anthropic_messages", url: "https://relay.example" }],
      models: [{ id: "glm-4.6" }],
      copyOf: "ep_1",
    };
    expect(SessionInboundMessageSchema.parse(duplicate)).toEqual(duplicate);
    const { copyOf: _copyOf, ...older } = duplicate;
    expect(SessionInboundMessageSchema.parse(older)).toEqual(older);
  });
  it("parses reveal_key with the key, with none, and a rejection", () => {
    const request = {
      type: "provider.api_endpoint.reveal_key.request" as const,
      requestId: "req-m5",
      endpointId: "ep_1",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    for (const payload of [
      { requestId: "req-m5", apiKey: "sk-relay-a1b2", error: null },
      { requestId: "req-m5", apiKey: null, error: null },
      {
        requestId: "req-m5",
        apiKey: null,
        error: { code: "not_found", message: "API endpoint not found" },
      },
    ]) {
      const response = { type: "provider.api_endpoint.reveal_key.response" as const, payload };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
  });
  it("parses fetch_models with every format's address, and the same request without them", () => {
    const request = {
      type: "provider.api_endpoint.fetch_models.request" as const,
      requestId: "req-m11",
      provider: "claude",
      endpointId: "ep_1",
      baseUrl: "https://relay.example/anthropic",
      format: "anthropic_messages",
      baseUrls: [
        { format: "anthropic_messages", url: "https://relay.example/anthropic" },
        { format: "openai_chat", url: "https://relay.example/v1" },
      ],
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const { baseUrls: _baseUrls, ...older } = request;
    expect(SessionInboundMessageSchema.parse(older)).toEqual(older);
  });
  it("parses forget_catalog and a rejection", () => {
    const request = {
      type: "provider.api_endpoint.forget_catalog.request" as const,
      requestId: "req-m11b",
      endpointId: "ep_1",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    for (const payload of [
      { requestId: "req-m11b", error: null },
      { requestId: "req-m11b", error: { code: "not_found", message: "API endpoint not found" } },
    ]) {
      const response = { type: "provider.api_endpoint.forget_catalog.response" as const, payload };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
  });
  it("parses list_templates with a template that has plans, one that has none, one at the user's own resource, and a rejection", () => {
    const request = {
      type: "provider.api_endpoint.list_templates.request" as const,
      requestId: "req-m6",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const zhipu = {
      id: "zhipu",
      name: "Zhipu GLM",
      group: "vendor",
      baseUrls: [
        { format: "anthropic_messages", url: "https://open.bigmodel.cn/api/anthropic" },
        { format: "openai_chat", url: "https://open.bigmodel.cn/api/paas/v4" },
      ],
      website: "https://open.bigmodel.cn",
      keysUrl: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
      modelsDevIds: ["zhipuai"],
      regionLabel: "plan",
      regions: [
        {
          id: "coding",
          name: "Coding Plan",
          baseUrls: [{ format: "openai_chat", url: "https://open.bigmodel.cn/api/coding/paas/v4" }],
          keysUrl: "https://example.com/keys",
          models: ["glm-5"],
        },
      ],
      headerHints: ["anthropic-workspace-id"],
    };
    const opencodeZen = {
      id: "opencode-zen",
      name: "OpenCode Zen",
      group: "relay",
      note: "free models with no key",
      baseUrls: [{ format: "openai_chat", url: "https://opencode.ai/zen/v1" }],
      modelsDevIds: [],
      keyOptional: true,
      keyHint: "optional: free models need no key",
      models: ["big-pickle"],
      noModelList: true,
      modelIdPrefix: "cline-pass/",
      shortName: "Zen",
    };
    // 要填自己资源地址的厂商：没有 baseUrls，给示例地址与说明。
    const azure = {
      id: "azure",
      name: "Azure OpenAI",
      group: "vendor",
      baseUrls: [],
      modelsDevIds: ["azure", "openai"],
      endpointExample: "https://<resource>.openai.azure.com",
      endpointHint: "Your resource's endpoint, from Keys and Endpoint in the Azure portal.",
    };
    for (const payload of [
      { requestId: "req-m6", templates: [zhipu, opencodeZen, azure], error: null },
      { requestId: "req-m6", templates: [], error: { code: "internal", message: "boom" } },
    ]) {
      const response = { type: "provider.api_endpoint.list_templates.response" as const, payload };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
  });
  it("parses an endpoint and a save that carry a template and its region, and older ones without", () => {
    const save = {
      type: "provider.api_endpoint.save.request" as const,
      requestId: "req-m7",
      provider: "claude",
      name: "Zhipu GLM",
      baseUrls: [{ format: "openai_chat", url: "https://open.bigmodel.cn/api/coding/paas/v4" }],
      models: [],
      templateId: "zhipu",
      region: "coding",
    };
    expect(SessionInboundMessageSchema.parse(save)).toEqual(save);
    const { templateId: _templateId, region: _region, ...older } = save;
    expect(SessionInboundMessageSchema.parse(older)).toEqual(older);
    for (const endpoint of [{ ...ENDPOINT, templateId: "zhipu", region: "coding" }, ENDPOINT]) {
      const response = {
        type: "provider.api_endpoint.save.response" as const,
        payload: { requestId: "req-m7", endpoint, error: null },
      };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
  });
  it("parses an endpoint, a save and the unsaved checks carrying headers, an extra body, a key header and the skipped certificate check, and older ones without", () => {
    const extras = {
      headers: { "anthropic-workspace-id": "wrkspc_1", "anthropic-beta": "context-1m" },
      extraBody: { prompt_cache_key: "${sessionId}", "!service_tier": "flex", thinking: { a: 1 } },
      keyHeader: "x-api-key",
      insecureTls: true,
    };
    const requests = [
      {
        type: "provider.api_endpoint.save.request" as const,
        requestId: "req-h1",
        provider: "claude",
        endpointId: "ep_1",
        name: "Relay",
        baseUrls: [{ format: "anthropic_messages", url: "https://relay.example" }],
        models: [],
      },
      {
        type: "provider.api_endpoint.fetch_models.request" as const,
        requestId: "req-h2",
        provider: "claude",
        baseUrl: "https://relay.example",
      },
      {
        type: "provider.api_endpoint.test_connection.request" as const,
        requestId: "req-h3",
        provider: "claude",
        baseUrl: "https://relay.example",
        format: "anthropic_messages",
      },
      {
        type: "provider.api_endpoint.detect_formats.request" as const,
        requestId: "req-h4",
        baseUrl: "https://relay.example",
      },
    ];
    for (const older of requests) {
      const request = { ...older, ...extras };
      expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
      expect(SessionInboundMessageSchema.parse(older)).toEqual(older);
    }
    // 不认识的 keyHeader 照常解析（daemon 当 both）。
    for (const endpoint of [{ ...ENDPOINT, ...extras, keyHeader: "cookie" }, ENDPOINT]) {
      const response = {
        type: "provider.api_endpoint.save.response" as const,
        payload: { requestId: "req-h1", endpoint, error: null },
      };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
  });

  it("parses an endpoint and a save carrying cooldown settings, a save that clears them, and older ones without", () => {
    const cooldownSettings = { quotaRestMinutes: 60, restCapMinutes: 0, noFailRest: true };
    const save = {
      type: "provider.api_endpoint.save.request" as const,
      requestId: "req-c1",
      provider: "claude",
      endpointId: "ep_1",
      name: "Relay",
      baseUrls: [{ format: "anthropic_messages", url: "https://relay.example" }],
      models: [],
      cooldownSettings,
    };
    expect(SessionInboundMessageSchema.parse(save)).toEqual(save);
    const daily = { ...save, cooldownSettings: { quotaResetAt: "00:00+08:00" } };
    expect(SessionInboundMessageSchema.parse(daily)).toEqual(daily);
    const cleared = { ...save, cooldownSettings: {} };
    expect(SessionInboundMessageSchema.parse(cleared)).toEqual(cleared);
    const { cooldownSettings: _settings, ...older } = save;
    expect(SessionInboundMessageSchema.parse(older)).toEqual(older);
    // cooldown（正在冷却）与 cooldownSettings（设的时长）同时在。
    const cooling = { ...ENDPOINT, cooldown: null, cooldownSettings };
    for (const endpoint of [cooling, ENDPOINT]) {
      const response = {
        type: "provider.api_endpoint.save.response" as const,
        payload: { requestId: "req-c1", endpoint, error: null },
      };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
    const rejected = {
      type: "provider.api_endpoint.save.response" as const,
      payload: {
        requestId: "req-c1",
        endpoint: null,
        error: {
          code: "invalid_cooldown_settings",
          message: "too long",
          params: { field: "quotaRestMinutes", max: "11520" },
        },
      },
    };
    expect(SessionOutboundMessageSchema.parse(rejected)).toEqual(rejected);
  });

  it("parses an endpoint and a save that carry an icon, a save that takes it off, and older ones without", () => {
    const save = {
      type: "provider.api_endpoint.save.request" as const,
      requestId: "req-m8",
      provider: "claude",
      name: "Home relay",
      baseUrls: [{ format: "openai_chat", url: "https://home.example/v1" }],
      models: [],
      icon: "file:0123456789abcdef.png",
    };
    expect(SessionInboundMessageSchema.parse(save)).toEqual(save);
    const cleared = { ...save, icon: null };
    expect(SessionInboundMessageSchema.parse(cleared)).toEqual(cleared);
    const { icon: _icon, ...older } = save;
    expect(SessionInboundMessageSchema.parse(older)).toEqual(older);
    for (const endpoint of [{ ...ENDPOINT, icon: "deepseek-color" }, ENDPOINT]) {
      const response = {
        type: "provider.api_endpoint.save.response" as const,
        payload: { requestId: "req-m8", endpoint, error: null },
      };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
  });
  it("parses store_icon and read_icon with a picture, and their rejections", () => {
    const store = {
      type: "provider.api_endpoint.store_icon.request" as const,
      requestId: "req-m9",
      data: "iVBORw0KGgo=",
    };
    expect(SessionInboundMessageSchema.parse(store)).toEqual(store);
    for (const payload of [
      { requestId: "req-m9", icon: "file:0123456789abcdef.png", error: null },
      {
        requestId: "req-m9",
        icon: null,
        error: { code: "icon_too_large", message: "The picture is over 1 MB" },
      },
    ]) {
      const response = { type: "provider.api_endpoint.store_icon.response" as const, payload };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
    const read = {
      type: "provider.api_endpoint.read_icon.request" as const,
      requestId: "req-m10",
      icon: "file:0123456789abcdef.png",
    };
    expect(SessionInboundMessageSchema.parse(read)).toEqual(read);
    for (const payload of [
      {
        requestId: "req-m10",
        icon: { data: "iVBORw0KGgo=", mimeType: "image/png" },
        error: null,
      },
      { requestId: "req-m10", icon: null, error: { code: "not_found", message: "Icon not found" } },
    ]) {
      const response = { type: "provider.api_endpoint.read_icon.response" as const, payload };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
  });
  it("parses fetch_site_icon and its answers; a store_icon over 1 MB of base64 is refused before decoding", () => {
    const request = {
      type: "provider.api_endpoint.fetch_site_icon.request" as const,
      requestId: "req-m11",
      baseUrl: "https://api.relay.example/v1",
      name: "Relay",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    for (const payload of [
      { requestId: "req-m11", icon: "file:0123456789abcdef.svg", error: null },
      {
        requestId: "req-m11",
        icon: null,
        error: { code: "site_icon_local", message: "The base URL is on this computer" },
      },
    ]) {
      const response = { type: "provider.api_endpoint.fetch_site_icon.response" as const, payload };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
    const atLimit = {
      type: "provider.api_endpoint.store_icon.request" as const,
      requestId: "req-m12",
      data: "A".repeat(API_ENDPOINT_ICON_MAX_BASE64_LENGTH),
    };
    expect(SessionInboundMessageSchema.safeParse(atLimit).success).toBe(true);
    expect(
      SessionInboundMessageSchema.safeParse({ ...atLimit, data: `${atLimit.data}AAAA` }).success,
    ).toBe(false);
  });
  it("parses the add window's unsaved fetch, test and detection, a save carrying the fetched list, and older ones without", () => {
    const requests = [
      {
        type: "provider.api_endpoint.fetch_models.request" as const,
        requestId: "req-p1",
        provider: "claude",
        endpointId: "ep_1",
        baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1",
        format: "openai_chat",
        preview: true,
        templateId: "bedrock",
        region: "us-east-1",
      },
      {
        type: "provider.api_endpoint.test_connection.request" as const,
        requestId: "req-p2",
        provider: "claude",
        baseUrl: "https://relay.example",
        format: "anthropic_messages",
        templateId: "azure",
        modelIds: ["claude-opus-5", "gpt-6"],
      },
      {
        type: "provider.api_endpoint.detect_formats.request" as const,
        requestId: "req-p3",
        baseUrl: "https://relay.example",
        modelId: "my-model",
        modelIds: ["kimi-k2"],
      },
      {
        type: "provider.api_endpoint.save.request" as const,
        requestId: "req-p4",
        provider: "claude",
        name: "Relay",
        baseUrls: [{ format: "openai_chat", url: "https://relay.example/v1" }],
        models: [{ id: "kimi-k2" }],
        catalog: [{ id: "kimi-k2", label: "Kimi K2" }, { id: "gpt-6" }],
      },
    ];
    for (const request of requests) {
      expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    }

    const response = {
      type: "provider.api_endpoint.detect_formats.response" as const,
      payload: {
        requestId: "req-p3",
        results: [
          {
            format: "openai_chat",
            url: "https://relay.example/v1",
            status: "ok",
            httpStatus: 200,
            message: null,
            durationMs: 412,
            modelId: "my-model",
          },
          // 老 daemon 不发耗时与模型。
          {
            format: "openai_responses",
            url: "https://relay.example/v1",
            status: "not_detected",
            httpStatus: 404,
            message: "HTTP 404",
          },
        ],
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  it("parses detect_formats asking each picked model, with the model-by-model results", () => {
    const request = {
      type: "provider.api_endpoint.detect_formats.request" as const,
      requestId: "req-p5",
      baseUrl: "https://relay.example",
      modelIds: ["gpt-resp", "claude-only"],
      eachModel: true,
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);

    const answered = {
      format: "openai_responses",
      url: "https://relay.example/v1",
      status: "ok",
      httpStatus: 200,
      message: null,
      durationMs: 210,
      modelId: "gpt-resp",
    };
    const response = {
      type: "provider.api_endpoint.detect_formats.response" as const,
      payload: {
        requestId: "req-p5",
        results: [answered],
        models: [
          {
            modelId: "gpt-resp",
            results: [
              {
                format: "openai_chat",
                url: "https://relay.example/v1",
                status: "not_detected",
                httpStatus: 400,
                message: "HTTP 400: not supported",
                durationMs: 90,
                modelId: "gpt-resp",
              },
              answered,
              {
                format: "anthropic_messages",
                url: "https://relay.example",
                status: "not_detected",
                httpStatus: null,
                message: "No response within 12s",
                modelId: "gpt-resp",
                code: "upstream_timeout",
                params: { seconds: "12" },
              },
            ],
          },
        ],
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});

describe("API endpoint model scope and auto-pick rules (apiEndpointManagement)", () => {
  it("parses an endpoint and a save with a scope and rules, a scope it does not know, and one without either", () => {
    const save = {
      type: "provider.api_endpoint.save.request" as const,
      requestId: "req-s1",
      provider: "claude",
      endpointId: "ep_1",
      name: "OpenRouter",
      baseUrls: [{ format: "openai_chat", url: "https://openrouter.ai/api/v1" }],
      models: [{ id: "gpt-5" }],
      modelScope: "picked",
      autoPick: ["gpt-*", "re:claude-\\d"],
    };
    expect(SessionInboundMessageSchema.parse(save)).toEqual(save);

    for (const endpoint of [
      { ...ENDPOINT, modelScope: "vendor", autoPick: ["gpt-*"] },
      { ...ENDPOINT, modelScope: "usage" },
      ENDPOINT,
    ]) {
      const response = {
        type: "provider.api_endpoint.save.response" as const,
        payload: { requestId: "req-s1", endpoint, error: null },
      };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
  });
});

describe("API endpoint model settings (apiEndpointManagement)", () => {
  it("parses an endpoint and a save with model settings and the automatic facts, and one without them", () => {
    const modelSettings = {
      defaults: { context: 200_000, output: 32_000, compact: 150_000, upstreamName: "zhipu/*" },
      models: {
        "glm-5": { name: "GLM", context: 128_000, efforts: [], images: true, compact: 90_000 },
        "kimi-k2": { output: 8_000, efforts: ["low", "high"] },
        // 工单 15：上游模型名与只用这种格式。
        "glm-4.6": { upstreamName: "vendor/glm-4.6", format: "openai_chat" },
      },
    };
    const save = {
      type: "provider.api_endpoint.save.request" as const,
      requestId: "req-m1",
      provider: "codex",
      endpointId: "ep_1",
      name: "Relay",
      baseUrls: [{ format: "openai_chat", url: "https://relay.example/v1" }],
      models: [{ id: "glm-5" }],
      modelSettings,
    };
    expect(SessionInboundMessageSchema.parse(save)).toEqual(save);

    const modelFacts = {
      "glm-5": {
        name: "GLM-5",
        context: 200_000,
        output: 128_000,
        efforts: ["high"],
        images: false,
      },
      mystery: {},
    };
    for (const endpoint of [
      { ...ENDPOINT, modelSettings, modelFacts },
      { ...ENDPOINT, modelSettings: {} },
      ENDPOINT,
    ]) {
      const response = {
        type: "provider.api_endpoint.save.response" as const,
        payload: { requestId: "req-m1", endpoint, error: null },
      };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
  });
});

describe("provider.api_endpoint.test_models", () => {
  it("parses the CLI test methods an endpoint offers, with methods and reasons the client has never seen", () => {
    const testsAs = [
      { method: "codex", unavailable: null },
      {
        method: "claude_code",
        unavailable: { code: "cli_sample_missing", message: "No Claude Code request yet" },
      },
      { method: "a_future_cli", unavailable: { code: "a_future_code", message: "Not yet" } },
    ];
    const response = {
      type: "provider.api_endpoint.list.response" as const,
      payload: {
        requestId: "req-t0",
        provider: "claude",
        endpoints: [{ ...ENDPOINT, testsAs }],
        activeEndpointId: null,
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    const request = {
      type: "provider.api_endpoint.test_models.request" as const,
      requestId: "req-t0",
      endpointId: "ep_1",
      modelId: "claude-sonnet-4-5",
      method: "claude_code",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  it("parses a whole-endpoint request and a single-model request with a method", () => {
    const whole = {
      type: "provider.api_endpoint.test_models.request" as const,
      requestId: "req-t1",
      endpointId: "ep_1",
    };
    expect(SessionInboundMessageSchema.parse(whole)).toEqual(whole);
    const one = { ...whole, modelId: "glm-5", method: "a_future_method" };
    expect(SessionInboundMessageSchema.parse(one)).toEqual(one);
  });

  it("parses started, progress and the response, with error codes and formats the client has never seen", () => {
    const passed = {
      modelId: "glm-5",
      ok: true,
      format: "openai_chat",
      status: 200,
      durationMs: 412,
      error: null,
    };
    const failed = {
      modelId: "kimi-k2",
      ok: false,
      format: "a_future_format",
      status: null,
      durationMs: 20_000,
      error: { code: "a_future_code", message: "No response within 20s" },
    };
    const disabled = {
      modelId: "gpt-5-preview",
      ok: false,
      format: null,
      status: null,
      durationMs: 0,
      error: {
        code: "model_disabled",
        params: { model: "gpt-5-preview", pattern: "*-preview" },
        message: "disabled",
      },
    };
    const started = {
      type: "provider.api_endpoint.test_models.started" as const,
      payload: { requestId: "req-t1", modelIds: ["glm-5", "kimi-k2", "gpt-5-preview"] },
    };
    expect(SessionOutboundMessageSchema.parse(started)).toEqual(started);
    const progress = {
      type: "provider.api_endpoint.test_models.progress" as const,
      payload: { requestId: "req-t1", result: failed, done: 2, total: 3 },
    };
    expect(SessionOutboundMessageSchema.parse(progress)).toEqual(progress);
    const response = {
      type: "provider.api_endpoint.test_models.response" as const,
      payload: { requestId: "req-t1", results: [passed, failed, disabled], error: null },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    const cancelled = {
      type: "provider.api_endpoint.test_models.response" as const,
      payload: {
        requestId: "req-t1",
        results: [passed],
        error: { code: "cancelled", message: "Request cancelled" },
      },
    };
    expect(SessionOutboundMessageSchema.parse(cancelled)).toEqual(cancelled);
  });
  it("parses vendor_status with and without extra vendors, a degraded page, a link-only vendor, an unread page and the switch off", () => {
    const request = {
      type: "provider.api_endpoint.vendor_status.request" as const,
      requestId: "req-vs",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const withVendors = { ...request, vendors: ["anthropic", "openai"] };
    expect(SessionInboundMessageSchema.parse(withVendors)).toEqual(withVendors);
    const anthropic = {
      vendor: "anthropic",
      name: "Anthropic",
      page: "https://status.claude.com",
      isLinkOnly: false,
      level: "degraded",
      parts: [{ name: "Claude API (api.anthropic.com)", status: "degraded_performance" }],
      incidents: [{ name: "Elevated errors", impact: "minor", url: "https://stspg.io/x" }],
      readAt: "2026-10-21T08:00:00.000Z",
      error: null,
    };
    const deepseek = {
      vendor: "deepseek",
      name: "DeepSeek",
      page: "https://status.deepseek.com",
      isLinkOnly: true,
      level: null,
      parts: [],
      incidents: [],
      readAt: null,
      error: null,
    };
    const unread = {
      ...anthropic,
      vendor: "moonshot",
      level: null,
      parts: [],
      incidents: [],
      error: { code: "page_status", params: { status: "503" }, message: "answered 503" },
    };
    for (const payload of [
      {
        requestId: "req-vs",
        autoUpdate: true,
        vendors: [anthropic, deepseek, unread],
        endpointVendors: { ep_1: "anthropic", ep_2: "deepseek" },
        error: null,
      },
      {
        requestId: "req-vs",
        autoUpdate: false,
        vendors: [{ ...anthropic, level: null, parts: [], incidents: [], readAt: null }],
        endpointVendors: { ep_1: "anthropic" },
        error: null,
      },
      // 等级是字符串：daemon 以后多一种，老客户端照样解析。
      {
        requestId: "req-vs",
        autoUpdate: true,
        vendors: [{ ...anthropic, level: "something_new" }],
        endpointVendors: {},
        error: null,
      },
    ]) {
      const response = { type: "provider.api_endpoint.vendor_status.response" as const, payload };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
  });
  it("parses import_scan and import, with an unreadable source, a skipped entry and statuses the client may not know", () => {
    const scan = {
      type: "provider.api_endpoint.import_scan.request" as const,
      requestId: "req-is",
    };
    expect(SessionInboundMessageSchema.parse(scan)).toEqual(scan);
    const withOpenCode = { ...scan, includeOpenCode: true };
    expect(SessionInboundMessageSchema.parse(withOpenCode)).toEqual(withOpenCode);
    const item = {
      fingerprint: "f1",
      ref: "claude/p1",
      from: "Claude Code, Codex",
      name: "CC Relay",
      baseUrls: [{ format: "anthropic_messages", url: "https://cc-relay.example/api" }],
      maskedKey: "sk-c…1111",
      models: ["cc-sonnet"],
      templateId: null,
      status: "other_key",
      existingEndpointId: "ep_1",
      existingName: "Relay One",
      otherKeyName: "Relay One",
      skip: null,
      off: null,
    };
    const skipped = {
      ...item,
      fingerprint: "f2",
      baseUrls: [],
      maskedKey: null,
      models: [],
      status: "new",
      existingEndpointId: null,
      existingName: null,
      skip: "sign_in",
    };
    const response = {
      type: "provider.api_endpoint.import_scan.response" as const,
      payload: {
        requestId: "req-is",
        sources: [
          {
            id: "cc-switch",
            name: "CC Switch",
            path: "~/.cc-switch/cc-switch.db",
            found: true,
            error: null,
            items: [item, skipped, { ...item, status: "something_new" }],
          },
          {
            id: "alma",
            name: "Alma",
            path: "~/alma/chat_threads.db",
            found: true,
            error: { code: "unparsable", message: "Can't open Alma's database" },
            items: [],
          },
          {
            id: "codex",
            name: "Codex",
            path: "~/.codex/config.toml",
            found: false,
            error: null,
            items: [],
          },
        ],
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    const importRequest = {
      type: "provider.api_endpoint.import.request" as const,
      requestId: "req-im",
      picks: [
        { fingerprint: "f1", action: "add" },
        { fingerprint: "f3", action: "rename", name: "Mine" },
      ],
    };
    expect(SessionInboundMessageSchema.parse(importRequest)).toEqual(importRequest);
    for (const payload of [
      { requestId: "req-im", imported: [{ endpointId: "ep_2", name: "CC Relay" }], error: null },
      {
        requestId: "req-im",
        imported: [{ endpointId: "ep_2", name: "CC Relay" }],
        failed: { fingerprint: "f3", name: "Mine" },
        error: {
          code: "import_cannot_replace",
          params: { name: "CC Relay" },
          message: "add it instead",
        },
      },
    ]) {
      const imported = { type: "provider.api_endpoint.import.response" as const, payload };
      expect(SessionOutboundMessageSchema.parse(imported)).toEqual(imported);
    }
  });
  it("parses import_discovery and import_ignore, with a source the client may not know", () => {
    const discovery = {
      type: "provider.api_endpoint.import_discovery.request" as const,
      requestId: "req-id",
    };
    expect(SessionInboundMessageSchema.parse(discovery)).toEqual(discovery);
    for (const payload of [
      {
        requestId: "req-id",
        candidates: [
          { fingerprint: "f1", sourceId: "cc-switch", source: "CC Switch" },
          { fingerprint: "f2", sourceId: "some-new-app", source: "Some New App" },
        ],
        error: null,
      },
      {
        requestId: "req-id",
        candidates: [],
        error: { code: "unparsable", message: "endpoints.json could not be parsed" },
      },
    ]) {
      const response = {
        type: "provider.api_endpoint.import_discovery.response" as const,
        payload,
      };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
    const ignore = {
      type: "provider.api_endpoint.import_ignore.request" as const,
      requestId: "req-ig",
      fingerprints: ["f1", "f2"],
    };
    expect(SessionInboundMessageSchema.parse(ignore)).toEqual(ignore);
    const ignored = {
      type: "provider.api_endpoint.import_ignore.response" as const,
      payload: { requestId: "req-ig", error: null },
    };
    expect(SessionOutboundMessageSchema.parse(ignored)).toEqual(ignored);
  });
  it("parses import_link_preview and import_link, with a reason the client may not know", () => {
    const preview = {
      type: "provider.api_endpoint.import_link_preview.request" as const,
      requestId: "req-lp",
      link: "paseo://import?preset=deepseek&key=sk-abc",
    };
    expect(SessionInboundMessageSchema.parse(preview)).toEqual(preview);
    for (const payload of [
      {
        requestId: "req-lp",
        preview: {
          name: "DeepSeek",
          key: "sk-abc",
          baseUrls: [{ format: "openai_chat", url: "https://api.deepseek.com/v1" }],
          hosts: ["api.deepseek.com"],
          models: [],
          templateId: "deepseek",
          region: null,
          keysUrl: null,
          replaces: { endpointId: "ep_1", name: "DeepSeek" },
          ignoredGemini: false,
        },
        error: null,
      },
      {
        requestId: "req-lp",
        preview: null,
        error: {
          code: "import_link_refused",
          params: { reason: "some_new_reason", field: "chat" },
          message: "refused",
        },
      },
    ]) {
      const response = {
        type: "provider.api_endpoint.import_link_preview.response" as const,
        payload,
      };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
    const add = {
      type: "provider.api_endpoint.import_link.request" as const,
      requestId: "req-la",
      link: "paseo://import?preset=deepseek",
      name: "Mine",
      key: "",
    };
    expect(SessionInboundMessageSchema.parse(add)).toEqual(add);
    const added = {
      type: "provider.api_endpoint.import_link.response" as const,
      payload: { requestId: "req-la", endpoint: { endpointId: "ep_2", name: "Mine" }, error: null },
    };
    expect(SessionOutboundMessageSchema.parse(added)).toEqual(added);
    const icon = {
      type: "provider.api_endpoint.import_link_icon.request" as const,
      requestId: "req-li",
      link: "paseo://import?name=X&chat=https://x.example/v1&icon=https://x.example/logo.svg",
    };
    expect(SessionInboundMessageSchema.parse(icon)).toEqual(icon);
    const fetched = {
      type: "provider.api_endpoint.import_link_icon.response" as const,
      payload: {
        requestId: "req-li",
        iconImage: { data: "PHN2Zy8+", mimeType: "image/svg+xml" },
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(fetched)).toEqual(fetched);
  });
});

// 接口的余额（apiEndpointBalance）：新消息，读数的状态与失败原因是字符串，老主机不声明能力位。
describe("API endpoint balance (apiEndpointBalance)", () => {
  it("parses read_balance with a reading, an unsupported endpoint, a failure, a reason the client may not know and a last reading", () => {
    const request = {
      type: "provider.api_endpoint.read_balance.request" as const,
      requestId: "req-rb",
      endpointIds: ["ep_1", "ep_2"],
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const response = {
      type: "provider.api_endpoint.read_balance.response" as const,
      payload: {
        requestId: "req-rb",
        readings: [
          {
            endpointId: "ep_1",
            status: "ok",
            items: [{ label: null, text: "¥110.00", value: 110, unit: "CNY" }],
            readAt: "2026-10-22T08:00:00.000Z",
            failure: null,
          },
          { endpointId: "ep_2", status: "unsupported", items: [], readAt: null, failure: null },
          {
            endpointId: "ep_3",
            status: "failed",
            items: [],
            readAt: "2026-10-22T08:00:00.000Z",
            failure: { reason: "token_rejected", detail: "invalid api key ***", status: 401 },
          },
          {
            endpointId: "ep_4",
            status: "some_new_status",
            items: [{ label: "Used", text: "25%", value: 0.25, unit: null, ratio: 0.25 }],
            readAt: "2026-10-22T08:00:00.000Z",
            failure: { reason: "some_new_reason", detail: null, status: null },
          },
          {
            endpointId: "ep_5",
            status: "ok",
            items: [{ label: null, text: "¥110.00", value: 110, unit: "CNY" }],
            readAt: "2026-10-22T07:55:00.000Z",
            failure: null,
            stale: { reason: "temporary", detail: "busy", status: 503 },
          },
        ],
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  it("parses read_balance asked and forced, and set_balance_auto_refresh with the list's switch and without it", () => {
    for (const extra of [{ asked: true }, { force: true }, {}]) {
      const request = {
        type: "provider.api_endpoint.read_balance.request" as const,
        requestId: "req-rb",
        endpointIds: ["ep_1"],
        ...extra,
      };
      expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    }
    const set = {
      type: "provider.api_endpoint.set_balance_auto_refresh.request" as const,
      requestId: "req-ar",
      enabled: false,
    };
    expect(SessionInboundMessageSchema.parse(set)).toEqual(set);
    const answered = {
      type: "provider.api_endpoint.set_balance_auto_refresh.response" as const,
      payload: { requestId: "req-ar", error: null },
    };
    expect(SessionOutboundMessageSchema.parse(answered)).toEqual(answered);
    const listed = (extra: object) => ({
      type: "provider.api_endpoint.list.response" as const,
      payload: {
        requestId: "req-l",
        provider: "claude",
        endpoints: [],
        activeEndpointId: null,
        error: null,
        ...extra,
      },
    });
    expect(SessionOutboundMessageSchema.parse(listed({ balanceAutoRefresh: false }))).toEqual(
      listed({ balanceAutoRefresh: false }),
    );
    expect(SessionOutboundMessageSchema.parse(listed({}))).toEqual(listed({}));
  });

  it("parses a host that advertises apiEndpointBalance, and an older one without it", () => {
    const base = { status: "server_info" as const, serverId: "srv_1" };
    const current = ServerInfoStatusPayloadSchema.parse({
      ...base,
      features: { apiEndpointManagement: true, apiEndpointBalance: true },
    });
    expect(current.features?.apiEndpointBalance).toBe(true);
    const older = ServerInfoStatusPayloadSchema.parse({
      ...base,
      features: { apiEndpointManagement: true },
    });
    expect(older.features?.apiEndpointBalance).toBeUndefined();
  });

  it("parses a balance's parts and a failure's hint and console, and a reading from a daemon without them", () => {
    const withParts = {
      endpointId: "ep_1",
      status: "ok",
      items: [
        { label: null, text: "¥110.00 · $5.00", value: 110, unit: "CNY" },
        { label: "Granted", text: "¥10.00", value: 10, unit: "CNY", part: "granted" },
        { label: "Topped up", text: "¥100.00", value: 100, unit: "CNY", part: "some_new_part" },
      ],
      readAt: "2026-10-22T08:00:00.000Z",
      failure: null,
    };
    expect(ApiEndpointBalanceReadingSchema.parse(withParts)).toEqual(withParts);
    const notOffered = {
      endpointId: "ep_2",
      status: "failed",
      items: [],
      readAt: "2026-10-22T08:00:00.000Z",
      failure: {
        reason: "not_offered",
        detail: null,
        status: null,
        hint: "opencode_no_balance",
        seeAt: "https://opencode.ai/console",
      },
    };
    expect(ApiEndpointBalanceReadingSchema.parse(notOffered)).toEqual(notOffered);
    const older = {
      ...notOffered,
      failure: { reason: "temporary", detail: null, status: 503 },
    };
    expect(ApiEndpointBalanceReadingSchema.parse(older)).toEqual(older);
  });

  it("parses an endpoint and a save carrying balance settings, a save that clears them, and older ones without", () => {
    const balance = {
      url: "https://relay.example/query?key={key}",
      method: "POST",
      field: "$data.left",
    };
    const save = {
      type: "provider.api_endpoint.save.request" as const,
      requestId: "req-b1",
      provider: "claude",
      endpointId: "ep_1",
      name: "Relay",
      baseUrls: [{ format: "anthropic_messages", url: "https://relay.example" }],
      models: [],
      balance,
    };
    expect(SessionInboundMessageSchema.parse(save)).toEqual(save);
    const cleared = { ...save, balance: {} };
    expect(SessionInboundMessageSchema.parse(cleared)).toEqual(cleared);
    const { balance: _balance, ...older } = save;
    expect(SessionInboundMessageSchema.parse(older)).toEqual(older);
    for (const endpoint of [{ ...ENDPOINT, balance: { url: balance.url } }, ENDPOINT]) {
      const response = {
        type: "provider.api_endpoint.save.response" as const,
        payload: { requestId: "req-b1", endpoint, error: null },
      };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
  });

  it("parses check_balance with the form's values, its reading and its rejection", () => {
    const request = {
      type: "provider.api_endpoint.check_balance.request" as const,
      requestId: "req-cb",
      endpointId: "ep_1",
      apiKey: "sk-typed",
      baseUrls: [{ format: "openai_chat", url: "https://relay.example/v1" }],
      balance: { url: "https://relay.example/api/usage/token", method: "GET" },
      headers: { "X-Key": "{key}" },
      insecureTls: true,
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const bare = {
      type: "provider.api_endpoint.check_balance.request" as const,
      requestId: "req-cb2",
      balance: {},
    };
    expect(SessionInboundMessageSchema.parse(bare)).toEqual(bare);
    const reading = {
      endpointId: "ep_1",
      status: "ok",
      items: [{ label: "Used", text: "90%", value: 90, unit: "%", ratio: 0.9 }],
      readAt: "2026-10-22T08:00:00.000Z",
      failure: null,
    };
    for (const payload of [
      { requestId: "req-cb", reading, error: null },
      { requestId: "req-cb", reading: null, error: { code: "not_found", message: "gone" } },
    ]) {
      const response = { type: "provider.api_endpoint.check_balance.response" as const, payload };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
  });
  it("parses detect_balance_url with the form's values, what it found, what it tried and its rejection", () => {
    const request = {
      type: "provider.api_endpoint.detect_balance_url.request" as const,
      requestId: "req-db",
      endpointId: "ep_1",
      apiKey: "sk-typed",
      baseUrls: [{ format: "openai_chat", url: "https://relay.example/v1" }],
      headers: { "X-Plain": "kept" },
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const bare = {
      type: "provider.api_endpoint.detect_balance_url.request" as const,
      requestId: "r",
    };
    expect(SessionInboundMessageSchema.parse(bare)).toEqual(bare);
    const failed = {
      endpointId: "ep_1",
      status: "failed",
      items: [],
      readAt: "2026-10-22T08:00:00.000Z",
      failure: { reason: "wrong_url", detail: null, status: 404 },
    };
    const ok = {
      endpointId: "ep_1",
      status: "ok",
      items: [{ label: null, text: "$3.50", value: 3.5, unit: "USD", ratio: null }],
      readAt: "2026-10-22T08:00:00.000Z",
      failure: null,
    };
    for (const payload of [
      {
        requestId: "req-db",
        detected: { url: "https://relay.example/v1/usage", field: "$remaining" },
        attempts: [
          { url: "https://relay.example/api/usage/token", reading: failed },
          { url: "https://relay.example/v1/usage", reading: ok },
        ],
        error: null,
      },
      {
        requestId: "req-db",
        detected: null,
        attempts: [],
        error: { code: "invalid_input", message: "no key" },
      },
    ]) {
      const response = {
        type: "provider.api_endpoint.detect_balance_url.response" as const,
        payload,
      };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
  });
  it("parses an account token on a save and a check, its mask and user ID on an endpoint, and reveal_secret", () => {
    const save = {
      type: "provider.api_endpoint.save.request" as const,
      requestId: "req-t1",
      provider: "claude",
      name: "Relay",
      models: [],
      balance: { url: "https://relay.example/api/user/self", userId: "42" },
      balanceToken: "sys-token",
    };
    expect(SessionInboundMessageSchema.parse(save)).toEqual(save);
    const check = {
      type: "provider.api_endpoint.check_balance.request" as const,
      requestId: "req-t2",
      balance: { url: "https://relay.example/api/user/self" },
      balanceToken: "",
    };
    expect(SessionInboundMessageSchema.parse(check)).toEqual(check);
    const endpoint = { ...ENDPOINT, balance: save.balance, balanceTokenMask: "sys-…oken" };
    const listed = {
      type: "provider.api_endpoint.save.response" as const,
      payload: { requestId: "req-t1", endpoint, error: null },
    };
    expect(SessionOutboundMessageSchema.parse(listed)).toEqual(listed);
    const reveal = {
      type: "provider.api_endpoint.reveal_secret.request" as const,
      requestId: "req-t3",
      endpointId: "ep_1",
      secret: "balance_token",
    };
    expect(SessionInboundMessageSchema.parse(reveal)).toEqual(reveal);
    for (const payload of [
      { requestId: "req-t3", value: "sys-token", error: null },
      { requestId: "req-t3", value: null, error: { code: "not_found", message: "gone" } },
    ]) {
      const response = { type: "provider.api_endpoint.reveal_secret.response" as const, payload };
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }
  });

  it("parses a reading with limit windows and the wrong-address hint, and one without either", () => {
    const withWindows = {
      endpointId: "ep_1",
      status: "ok",
      items: [{ label: null, text: "$5.00", value: 5, unit: "USD" }],
      windows: [
        {
          id: "5h",
          label: "5 hours",
          usedPct: 75,
          remainingPct: 25,
          resetsAt: "2026-10-22T10:00:00.000Z",
          used: 15,
          limit: 20,
          unit: "USD",
        },
      ],
      readAt: "2026-10-22T08:00:00.000Z",
      failure: null,
    };
    expect(ApiEndpointBalanceReadingSchema.parse(withWindows)).toEqual(withWindows);
    const wrongAddress = {
      endpointId: "ep_1",
      status: "failed",
      items: [],
      readAt: "2026-10-22T08:00:00.000Z",
      failure: {
        reason: "wrong_url",
        detail: null,
        status: null,
        hint: "token_on_key_url",
        useUrl: "https://relay.example/api/user/self",
      },
    };
    expect(ApiEndpointBalanceReadingSchema.parse(wrongAddress)).toEqual(wrongAddress);
    const { windows: _windows, ...older } = withWindows;
    expect(ApiEndpointBalanceReadingSchema.parse(older)).toEqual(older);
  });
  it("parses plan windows with their pace and an aside window, and the GLM refusal with where to get a key", () => {
    const plan = {
      endpointId: "ep_glm",
      status: "ok",
      items: [],
      windows: [
        {
          id: "5h",
          label: "5 hours",
          usedPct: 12,
          remainingPct: 88,
          resetsAt: "2026-10-22T10:00:00.000Z",
          pacePct: -48,
        },
        {
          id: "mcp_month",
          label: "MCP · Month",
          usedPct: 3,
          remainingPct: 97,
          resetsAt: "2026-11-01T00:00:00.000Z",
          aside: true,
        },
      ],
      readAt: "2026-10-22T08:00:00.000Z",
      failure: null,
    };
    expect(ApiEndpointBalanceReadingSchema.parse(plan)).toEqual(plan);
    const refused = {
      endpointId: "ep_glm",
      status: "failed",
      items: [],
      readAt: "2026-10-22T08:00:00.000Z",
      failure: {
        reason: "token_rejected",
        detail: "Token expired",
        status: 200,
        hint: "glm_key_refused",
        seeAt: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
      },
    };
    expect(ApiEndpointBalanceReadingSchema.parse(refused)).toEqual(refused);
  });
});
