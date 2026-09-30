/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";

const { theme, snapshotState, configState, patchConfigMock, openProviderSettingsMock } = vi.hoisted(
  () => ({
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
        // Alert（经 @/api-endpoints 入口引入）读 blue / amber。
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
    patchConfigMock: vi.fn(async () => undefined),
    openProviderSettingsMock: vi.fn(),
  }),
);

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
    disabled?: boolean;
    testID?: string;
  }) =>
    React.createElement(
      "div",
      {
        role: accessibilityRole,
        "aria-label": accessibilityLabel,
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
    // 继承提示经 @/api-endpoints 入口引入，入口带着模式区与 Alert 的图标。
    AlertTriangle: icon("AlertTriangle"),
    CheckCircle2: icon("CheckCircle2"),
    ChevronRight: icon("ChevronRight"),
    Copy: icon("Copy"),
    ExternalLink: icon("ExternalLink"),
    Info: icon("Info"),
    MoreHorizontal: icon("MoreHorizontal"),
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
          "settings.providers.models.one": "1 model",
          "settings.providers.models.many": "{{count}} models",
          "settings.providers.addErrorTitle": "Unable to add provider",
          "settings.providers.updateErrorTitle": "Unable to update provider",
          "settings.providers.actions.menu": "{{name}} actions",
          "settings.providers.actions.remove": "Remove provider",
          "settings.providers.actions.removing": "Removing...",
          "settings.providers.remove.confirmTitle": "Remove {{name}}?",
          "settings.providers.remove.confirmMessage":
            "This deletes the provider entry from config.json. It cannot be undone.",
          "settings.providers.remove.confirm": "Remove",
          "settings.providers.remove.errorTitle": "Unable to remove provider",
          "settings.providers.install.howTo": "How to install",
          "settings.providers.install.howToFor": "How to install {{name}}",
          "settings.providers.apiEndpoints.inheritedNote":
            "Also uses Claude Code's API endpoint {{name}}",
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

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DropdownMenuTrigger: ({
    children,
    onPressIn,
    accessibilityRole,
    accessibilityLabel,
    testID,
  }: {
    children?:
      | React.ReactNode
      | ((state: { pressed: boolean; hovered: boolean; open: boolean }) => React.ReactNode);
    onPressIn?: (event: { stopPropagation: () => void }) => void;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      {
        type: "button",
        role: accessibilityRole,
        "aria-label": accessibilityLabel,
        "data-testid": testID,
        onMouseDown: (event: React.MouseEvent) => onPressIn?.(event),
        onClick: (event: React.MouseEvent) => event.stopPropagation(),
      },
      typeof children === "function"
        ? children({ pressed: false, hovered: false, open: false })
        : children,
    ),
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DropdownMenuItem: ({
    children,
    onSelect,
    status,
    pendingLabel,
    testID,
  }: {
    children?: React.ReactNode;
    onSelect?: () => void;
    status?: "idle" | "pending" | "success";
    pendingLabel?: string;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      {
        type: "button",
        "data-testid": testID,
        disabled: status === "pending" || status === "success",
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation();
          onSelect?.();
        },
      },
      status === "pending" ? pendingLabel : children,
    ),
}));

vi.mock("@/components/provider-icons", () => ({
  getProviderIcon: (provider: string) => () =>
    React.createElement("span", { "data-icon": `provider-${provider}` }),
}));

vi.mock("@/stores/provider-settings-store", () => ({
  useProviderSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ open: openProviderSettingsMock }),
}));

vi.mock("@/components/provider-catalog-list", () => ({
  ProviderCatalogList: () => null,
}));

vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({
    entries: snapshotState.entries,
    isLoading: snapshotState.isLoading,
    isFetching: false,
    isRefreshing: snapshotState.isRefreshing,
    error: null,
    supportsSnapshot: true,
    refresh: vi.fn(async () => {}),
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

vi.mock("@/runtime/host-features", () => ({
  useHostFeature: () => false,
}));

vi.mock("@/utils/confirm-dialog", () => ({
  confirmDialog: vi.fn(async () => true),
}));

import { ProvidersSection } from "./providers-section";

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

const notInstalledOpenCodeEntry: ProviderSnapshotEntry = {
  provider: "opencode",
  status: "unavailable",
  enabled: true,
  label: "OpenCode",
  description: "OpenCode",
  defaultModeId: null,
  modes: [],
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
    openProviderSettingsMock.mockReset();
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

  function render(): void {
    act(() => {
      root?.render(<ProvidersSection serverId="server-1" />);
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

  it("composes the row as icon, label, model count, status, switch, then chevron", () => {
    snapshotState.entries = [claudeEntry];
    configState.config = makeConfig();

    render();

    const row = findRow("Claude provider details");
    const nodes = descendants(row);
    const icon = indexOfMatches(nodes, '[data-icon="provider-claude"]');
    const label = indexOfText(nodes, "Claude");
    const modelCount = indexOfText(nodes, "3 models");
    const status = indexOfText(nodes, "Available");
    const switchEl = indexOfMatches(nodes, '[role="switch"]');
    const chevron = indexOfMatches(nodes, '[data-icon="ChevronRight"]');

    expect(icon).toBeGreaterThanOrEqual(0);
    expect(label).toBeGreaterThan(icon);
    expect(modelCount).toBeGreaterThan(label);
    expect(status).toBeGreaterThan(modelCount);
    expect(switchEl).toBeGreaterThan(status);
    expect(chevron).toBeGreaterThan(switchEl);
  });

  it("opens the diagnostic sheet when the outer row is pressed for a disabled provider", () => {
    snapshotState.entries = [disabledCodexEntry];
    configState.config = makeConfig({ codex: { enabled: false } });

    render();

    expect(openProviderSettingsMock).not.toHaveBeenCalled();

    const row = findRow("Codex provider details");
    act(() => {
      row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(openProviderSettingsMock).toHaveBeenCalledTimes(1);
    expect(openProviderSettingsMock).toHaveBeenCalledWith({
      serverId: "server-1",
      provider: "codex",
    });
  });

  function findInstallEntry(providerLabel: string): HTMLElement | null {
    return (
      container?.querySelector<HTMLElement>(
        `[role="link"][aria-label="How to install ${providerLabel}"]`,
      ) ?? null
    );
  }

  it("offers a how-to-install entry on a not-installed provider that opens its details", () => {
    snapshotState.entries = [claudeEntry, notInstalledCodexEntry];
    configState.config = makeConfig();

    render();

    const codexRow = findRow("Codex provider details");
    const entry = findInstallEntry("Codex");
    expect(entry).not.toBeNull();
    expect(codexRow.contains(entry)).toBe(true);
    expect(entry?.textContent).toBe("How to install");
    expect(indexOfText(descendants(codexRow), "Not installed")).toBe(-1);

    act(() => {
      entry?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(openProviderSettingsMock).toHaveBeenCalledTimes(1);
    expect(openProviderSettingsMock).toHaveBeenCalledWith({
      serverId: "server-1",
      provider: "codex",
    });
  });

  it("keeps installed providers and providers without a guide unchanged", () => {
    snapshotState.entries = [claudeEntry, notInstalledOpenCodeEntry];
    configState.config = makeConfig();

    render();

    expect(findInstallEntry("Claude")).toBeNull();
    expect(findInstallEntry("OpenCode")).toBeNull();
    expect(
      indexOfText(descendants(findRow("OpenCode provider details")), "Not installed"),
    ).toBeGreaterThanOrEqual(0);
  });

  it("offers the entry on a custom provider that extends a guided provider", () => {
    snapshotState.entries = [notInstalledCustomClaudeEntry];
    configState.config = makeConfig({
      "work-claude": { extends: "claude", label: "Work Claude" },
    });

    render();

    expect(findInstallEntry("Work Claude")).not.toBeNull();
  });

  it("tells a custom provider that extends claude it uses Claude's API endpoint too", () => {
    const workClaude: ProviderSnapshotEntry = {
      ...notInstalledCustomClaudeEntry,
      status: "ready",
      models: claudeEntry.models,
    };
    const note = "Also uses Claude Code's API endpoint Relay";
    snapshotState.entries = [
      { ...claudeEntry, activeApiEndpoint: { id: "ep_1", name: "Relay" } },
      workClaude,
    ];
    configState.config = makeConfig({
      "work-claude": { extends: "claude", label: "Work Claude" },
    });

    render();

    expect(indexOfText(descendants(findRow("Work Claude provider details")), note)).toBeGreaterThan(
      -1,
    );
    // Claude 自己那一行已经在详情里显示当前接口，不重复提示。
    expect(indexOfText(descendants(findRow("Claude provider details")), note)).toBe(-1);

    snapshotState.entries = [claudeEntry, workClaude];
    render();

    expect(indexOfText(descendants(findRow("Work Claude provider details")), note)).toBe(-1);
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
});
