import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { usePanelStore } from "@/stores/panel-store";
import {
  collectAllTabs,
  findPaneById,
  selectExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import {
  isExplorerSidebarOpen,
  openExplorerSidebarView,
  resolveExplorerSidebarPresentation,
  toggleExplorerSidebar,
} from "@/workspace-tabs/explorer-sidebar";

const WORKSPACE_KEY = "server-1:ws-main";

beforeEach(() => {
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    sidePaneIdByWorkspace: {},
    splitSizesByWorkspace: {},
  });
  usePanelStore.setState({
    mobilePanel: { target: "agent", revision: 0 },
  });
});

describe("Explorer sidebar", () => {
  it("selects the Explorer shell from the form factor", () => {
    expect(resolveExplorerSidebarPresentation({ isCompact: true })).toBe("overlay");
    expect(resolveExplorerSidebarPresentation({ isCompact: false })).toBe("dock");
  });

  it("uses the same Explorer pane inside the compact overlay", () => {
    openExplorerSidebarView({
      isCompact: true,
      workspaceKey: WORKSPACE_KEY,
      view: "changes",
    });

    expect(usePanelStore.getState().mobilePanel.target).toBe("file-explorer");
    const state = useWorkspaceLayoutStore.getState();
    const layout = state.layoutByWorkspace[WORKSPACE_KEY];
    const pane = findPaneById(layout.root, selectExplorerSidebarPaneId(state, WORKSPACE_KEY)!);
    expect(
      collectAllTabs(layout.root).find((tab) => tab.tabId === pane?.focusedTabId)?.target.kind,
    ).toBe("changes_tree");
  });

  it("creates a dedicated desktop Explorer containing only its requested tree", () => {
    openExplorerSidebarView({
      isCompact: false,
      workspaceKey: WORKSPACE_KEY,
      view: "files",
    });

    const state = useWorkspaceLayoutStore.getState();
    const layout = state.layoutByWorkspace[WORKSPACE_KEY];
    const paneId = selectExplorerSidebarPaneId(state, WORKSPACE_KEY);
    expect(paneId).not.toBeNull();
    expect(layout && collectAllTabs(layout.root).map((tab) => tab.target.kind)).toContain("files");
  });

  it("toggles the desktop Explorer independently of ordinary panes", () => {
    const input = {
      isCompact: false,
      workspaceKey: WORKSPACE_KEY,
    };
    openExplorerSidebarView({ ...input, view: "files" });
    toggleExplorerSidebar(input);
    expect(isExplorerSidebarOpen(input)).toBe(false);
    toggleExplorerSidebar(input);
    expect(isExplorerSidebarOpen(input)).toBe(true);
    const openedState = useWorkspaceLayoutStore.getState();
    const openedLayout = openedState.layoutByWorkspace[WORKSPACE_KEY];
    const explorerPaneId = selectExplorerSidebarPaneId(openedState, WORKSPACE_KEY);
    const explorerPane =
      openedLayout && explorerPaneId ? findPaneById(openedLayout.root, explorerPaneId) : null;
    const activeExplorerTarget =
      openedLayout && explorerPane
        ? collectAllTabs(openedLayout.root).find((tab) => tab.tabId === explorerPane.focusedTabId)
            ?.target.kind
        : null;
    expect(activeExplorerTarget).toBe("files");
  });

  it("opens Session history as an Explorer-only tab on desktop", () => {
    openExplorerSidebarView({
      isCompact: false,
      workspaceKey: WORKSPACE_KEY,
      view: "sessions",
    });

    const state = useWorkspaceLayoutStore.getState();
    const layout = state.layoutByWorkspace[WORKSPACE_KEY];
    const explorerPaneId = selectExplorerSidebarPaneId(state, WORKSPACE_KEY);
    const explorerPane =
      layout && explorerPaneId ? findPaneById(layout.root, explorerPaneId) : null;
    const focusedExplorerTarget =
      layout && explorerPane
        ? collectAllTabs(layout.root).find((tab) => tab.tabId === explorerPane.focusedTabId)?.target
            .kind
        : null;
    expect(focusedExplorerTarget).toBe("session_history");
  });

  it("selects Session history in the compact Explorer", () => {
    openExplorerSidebarView({
      isCompact: true,
      workspaceKey: WORKSPACE_KEY,
      view: "sessions",
    });

    // 上游 #7424 起紧凑布局用同一个 Explorer 窗格，选中的视图记在布局里，不再记在 panel store。
    expect(usePanelStore.getState().mobilePanel.target).toBe("file-explorer");
    const state = useWorkspaceLayoutStore.getState();
    const layout = state.layoutByWorkspace[WORKSPACE_KEY];
    const pane = findPaneById(layout.root, selectExplorerSidebarPaneId(state, WORKSPACE_KEY)!);
    expect(
      collectAllTabs(layout.root).find((tab) => tab.tabId === pane?.focusedTabId)?.target.kind,
    ).toBe("session_history");
  });

  it("seeds Session history among the default Explorer tabs on desktop and compact", () => {
    for (const isCompact of [false, true]) {
      const workspaceKey = `${WORKSPACE_KEY}-${isCompact ? "compact" : "desktop"}`;
      openExplorerSidebarView({ isCompact, workspaceKey, view: "changes" });

      const state = useWorkspaceLayoutStore.getState();
      const layout = state.layoutByWorkspace[workspaceKey];
      const pane = findPaneById(layout.root, selectExplorerSidebarPaneId(state, workspaceKey)!);
      expect(
        collectAllTabs(layout.root)
          .filter((tab) => pane?.tabIds.includes(tab.tabId))
          .map((tab) => tab.target.kind),
      ).toEqual(["files", "changes_tree", "session_history"]);
    }
  });

  it("toggles the compact Explorer without changing its selected view", () => {
    const input = {
      isCompact: true,
      workspaceKey: WORKSPACE_KEY,
    };

    toggleExplorerSidebar(input);

    expect(isExplorerSidebarOpen(input)).toBe(true);
  });
});
