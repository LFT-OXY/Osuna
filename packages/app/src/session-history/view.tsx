import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useToast } from "@/contexts/toast-context";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { useNavigateToImportedAgent } from "@/hooks/use-import-session";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useProjectWorkspaceDirectories, useWorkspaceFields } from "@/stores/session-store-hooks";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { SessionHistorySurface, type SessionHistoryImportResult } from "./index";
import { useSessionHistoryScopeStore } from "./internal/scope-store";

/*
 * Kept out of `index.tsx` on purpose: the clipboard and the import navigation
 * pull in modules the unit runner cannot parse, and the surface's jsdom test
 * imports the entry. Shells import the view from here.
 */

export interface SessionHistoryViewProps {
  serverId: string;
  workspaceId: string;
  workspaceDirectory: string;
  onOpenTerminal: (terminalId: string) => void;
}

/** The surface wired to the host runtime and stores; the shells only decide where a terminal tab goes. */
export function SessionHistoryView({
  serverId,
  workspaceId,
  workspaceDirectory,
  onOpenTerminal,
}: SessionHistoryViewProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isSupported = useHostFeature(serverId, "sessionHistory");
  const isAppVisible = useAppActivelyVisible();
  const isPanelActive = useRetainedPanelActive();
  const scope = useSessionHistoryScopeStore((state) => state.scope);
  const setScope = useSessionHistoryScopeStore((state) => state.setScope);
  const navigateToImportedAgent = useNavigateToImportedAgent(serverId);
  const project = useWorkspaceFields(serverId, workspaceId, (workspace) => ({
    projectId: workspace.projectId,
    projectRootPath: workspace.projectRootPath,
  }));
  const projectWorkspaceDirectories = useProjectWorkspaceDirectories(
    serverId,
    project?.projectId ?? null,
  );
  // 与左栏 History 同一条打开逻辑：导航到该 agent 并固定 tab，归档与否都由它处理。
  const handleOpenAgent = useCallback(
    (agentId: string, agentWorkspaceId: string | null) => {
      navigateToAgent({ serverId, agentId, workspaceId: agentWorkspaceId, pin: true });
    },
    [serverId],
  );
  const handleCopyResumeCommand = useCallback(
    async (command: string) => {
      try {
        await copyToClipboard(command);
        toast.copied(t("workspace.tabs.toasts.resumeCommandCopiedLabel"));
      } catch {
        toast.error(t("workspace.tabs.toasts.copyFailed"));
      }
    },
    [t, toast],
  );
  // 与 Import session 面板相同的导入后去向：本 workspace 的 agent 直接开 tab，别的 workspace 先打开其项目。
  const handleImported = useCallback(
    (result: SessionHistoryImportResult) => {
      if (result.crossWorkspace) {
        void navigateToImportedAgent({ id: result.agentId, cwd: result.cwd });
        return;
      }
      navigateToAgent({
        serverId,
        agentId: result.agentId,
        workspaceId: result.workspaceId,
        pin: true,
      });
    },
    [navigateToImportedAgent, serverId],
  );
  return (
    <SessionHistorySurface
      serverId={serverId}
      workspaceId={workspaceId}
      workspaceDirectory={workspaceDirectory}
      projectRootPath={project?.projectRootPath ?? null}
      projectWorkspaceDirectories={projectWorkspaceDirectories}
      scope={scope}
      onScopeChange={setScope}
      client={client}
      isConnected={isConnected}
      isSupported={isSupported}
      isVisible={isAppVisible && isPanelActive}
      onOpenTerminal={onOpenTerminal}
      onOpenAgent={handleOpenAgent}
      onCopyResumeCommand={handleCopyResumeCommand}
      onImported={handleImported}
    />
  );
}
