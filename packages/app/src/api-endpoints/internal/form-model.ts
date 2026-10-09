import {
  API_ENDPOINT_MODEL_TIERS,
  apiEndpointHasModelMapping,
  type ApiEndpoint,
  type ApiEndpointFetchModelsRequest,
  type ApiEndpointModel,
  type ApiEndpointModelMapping,
  type ApiEndpointModelTier,
  type ApiEndpointSaveRequest,
  type ApiEndpointTestConnectionRequest,
  type ApiEndpointTestConnectionResult,
} from "@osuna/protocol/api-endpoint/rpc-schemas";

/*
 * 第三方接口的新建/编辑表单模型：纯 TypeScript，无 React（docs/forms.md）。
 * API key 只写不读：编辑时输入框从空开始，留空提交就不带 apiKey，daemon 保留原 key；
 * 拉取模型、测试连接同理，留空就带 endpointId 让 daemon 用已保存的 key。
 * `models` 是勾选的模型（拉取后勾选的 + 手动添加的），只保存它们；默认模型和 Claude 的映射都只能从中选。
 */

export type ApiEndpointFormSeed =
  | { mode: "create"; provider: string }
  | { mode: "edit"; provider: string; endpoint: ApiEndpoint };

export type ApiEndpointSaveRequestInput = Omit<ApiEndpointSaveRequest, "type" | "requestId">;

// cancelled：保存当前启用的接口前要确认，用户取消了；表单留着，不显示错误。
export type ApiEndpointSaveResult =
  | { status: "saved" }
  | { status: "failed"; message: string }
  | { status: "cancelled" };

export type ApiEndpointFetchModelsRequestInput = Omit<
  ApiEndpointFetchModelsRequest,
  "type" | "requestId"
>;

export type ApiEndpointFetchModelsResult =
  | { status: "ok"; models: ApiEndpointModel[] }
  | { status: "failed"; message: string }
  | { status: "cancelled" };

export type ApiEndpointFetchState =
  | { status: "idle" }
  | { status: "fetching" }
  | { status: "fetched"; models: ApiEndpointModel[] }
  | { status: "failed"; message: string };

export type ApiEndpointTestConnectionRequestInput = Omit<
  ApiEndpointTestConnectionRequest,
  "type" | "requestId"
>;

// done：上游给出了结论（成功或失败都在 result 里）；failed：请求本身没成立（缺 key、断线……）。
export type ApiEndpointTestConnectionOutcome =
  | { status: "done"; result: ApiEndpointTestConnectionResult }
  | { status: "failed"; message: string }
  | { status: "cancelled" };

export type ApiEndpointTestState =
  | { status: "idle" }
  | { status: "testing"; modelId: string }
  | { status: "done"; modelId: string; result: ApiEndpointTestConnectionResult }
  | { status: "failed"; modelId: string; message: string };

export interface ApiEndpointFetchedRow {
  model: ApiEndpointModel;
  checked: boolean;
}

// OpenRouter 一次返回几百个模型；列表只画前这么多条，其余靠搜索缩小，表单里不嵌套滚动。
const MAX_FETCHED_ROWS = 50;

export interface ApiEndpointFormState {
  mode: "create" | "edit";
  name: string;
  baseUrl: string;
  apiKey: string;
  hasSavedKey: boolean;
  models: ApiEndpointModel[];
  defaultModelId: string | null;
  modelDraft: string;
  // 每加入一个模型加一，输入框据此清空（删除模型不清空正在输入的内容）。
  modelDraftGeneration: number;
  fetch: ApiEndpointFetchState;
  modelSearch: string;
  // 拉取到的模型按搜索过滤后的前若干条，带勾选状态。
  fetchedRows: ApiEndpointFetchedRow[];
  hiddenFetchedCount: number;
  showMapping: boolean;
  mapping: ApiEndpointModelMapping;
  test: ApiEndpointTestState;
  baseUrlInvalid: boolean;
  canFetch: boolean;
  canTest: boolean;
  canAddModel: boolean;
  canSubmit: boolean;
  submitting: boolean;
  submitError: string | null;
}

export interface ApiEndpointFormModel {
  getState(): ApiEndpointFormState;
  subscribe(listener: () => void): () => void;
  setName(value: string): void;
  setBaseUrl(value: string): void;
  setApiKey(value: string): void;
  setModelDraft(value: string): void;
  addModel(): void;
  removeModel(id: string): void;
  setDefaultModel(id: string): void;
  fetchModels(): void;
  cancelFetch(): void;
  setModelSearch(value: string): void;
  // 勾选或取消勾选一个模型；拉取列表里的模型勾选时带上它的显示名。
  toggleModel(id: string): void;
  // null 表示这一档不映射；不是勾选的模型就忽略。
  setMapping(tier: ApiEndpointModelTier, modelId: string | null): void;
  // 用「使用的模型」里的一个发最小对话请求；改了 URL 或 key 后结果作废。
  testConnection(modelId: string): void;
  cancelTest(): void;
  submit(): Promise<boolean>;
  close(): void;
}

