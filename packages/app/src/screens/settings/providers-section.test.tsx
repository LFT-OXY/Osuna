/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";

const { theme, snapshotState, configState, patchConfigMock, refreshMock, selectProviderMock } =
  vi.hoisted(() => ({
    theme: {
      spacing: { 1: 4, "1.5": 6, 2: 8, 3: 12, 4: 16, 6: 24 },
      iconSize: { sm: 14, md: 20 },
      fontSize: { xs: 11, sm: 13, base: 15 },
      fontWeight: { normal: "400" },
      fontFamily: { ui: "system-ui", mono: "monospace" },
      borderRadius: { lg: 8 },
      radius: { sm: 6, md: 8, lg: 10 },
      // 安装指引区渲染 Button / SegmentedControl，createControlGeometry 读这两组 token。
      borderWidth: { 1: 1 },
      controlHeight: { sm: 24, md: 28, lg: 32 },
      typeScale: {
        caption: { fontSize: 12, lineHeight: 16 },
        body: { fontSize: 14, lineHeight: 20 },
      },
      opacity: { 50: 0.5 },
      colors: {
        surface1: "#111",
        surface2: "#222",
        surface3: "#333",
        foreground: "#fff",
        foregroundMuted: "#aaa",
        border: "#555",
        accent: "#0a84ff",
        statusSuccess: "#00ff00",
        statusWarning: "#ff9500",
        statusDanger: "#ff0000",
        // 目录弹窗的 Alert 读 blue / amber。
        palette: {
          red: { 300: "#ff6b6b" },
          blue: { 300: "#93c5fd" },
          amber: { 500: "#f59e0b" },
          white: "#fff",
        },
      },
    },
    snapshotState: {
      entries: undefined as ProviderSnapshotEntry[] | undefined,
      isLoading: false,
      isRefreshing: false,
    },
    configState: {
      config: null as MutableDaemonConfig | null,
    },
    patchConfigMock: vi.fn(async (_patch: unknown) => undefined),
    refreshMock: vi.fn(async (_providers?: string[]) => undefined),
    selectProviderMock: vi.fn(),
  }));

vi.mock("react-native", () => ({
  Platform: {
    OS: "web",
    select: (options: Record<string, unknown>) => options.web ?? options.default,
  },
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({
    children,
    onPress,
    accessibilityRole,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    onPress?: (event: React.MouseEvent) => void;
    accessibilityRole?: string;
    accessibilityLabel?: string;
  }) =>
    React.createElement(
      "span",
      { role: accessibilityRole, "aria-label": accessibilityLabel, onClick: onPress },
      children,
    ),
  Pressable: ({
    children,
    onPress,
    onHoverIn,
    onHoverOut,
    accessibilityRole,
    accessibilityLabel,
    accessibilityState,
    disabled,
    testID,
  }: {
    children?:
      | React.ReactNode
      | ((state: { pressed: boolean; hovered: boolean }) => React.ReactNode);
    onPress?: (event: React.MouseEvent) => void;
    onHoverIn?: () => void;
    onHoverOut?: () => void;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    accessibilityState?: { selected?: boolean };
    disabled?: boolean;
    testID?: string;
  }) =>
    React.createElement(
      "div",
      {
        role: accessibilityRole,
        "aria-label": accessibilityLabel,
        "aria-selected": accessibilityState?.selected ? "true" : undefined,
        "aria-disabled": disabled ? "true" : undefined,
        "data-testid": testID,
        onClick: disabled ? undefined : onPress,
        onMouseEnter: onHoverIn,
        onMouseLeave: onHoverOut,
      },
      typeof children === "function" ? children({ pressed: false, hovered: false }) : children,
    ),
  ActivityIndicator: () => React.createElement("span", { "data-testid": "activity-indicator" }),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function" ? (factory as (t: typeof theme) => unknown)(theme) : factory,
  },
  // useIsCompactFormFactor 读断点。
  useUnistyles: () => ({ theme, rt: { breakpoint: "md" } }),
  withUnistyles: (Component: React.ComponentType<Record<string, unknown>>) =>
    function Themed({ uniProps: _uniProps, ...props }: Record<string, unknown>) {
      return React.createElement(Component, props);
    },
}));

