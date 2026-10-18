import React, { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CircleAlert, CircleCheck } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  CodexSessionModelProvider,
  CodexSessionMoved,
  CodexSessionMoveSkipped,
} from "@getpaseo/protocol/codex-session/rpc-schemas";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ComboboxItem } from "@/components/ui/combobox";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
  type SelectFieldRenderOptionInput,
} from "@/components/ui/select-field";
import { Text } from "@/components/ui/text";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useFetchQuery } from "@/data/query";
import type { Theme } from "@/styles/theme";

export type MoveCodexConversationClient = Pick<
  DaemonClient,
  "codexSessionListModelProviders" | "codexSessionMoveModelProvider"
>;

/** 要挪的一段对话：会话历史的一行。 */
export interface MoveCodexConversationThread {
  threadId: string;
  title: string;
  /** 它现在记在哪个 Codex 服务商名下。 */
  from: string;
}

/** 要挪的对话：会话历史里同一个提供方列出的一行或几行。 */
export interface MoveCodexConversationsTarget {
  serverId: string;
  /** 会话历史列出它们的提供方（codex 或派生自它的自定义提供方）：daemon 在它的 CODEX_HOME 里挪。 */
  providerId: string;
  threads: readonly MoveCodexConversationThread[];
}

/** 一次挪动的结果；`isComplete` 为 false 时对话框留着，逐条说明哪些没挪。 */
export interface MoveCodexConversationsOutcome {
  to: string;
  movedCount: number;
  isComplete: boolean;
}

/** 几段一起挪时 daemon 的逐条结果。 */
interface BatchMoveResult {
  to: string;
  moved: CodexSessionMoved[];
  skipped: CodexSessionMoveSkipped[];
}

/**
 * 没挪完。`skipped`：daemon 跳过了它，什么都没动（原因已翻译）；`failed`：请求或改对话文件失败，
 * 已改的文件已改回；`partly`：对话文件已挪、状态库没改成。后两种是 daemon 原话，做过备份时带备份目录。
 */
type MoveNotDoneKind = "skipped" | "failed" | "partly";

class MoveNotDoneError extends Error {
  constructor(
    message: string,
    readonly kind: MoveNotDoneKind,
    readonly backupPath: string | null,
  ) {
    super(message);
    this.name = "MoveNotDoneError";
  }
}

const SHEET_WIDTH = 480;

const ThemedCircleCheck = withUnistyles(CircleCheck);
const ThemedCircleAlert = withUnistyles(CircleAlert);
const successIconColorMapping = (theme: Theme) => ({ color: theme.colors.statusSuccess });
const warningIconColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });
const RESULT_ICON_SIZE = 14;

/**
 * 「挪到另一个 Codex 服务商」对话框（ADR 0011）：选目标，说明会先备份、挪回即撤销；
 * 挪动中按钮显示进行中，全部挪好交给调用方关掉并提示。一段对话时跳过与失败留在框里说明原因、可以重试；
 * 几段一起挪时逐条列出挪了还是没挪及原因，请求本身失败时错误留在框里、可以重试。
 */
