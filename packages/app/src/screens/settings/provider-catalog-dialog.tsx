import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { ProviderCatalogList } from "@/components/provider-catalog-list";
import { Alert } from "@/components/ui/alert";
import {
  buildAcpProviderConfigPatch,
  type AcpProviderCatalogItem,
} from "@/hooks/use-acp-provider-catalog";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";

export interface ProviderCatalogDialogProps {
  serverId: string;
  visible: boolean;
  onClose: () => void;
  // 配置已写入即添加成功；快照刷新已尝试过，新提供方通常已经在列表里。
  onAdded: (providerId: string) => void;
}

type AddState =
  | { status: "idle" }
  | { status: "adding"; providerId: string }
  | { status: "failed"; message: string };

type AddAction =
  | { type: "started"; providerId: string }
  | { type: "failed"; message: string }
  | { type: "reset" };

const IDLE: AddState = { status: "idle" };

function addReducer(_state: AddState, action: AddAction): AddState {
  switch (action.type) {
    case "started":
      return { status: "adding", providerId: action.providerId };
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
  const { refresh } = useProvidersSnapshot(serverId);
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

  const handleInstall = useCallback(
    async (entry: AcpProviderCatalogItem) => {
      if (attemptRef.current) return;
      const attempt = new AbortController();
      attemptRef.current = attempt;
      dispatch({ type: "started", providerId: entry.id });
      try {
        await patchConfig(buildAcpProviderConfigPatch(entry));
      } catch (error) {
        if (attempt.signal.aborted) return;
        attemptRef.current = null;
        dispatch({
          type: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      // 先等快照带上新提供方再导航，否则地址修正会把它当成不存在的提供方。配置已经写入，
      // 刷新失败也不算添加失败：daemon 的快照推送随后会把它补进列表。
      await refresh([entry.id]).catch(() => undefined);
      if (attempt.signal.aborted) return;
      attemptRef.current = null;
      setQuery("");
      dispatch({ type: "reset" });
      onAdded(entry.id);
    },
    [onAdded, patchConfig, refresh],
  );

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
      <ProviderCatalogList
        serverId={serverId}
        query={query}
        installingProviderId={addState.status === "adding" ? addState.providerId : null}
        onInstall={handleInstall}
      />
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  error: {
    marginBottom: theme.spacing[3],
  },
}));
