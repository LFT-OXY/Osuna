import { Buffer } from "buffer";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ApiEndpoint,
  ApiEndpointConnection,
  ApiEndpointError,
  ApiEndpointListResponse,
  ApiEndpointSetAgentSettingsRequest,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { DaemonConnectionError, DaemonRpcError } from "@getpaseo/client/internal/daemon-client";
import { useToast } from "@/contexts/toast-context";
import { useFetchQuery } from "@/data/query";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { describeUnparsableFile } from "./config-unparsable-copy";
import type {
  ConnectionDetectRequest,
  ConnectionDetectResult,
  ConnectionFetchRequest,
  ConnectionFetchResult,
  ConnectionRevealKeyResult,
  ConnectionIconError,
  ConnectionIconResult,
  ConnectionSaveRequest,
  ConnectionSaveResult,
  ConnectionTestRequest,
  ConnectionTestResult,
} from "./internal/connection-form-model";
import { CONNECTION_ICON_ERROR_CODES } from "./internal/connection-form-model";
import {
  agentsReturningToOfficial,
  arrangeEndpoint,
  selectHostEndpointsState,
  type EndpointArrangement,
  type HostEndpointsLoadState,
} from "./internal/host-list";
import type { AgentIssueAction } from "./internal/agent-settings";
import type { LongConversationsChange } from "./internal/long-conversations-form";
import { createUpstreamRequestId, linkAbortToCancel } from "./internal/upstream-request";

// 接口是主机共用的，按哪个 provider 查列表都一样；和 Claude Code 页共用同一份缓存。
export const LIST_PROVIDER = "claude";
// 冷却倒计时与中转站随时改的冷却状态靠它跟上；daemon 不推送接口变化。
const LIST_REFRESH_MS = 30_000;

export function hostEndpointsQueryKey(serverId: string) {
  return ["api-endpoints", serverId, LIST_PROVIDER] as const;
}

/** 切换或改设置失败：主机给的错误码（本地失败时为 null）与给用户看的说明。 */
interface ActionFailure {
  code: string | null;
  message: string;
}

/**
 * 「使用第三方接口」总开关、默认模型、默认思考档位、Ultra Code、「保留 claude.ai 登录」、后台小任务、Subagent 与记忆模型、
 * 强制 Subagent 模型与「Codex Subagent 可用任意模型」的一次修改。
 */
export type AgentSettingsChange = Pick<
  ApiEndpointSetAgentSettingsRequest,
  | "enabled"
  | "defaultModelId"
  | "keepsClaudeAiLogin"
  | "defaultThinkingOptionId"
  | "usesUltraCode"
  | "backgroundModelId"
  | "subagentModelId"
  | "subagentThinkingOptionId"
  | "memoryModelId"
  | "forcedSubagentModelId"
  | "allowsAnySubagentModel"
>;

/** 打开总开关时主机挑默认模型的办法，给那个 Agent 的设置页说一句（ADR 0012）。 */
export interface AgentConnectionState {
  provider: string;
  connection: ApiEndpointConnection;
}

/** 提示区里正在做的处理，或做失败的那一次。 */
export interface AgentIssueActionState {
  provider: string;
  action: AgentIssueAction;
}

/** 提示区里直接发给主机的处理。 */
export type DirectIssueAction = Exclude<AgentIssueAction, "switchToOfficial">;

