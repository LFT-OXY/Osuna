import React, { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { CodexSessionModelProvider } from "@getpaseo/protocol/codex-session/rpc-schemas";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
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
  threadId: string;
  /** 它现在记在哪个 Codex 服务商名下。 */
  from: string;
}

/** 没挪成：`skipped` 是 daemon 跳过了它（原因已翻译），`failed` 是请求或改写失败（daemon 原话）。 */
class MoveNotDoneError extends Error {
  constructor(
    message: string,
    readonly kind: "skipped" | "failed",
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
    queryKey: ["codex-session-model-providers", conversation.serverId],
    dataShape: "list",
    staleTimeMs: 0,
    retry: false,
    queryFn: async () => {
      const payload = await client.codexSessionListModelProviders();
      if (payload.error) throw new Error(payload.error.message);
      return payload.modelProviders;
    },
  });
  const moveMutation = useMutation({
    mutationFn: async (to: string) => {
      const payload = await client.codexSessionMoveModelProvider({
        threadIds: [conversation.threadId],
        to,
      });
      if (payload.error) throw new MoveNotDoneError(payload.error.message, "failed");
      const skip = payload.skipped[0];
      if (skip) throw skippedError({ reason: skip.reason, message: skip.message, t });
      return to;
    },
    onSuccess: onMoved,
  });

  const options = useMemo<SelectFieldOption<string>[]>(
    () =>
      (providersQuery.data ?? [])
        .filter((provider) => provider.id !== conversation.from)
        .map((provider) => ({
          id: provider.id,
          value: provider.id,
          label: provider.id,
          description: describeProvider({ provider, t }),
          testID: `move-codex-conversation-target-${provider.id}`,
        })),
    [conversation.from, providersQuery.data, t],
  );
  const handleChange = useCallback((id: string, display: SelectFieldDisplay) => {
    setSelected({ id, display });
  }, []);
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
  const isSkipped = moveError instanceof MoveNotDoneError && moveError.kind === "skipped";

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
            variant={isSkipped ? "warning" : "error"}
            title={t("panels.sessionHistory.move.notMoved")}
            description={moveError.message}
            testID="move-codex-conversation-error"
          />
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function skippedError(input: {
  reason: string;
  message: string;
  t: (key: string) => string;
}): MoveNotDoneError {
  const { reason, message, t } = input;
  if (reason === "active") {
    return new MoveNotDoneError(t("panels.sessionHistory.move.skippedActive"), "skipped");
  }
  if (reason === "not_found") {
    return new MoveNotDoneError(t("panels.sessionHistory.move.skippedNotFound"), "skipped");
  }
  return new MoveNotDoneError(message, "failed");
}

function describeProvider(input: {
  provider: CodexSessionModelProvider;
  t: (key: string) => string;
}): string | undefined {
  const { provider, t } = input;
  if (provider.source === "builtin") return t("panels.sessionHistory.move.sourceBuiltin");
  if (provider.source === "osuna") return t("panels.sessionHistory.move.sourceOsuna");
  return provider.name;
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
