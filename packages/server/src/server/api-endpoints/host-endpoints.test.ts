import { describe, expect, test } from "vitest";
import { isAutoModeReviewed } from "./host-endpoints.js";
import type { ApiEndpointState, StoredApiEndpoint } from "./store.js";

function endpoint(input: Pick<StoredApiEndpoint, "id" | "slug"> & Partial<StoredApiEndpoint>) {
  return {
    name: input.slug,
    baseUrls: [{ format: "anthropic_messages" as const, url: `https://${input.slug}.example` }],
    models: [],
    enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...input,
  };
}

function state(endpoints: StoredApiEndpoint[]): ApiEndpointState {
  return {
    endpoints,
    agents: {
      claude: { enabled: true, defaultModelId: "glm-4.6" },
      codex: { enabled: false, defaultModelId: null },
    },
  };
}

const relay = endpoint({
  id: "ep_r",
  slug: "relay",
  models: [{ id: "glm-4.6" }, { id: "kimi-k2" }],
});

describe("isAutoModeReviewed", () => {
  test("no model reachable through the gateway is reviewed by Anthropic", () => {
    expect(isAutoModeReviewed(state([relay]))).toBe(false);
  });

  test("a Claude model by name, however a relay or cloud writes it, is reviewed", () => {
    for (const id of [
      "claude-opus-4.6",
      "anthropic/claude-sonnet-4-5",
      "us.anthropic.claude-haiku-4-5",
    ]) {
      const withClaude = { ...relay, models: [...relay.models, { id }] };
      expect(isAutoModeReviewed(state([withClaude])), id).toBe(true);
    }
  });

  test("any model on an endpoint whose Anthropic address is api.anthropic.com is reviewed", () => {
    const anthropic = endpoint({
      id: "ep_a",
      slug: "anthropic",
      baseUrls: [{ format: "anthropic_messages", url: "https://api.anthropic.com" }],
      models: [{ id: "mystery" }],
    });
    expect(isAutoModeReviewed(state([relay, anthropic]))).toBe(true);
  });

  test("a Claude model a tier is mapped to counts; endpoints that are off or offer nothing don't", () => {
    const mapped = { ...relay, modelMapping: { haiku: "claude-haiku-4-5" } };
    expect(isAutoModeReviewed(state([mapped]))).toBe(true);
    const off = endpoint({
      id: "ep_o",
      slug: "off",
      enabled: false,
      models: [{ id: "claude-opus-4-6" }],
    });
    const empty = endpoint({
      id: "ep_e",
      slug: "empty",
      baseUrls: [{ format: "anthropic_messages", url: "https://api.anthropic.com/" }],
    });
    expect(isAutoModeReviewed(state([relay, off, empty]))).toBe(false);
  });
});
