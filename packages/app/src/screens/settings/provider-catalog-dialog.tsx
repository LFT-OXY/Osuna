import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { ProviderCatalogList } from "@/components/provider-catalog-list";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import {
  buildAcpProviderConfigPatch,
  type AcpProviderCatalogItem,
} from "@/hooks/use-acp-provider-catalog";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { ProviderNotEnabledSection, type NotEnabledItem } from "./provider-not-enabled-section";

export interface ProviderCatalogDialogProps {
  serverId: string;
  visible: boolean;
  onClose: () => void;
  // 配置已写入即成功：从"未启用"组启用了一项，或从 ACP 目录添加了新提供方。
  onAdded: (providerId: string) => void;
}

type AddState =
  | { status: "idle" }
  | { status: "adding"; providerId: string; configWritten: boolean }
  | { status: "failed"; message: string };

type AddAction =
  | { type: "started"; providerId: string }
  | { type: "configWritten" }
  | { type: "failed"; message: string }
  | { type: "reset" };

const IDLE: AddState = { status: "idle" };

function addReducer(state: AddState, action: AddAction): AddState {
  switch (action.type) {
    case "started":
      return { status: "adding", providerId: action.providerId, configWritten: false };
    case "configWritten":
      return state.status === "adding" ? { ...state, configWritten: true } : state;
    case "failed":
      return { status: "failed", message: action.message };
    case "reset":
      return IDLE;
  }
}

export function ProviderCatalogDialog({
  serverId,
  visible,
  onClose,
  onAdded,
}: ProviderCatalogDialogProps) {
  const { t } = useTranslation();
  const { entries, refresh } = useProvidersSnapshot(serverId);
  const { patchConfig } = useDaemonConfig(serverId);
  const [query, setQuery] = useState("");
  const [addState, dispatch] = useReducer(addReducer, IDLE);
  // 关掉弹窗就放弃这次添加的结果：不再导航，也不把错误留给下次打开。
  const attemptRef = useRef<AbortController | null>(null);

  const handleClose = useCallback(() => {
    attemptRef.current?.abort();
    attemptRef.current = null;
    setQuery("");
    dispatch({ type: "reset" });
    onClose();
  }, [onClose]);

  const finishAttempt = useCallback(
    (attempt: AbortController, providerId: string) => {
      if (attempt.signal.aborted || attemptRef.current !== attempt) return;
      attemptRef.current = null;
      setQuery("");
      dispatch({ type: "reset" });
      onAdded(providerId);
    },
    [onAdded],
  );

  // 写入配置；成功后等快照里有这个提供方再导航（见下方 effect），失败把错误留在弹窗里。
  // 返回 null 表示这次不再继续：已有进行中的尝试、写入失败，或弹窗已关闭。
  const writeConfig = useCallback(
    async (providerId: string, write: () => Promise<unknown>): Promise<AbortController | null> => {
      if (attemptRef.current) return null;
      const attempt = new AbortController();
      attemptRef.current = attempt;
      dispatch({ type: "started", providerId });
      try {
        await write();
      } catch (error) {
        if (attempt.signal.aborted) return null;
        attemptRef.current = null;
        dispatch({
          type: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
      if (attempt.signal.aborted) return null;
      dispatch({ type: "configWritten" });
      return attempt;
    },
    [],
  );

  const handleInstall = useCallback(
    async (entry: AcpProviderCatalogItem) => {
      const attempt = await writeConfig(entry.id, () =>
        patchConfig(buildAcpProviderConfigPatch(entry)),
      );
      if (!attempt) return;
      // 快照带上新提供方就导航，否则地址修正会把它当成不存在的提供方。
      // daemon 提交配置时已把它以 loading 推进快照并在后台探测，不等刷新：未安装的 CLI
      // 可能探测很久。刷新只作兜底，结束或失败都算添加成功——配置已经写入。
      void refresh([entry.id])
        .catch(() => undefined)
        .then(() => finishAttempt(attempt, entry.id));
    },
    [finishAttempt, patchConfig, refresh, writeConfig],
  );

  // "未启用"里的提供方已在快照里，配置一写入 effect 就导航。
  // 启用了但没装的无需再写 enabled，直接进详情页看安装指引。
  const handleOpenNotEnabled = useCallback(
    ({ entry, mark }: NotEnabledItem) => {
      const providerId = entry.provider;
      if (mark === "notInstalled") {
        void writeConfig(providerId, () => Promise.resolve());
        return;
      }
      void writeConfig(providerId, () =>
        patchConfig({ providers: { [providerId]: { enabled: true } } }),
      );
    },
    [patchConfig, writeConfig],
  );

  const awaitingProviderId =
    addState.status === "adding" && addState.configWritten ? addState.providerId : null;
  const isAwaitedProviderInSnapshot =
    awaitingProviderId !== null &&
    (entries?.some((candidate) => candidate.provider === awaitingProviderId) ?? false);
  useEffect(() => {
    const attempt = attemptRef.current;
    if (!isAwaitedProviderInSnapshot || !awaitingProviderId || !attempt) return;
    finishAttempt(attempt, awaitingProviderId);
  }, [awaitingProviderId, finishAttempt, isAwaitedProviderInSnapshot]);

  const pendingProviderId = addState.status === "adding" ? addState.providerId : null;

  // resetKey 随打开 / 关闭变化，清空头部不受控的搜索框，与 query 保持一致。
  const header = useMemo<SheetHeader>(
    () => ({
      title: t("providerCatalog.title"),
      search: {
        onChange: setQuery,
        resetKey: Number(visible),
        placeholder: t("providerCatalog.search"),
        testID: "provider-catalog-search",
      },
    }),
    [t, visible],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      testID="provider-catalog-dialog"
    >
      {addState.status === "failed" ? (
        <View style={styles.error}>
          <Alert
            variant="error"
            title={t("settings.providers.addErrorTitle")}
            description={addState.message}
            testID="provider-catalog-error"
          />
        </View>
      ) : null}
      <ProviderNotEnabledSection
        serverId={serverId}
        query={query}
        openingProviderId={pendingProviderId}
        onOpen={handleOpenNotEnabled}
      />
      <SettingsSection
        title={t("providerCatalog.groups.acpCatalog")}
        flush
        testID="provider-catalog-acp"
      >
        <ProviderCatalogList
          serverId={serverId}
          query={query}
          installingProviderId={pendingProviderId}
          onInstall={handleInstall}
        />
      </SettingsSection>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  error: {
    marginBottom: theme.spacing[3],
  },
}));
