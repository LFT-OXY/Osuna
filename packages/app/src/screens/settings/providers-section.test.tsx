/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@osuna/protocol/agent-types";
import type { MutableDaemonConfig } from "@osuna/protocol/messages";

const {
  theme,
  snapshotState,
  configState,
  patchConfigMock,
  refreshMock,
  selectProviderMock,
  upgradeProviderMock,
} = vi.hoisted(() => ({
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
  upgradeProviderMock: vi.fn(),
}));

// 解析 Pressable 的样式里最终的背景色：目录"添加"按钮的变体、行的高亮都只体现在背景上。
function resolveBackground(style: unknown): string | undefined {
  const resolved = typeof style === "function" ? style({ pressed: false, hovered: false }) : style;
  const layers = Array.isArray(resolved) ? resolved.flat(Number.POSITIVE_INFINITY) : [resolved];
  let background: string | undefined;
  for (const layer of layers) {
    if (layer && typeof layer === "object" && "backgroundColor" in layer) {
      background = String(layer.backgroundColor);
    }
  }
  return background;
}

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
    style,
  }: {
    children?:
      | React.ReactNode
      | ((state: { pressed: boolean; hovered: boolean }) => React.ReactNode);
    style?: unknown;
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
        "data-background": resolveBackground(style),
        // 和 react-native-web 的 PressResponder 一样，点击不再冒泡到外层 Pressable。
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation();
          if (!disabled) onPress?.(event);
        },
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
    ArrowUp: icon("ArrowUp"),
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
          "settings.providers.version.value": "v{{version}}",
          "settings.providers.version.update": "v{{from}} → v{{to}}",
          "settings.providers.addProvider": "Add provider",
          "settings.providers.addErrorTitle": "Unable to add provider",
          "providerCatalog.title": "Add provider",
          "providerCatalog.search": "Search providers",
          "providerCatalog.noProviders": "No providers found",
          "providerCatalog.actions.add": "Add",
          "providerCatalog.actions.adding": "Adding",
          "providerCatalog.actions.installInstructions": "Install instructions",
          "providerCatalog.groups.acpCatalog": "ACP catalog",
          "settings.providers.groups.enabled": "Enabled",
          "settings.providers.groups.disabled": "Disabled",
          "settings.providers.statuses.disabledUntilEnabled":
            "Disabled · Enable to check if it's installed",
          "settings.providers.empty":
            "No providers enabled. Turn one on under Disabled, or press + to add one.",
          "common.actions.dismiss": "Dismiss",
          "settings.providers.upgrade.action": "Upgrade",
          "settings.providers.upgrade.actionLabel": "Upgrade {{name}}",
          "settings.providers.upgrade.actionTo": "Upgrade to v{{version}}",
          "settings.providers.upgrade.errors.failed": "Upgrade failed",
        })[key] ?? key
      )
        .replaceAll("{{name}}", String(values?.name ?? ""))
        .replaceAll("{{count}}", String(values?.count ?? ""))
        .replaceAll("{{version}}", String(values?.version ?? ""))
        .replaceAll("{{from}}", String(values?.from ?? ""))
        .replaceAll("{{to}}", String(values?.to ?? "")),
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
  // 列表只读 Providers 页的版本检查结果，不会用它发检查请求；升级经它发请求。
  useHostRuntimeClient: () => ({ upgradeProvider: upgradeProviderMock }),
}));

// 真实的 Tooltip 依赖 reanimated 与 createPortal，在整体 mock 掉 react-native 的套件里加载不了；
// 这里把提示文字直接渲染出来。
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  TooltipContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", { "data-testid": "tooltip-content" }, children),
}));

vi.mock("@/components/ui/scrollable-code-surface", () => ({
  ScrollableCodeSurface: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("pre", { "data-testid": testID }, children),
}));

import {
  buildAcpProviderConfigPatch,
  getAcpProviderCatalog,
} from "@/hooks/use-acp-provider-catalog";
import type { DaemonClient } from "@osuna/client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import { providerVersionCheckQueryKey } from "@/provider-detail/version-check";
import { useProviderUpgradeStore } from "@/provider-detail/upgrade";
import type { ProviderUpgradeResponsePayload as ProviderUpgradeResponse } from "@osuna/protocol/messages";
import { ProvidersSection } from "./providers-section";

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

