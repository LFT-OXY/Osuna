import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  API_ENDPOINT_REQUEST_FORMATS,
  type ApiEndpoint,
  type ApiEndpointAgentSettings,
  type ApiEndpointModelMapping,
  type ApiEndpointRequestFormat,
  type ApiEndpointTestConnectionResponse,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { addManualModel, keepMappingWithin, type ModelSource } from "./internal/endpoint-models";
import { previewAgentSettlements, type AgentSettlement } from "./internal/host-list";
import { createUpstreamRequestId } from "./internal/upstream-request";
import { LIST_PROVIDER } from "./use-host-endpoints";

/*
 * 接口详情页的运行时：拉取上游模型、保存模型开关与档位映射、按格式测试连接、删除。
 * 模型开关先改在本地草稿上立刻显示，保存并刷新列表后再以 daemon 为准。
 */

export type ModelFetchState =
  | { status: "idle" }
  | { status: "fetching" }
  | { status: "failed"; message: string };

export type FormatTestOutcome =
  | { kind: "testing" }
  | { kind: "ok"; durationMs: number }
  | { kind: "authFailed"; message: string }
  | { kind: "failed"; message: string };

export type FormatTestResults = Partial<Record<ApiEndpointRequestFormat, FormatTestOutcome>>;

type ModelSelection = Pick<ModelSource, "models" | "manualModels">;

interface ModelDraft extends ModelSelection {
  modelMapping: ApiEndpointModelMapping | undefined;
}

interface FormatAddress {
  format: ApiEndpointRequestFormat;
  url: string;
}

export interface UseEndpointDetailResult {
  // 模型区显示的已选、手动添加与上游清单：草稿优先。
  source: ModelSource;
  modelMapping: ApiEndpointModelMapping | undefined;
  fetchState: ModelFetchState;
  // 模型开关或档位映射没保存成功的原因。
  saveError: string | null;
  deleteError: string | null;
  testResults: FormatTestResults;
  isTesting: boolean;
  isDeleting: boolean;
  fetchModels: () => void;
  changeModels: (next: ModelSelection) => void;
  // 失败原因交给调用方（手动添加那一行自己显示），不进 saveError。
  addModel: (modelId: string) => Promise<string | null>;
  changeMapping: (mapping: ApiEndpointModelMapping | undefined) => void;
  testConnection: () => void;
  remove: () => void;
}

/** 这家填了的地址，按 Anthropic → Chat → Responses（和自动检测列模型的顺序一致）。 */
function formatAddresses(endpoint: ApiEndpoint): FormatAddress[] {
  return API_ENDPOINT_REQUEST_FORMATS.flatMap((format) => {
    const url = endpoint.baseUrls?.find((entry) => entry.format === format)?.url;
    return url ? [{ format, url }] : [];
  });
}

