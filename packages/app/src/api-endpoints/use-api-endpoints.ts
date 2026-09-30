import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  apiEndpointProtocolName,
  type ApiEndpoint,
  type ApiEndpointError,
  type ApiEndpointListResponse,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { confirmDialog, type ConfirmDialogInput } from "@/utils/confirm-dialog";
import type {
  ApiEndpointFetchModelsRequestInput,
  ApiEndpointFetchModelsResult,
  ApiEndpointSaveRequestInput,
  ApiEndpointSaveResult,
  ApiEndpointTestConnectionOutcome,
  ApiEndpointTestConnectionRequestInput,
} from "./internal/form-model";
import {
  apiEndpointErrorMessageKey,
  isActiveApiEndpoint,
  selectApiEndpointImpact,
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
  // 「已被外部修改」时按当前接口重新写入；切回官方用 activate(null)。
  reapply: (endpoint: ApiEndpoint) => void;
  remove: (endpoint: ApiEndpoint) => void;
  save: (request: ApiEndpointSaveRequestInput) => Promise<ApiEndpointSaveResult>;
  fetchModels: (
    request: ApiEndpointFetchModelsRequestInput,
    signal: AbortSignal,
  ) => Promise<ApiEndpointFetchModelsResult>;
  testConnection: (
    request: ApiEndpointTestConnectionRequestInput,
    signal: AbortSignal,
  ) => Promise<ApiEndpointTestConnectionOutcome>;
}

interface ActionOutcome {
  error: ApiEndpointError | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let upstreamRequestCounter = 0;

// 自己生成 requestId，取消时才知道要取消哪一条。
function createUpstreamRequestId(): string {
  upstreamRequestCounter += 1;
  return `api-endpoint-upstream-${Date.now().toString(36)}-${upstreamRequestCounter}`;
}

/**
 * 调用方已经确认主机声明了 apiEndpoints 能力、provider 受支持。
 * 切换、删除、保存启用中的接口都先确认：会改写 CLI 自身的配置文件，正在运行的会话和终端里的 CLI 也跟着变。
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
      if (!key) return error.message;
      const text = t(key, { provider: providerLabel, protocol: apiEndpointProtocolName(provider) });
      return `${text}\n${error.message}`;
    },
    [provider, providerLabel, t],
  );

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey],
  );

  /** 弹确认框前现取列表：是否启用中、会话数都以它为准，渲染时的列表可能是很久以前加载的。 */
  const loadLatestState = useCallback(async (): Promise<ApiEndpointsLoadState> => {
    await refresh();
    return selectApiEndpointsState({
      data: queryClient.getQueryData<ApiEndpointListResponse["payload"]>(queryKey),
      error: null,
    });
  }, [queryClient, queryKey, refresh]);

  /** 改写 CLI 配置前的确认：在说明后面写明受影响的会话数，以及终端里的 CLI 也会切换。 */
  const confirmRewrite = useCallback(
    (confirm: ConfirmDialogInput, latest: ApiEndpointsLoadState): Promise<boolean> => {
      const runningSessionCount = latest.status === "ready" ? latest.runningSessionCount : null;
      const impactLines = selectApiEndpointImpact({ provider, runningSessionCount }).map(
        ({ key, count }) => t(key, { provider: providerLabel, count }),
      );
      const message = `${confirm.message}\n\n${impactLines.join("\n")}`;
      return confirmDialog({ ...confirm, message });
    },
    [provider, providerLabel, t],
  );

  const confirmAndRun = useCallback(
    async (confirm: () => Promise<boolean>, run: () => Promise<ActionOutcome>) => {
      if (!(await confirm())) return;
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
      const confirm: ConfirmDialogInput = {
        title,
        message: t("settings.providers.apiEndpoints.switchMessage", { provider: providerLabel }),
        confirmLabel: t("settings.providers.apiEndpoints.switchConfirm"),
        cancelLabel: t("common.actions.cancel"),
      };
      void confirmAndRun(
        async () => confirmRewrite(confirm, await loadLatestState()),
        () => client.apiEndpointSetActive(provider, endpoint?.id ?? null),
      );
    },
    [client, confirmAndRun, confirmRewrite, loadLatestState, provider, providerLabel, t],
  );

  const reapply = useCallback(
    (endpoint: ApiEndpoint) => {
      if (!client) return;
      const confirm: ConfirmDialogInput = {
        title: t("settings.providers.apiEndpoints.health.reapplyTitle", {
          provider: providerLabel,
          name: endpoint.name,
        }),
        message: t("settings.providers.apiEndpoints.health.reapplyMessage", {
          provider: providerLabel,
        }),
        confirmLabel: t("settings.providers.apiEndpoints.health.reapply"),
        cancelLabel: t("common.actions.cancel"),
      };
      void confirmAndRun(
        async () => confirmRewrite(confirm, await loadLatestState()),
        // 重新应用就是再启用一次当前接口，同样经过写入时的冲突保护。
        () => client.apiEndpointSetActive(provider, endpoint.id),
      );
    },
    [client, confirmAndRun, confirmRewrite, loadLatestState, provider, providerLabel, t],
  );

