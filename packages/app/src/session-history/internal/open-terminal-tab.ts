import { FOCUSED_PANE_PLACEMENT, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

/**
 * Shows a terminal the daemon just created as a tab in the workspace's focused
 * pane. The Explorer pane never holds focus, so this lands in the main area
 * whichever shell the Session history view is rendered in.
 */
export function openTerminalTabFromSessionHistory(input: {
  workspaceKey: string;
  terminalId: string;
}): string | null {
  const store = useWorkspaceLayoutStore.getState();
  const tabId = store.openTab({
    workspaceKey: input.workspaceKey,
    target: { kind: "terminal", terminalId: input.terminalId },
    intent: "reveal",
    placement: FOCUSED_PANE_PLACEMENT,
  });
  if (tabId) {
    store.focusTab(input.workspaceKey, tabId);
  }
  return tabId;
}
