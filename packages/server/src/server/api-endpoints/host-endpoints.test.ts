import { describe, expect, test } from "vitest";
import {
  agentTargetEndpoint,
  defaultModelChoices,
  defaultModelProvidersOf,
  isAutoModeReviewed,
  maskApiKey,
  settleAgentSettings,
} from "./host-endpoints.js";
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
      pi: { enabled: false, defaultModelId: null },
      omp: { enabled: false, defaultModelId: null },
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

describe("one endpoint's default model", () => {
  const backup = endpoint({ id: "ep_b", slug: "backup", models: [{ id: "glm-4.6" }] });

  function withDefault(endpoints: StoredApiEndpoint[], defaultModelId: string): ApiEndpointState {
    const value = state(endpoints);
    value.agents.claude.defaultModelId = defaultModelId;
    return value;
  }

  test("is offered beside the bare names, and points the CLI at that endpoint", () => {
    expect(defaultModelChoices(state([relay, backup]))).toEqual([
      "glm-4.6",
      "kimi-k2",
      "relay/glm-4.6",
      "relay/kimi-k2",
      "backup/glm-4.6",
    ]);
    const named = withDefault([relay, backup], "backup/glm-4.6");
    expect(agentTargetEndpoint(named, "claude")?.id).toBe("ep_b");
    expect(settleAgentSettings({ state: named }).agents.claude.defaultModelId).toBe(
      "backup/glm-4.6",
    );
  });

  test("becomes the bare name when that endpoint is off, and the first model when no one offers it", () => {
    const off = withDefault([relay, { ...backup, enabled: false }], "backup/glm-4.6");
    expect(settleAgentSettings({ state: off }).agents.claude.defaultModelId).toBe("glm-4.6");
    const gone = withDefault([relay], "backup/qwen3");
    expect(settleAgentSettings({ state: gone }).agents.claude.defaultModelId).toBe("glm-4.6");
  });
});

describe("whose default model goes to an endpoint first", () => {
  const first = endpoint({ id: "ep_1", slug: "first", models: [{ id: "glm-4.6" }] });
  const second = endpoint({ id: "ep_2", slug: "second", models: [{ id: "glm-4.6" }] });

  function withDefaults(
    endpoints: StoredApiEndpoint[],
    claude: string | null,
    codex: string | null,
  ): ApiEndpointState {
    return {
      endpoints,
      agents: {
        claude: { enabled: true, defaultModelId: claude },
        codex: { enabled: true, defaultModelId: codex },
        pi: { enabled: false, defaultModelId: null },
        omp: { enabled: false, defaultModelId: null },
      },
    };
  }

  test("a bare name goes to the first endpoint in the order that is on and offers it", () => {
    const both = withDefaults([first, second], "glm-4.6", "glm-4.6");
    expect(defaultModelProvidersOf(both, "ep_1")).toEqual(["claude", "codex"]);
    expect(defaultModelProvidersOf(both, "ep_2")).toEqual([]);
    const reordered = withDefaults([second, first], "glm-4.6", null);
    expect(defaultModelProvidersOf(reordered, "ep_2")).toEqual(["claude"]);
    expect(defaultModelProvidersOf(reordered, "ep_1")).toEqual([]);
  });

  test("a bare name goes to the second endpoint when the first one is off", () => {
    const off = withDefaults([{ ...first, enabled: false }, second], "glm-4.6", "glm-4.6");
    expect(defaultModelProvidersOf(off, "ep_1")).toEqual([]);
    expect(defaultModelProvidersOf(off, "ep_2")).toEqual(["claude", "codex"]);
  });

  test("one endpoint's model goes to the endpoint it names, even when it is not the first", () => {
    const named = withDefaults([first, second], "second/glm-4.6", "glm-4.6");
    expect(defaultModelProvidersOf(named, "ep_2")).toEqual(["claude"]);
    expect(defaultModelProvidersOf(named, "ep_1")).toEqual(["codex"]);
  });

  test("a provider whose Use API endpoints switch is off names no endpoint", () => {
    const value = withDefaults([first], "glm-4.6", "glm-4.6");
    value.agents.codex.enabled = false;
    expect(defaultModelProvidersOf(value, "ep_1")).toEqual(["claude"]);
  });
});

describe("maskApiKey", () => {
  test("keeps the first four and the last four characters", () => {
    expect(maskApiKey("sk-ant-api03-abcdefa1b2")).toBe("sk-a…a1b2");
  });

  test("hides a short key whole, one dot per character", () => {
    expect(maskApiKey("12345678")).toBe("••••••••");
    expect(maskApiKey("abc")).toBe("•••");
  });
});
