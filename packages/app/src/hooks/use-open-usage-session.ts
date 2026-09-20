import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { resumeProviderSessionTerminal } from "@/session-history";
import { buildTerminalsQueryKey } from "@/screens/workspace/terminals/state";
import { useSessionStore } from "@/stores/session-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { resolveUsageSessionAction, type UsageSessionWorkspace } from "@/usage/open-session";
import type { MergedUsageSession } from "@/usage/sessions";

export interface UseOpenUsageSessionResult {
  open: (session: MergedUsageSession) => void;
  /** The row whose Open button is working, so only that row shows it. */
  pendingKey: string | null;
  error: unknown;
}

/**
 * The usage page's Open button. It is the Session history behaviour reached
 * from a host-wide page: an imported session opens its agent, anything else
 * resumes in a terminal inside the workspace the session ran in.
 */
export function useOpenUsageSession(): UseOpenUsageSessionResult {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (session: MergedUsageSession) => {
      const action = resolveUsageSessionAction({
        session,
        workspaces: hostWorkspaces(session.serverId),
      });
      if (action.kind === "agent") {
        navigateToAgent({
          serverId: session.serverId,
          agentId: action.agentId,
          workspaceId: action.workspaceId,
          pin: true,
        });
        return null;
      }
      if (action.kind === "unavailable") {
        throw new Error(
          action.reason === "noWorkspace"
            ? t("usage.sessionRow.errors.noWorkspace")
            : t("usage.sessionRow.errors.noHandle"),
        );
      }

      const client = getHostRuntimeStore().getClient(session.serverId);
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const resumed = await resumeProviderSessionTerminal({
        client,
        ref: {
          serverId: session.serverId,
          workspaceId: action.workspaceId,
          sessionKey: action.sessionKey,
        },
        launch: action.launch,
        workspaceDirectory: action.workspaceDirectory,
        openFailedMessage: t("usage.sessionRow.errors.openFailed"),
      });
      return { ...resumed, workspace: action };
    },
    onSuccess: (result, session) => {
      if (!result) return;
      if (result.created) {
        void queryClient.invalidateQueries({
          queryKey: buildTerminalsQueryKey(
            session.serverId,
            result.workspace.workspaceDirectory,
            result.workspace.workspaceId,
          ),
        });
      }
      navigateToWorkspace({
        serverId: session.serverId,
        workspaceId: result.workspace.workspaceId,
        target: { kind: "terminal", terminalId: result.terminalId },
        pin: true,
      });
    },
  });

  const { mutate } = mutation;
  const open = useCallback((session: MergedUsageSession) => mutate(session), [mutate]);

  return {
    open,
    pendingKey: mutation.isPending && mutation.variables ? mutation.variables.key : null,
    error: mutation.error,
  };
}

/** The workspaces this host has open, which is where a resumed terminal can live. */
function hostWorkspaces(serverId: string): UsageSessionWorkspace[] {
  const workspaces = useSessionStore.getState().sessions[serverId]?.workspaces;
  if (!workspaces) return [];
  return Array.from(workspaces.values(), (workspace) => ({
    id: workspace.id,
    workspaceDirectory: workspace.workspaceDirectory,
  }));
}
