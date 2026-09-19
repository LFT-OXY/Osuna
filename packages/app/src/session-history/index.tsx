import React, { useCallback, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { History, RotateCw } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { resolveImportTarget } from "@/components/import-session-sheet-view-model";
import { getProviderIcon, type ProviderIconProps } from "@/components/provider-icons";
import { useOpenKebabMenuVisibility } from "@/components/sidebar/use-open-kebab-menu-visibility";
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
import { StatusBadge } from "@/components/ui/status-badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { useFetchQuery } from "@/data/query";
import {
  buildTerminalsQueryKey,
  upsertCreatedTerminalPayload,
  type ListTerminalsPayload,
} from "@/screens/workspace/terminals/state";
import { formatTimeAgo } from "@/utils/time";
import {
  buildResumeCommand,
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
import { resumeProviderSessionTerminal } from "./internal/resume-session";
import { SessionHistoryRowContextMenu, SessionHistoryRowMenu } from "./internal/row-menu";

export type { SessionHistoryRow, SessionHistoryScope } from "./internal/model";
export { buildSessionHistoryQueryKey } from "./internal/model";
export { openTerminalTabFromSessionHistory } from "./internal/open-terminal-tab";
// The usage page lists the same provider sessions, so it resumes them through
// the same launch, the same terminal memory, and the same key.
export { buildResumeTerminalLaunch, sessionHistoryRowKey } from "./internal/model";
export type { ResumableProviderSession, ResumeTerminalLaunch } from "./internal/model";
export { resumeProviderSessionTerminal } from "./internal/resume-session";

export type SessionHistoryClient = Pick<
  DaemonClient,
  "fetchRecentProviderSessions" | "createTerminal" | "listTerminals" | "importAgent"
>;

/** What the import RPC answered, plus whether the agent landed outside this workspace. */
export interface SessionHistoryImportResult {
  agentId: string;
  cwd: string;
  workspaceId: string | null;
  crossWorkspace: boolean;
}

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
  /** The host advertises `server_info.features.sessionHistory`; without it the view only asks for an update. */
  isSupported: boolean;
  /**
   * The app is in the foreground and this panel is the one on screen. Provider
   * logs have no push event, so the query pauses while hidden and React Query
   * refetches on its own when the panel comes back.
   */
  isVisible: boolean;
  /** The terminal exists on the daemon, new or already open; the caller shows its tab. */
  onOpenTerminal: (terminalId: string) => void;
  /** A session Paseo owns was chosen; the shell opens that agent the way History does. */
  onOpenAgent: (agentId: string, workspaceId: string | null) => void;
  /** The full resume command line; the shell owns the clipboard and the toast. */
  onCopyResumeCommand: (command: string) => void;
  /** The session is now a Paseo agent; the shell navigates the way the import sheet does. */
  onImported: (result: SessionHistoryImportResult) => void;
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

type SessionHistoryRowStatus = "idle" | "opening" | "importing";

/** One mutation runs at a time per row; the row shows which. */
function resolveRowStatus(
  rowKey: string,
  pending: { openingRowKey: string | null; importingRowKey: string | null },
): SessionHistoryRowStatus {
  if (pending.openingRowKey === rowKey) {
    return "opening";
  }
  if (pending.importingRowKey === rowKey) {
    return "importing";
  }
  return "idle";
}

function SessionHistoryRowItem({
  serverId,
  row,
  directory,
  status,
  onPress,
  onCopyResumeCommand,
  onImport,
}: {
  serverId: string;
  row: SessionHistoryRow;
  /** Where the session lives, when the scope spans more than one directory. */
  directory: string | null;
  status: SessionHistoryRowStatus;
  onPress: (row: SessionHistoryRow) => void;
  onCopyResumeCommand: (row: SessionHistoryRow) => void;
  onImport: (row: SessionHistoryRow) => void;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const ProviderIcon = getProviderIcon(row.providerId, serverId);
  const disabled = status !== "idle";
  // docs/hover.md: hover on a plain View; press on the trigger inside it.
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const handlePointerEnter = useCallback(() => {
    if (!contextMenuOpen) setIsHovered(true);
  }, [contextMenuOpen]);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    setContextMenuOpen(open);
    if (open) setIsHovered(false);
  }, []);
  const kebab = useOpenKebabMenuVisibility(isHovered || isNative || isCompact);

  const handlePress = useCallback(() => onPress(row), [onPress, row]);
  const handleCopyResumeCommand = useCallback(
    () => onCopyResumeCommand(row),
    [onCopyResumeCommand, row],
  );
  const handleImport = useCallback(() => onImport(row), [onImport, row]);
  const triggerStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.row,
      isHovered && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isHovered],
  );
  const accessibilityState = useMemo(() => ({ disabled }), [disabled]);
  const menuActions = {
    rowKey: row.key,
    onCopyResumeCommand: handleCopyResumeCommand,
    // Paseo already owns the session: importing it again would make a second agent.
    onImport: row.importedAgentId ? null : handleImport,
    importStatus: status === "importing" ? ("pending" as const) : ("idle" as const),
  };

  let meta: string;
  if (status === "opening") {
    meta = t("panels.sessionHistory.row.opening");
  } else if (status === "importing") {
    meta = t("panels.sessionHistory.row.importing");
  } else {
    meta = formatTimeAgo(new Date(row.lastActivityAt));
  }

  return (
    <View
      style={styles.rowContainer}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <SessionHistoryRowContextMenu
        {...menuActions}
        open={contextMenuOpen}
        onOpenChange={handleContextMenuOpenChange}
        disabled={disabled}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={row.title}
        accessibilityState={accessibilityState}
        style={triggerStyle}
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
        {row.importedAgentId ? <StatusBadge label={t("panels.sessionHistory.row.paseo")} /> : null}
        <Text style={styles.rowMeta} numberOfLines={1}>
          {meta}
        </Text>
        {/* A fixed slot: hidden by opacity, never unmounted, so revealing it moves nothing. */}
        <View
          style={[styles.kebabSlot, !kebab.showKebab && styles.kebabSlotHidden]}
          pointerEvents={kebab.showKebab ? "auto" : "none"}
        >
          <SessionHistoryRowMenu {...menuActions} {...kebab.menuProps} />
        </View>
      </SessionHistoryRowContextMenu>
    </View>
  );
}

