import { describe, expect, it } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages";

// 挪 Codex 对话的 RPC（ADR 0011）。新客户端只在 features.apiEndpointCliWiring 为 true 时才发。
describe("provider.codex.session.list_model_providers", () => {
  it("parses the request and a response naming where each provider comes from", () => {
    const request = {
      type: "provider.codex.session.list_model_providers.request" as const,
      requestId: "req-1",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);

    const response = {
      type: "provider.codex.session.list_model_providers.response" as const,
      payload: {
        requestId: "req-1",
        modelProviders: [
          { id: "openai", source: "builtin" },
          { id: "osuna_api_endpoint", source: "osuna", name: "Osuna" },
          { id: "cc", source: "config", name: "CC Switch" },
        ],
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});

describe("provider.codex.session.move_model_provider", () => {
  it("parses the request and a response with moved and skipped conversations", () => {
    const request = {
      type: "provider.codex.session.move_model_provider.request" as const,
      requestId: "req-2",
      threadIds: ["thread-a", "thread-b"],
      to: "osuna_api_endpoint",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);

    const response = {
      type: "provider.codex.session.move_model_provider.response" as const,
      payload: {
        requestId: "req-2",
        to: "osuna_api_endpoint",
        moved: [
          {
            threadId: "thread-a",
            from: "openai",
            files: ["/home/me/.codex/sessions/2026/10/17/rollout-a.jsonl"],
            stateDatabases: ["/home/me/.codex/state_5.sqlite"],
            backupPath: "/home/me/.paseo/codex-model-provider-moves/20261018T120000.000-thread-a",
          },
        ],
        skipped: [{ threadId: "thread-b", reason: "active", message: "written just now" }],
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  it("keeps a skip reason this client does not know yet", () => {
    const response = {
      type: "provider.codex.session.move_model_provider.response" as const,
      payload: {
        requestId: "req-3",
        to: "openai",
        moved: [],
        skipped: [{ threadId: "thread-c", reason: "locked_by_codex_app", message: "busy" }],
        error: null,
      },
    };
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});
