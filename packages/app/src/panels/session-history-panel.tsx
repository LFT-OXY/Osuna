import { useCallback } from "react";
import { Text, View } from "react-native";
import { History } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { openTerminalTabFromSessionHistory } from "@/session-history";
import { SessionHistoryView } from "@/session-history/view";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

const ThemedHistory = withUnistyles(History);
const sessionHistoryPanelPresentation = {
  label: (t) => t("panels.sessionHistory.label"),
  subtitle: (t) => t("panels.sessionHistory.subtitle"),
  tooltip: (t) => t("panels.sessionHistory.tooltip"),
  icon: ThemedHistory,
} satisfies PanelPresentation;

function SessionHistoryPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(
    target.kind === "session_history",
    "SessionHistoryPanel requires session_history target",
  );
  const workspaceDirectory = useWorkspaceDirectory(serverId, workspaceId);
  const handleOpenTerminal = useCallback(
    (terminalId: string) => {
      const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
      if (!workspaceKey) return;
      openTerminalTabFromSessionHistory({ workspaceKey, terminalId });
    },
    [serverId, workspaceId],
  );

  if (!workspaceDirectory) {
    return (
      <View style={styles.centerState}>
        <Text>{t("panels.file.directoryMissing")}</Text>
      </View>
    );
  }

  return (
    <SessionHistoryView
      serverId={serverId}
      workspaceId={workspaceId}
      workspaceDirectory={workspaceDirectory}
      onOpenTerminal={handleOpenTerminal}
    />
  );
}

export const sessionHistoryPanelRegistration = definePanel("session_history", {
  component: SessionHistoryPanel,
  presentation: sessionHistoryPanelPresentation,
});

const styles = StyleSheet.create((theme) => ({
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
}));