vi.mock("lucide-react-native", () => {
  const icon = (name: string) => () => React.createElement("span", { "data-icon": name });
  return {
    // 目录弹窗的 Alert 与目录行的图标。
    AlertTriangle: icon("AlertTriangle"),
    CheckCircle2: icon("CheckCircle2"),
    ChevronRight: icon("ChevronRight"),
    Copy: icon("Copy"),
    ExternalLink: icon("ExternalLink"),
    Info: icon("Info"),
    MoreHorizontal: icon("MoreHorizontal"),
    PackagePlus: icon("PackagePlus"),
    Pencil: icon("Pencil"),
    Plus: icon("Plus"),
    Trash2: icon("Trash2"),
    XCircle: icon("XCircle"),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      (
        ({
          "settings.providers.providerDetails": "{{name}} provider details",
          "settings.providers.enableProvider": "Enable {{name}}",
          "settings.providers.statuses.disabled": "Disabled",
          "settings.providers.statuses.available": "Available",
          "settings.providers.statuses.loading": "Loading",
          "settings.providers.statuses.error": "Error",
          "settings.providers.statuses.notInstalled": "Not installed",
          "settings.providers.statuses.apiEndpoint": "API endpoint: {{name}}",
          "settings.providers.models.one": "1 model",
          "settings.providers.models.many": "{{count}} models",
          "settings.providers.addProvider": "Add provider",
          "settings.providers.addErrorTitle": "Unable to add provider",
          "providerCatalog.title": "Add provider",
          "providerCatalog.search": "Search providers",
          "providerCatalog.noProviders": "No providers found",
          "providerCatalog.actions.add": "Add",
          "providerCatalog.actions.adding": "Adding",
          "providerCatalog.actions.installInstructions": "Install instructions",
          "common.actions.dismiss": "Dismiss",
        })[key] ?? key
      )
        .replaceAll("{{name}}", String(values?.name ?? ""))
        .replaceAll("{{count}}", String(values?.count ?? "")),
  }),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    value,
    onValueChange,
    disabled,
    accessibilityLabel,
    testID,
  }: {
    value: boolean;
    onValueChange?: (next: boolean) => void;
    disabled?: boolean;
    accessibilityLabel?: string;
    testID?: string;
  }) =>
    React.createElement("div", {
      role: "switch",
      "aria-checked": value ? "true" : "false",
      "aria-disabled": disabled ? "true" : undefined,
      "aria-label": accessibilityLabel,
      "data-testid": testID ?? "provider-switch",
      onClick: (event: React.MouseEvent) => {
        event.stopPropagation();
        if (disabled) return;
        onValueChange?.(!value);
      },
    }),
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => React.createElement("span", { "data-testid": "loading-spinner" }),
}));

vi.mock("@/components/settings/headings/settings-info-tip", () => ({
  SettingsInfoTip: () => null,
}));

vi.mock("@/components/provider-icons", () => ({
  getProviderIcon: (provider: string) => () =>
    React.createElement("span", { "data-icon": `provider-${provider}` }),
  resolveProviderGlyph: ({ provider, tone }: { provider: string; tone: string }) => ({
    Icon: () => React.createElement("span", { "data-icon": `provider-${provider}-${tone}` }),
    brandColor: null,
  }),
}));

// 目录行的图标与安装链接不在断言范围内。
vi.mock("react-native-svg", () => ({
  SvgXml: () => React.createElement("span", { "data-icon": "catalog-svg" }),
}));

vi.mock("@/utils/open-external-url", () => ({
  openExternalUrl: vi.fn(async () => undefined),
}));

// 真实的底部 sheet / 居中卡片依赖原生手势与动画，这里只保留标题、头部搜索和内容。
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    header,
    visible,
    children,
    onClose,
    testID,
  }: {
    header: { title: string; search?: { onChange: (value: string) => void; placeholder?: string } };
    visible: boolean;
    children?: React.ReactNode;
    onClose: () => void;
    testID?: string;
  }) =>
    visible
      ? React.createElement(
          "div",
          { role: "dialog", "data-testid": testID },
          React.createElement("h2", null, header.title),
          header.search
            ? React.createElement("input", {
                "aria-label": header.search.placeholder,
                onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                  header.search?.onChange(event.target.value),
              })
            : null,
          React.createElement("button", { type: "button", onClick: onClose }, "Close"),
          children,
        )
      : null,
}));

vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({
    entries: snapshotState.entries,
    isLoading: snapshotState.isLoading,
    isFetching: false,
    isRefreshing: snapshotState.isRefreshing,
    error: null,
    supportsSnapshot: true,
    refresh: refreshMock,
    refetchIfStale: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({
    config: configState.config,
    isLoading: false,
    patchConfig: patchConfigMock,
  }),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeIsConnected: () => true,
}));

