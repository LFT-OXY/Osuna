import { useCallback, useMemo, useState } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import { DaemonRpcError } from "@getpaseo/client/internal/daemon-client";
import { CODEX_MODEL_PROVIDER_MISSING_ERROR_CODE } from "@getpaseo/protocol/codex-session/rpc-schemas";
import { FOOTER_HEIGHT } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  MoveCodexConversationSheet,
  type MoveCodexConversationsOutcome,
  type MoveCodexConversationsTarget,
} from "@/session-history/view";
import { useSessionStore } from "@/stores/session-store";
import { KeyboardTranslateView } from "@/keyboard/shift";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/styles/theme";
import { toErrorMessage } from "@/utils/error-messages";

interface ArchivedAgentCalloutProps {
  serverId: string;
  agentId: string;
}

export function ArchivedAgentCallout({ serverId, agentId }: ArchivedAgentCalloutProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const toast = useToast();
  // COMPAT(apiEndpointCliWiring): added in v0.17.0, remove gate after 2027-04-18.
  const canMoveCodexConversations = useHostFeature(serverId, "apiEndpointCliWiring");
  const agent = useSessionStore(
    useShallow((state) => {
      const session = state.sessions[serverId];
      const found = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
      return {
        provider: found?.provider ?? null,
        threadId: found?.persistence?.sessionId ?? null,
        title: found?.title ?? null,
      };
    }),
  );
  const [isUnarchiving, setIsUnarchiving] = useState(false);
  const errorKey = unarchiveErrorKey({ serverId, agentId });
  const unarchiveError = useUnarchiveErrorStore((state) => state.byKey[errorKey] ?? null);
  const setUnarchiveError = useCallback(
    (error: UnarchiveError | null) => setUnarchiveErrorFor({ key: errorKey, error }),
    [errorKey],
  );
  const [isMoveOpen, setIsMoveOpen] = useState(false);

  const handleUnarchive = useCallback(async () => {
    if (!client || !isConnected || isUnarchiving) return;
    setIsUnarchiving(true);
    setUnarchiveError(null);
    try {
      await client.refreshAgent(agentId);
      setUnarchiveError(null);
    } catch (error) {
      setUnarchiveError(toUnarchiveError(error));
      setIsUnarchiving(false);
    }
  }, [client, isConnected, isUnarchiving, agentId, setUnarchiveError]);

  const movingConversation = useMemo<MoveCodexConversationsTarget | null>(() => {
    if (!agent.provider || !agent.threadId) return null;
    return {
      serverId,
      providerId: agent.provider,
      // daemon 只给原因码，不说是哪个 Codex 服务商：对话框按「不知道原来的服务商」说明。
      threads: [{ threadId: agent.threadId, title: agent.title ?? agent.threadId, from: null }],
    };
  }, [agent.provider, agent.threadId, agent.title, serverId]);
  const isModelProviderMissing = unarchiveError?.kind === "codex_model_provider_missing";
  const hasConversation = movingConversation !== null;
  const canOfferMove = isModelProviderMissing && canMoveCodexConversations && hasConversation;
  const handleOpenMove = useCallback(() => setIsMoveOpen(true), []);
  const handleCloseMove = useCallback(() => setIsMoveOpen(false), []);
  const handleMoved = useCallback(
    (outcome: MoveCodexConversationsOutcome) => {
      if (!outcome.isComplete) return;
      setIsMoveOpen(false);
      // 挪好了，再取消归档就能续上；旧的错误不再成立。
      setUnarchiveError(null);
      toast.show(t("panels.sessionHistory.move.moved", { to: outcome.to }), {
        variant: "success",
      });
    },
    [setUnarchiveError, t, toast],
  );

  return (
    <KeyboardTranslateView style={styles.container}>
      <View style={styles.inputAreaContainer}>
        <View style={styles.inputAreaContent}>
          <View style={styles.calloutStack}>
            <View style={styles.callout}>
              <Text style={styles.calloutText}>{t("agentPanel.archived.callout")}</Text>
              <Button
                size="sm"
                variant="secondary"
                onPress={handleUnarchive}
                disabled={!isConnected || isUnarchiving}
              >
                {t("agentPanel.archived.unarchive")}
              </Button>
            </View>
            {unarchiveError ? (
              <View style={styles.errorStack} testID="agent-unarchive-error">
                <Text style={styles.errorText}>
                  {isModelProviderMissing
                    ? t("agentPanel.archived.codexModelProviderMissing")
                    : unarchiveError.message}
                </Text>
                {canOfferMove ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onPress={handleOpenMove}
                    testID="agent-unarchive-error-move"
                  >
                    {t("panels.sessionHistory.move.action")}
                  </Button>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </View>
      {isMoveOpen && client && movingConversation ? (
        <MoveCodexConversationSheet
          client={client}
          conversations={movingConversation}
          onClose={handleCloseMove}
          onMoved={handleMoved}
        />
      ) : null}
    </KeyboardTranslateView>
  );
}

/*
 * 上一次取消归档的失败，按主机与 Agent 分键放在 store 里：daemon 先取消归档、续不上再放回归档，
 * 这个提示会被卸载又挂上，放在组件状态里的错误会丢。
 */
const useUnarchiveErrorStore = create<{ byKey: Record<string, UnarchiveError> }>()(() => ({
  byKey: {},
}));

function unarchiveErrorKey(input: { serverId: string; agentId: string }): string {
  return `${input.serverId}\u0000${input.agentId}`;
}

function setUnarchiveErrorFor(input: { key: string; error: UnarchiveError | null }): void {
  useUnarchiveErrorStore.setState((current) => {
    const byKey = { ...current.byKey };
    if (input.error) {
      byKey[input.key] = input.error;
    } else {
      delete byKey[input.key];
    }
    return { byKey };
  });
}

/** 取消归档失败：Codex 服务商不在了单独认出来（按 daemon 的原因码），其余照原文显示。 */
type UnarchiveError =
  | { kind: "codex_model_provider_missing"; message: string }
  | { kind: "other"; message: string };

function toUnarchiveError(error: unknown): UnarchiveError {
  const isModelProviderMissing =
    error instanceof DaemonRpcError && error.code === CODEX_MODEL_PROVIDER_MISSING_ERROR_CODE;
  const message = toErrorMessage(error);
  return isModelProviderMissing
    ? { kind: "codex_model_provider_missing", message }
    : { kind: "other", message };
}

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    flexDirection: "column",
    position: "relative",
  },
  inputAreaContainer: {
    position: "relative",
    minHeight: FOOTER_HEIGHT,
    marginHorizontal: "auto",
    alignItems: "center",
    width: "100%",
    overflow: "visible",
    padding: theme.spacing[4],
  },
  inputAreaContent: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
  },
  callout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius["2xl"],
    paddingVertical: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
    paddingHorizontal: {
      xs: theme.spacing[4],
      md: theme.spacing[6],
    },
  },
  calloutStack: {
    gap: theme.spacing[2],
  },
  calloutText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorStack: {
    alignItems: "center",
    gap: theme.spacing[2],
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
})) as unknown as Record<string, object>;
