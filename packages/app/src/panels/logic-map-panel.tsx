import { Workflow } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { LogicMapPanelView } from "@/logic-map/panel-view";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";

const ThemedWorkflow = withUnistyles(Workflow);
const logicMapPanelPresentation = {
  label: (t) => t("logicMap.panel.label"),
  subtitle: (t) => t("logicMap.panel.subtitle"),
  tooltip: (t) => t("logicMap.panel.tooltip"),
  icon: ThemedWorkflow,
} satisfies PanelPresentation;

function LogicMapPanel() {
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(target.kind === "logic_map", "LogicMapPanel requires logic_map target");
  return <LogicMapPanelView serverId={serverId} workspaceId={workspaceId} />;
}

export const logicMapPanelRegistration = definePanel("logic_map", {
  component: LogicMapPanel,
  presentation: logicMapPanelPresentation,
});
