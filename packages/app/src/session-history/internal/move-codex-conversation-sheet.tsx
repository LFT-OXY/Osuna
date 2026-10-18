import React, { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  CodexSessionModelProvider,
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

export type MoveCodexConversationClient = Pick<
  DaemonClient,
  "codexSessionListModelProviders" | "codexSessionMoveModelProvider"
>;

/** 要挪的那段对话：会话历史的一行。 */
export interface MoveCodexConversationTarget {
  serverId: string;
  /** 会话历史列出它的提供方（codex 或派生自它的自定义提供方）：daemon 在它的 CODEX_HOME 里挪。 */
  providerId: string;
  threadId: string;
  /** 它现在记在哪个 Codex 服务商名下。 */
  from: string;
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

/**
 * 「挪到另一个 Codex 服务商」对话框（ADR 0011）：选目标，说明会先备份、挪回即撤销；
 * 挪动中按钮显示进行中，成功交给调用方关掉并提示，跳过与失败留在框里说明原因。
 */
export function MoveCodexConversationSheet({
  client,
  conversation,
  onClose,
  onMoved,
}: {
  client: MoveCodexConversationClient;
  conversation: MoveCodexConversationTarget;
  onClose: () => void;
  onMoved: (to: string) => void;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [selected, setSelected] = useState<{ id: string; display: SelectFieldDisplay } | null>(
    null,
  );
  const providersQuery = useFetchQuery({
    queryKey: ["codex-session-model-providers", conversation.serverId, conversation.providerId],
    dataShape: "list",
    staleTimeMs: 0,
    retry: false,
    queryFn: async () => {
      const payload = await client.codexSessionListModelProviders(conversation.providerId);
      if (payload.error) throw new Error(payload.error.message);
      return payload.modelProviders;
    },
  });
  const moveMutation = useMutation({
    mutationFn: async (to: string) => {
      const payload = await client.codexSessionMoveModelProvider({
        providerId: conversation.providerId,
        threadIds: [conversation.threadId],
        to,
      });
      if (payload.error) throw new MoveNotDoneError(payload.error.message, "failed", null);
      const skip = payload.skipped[0];
      if (skip) throw notDoneError({ skip, t });
      return to;
    },
    onSuccess: onMoved,
  });

  const targets = useMemo(() => {
    const others = (providersQuery.data ?? []).filter((p) => p.id !== conversation.from);
    // 不能选的放最后：下拉打开时第一行是高亮的，不该落在一个点不了的选项上。
    return [
      ...others.filter((p) => !p.unavailableReason),
      ...others.filter((p) => p.unavailableReason),
    ];
  }, [conversation.from, providersQuery.data]);
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
    () => ({ title: t("panels.sessionHistory.move.title") }),
    [t],
  );
  const footer = useMemo(
    () => (
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
          onPress={handleMove}
          disabled={!selectedId || isMoving}
          testID="move-codex-conversation-confirm"
        >
          {isMoving
            ? t("panels.sessionHistory.move.moving")
            : t("panels.sessionHistory.move.confirm")}
        </Button>
      </View>
    ),
    [handleMove, isMoving, onClose, selectedId, t],
  );

  const moveError = moveMutation.error;
  const notDone = moveError instanceof MoveNotDoneError ? moveError : null;
  const errorTitle =
    notDone?.kind === "partly"
      ? t("panels.sessionHistory.move.movedPartly")
      : t("panels.sessionHistory.move.notMoved");
  const errorVariant = notDone?.kind === "failed" || !notDone ? "error" : "warning";
  const errorBackup = notDone?.backupPath
    ? `\n${t("panels.sessionHistory.move.backupAt", { path: notDone.backupPath })}`
    : "";

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
          disabled={isMoving}
          size={isCompact ? "md" : "sm"}
          testID="move-codex-conversation-target"
          triggerTestID="move-codex-conversation-target-trigger"
        />
        <Text
          variant="caption"
          color="foregroundMuted"
          testID="move-codex-conversation-backup-note"
        >
          {t("panels.sessionHistory.move.backupNote", { from: conversation.from })}
        </Text>
        <Text variant="caption" color="foregroundMuted">
          {t("panels.sessionHistory.move.rebuildNote", { from: conversation.from })}
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
        {moveError ? (
          <Alert
            size="sm"
            variant={errorVariant}
            title={errorTitle}
            description={`${moveError.message}${errorBackup}`}
            testID="move-codex-conversation-error"
          />
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
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
  actions: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
