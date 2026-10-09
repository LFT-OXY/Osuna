import { Text, View } from "react-native";
import { ArrowLeftToLine, RotateCw, Settings } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { AgentRouteResolution } from "@/navigation/agent-route-resolution";
import { formatConnectionStatus } from "@/utils/daemons";
import { MINIMUM_HOST_VERSION } from "@osuna/protocol/host-version";
import type { Theme } from "@/styles/theme";

type VisibleAgentRouteResolution = Extract<
  AgentRouteResolution,
  { kind: "waitingForHost" | "fetchingAgent" | "lookupError" }
>;

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

export function AgentRouteResolutionView({
  resolution,
  hostName,
  lastHostError,
  onRetry,
  onManageHost,
  onBack,
}: {
  resolution: VisibleAgentRouteResolution;
  hostName: string;
  lastHostError: string | null;
  onRetry: () => void;
  onManageHost: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();

  if (resolution.kind === "fetchingAgent") {
    return (
      <View style={styles.emptyState} testID="agent-route-fetching">
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
        <View style={styles.textStack}>
          <Text style={styles.title}>
            {t("agentPanel.unavailable.preparingSession", { serverLabel: hostName })}
          </Text>
          <Text style={styles.description}>{t("agentPanel.unavailable.showSoon")}</Text>
        </View>
      </View>
    );
  }

  if (resolution.kind === "lookupError") {
    return (
      <View style={styles.emptyState} testID="agent-route-lookup-error">
        <View style={styles.textStack}>
          <Text style={styles.title}>{t("agentPanel.states.failedToLoad")}</Text>
          <Text style={styles.error}>{resolution.error}</Text>
        </View>
        <View style={styles.actions}>
          <Button size="sm" variant="default" leftIcon={RotateCw} onPress={onRetry}>
            {t("common.actions.retry")}
          </Button>
          <Button size="sm" variant="outline" leftIcon={ArrowLeftToLine} onPress={onBack}>
            {t("common.actions.back")}
          </Button>
        </View>
      </View>
    );
  }

  const status = resolution.connectionStatus;
  const isConnecting = status === "connecting" || status === "idle";
  // 主机升级前重试只会得到同一个结果，过旧时只留"管理主机"。
  const isOutdated = status === "outdated";
  let title = t("workspace.route.cannotReachHost", { hostName });
  let description: string;
  if (status === "connecting" || status === "idle") {
    title = t("agentPanel.unavailable.connecting", { serverLabel: hostName });
    description = t("agentPanel.unavailable.showWhenOnline");
  } else if (status === "outdated") {
    title = t("workspace.route.hostOutdated", { hostName });
    description = t("workspace.route.hostOutdatedHint", { version: MINIMUM_HOST_VERSION });
  } else {
    const statusLabel = formatConnectionStatus(status);
    description = t("workspace.route.hostStatus", { status: statusLabel });
    if (status === "offline") title = t("workspace.route.hostOffline", { hostName });
  }

  return (
    <View style={styles.emptyState} testID="agent-route-waiting-for-host">
      {isConnecting ? (
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
      ) : null}
      <View style={styles.textStack}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        {lastHostError ? <Text style={styles.error}>{lastHostError}</Text> : null}
      </View>
      {!isConnecting ? (
        <View style={styles.actions}>
          {isOutdated ? null : (
            <Button size="sm" variant="default" leftIcon={RotateCw} onPress={onRetry}>
              {t("common.actions.retry")}
            </Button>
          )}
          <Button
            size="sm"
            variant={isOutdated ? "default" : "outline"}
            leftIcon={Settings}
            onPress={onManageHost}
          >
            {t("workspace.route.manageHost")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
  },
  textStack: {
    alignItems: "center",
    gap: theme.spacing[2],
    maxWidth: 520,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    textAlign: "center",
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    lineHeight: Math.round(theme.fontSize.base * 1.4),
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
