import { getLogicMapNameFromLabels } from "@getpaseo/protocol/agent-labels";
import { useHostFeatureAvailability } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import {
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTab } from "@/workspace-tabs/model";
import { resolveWorkspaceFilePaths, type WorkspaceFileLocation } from "@/workspace/file-open";
import { buildDraftLogicMapKey, useDraftLogicMapStore } from "./draft-logic-map-store";
import { LogicMapPanelSurface } from "./panel-surface";

/*
 * 面板接上主机连接和各个 store；画面本身在 panel-surface.tsx，浏览器测试直接渲染它。
 */

/** 主区域当前聚焦的标签；Explorer 里的标签不改变聚焦，所以这里看到的总是主区域的对话。 */
function focusedTab(layout: WorkspaceLayout | undefined): WorkspaceTab | null {
  if (!layout) return null;
  const pane = findPaneById(layout.root, layout.focusedPaneId);
  if (!pane?.focusedTabId) return null;
  return collectAllTabs(layout.root).find((tab) => tab.tabId === pane.focusedTabId) ?? null;
}

/** 当前对话（聚焦的 Agent，或开着开关的草稿）维护的图。 */
function useConversationLogicMapName(serverId: string, workspaceId: string): string | null {
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const agentId = useWorkspaceLayoutStore((state) => {
    const tab = workspaceKey ? focusedTab(state.layoutByWorkspace[workspaceKey]) : null;
    return tab?.target.kind === "agent" ? tab.target.agentId : null;
  });
  const draftTabId = useWorkspaceLayoutStore((state) => {
    const tab = workspaceKey ? focusedTab(state.layoutByWorkspace[workspaceKey]) : null;
    return tab?.target.kind === "draft" ? tab.tabId : null;
  });
  const agentMapName = useSessionStore((state) =>
    agentId
      ? getLogicMapNameFromLabels(state.sessions[serverId]?.agents?.get(agentId)?.labels)
      : null,
  );
  const draftMapName = useDraftLogicMapStore((state) => {
    const draft = draftTabId
      ? state.draftsByKey[buildDraftLogicMapKey({ serverId, draftTabId })]
      : undefined;
    return draft?.enabled ? draft.mapName : null;
  });
  return agentMapName ?? draftMapName;
}

/**
 * 主区域聚焦的文件标签相对 workspace 的路径：节点文档按相对路径存，从对话里点开的文件标签可能是绝对路径。
 */
function useFocusedFilePath(
  serverId: string,
  workspaceId: string,
  workspaceRoot: string | null,
): string | null {
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const path = useWorkspaceLayoutStore((state) => {
    const tab = workspaceKey ? focusedTab(state.layoutByWorkspace[workspaceKey]) : null;
    return tab?.target.kind === "file" ? tab.target.path : null;
  });
  if (path === null) return null;
  if (!workspaceRoot) return path;
  return resolveWorkspaceFilePaths({ path, workspaceRoot })?.relativePath ?? null;
}

export function LogicMapPanelView({
  serverId,
  workspaceId,
  onOpenNodeDoc,
}: {
  serverId: string;
  workspaceId: string;
  /** 在主区域打开节点文档（走"打开文件"入口）。 */
  onOpenNodeDoc: (location: WorkspaceFileLocation) => void;
}) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  // COMPAT(logicMap): added in v0.17.0, remove gate after 2027-04-19.
  const supported = useHostFeatureAvailability(serverId, "logicMap");
  const conversationMapName = useConversationLogicMapName(serverId, workspaceId);
  const workspaceRoot = useWorkspaceDirectory(serverId, workspaceId);
  const focusedFilePath = useFocusedFilePath(serverId, workspaceId, workspaceRoot);
  return (
    <LogicMapPanelSurface
      serverId={serverId}
      workspaceId={workspaceId}
      workspaceRoot={workspaceRoot}
      client={client}
      isConnected={isConnected}
      supported={supported}
      conversationMapName={conversationMapName}
      focusedFilePath={focusedFilePath}
      onOpenNodeDoc={onOpenNodeDoc}
    />
  );
}
