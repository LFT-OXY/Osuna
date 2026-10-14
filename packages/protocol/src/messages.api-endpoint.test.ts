import { describe, expect, it } from "vitest";
import {
  AgentTimelineItemPayloadSchema,
  ProviderSnapshotEntrySchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages";

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