export interface UseHostEndpointsResult {
  state: HostEndpointsLoadState;
  // 正在切换开关或「立刻恢复」的那一家。
  pendingEndpointId: string | null;
  // 切换或恢复失败的原因；留在列表顶部，直到用户关掉或下一次操作。
  actionError: string | null;
  // actionError 来自主机拒绝时的错误码（如 config_unparsable）；断线等本地失败为 null。
  actionErrorCode: string | null;
  dismissActionError: () => void;
  setEnabled: (endpoint: ApiEndpoint, enabled: boolean) => void;
  resume: (endpoint: ApiEndpoint) => void;
  // 挪动接口顺序：列表先按新顺序排，保存失败时回到主机上的顺序，原因在 actionError 里。
  // 搜索时带上显示着的行，上移、下移与拖动只在它们之间挪。
  arrange: (arrangement: EndpointArrangement) => void;
  // 改整台主机的长对话设置；返回失败原因，成功为 null。只有声明了 apiEndpointManagement 的主机认。
  setLongConversations: (change: LongConversationsChange) => Promise<string | null>;
  // 换掉整台主机的已禁用的模型；返回失败原因，成功为 null。只有声明了 apiEndpointManagement 的主机认。
  setDisabledModels: (models: string[]) => Promise<string | null>;
  // 设接口名显示方式；返回失败原因，成功为 null。
  setEndpointNameDisplay: (display: string) => Promise<string | null>;
  // 正在改总开关或默认模型的 Agent。
  pendingAgent: string | null;
  // 改失败的原因在 actionError 里。
  setAgentSettings: (provider: string, settings: AgentSettingsChange) => void;
  // 上次打开总开关时默认模型是怎么挑的；下一次改设置时清掉。老主机不给。
  lastConnection: AgentConnectionState | null;
  // 提示区的处理：正在做的、失败的原因（留在提示区里，直到重试或关掉）。
  pendingIssueAction: AgentIssueActionState | null;
  issueActionError: (AgentIssueActionState & { message: string }) | null;
  // 「切回官方」不在这里：它先开关开关的确认框（switch-off-sheet.tsx），由框里关掉。
  runIssueAction: (provider: string, action: DirectIssueAction) => void;
  dismissIssueActionError: () => void;
  save: (request: ConnectionSaveRequest) => Promise<ConnectionSaveResult>;
  detect: (
    request: ConnectionDetectRequest,
    signal: AbortSignal,
  ) => Promise<ConnectionDetectResult>;
  // 读回已存 key 的原文；只有声明了 apiEndpointManagement 的主机认。
  revealKey: (endpointId: string) => Promise<ConnectionRevealKeyResult>;
  // 存一张图片给「自定义」接口当图标；只有声明了 apiEndpointManagement 的主机认。
  storeIcon: (bytes: Uint8Array) => Promise<ConnectionIconResult>;
  // 从地址所在网站取图标；同上。
  fetchSiteIcon: (input: { baseUrl: string; name: string }) => Promise<ConnectionIconResult>;
  // 添加窗口保存前拉模型、测试连接；只在声明了 apiEndpointManagement 的主机上用。
  fetchModels: (
    request: ConnectionFetchRequest,
    signal: AbortSignal,
  ) => Promise<ConnectionFetchResult>;
  testConnection: (
    request: ConnectionTestRequest,
    signal: AbortSignal,
  ) => Promise<ConnectionTestResult>;
}