export function useEndpointDetail(input: {
  serverId: string;
  endpoint: ApiEndpoint;
  endpoints: ApiEndpoint[];
  agents: Record<string, ApiEndpointAgentSettings>;
}): UseEndpointDetailResult {
  const { serverId, endpoint, endpoints, agents } = input;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const { entries: providerEntries } = useProvidersSnapshot(serverId);
  const [fetchState, setFetchState] = useState<ModelFetchState>({ status: "idle" });
  const [draft, setDraft] = useState<ModelDraft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<FormatTestResults>({});
  const [isDeleting, setIsDeleting] = useState(false);
  // 还没回来的保存数；只决定何时放下草稿，不参与渲染。
  const pendingSaves = useRef(0);
  const autoFetchedFor = useRef<string | null>(null);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["api-endpoints", serverId] }),
    [queryClient, serverId],
  );

  const current = useMemo<ModelDraft>(
    () =>
      draft ?? {
        models: endpoint.models,
        manualModels: endpoint.manualModels ?? [],
        modelMapping: endpoint.modelMapping,
      },
    [draft, endpoint.manualModels, endpoint.modelMapping, endpoint.models],
  );

  // 第一个地址列不出模型时依次试其余地址；都失败就显示最后一个的原因。
  const fetchModels = useCallback(() => {
    if (!client) return;
    setFetchState({ status: "fetching" });
    void (async () => {
      let failure = "";
      for (const address of formatAddresses(endpoint)) {
        try {
          const response = await client.apiEndpointFetchModels(
            {
              provider: LIST_PROVIDER,
              endpointId: endpoint.id,
              baseUrl: address.url,
              format: address.format,
            },
            createUpstreamRequestId(),
          );
          if (!response.error) {
            await refresh();
            setFetchState({ status: "idle" });
            return;
          }
          failure = response.error.message;
        } catch (error) {
          failure = toErrorMessage(error);
        }
      }
      setFetchState({ status: "failed", message: failure });
    })();
  }, [client, endpoint, refresh]);

  // 新建后进来、还没拉过清单的接口，打开就拉一次。
  useEffect(() => {
    if (endpoint.catalog || autoFetchedFor.current === endpoint.id) return;
    autoFetchedFor.current = endpoint.id;
    fetchModels();
  }, [endpoint.catalog, endpoint.id, fetchModels]);

  /** 保存整份模型选择与映射；返回失败原因，成功为 null。 */
  const save = useCallback(
    async (next: ModelDraft): Promise<string | null> => {
      if (!client) return t("workspace.terminal.hostDisconnected");
      setDraft(next);
      pendingSaves.current += 1;
      let failure: string | null = null;
      try {
        const result = await client.apiEndpointSave({
          provider: LIST_PROVIDER,
          endpointId: endpoint.id,
          name: endpoint.name,
          baseUrls: endpoint.baseUrls ?? [],
          models: next.models,
          manualModels: next.manualModels,
          ...(next.modelMapping ? { modelMapping: next.modelMapping } : {}),
        });
        failure = result.error?.message ?? null;
      } catch (error) {
        failure = toErrorMessage(error);
      } finally {
        await refresh();
        pendingSaves.current -= 1;
        // 连点几次时只在最后一次保存回来后放下草稿，免得中间闪回旧状态。
        if (pendingSaves.current === 0) setDraft(null);
      }
      return failure;
    },
    [client, endpoint, refresh, t],
  );

  const saveReportingError = useCallback(
    (next: ModelDraft) => {
      setSaveError(null);
      void save(next).then(setSaveError);
    },
    [save],
  );

  const agentLabel = useCallback(
    (provider: string) => resolveProviderLabel(provider, providerEntries),
    [providerEntries],
  );

  /** 这次改动会让某个 Agent 回官方时先确认；没有就直接放行。 */
  const confirmModelsOff = useCallback(
    (next: ModelSelection): Promise<boolean> => {
      const after = endpoints.map((entry) =>
        entry.id === endpoint.id ? { ...entry, models: next.models } : entry,
      );
      const official = previewAgentSettlements({ endpoints: after, agents }).filter(
        (settlement) => settlement.kind === "official",
      );
      if (official.length === 0) return Promise.resolve(true);
      return confirmDialog({
        title: t("settings.apiEndpoints.models.offConfirm.title"),
        message: [
          ...official.map((settlement) =>
            t("settings.apiEndpoints.switchOff.returnsToOfficial", {
              agent: agentLabel(settlement.provider),
            }),
          ),
          t("settings.apiEndpoints.switchOff.message"),
        ].join("\n"),
        confirmLabel: t("settings.apiEndpoints.models.offConfirm.confirm"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
    },
    [agentLabel, agents, endpoint.id, endpoints, t],
  );

  const changeModels = useCallback(
    (next: ModelSelection) => {
      void (async () => {
        if (!(await confirmModelsOff(next))) return;
        saveReportingError({
          ...next,
          modelMapping: keepMappingWithin(current.modelMapping, next.models),
        });
      })();
    },
    [confirmModelsOff, current.modelMapping, saveReportingError],
  );

  const addModel = useCallback(
    (modelId: string) => save({ ...current, ...addManualModel(current, modelId) }),
    [current, save],
  );

  const changeMapping = useCallback(
    (mapping: ApiEndpointModelMapping | undefined) =>
      saveReportingError({ ...current, modelMapping: mapping }),
    [current, saveReportingError],
  );

  const testConnection = useCallback(() => {
    if (!client) return;
    const addresses = formatAddresses(endpoint);
    setTestResults(
      Object.fromEntries(addresses.map((address) => [address.format, { kind: "testing" }])),
    );
    for (const { format, url } of addresses) {
      void (async () => {
        let outcome: FormatTestOutcome;
        try {
          const response = await client.apiEndpointTestConnection(
            { provider: LIST_PROVIDER, endpointId: endpoint.id, baseUrl: url, format },
            createUpstreamRequestId(),
          );
          outcome = testOutcomeOf(response);
        } catch (error) {
          outcome = { kind: "failed", message: toErrorMessage(error) };
        }
        setTestResults((previous) => ({ ...previous, [format]: outcome }));
      })();
    }
  }, [client, endpoint]);

  const remove = useCallback(() => {
    if (!client) return;
    void (async () => {
      const after = endpoints.filter((entry) => entry.id !== endpoint.id);
      // macOS 的 Electron 确认框只显示正文，正文自己要点出是哪一家。
      const lines = [
        t("settings.apiEndpoints.detail.deleteConfirm.removed", { name: endpoint.name }),
        ...previewAgentSettlements({ endpoints: after, agents }).flatMap((settlement) =>
          settlementLine(settlement, agentLabel, t),
        ),
      ];
      const confirmed = await confirmDialog({
        title: t("settings.apiEndpoints.detail.deleteConfirm.title", { name: endpoint.name }),
        message: lines.join("\n"),
        confirmLabel: t("settings.apiEndpoints.detail.deleteConfirm.confirm"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
      setIsDeleting(true);
      setDeleteError(null);
      try {
        const result = await client.apiEndpointDelete(LIST_PROVIDER, endpoint.id);
        if (result.error) setDeleteError(result.error.message);
      } catch (error) {
        setDeleteError(toErrorMessage(error));
      } finally {
        // 删掉后列表里没有这家，详情页自己回到列表。
        await refresh();
        setIsDeleting(false);
      }
    })();
  }, [agentLabel, agents, client, endpoint, endpoints, refresh, t]);

  const isTesting = Object.values(testResults).some((outcome) => outcome?.kind === "testing");

  const source = useMemo<ModelSource>(
    () => ({
      models: current.models,
      catalog: endpoint.catalog ?? null,
      manualModels: current.manualModels,
    }),
    [current.manualModels, current.models, endpoint.catalog],
  );

  return {
    source,
    modelMapping: current.modelMapping,
    fetchState,
    saveError,
    deleteError,
    testResults,
    isTesting,
    isDeleting,
    fetchModels,
    changeModels,
    addModel,
    changeMapping,
    testConnection,
    remove,
  };
}

function testOutcomeOf(response: ApiEndpointTestConnectionResponse["payload"]): FormatTestOutcome {
  if (response.error) return { kind: "failed", message: response.error.message };
  const result = response.result;
  if (!result) return { kind: "failed", message: "" };
  if (result.ok) return { kind: "ok", durationMs: result.durationMs };
  const message = result.error?.message ?? "";
  if (result.error?.code === "auth_failed") return { kind: "authFailed", message };
  return { kind: "failed", message };
}

function settlementLine(
  settlement: AgentSettlement,
  agentLabel: (provider: string) => string,
  t: (key: string, params?: Record<string, unknown>) => string,
): string[] {
  const agent = agentLabel(settlement.provider);
  if (settlement.kind === "official") {
    return [t("settings.apiEndpoints.switchOff.returnsToOfficial", { agent })];
  }
  // 开着总开关的 Agent 一定有默认模型（daemon 打开时就会补上）；没有时不写这一行。
  if (settlement.kind === "defaultChanged" && settlement.from !== null) {
    return [
      t("settings.apiEndpoints.detail.deleteConfirm.defaultChanged", {
        agent,
        from: settlement.from,
        to: settlement.to,
      }),
    ];
  }
  return [];
}
