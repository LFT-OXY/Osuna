import { useCallback } from "react";
import { supportsDesktopPaneSplits, useIsCompactFormFactor } from "@/constants/layout";
import { useSettings } from "@/hooks/use-settings";
import { usePaneContext } from "@/panels/pane-context";
import { useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { openPreferredWorkspaceTarget } from "@/workspace-tabs/open-beside";

export interface OpenSubagentHandlers {
  openSubagent: (subagentId: string) => void;
  openProviderSubagent: (parentAgentId: string, subagentId: string) => void;
}

/**
 * 打开子智能体：Subagents track 与时间线派发组共用。桌面按"在侧栏打开"偏好，
 * 手机整页导航；别的工作区里的子智能体导航过去。
 */
export function useOpenSubagent({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): OpenSubagentHandlers {
  const { tabId, openTab } = usePaneContext();
  const isCompact = useIsCompactFormFactor();
  const canSplit = supportsDesktopPaneSplits() && !isCompact;
  const openInSidePane = useSettings((settings) => settings.openInSidePane);
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const openSubagent = useCallback(
    (subagentId: string) => {
      const session = useSessionStore.getState().sessions[serverId];
      const agent = session?.agents.get(subagentId) ?? session?.agentDetails.get(subagentId);
      if (agent?.workspaceId && agent.workspaceId !== workspaceId) {
        navigateToAgent({ serverId, agentId: subagentId });
        return;
      }
      if (canSplit && workspaceKey) {
        openPreferredWorkspaceTarget({
          isCompact,
          workspaceKey,
          target: { kind: "agent", agentId: subagentId },
          source: "subagents",
          preferences: openInSidePane,
          parentTabId: tabId,
        });
        return;
      }
      navigateToAgent({ serverId, agentId: subagentId });
    },
    [canSplit, isCompact, openInSidePane, serverId, tabId, workspaceId, workspaceKey],
  );
  const openProviderSubagent = useCallback(
    (parentAgentId: string, subagentId: string) => {
      if (canSplit && workspaceKey) {
        openPreferredWorkspaceTarget({
          isCompact,
          workspaceKey,
          target: { kind: "provider_subagent", parentAgentId, subagentId },
          source: "subagents",
          preferences: openInSidePane,
          parentTabId: tabId,
        });
        return;
      }
      openTab({ kind: "provider_subagent", parentAgentId, subagentId });
    },
    [canSplit, isCompact, openInSidePane, openTab, tabId, workspaceKey],
  );
  return { openSubagent, openProviderSubagent };
}