interface Values {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: ApiEndpointModel[];
  defaultModelId: string | null;
  modelDraft: string;
  modelDraftGeneration: number;
  fetch: ApiEndpointFetchState;
  modelSearch: string;
  mapping: ApiEndpointModelMapping;
  test: ApiEndpointTestState;
  submitting: boolean;
  submitError: string | null;
}

export interface ApiEndpointFormDeps {
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

export function createApiEndpointFormModel(
  seed: ApiEndpointFormSeed,
  deps: ApiEndpointFormDeps,
): ApiEndpointFormModel {
  const listeners = new Set<() => void>();
  const showMapping = apiEndpointHasModelMapping(seed.provider);
  let closed = false;
  // 当前这次拉取；取消或重新拉取后，旧请求晚到的结果不再生效。
  let pendingFetch: AbortController | null = null;
  // 同理，当前这次测试连接。
  let pendingTest: AbortController | null = null;
  let values: Values =
    seed.mode === "edit"
      ? {
          name: seed.endpoint.name,
          baseUrl: seed.endpoint.baseUrl,
          apiKey: "",
          models: seed.endpoint.models,
          defaultModelId: seed.endpoint.defaultModelId,
          modelDraft: "",
          modelDraftGeneration: 0,
          fetch: { status: "idle" },
          modelSearch: "",
          mapping: showMapping ? { ...seed.endpoint.modelMapping } : {},
          test: { status: "idle" },
          submitting: false,
          submitError: null,
        }
      : {
          name: "",
          baseUrl: "",
          apiKey: "",
          models: [],
          defaultModelId: null,
          modelDraft: "",
          modelDraftGeneration: 0,
          fetch: { status: "idle" },
          modelSearch: "",
          mapping: {},
          test: { status: "idle" },
          submitting: false,
          submitError: null,
        };
  let state = derive(values);

  function derive(next: Values): ApiEndpointFormState {
    const hasSavedKey = seed.mode === "edit" && seed.endpoint.hasApiKey;
    const draft = next.modelDraft.trim();
    const baseUrlInvalid = next.baseUrl.trim() !== "" && !isHttpUrl(next.baseUrl.trim());
    const hasKey = next.apiKey.trim() !== "" || hasSavedKey;
    const hasValidUrl = next.baseUrl.trim() !== "" && !baseUrlInvalid;
    const isFetching = next.fetch.status === "fetching";
    const canFetch = !isFetching && hasValidUrl && hasKey;
    const canTest =
      next.test.status !== "testing" && hasValidUrl && hasKey && next.models.length > 0;
    const fetched = deriveFetchedRows(next);
    return {
      mode: seed.mode,
      ...next,
      hasSavedKey,
      ...fetched,
      showMapping,
      baseUrlInvalid,
      canFetch,
      canTest,
      canAddModel: draft !== "" && !next.models.some((model) => model.id === draft),
      canSubmit:
        !next.submitting &&
        next.name.trim() !== "" &&
        next.baseUrl.trim() !== "" &&
        !baseUrlInvalid &&
        hasKey &&
        next.defaultModelId !== null,
    };
  }

  function update(patch: Partial<Values>): void {
    if (closed) return;
    values = { ...values, ...patch };
    state = derive(values);
    for (const listener of listeners) listener();
  }

  function buildRequest(): ApiEndpointSaveRequestInput | null {
    if (!state.canSubmit || values.defaultModelId === null) return null;
    const apiKey = values.apiKey.trim();
    const hasMapping = showMapping && Object.keys(values.mapping).length > 0;
    return {
      provider: seed.provider,
      ...(seed.mode === "edit" ? { endpointId: seed.endpoint.id } : {}),
      name: values.name.trim(),
      baseUrl: values.baseUrl.trim(),
      ...(apiKey ? { apiKey } : {}),
      models: values.models,
      defaultModelId: values.defaultModelId,
      ...(hasMapping ? { modelMapping: values.mapping } : {}),
    };
  }

  function buildUpstreamRequest(): ApiEndpointFetchModelsRequestInput {
    const apiKey = values.apiKey.trim();
    return {
      provider: seed.provider,
      ...(seed.mode === "edit" && !apiKey ? { endpointId: seed.endpoint.id } : {}),
      baseUrl: values.baseUrl.trim(),
      ...(apiKey ? { apiKey } : {}),
    };
  }

  async function runTest(controller: AbortController, modelId: string): Promise<void> {
    const outcome = await deps.testConnection(
      { ...buildUpstreamRequest(), modelId },
      controller.signal,
    );
    if (pendingTest !== controller) return;
    pendingTest = null;
    if (outcome.status === "done") {
      update({ test: { status: "done", modelId, result: outcome.result } });
    } else if (outcome.status === "failed") {
      update({ test: { status: "failed", modelId, message: outcome.message } });
    } else {
      update({ test: { status: "idle" } });
    }
  }

  function abortPendingTest(): void {
    pendingTest?.abort();
    pendingTest = null;
  }

  /** 去掉一个勾选的模型：默认模型顺延到剩下的第一个，指向它的映射档位清空。 */
  function withoutModel(id: string): Partial<Values> {
    const models = values.models.filter((model) => model.id !== id);
    const mapping: ApiEndpointModelMapping = {};
    for (const tier of API_ENDPOINT_MODEL_TIERS) {
      const mapped = values.mapping[tier];
      if (mapped !== undefined && mapped !== id) mapping[tier] = mapped;
    }
    return {
      models,
      mapping,
      defaultModelId:
        values.defaultModelId === id ? (models[0]?.id ?? null) : values.defaultModelId,
    };
  }

  function withModel(model: ApiEndpointModel): Partial<Values> {
    return {
      models: [...values.models, model],
      defaultModelId: values.defaultModelId ?? model.id,
    };
  }

  async function runFetch(controller: AbortController): Promise<void> {
    const result = await deps.fetchModels(buildUpstreamRequest(), controller.signal);
    if (pendingFetch !== controller) return;
    pendingFetch = null;
    if (result.status === "ok") {
      update({ fetch: { status: "fetched", models: result.models } });
    } else if (result.status === "failed") {
      update({ fetch: { status: "failed", message: result.message } });
    } else {
      update({ fetch: { status: "idle" } });
    }
  }

  function abortPendingFetch(): void {
    pendingFetch?.abort();
    pendingFetch = null;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setName: (name) => update({ name }),
    setBaseUrl(baseUrl) {
      abortPendingTest();
      update({ baseUrl, test: { status: "idle" } });
    },
    setApiKey(apiKey) {
      abortPendingTest();
      update({ apiKey, test: { status: "idle" } });
    },
    setModelDraft: (modelDraft) => update({ modelDraft }),
    addModel() {
      if (!state.canAddModel) return;
      update({
        ...withModel({ id: values.modelDraft.trim() }),
        modelDraft: "",
        modelDraftGeneration: values.modelDraftGeneration + 1,
      });
    },
    removeModel(id) {
      update(withoutModel(id));
    },
    setDefaultModel(id) {
      if (!values.models.some((model) => model.id === id)) return;
      update({ defaultModelId: id });
    },
    fetchModels() {
      if (!state.canFetch) return;
      abortPendingFetch();
      const controller = new AbortController();
      pendingFetch = controller;
      update({ fetch: { status: "fetching" } });
      void runFetch(controller);
    },
    cancelFetch() {
      if (!pendingFetch) return;
      abortPendingFetch();
      update({ fetch: { status: "idle" } });
    },
    setModelSearch: (modelSearch) => update({ modelSearch }),
    toggleModel(id) {
      if (values.models.some((model) => model.id === id)) {
        update(withoutModel(id));
        return;
      }
      const fetchedModel =
        values.fetch.status === "fetched"
          ? values.fetch.models.find((model) => model.id === id)
          : undefined;
      if (fetchedModel) update(withModel(fetchedModel));
    },
    setMapping(tier, modelId) {
      if (!showMapping) return;
      if (modelId !== null && !values.models.some((model) => model.id === modelId)) return;
      const { [tier]: _previous, ...rest } = values.mapping;
      update({ mapping: modelId === null ? rest : { ...rest, [tier]: modelId } });
    },
    testConnection(modelId) {
      if (!state.canTest || !values.models.some((model) => model.id === modelId)) return;
      const controller = new AbortController();
      pendingTest = controller;
      update({ test: { status: "testing", modelId } });
      void runTest(controller, modelId);
    },
    cancelTest() {
      if (!pendingTest) return;
      abortPendingTest();
      update({ test: { status: "idle" } });
    },
    async submit() {
      const request = buildRequest();
      if (!request) return false;
      update({ submitting: true, submitError: null });
      const result = await deps.save(request);
      update({
        submitting: false,
        submitError: result.status === "failed" ? result.message : null,
      });
      return result.status === "saved";
    },
    close() {
      abortPendingFetch();
      abortPendingTest();
      closed = true;
      listeners.clear();
    },
  };
}

function deriveFetchedRows(
  values: Pick<Values, "fetch" | "modelSearch" | "models">,
): Pick<ApiEndpointFormState, "fetchedRows" | "hiddenFetchedCount"> {
  if (values.fetch.status !== "fetched") return { fetchedRows: [], hiddenFetchedCount: 0 };
  const query = values.modelSearch.trim().toLowerCase();
  const matches = query
    ? values.fetch.models.filter(
        (model) =>
          model.id.toLowerCase().includes(query) ||
          (model.label?.toLowerCase().includes(query) ?? false),
      )
    : values.fetch.models;
  const checked = new Set(values.models.map((model) => model.id));
  return {
    fetchedRows: matches
      .slice(0, MAX_FETCHED_ROWS)
      .map((model) => ({ model, checked: checked.has(model.id) })),
    hiddenFetchedCount: Math.max(0, matches.length - MAX_FETCHED_ROWS),
  };
}

// 原生端的 URL 实现不完整，用正则做粗校验；严格校验在 daemon。
const HTTP_URL = /^https?:\/\/[^\s/?#]+[^\s]*$/i;

function isHttpUrl(value: string): boolean {
  return HTTP_URL.test(value);
}
