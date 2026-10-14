import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ApiEndpoint,
  ApiEndpointListResponse,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { useFetchQuery } from "@/data/query";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import type {
  ConnectionDetectRequest,
  ConnectionDetectResult,
  ConnectionSaveRequest,
  ConnectionSaveResult,
} from "./internal/connection-form-model";
import {
  agentsReturningToOfficial,
  selectHostEndpointsState,
  type HostEndpointsLoadState,
} from "./internal/host-list";
import { createUpstreamRequestId, linkAbortToCancel } from "./internal/upstream-request";

// 接口是主机共用的，按哪个 provider 查列表都一样；和 Claude Code 页共用同一份缓存。
const LIST_PROVIDER = "claude";
// 冷却倒计时与中转站随时改的冷却状态靠它跟上；daemon 不推送接口变化。
const LIST_REFRESH_MS = 30_000;

export function hostEndpointsQueryKey(serverId: string) {
  return ["api-endpoints", serverId, LIST_PROVIDER] as const;
}

export interface UseHostEndpointsResult {
  state: HostEndpointsLoadState;
  // 正在切换开关或「立刻恢复」的那一家。
  pendingEndpointId: string | null;
  // 切换或恢复失败的原因；留在列表顶部，直到用户关掉或下一次操作。
  actionError: string | null;
  dismissActionError: () => void;
  setEnabled: (endpoint: ApiEndpoint, enabled: boolean) => void;
  resume: (endpoint: ApiEndpoint) => void;
  save: (request: ConnectionSaveRequest) => Promise<ConnectionSaveResult>;
  detect: (
    request: ConnectionDetectRequest,
    signal: AbortSignal,
  ) => Promise<ConnectionDetectResult>;
}

/** 调用方已经确认主机声明了 apiEndpointGateway 能力。 */
export function useHostEndpoints(serverId: string): UseHostEndpointsResult {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { entries: providerEntries } = useProvidersSnapshot(serverId);
  const [pendingEndpointId, setPendingEndpointId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const queryKey = useMemo(() => hostEndpointsQueryKey(serverId), [serverId]);

  const query = useFetchQuery({
    queryKey,
    dataShape: "value",
    staleTimeMs: 0,
    enabled: Boolean(client) && isConnected,
    retry: false,
    refetchInterval: LIST_REFRESH_MS,
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.apiEndpointList(LIST_PROVIDER);
    },
  });
  const state = selectHostEndpointsState({ data: query.data, error: query.error });

  // 两个 Agent 页的列表也读接口；任何改动之后一起刷新。
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["api-endpoints", serverId] }),
    [queryClient, serverId],
  );

  /** 确认前现取列表：渲染时的列表可能是很久以前加载的。 */
  const confirmSwitchOff = useCallback(
    async (endpoint: ApiEndpoint): Promise<boolean> => {
      await queryClient.invalidateQueries({ queryKey });
      const latest = selectHostEndpointsState({
        data: queryClient.getQueryData<ApiEndpointListResponse["payload"]>(queryKey),
        error: null,
      });
      if (latest.status !== "ready") return true;
      const providers = agentsReturningToOfficial({
        endpoints: latest.endpoints,
        agents: latest.agents,
        switchedOffId: endpoint.id,
      });
      if (providers.length === 0) return true;
      const lines = providers.map((provider) =>
        t("settings.apiEndpoints.switchOff.returnsToOfficial", {
          agent: resolveProviderLabel(provider, providerEntries),
        }),
      );
      return confirmDialog({
        title: t("settings.apiEndpoints.switchOff.title", { name: endpoint.name }),
        message: [...lines, t("settings.apiEndpoints.switchOff.message")].join("\n"),
        confirmLabel: t("settings.apiEndpoints.switchOff.confirm"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
    },
    [providerEntries, queryClient, queryKey, t],
  );

  const runStateChange = useCallback(
    async (endpoint: ApiEndpoint, change: { enabled?: boolean; clearCooldown?: boolean }) => {
      if (!client) return;
      setPendingEndpointId(endpoint.id);
      setActionError(null);
      try {
        const result = await client.apiEndpointSetEndpointState({
          endpointId: endpoint.id,
          ...change,
        });
        if (result.error) setActionError(result.error.message);
      } catch (error) {
        setActionError(toErrorMessage(error));
      } finally {
        await refresh();
        setPendingEndpointId(null);
      }
    },
    [client, refresh],
  );

  const setEnabled = useCallback(
    (endpoint: ApiEndpoint, enabled: boolean) => {
      void (async () => {
        if (!enabled && !(await confirmSwitchOff(endpoint))) return;
        await runStateChange(endpoint, { enabled });
      })();
    },
    [confirmSwitchOff, runStateChange],
  );

  const resume = useCallback(
    (endpoint: ApiEndpoint) => {
      void runStateChange(endpoint, { clearCooldown: true });
    },
    [runStateChange],
  );

  const save = useCallback(
    async (request: ConnectionSaveRequest): Promise<ConnectionSaveResult> => {
      if (!client) return { status: "failed", message: t("workspace.terminal.hostDisconnected") };
      try {
        const result = await client.apiEndpointSave({ provider: LIST_PROVIDER, ...request });
        if (result.error) return { status: "failed", message: result.error.message };
        if (!result.endpoint) throw new Error("The host returned neither an endpoint nor an error");
        return { status: "saved", endpointId: result.endpoint.id };
      } catch (error) {
        return { status: "failed", message: toErrorMessage(error) };
      } finally {
        await refresh();
      }
    },
    [client, refresh, t],
  );

  const detect = useCallback(
    async (
      request: ConnectionDetectRequest,
      signal: AbortSignal,
    ): Promise<ConnectionDetectResult> => {
      if (!client) return { status: "failed", message: t("workspace.terminal.hostDisconnected") };
      const requestId = createUpstreamRequestId();
      const unlink = linkAbortToCancel(signal, () => client.apiEndpointCancel(requestId));
      try {
        const response = await client.apiEndpointDetectFormats(request, requestId);
        if (signal.aborted || response.error?.code === "cancelled") return { status: "cancelled" };
        if (response.error) return { status: "failed", message: response.error.message };
        return { status: "done", results: response.results };
      } catch (error) {
        if (signal.aborted) return { status: "cancelled" };
        return { status: "failed", message: toErrorMessage(error) };
      } finally {
        unlink();
      }
    },
    [client, t],
  );

  const dismissActionError = useCallback(() => setActionError(null), []);

  return {
    state,
    pendingEndpointId,
    actionError,
    dismissActionError,
    setEnabled,
    resume,
    save,
    detect,
  };
}
