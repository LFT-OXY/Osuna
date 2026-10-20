import { describe, expect, it } from "vitest";
import type { ApiEndpointState, StoredApiEndpoint } from "./store.js";
import { withoutDisabledModels } from "./disabled-models.js";

function endpoint(input: Pick<StoredApiEndpoint, "models" | "modelMapping">): StoredApiEndpoint {
  return {
    id: "ep_a",
    slug: "relay-a",
    name: "Relay A",
    baseUrls: [{ format: "anthropic_messages", url: "https://relay.example" }],
    enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...input,
  };
}

function stateWith(input: {
  endpoint: StoredApiEndpoint;
  disabledModels: string[];
}): ApiEndpointState {
  return {
    endpoints: [input.endpoint],
    agents: {
      claude: { enabled: false, defaultModelId: null },
      codex: { enabled: false, defaultModelId: null },
    },
    disabledModels: input.disabledModels,
  };
}

describe("withoutDisabledModels", () => {
  it("drops disabled models and only the tiers that point at one of them", () => {
    const served = withoutDisabledModels(
      stateWith({
        endpoint: endpoint({
          models: [{ id: "glm-5" }, { id: "glm-5-preview" }],
          // haiku 指向这家没选的模型：不归这里管，原样留着。
          modelMapping: { opus: "glm-5-preview", sonnet: "glm-5", haiku: "glm-4.6" },
        }),
        disabledModels: ["*-preview"],
      }),
    );

    expect(served.endpoints[0]?.models).toEqual([{ id: "glm-5" }]);
    expect(served.endpoints[0]?.modelMapping).toEqual({ sonnet: "glm-5", haiku: "glm-4.6" });
  });

  it("drops a tier that points at a disabled model even when no selected model is disabled", () => {
    const served = withoutDisabledModels(
      stateWith({
        endpoint: endpoint({ models: [{ id: "glm-5" }], modelMapping: { opus: "glm-5-preview" } }),
        disabledModels: ["*-preview"],
      }),
    );

    expect(served.endpoints[0]?.modelMapping).toEqual({});
  });

  it("leaves the state as it is with nothing disabled", () => {
    const state = stateWith({
      endpoint: endpoint({ models: [{ id: "glm-5-preview" }] }),
      disabledModels: [],
    });
    expect(withoutDisabledModels(state)).toBe(state);
  });
});
