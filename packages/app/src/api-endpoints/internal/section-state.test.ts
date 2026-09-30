import { describe, expect, it } from "vitest";
import { apiEndpointErrorMessageKey, selectApiEndpointsState } from "./section-state";

const ENDPOINT = {
  id: "ep_1",
  provider: "claude",
  name: "Relay",
  baseUrl: "https://relay.example/api",
  models: [{ id: "relay/sonnet" }],
  defaultModelId: "relay/sonnet",
  hasApiKey: true,
};

describe("selectApiEndpointsState", () => {
  it("is loading before the first answer", () => {
    expect(selectApiEndpointsState({ data: undefined, error: null })).toEqual({
      status: "loading",
    });
  });

  it("is ready with the endpoints and Official as the active mode", () => {
    expect(
      selectApiEndpointsState({
        data: {
          requestId: "r",
          provider: "claude",
          endpoints: [ENDPOINT],
          activeEndpointId: null,
          error: null,
        },
        error: null,
      }),
    ).toEqual({ status: "ready", endpoints: [ENDPOINT], activeEndpointId: null });
  });

  it("keeps the last list when a background refresh fails", () => {
    const state = selectApiEndpointsState({
      data: {
        requestId: "r",
        provider: "claude",
        endpoints: [ENDPOINT],
        activeEndpointId: "ep_1",
        error: null,
      },
      error: new Error("socket closed"),
    });
    expect(state).toEqual({ status: "ready", endpoints: [ENDPOINT], activeEndpointId: "ep_1" });
  });

  it("shows the daemon's error when the list itself failed", () => {
    expect(
      selectApiEndpointsState({
        data: {
          requestId: "r",
          provider: "claude",
          endpoints: [],
          activeEndpointId: null,
          error: { code: "unsupported_provider", message: "Not supported" },
        },
        error: null,
      }),
    ).toEqual({ status: "error", message: "Not supported" });
  });
});

describe("apiEndpointErrorMessageKey", () => {
  it("localizes an unparsable settings file and an outdated Codex, and passes other codes through", () => {
    expect(apiEndpointErrorMessageKey({ code: "config_unparsable", message: "x" })).toBe(
      "settings.providers.apiEndpoints.configUnparsable",
    );
    expect(apiEndpointErrorMessageKey({ code: "codex_version_unsupported", message: "x" })).toBe(
      "settings.providers.apiEndpoints.codexVersionUnsupported",
    );
    expect(apiEndpointErrorMessageKey({ code: "invalid_input", message: "x" })).toBeNull();
  });

  it("localizes an upstream that can't list models and a timeout, but not an upstream HTTP error", () => {
    expect(apiEndpointErrorMessageKey({ code: "models_unsupported", message: "x" })).toBe(
      "settings.providers.apiEndpoints.form.modelsUnsupported",
    );
    expect(apiEndpointErrorMessageKey({ code: "upstream_timeout", message: "x" })).toBe(
      "settings.providers.apiEndpoints.form.fetchTimeout",
    );
    expect(apiEndpointErrorMessageKey({ code: "upstream_error", message: "x" })).toBeNull();
  });
});
