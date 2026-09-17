import React, { useCallback, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { History, RotateCw } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { getProviderIcon, type ProviderIconProps } from "@/components/provider-icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { extraMutedIconColorMapping, mutedIconColorMapping } from "@/components/ui/icon-color";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  PaneContentToolbar,
  paneContentToolbarIconSize,
  paneContentToolbarTrailingPadding,
  ToolbarButton,
  ToolbarControls,
} from "@/components/ui/pane-content-toolbar";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useFetchQuery } from "@/data/query";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  buildTerminalsQueryKey,
  upsertCreatedTerminalPayload,
  type ListTerminalsPayload,
} from "@/screens/workspace/terminals/state";
import { useProjectWorkspaceDirectories, useWorkspaceFields } from "@/stores/session-store-hooks";
import { getCurrentTerminalViewAttributes } from "@/terminal/view-attributes";
import { formatTimeAgo } from "@/utils/time";
import {
  buildResumeTerminalLaunch,
  buildSessionHistoryQueryKey,
  buildSessionHistoryRows,
  filterSessionHistoryRows,
  formatSessionHistoryDirectory,
  mergeSessionHistoryPayloads,
  resolveSessionHistoryCwds,
  SESSION_HISTORY_FETCH_LIMIT,
  SESSION_HISTORY_SCOPES,
  type SessionHistoryProviderError,
  type SessionHistoryRow,
  type SessionHistoryScope,
} from "./internal/model";
import { useSessionHistoryScopeStore } from "./internal/scope-store";

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
  /** The workspace's directory: the narrowest listing scope and the home of new terminals. */
  workspaceDirectory: string;
  /** Session directories are shown relative to this outside workspace scope; null until the workspace loads. */
  projectRootPath: string | null;
  /** Directories of the project's active workspaces on this host; project scope lists them all. */
  projectWorkspaceDirectories: readonly string[];
  scope: SessionHistoryScope;
  onScopeChange: (scope: SessionHistoryScope) => void;
  client: SessionHistoryClient | null;
  isConnected: boolean;
  /**
   * The app is in the foreground and this panel is the one on screen. Provider
   * logs have no push event, so the query pauses while hidden and React Query
   * refetches on its own when the panel comes back.
   */
  isVisible: boolean;
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
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ROW_ICON_SIZE = 16;
const EMPTY_ICON_SIZE = 24;

function SessionHistoryRowItem({
  serverId,
  row,
  directory,
  disabled,
  opening,
  onPress,
}: {
  serverId: string;
  row: SessionHistoryRow;
  /** Where the session lives, when the scope spans more than one directory. */
  directory: string | null;
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
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {row.title}
        </Text>
        {directory ? (
          <Text style={styles.rowDirectory} numberOfLines={1}>
            {directory}
          </Text>
        ) : null}
      </View>
      <Text style={styles.rowMeta} numberOfLines={1}>
        {opening
          ? t("panels.sessionHistory.row.opening")
          : formatTimeAgo(new Date(row.lastActivityAt))}
      </Text>
    </Pressable>
  );
}

/** Which providers could not be listed, raw messages shown until the user folds them away. */
function ProviderErrorsNotice({ errors }: { errors: ReadonlyArray<SessionHistoryProviderError> }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const providers = Array.from(new Set(errors.map((error) => error.provider))).join(", ");
  // Lint (`react-perf/jsx-no-new-function-as-prop`) wants a stable handler here.
  const handleToggle = useCallback(() => setExpanded((current) => !current), []);
  // Raw daemon messages, untranslated on purpose (docs/i18n.md). A string, not
  // JSX: `react-perf/jsx-no-jsx-as-prop` rejects JSX in a prop even via a variable.
  const details = expanded
    ? errors.map((error) => `${error.provider}: ${error.message}`).join("\n")
    : undefined;

  return (
    <View style={styles.alertRegion}>
      <Alert
        variant="warning"
        title={t("panels.sessionHistory.providerErrors.title", { providers })}
        description={details}
        testID="session-history-provider-errors"
      >
        <Button
          variant="ghost"
          size="xs"
          onPress={handleToggle}
          testID="session-history-provider-errors-toggle"
        >
          {expanded
            ? t("panels.sessionHistory.providerErrors.hide")
            : t("panels.sessionHistory.providerErrors.show")}
        </Button>
      </Alert>
    </View>
  );
}