  const remove = useCallback(
    (endpoint: ApiEndpoint) => {
      if (!client) return;
      const title = t("settings.providers.apiEndpoints.deleteTitle", { name: endpoint.name });
      const confirmLabel = t("settings.providers.apiEndpoints.delete");
      const cancelLabel = t("common.actions.cancel");
      // 删除启用中的接口会先切回官方，和切换一样写明影响；其余只是删掉一条记录。
      async function confirmDelete(): Promise<boolean> {
        const latest = await loadLatestState();
        if (!isActiveApiEndpoint(latest, endpoint.id)) {
          const message = t("settings.providers.apiEndpoints.deleteMessage");
          return confirmDialog({ title, message, confirmLabel, cancelLabel, destructive: true });
        }
        const message = t("settings.providers.apiEndpoints.deleteActiveMessage", {
          provider: providerLabel,
        });
        const confirm = { title, message, confirmLabel, cancelLabel, destructive: true };
        return confirmRewrite(confirm, latest);
      }
      void confirmAndRun(confirmDelete, () => client.apiEndpointDelete(provider, endpoint.id));
    },
    [client, confirmAndRun, confirmRewrite, loadLatestState, provider, providerLabel, t],
  );

  const save = useCallback(
    async (request: ApiEndpointSaveRequestInput): Promise<ApiEndpointSaveResult> => {
      if (!client) return { status: "failed", message: t("workspace.terminal.hostDisconnected") };
      // 保存启用中的接口会立即按新配置重写 CLI 配置，和切换一样先确认。
      const latest = await loadLatestState();
      if (isActiveApiEndpoint(latest, request.endpointId)) {
        const confirm: ConfirmDialogInput = {
          title: t("settings.providers.apiEndpoints.saveActiveTitle", { name: request.name }),
          message: t("settings.providers.apiEndpoints.saveActiveMessage", {
            provider: providerLabel,
          }),
          confirmLabel: t("settings.providers.apiEndpoints.saveActiveConfirm"),
          cancelLabel: t("common.actions.cancel"),
        };
        if (!(await confirmRewrite(confirm, latest))) return { status: "cancelled" };
      }
      try {
        const result = await client.apiEndpointSave(request);
        if (result.error) return { status: "failed", message: describeError(result.error) };
        return { status: "saved" };
      } catch (error) {
        return { status: "failed", message: errorText(error) };
      } finally {
        await refresh();
      }
    },
    [client, confirmRewrite, describeError, loadLatestState, providerLabel, refresh, t],
  );

  const fetchModels = useCallback(
    async (
      request: ApiEndpointFetchModelsRequestInput,
      signal: AbortSignal,
    ): Promise<ApiEndpointFetchModelsResult> => {
      if (!client) return { status: "failed", message: t("workspace.terminal.hostDisconnected") };
      const requestId = createUpstreamRequestId();
      const unlink = linkAbortToCancel(signal, () => client.apiEndpointCancel(requestId));
      try {
        const result = await client.apiEndpointFetchModels(request, requestId);
        if (signal.aborted || result.error?.code === "cancelled") return { status: "cancelled" };
        if (result.error) return { status: "failed", message: describeError(result.error) };
        return { status: "ok", models: result.models };
      } catch (error) {
        if (signal.aborted) return { status: "cancelled" };
        return { status: "failed", message: errorText(error) };
      } finally {
        unlink();
      }
    },
    [client, describeError, t],
  );

  const testConnection = useCallback(
    async (
      request: ApiEndpointTestConnectionRequestInput,
      signal: AbortSignal,
    ): Promise<ApiEndpointTestConnectionOutcome> => {
      if (!client) return { status: "failed", message: t("workspace.terminal.hostDisconnected") };
      const requestId = createUpstreamRequestId();
      const unlink = linkAbortToCancel(signal, () => client.apiEndpointCancel(requestId));
      try {
        const response = await client.apiEndpointTestConnection(request, requestId);
        if (signal.aborted || response.error?.code === "cancelled") return { status: "cancelled" };
        if (response.error) return { status: "failed", message: describeError(response.error) };
        if (!response.result) throw new Error("The host returned neither a result nor an error");
        const upstreamError = response.result.error;
        // 上游侧的失败同样按错误码换成本地化文案，后面接 daemon 原文。
        return {
          status: "done",
          result: {
            ...response.result,
            error: upstreamError
              ? { code: upstreamError.code, message: describeError(upstreamError) }
              : null,
          },
        };
      } catch (error) {
        if (signal.aborted) return { status: "cancelled" };
        return { status: "failed", message: errorText(error) };
      } finally {
        unlink();
      }
    },
    [client, describeError, t],
  );

  const dismissActionError = useCallback(() => setActionError(null), []);

  return {
    state,
    busy,
    actionError,
    dismissActionError,
    activate,
    reapply,
    remove,
    save,
    fetchModels,
    testConnection,
  };
}

/** 调用方取消时通知 daemon 取消对应的上游请求；返回解除监听的函数。 */
function linkAbortToCancel(signal: AbortSignal, cancel: () => Promise<unknown>): () => void {
  // 取消只是尽力而为：连接已断时 daemon 那边也会随连接一起取消。
  const onAbort = () => void cancel().catch(() => undefined);
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}
