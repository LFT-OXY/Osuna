import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { ApiEndpoint, ApiEndpointError } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { confirmDialog, type ConfirmDialogInput } from "@/utils/confirm-dialog";
import type { ApiEndpointSaveRequestInput, ApiEndpointSaveResult } from "./internal/form-model";
import {
  apiEndpointErrorMessageKey,
  selectApiEndpointsState,
  type ApiEndpointsLoadState,
} from "./internal/section-state";

export function apiEndpointsQueryKey(serverId: string, provider: string) {
  return ["api-endpoints", serverId, provider] as const;
}

export interface UseApiEndpointsResult {
  state: ApiEndpointsLoadState;
  busy: boolean;
  // 切换或删除失败的原因；留在模式区里，直到用户关掉或下一次操作。
  actionError: string | null;
  dismissActionError: () => void;
  activate: (endpoint: ApiEndpoint | null) => void;
  remove: (endpoint: ApiEndpoint) => void;
  save: (request: ApiEndpointSaveRequestInput) => Promise<ApiEndpointSaveResult>;
}

interface ActionOutcome {
  error: ApiEndpointError | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 调用方已经确认主机声明了 apiEndpoints 能力、provider 受支持。
 * 切换和删除都先确认：启用会改写 CLI 自身的配置文件，终端里的 CLI 也跟着变。
 */
export function useApiEndpoints(input: {
  serverId: string;
  provider: string;
  providerLabel: string;
}): UseApiEndpointsResult {
  const { serverId, provider, providerLabel } = input;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const queryKey = useMemo(() => apiEndpointsQueryKey(serverId, provider), [serverId, provider]);

  const query = useFetchQuery({
    queryKey,
    dataShape: "value",
    staleTimeMs: 0,
    enabled: Boolean(client) && isConnected,
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.apiEndpointList(provider);
    },
  });
  const state = selectApiEndpointsState({ data: query.data, error: query.error });

  const describeError = useCallback(
    (error: ApiEndpointError): string => {
      const key = apiEndpointErrorMessageKey(error);
      return key ? `${t(key, { provider: providerLabel })}\n${error.message}` : error.message;
    },
    [providerLabel, t],
  );

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey],
  );

  const confirmAndRun = useCallback(
    async (confirm: ConfirmDialogInput, run: () => Promise<ActionOutcome>) => {
      if (!(await confirmDialog(confirm))) return;
      setBusy(true);
      setActionError(null);
      try {
        const { error } = await run();
        if (error) setActionError(describeError(error));
      } catch (error) {
        setActionError(errorText(error));
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [describeError, refresh],
  );

  const activate = useCallback(
    (endpoint: ApiEndpoint | null) => {
      if (!client) return;
      const title = endpoint
        ? t("settings.providers.apiEndpoints.switchTitle", {
            provider: providerLabel,
            name: endpoint.name,
          })
        : t("settings.providers.apiEndpoints.switchOfficialTitle", { provider: providerLabel });
      void confirmAndRun(
        {
          title,
          message: t("settings.providers.apiEndpoints.switchMessage", { provider: providerLabel }),
          confirmLabel: t("settings.providers.apiEndpoints.switchConfirm"),
          cancelLabel: t("common.actions.cancel"),
        },
        () => client.apiEndpointSetActive(provider, endpoint?.id ?? null),
      );
    },
    [client, confirmAndRun, provider, providerLabel, t],
  );

  const remove = useCallback(
    (endpoint: ApiEndpoint) => {
      if (!client) return;
      const isActive = state.status === "ready" && state.activeEndpointId === endpoint.id;
      const message = isActive
        ? t("settings.providers.apiEndpoints.deleteActiveMessage", { provider: providerLabel })
        : t("settings.providers.apiEndpoints.deleteMessage");
      void confirmAndRun(
        {
          title: t("settings.providers.apiEndpoints.deleteTitle", { name: endpoint.name }),
          message,
          confirmLabel: t("settings.providers.apiEndpoints.delete"),
          cancelLabel: t("common.actions.cancel"),
          destructive: true,
        },
        () => client.apiEndpointDelete(provider, endpoint.id),
      );
    },
    [client, confirmAndRun, provider, providerLabel, state, t],
  );

  const save = useCallback(
    async (request: ApiEndpointSaveRequestInput): Promise<ApiEndpointSaveResult> => {
      if (!client) return { ok: false, message: t("workspace.terminal.hostDisconnected") };
      try {
        const result = await client.apiEndpointSave(request);
        if (result.error) return { ok: false, message: describeError(result.error) };
        return { ok: true };
      } catch (error) {
        return { ok: false, message: errorText(error) };
      } finally {
        await refresh();
      }
    },
    [client, describeError, refresh, t],
  );

  const dismissActionError = useCallback(() => setActionError(null), []);

  return { state, busy, actionError, dismissActionError, activate, remove, save };
}
