import { describe, expect, it } from "vitest";
import {
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
