import React, { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import {
  SessionHistorySurface,
  type SessionHistoryImportResult,
  type SessionHistoryRow,
} from "./index";
import {
  MoveCodexConversationSheet,
  type MoveCodexConversationsOutcome,
  type MoveCodexConversationsTarget,
} from "./internal/move-codex-conversation-sheet";
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
  // COMPAT(apiEndpointCliWiring): added in v0.17.0, remove gate after 2027-04-18.
  const canMoveCodexConversations = useHostFeature(serverId, "apiEndpointCliWiring");
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
  const queryClient = useQueryClient();
  const [movingRows, setMovingRows] = useState<readonly SessionHistoryRow[] | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<ReadonlySet<string> | null>(null);
  const handleCloseMove = useCallback(() => setMovingRows(null), []);
  const handleMovedCodexConversations = useCallback(
    (outcome: MoveCodexConversationsOutcome) => {
      if (outcome.movedCount > 0) {
        // 这些行换了 Codex 服务商：这台主机的会话历史列表全部重列，行上才显示新的服务商。
        void queryClient.invalidateQueries({ queryKey: ["session-history", serverId] });
        setSelectedRowKeys(null);
      }
      if (!outcome.isComplete) return;
      // 没挪成的留在框里逐条说明；全部挪好才关掉并提示。
      setMovingRows(null);
      const message =
        outcome.movedCount > 1
          ? t("panels.sessionHistory.move.movedMany", {
              count: outcome.movedCount,
              to: outcome.to,
            })
          : t("panels.sessionHistory.move.moved", { to: outcome.to });
      toast.show(message, { variant: "success" });
    },
    [queryClient, serverId, t, toast],
  );
  const movingConversations = useMemo<MoveCodexConversationsTarget | null>(() => {
    const threads = (movingRows ?? []).flatMap((row) =>
      row.codexModelProvider
        ? [{ threadId: row.providerHandleId, title: row.title, from: row.codexModelProvider }]
        : [],
    );
    const providerId = movingRows?.[0]?.providerId;
    return providerId && threads.length > 0 ? { serverId, providerId, threads } : null;
  }, [movingRows, serverId]);
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
    <>
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
        onMoveCodexConversations={canMoveCodexConversations ? setMovingRows : null}
        selectedRowKeys={selectedRowKeys}
        onSelectedRowKeysChange={setSelectedRowKeys}
      />
      {movingConversations && client ? (
        <MoveCodexConversationSheet
          key={movingConversations.threads.map((thread) => thread.threadId).join(" ")}
          client={client}
          conversations={movingConversations}
          onClose={handleCloseMove}
          onMoved={handleMovedCodexConversations}
        />
      ) : null}
    </>
  );
}
