/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentModelDefinition, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { ProviderProfileModel } from "@getpaseo/protocol/provider-config";
import { i18n } from "@/i18n/i18next";
import { ProviderInstallGuideSurface, type ProviderInstallGuide } from "@/provider-install-guide";
import {
  ProviderDetailHeader,
  ProviderDetailMenu,
  ProviderDetailRefreshButton,
  type ProviderDetailHeaderProps,
  type ProviderDetailMenuProps,
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

function resolved() {
  return Promise.resolve();
}

function deferred() {
  let resolve: () => void = noop;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function typeInto(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function searchInput() {
  return screen.getByPlaceholderText(i18n.t("settings.providers.models.searchPlaceholder"));
}

function openAddModelRow() {
  fireEvent.click(screen.getByText(i18n.t("settings.providers.models.addModel")));
}

function addModelInput() {
  return screen.getByPlaceholderText(i18n.t("settings.providers.models.modelIdPlaceholder"));
}

function queryAddModelInput() {
  return screen.queryByPlaceholderText(i18n.t("settings.providers.models.modelIdPlaceholder"));
}

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
      isRefreshing={false}
      deletingModelId={null}
      removalError={null}
      onRefresh={noop}
      onRunDiagnostic={noop}
      onDismissRemovalError={noop}
      onDeleteCustomModel={noop}
      onAddCustomModel={resolved}
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

  it("heads the Models section with the total, the last update and Add model", () => {
    renderDetail({
      entries: [entry({ fetchedAt: new Date().toISOString() })],
      discoveredModels: DISCOVERED,
      additionalModels: CUSTOM,
    });

    const section = screen.getByTestId("provider-models-section");
    expect(within(section).getByText(i18n.t("settings.providers.models.title"))).toBeTruthy();
    expect(within(section).getByText("3")).toBeTruthy();
    expect(
      within(section).getByText(i18n.t("settings.providers.models.updated", { time: "just now" })),
    ).toBeTruthy();
    expect(within(section).getByText(i18n.t("settings.providers.models.addModel"))).toBeTruthy();
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
  });

  it("shows a model once when its name is its id", () => {
    renderDetail({
      discoveredModels: [...DISCOVERED, { provider: "claude", id: "haiku", label: "haiku" }],
      additionalModels: CUSTOM,
    });

    expect(screen.getAllByText("haiku")).toHaveLength(1);
    expect(screen.getAllByText("relay/gpt")).toHaveLength(1);
    expect(screen.getByText("claude-opus")).toBeTruthy();
  });

  it("filters both groups by the search row", () => {
    renderDetail({ discoveredModels: DISCOVERED, additionalModels: CUSTOM });

    typeInto(searchInput(), "opus");

    expect(screen.getByText("Opus")).toBeTruthy();
    expect(screen.queryByText("Sonnet")).toBeNull();
    expect(screen.queryByTestId("provider-models-custom")).toBeNull();

    typeInto(searchInput(), "relay");

    expect(screen.queryByTestId("provider-models-discovered")).toBeNull();
    expect(screen.getByText("relay/gpt")).toBeTruthy();
  });

  it("says so when the search matches nothing", () => {
    renderDetail({ discoveredModels: DISCOVERED, additionalModels: CUSTOM });

    typeInto(searchInput(), "zzz");

    expect(screen.getByText(i18n.t("settings.providers.models.noSearchMatches"))).toBeTruthy();
  });

  it("offers no search while there are no models", () => {
    renderDetail({});

    expect(screen.getByText(i18n.t("settings.providers.models.noneDetected"))).toBeTruthy();
    expect(
      screen.queryByPlaceholderText(i18n.t("settings.providers.models.searchPlaceholder")),
    ).toBeNull();
  });

  it("explains that a disabled provider has no models until enabled", () => {
    renderDetail({ entries: [entry({ enabled: false })] });

    expect(screen.getByText(i18n.t("settings.providers.models.disabledHint"))).toBeTruthy();
    expect(screen.queryByText(i18n.t("settings.providers.models.noneDetected"))).toBeNull();
  });

  it("shows a loading state while the provider is loading and has no models yet", () => {
    renderDetail({ entries: [entry({ status: "loading" })] });

    expect(screen.getByText(i18n.t("settings.providers.models.loading"))).toBeTruthy();
  });

  // 出错时顶部错误卡已有原文和「刷新」，Models 区只说明为什么没有模型。
  it("leaves the provider error to the error card", () => {
    renderDetail({ entries: [entry({ status: "error", error: "opencode exited 1" })] });

    expect(screen.getAllByText("opencode exited 1")).toHaveLength(1);
    const section = screen.getByTestId("provider-models-section");
    expect(within(section).getByText(i18n.t("settings.providers.models.startFailed"))).toBeTruthy();
    expect(
      within(section).queryByText(i18n.t("settings.providers.models.noneDetected")),
    ).toBeNull();
  });

  it("adds a model in place: Enter submits, then the row folds away", async () => {
    const pending = deferred();
    const onAddCustomModel = vi.fn(() => pending.promise);
    renderDetail({ discoveredModels: DISCOVERED, onAddCustomModel });

    openAddModelRow();
    const input = addModelInput();
    expect(document.activeElement).toBe(input);
    typeInto(input, "  openai/gpt-5 ");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAddCustomModel).toHaveBeenCalledWith("openai/gpt-5");
    const adding = screen.getByText(i18n.t("settings.providers.models.adding"));
    expect(adding.closest("[aria-disabled='true']")).toBeTruthy();

    pending.resolve();
    await waitFor(() => expect(queryAddModelInput()).toBeNull());
  });

  it("keeps the input and shows why when adding a model fails", async () => {
    const onAddCustomModel = vi.fn(() => Promise.reject(new Error("config.json is read-only")));
    renderDetail({ onAddCustomModel });

    openAddModelRow();
    typeInto(addModelInput(), "openai/gpt-5");
    fireEvent.click(screen.getByTestId("provider-add-model-submit"));

    const error = await screen.findByTestId("provider-add-model-error");
    expect(within(error).getByText(i18n.t("settings.providers.models.failedToSave"))).toBeTruthy();
    expect(within(error).getByText("config.json is read-only")).toBeTruthy();
    expect((addModelInput() as HTMLInputElement).value).toBe("openai/gpt-5");
    expect(screen.getByText(i18n.t("settings.providers.models.add"))).toBeTruthy();
  });

  it("folds the add row away on Escape or Cancel without adding", () => {
    const onAddCustomModel = vi.fn(() => Promise.resolve());
    renderDetail({ onAddCustomModel });

    openAddModelRow();
    fireEvent.keyDown(addModelInput(), { key: "Escape" });
    expect(queryAddModelInput()).toBeNull();

    openAddModelRow();
    fireEvent.click(screen.getByText(i18n.t("common.actions.cancel")));
    expect(queryAddModelInput()).toBeNull();
    expect(onAddCustomModel).not.toHaveBeenCalled();
  });

  it("does not add an empty id or one already added", () => {
    const onAddCustomModel = vi.fn(() => Promise.resolve());
    renderDetail({ additionalModels: CUSTOM, onAddCustomModel });

    openAddModelRow();
    fireEvent.keyDown(addModelInput(), { key: "Enter" });
    typeInto(addModelInput(), "relay/gpt");
    fireEvent.keyDown(addModelInput(), { key: "Enter" });

    expect(onAddCustomModel).not.toHaveBeenCalled();
  });

  it("opens with an error card naming the provider, its full error and the next steps", () => {
    const onRefresh = vi.fn();
    const onRunDiagnostic = vi.fn();
    const error = "opencode exited 1\n  at spawn (node:child_process:420)";
    renderDetail({
      provider: "opencode",
      entries: [entry({ provider: "opencode", label: "OpenCode", status: "error", error })],
      onRefresh,
      onRunDiagnostic,
    });

    const card = screen.getByTestId("provider-start-error");
    expect(
      within(card).getByText(i18n.t("settings.providers.startErrorTitle", { name: "OpenCode" })),
    ).toBeTruthy();
    // 原文完整保留，换行不折叠。
    expect(within(card).getByText(error, { normalizer: (text) => text })).toBeTruthy();

    fireEvent.click(within(card).getByText(i18n.t("settings.providers.diagnostic.refresh")));
    fireEvent.click(within(card).getByText(i18n.t("settings.providers.diagnostic.run")));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRunDiagnostic).toHaveBeenCalledTimes(1);
  });

  it("shows no error card for a disabled or healthy provider", () => {
    renderDetail({ entries: [entry({ status: "error", error: "boom", enabled: false })] });
    expect(screen.queryByTestId("provider-start-error")).toBeNull();
    cleanup();

    renderDetail({ entries: [entry({})] });
    expect(screen.queryByTestId("provider-start-error")).toBeNull();
  });

  it("warns a custom provider extending Claude Code only while Claude Code uses an API endpoint", () => {
    const workClaude = entry({ provider: "work-claude", label: "Work Claude", source: "custom" });
    const claudeWithEndpoint = entry({ activeApiEndpoint: { id: "ep_1", name: "Relay" } });
    const title = i18n.t("settings.providers.apiEndpoints.inheritedTitle", { name: "Relay" });

    renderDetail({
      provider: "work-claude",
      entries: [claudeWithEndpoint, workClaude],
      extendsProvider: "claude",
    });
    const alert = screen.getByTestId("provider-inherited-api-endpoint");
    expect(within(alert).getByText(title)).toBeTruthy();
    expect(
      within(alert).getByText(i18n.t("settings.providers.apiEndpoints.inheritedDescription")),
    ).toBeTruthy();
    cleanup();

    renderDetail({
      provider: "work-claude",
      entries: [entry({}), workClaude],
      extendsProvider: "claude",
    });
    expect(screen.queryByTestId("provider-inherited-api-endpoint")).toBeNull();
    cleanup();

    renderDetail({ entries: [claudeWithEndpoint] });
    expect(screen.queryByTestId("provider-inherited-api-endpoint")).toBeNull();
  });

  it("shows a failed removal at the top until dismissed", () => {
    const onDismissRemovalError = vi.fn();
    renderDetail({
      entries: [entry({ status: "error", error: "boom" })],
      removalError: "config.json is read-only",
      onDismissRemovalError,
    });

    const alert = screen.getByTestId("provider-removal-error");
    expect(within(alert).getByText(i18n.t("settings.providers.remove.errorTitle"))).toBeTruthy();
    expect(within(alert).getByText("config.json is read-only")).toBeTruthy();
    expect(blockOrder(["provider-removal-error", "provider-start-error"])).toEqual([
      "provider-removal-error",
      "provider-start-error",
    ]);

    fireEvent.click(within(alert).getByText(i18n.t("common.actions.dismiss")));
    expect(onDismissRemovalError).toHaveBeenCalledTimes(1);
  });

  it("orders the error card, the inherited endpoint warning, then the install guide", () => {
    renderDetail({
      provider: "work-claude",
      entries: [
        entry({ activeApiEndpoint: { id: "ep_1", name: "Relay" } }),
        entry({ provider: "work-claude", label: "Work Claude", status: "error", error: "boom" }),
      ],
      extendsProvider: "claude",
    });
    expect(blockOrder(["provider-inherited-api-endpoint", "provider-start-error"])).toEqual([
      "provider-start-error",
      "provider-inherited-api-endpoint",
    ]);
    cleanup();

    renderDetail({
      provider: "work-claude",
      entries: [
        entry({ activeApiEndpoint: { id: "ep_1", name: "Relay" } }),
        entry({ provider: "work-claude", label: "Work Claude", status: "unavailable" }),
      ],
      extendsProvider: "claude",
    });
    expect(
      blockOrder(["provider-install-platform-macos", "provider-inherited-api-endpoint"]),
    ).toEqual(["provider-inherited-api-endpoint", "provider-install-platform-macos"]);
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

// 按文档顺序返回这些 testID。
function blockOrder(testIds: string[]): string[] {
  const nodes = testIds.map((testId) => screen.getByTestId(testId));
  return nodes
    .slice()
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map((node) => node.getAttribute("data-testid") ?? "");
}

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

function renderMenu(overrides: Partial<ProviderDetailMenuProps> = {}) {
  const onDiagnose = vi.fn();
  const onRemove = vi.fn();
  render(
    <ProviderDetailMenu
      provider="work-claude"
      providerLabel="Work Claude"
      providerSource="custom"
      hostSupportsRemoval
      isRemoving={false}
      onDiagnose={onDiagnose}
      onRemove={onRemove}
      placement="inline"
      {...overrides}
    />,
  );
  fireEvent.click(
    screen.getByLabelText(i18n.t("settings.providers.actions.menu", { name: "Work Claude" })),
  );
  return { onDiagnose, onRemove };
}

describe("ProviderDetailMenu", () => {
  afterEach(() => {
    cleanup();
  });

  it("offers the diagnostic", () => {
    const { onDiagnose } = renderMenu();

    fireEvent.click(screen.getByTestId("provider-diagnose-work-claude"));

    expect(onDiagnose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a built-in provider", { providerSource: "builtin" as const }],
    ["a provider without a source", { providerSource: undefined }],
    ["a custom provider on a host that cannot remove providers", { hostSupportsRemoval: false }],
  ])("offers no removal for %s", (_name, overrides) => {
    renderMenu(overrides);

    expect(screen.getByTestId("provider-diagnose-work-claude")).toBeTruthy();
    expect(screen.queryByTestId("provider-remove-work-claude")).toBeNull();
  });

  it("adds Remove provider for a custom provider on a host that can remove it", () => {
    const { onRemove } = renderMenu();

    expect(screen.getByTestId("provider-diagnose-work-claude")).toBeTruthy();
    fireEvent.click(screen.getByTestId("provider-remove-work-claude"));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("shows the removal in progress", () => {
    renderMenu({ isRemoving: true });

    expect(
      within(screen.getByTestId("provider-remove-work-claude")).getByText(
        i18n.t("settings.providers.actions.removing"),
      ),
    ).toBeTruthy();
  });
});
