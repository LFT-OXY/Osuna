import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  API_ENDPOINT_REQUEST_FORMATS,
  type ApiEndpoint,
  type ApiEndpointAgentSettings,
  type ApiEndpointModelMapping,
  type ApiEndpointModelScope,
  type ApiEndpointRequestFormat,
  type ApiEndpointTestConnectionResponse,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { localizedTestResult, requestExtrasErrorText } from "./request-extras-copy";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { addManualModels, keepMappingWithin, type ModelSource } from "./internal/endpoint-models";
import { previewAgentSettlements, type AgentSettlement } from "./internal/host-list";
import { modelScopeOf, RULE_PROBLEM_KEYS, typedRuleOf } from "./internal/model-scope";
import type { SaveModelSettings } from "./internal/model-settings-form";
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

// 「丢掉拉回的清单」：失败原因留在原处，直到再点或拉到新清单。
export type CatalogForgetState =
  | { status: "idle" }
  | { status: "forgetting" }
  | { status: "failed"; message: string };

export type FormatTestOutcome =
  | { kind: "testing" }
  | { kind: "ok"; durationMs: number }
  | { kind: "authFailed"; message: string }
  | { kind: "failed"; message: string };

// 「自己能联网搜索」开关的保存：保存中显示要保存的值，失败的原因留到下次切换。
export type WebSearchSaveState =
  | { status: "idle" }
  | { status: "saving"; value: boolean }
  | { status: "failed"; message: string };

export type FormatTestResults = Partial<Record<ApiEndpointRequestFormat, FormatTestOutcome>>;

type ModelSelection = Pick<ModelSource, "models" | "manualModels">;

