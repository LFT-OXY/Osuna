import React, { useCallback, useMemo, type ComponentType } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { History } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { getProviderIcon, type ProviderIconProps } from "@/components/provider-icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  buildTerminalsQueryKey,
  upsertCreatedTerminalPayload,
  type ListTerminalsPayload,
} from "@/screens/workspace/terminals/state";
import { getCurrentTerminalViewAttributes } from "@/terminal/view-attributes";
import { formatTimeAgo } from "@/utils/time";
import {
  buildResumeTerminalLaunch,
  buildSessionHistoryQueryKey,
  buildSessionHistoryRows,
  SESSION_HISTORY_FETCH_LIMIT,
  type SessionHistoryRow,
} from "./internal/model";

export type { SessionHistoryRow, SessionHistoryScope } from "./internal/model";
export { buildSessionHistoryQueryKey } from "./internal/model";
export { openTerminalTabFromSessionHistory } from "./internal/open-terminal-tab";

export type SessionHistoryClient = Pick<
  DaemonClient,
  "fetchRecentProviderSessions" | "createTerminal"
>;

export interface SessionHistorySurfaceProps {
  serverId: string;
  workspaceId: string;
  /** The workspace's directory: the scope of the listing and the home of new terminals. */
  workspaceDirectory: string;
  client: SessionHistoryClient | null;
  isConnected: boolean;
  /** The terminal exists on the daemon; the caller decides which pane shows it. */
  onTerminalCreated: (terminalId: string) => void;
}

function ProviderIconSlot({
  Icon,
  size,
  color = "",
}: {
  Icon: ComponentType<ProviderIconProps>;
  size: number;
  color?: string;
}) {
  return <Icon size={size} color={color} />;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const ThemedProviderIcon = withUnistyles(ProviderIconSlot);
const ThemedHistory = withUnistyles(History);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ROW_ICON_SIZE = 16;
const EMPTY_ICON_SIZE = 24;

function SessionHistoryRowItem({
  serverId,
  row,
  disabled,
  opening,
  onPress,
}: {
  serverId: string;
  row: SessionHistoryRow;
  disabled: boolean;
  opening: boolean;
  onPress: (row: SessionHistoryRow) => void;
}) {
  const { t } = useTranslation();
  const ProviderIcon = getProviderIcon(row.providerId, serverId);
  const handlePress = useCallback(() => onPress(row), [onPress, row]);
  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      Boolean(hovered) && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [],
  );
  const accessibilityState = useMemo(() => ({ disabled }), [disabled]);

  return (
    <Pressable
      disabled={disabled}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={row.title}
      accessibilityState={accessibilityState}
      style={pressableStyle}
      testID={`session-history-row-${row.providerId}-${row.providerHandleId}`}
    >
      <View style={styles.rowIcon}>
        <ThemedProviderIcon
          Icon={ProviderIcon}
          size={ROW_ICON_SIZE}
          uniProps={mutedIconColorMapping}
        />
      </View>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {row.title}
      </Text>
      <Text style={styles.rowMeta} numberOfLines={1}>
        {opening
          ? t("panels.sessionHistory.row.opening")
          : formatTimeAgo(new Date(row.lastActivityAt))}
      </Text>
    </Pressable>
  );
}

