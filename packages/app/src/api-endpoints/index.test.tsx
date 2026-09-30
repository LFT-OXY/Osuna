/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { ApiEndpointsSection, supportsApiEndpoints, type ApiEndpointsLoadState } from "./index";

const RELAY = {
  id: "ep_1",
  provider: "claude",
  name: "Relay",
  baseUrl: "https://relay.example/api",
  models: [{ id: "relay/sonnet" }, { id: "relay/haiku" }],
  defaultModelId: "relay/sonnet",
  hasApiKey: true,
};

function renderSection(state: ApiEndpointsLoadState, actionError: string | null = null) {
  const handlers = {
    onDismissError: vi.fn(),
    onActivate: vi.fn(),
    onReapply: vi.fn(),
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    <ApiEndpointsSection
      providerLabel="Claude Code"
      state={state}
      busy={false}
      actionError={actionError}
      {...handlers}
    />,
  );
  return handlers;
}

describe("ApiEndpointsSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("marks Official as in use and offers each saved endpoint", () => {
    const handlers = renderSection({
      status: "ready",
      endpoints: [RELAY],
      activeEndpointId: null,
      health: [],
      cliBaseUrl: null,
    });

    expect(screen.getByTestId("api-endpoints-use-official-active")).toBeTruthy();
    expect(screen.getByText("Relay")).toBeTruthy();
    expect(screen.getByText("https://relay.example/api")).toBeTruthy();
    expect(
      screen.getByText(i18n.t("settings.providers.apiEndpoints.modelCount", { count: 2 })),
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId("api-endpoint-use-ep_1"));
    expect(handlers.onActivate).toHaveBeenCalledWith(RELAY);
  });

  it("offers switching back to Official while an endpoint is in use", () => {
    const handlers = renderSection({
      status: "ready",
      endpoints: [RELAY],
      activeEndpointId: "ep_1",
      health: [],
      cliBaseUrl: null,
    });

    expect(screen.getByTestId("api-endpoint-use-ep_1-active")).toBeTruthy();
    fireEvent.click(screen.getByTestId("api-endpoints-use-official"));
    expect(handlers.onActivate).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByTestId("api-endpoint-edit-ep_1"));
    expect(handlers.onEdit).toHaveBeenCalledWith(RELAY);
    fireEvent.click(screen.getByTestId("api-endpoint-delete-ep_1"));
    expect(handlers.onDelete).toHaveBeenCalledWith(RELAY);
  });

  it("shows the daemon's reason when the list fails, and no Add until it loads", () => {
    renderSection({ status: "error", message: "boom" });

    expect(screen.getByText("boom")).toBeTruthy();
    expect(screen.getByTestId("api-endpoints-add").getAttribute("aria-disabled")).toBe("true");
  });
});

describe("ApiEndpointsSection failure", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps a failed switch visible above the modes until dismissed", () => {
    const handlers = renderSection(
      { status: "ready", endpoints: [RELAY], activeEndpointId: null, health: [], cliBaseUrl: null },
      "settings.json could not be parsed",
    );

    const row = screen.getByTestId("api-endpoints-action-error");
    expect(row.textContent).toContain("settings.json could not be parsed");
    // 失败后仍然能重试或切回官方。
    expect(screen.getByTestId("api-endpoint-use-ep_1")).toBeTruthy();

    fireEvent.click(screen.getByText(i18n.t("common.actions.dismiss")));
    expect(handlers.onDismissError).toHaveBeenCalledTimes(1);
  });
});

describe("ApiEndpointsSection health", () => {
  afterEach(() => {
    cleanup();
  });

  it("offers re-apply and Official when the settings file was modified externally", () => {
    const handlers = renderSection({
      status: "ready",
      endpoints: [RELAY],
      activeEndpointId: "ep_1",
      health: [
        { code: "modified_externally", message: "settings.json: env.ANTHROPIC_BASE_URL" },
        { code: "some_future_code", message: "Something new" },
      ],
      cliBaseUrl: null,
    });

    const alert = screen.getByTestId("api-endpoints-health");
    expect(alert.textContent).toContain(
      i18n.t("settings.providers.apiEndpoints.health.modifiedExternally", {
        provider: "Claude Code",
      }),
    );
    expect(alert.textContent).toContain("settings.json: env.ANTHROPIC_BASE_URL");
    expect(alert.textContent).toContain("Something new");

    fireEvent.click(screen.getByTestId("api-endpoints-reapply"));
    expect(handlers.onReapply).toHaveBeenCalledWith(RELAY);
    fireEvent.click(screen.getByTestId("api-endpoints-health-official"));
    expect(handlers.onActivate).toHaveBeenCalledWith(null);
  });

  it("explains a problem without offering actions", () => {
    renderSection({
      status: "ready",
      endpoints: [RELAY],
      activeEndpointId: null,
      health: [{ code: "codex_profile_override", message: 'profile "work"' }],
      cliBaseUrl: null,
    });

    expect(screen.getByTestId("api-endpoints-health").textContent).toContain('profile "work"');
    expect(screen.queryByTestId("api-endpoints-reapply")).toBeNull();
  });

  it("names where the CLI's own settings point while Official is in use", () => {
    renderSection({
      status: "ready",
      endpoints: [],
      activeEndpointId: null,
      health: [],
      cliBaseUrl: "https://hand-written.example",
    });

    expect(screen.getByTestId("api-endpoints-official-target").textContent).toBe(
      i18n.t("settings.providers.apiEndpoints.health.officialTarget", {
        provider: "Claude Code",
        url: "https://hand-written.example",
      }),
    );
    expect(screen.queryByTestId("api-endpoints-health")).toBeNull();
  });
});

describe("supportsApiEndpoints", () => {
  it("is limited to the built-in Claude Code and Codex providers", () => {
    expect(supportsApiEndpoints("claude")).toBe(true);
    expect(supportsApiEndpoints("codex")).toBe(true);
    expect(supportsApiEndpoints("my-claude-relay")).toBe(false);
    expect(supportsApiEndpoints("my-codex-relay")).toBe(false);
    expect(supportsApiEndpoints("opencode")).toBe(false);
  });
});