interface ModelDraft extends ModelSelection {
  modelMapping: ApiEndpointModelMapping | undefined;
  // 服务范围与自动勾选规则：只发给声明了 apiEndpointManagement 的主机。
  modelScope: ApiEndpointModelScope;
  autoPick: string[];
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
  forgetState: CatalogForgetState;
  // 主机声明了 apiEndpointManagement：能丢掉拉回的清单、改服务范围与自动勾选规则。
  canForgetCatalog: boolean;
  modelScope: ApiEndpointModelScope;
  autoPick: string[];
  // 规则区要显示的错误：不是规则，或增删没保存成功（加规则时输入留在原处）；再改规则时清掉。
  ruleError: string | null;
  // 模型开关或档位映射没保存成功的原因。
  saveError: string | null;
  deleteError: string | null;
  testResults: FormatTestResults;
  isTesting: boolean;
  isDeleting: boolean;
  // 开关显示的值：保存中为要保存的值，否则以 daemon 为准。
  searchesWeb: boolean;
  webSearchSave: WebSearchSaveState;
  setSearchesWeb: (value: boolean) => void;
  fetchModels: () => void;
  forgetCatalog: () => void;
  changeModels: (next: ModelSelection) => void;
  // 一次加几个（逗号分隔拆好的）；失败原因交给调用方（手动添加那一行自己显示），不进 saveError。
  addModels: (modelIds: string[]) => Promise<string | null>;
  changeMapping: (mapping: ApiEndpointModelMapping | undefined) => void;
  changeScope: (scope: ApiEndpointModelScope) => void;
  // 返回是否加上了；没加上的原因在 ruleError。
  addRule: (text: string) => Promise<boolean>;
  removeRule: (rule: string) => void;
  // 模型设置窗口与「整家默认」的保存；失败原因交给它们在原处显示。
  saveModelSettings: SaveModelSettings;
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
  // COMPAT(apiEndpointManagement): added in v0.17.0, remove gate after 2027-04-19. 老主机不认 baseUrls 与 forget_catalog。
  hasManagement: boolean;
}): UseEndpointDetailResult {
  const { serverId, endpoint, endpoints, agents, hasManagement } = input;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const { entries: providerEntries } = useProvidersSnapshot(serverId);
  const [fetchState, setFetchState] = useState<ModelFetchState>({ status: "idle" });
  const [forgetState, setForgetState] = useState<CatalogForgetState>({ status: "idle" });
  const [draft, setDraft] = useState<ModelDraft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<FormatTestResults>({});
  const [isDeleting, setIsDeleting] = useState(false);
  const [webSearchSave, setWebSearchSave] = useState<WebSearchSaveState>({ status: "idle" });
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
        modelScope: modelScopeOf(endpoint),
        autoPick: endpoint.autoPick ?? [],
      },
    [draft, endpoint],
  );

  /**
   * 主机认 baseUrls：一次交出这家的全部地址，daemon 各格式各拉一次合并后记下。
   * 老主机：第一个地址列不出模型时依次试其余地址；都失败就显示最后一个的原因。
   * quiet：打开页面时自己拉的，已有清单时失败不报（daemon 已记日志、清单不动）。
   */
  const runFetch = useCallback(
    ({ quiet }: { quiet: boolean }) => {
      if (!client) return;
      setFetchState({ status: "fetching" });
      void (async () => {
        const addresses = formatAddresses(endpoint);
        const [first] = addresses;
        const merged = first ? [{ format: first.format, url: first.url, baseUrls: addresses }] : [];
        const requests: (FormatAddress & { baseUrls?: FormatAddress[] })[] = hasManagement
          ? merged
          : addresses;
        let failure = "";
        for (const { format, url, ...rest } of requests) {
          try {
            const response = await client.apiEndpointFetchModels(
              {
                provider: LIST_PROVIDER,
                endpointId: endpoint.id,
                baseUrl: url,
                format,
                ...rest,
              },
              createUpstreamRequestId(),
            );
            if (!response.error) {
              await refresh();
              setFetchState({ status: "idle" });
              setForgetState({ status: "idle" });
              return;
            }
            failure = requestExtrasErrorText(t, response.error) ?? response.error.message;
          } catch (error) {
            failure = toErrorMessage(error);
          }
        }
        setFetchState(
          quiet && endpoint.catalog ? { status: "idle" } : { status: "failed", message: failure },
        );
      })();
    },
    [client, endpoint, hasManagement, refresh, t],
  );

  const fetchModels = useCallback(() => runFetch({ quiet: false }), [runFetch]);

  // 打开接口页就拉一次（主机认合并时每次都拉，照 prd 第 15 条）；老主机只在还没拉过清单时拉。
  useEffect(() => {
    if (autoFetchedFor.current === endpoint.id) return;
    if (!hasManagement && endpoint.catalog) return;
    autoFetchedFor.current = endpoint.id;
    runFetch({ quiet: true });
  }, [endpoint.catalog, endpoint.id, hasManagement, runFetch]);

  const forgetCatalog = useCallback(() => {
    if (!client) {
      setForgetState({ status: "failed", message: t("workspace.terminal.hostDisconnected") });
      return;
    }
    setForgetState({ status: "forgetting" });
    void (async () => {
      let failure: string | null = null;
      try {
        const response = await client.apiEndpointForgetCatalog(endpoint.id);
        failure = response.error?.message ?? null;
      } catch (error) {
        failure = toErrorMessage(error);
      }
      await refresh();
      setForgetState(
        failure === null ? { status: "idle" } : { status: "failed", message: failure },
      );
    })();
  }, [client, endpoint.id, refresh, t]);

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
          ...scopeFieldsOf({ draft: next, hasManagement }),
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
    [client, endpoint, hasManagement, refresh, t],
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
        // 跟随清单时开关一个模型：从在服务的那些起改成「只用挑选的」（照 magpie：挑选从在服务的开始）。
        saveReportingError({
          ...current,
          ...next,
          modelMapping: keepMappingWithin(current.modelMapping, next.models),
          modelScope: "picked",
        });
      })();
    },
    [confirmModelsOff, current, saveReportingError],
  );

  // 切到「只用挑选的」时已选就是 models 里在服务的那些，原样写回（prd 第 17 条）。
  const changeScope = useCallback(
    (scope: ApiEndpointModelScope) => {
      if (scope === current.modelScope) return;
      saveReportingError({ ...current, modelScope: scope });
    },
    [current, saveReportingError],
  );

  const addRule = useCallback(
    async (text: string): Promise<boolean> => {
      setRuleError(null);
      const typed = typedRuleOf(text, current.autoPick);
      if (typed.kind === "empty" || typed.kind === "duplicate") return typed.kind === "duplicate";
      if (typed.kind === "problem") {
        const key = RULE_PROBLEM_KEYS[typed.problem];
        setRuleError(
          t(`settings.apiEndpoints.modelScope.rules.problem.${key}`, { text: typed.text }),
        );
        return false;
      }
      const failure = await save({ ...current, autoPick: [...current.autoPick, typed.rule] });
      setRuleError(ruleSaveError(failure, t));
      return failure === null;
    },
    [current, save, t],
  );

  const removeRule = useCallback(
    (rule: string) => {
      setRuleError(null);
      void save({ ...current, autoPick: current.autoPick.filter((kept) => kept !== rule) }).then(
        (failure) => setRuleError(ruleSaveError(failure, t)),
      );
    },
    [current, save, t],
  );

  const setSearchesWeb = useCallback(
    (value: boolean) => {
      if (!client) {
        setWebSearchSave({ status: "failed", message: t("workspace.terminal.hostDisconnected") });
        return;
      }
      setWebSearchSave({ status: "saving", value });
      void (async () => {
        let failure: string | null = null;
        try {
          const result = await client.apiEndpointSave({
            ...unchangedSaveFields({ endpoint, draft: current, hasManagement }),
            searchesWeb: value,
          });
          failure = result.error?.message ?? null;
        } catch (error) {
          failure = toErrorMessage(error);
        }
        await refresh();
        setWebSearchSave(
          failure === null ? { status: "idle" } : { status: "failed", message: failure },
        );
      })();
    },
    [client, current, endpoint, hasManagement, refresh, t],
  );

  const saveModelSettings = useCallback<SaveModelSettings>(
    async (update) => {
      if (!client) return t("workspace.terminal.hostDisconnected");
      let failure: string | null = null;
      try {
        const result = await client.apiEndpointSave({
          ...unchangedSaveFields({ endpoint, draft: current, hasManagement }),
          modelSettings: update(endpoint.modelSettings),
        });
        failure = result.error?.message ?? null;
      } catch (error) {
        failure = toErrorMessage(error);
      }
      await refresh();
      return failure;
    },
    [client, current, endpoint, hasManagement, refresh, t],
  );

  const addModels = useCallback(
    (modelIds: string[]) => save({ ...current, ...addManualModels(current, modelIds) }),
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
          outcome = testOutcomeOf({ t, response });
        } catch (error) {
          outcome = { kind: "failed", message: toErrorMessage(error) };
        }
        setTestResults((previous) => ({ ...previous, [format]: outcome }));
      })();
    }
  }, [client, endpoint, t]);

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
    forgetState,
    canForgetCatalog: hasManagement,
    modelScope: current.modelScope,
    autoPick: current.autoPick,
    ruleError,
    saveError,
    deleteError,
    testResults,
    isTesting,
    isDeleting,
    searchesWeb:
      webSearchSave.status === "saving" ? webSearchSave.value : endpoint.searchesWeb === true,
    webSearchSave,
    setSearchesWeb,
    fetchModels,
    forgetCatalog,
    changeModels,
    addModels,
    changeMapping,
    changeScope,
    addRule,
    removeRule,
    saveModelSettings,
    testConnection,
    remove,
  };
}

