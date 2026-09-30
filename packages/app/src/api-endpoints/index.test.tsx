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
      { status: "ready", endpoints: [RELAY], activeEndpointId: null },
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

describe("supportsApiEndpoints", () => {
  it("is limited to the built-in Claude Code provider", () => {
    expect(supportsApiEndpoints("claude")).toBe(true);
    expect(supportsApiEndpoints("my-claude-relay")).toBe(false);
    expect(supportsApiEndpoints("opencode")).toBe(false);
  });
});