// React Query 默认用 setTimeout(0) 通知观察者，act 不一定等得到；升级成功后改写检查结果要同步落到界面上。
notifyManager.setScheduler((callback) => callback());

describe("ProvidersSection", () => {
  let root: Root | null = null;
  let queryClient = new QueryClient();
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
    queryClient = new QueryClient();
    patchConfigMock.mockReset();
    patchConfigMock.mockResolvedValue(undefined);
    refreshMock.mockReset();
    refreshMock.mockResolvedValue(undefined);
    selectProviderMock.mockReset();
    upgradeProviderMock.mockReset();
    useProviderUpgradeStore.setState({ byKey: {} });
  });

  afterEach(() => {
    useSessionStore.getState().clearSession("server-1");
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function render(): void {
    act(() => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <ProvidersSection serverId="server-1" onSelectProvider={selectProviderMock} />
        </QueryClientProvider>,
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

  function groupRowIds(group: "enabled" | "disabled"): string[] {
    const section = container?.querySelector(`[data-testid="providers-${group}-group"]`);
    return Array.from(
      section?.querySelectorAll<HTMLElement>('[data-testid^="provider-row-"]') ?? [],
    ).map((row) => row.getAttribute("data-testid")?.slice("provider-row-".length) ?? "");
  }

  function findGroup(group: "enabled" | "disabled"): HTMLElement | null {
    return (
      container?.querySelector<HTMLElement>(`[data-testid="providers-${group}-group"]`) ?? null
    );
  }

  it("puts every enabled provider in Enabled and turned-off ones in Disabled, in snapshot order", () => {
    snapshotState.entries = [
      claudeEntry,
      disabledCodexEntry,
      notInstalledCustomClaudeEntry,
      { ...claudeEntry, provider: "opencode", label: "OpenCode", status: "loading" },
      { ...claudeEntry, provider: "pi", label: "Pi", status: "error", error: "boom" },
      {
        ...claudeEntry,
        provider: "copilot",
        label: "Copilot",
        enabled: false,
        status: "unavailable",
      },
    ];
    configState.config = makeConfig({ codex: { enabled: false }, copilot: { enabled: false } });

    render();

    expect(groupRowIds("enabled")).toEqual(["claude", "work-claude", "opencode", "pi"]);
    expect(groupRowIds("disabled")).toEqual(["codex", "copilot"]);
    expect(findGroup("enabled")?.textContent).toContain("Enabled4");
    expect(findGroup("disabled")?.textContent).toContain("Disabled2");
    expect(findRow("Work Claude provider details").textContent).toContain("Not installed");
  });

  it("shows the empty hint in Enabled, with + in its header, when every provider is turned off", () => {
    snapshotState.entries = [disabledCodexEntry];
    configState.config = makeConfig({ codex: { enabled: false } });

    render();

    expect(groupRowIds("enabled")).toEqual([]);
    expect(findGroup("enabled")?.textContent).toContain(
      "No providers enabled. Turn one on under Disabled, or press + to add one.",
    );
    expect(
      findGroup("enabled")?.querySelector('[role="button"][aria-label="Add provider"]'),
    ).not.toBeNull();
    expect(groupRowIds("disabled")).toEqual(["codex"]);
  });

  it("hides the Disabled group, title included, when every provider is enabled", () => {
    snapshotState.entries = [claudeEntry, notInstalledCodexEntry];
    configState.config = makeConfig();

    render();

    expect(findGroup("disabled")).toBeNull();
    expect(container?.textContent).not.toContain("Disabled");
  });

  it("marks a turned-off row as disabled without claiming it is not installed", () => {
    snapshotState.entries = [claudeEntry, disabledCodexEntry];
    configState.config = makeConfig({ codex: { enabled: false } });

    render();

    const row = findRow("Codex provider details");
    expect(
      indexOfText(descendants(row), "Disabled · Enable to check if it's installed"),
    ).toBeGreaterThan(-1);
    expect(row.textContent).not.toContain("Not installed");
    expect(row.querySelector('[data-testid="provider-status-dot-muted"]')).not.toBeNull();
    expect(row.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
    expect(row.querySelector('[data-icon="ChevronRight"]')).not.toBeNull();
  });

  it("composes the row as brand icon, label, status line, switch, then chevron", () => {
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
    expect(indexOfMatches(nodes, '[data-icon="ChevronRight"]')).toBeGreaterThan(switchEl);
    expect(indexOfText(nodes, "Available")).toBe(-1);
  });

  it.each([
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

  // 主机声明了 providerVersions 的 server_info。
  function connectHostWithProviderVersions(): void {
    const store = useSessionStore.getState();
    store.initializeSession("server-1", null as unknown as DaemonClient);
    store.updateSessionServerInfo("server-1", {
      serverId: "server-1",
      hostname: null,
      version: "0.13.1",
      features: { providerVersions: true },
    });
  }

  it("adds the installed version after the status line", () => {
    connectHostWithProviderVersions();
    snapshotState.entries = [{ ...claudeEntry, version: "2.1.280" }];
    configState.config = makeConfig();

    render();

    expect(
      indexOfText(descendants(findRow("Claude provider details")), "3 models · v2.1.280"),
    ).toBeGreaterThan(-1);
  });

  it("keeps only the installed version in the status line when a newer one is out", () => {
    connectHostWithProviderVersions();
    snapshotState.entries = [{ ...claudeEntry, version: "2.1.280" }];
    queryClient.setQueryData(providerVersionCheckQueryKey("server-1"), [
      {
        provider: "claude",
        installedVersion: "2.1.280",
        latestVersion: "2.1.285",
        updateAvailable: true,
      },
    ]);
    configState.config = makeConfig();

    render();

    const nodes = descendants(findRow("Claude provider details"));
    expect(indexOfText(nodes, "3 models · v2.1.280")).toBeGreaterThan(-1);
    expect(indexOfText(nodes, "3 models · v2.1.280 → v2.1.285")).toBe(-1);
  });

  it("keeps showing only the installed version when the check failed", () => {
    connectHostWithProviderVersions();
    snapshotState.entries = [{ ...claudeEntry, version: "2.1.280" }];
    queryClient.setQueryData(providerVersionCheckQueryKey("server-1"), [
      {
        provider: "claude",
        installedVersion: "2.1.280",
        updateAvailable: false,
        error: "registry unreachable",
      },
    ]);
    configState.config = makeConfig();

    render();

    const row = findRow("Claude provider details");
    expect(indexOfText(descendants(row), "3 models · v2.1.280")).toBeGreaterThan(-1);
    expect(row.textContent).not.toContain("registry unreachable");
  });

  function offerClaudeUpdate(): void {
    connectHostWithProviderVersions();
    snapshotState.entries = [{ ...claudeEntry, version: "2.1.280" }];
    queryClient.setQueryData(providerVersionCheckQueryKey("server-1"), [
      {
        provider: "claude",
        installedVersion: "2.1.280",
        latestVersion: "2.1.285",
        updateAvailable: true,
      },
    ]);
    configState.config = makeConfig();
  }

  function queryUpgradeButton(): HTMLElement | null {
    return findRow("Claude provider details").querySelector<HTMLElement>(
      '[role="button"][aria-label="Upgrade Claude"]',
    );
  }

  function holdUpgradeAnswer(): (answer: Omit<ProviderUpgradeResponse, "requestId">) => void {
    let answer: (value: ProviderUpgradeResponse) => void = () => {};
    upgradeProviderMock.mockImplementation(
      () =>
        new Promise<ProviderUpgradeResponse>((resolve) => {
          answer = resolve;
        }),
    );
    return (value) => answer({ requestId: "upgrade-1", ...value });
  }

  async function pressUpgrade(): Promise<void> {
    await act(async () => {
      queryUpgradeButton()?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
  }

  it("offers the upgrade in the status line, leaving only the switch and chevron trailing", () => {
    offerClaudeUpdate();

    render();

    const statusLine = findRow("Claude provider details").querySelector<HTMLElement>(
      '[data-testid="provider-status-line"]',
    );
    const upgrade = statusLine?.querySelector('[role="button"][aria-label="Upgrade Claude"]');
    expect(upgrade?.textContent).toBe("Upgrade to v2.1.285");
    expect(statusLine?.querySelector('[role="switch"]')).toBeNull();
    expect(
      findRow("Claude provider details").querySelectorAll(
        '[role="button"][aria-label="Upgrade Claude"]',
      ),
    ).toHaveLength(1);
    expect(
      findRow("Claude provider details").querySelector('[data-testid="tooltip-content"]')
        ?.textContent,
    ).toBe("v2.1.280 → v2.1.285");
  });

  it("offers no upgrade when the installed CLI is current", () => {
    connectHostWithProviderVersions();
    snapshotState.entries = [{ ...claudeEntry, version: "2.1.285" }];
    queryClient.setQueryData(providerVersionCheckQueryKey("server-1"), [
      {
        provider: "claude",
        installedVersion: "2.1.285",
        latestVersion: "2.1.285",
        updateAvailable: false,
      },
    ]);
    configState.config = makeConfig();

    render();

    expect(queryUpgradeButton()).toBeNull();
  });

  it("spins while upgrading and drops the button once the new version is in", async () => {
    offerClaudeUpdate();
    const answer = holdUpgradeAnswer();
    render();

    await pressUpgrade();

    expect(upgradeProviderMock).toHaveBeenCalledWith({ provider: "claude" });
    // 按钮在整行里面，点它只升级，不进详情。
    expect(selectProviderMock).not.toHaveBeenCalled();
    expect(queryUpgradeButton()?.getAttribute("aria-disabled")).toBe("true");
    expect(queryUpgradeButton()?.querySelector('[data-testid="loading-spinner"]')).not.toBeNull();

    await pressUpgrade();
    expect(upgradeProviderMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer({ provider: "claude", ok: true, version: "2.1.285" });
    });

    expect(queryUpgradeButton()).toBeNull();
    expect(container?.querySelector('[data-testid="provider-upgrade-failure"]')).toBeNull();
  });

  it("shows the command output under the row when the upgrade fails, until dismissed", async () => {
    offerClaudeUpdate();
    const answer = holdUpgradeAnswer();
    render();

    await pressUpgrade();
    await act(async () => {
      answer({
        provider: "claude",
        ok: false,
        errorCode: "command_failed",
        error: "claude update exited with code 1",
        output: "EACCES: permission denied\n",
      });
    });

    const failure = container?.querySelector<HTMLElement>(
      '[data-testid="provider-upgrade-failure"]',
    );
    // 「安装与升级」区块在详情页，行下面没有：原因和关闭按钮之间不带指向它的引导。
    expect(failure?.textContent).toBe("Upgrade failedDismissEACCES: permission denied\n");
    expect(failure?.querySelector('[data-testid="provider-upgrade-output"]')?.textContent).toBe(
      "EACCES: permission denied\n",
    );
    // 失败块挂在行外，点它不会进详情。
    expect(findRow("Claude provider details").contains(failure ?? null)).toBe(false);
    expect(queryUpgradeButton()?.getAttribute("aria-disabled")).toBeNull();

    const dismiss = Array.from(
      failure?.querySelectorAll<HTMLElement>('[role="button"]') ?? [],
    ).find((button) => button.textContent === "Dismiss");
    await act(async () => {
      dismiss?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(container?.querySelector('[data-testid="provider-upgrade-failure"]')).toBeNull();
  });

  it("shows no version when the host does not report provider versions", () => {
    snapshotState.entries = [{ ...claudeEntry, version: "2.1.280" }];
    configState.config = makeConfig();

    render();

    const row = findRow("Claude provider details");
    expect(indexOfText(descendants(row), "3 models")).toBeGreaterThan(-1);
    expect(row.textContent).not.toContain("v2.1.280");
  });

  it("only selects a turned-off provider when its row is pressed, writing no config", () => {
    snapshotState.entries = [claudeEntry, disabledCodexEntry];
    configState.config = makeConfig({ codex: { enabled: false } });

    render();

    act(() => {
      findRow("Codex provider details").dispatchEvent(
        new window.MouseEvent("click", { bubbles: true }),
      );
    });

    expect(selectProviderMock).toHaveBeenCalledWith("codex");
    expect(patchConfigMock).not.toHaveBeenCalled();
  });

  it("selects the provider when its row is pressed", () => {
    snapshotState.entries = [
      claudeEntry,
      { ...disabledCodexEntry, enabled: true, status: "ready" },
    ];
    configState.config = makeConfig();

    render();

    act(() => {
      findRow("Codex provider details").dispatchEvent(
        new window.MouseEvent("click", { bubbles: true }),
      );
    });

    expect(selectProviderMock).toHaveBeenCalledTimes(1);
    expect(selectProviderMock).toHaveBeenCalledWith("codex");
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

  async function pressSwitch(rowLabel: string): Promise<void> {
    const switchEl = findRow(rowLabel).querySelector<HTMLElement>('[role="switch"]');
    if (!switchEl) throw new Error(`Expected a switch on ${rowLabel}`);
    await act(async () => {
      switchEl.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
  }

  function rowBackground(rowLabel: string): string | null {
    return findRow(rowLabel).getAttribute("data-background");
  }

  it("turns a provider on from Disabled and moves it to Enabled once the snapshot says so", async () => {
    vi.useFakeTimers();
    snapshotState.entries = [claudeEntry, disabledCodexEntry];
    configState.config = makeConfig({ codex: { enabled: false } });

    render();
    await pressSwitch("Codex provider details");

    expect(patchConfigMock).toHaveBeenCalledWith({ providers: { codex: { enabled: true } } });
    expect(selectProviderMock).not.toHaveBeenCalled();
    // 不做乐观更新：快照没变之前这一行留在原组。
    expect(groupRowIds("disabled")).toEqual(["codex"]);

    // daemon 随后推来启用后的快照，开始探测。
    snapshotState.entries = [
      claudeEntry,
      { ...disabledCodexEntry, enabled: true, status: "loading" },
    ];
    render();

    expect(groupRowIds("enabled")).toEqual(["claude", "codex"]);
    expect(findGroup("disabled")).toBeNull();
    expect(rowBackground("Codex provider details")).toBe(theme.colors.surface2);
    expect(rowBackground("Claude provider details")).not.toBe(theme.colors.surface2);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(rowBackground("Codex provider details")).not.toBe(theme.colors.surface2);
  });

  it("keeps a row in Disabled and shows the error on the Enabled card when turning it on fails", async () => {
    snapshotState.entries = [claudeEntry, disabledCodexEntry];
    configState.config = makeConfig({ codex: { enabled: false } });
    patchConfigMock.mockRejectedValueOnce(new Error("config.json is read-only"));

    render();
    await pressSwitch("Codex provider details");

    expect(
      findGroup("enabled")?.querySelector('[data-testid="providers-toggle-error"]')?.textContent,
    ).toContain("config.json is read-only");
    expect(groupRowIds("disabled")).toEqual(["codex"]);
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

  it("holds only the ACP catalog, with outline Add buttons", () => {
    snapshotState.entries = [claudeEntry, disabledCodexEntry, notInstalledCustomClaudeEntry];
    configState.config = makeConfig({
      codex: { enabled: false },
      "work-claude": { extends: "claude", label: "Work Claude" },
    });

    render();
    const dialog = openCatalogDialog();

    expect(indexOfText(descendants(dialog), "ACP catalog")).toBeGreaterThanOrEqual(0);
    // 停用的 Codex 和没装的 Work Claude 都留在 Providers 页，弹窗里没有它们。
    expect(indexOfText(descendants(dialog), "Codex")).toBe(-1);
    expect(dialog.textContent).not.toContain("Work Claude");
    expect(dialog.textContent).not.toContain("Not enabled");
    expect(dialog.textContent).not.toContain("Not installed");
    expect(dialog.querySelector('[role="switch"]')).toBeNull();
    // outline 是透明底；实心 accent 留给页面上唯一的主按钮。
    expect(findCatalogAddButton(minimax.id)?.getAttribute("data-background")).toBe("transparent");
  });

  it("moves an ACP provider turned off in the list to Disabled without deleting its config", async () => {
    const acpProvider: ProviderSnapshotEntry = {
      ...claudeEntry,
      provider: minimax.id,
      label: minimax.title,
      source: "custom",
    };
    snapshotState.entries = [claudeEntry, acpProvider];
    configState.config = makeConfig();

    render();
    await pressSwitch(`${minimax.title} provider details`);

    expect(patchConfigMock).toHaveBeenCalledTimes(1);
    expect(patchConfigMock).toHaveBeenCalledWith({
      providers: { [minimax.id]: { enabled: false } },
    });

    // daemon 随后推来停用后的快照。
    snapshotState.entries = [
      claudeEntry,
      { ...acpProvider, enabled: false, status: "unavailable", models: [] },
    ];
    render();

    expect(groupRowIds("enabled")).toEqual(["claude"]);
    expect(groupRowIds("disabled")).toEqual([minimax.id]);
    openCatalogDialog();
    // 目录里不再重复出现同一个提供方。
    expect(findCatalogAddButton(minimax.id)).toBeNull();
  });
});
