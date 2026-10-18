import React, { useCallback, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, History, ListChecks, RotateCw } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AgentImportError, type DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { CODEX_MODEL_PROVIDER_MISSING_ERROR_CODE } from "@getpaseo/protocol/codex-session/rpc-schemas";
import { resolveImportTarget } from "@/components/import-session-sheet-view-model";
import { useProviderIcon, type ProviderIconProps } from "@/components/provider-icons";
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
import type { Theme } from "@/styles/theme";
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
  /**
   * "Move to another Codex model provider" was chosen for one Codex row (its menu, or a failed
   * import) or for the selected rows; the shell owns the dialog. Null when the host can't move
   * Codex conversations (`server_info.features.apiEndpointCliWiring`); there is no selection mode then.
   */
  onMoveCodexConversations: ((rows: readonly SessionHistoryRow[]) => void) | null;
  /** Keys of the selected rows while selecting; null outside selection mode. The shell holds it so a move can end it. */
  selectedRowKeys: ReadonlySet<string> | null;
  onSelectedRowKeysChange: (keys: ReadonlySet<string> | null) => void;
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
const ThemedListChecks = withUnistyles(ListChecks);
const ThemedCheck = withUnistyles(Check);
const accentForegroundColorMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ROW_ICON_SIZE = 16;
const EMPTY_ICON_SIZE = 24;

type SessionHistoryRowStatus = "idle" | "opening" | "importing";

/**
 * A row in selection mode. Only Codex rows can be moved, and one move works in one provider's
 * CODEX_HOME, so once a row is selected rows from other providers are unavailable.
 */
type SessionHistoryRowSelection = "off" | "selected" | "unselected" | "unavailable";

function resolveRowSelection(input: {
  row: SessionHistoryRow;
  selectedRowKeys: ReadonlySet<string> | null;
  selectionProviderId: string | null;
}): SessionHistoryRowSelection {
  const { row, selectedRowKeys, selectionProviderId } = input;
  if (!selectedRowKeys) return "off";
  if (selectedRowKeys.has(row.key)) return "selected";
  const isOtherProvider = selectionProviderId !== null && row.providerId !== selectionProviderId;
  if (!row.codexModelProvider || isOtherProvider) return "unavailable";
  return "unselected";
}

/** The provider's icon; in selection mode, the selection ring where the row can be selected. */
function RowLeading({
  selection,
  providerIcon,
}: {
  selection: SessionHistoryRowSelection;
  providerIcon: ComponentType<ProviderIconProps>;
}) {
  if (selection === "off" || selection === "unavailable") {
    return (
      <ThemedProviderIcon
        Icon={providerIcon}
        size={ROW_ICON_SIZE}
        uniProps={mutedIconColorMapping}
      />
    );
  }
  return <SelectionIndicator isSelected={selection === "selected"} />;
}