import {
  buildAcpProviderConfigPatch,
  getAcpProviderCatalog,
} from "@/hooks/use-acp-provider-catalog";
import { ProvidersSection } from "./providers-section";
import type { ProvidersLayout } from "./providers-layout";

const catalog = getAcpProviderCatalog();
const minimax = (() => {
  const entry = catalog.find((candidate) => candidate.id === "minimax-code");
  if (!entry) throw new Error("Expected MiniMax Code in the ACP catalog");
  return entry;
})();

const claudeEntry: ProviderSnapshotEntry = {
  provider: "claude",
  status: "ready",
  enabled: true,
  label: "Claude",
  description: "Claude Code",
  defaultModeId: null,
  modes: [],
  models: [
    { provider: "claude", id: "claude-opus-4-7", label: "Claude Opus 4.7" },
    { provider: "claude", id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { provider: "claude", id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
};

const disabledCodexEntry: ProviderSnapshotEntry = {
  provider: "codex",
  status: "unavailable",
  enabled: false,
  label: "Codex",
  description: "OpenAI Codex",
  defaultModeId: null,
  modes: [],
};

const notInstalledCodexEntry: ProviderSnapshotEntry = {
  ...disabledCodexEntry,
  enabled: true,
};

const notInstalledCustomClaudeEntry: ProviderSnapshotEntry = {
  provider: "work-claude",
  status: "unavailable",
  enabled: true,
  label: "Work Claude",
  description: "Claude Code",
  defaultModeId: null,
  modes: [],
  source: "custom",
};

function makeConfig(providers: MutableDaemonConfig["providers"] = {}): MutableDaemonConfig {
  return {
    relay: { enabled: false },
    mcp: { injectIntoAgents: false },
    browserTools: { enabled: false },
    providers,
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
  };
}

function descendants(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>("*"));
}

function indexOfMatches(nodes: HTMLElement[], selector: string): number {
  return nodes.findIndex((node) => node.matches(selector));
}

function indexOfText(nodes: HTMLElement[], text: string): number {
  return nodes.findIndex((node) => node.textContent?.trim() === text);
}

describe("ProvidersSection", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    snapshotState.entries = undefined;
    snapshotState.isLoading = false;
    snapshotState.isRefreshing = false;
    configState.config = null;
    patchConfigMock.mockReset();
    patchConfigMock.mockResolvedValue(undefined);
    refreshMock.mockReset();
    refreshMock.mockResolvedValue(undefined);
    selectProviderMock.mockReset();
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

  function render(
    options: { layout?: ProvidersLayout; selectedProvider?: string | null } = {},
  ): void {
    act(() => {
      root?.render(
        <ProvidersSection
          serverId="server-1"
          layout={options.layout ?? "split"}
          selectedProvider={options.selectedProvider ?? null}
          onSelectProvider={selectProviderMock}
        />,
      );
    });
  }

  function findRow(accessibilityLabel: string): HTMLElement {
    const row = container?.querySelector<HTMLElement>(
      `[role="button"][aria-label="${accessibilityLabel}"]`,
    );
    if (!row) throw new Error(`Expected row with aria-label "${accessibilityLabel}"`);
    return row;
  }

  it("renders the disabled provider with its server-provided label in snapshot order", () => {
    snapshotState.entries = [claudeEntry, disabledCodexEntry];
    configState.config = makeConfig({ codex: { enabled: false } });

    render();

    const rows = Array.from(
      container?.querySelectorAll<HTMLElement>('[role="button"][aria-label$="provider details"]') ??
        [],
    );
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Claude provider details",
      "Codex provider details",
    ]);

    const codexRow = findRow("Codex provider details");
    const codexNodes = descendants(codexRow);
    expect(indexOfText(codexNodes, "Codex")).toBeGreaterThanOrEqual(0);
    expect(indexOfText(codexNodes, "codex")).toBe(-1);
    expect(indexOfText(codexNodes, "Disabled")).toBeGreaterThanOrEqual(0);
  });

  it("composes the row as brand icon, label, status line, then switch", () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();

    render();

    const row = findRow("Claude provider details");
    const nodes = descendants(row);
    const icon = indexOfMatches(nodes, '[data-icon="provider-claude-brand"]');
    const label = indexOfText(nodes, "Claude");
    const statusDot = indexOfMatches(nodes, '[data-testid="provider-status-dot-success"]');
    const statusText = nodes.findIndex(
      (node) => node.tagName === "SPAN" && node.textContent === "3 models",
    );
    const switchEl = indexOfMatches(nodes, '[role="switch"]');

    expect(icon).toBeGreaterThanOrEqual(0);
    expect(label).toBeGreaterThan(icon);
    expect(statusDot).toBeGreaterThan(label);
    expect(statusText).toBeGreaterThan(statusDot);
    expect(switchEl).toBeGreaterThan(statusText);
    expect(indexOfMatches(nodes, '[data-icon="ChevronRight"]')).toBe(-1);
    expect(indexOfText(nodes, "Available")).toBe(-1);
  });

  it("adds a chevron to each row in the stacked layout", () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();

    render({ layout: "stacked" });

    const nodes = descendants(findRow("Claude provider details"));
    expect(indexOfMatches(nodes, '[data-icon="ChevronRight"]')).toBeGreaterThan(
      indexOfMatches(nodes, '[role="switch"]'),
    );
  });

  it.each([
    ["disabled", { ...claudeEntry, enabled: false }, "muted", "Disabled"],
    ["loading", { ...claudeEntry, status: "loading" }, null, "Loading"],
    ["error", { ...claudeEntry, status: "error", error: "boom" }, "danger", "Error"],
    [
      "using an API endpoint",
      { ...claudeEntry, activeApiEndpoint: { id: "ep_1", name: "Relay" } },
      "success",
      "API endpoint: Relay",
    ],
    ["available", claudeEntry, "success", "3 models"],
    [
      "available with one model",
      { ...claudeEntry, models: claudeEntry.models?.slice(0, 1) },
      "success",
      "1 model",
    ],
    [
      "not installed",
      { ...claudeEntry, status: "unavailable", models: [] },
      "warning",
      "Not installed",
    ],
  ] as const)("shows the %s status line", (_name, entry, dotTone, text) => {
    snapshotState.entries = [entry as ProviderSnapshotEntry];
    configState.config = makeConfig();

    render();

    const row = findRow("Claude provider details");
    const nodes = descendants(row);
    expect(indexOfText(nodes, text)).toBeGreaterThan(-1);
    if (dotTone) {
      expect(row.querySelector(`[data-testid="provider-status-dot-${dotTone}"]`)).not.toBeNull();
    } else {
      expect(row.querySelector('[data-testid="loading-spinner"]')).not.toBeNull();
    }
  });

  it("selects the provider when its row is pressed", () => {
    snapshotState.entries = [claudeEntry, disabledCodexEntry];
    configState.config = makeConfig({ codex: { enabled: false } });

    render();

    act(() => {
      findRow("Codex provider details").dispatchEvent(
        new window.MouseEvent("click", { bubbles: true }),
      );
    });

    expect(selectProviderMock).toHaveBeenCalledTimes(1);
    expect(selectProviderMock).toHaveBeenCalledWith("codex");
  });

  it("highlights the selected row only in the split layout", () => {
    snapshotState.entries = [claudeEntry, disabledCodexEntry];
    configState.config = makeConfig({ codex: { enabled: false } });

    render({ selectedProvider: "codex" });

    expect(findRow("Codex provider details").getAttribute("aria-selected")).toBe("true");
    expect(findRow("Claude provider details").getAttribute("aria-selected")).toBeNull();

    render({ layout: "stacked", selectedProvider: "codex" });

    expect(findRow("Codex provider details").getAttribute("aria-selected")).toBeNull();
  });

  it("does not select the row when its switch is pressed", async () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();

    render();

    const switchEl =
      findRow("Claude provider details").querySelector<HTMLElement>('[role="switch"]');
    await act(async () => {
      switchEl?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(patchConfigMock).toHaveBeenCalledTimes(1);
    expect(selectProviderMock).not.toHaveBeenCalled();
  });

  it("keeps errors, install links, menus and API endpoint notes out of the rows", () => {
    const workClaude: ProviderSnapshotEntry = {
      ...notInstalledCustomClaudeEntry,
      status: "error",
      error: "work-claude exited 1",
    };
    snapshotState.entries = [
      { ...claudeEntry, activeApiEndpoint: { id: "ep_1", name: "Relay" } },
      notInstalledCodexEntry,
      workClaude,
    ];
    configState.config = makeConfig({
      "work-claude": { extends: "claude", label: "Work Claude" },
    });

    render();

    const text = container?.textContent ?? "";
    expect(text).not.toContain("work-claude exited 1");
    expect(text).not.toContain("How to install");
    expect(text).not.toContain("Also uses Claude Code's API endpoint");
    expect(container?.querySelector('[data-icon="MoreHorizontal"]')).toBeNull();
    expect(container?.querySelector('[role="link"]')).toBeNull();
    expect(
      indexOfText(descendants(findRow("Work Claude provider details")), "Error"),
    ).toBeGreaterThan(-1);
  });

  it("shows a failed switch at the top of the list until dismissed", async () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();
    patchConfigMock.mockRejectedValueOnce(new Error("config.json is read-only"));

    render();

    const switchEl =
      findRow("Claude provider details").querySelector<HTMLElement>('[role="switch"]');
    await act(async () => {
      switchEl?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    const errorRow = container?.querySelector<HTMLElement>(
      '[data-testid="providers-toggle-error"]',
    );
    expect(errorRow?.textContent).toContain("config.json is read-only");
    expect(selectProviderMock).not.toHaveBeenCalled();

    const dismiss = Array.from(errorRow?.querySelectorAll<HTMLElement>("*") ?? []).find(
      (node) => node.getAttribute("role") === "button" && node.textContent === "Dismiss",
    );
    if (!dismiss) throw new Error("Expected the Dismiss button on the error row");
    act(() => {
      dismiss.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(container?.querySelector('[data-testid="providers-toggle-error"]')).toBeNull();
  });

  it("clears a failed switch when the next switch starts", async () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();
    patchConfigMock.mockRejectedValueOnce(new Error("config.json is read-only"));

    render();

    const switchEl =
      findRow("Claude provider details").querySelector<HTMLElement>('[role="switch"]');
    await act(async () => {
      switchEl?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(container?.querySelector('[data-testid="providers-toggle-error"]')).not.toBeNull();

    await act(async () => {
      switchEl?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(container?.querySelector('[data-testid="providers-toggle-error"]')).toBeNull();
  });

  it("toggles the provider enabled flag through patchConfig when the switch is pressed", async () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();

    render();

    const row = findRow("Claude provider details");
    const switchEl = row.querySelector<HTMLElement>('[role="switch"]');
    expect(switchEl).not.toBeNull();
    expect(switchEl?.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      switchEl?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(patchConfigMock).toHaveBeenCalledTimes(1);
    expect(patchConfigMock).toHaveBeenCalledWith({
      providers: { claude: { enabled: false } },
    });
  });

  function findCatalogDialog(): HTMLElement | null {
    return container?.querySelector<HTMLElement>('[data-testid="provider-catalog-dialog"]') ?? null;
  }

  function requireCatalogDialog(): HTMLElement {
    const dialog = findCatalogDialog();
    if (!dialog) throw new Error("Expected the catalog dialog to be open");
    return dialog;
  }

  function click(element: HTMLElement): void {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  }

  function openCatalogDialog(): HTMLElement {
    const addButton = container?.querySelector<HTMLElement>(
      '[role="button"][aria-label="Add provider"]',
    );
    if (!addButton) throw new Error("Expected the Add provider button in the list header");
    act(() => click(addButton));
    return requireCatalogDialog();
  }

  function findCatalogAddButton(providerId: string): HTMLElement | null {
    return (
      findCatalogDialog()?.querySelector<HTMLElement>(
        `[data-testid="install-provider-${providerId}"]`,
      ) ?? null
    );
  }

  async function pressAddInCatalog(): Promise<void> {
    const addButton = findCatalogAddButton(minimax.id);
    if (!addButton) throw new Error("Expected the catalog entry's Add button");
    await act(async () => click(addButton));
  }

  function closeCatalogDialog(): void {
    const closeButton = Array.from(
      requireCatalogDialog().querySelectorAll<HTMLElement>("button"),
    ).find((button) => button.textContent === "Close");
    if (!closeButton) throw new Error("Expected the dialog close button");
    act(() => click(closeButton));
  }

  function deferPatch(): () => Promise<void> {
    let resolvePatch: () => void = () => {};
    patchConfigMock.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolvePatch = () => resolve(undefined);
        }),
    );
    return async () => {
      await act(async () => resolvePatch());
    };
  }

  it("opens the ACP catalog from the list header instead of an Add provider section", () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();

    render();

    expect(findCatalogDialog()).toBeNull();
    expect(container?.textContent).not.toContain("Add provider");

    const dialog = openCatalogDialog();

    expect(dialog.querySelector("h2")?.textContent).toBe("Add provider");
    expect(findCatalogAddButton(minimax.id)).not.toBeNull();
  });

  it("filters the catalog with the dialog header search", () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();

    render();
    const dialog = openCatalogDialog();
    const otherEntry = catalog.find((entry) => entry.id !== minimax.id);
    if (!otherEntry) throw new Error("Expected more than one ACP catalog entry");
    expect(findCatalogAddButton(otherEntry.id)).not.toBeNull();

    const search = dialog.querySelector<HTMLInputElement>('input[aria-label="Search providers"]');
    if (!search) throw new Error("Expected the search field in the dialog header");
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(search, "MiniMax Code");
      search.dispatchEvent(new window.Event("input", { bubbles: true }));
    });

    expect(findCatalogAddButton(minimax.id)).not.toBeNull();
    expect(findCatalogAddButton(otherEntry.id)).toBeNull();
  });

  it("adds the provider, closes the dialog, then selects the new provider", async () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();
    const resolvePatch = deferPatch();

    render();
    openCatalogDialog();
    await pressAddInCatalog();

    expect(patchConfigMock).toHaveBeenCalledWith(buildAcpProviderConfigPatch(minimax));
    expect(findCatalogAddButton(minimax.id)?.textContent).toContain("Adding");
    expect(selectProviderMock).not.toHaveBeenCalled();

    await resolvePatch();

    expect(refreshMock).toHaveBeenCalledWith([minimax.id]);
    expect(findCatalogDialog()).toBeNull();
    expect(selectProviderMock).toHaveBeenCalledTimes(1);
    expect(selectProviderMock).toHaveBeenCalledWith(minimax.id);
  });

  it("selects the new provider once the snapshot has it, without waiting for its probe", async () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();
    refreshMock.mockImplementationOnce(() => new Promise<undefined>(() => {}));

    render();
    openCatalogDialog();
    await pressAddInCatalog();

    expect(findCatalogAddButton(minimax.id)?.textContent).toContain("Adding");
    expect(selectProviderMock).not.toHaveBeenCalled();

    snapshotState.entries = [
      claudeEntry,
      { ...claudeEntry, provider: minimax.id, status: "loading", label: minimax.title },
    ];
    render();

    expect(findCatalogDialog()).toBeNull();
    expect(selectProviderMock).toHaveBeenCalledTimes(1);
    expect(selectProviderMock).toHaveBeenCalledWith(minimax.id);
  });

  // 真实 daemon 无法稳定造出配置写入失败，失败路径只在这里覆盖（docs/testing.md）。
  it("keeps the dialog open with a visible error when adding fails, and lets you retry", async () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();
    patchConfigMock.mockRejectedValueOnce(new Error("config.json is read-only"));

    render();
    openCatalogDialog();
    await pressAddInCatalog();

    const dialogText = requireCatalogDialog().textContent;
    expect(dialogText).toContain("Unable to add provider");
    expect(dialogText).toContain("config.json is read-only");
    expect(findCatalogAddButton(minimax.id)?.textContent).not.toContain("Adding");
    expect(selectProviderMock).not.toHaveBeenCalled();

    await pressAddInCatalog();

    expect(patchConfigMock).toHaveBeenCalledTimes(2);
    expect(findCatalogDialog()).toBeNull();
    expect(selectProviderMock).toHaveBeenCalledWith(minimax.id);
  });

  it("treats the provider as added when only the snapshot refresh fails", async () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();
    refreshMock.mockRejectedValueOnce(new Error("snapshot timed out"));

    render();
    openCatalogDialog();
    await pressAddInCatalog();

    expect(findCatalogDialog()).toBeNull();
    expect(selectProviderMock).toHaveBeenCalledWith(minimax.id);
  });

  it("drops the result of an add that was still running when the dialog closed", async () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();
    const resolvePatch = deferPatch();

    render();
    openCatalogDialog();
    await pressAddInCatalog();
    closeCatalogDialog();
    await resolvePatch();

    expect(selectProviderMock).not.toHaveBeenCalled();
    openCatalogDialog();
    expect(requireCatalogDialog().textContent).not.toContain("Unable to add provider");
    expect(findCatalogAddButton(minimax.id)?.textContent).not.toContain("Adding");
  });
});