export function SessionHistorySurface({
  serverId,
  workspaceId,
  workspaceDirectory,
  projectRootPath,
  projectWorkspaceDirectories,
  scope,
  onScopeChange,
  client,
  isConnected,
  isVisible,
  onTerminalCreated,
}: SessionHistorySurfaceProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isCompact = useIsCompactFormFactor();
  const isClientReady = Boolean(client) && isConnected;
  const [searchQuery, setSearchQuery] = useState("");
  const cwds = useMemo(
    () => resolveSessionHistoryCwds(scope, { workspaceDirectory, projectWorkspaceDirectories }),
    [scope, workspaceDirectory, projectWorkspaceDirectories],
  );
  const queryKey = useMemo(
    () => buildSessionHistoryQueryKey({ serverId, scope, cwds }),
    [serverId, scope, cwds],
  );
  const sessionsQuery = useFetchQuery({
    queryKey,
    dataShape: "list",
    staleTimeMs: 0,
    enabled: isClientReady && isVisible,
    // A dead provider stays dead until the user asks again; retrying only stacks requests.
    retry: false,
    queryFn: async () => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const requests =
        cwds.length === 0
          ? [client.fetchRecentProviderSessions({ limit: SESSION_HISTORY_FETCH_LIMIT })]
          : cwds.map((cwd) =>
              client.fetchRecentProviderSessions({ cwd, limit: SESSION_HISTORY_FETCH_LIMIT }),
            );
      return mergeSessionHistoryPayloads(await Promise.all(requests));
    },
  });
  const { refetch } = sessionsQuery;
  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const allRows = useMemo(
    () => buildSessionHistoryRows(sessionsQuery.data?.entries ?? []),
    [sessionsQuery.data],
  );
  const rows = useMemo(
    () => filterSessionHistoryRows(allRows, searchQuery),
    [allRows, searchQuery],
  );
  const providerErrors = sessionsQuery.data?.providerErrors ?? [];
  const showDirectories = scope !== "workspace";

  const scopeOptions = useMemo<SegmentedControlOption<SessionHistoryScope>[]>(
    () =>
      SESSION_HISTORY_SCOPES.map((value) => ({
        value,
        label: t(`panels.sessionHistory.scope.${value}`),
        testID: `session-history-scope-${value}`,
      })),
    [t],
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

  if (!isClientReady) {
    return (
      <View style={styles.centerState} testID="session-history-disconnected">
        <Text style={styles.stateText}>{t("workspace.terminal.hostDisconnected")}</Text>
      </View>
    );
  }

  const emptyText =
    allRows.length > 0
      ? t("panels.sessionHistory.empty.search")
      : t(`panels.sessionHistory.empty.${scope}`);

  let body: ReactNode;
  if (sessionsQuery.isPending) {
    body = (
      <View style={styles.centerState} testID="session-history-loading">
        <ThemedLoadingSpinner uniProps={mutedIconColorMapping} />
        <Text style={styles.stateText}>{t("panels.sessionHistory.loading")}</Text>
      </View>
    );
  } else if (sessionsQuery.isError) {
    body = (
      <View style={styles.alertRegion}>
        <Alert
          variant="error"
          title={t("panels.sessionHistory.errors.loadFailed")}
          description={errorMessage(sessionsQuery.error)}
          testID="session-history-error"
        >
          <Button
            variant="outline"
            size="sm"
            onPress={handleRefresh}
            testID="session-history-retry"
          >
            {t("common.actions.retry")}
          </Button>
        </Alert>
      </View>
    );
  } else {
    body = (
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {providerErrors.length > 0 ? <ProviderErrorsNotice errors={providerErrors} /> : null}
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
            <Text style={styles.stateText}>{emptyText}</Text>
          </View>
        ) : (
          rows.map((row) => (
            <SessionHistoryRowItem
              key={row.key}
              serverId={serverId}
              row={row}
              directory={
                showDirectories ? formatSessionHistoryDirectory(row.cwd, projectRootPath) : null
              }
              disabled={openingRowKey === row.key}
              opening={openingRowKey === row.key}
              onPress={handleRowPress}
            />
          ))
        )}
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <PaneContentToolbar
        style={[
          styles.toolbar,
          { paddingRight: paneContentToolbarTrailingPadding(isCompact, "glyph") },
        ]}
        testID="session-history-toolbar"
      >
        <SegmentedControl
          size="xs"
          options={scopeOptions}
          value={scope}
          onValueChange={onScopeChange}
          testID="session-history-scope"
        />
        <ToolbarControls>
          <ToolbarButton
            label={
              sessionsQuery.isFetching
                ? t("panels.sessionHistory.actions.refreshing")
                : t("panels.sessionHistory.actions.refresh")
            }
            compact={isCompact}
            disabled={sessionsQuery.isFetching}
            hitSlop={8}
            testID="session-history-refresh"
            onPress={handleRefresh}
          >
            {sessionsQuery.isFetching ? (
              <ThemedLoadingSpinner
                size={paneContentToolbarIconSize(isCompact)}
                uniProps={extraMutedIconColorMapping}
              />
            ) : (
              <ThemedRotateCw
                size={paneContentToolbarIconSize(isCompact)}
                uniProps={extraMutedIconColorMapping}
              />
            )}
          </ToolbarButton>
        </ToolbarControls>
      </PaneContentToolbar>
      <View style={styles.searchRow}>
        <SearchField
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t("panels.sessionHistory.search.placeholder")}
          clearAccessibilityLabel={t("panels.sessionHistory.search.clear")}
          testID="session-history-search"
          clearTestID="session-history-search-clear"
        />
      </View>
      {body}
    </View>
  );
}

export interface SessionHistoryViewProps {
  serverId: string;
  workspaceId: string;
  workspaceDirectory: string;
  onTerminalCreated: (terminalId: string) => void;
}

/** The surface wired to the host runtime and stores; the shells only decide where a new terminal tab goes. */
export function SessionHistoryView({
  serverId,
  workspaceId,
  workspaceDirectory,
  onTerminalCreated,
}: SessionHistoryViewProps) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isAppVisible = useAppActivelyVisible();
  const isPanelActive = useRetainedPanelActive();
  const scope = useSessionHistoryScopeStore((state) => state.scope);
  const setScope = useSessionHistoryScopeStore((state) => state.setScope);
  const project = useWorkspaceFields(serverId, workspaceId, (workspace) => ({
    projectId: workspace.projectId,
    projectRootPath: workspace.projectRootPath,
  }));
  const projectWorkspaceDirectories = useProjectWorkspaceDirectories(
    serverId,
    project?.projectId ?? null,
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
      isVisible={isAppVisible && isPanelActive}
      onTerminalCreated={onTerminalCreated}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: theme.spacing[3],
  },
  searchRow: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  list: {
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
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowDirectory: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
