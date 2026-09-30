/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentModelDefinition, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { ProviderProfileModel } from "@getpaseo/protocol/provider-config";
import { i18n } from "@/i18n/i18next";
import { ProviderInstallGuideSurface, type ProviderInstallGuide } from "@/provider-install-guide";
import {
  ProviderDetailHeader,
  ProviderDetailRefreshButton,
  type ProviderDetailHeaderProps,
} from "./header";
import { ProviderDetailSurface, type ProviderDetailSurfaceProps } from "./index";

function entry(overrides: Partial<ProviderSnapshotEntry>): ProviderSnapshotEntry {
  return {
    provider: "claude",
    status: "ready",
    enabled: true,
    label: "Claude Code",
    ...overrides,
  };
}

const DISCOVERED: AgentModelDefinition[] = [
  { provider: "claude", id: "claude-sonnet", label: "Sonnet" },
  { provider: "claude", id: "claude-opus", label: "Opus" },
];
const CUSTOM: ProviderProfileModel[] = [{ id: "relay/gpt", label: "relay/gpt" }];

function noop() {}

function renderInstallGuide(guide: ProviderInstallGuide, cliLabel: string) {
  return (
    <ProviderInstallGuideSurface
      guide={guide}
      cliLabel={cliLabel}
      onCopyCommand={noop}
      onOpenDocs={noop}
    />
  );
}

function renderApiEndpoints(providerLabel: string) {
  return <div data-testid="api-endpoints-slot">{providerLabel}</div>;
}

function renderDetail(overrides: Partial<ProviderDetailSurfaceProps>) {
  render(
    <ProviderDetailSurface
      provider="claude"
      entries={[entry({})]}
      extendsProvider={undefined}
      hostPlatform="darwin"
      hostSupportsApiEndpoints
      discoveredModels={[]}
      additionalModels={[]}
      modelQuery=""
      isRefreshing={false}
      deletingModelId={null}
      onRefresh={noop}
      onDeleteCustomModel={noop}
      renderInstallGuide={renderInstallGuide}
      renderApiEndpoints={renderApiEndpoints}
      {...overrides}
    />,
  );
}