/** The platform's selection idiom: an empty ring, filled with a check once selected. */
function SelectionIndicator({ isSelected }: { isSelected: boolean }) {
  return (
    <View style={[styles.selectionIndicator, isSelected && styles.selectionIndicatorSelected]}>
      {isSelected ? (
        <ThemedCheck size={12} strokeWidth={3} uniProps={accentForegroundColorMapping} />
      ) : null}
    </View>
  );
}

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
  selection,
  onPress,
  onToggleSelected,
  onCopyResumeCommand,
  onImport,
  onMoveCodexConversation,
}: {
  serverId: string;
  row: SessionHistoryRow;
  /** Where the session lives, when the scope spans more than one directory. */
  directory: string | null;
  status: SessionHistoryRowStatus;
  selection: SessionHistoryRowSelection;
  onPress: (row: SessionHistoryRow) => void;
  onToggleSelected: (row: SessionHistoryRow) => void;
  onCopyResumeCommand: (row: SessionHistoryRow) => void;
  onImport: (row: SessionHistoryRow) => void;
  /** Null when this row can't be moved: not a Codex row, or the host can't move it. */
  onMoveCodexConversation: ((row: SessionHistoryRow) => void) | null;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const ProviderIcon = useProviderIcon(row.providerId, serverId);
  const isSelecting = selection !== "off";
  const isSelected = selection === "selected";
  const disabled = status !== "idle" || selection === "unavailable";
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
  const kebab = useOpenKebabMenuVisibility(!isSelecting && (isHovered || isNative || isCompact));

  const handlePress = useCallback(() => {
    if (isSelecting) {
      onToggleSelected(row);
      return;
    }
    onPress(row);
  }, [isSelecting, onPress, onToggleSelected, row]);
  const handleCopyResumeCommand = useCallback(
    () => onCopyResumeCommand(row),
    [onCopyResumeCommand, row],
  );
  const handleImport = useCallback(() => onImport(row), [onImport, row]);
  const handleMoveCodexConversation = useCallback(
    () => onMoveCodexConversation?.(row),
    [onMoveCodexConversation, row],
  );
  const triggerStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.row,
      isSelected && styles.rowSelected,
      isHovered && !isSelected && styles.rowHovered,
      pressed && styles.rowPressed,
      selection === "unavailable" && styles.rowUnavailable,
    ],
    [isHovered, isSelected, selection],
  );
  const accessibilityState = useMemo(
    () => (isSelecting ? { disabled, checked: isSelected } : { disabled }),
    [disabled, isSelected, isSelecting],
  );
  const menuActions = {
    rowKey: row.key,
    onCopyResumeCommand: handleCopyResumeCommand,
    // Paseo already owns the session: importing it again would make a second agent.
    onImport: row.importedAgentId ? null : handleImport,
    importStatus: status === "importing" ? ("pending" as const) : ("idle" as const),
    onMoveCodexConversation: onMoveCodexConversation ? handleMoveCodexConversation : null,
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
        accessibilityRole={isSelecting ? "checkbox" : "button"}
        accessibilityLabel={row.title}
        accessibilityState={accessibilityState}
        aria-checked={isSelecting ? isSelected : undefined}
        style={triggerStyle}
        testID={`session-history-row-${row.providerId}-${row.providerHandleId}`}
      >
        <View style={styles.rowIcon}>
          <RowLeading selection={selection} providerIcon={ProviderIcon} />
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {row.title}
            </Text>
            {row.importedAgentId ? (
              <StatusBadge label={t("panels.sessionHistory.row.paseo")} />
            ) : null}
            <Text style={styles.rowMeta} numberOfLines={1}>
              {meta}
            </Text>
          </View>
          {row.codexModelProvider || directory ? (
            // 第二行伸到时间下面，默认侧栏宽度也放得下「Codex 服务商 + id」；窄了先截目录，再截说法，id 最后。
            <View style={styles.rowSubline}>
              {row.codexModelProvider ? (
                <View
                  style={styles.rowCodexModelProvider}
                  testID="session-history-row-codex-model-provider"
                >
                  <Text style={styles.rowCodexModelProviderLabel} numberOfLines={1}>
                    {t("panels.sessionHistory.row.codexModelProvider")}
                  </Text>
                  <Text style={styles.rowCodexModelProviderId} numberOfLines={1}>
                    {row.codexModelProvider}
                  </Text>
                </View>
              ) : null}
              {directory ? (
                <Text style={styles.rowDirectory} numberOfLines={1}>
                  {directory}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
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
      <Alert
        size="sm"
        variant="error"
        title={title}
        description={errorMessage(error)}
        testID={testID}
      />
    </View>
  );
}

/**
 * A failed import. When Codex refused to continue the conversation because its Codex model
 * provider is gone (the daemon says so by code), the reason is said in the UI language and the
 * move is offered; once the row is listed under another provider the alert has served its purpose.
 */
function ImportErrorAlert({
  error,
  failedRow,
  currentRow,
  onMoveCodexConversations,
}: {
  error: unknown;
  /** The row as it was when the import failed. */
  failedRow: SessionHistoryRow | undefined;
  /** The same row in the latest listing. */
  currentRow: SessionHistoryRow | undefined;
  onMoveCodexConversations: ((rows: readonly SessionHistoryRow[]) => void) | null;
}) {
  const { t } = useTranslation();
  const missingProvider =
    error instanceof AgentImportError &&
    error.code === CODEX_MODEL_PROVIDER_MISSING_ERROR_CODE &&
    failedRow?.codexModelProvider
      ? failedRow.codexModelProvider
      : null;
  const handleMove = useCallback(() => {
    if (currentRow) onMoveCodexConversations?.([currentRow]);
  }, [currentRow, onMoveCodexConversations]);
  if (!error) {
    return null;
  }
  if (!missingProvider) {
    return (
      <ActionErrorAlert
        title={t("panels.sessionHistory.errors.importFailed")}
        error={error}
        testID="session-history-import-error"
      />
    );
  }
  const hasMovedSince = currentRow?.codexModelProvider !== missingProvider;
  if (hasMovedSince) {
    return null;
  }
  return (
    <View style={styles.alertRegion}>
      <Alert
        size="sm"
        variant="error"
        title={t("panels.sessionHistory.errors.importFailed")}
        description={t("panels.sessionHistory.errors.codexModelProviderMissing", {
          provider: missingProvider,
        })}
        testID="session-history-import-error"
      >
        {onMoveCodexConversations ? (
          <Button
            variant="outline"
            size="sm"
            onPress={handleMove}
            testID="session-history-import-error-move"
          >
            {t("panels.sessionHistory.move.menuItem")}
          </Button>
        ) : null}
      </Alert>
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
        size="sm"
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

/** Selection mode: the selected rows still listed, and the handlers that change the selection. */
function useRowSelection(input: {
  allRows: readonly SessionHistoryRow[];
  selectedRowKeys: ReadonlySet<string> | null;
  onSelectedRowKeysChange: (keys: ReadonlySet<string> | null) => void;
  onMoveCodexConversations: ((rows: readonly SessionHistoryRow[]) => void) | null;
}) {
  const { allRows, selectedRowKeys, onSelectedRowKeysChange, onMoveCodexConversations } = input;
  const selectedRows = useMemo(
    () => (selectedRowKeys ? allRows.filter((row) => selectedRowKeys.has(row.key)) : []),
    [allRows, selectedRowKeys],
  );
  const selectionProviderId = selectedRows[0]?.providerId ?? null;
  const handleToggleSelected = useCallback(
    (row: SessionHistoryRow) => {
      const next = new Set(selectedRowKeys);
      if (next.has(row.key)) {
        next.delete(row.key);
      } else {
        next.add(row.key);
      }
      onSelectedRowKeysChange(next);
    },
    [onSelectedRowKeysChange, selectedRowKeys],
  );
  const handleStartSelecting = useCallback(
    () => onSelectedRowKeysChange(new Set()),
    [onSelectedRowKeysChange],
  );
  const handleStopSelecting = useCallback(
    () => onSelectedRowKeysChange(null),
    [onSelectedRowKeysChange],
  );
  const handleMoveSelected = useCallback(
    () => onMoveCodexConversations?.(selectedRows),
    [onMoveCodexConversations, selectedRows],
  );
  return {
    selectedRows,
    selectionProviderId,
    handleToggleSelected,
    handleStartSelecting,
    handleStopSelecting,
    handleMoveSelected,
  };
}

/** Selection mode's toolbar: how many are selected, leave, and the one batch action. */
function SelectionToolbar({
  selectedCount,
  onCancel,
  onMove,
}: {
  selectedCount: number;
  onCancel: () => void;
  onMove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PaneContentToolbar
      style={[styles.toolbar, styles.selectionToolbar]}
      testID="session-history-selection-toolbar"
    >
      <Text
        style={styles.selectionCount}
        numberOfLines={1}
        testID="session-history-selection-count"
      >
        {t("panels.sessionHistory.selection.count", { count: selectedCount })}
      </Text>
      <View style={styles.selectionActions}>
        <Button
          variant="ghost"
          size="xs"
          onPress={onCancel}
          testID="session-history-selection-cancel"
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          size="xs"
          onPress={onMove}
          disabled={selectedCount === 0}
          testID="session-history-selection-move"
        >
          {t("panels.sessionHistory.selection.move")}
        </Button>
      </View>
    </PaneContentToolbar>
  );
}

function RefreshButton({
  isFetching,
  isCompact,
  onRefresh,
}: {
  isFetching: boolean;
  isCompact: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ToolbarButton
      label={
        isFetching
          ? t("panels.sessionHistory.actions.refreshing")
          : t("panels.sessionHistory.actions.refresh")
      }
      compact={isCompact}
      disabled={isFetching}
      hitSlop={8}
      testID="session-history-refresh"
      onPress={onRefresh}
    >
      {isFetching ? (
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
  onMoveCodexConversations,
  selectedRowKeys,
  onSelectedRowKeysChange,
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
  const handleMoveCodexConversation = useCallback(
    (row: SessionHistoryRow) => onMoveCodexConversations?.([row]),
    [onMoveCodexConversations],
  );
  const {
    selectedRows,
    selectionProviderId,
    handleToggleSelected,
    handleStartSelecting,
    handleStopSelecting,
    handleMoveSelected,
  } = useRowSelection({
    allRows,
    selectedRowKeys,
    onSelectedRowKeysChange,
    onMoveCodexConversations,
  });
  const failedImportRow = importMutation.variables;
  const currentFailedImportRow = useMemo(
    () => (failedImportRow ? allRows.find((row) => row.key === failedImportRow.key) : undefined),
    [allRows, failedImportRow],
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
          size="sm"
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
        <ImportErrorAlert
          error={importMutation.error}
          failedRow={failedImportRow}
          currentRow={currentFailedImportRow}
          onMoveCodexConversations={onMoveCodexConversations}
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
              selection={resolveRowSelection({ row, selectedRowKeys, selectionProviderId })}
              onPress={handleRowPress}
              onToggleSelected={handleToggleSelected}
              onCopyResumeCommand={handleCopyResumeCommand}
              onImport={handleImport}
              onMoveCodexConversation={
                row.codexModelProvider && onMoveCodexConversations
                  ? handleMoveCodexConversation
                  : null
              }
            />
          ))
        )}
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      {selectedRowKeys ? (
        <SelectionToolbar
          selectedCount={selectedRows.length}
          onCancel={handleStopSelecting}
          onMove={handleMoveSelected}
        />
      ) : (
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
            {onMoveCodexConversations ? (
              <ToolbarButton
                label={t("common.actions.select")}
                compact={isCompact}
                hitSlop={8}
                testID="session-history-select"
                onPress={handleStartSelecting}
              >
                <ThemedListChecks
                  size={paneContentToolbarIconSize(isCompact)}
                  uniProps={extraMutedIconColorMapping}
                />
              </ToolbarButton>
            ) : null}
            <RefreshButton
              isFetching={sessionsQuery.isFetching}
              isCompact={isCompact}
              onRefresh={handleRefresh}
            />
          </ToolbarControls>
        </PaneContentToolbar>
      )}
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
  // docs/design.md 行状态：选中是 surfaceSidebarSelected 加 1px 内描边，内描边不挪动内容。
  rowSelected: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
    boxShadow: `inset 0 0 0 1px ${theme.colors.borderSidebarSelected}`,
  },
  rowUnavailable: {
    opacity: 0.5,
  },
  selectionIndicator: {
    width: ROW_ICON_SIZE,
    height: ROW_ICON_SIZE,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    alignItems: "center",
    justifyContent: "center",
  },
  selectionIndicatorSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  selectionToolbar: {
    paddingRight: theme.spacing[2],
    gap: theme.spacing[2],
  },
  selectionCount: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  selectionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
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
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowSubline: {
    flexDirection: "row",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  rowCodexModelProvider: {
    flexDirection: "row",
    flexShrink: 1,
    gap: theme.spacing[1],
    minWidth: 0,
  },
  rowCodexModelProviderLabel: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowCodexModelProviderId: {
    flexShrink: 0,
    maxWidth: "100%",
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  rowDirectory: {
    flex: 1,
    minWidth: 0,
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