function ruleSaveError(
  failure: string | null,
  t: (key: string, params?: Record<string, unknown>) => string,
): string | null {
  if (failure === null) return null;
  return t("settings.apiEndpoints.modelScope.rules.saveFailed", { message: failure });
}

/** 只改一项（联网搜索、模型设置）的保存：其余字段照这家现在的（模型选择以草稿为准）带上。 */
function unchangedSaveFields(input: {
  endpoint: ApiEndpoint;
  draft: ModelDraft;
  hasManagement: boolean;
}) {
  const { endpoint, draft } = input;
  return {
    provider: LIST_PROVIDER,
    endpointId: endpoint.id,
    name: endpoint.name,
    baseUrls: endpoint.baseUrls ?? [],
    models: draft.models,
    manualModels: draft.manualModels,
    ...(draft.modelMapping ? { modelMapping: draft.modelMapping } : {}),
    ...scopeFieldsOf({ draft, hasManagement: input.hasManagement }),
  };
}

/** 老主机不认服务范围与规则：不发，免得它们看起来存上了。 */
function scopeFieldsOf({ draft, hasManagement }: { draft: ModelDraft; hasManagement: boolean }): {
  modelScope?: ApiEndpointModelScope;
  autoPick?: string[];
} {
  if (!hasManagement) return {};
  return { modelScope: draft.modelScope, autoPick: draft.autoPick };
}

function testOutcomeOf(input: {
  t: TFunction;
  response: ApiEndpointTestConnectionResponse["payload"];
}): FormatTestOutcome {
  const { response } = input;
  if (response.error) return { kind: "failed", message: response.error.message };
  if (!response.result) return { kind: "failed", message: "" };
  // 请求头发不出去：原因按界面语言说。
  const result = localizedTestResult(input.t, response.result);
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