describe("ProviderDetailSurface", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the install guide for a provider that is not installed", () => {
    renderDetail({ entries: [entry({ status: "unavailable" })] });

    expect(
      screen.getByText(i18n.t("settings.providers.install.title", { name: "Claude Code" })),
    ).toBeTruthy();
    expect(
      screen.getByTestId("provider-install-platform-macos").getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("guides a custom provider to the CLI it extends", () => {
    renderDetail({
      provider: "work-claude",
      entries: [
        entry({ provider: "work-claude", label: "Work Claude", status: "unavailable" }),
        entry({}),
      ],
      extendsProvider: "claude",
    });

    expect(
      screen.getByText(i18n.t("settings.providers.install.title", { name: "Claude Code" })),
    ).toBeTruthy();
  });

  it("shows no install guide once the provider is installed", () => {
    renderDetail({ entries: [entry({ status: "ready" })] });

    expect(screen.queryByTestId("provider-install-platform-macos")).toBeNull();
  });

  it("shows API endpoints for Claude Code and Codex only", () => {
    renderDetail({});
    expect(screen.getByTestId("api-endpoints-slot").textContent).toBe("Claude Code");
    cleanup();

    renderDetail({ provider: "codex", entries: [entry({ provider: "codex", label: "Codex" })] });
    expect(screen.getByTestId("api-endpoints-slot").textContent).toBe("Codex");
    cleanup();

    renderDetail({
      provider: "opencode",
      entries: [entry({ provider: "opencode", label: "OpenCode" })],
    });
    expect(screen.queryByTestId("api-endpoints-slot")).toBeNull();
  });

  it("hides API endpoints when the host does not support them", () => {
    renderDetail({ hostSupportsApiEndpoints: false });

    expect(screen.queryByTestId("api-endpoints-slot")).toBeNull();
  });

  it("lists discovered and custom models in two groups", () => {
    renderDetail({ discoveredModels: DISCOVERED, additionalModels: CUSTOM });

    const discoveredGroup = screen.getByTestId("provider-models-discovered");
    expect(
      within(discoveredGroup).getByText(i18n.t("settings.providers.models.discovered")),
    ).toBeTruthy();
    expect(within(discoveredGroup).getByText("2")).toBeTruthy();
    expect(within(discoveredGroup).getByText("Sonnet")).toBeTruthy();
    expect(within(discoveredGroup).getByText("claude-opus")).toBeTruthy();

    const customGroup = screen.getByTestId("provider-models-custom");
    expect(within(customGroup).getByText(i18n.t("settings.providers.models.custom"))).toBeTruthy();
    expect(within(customGroup).getByText("1")).toBeTruthy();
    expect(within(customGroup).getAllByText("relay/gpt")).toHaveLength(2);
  });

  it("filters both groups by the search query", () => {
    renderDetail({ discoveredModels: DISCOVERED, additionalModels: CUSTOM, modelQuery: "opus" });

    expect(screen.getByText("Opus")).toBeTruthy();
    expect(screen.queryByText("Sonnet")).toBeNull();
    expect(screen.queryByTestId("provider-models-custom")).toBeNull();
  });

  it("says so when the search matches nothing", () => {
    renderDetail({ discoveredModels: DISCOVERED, additionalModels: CUSTOM, modelQuery: "zzz" });

    expect(screen.getByText(i18n.t("settings.providers.models.noSearchMatches"))).toBeTruthy();
  });

  it("says no models were detected when both groups are empty", () => {
    renderDetail({});

    expect(screen.getByText(i18n.t("settings.providers.models.noneDetected"))).toBeTruthy();
  });

  it("shows a loading state while the provider is loading and has no models yet", () => {
    renderDetail({ entries: [entry({ status: "loading" })] });

    expect(screen.getByText(i18n.t("settings.providers.models.loading"))).toBeTruthy();
  });

  it("shows the provider error with a retry that refreshes", () => {
    const onRefresh = vi.fn();
    renderDetail({ entries: [entry({ status: "error", error: "opencode exited 1" })], onRefresh });

    expect(screen.getByText("opencode exited 1")).toBeTruthy();
    fireEvent.click(screen.getByText(i18n.t("settings.providers.models.retry")));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows the retry as in progress while a refresh runs", () => {
    renderDetail({ entries: [entry({ status: "error", error: "boom" })], isRefreshing: true });

    expect(screen.getByText(i18n.t("settings.providers.models.retrying"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("settings.providers.models.retry"))).toBeNull();
  });

  it("deletes a custom model by id", () => {
    const onDeleteCustomModel = vi.fn();
    renderDetail({ additionalModels: CUSTOM, onDeleteCustomModel });

    fireEvent.click(
      screen.getByLabelText(i18n.t("settings.providers.models.removeModel", { id: "relay/gpt" })),
    );
    expect(onDeleteCustomModel).toHaveBeenCalledWith("relay/gpt");
  });
});

function ProviderGlyph() {
  return <span data-testid="provider-glyph" />;
}

const AVAILABLE: ProviderDetailHeaderProps["status"] = {
  tone: "success",
  label: { key: "settings.providers.statuses.available" },
};
const NOT_INSTALLED: ProviderDetailHeaderProps["status"] = {
  tone: "warning",
  label: { key: "settings.providers.statuses.notInstalled" },
};
const THREE_MODELS = { key: "settings.providers.models.many", params: { count: 3 } };

function renderHeader(overrides: Partial<ProviderDetailHeaderProps> = {}) {
  render(
    <ProviderDetailHeader
      icon={ProviderGlyph}
      label="Claude Code"
      status={AVAILABLE}
      modelCount={THREE_MODELS}
      {...overrides}
    />,
  );
}

function renderRefreshButton(isRefreshing: boolean) {
  const onRefresh = vi.fn();
  render(<ProviderDetailRefreshButton isRefreshing={isRefreshing} onRefresh={onRefresh} />);
  return { onRefresh };
}

describe("ProviderDetailHeader", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the icon, name, status badge and model count", () => {
    renderHeader();

    expect(screen.getByTestId("provider-glyph")).toBeTruthy();
    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.getByText(i18n.t("settings.providers.statuses.available"))).toBeTruthy();
    expect(screen.getByText(i18n.t("settings.providers.models.many", { count: 3 }))).toBeTruthy();
  });

  it("omits the model count when none is given", () => {
    renderHeader({ status: NOT_INSTALLED, modelCount: null });

    expect(screen.getByText(i18n.t("settings.providers.statuses.notInstalled"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("settings.providers.models.many", { count: 3 }))).toBeNull();
  });

  it("leaves refresh to the screen header when given no actions", () => {
    renderHeader({ renderActions: undefined });

    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.queryByText(i18n.t("settings.providers.diagnostic.refresh"))).toBeNull();
  });
});

describe("ProviderDetailRefreshButton", () => {
  afterEach(() => {
    cleanup();
  });

  it("refreshes the provider", () => {
    const { onRefresh } = renderRefreshButton(false);

    fireEvent.click(screen.getByText(i18n.t("settings.providers.diagnostic.refresh")));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows refresh in progress and blocks another refresh", () => {
    const { onRefresh } = renderRefreshButton(true);

    fireEvent.click(screen.getByText(i18n.t("settings.providers.diagnostic.refreshing")));

    expect(screen.queryByText(i18n.t("settings.providers.diagnostic.refresh"))).toBeNull();
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
