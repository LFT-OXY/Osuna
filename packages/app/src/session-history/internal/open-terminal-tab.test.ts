import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import {
  collectAllTabs,
  findPaneById,
  selectExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { openExplorerSidebarView } from "@/workspace-tabs/explorer-sidebar";
import { openTerminalTabFromSessionHistory } from "./open-terminal-tab";

const WORKSPACE_KEY = "server-1:ws-main";

beforeEach(() => {
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    sidePaneIdByWorkspace: {},
    splitSizesByWorkspace: {},
  });
});

describe("openTerminalTabFromSessionHistory", () => {
  it("opens the terminal in the main pane and focuses it, not in the Explorer sidebar", () => {
    openExplorerSidebarView({
      isCompact: false,
      supportsPaneSplits: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: { serverId: "server-1", cwd: "/repo", isGit: true },
      view: "sessions",
    });

    const tabId = openTerminalTabFromSessionHistory({
      workspaceKey: WORKSPACE_KEY,
      terminalId: "term-1",
    });

    const state = useWorkspaceLayoutStore.getState();
    const layout = state.layoutByWorkspace[WORKSPACE_KEY];
    const explorerPaneId = selectExplorerSidebarPaneId(state, WORKSPACE_KEY);
    expect(tabId).not.toBeNull();
    expect(layout && collectAllTabs(layout.root).map((tab) => tab.target)).toContainEqual({
      kind: "terminal",
      terminalId: "term-1",
    });
    const explorerPane =
      layout && explorerPaneId ? findPaneById(layout.root, explorerPaneId) : null;
    expect(explorerPane?.tabIds).not.toContain(tabId);
    const focusedPane = layout ? findPaneById(layout.root, layout.focusedPaneId) : null;
    expect(focusedPane?.focusedTabId).toBe(tabId);
  });
});