export function MoveCodexConversationSheet({
  client,
  conversations,
  onClose,
  onMoved,
}: {
  client: MoveCodexConversationClient;
  conversations: MoveCodexConversationsTarget;
  onClose: () => void;
  onMoved: (outcome: MoveCodexConversationsOutcome) => void;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const { threads } = conversations;
  const isBatch = threads.length > 1;
  // 都记在同一个服务商名下时才有「现在的服务商」：挪去那里没有意义，不列。
  const sharedFrom = threads.every((thread) => thread.from === threads[0]?.from)
    ? (threads[0]?.from ?? null)
    : null;
  const [selected, setSelected] = useState<{ id: string; display: SelectFieldDisplay } | null>(
    null,
  );
  const providersQuery = useFetchQuery({
    queryKey: ["codex-session-model-providers", conversations.serverId, conversations.providerId],
    dataShape: "list",
    staleTimeMs: 0,
    retry: false,
    queryFn: async () => {
      const payload = await client.codexSessionListModelProviders(conversations.providerId);
      if (payload.error) throw new Error(payload.error.message);
      return payload.modelProviders;
    },
  });
  const moveMutation = useMutation({
    mutationFn: async (to: string): Promise<BatchMoveResult> => {
      const payload = await client.codexSessionMoveModelProvider({
        providerId: conversations.providerId,
        threadIds: threads.map((thread) => thread.threadId),
        to,
      });
      if (payload.error) throw new MoveNotDoneError(payload.error.message, "failed", null);
      const skip = payload.skipped[0];
      if (!isBatch && skip) throw notDoneError({ skip, t });
      return { to, moved: payload.moved, skipped: payload.skipped };
    },
    onSuccess: (result) =>
      onMoved({
        to: result.to,
        movedCount: result.moved.length,
        isComplete: result.skipped.length === 0,
      }),
  });
  const batchResult = isBatch && moveMutation.data?.skipped.length ? moveMutation.data : null;

  const targets = useMemo(() => {
    const others = (providersQuery.data ?? []).filter((p) => p.id !== sharedFrom);
    // 不能选的放最后：下拉打开时第一行是高亮的，不该落在一个点不了的选项上。
    return [
      ...others.filter((p) => !p.unavailableReason),
      ...others.filter((p) => p.unavailableReason),
    ];
  }, [sharedFrom, providersQuery.data]);
  const options = useMemo<SelectFieldOption<string>[]>(
    () =>
      targets.map((provider) => ({
        id: provider.id,
        value: provider.id,
        label: provider.name ?? provider.id,
        description: describeProvider({ provider, t }),
        testID: `move-codex-conversation-target-${provider.id}`,
      })),
    [targets, t],
  );
  const unavailableIds = useMemo(
    () => new Set(targets.filter((p) => p.unavailableReason).map((p) => p.id)),
    [targets],
  );
  const handleChange = useCallback(
    (id: string, display: SelectFieldDisplay) => {
      if (!unavailableIds.has(id)) setSelected({ id, display });
    },
    [unavailableIds],
  );
  const renderOption = useCallback(
    ({ option, selected: isSelected, active, onPress }: SelectFieldRenderOptionInput<string>) => {
      const isUnavailable = unavailableIds.has(option.id);
      return (
        <ComboboxItem
          testID={option.testID}
          label={option.label}
          description={option.description}
          selected={isSelected}
          active={active}
          disabled={isUnavailable}
          onPress={onPress}
        />
      );
    },
    [unavailableIds],
  );
  const isMoving = moveMutation.isPending;
  const selectedId = selected?.id ?? null;
  const { mutate } = moveMutation;
  const handleMove = useCallback(() => {
    if (selectedId) mutate(selectedId);
  }, [mutate, selectedId]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("panels.sessionHistory.move.title"),
      subtitle: isBatch ? (
        <Text variant="caption" color="foregroundMuted">
          {t("panels.sessionHistory.move.conversationCount", { count: threads.length })}
        </Text>
      ) : undefined,
    }),
    [isBatch, t, threads.length],
  );
  const footer = useMemo(
    () => (
      <MoveSheetFooter
        hasBatchResult={Boolean(batchResult)}
        isMoving={isMoving}
        canMove={Boolean(selectedId)}
        onClose={onClose}
        onMove={handleMove}
      />
    ),
    [batchResult, handleMove, isMoving, onClose, selectedId],
  );
  // 一段对话时说出它现在的服务商；几段或服务商不同时说「原来的 Codex 服务商」。
  const singleFrom = isBatch ? null : sharedFrom;

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={SHEET_WIDTH}
      testID="move-codex-conversation-sheet"
    >
      <View style={styles.body}>
        <SelectField
          label={t("panels.sessionHistory.move.targetLabel")}
          value={selectedId}
          selectedDisplay={selected?.display ?? null}
          options={options}
          onChange={handleChange}
          placeholder={t("panels.sessionHistory.move.targetPlaceholder")}
          emptyText={t("panels.sessionHistory.move.targetEmpty")}
          renderOption={renderOption}
          loading={providersQuery.isPending}
          disabled={isMoving || Boolean(batchResult)}
          size={isCompact ? "md" : "sm"}
          testID="move-codex-conversation-target"
          triggerTestID="move-codex-conversation-target-trigger"
        />
        <Text
          variant="caption"
          color="foregroundMuted"
          testID="move-codex-conversation-backup-note"
        >
          {singleFrom
            ? t("panels.sessionHistory.move.backupNote", { from: singleFrom })
            : t("panels.sessionHistory.move.backupNoteMany")}
        </Text>
        <Text variant="caption" color="foregroundMuted">
          {singleFrom
            ? t("panels.sessionHistory.move.rebuildNote", { from: singleFrom })
            : t("panels.sessionHistory.move.rebuildNoteMany")}
        </Text>
        {providersQuery.isError ? (
          <Alert
            size="sm"
            variant="error"
            title={t("panels.sessionHistory.move.listFailed")}
            description={providersQuery.error.message}
            testID="move-codex-conversation-list-error"
          />
        ) : null}
        <MoveErrorAlert error={moveMutation.error} />
        {batchResult ? <BatchMoveResults result={batchResult} threads={threads} /> : null}
      </View>
    </AdaptiveModalSheet>
  );
}