/** 调用方已经确认主机声明了 apiEndpointGateway 能力。 */
export function useHostEndpoints(serverId: string): UseHostEndpointsResult {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { entries: providerEntries } = useProvidersSnapshot(serverId);
  const [pendingEndpointId, setPendingEndpointId] = useState<string | null>(null);
  const [pendingAgent, setPendingAgent] = useState<string | null>(null);
  const [actionFailure, setActionFailure] = useState<ActionFailure | null>(null);
  const [lastConnection, setLastConnection] = useState<AgentConnectionState | null>(null);
  const [pendingIssueAction, setPendingIssueAction] = useState<AgentIssueActionState | null>(null);
  const [issueActionError, setIssueActionError] =
    useState<UseHostEndpointsResult["issueActionError"]>(null);
  const queryKey = useMemo(() => hostEndpointsQueryKey(serverId), [serverId]);
  // 读不懂的配置文件用界面语言说明原因；其余照主机原文。
  const describeError = useCallback(
    (error: ApiEndpointError): string => {
      if (error.code !== "config_unparsable" || !error.params) return error.message;
      return describeUnparsableFile(t, error.params);
    },
    [t],
  );

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
      setActionFailure(null);
      try {
        const result = await client.apiEndpointSetEndpointState({
          endpointId: endpoint.id,
          ...change,
        });
        if (result.error)
          setActionFailure({ code: result.error.code, message: describeError(result.error) });
      } catch (error) {
        setActionFailure({ code: null, message: toErrorMessage(error) });
      } finally {
        await refresh();
        setPendingEndpointId(null);
      }
    },
    [client, describeError, refresh],
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

  // 照 magpie providerArrangeSeq：后发的挪动说了算。前一次保存回来时后一次还在路上，就不刷新也不报它的错，
  // 免得把后一次先画好的顺序刷回旧样子。
  const arrangeSeqRef = useRef(0);
  const arrange = useCallback(
    ({ endpoint, place, shown }: EndpointArrangement) => {
      if (!client) return;
      const current = queryClient.getQueryData<ApiEndpointListResponse["payload"]>(queryKey);
      if (!current) return;
      const order = arrangeEndpoint({
        endpoints: current.endpoints,
        id: endpoint.id,
        place,
        shown,
      });
      if (!order) return;
      const seq = ++arrangeSeqRef.current;
      // 先按新顺序画出来（照 magpie）；进行中的刷新不能把它盖回去。
      void queryClient.cancelQueries({ queryKey }, { revert: false });
      const byId = new Map(current.endpoints.map((entry) => [entry.id, entry]));
      queryClient.setQueryData<ApiEndpointListResponse["payload"]>(queryKey, {
        ...current,
        endpoints: order.flatMap((id) => byId.get(id) ?? []),
      });
      setActionFailure(null);
      void (async () => {
        let failure: ActionFailure | null = null;
        try {
          const result = await client.apiEndpointSetOrder({ endpointIds: order });
          if (result.error) {
            failure = { code: result.error.code, message: describeError(result.error) };
          }
        } catch (error) {
          failure = { code: null, message: toErrorMessage(error) };
        }
        if (seq !== arrangeSeqRef.current) return;
        if (failure) setActionFailure(failure);
        else toast.show(t("settings.apiEndpoints.order.saved"), { variant: "success" });
        await refresh();
      })();
    },
    [client, describeError, queryClient, queryKey, refresh, t, toast],
  );

  const setDisabledModels = useCallback(
    async (models: string[]): Promise<string | null> => {
      if (!client) return t("workspace.terminal.hostDisconnected");
      try {
        const result = await client.apiEndpointSetDisabledModels({ models });
        if (result.error) return describeError(result.error);
        await refresh();
        return null;
      } catch (error) {
        return requestFailureMessage(error);
      }
    },
    [client, describeError, refresh, t],
  );

  const setEndpointNameDisplay = useCallback(
    async (display: string): Promise<string | null> => {
      if (!client) return t("workspace.terminal.hostDisconnected");
      try {
        const result = await client.apiEndpointSetEndpointNameDisplay({ display });
        if (result.error) return describeError(result.error);
        await refresh();
        return null;
      } catch (error) {
        return requestFailureMessage(error);
      }
    },
    [client, describeError, refresh, t],
  );

  const setLongConversations = useCallback(
    async (change: LongConversationsChange): Promise<string | null> => {
      if (!client) return t("workspace.terminal.hostDisconnected");
      try {
        const result = await client.apiEndpointSetLongConversations(change);
        if (result.error) return describeError(result.error);
        await refresh();
        return null;
      } catch (error) {
        return requestFailureMessage(error);
      }
    },
    [client, describeError, refresh, t],
  );

  const setAgentSettings = useCallback(
    (provider: string, settings: AgentSettingsChange) => {
      if (!client) return;
      void (async () => {
        setPendingAgent(provider);
        setActionFailure(null);
        setLastConnection(null);
        try {
          const result = await client.apiEndpointSetAgentSettings({ provider, ...settings });
          if (result.error)
            setActionFailure({ code: result.error.code, message: describeError(result.error) });
          // COMPAT(apiEndpointCliWiring): added in v0.17.0, remove after 2027-04-18. 老主机不回 connection。
          if (!result.error && result.connection) {
            setLastConnection({ provider, connection: result.connection });
          }
        } catch (error) {
          setActionFailure({ code: null, message: toErrorMessage(error) });
        } finally {
          await refresh();
          setPendingAgent(null);
        }
      })();
    },
    [client, describeError, refresh],
  );

  const runIssueAction = useCallback(
    (provider: string, action: DirectIssueAction) => {
      if (!client) return;
      void (async () => {
        setPendingIssueAction({ provider, action });
        setIssueActionError(null);
        setLastConnection(null);
        try {
          const result = await sendIssueAction(client, provider, action);
          if (result.error) {
            setIssueActionError({ provider, action, message: describeError(result.error) });
          }
        } catch (error) {
          setIssueActionError({ provider, action, message: toErrorMessage(error) });
        } finally {
          await refresh();
          setPendingIssueAction(null);
        }
      })();
    },
    [client, describeError, refresh],
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

  const fetchModels = useCallback(
    async (
      request: ConnectionFetchRequest,
      signal: AbortSignal,
    ): Promise<ConnectionFetchResult> => {
      if (!client) return { status: "failed", message: t("workspace.terminal.hostDisconnected") };
      const requestId = createUpstreamRequestId();
      const unlink = linkAbortToCancel(signal, () => client.apiEndpointCancel(requestId));
      try {
        const response = await client.apiEndpointFetchModels(
          { provider: LIST_PROVIDER, ...request },
          requestId,
        );
        if (signal.aborted || response.error?.code === "cancelled") return { status: "cancelled" };
        if (response.error) return { status: "failed", message: response.error.message };
        return { status: "done", models: response.models };
      } catch (error) {
        if (signal.aborted) return { status: "cancelled" };
        return { status: "failed", message: toErrorMessage(error) };
      } finally {
        unlink();
      }
    },
    [client, t],
  );

  const testConnection = useCallback(
    async (request: ConnectionTestRequest, signal: AbortSignal): Promise<ConnectionTestResult> => {
      if (!client) return { status: "failed", message: t("workspace.terminal.hostDisconnected") };
      const requestId = createUpstreamRequestId();
      const unlink = linkAbortToCancel(signal, () => client.apiEndpointCancel(requestId));
      try {
        const response = await client.apiEndpointTestConnection(
          { provider: LIST_PROVIDER, ...request },
          requestId,
        );
        if (signal.aborted || response.error?.code === "cancelled") return { status: "cancelled" };
        if (response.error) return { status: "failed", message: response.error.message };
        if (!response.result) throw new Error("The host returned neither a result nor an error");
        return { status: "done", result: response.result };
      } catch (error) {
        if (signal.aborted) return { status: "cancelled" };
        return { status: "failed", message: toErrorMessage(error) };
      } finally {
        unlink();
      }
    },
    [client, t],
  );

  const revealKey = useCallback(
    async (endpointId: string): Promise<ConnectionRevealKeyResult> => {
      if (!client) return { status: "failed", message: t("workspace.terminal.hostDisconnected") };
      try {
        const result = await client.apiEndpointRevealKey(endpointId);
        if (result.error) return { status: "failed", message: result.error.message };
        return { status: "revealed", apiKey: result.apiKey };
      } catch (error) {
        return { status: "failed", message: toErrorMessage(error) };
      }
    },
    [client, t],
  );

  // 存图片与从网站取图标的回复一样：主机给的图标值，或失败原因。
  const iconRequest = useCallback(
    async (
      send: (
        hostClient: HostClient,
      ) => Promise<{ icon: string | null; error: ApiEndpointError | null }>,
    ): Promise<ConnectionIconResult> => {
      if (!client) {
        const message = t("workspace.terminal.hostDisconnected");
        return { status: "failed", error: { code: "failed", message } };
      }
      try {
        const result = await send(client);
        if (result.error) return { status: "failed", error: iconErrorOf(result.error) };
        if (result.icon === null) {
          const message = t("common.errors.unableToSave");
          return { status: "failed", error: { code: "failed", message } };
        }
        return { status: "stored", icon: result.icon };
      } catch (error) {
        return { status: "failed", error: { code: "failed", message: toErrorMessage(error) } };
      }
    },
    [client, t],
  );
  const storeIcon = useCallback(
    (bytes: Uint8Array) =>
      iconRequest((hostClient) =>
        hostClient.apiEndpointStoreIcon({ data: Buffer.from(bytes).toString("base64") }),
      ),
    [iconRequest],
  );
  const fetchSiteIcon = useCallback(
    (input: { baseUrl: string; name: string }) =>
      iconRequest((hostClient) => hostClient.apiEndpointFetchSiteIcon(input)),
    [iconRequest],
  );

  const dismissActionError = useCallback(() => setActionFailure(null), []);
  const dismissIssueActionError = useCallback(() => setIssueActionError(null), []);

  return {
    state,
    pendingEndpointId,
    actionError: actionFailure?.message ?? null,
    actionErrorCode: actionFailure?.code ?? null,
    dismissActionError,
    setEnabled,
    resume,
    arrange,
    setLongConversations,
    setDisabledModels,
    setEndpointNameDisplay,
    pendingAgent,
    setAgentSettings,
    lastConnection,
    pendingIssueAction,
    issueActionError,
    runIssueAction,
    dismissIssueActionError,
    save,
    detect,
    revealKey,
    storeIcon,
    fetchSiteIcon,
    fetchModels,
    testConnection,
  };
}

