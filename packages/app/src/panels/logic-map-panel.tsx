import { useCallback } from "react";
import { Workflow } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { LogicMapPanelView } from "@/logic-map/panel-view";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { createWorkspaceFileTabTarget, type WorkspaceFileLocation } from "@/workspace/file-open";

const ThemedWorkflow = withUnistyles(Workflow);
const logicMapPanelPresentation = {
  label: (t) => t("logicMap.panel.label"),
  subtitle: (t) => t("logicMap.panel.subtitle"),
  tooltip: (t) => t("logicMap.panel.tooltip"),
  icon: ThemedWorkflow,
} satisfies PanelPresentation;

function LogicMapPanel() {
  const { serverId, workspaceId, target, openPreferredTarget } = usePaneContext();
  invariant(target.kind === "logic_map", "LogicMapPanel requires logic_map target");
  // 逻辑图和 Files 一样在右边栏，点节点打开文件按"点击资源管理器侧栏中的文件"的打开位置设置走。
  const handleOpenNodeDoc = useCallback(
    (location: WorkspaceFileLocation) =>
      openPreferredTarget(createWorkspaceFileTabTarget(location), "explorerFiles"),
    [openPreferredTarget],
  );
  return (
    <LogicMapPanelView
      serverId={serverId}
      workspaceId={workspaceId}
      onOpenNodeDoc={handleOpenNodeDoc}
    />
  );
}

export const logicMapPanelRegistration = definePanel("logic_map", {
  component: LogicMapPanel,
  presentation: logicMapPanelPresentation,
});