/** 挪动前：取消与挪动；几段一起挪、有没挪成的结果时只剩关闭。 */
function MoveSheetFooter({
  hasBatchResult,
  isMoving,
  canMove,
  onClose,
  onMove,
}: {
  hasBatchResult: boolean;
  isMoving: boolean;
  canMove: boolean;
  onClose: () => void;
  onMove: () => void;
}) {
  const { t } = useTranslation();
  if (hasBatchResult) {
    return (
      <View style={styles.actions}>
        <Button
          variant="secondary"
          size="sm"
          onPress={onClose}
          testID="move-codex-conversation-cancel"
        >
          {t("common.actions.close")}
        </Button>
      </View>
    );
  }
  return (
    <View style={styles.actions}>
      <Button
        variant="secondary"
        size="sm"
        onPress={onClose}
        disabled={isMoving}
        testID="move-codex-conversation-cancel"
      >
        {t("common.actions.cancel")}
      </Button>
      <Button
        variant="default"
        size="sm"
        onPress={onMove}
        disabled={!canMove || isMoving}
        testID="move-codex-conversation-confirm"
      >
        {isMoving
          ? t("panels.sessionHistory.move.moving")
          : t("panels.sessionHistory.move.confirm")}
      </Button>
    </View>
  );
}

/** 请求失败，或一段对话没挪成：留在框里，可以再按「挪动」重试。 */
function MoveErrorAlert({ error }: { error: Error | null }) {
  const { t } = useTranslation();
  if (!error) return null;
  const notDone = error instanceof MoveNotDoneError ? error : null;
  const title =
    notDone?.kind === "partly"
      ? t("panels.sessionHistory.move.movedPartly")
      : t("panels.sessionHistory.move.notMoved");
  const variant = notDone?.kind === "failed" || !notDone ? "error" : "warning";
  const backup = notDone?.backupPath
    ? `\n${t("panels.sessionHistory.move.backupAt", { path: notDone.backupPath })}`
    : "";
  return (
    <Alert
      size="sm"
      variant={variant}
      title={title}
      description={`${error.message}${backup}`}
      testID="move-codex-conversation-error"
    />
  );
}