type HostClient = NonNullable<ReturnType<typeof useHostRuntimeClient>>;

/** 请求本身没成：连接断了或超时（DaemonConnectionError）、主机回了 RPC 错误（DaemonRpcError）。别的照抛。 */
function requestFailureMessage(error: unknown): string {
  if (error instanceof DaemonConnectionError || error instanceof DaemonRpcError) {
    return toErrorMessage(error);
  }
  throw error;
}

/** daemon 的错误码认得的按界面语言说明，别的照原文显示。 */
function iconErrorOf(error: ApiEndpointError): ConnectionIconError {
  const known = CONNECTION_ICON_ERROR_CODES.find((code) => code === error.code);
  return { code: known ?? "failed", message: error.message };
}

/**
 * 重新应用 = 开着、按当前设置重写；保留当前设置是单独的 RPC（「模型被换掉」时带上它的 code）；
 * 「保留 claude.ai 登录」的两种处理只改这个选项，CLI 配置随之重写（提示只在开关开着时出现）。
 */
function sendIssueAction(
  client: HostClient,
  provider: string,
  action: DirectIssueAction,
): Promise<{ error: ApiEndpointError | null }> {
  switch (action) {
    case "reapply":
      return client.apiEndpointSetAgentSettings({ provider, enabled: true, reapply: true });
    case "keepCurrent":
      return client.apiEndpointKeepCurrentSettings({ provider });
    case "keepReplacedModel":
      return client.apiEndpointKeepCurrentSettings({ provider, code: "model_replaced" });
    case "keepClaudeAiLogin":
      return client.apiEndpointSetAgentSettings({
        provider,
        enabled: true,
        keepsClaudeAiLogin: true,
      });
    case "stopKeepingClaudeAiLogin":
      return client.apiEndpointSetAgentSettings({
        provider,
        enabled: true,
        keepsClaudeAiLogin: false,
      });
  }
}
