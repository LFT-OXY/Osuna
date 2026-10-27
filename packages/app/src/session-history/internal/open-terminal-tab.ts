import { FOCUSED_PANE_PLACEMENT, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { revealWorkspaceTab } from "@/workspace-tabs/navigation";

/**
 * Shows a terminal the daemon just created as a tab in the workspace's focused
 * pane. The Explorer pane never holds focus, so this lands in the main area
 * whichever shell the Session history view is rendered in; on compact layouts
 * the Explorer overlay gives way to the Agent panel so the terminal is visible.
 */
export function openTerminalTabFromSessionHistory(input: {
  workspaceKey: string;
  terminalId: string;
}): string | null {
  const tabId = useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: input.workspaceKey,
    target: { kind: "terminal", terminalId: input.terminalId },
    intent: "reveal",
    placement: FOCUSED_PANE_PLACEMENT,
  });
  return revealWorkspaceTab(input.workspaceKey, tabId);
}