export function SessionHistorySurface({
  serverId,
  workspaceId,
  workspaceDirectory,
  client,
  isConnected,
  onTerminalCreated,
}: SessionHistorySurfaceProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isClientReady = Boolean(client) && isConnected;
  const queryKey = useMemo(
    () => buildSessionHistoryQueryKey({ serverId, scope: "workspace", cwds: [workspaceDirectory] }),
    [serverId, workspaceDirectory],
  );
  const sessionsQuery = useFetchQuery({
    queryKey,
    dataShape: "list",
    staleTimeMs: 0,
    enabled: isClientReady,
    // A dead provider stays dead until the user asks again; retrying only stacks requests.
    retry: false,
    queryFn: async () => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return await client.fetchRecentProviderSessions({
        cwd: workspaceDirectory,
        limit: SESSION_HISTORY_FETCH_LIMIT,
      });
    },
  });
  const rows = useMemo(
    () => buildSessionHistoryRows(sessionsQuery.data?.entries ?? []),
    [sessionsQuery.data],
  );

  const terminalsQueryKey = useMemo(
    () => buildTerminalsQueryKey(serverId, workspaceDirectory, workspaceId),
    [serverId, workspaceDirectory, workspaceId],
  );
  const openMutation = useMutation({
    mutationFn: async (row: SessionHistoryRow) => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const launch = buildResumeTerminalLaunch(row);
      if (!launch) {
        throw new Error(t("workspace.tabs.toasts.resumeCommandUnavailable"));
      }
      const payload = await client.createTerminal(launch.cwd, launch.name, undefined, {
        command: launch.command,
        args: launch.args,
        workspaceId,
        viewAttributes: getCurrentTerminalViewAttributes(),
      });
      if (!payload.terminal) {
        throw new Error(payload.error ?? t("panels.sessionHistory.errors.openFailed"));
      }
      return payload.terminal;
    },
    onSuccess: (terminal) => {
      queryClient.setQueryData<ListTerminalsPayload>(terminalsQueryKey, (current) =>
        upsertCreatedTerminalPayload({ current, terminal, workspaceDirectory }),
      );
      void queryClient.invalidateQueries({ queryKey: terminalsQueryKey });
      onTerminalCreated(terminal.id);
    },
  });
  const openingRowKey =
    openMutation.isPending && openMutation.variables ? openMutation.variables.key : null;
  const handleRowPress = useCallback(
    (row: SessionHistoryRow) => {
      openMutation.mutate(row);
    },
    [openMutation],
  );
  const handleRetry = useCallback(() => {
    void sessionsQuery.refetch();
  }, [sessionsQuery]);

  if (!isClientReady) {
    return (
      <View style={styles.centerState} testID="session-history-disconnected">
        <Text style={styles.stateText}>{t("workspace.terminal.hostDisconnected")}</Text>
      </View>
    );
  }

  if (sessionsQuery.isPending) {
    return (
      <View style={styles.centerState} testID="session-history-loading">
        <ThemedLoadingSpinner uniProps={mutedIconColorMapping} />
        <Text style={styles.stateText}>{t("panels.sessionHistory.loading")}</Text>
      </View>
    );
  }

  if (sessionsQuery.isError) {
    return (
      <View style={styles.alertRegion}>
        <Alert
          variant="error"
          title={t("panels.sessionHistory.errors.loadFailed")}
          description={errorMessage(sessionsQuery.error)}
          testID="session-history-error"
        >
          <Button variant="outline" size="sm" onPress={handleRetry} testID="session-history-retry">
            {t("common.actions.retry")}
          </Button>
        </Alert>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.listContent}>
      {openMutation.isError ? (
        <View style={styles.alertRegion}>
          <Alert
            variant="error"
            title={t("panels.sessionHistory.errors.openFailed")}
            description={errorMessage(openMutation.error)}
            testID="session-history-open-error"
          />
        </View>
      ) : null}
      {rows.length === 0 ? (
        <View style={styles.centerState} testID="session-history-empty">
          <ThemedHistory
            size={EMPTY_ICON_SIZE}
            strokeWidth={1.5}
            uniProps={mutedIconColorMapping}
          />
          <Text style={styles.stateText}>{t("panels.sessionHistory.empty.workspace")}</Text>
        </View>
      ) : (
        rows.map((row) => (
          <SessionHistoryRowItem
            key={row.key}
            serverId={serverId}
            row={row}
            disabled={openingRowKey === row.key}
            opening={openingRowKey === row.key}
            onPress={handleRowPress}
          />
        ))
      )}
    </ScrollView>
  );
}

export interface SessionHistoryViewProps {
  serverId: string;
  workspaceId: string;
  workspaceDirectory: string;
  onTerminalCreated: (terminalId: string) => void;
}

/** The surface wired to the host runtime; the shells only decide where a new terminal tab goes. */
export function SessionHistoryView({
  serverId,
  workspaceId,
  workspaceDirectory,
  onTerminalCreated,
}: SessionHistoryViewProps) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  return (
    <SessionHistorySurface
      serverId={serverId}
      workspaceId={workspaceId}
      workspaceDirectory={workspaceDirectory}
      client={client}
      isConnected={isConnected}
      onTerminalCreated={onTerminalCreated}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingVertical: theme.spacing[1],
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[4],
  },
  stateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  alertRegion: {
    padding: theme.spacing[3],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 32,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  rowIcon: {
    width: ROW_ICON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
