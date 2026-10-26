import { useCallback } from "react";
import { useSettings } from "@/hooks/use-settings";
import { usePaneContext } from "@/panels/pane-context";
import { useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTabTarget } from "@/workspace-tabs/model";
import { openPreferredWorkspaceTarget } from "@/workspace-tabs/open-beside";

export interface OpenSubagentHandlers {
  openSubagent: (subagentId: string) => void;
  openProviderSubagent: (parentAgentId: string, subagentId: string) => void;
}

/**
 * 打开子智能体：Subagents track 与时间线派发组共用。按"在侧栏打开"偏好放进本工作区的标签
 * （手机上由布局决定开成 sheet）；别的工作区里的子智能体导航过去。
 */
export function useOpenSubagent({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): OpenSubagentHandlers {
  const { tabId } = usePaneContext();
  const openInSidePane = useSettings((settings) => settings.openInSidePane);
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const openSubagentTarget = useCallback(
    (target: WorkspaceTabTarget) => {
      openPreferredWorkspaceTarget({
        workspaceKey,
        target,
        source: "subagents",
        preferences: openInSidePane,
        parentTabId: tabId,
      });
    },
    [openInSidePane, tabId, workspaceKey],
  );
  const openSubagent = useCallback(
    (subagentId: string) => {
      const session = useSessionStore.getState().sessions[serverId];
      const agent = session?.agents.get(subagentId) ?? session?.agentDetails.get(subagentId);
      // A subagent in another workspace lives in that workspace's tabs.
      if (agent?.workspaceId && agent.workspaceId !== workspaceId) {
        navigateToAgent({ serverId, agentId: subagentId });
        return;
      }
      openSubagentTarget({ kind: "agent", agentId: subagentId });
    },
    [openSubagentTarget, serverId, workspaceId],
  );
  const openProviderSubagent = useCallback(
    (parentAgentId: string, subagentId: string) => {
      openSubagentTarget({ kind: "provider_subagent", parentAgentId, subagentId });
    },
    [openSubagentTarget],
  );
  return { openSubagent, openProviderSubagent };
}