/** 几段一起挪、有没挪成的：逐条写明挪到了哪里，或没挪及原因（失败的带备份目录）。 */
function BatchMoveResults({
  result,
  threads,
}: {
  result: BatchMoveResult;
  threads: readonly MoveCodexConversationThread[];
}) {
  const { t } = useTranslation();
  const movedIds = new Set(result.moved.map((entry) => entry.threadId));
  const skippedById = new Map(result.skipped.map((entry) => [entry.threadId, entry]));
  return (
    <View style={styles.results} testID="move-codex-conversation-results">
      <Text variant="caption" color="foregroundMuted">
        {t("panels.sessionHistory.move.resultsSummary", {
          moved: result.moved.length,
          total: threads.length,
        })}
      </Text>
      {threads.map((thread) => {
        const skip = skippedById.get(thread.threadId);
        const isMoved = movedIds.has(thread.threadId);
        const status = isMoved
          ? t("panels.sessionHistory.move.moved", { to: result.to })
          : describeSkippedResult({ skip, t });
        return (
          <View
            key={thread.threadId}
            style={styles.resultRow}
            testID={`move-codex-conversation-result-${thread.threadId}`}
          >
            <View style={styles.resultIcon}>
              {isMoved ? (
                <ThemedCircleCheck size={RESULT_ICON_SIZE} uniProps={successIconColorMapping} />
              ) : (
                <ThemedCircleAlert size={RESULT_ICON_SIZE} uniProps={warningIconColorMapping} />
              )}
            </View>
            <View style={styles.resultBody}>
              <Text numberOfLines={1}>{thread.title}</Text>
              <Text variant="caption" color="foregroundMuted">
                {status}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** 没挪成的一条：标题说没挪（或文件已挪、状态库没改），后面跟原因与备份目录。 */
function describeSkippedResult(input: {
  skip: CodexSessionMoveSkipped | undefined;
  t: (key: string, options?: Record<string, string>) => string;
}): string {
  const { skip, t } = input;
  if (!skip) return t("panels.sessionHistory.move.resultNotMoved");
  const notDone = notDoneError({ skip, t });
  const heading =
    notDone.kind === "partly"
      ? t("panels.sessionHistory.move.movedPartly")
      : t("panels.sessionHistory.move.resultNotMoved");
  const backup = notDone.backupPath
    ? ` ${t("panels.sessionHistory.move.backupAt", { path: notDone.backupPath })}`
    : "";
  return t("panels.sessionHistory.move.resultWithReason", {
    status: heading,
    reason: `${notDone.message}${backup}`,
  });
}

function notDoneError(input: {
  skip: CodexSessionMoveSkipped;
  t: (key: string) => string;
}): MoveNotDoneError {
  const { skip, t } = input;
  const backupPath = skip.backupPath ?? null;
  switch (skip.reason) {
    case "active":
      return new MoveNotDoneError(t("panels.sessionHistory.move.skippedActive"), "skipped", null);
    case "not_found":
      return new MoveNotDoneError(t("panels.sessionHistory.move.skippedNotFound"), "skipped", null);
    case "state_database_failed":
      return new MoveNotDoneError(skip.message, "partly", backupPath);
    default:
      return new MoveNotDoneError(skip.message, "failed", backupPath);
  }
}

/** 名字在前，id 在后；内置 openai 没有名字，说明它是 Codex 内置的。不能选的写明原因。 */
function describeProvider(input: {
  provider: CodexSessionModelProvider;
  t: (key: string, options?: Record<string, string>) => string;
}): string | undefined {
  const { provider, t } = input;
  if (provider.unavailableReason) {
    return t("panels.sessionHistory.move.unavailableNoTable");
  }
  if (provider.source === "builtin") return t("panels.sessionHistory.move.sourceBuiltin");
  return provider.name ? provider.id : undefined;
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
  },
  results: {
    gap: theme.spacing[2],
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  resultIcon: {
    paddingTop: theme.spacing[1],
  },
  resultBody: {
    flex: 1,
    minWidth: 0,
  },
  actions: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