/** A failed row action, shown above the list until the next attempt replaces it. */
function ActionErrorAlert({
  title,
  error,
  testID,
}: {
  title: string;
  /** The mutation's error; null while idle or after a success. */
  error: unknown;
  testID: string;
}) {
  if (!error) {
    return null;
  }
  return (
    <View style={styles.alertRegion}>
      <Alert variant="error" title={title} description={errorMessage(error)} testID={testID} />
    </View>
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
  isSupported,
  isVisible,
  onOpenTerminal,
  onOpenAgent,
  onCopyResumeCommand,
  onImported,
}: SessionHistorySurfaceProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isCompact = useIsCompactFormFactor();
  const isClientReady = Boolean(client) && isConnected;
  const canList = isClientReady && isSupported;
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
    enabled: canList && isVisible,
    // A dead provider stays dead until the user asks again; retrying only stacks requests.
    retry: false,
    queryFn: async () => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const requests =
        cwds.length === 0
          ? [
              client.fetchRecentProviderSessions({
                limit: SESSION_HISTORY_FETCH_LIMIT,
                includeImported: true,
              }),
            ]
          : cwds.map((cwd) =>
              client.fetchRecentProviderSessions({
                cwd,
                limit: SESSION_HISTORY_FETCH_LIMIT,
                includeImported: true,
              }),
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
      return await resumeProviderSessionTerminal({
        client,
        ref: { serverId, workspaceId, sessionKey: row.key },
        launch,
        workspaceDirectory,
        openFailedMessage: t("panels.sessionHistory.errors.openFailed"),
      });
    },
    onSuccess: ({ terminalId, created }) => {
      if (created) {
        queryClient.setQueryData<ListTerminalsPayload>(terminalsQueryKey, (current) =>
          upsertCreatedTerminalPayload({ current, terminal: created, workspaceDirectory }),
        );
        void queryClient.invalidateQueries({ queryKey: terminalsQueryKey });
      }
      onOpenTerminal(terminalId);
    },
  });
  const importMutation = useMutation({
    mutationFn: async (row: SessionHistoryRow): Promise<SessionHistoryImportResult> => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      // Workspace scope lists only rows the daemon matched to this directory by realpath.
      const target = resolveImportTarget({
        entryCwd: row.cwd,
        workspaceCwd: workspaceDirectory,
        workspaceId,
        isScopedListing: scope === "workspace",
      });
      const agent = await client.importAgent({
        providerId: row.providerId,
        providerHandleId: row.providerHandleId,
        cwd: row.cwd,
        ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}),
      });
      return {
        agentId: agent.id,
        cwd: agent.cwd,
        workspaceId: agent.workspaceId ?? null,
        crossWorkspace: target.crossWorkspace,
      };
    },
    onSuccess: (result) => {
      // The row now belongs to Paseo; relist so it wears the badge and loses the import action.
      void queryClient.invalidateQueries({ queryKey });
      onImported(result);
    },
  });
  const openingRowKey =
    openMutation.isPending && openMutation.variables ? openMutation.variables.key : null;
  const importingRowKey =
    importMutation.isPending && importMutation.variables ? importMutation.variables.key : null;
  const handleRowPress = useCallback(
    (row: SessionHistoryRow) => {
      // A session Paseo owns has one owner: its agent. Never resume it in a second process.
      if (row.importedAgentId) {
        onOpenAgent(row.importedAgentId, row.importedAgentWorkspaceId);
        return;
      }
      openMutation.mutate(row);
    },
    [onOpenAgent, openMutation],
  );
  const handleCopyResumeCommand = useCallback(
    (row: SessionHistoryRow) => {
      const command = buildResumeCommand(row);
      if (command) {
        onCopyResumeCommand(command);
      }
    },
    [onCopyResumeCommand],
  );
  const handleImport = useCallback(
    (row: SessionHistoryRow) => {
      importMutation.mutate(row);
    },
    [importMutation],
  );

  if (!isClientReady) {
    return (
      <View style={styles.centerState} testID="session-history-disconnected">
        <Text style={styles.stateText}>{t("workspace.terminal.hostDisconnected")}</Text>
      </View>
    );
  }

  // COMPAT(sessionHistory): added in v0.8.1, remove this gate and `isSupported` after 2027-03-18.
  if (!isSupported) {
    return (
      <View style={styles.centerState} testID="session-history-unsupported">
        <Text style={styles.stateText}>{t("panels.sessionHistory.updateHost")}</Text>
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
        <ActionErrorAlert
          title={t("panels.sessionHistory.errors.openFailed")}
          error={openMutation.error}
          testID="session-history-open-error"
        />
        <ActionErrorAlert
          title={t("panels.sessionHistory.errors.importFailed")}
          error={importMutation.error}
          testID="session-history-import-error"
        />
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
              status={resolveRowStatus(row.key, { openingRowKey, importingRowKey })}
              onPress={handleRowPress}
              onCopyResumeCommand={handleCopyResumeCommand}
              onImport={handleImport}
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
  rowContainer: {
    position: "relative",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 32,
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
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
  kebabSlot: {
    width: ROW_ICON_SIZE + theme.spacing[1],
    alignItems: "flex-end",
    justifyContent: "center",
  },
  kebabSlotHidden: {
    opacity: 0,
  },
}));
