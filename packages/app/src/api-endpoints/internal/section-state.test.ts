import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  apiEndpointErrorMessageKey,
  apiEndpointHealthMessageKey,
  isActiveApiEndpoint,
  formatApiEndpointTestDuration,
  selectApiEndpointHealthView,
  selectApiEndpointImpact,
  selectApiEndpointsState,
  type ApiEndpointsLoadState,
} from "./section-state";

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
    ).toEqual({
      status: "ready",
      endpoints: [ENDPOINT],
      activeEndpointId: null,
      health: [],
      cliBaseUrl: null,
      runningSessionCount: null,
    });
  });

  it("carries the health issues and the CLI's own base URL", () => {
    const health = [{ code: "config_unparsable", message: "bad" }];
    expect(
      selectApiEndpointsState({
        data: {
          requestId: "r",
          provider: "claude",
          endpoints: [],
          activeEndpointId: null,
          health,
          cliBaseUrl: "https://mine.example",
          runningSessionCount: 2,
          error: null,
        },
        error: null,
      }),
    ).toEqual({
      status: "ready",
      endpoints: [],
      activeEndpointId: null,
      health,
      cliBaseUrl: "https://mine.example",
      runningSessionCount: 2,
    });
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
    expect(state).toEqual({
      status: "ready",
      endpoints: [ENDPOINT],
      activeEndpointId: "ep_1",
      health: [],
      cliBaseUrl: null,
      runningSessionCount: null,
    });
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

  it("localizes a settings file that kept changing during the write", () => {
    expect(apiEndpointErrorMessageKey({ code: "config_conflict", message: "x" })).toBe(
      "settings.providers.apiEndpoints.configConflict",
    );
  });

  it("localizes an endpoint that doesn't speak the CLI's protocol", () => {
    expect(apiEndpointErrorMessageKey({ code: "protocol_unsupported", message: "x" })).toBe(
      "settings.providers.apiEndpoints.form.testProtocolUnsupported",
    );
  });
});

describe("formatApiEndpointTestDuration", () => {
  it("uses milliseconds under a second and seconds above", () => {
    expect(formatApiEndpointTestDuration(640)).toBe("640 ms");
    expect(formatApiEndpointTestDuration(1234)).toBe("1.2 s");
  });
});

describe("apiEndpointHealthMessageKey", () => {
  it("localizes each known health issue and passes unknown ones through", () => {
    expect(apiEndpointHealthMessageKey({ code: "modified_externally", message: "x" })).toBe(
      "settings.providers.apiEndpoints.health.modifiedExternally",
    );
    expect(apiEndpointHealthMessageKey({ code: "config_unparsable", message: "x" })).toBe(
      "settings.providers.apiEndpoints.health.unparsable",
    );
    expect(apiEndpointHealthMessageKey({ code: "codex_version_unsupported", message: "x" })).toBe(
      "settings.providers.apiEndpoints.codexVersionUnsupported",
    );
    expect(apiEndpointHealthMessageKey({ code: "codex_profile_override", message: "x" })).toBe(
      "settings.providers.apiEndpoints.health.codexProfileOverride",
    );
    expect(apiEndpointHealthMessageKey({ code: "some_future_code", message: "x" })).toBeNull();
  });
});

describe("selectApiEndpointHealthView", () => {
  const MODIFIED = { code: "modified_externally", message: "env.ANTHROPIC_BASE_URL" };
  const PROFILE = { code: "codex_profile_override", message: "profile work" };
  const UNPARSABLE = { code: "config_unparsable", message: "bad" };

  function ready(overrides: Partial<Extract<ApiEndpointsLoadState, { status: "ready" }>>) {
    return {
      status: "ready" as const,
      endpoints: [ENDPOINT],
      activeEndpointId: "ep_1",
      health: [],
      cliBaseUrl: null,
      runningSessionCount: 0,
      ...overrides,
    };
  }

  it("shows nothing while loading, on error, or when everything is fine", () => {
    const none = { alert: null, officialTarget: null };
    expect(selectApiEndpointHealthView({ status: "loading" })).toEqual(none);
    expect(selectApiEndpointHealthView({ status: "error", message: "x" })).toEqual(none);
    expect(selectApiEndpointHealthView(ready({}))).toEqual(none);
  });

  it("offers re-apply and Official when an active endpoint was modified externally, listed first", () => {
    expect(selectApiEndpointHealthView(ready({ health: [PROFILE, MODIFIED] }))).toEqual({
      alert: { variant: "error", issues: [MODIFIED, PROFILE], activeEndpoint: ENDPOINT },
      officialTarget: null,
    });
  });

  it("has no actions for a modified file without an active endpoint", () => {
    expect(
      selectApiEndpointHealthView(ready({ activeEndpointId: null, health: [MODIFIED] })).alert,
    ).toEqual({ variant: "error", issues: [MODIFIED], activeEndpoint: null });
  });

  it("is an error for a broken file and a warning for a profile that only may override", () => {
    expect(selectApiEndpointHealthView(ready({ health: [UNPARSABLE] })).alert?.variant).toBe(
      "error",
    );
    expect(selectApiEndpointHealthView(ready({ health: [PROFILE] })).alert).toEqual({
      variant: "warning",
      issues: [PROFILE],
      activeEndpoint: null,
    });
  });

  it("names where the CLI's own settings point, only in Official", () => {
    expect(
      selectApiEndpointHealthView(
        ready({ activeEndpointId: null, cliBaseUrl: "https://mine.example" }),
      ).officialTarget,
    ).toBe("https://mine.example");
    expect(
      selectApiEndpointHealthView(ready({ cliBaseUrl: "https://mine.example" })).officialTarget,
    ).toBeNull();
  });
});

describe("isActiveApiEndpoint", () => {
  const READY: ApiEndpointsLoadState = {
    status: "ready",
    endpoints: [ENDPOINT],
    activeEndpointId: "ep_1",
    health: [],
    cliBaseUrl: null,
    runningSessionCount: 1,
  };

  it("is true only for the endpoint in use, so saving or deleting it asks first", () => {
    expect(isActiveApiEndpoint(READY, "ep_1")).toBe(true);
    expect(isActiveApiEndpoint(READY, "ep_2")).toBe(false);
    expect(isActiveApiEndpoint(READY, undefined)).toBe(false);
    expect(isActiveApiEndpoint({ ...READY, activeEndpointId: null }, "ep_1")).toBe(false);
    expect(isActiveApiEndpoint({ status: "loading" }, "ep_1")).toBe(false);
  });
});

describe("selectApiEndpointImpact", () => {
  const TERMINAL = { key: "settings.providers.apiEndpoints.impact.terminal" };

  it("says Claude's running sessions switch right away, and the terminal too", () => {
    expect(selectApiEndpointImpact({ provider: "claude", runningSessionCount: 2 })).toEqual([
      { key: "settings.providers.apiEndpoints.impact.sessions", count: 2 },
      TERMINAL,
    ]);
  });

  it("says Codex's running sessions may be affected", () => {
    expect(selectApiEndpointImpact({ provider: "codex", runningSessionCount: 1 })).toEqual([
      { key: "settings.providers.apiEndpoints.impact.sessionsMaybe", count: 1 },
      TERMINAL,
    ]);
  });

  it("says no session is running when there are none", () => {
    expect(selectApiEndpointImpact({ provider: "codex", runningSessionCount: 0 })).toEqual([
      { key: "settings.providers.apiEndpoints.impact.noSessions" },
      TERMINAL,
    ]);
  });

  it("only names keys that exist", () => {
    for (const runningSessionCount of [0, 1, null]) {
      for (const provider of ["claude", "codex"]) {
        for (const { key } of selectApiEndpointImpact({ provider, runningSessionCount })) {
          expect(i18n.exists(key)).toBe(true);
        }
      }
    }
  });

  it("names only the terminal when the host doesn't count sessions", () => {
    expect(selectApiEndpointImpact({ provider: "claude", runningSessionCount: null })).toEqual([
      TERMINAL,
    ]);
  });
});
