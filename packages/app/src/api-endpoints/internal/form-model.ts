import type {
  ApiEndpoint,
  ApiEndpointModel,
  ApiEndpointSaveRequest,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/*
 * 第三方接口的新建/编辑表单模型：纯 TypeScript，无 React（docs/forms.md）。
 * API key 只写不读：编辑时输入框从空开始，留空提交就不带 apiKey，daemon 保留原 key。
 */

export type ApiEndpointFormSeed =
  | { mode: "create"; provider: string }
  | { mode: "edit"; provider: string; endpoint: ApiEndpoint };

export type ApiEndpointSaveRequestInput = Omit<ApiEndpointSaveRequest, "type" | "requestId">;

export type ApiEndpointSaveResult = { ok: true } | { ok: false; message: string };

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
  baseUrlInvalid: boolean;
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
  submitting: boolean;
  submitError: string | null;
}

export function createApiEndpointFormModel(
  seed: ApiEndpointFormSeed,
  deps: { save: (request: ApiEndpointSaveRequestInput) => Promise<ApiEndpointSaveResult> },
): ApiEndpointFormModel {
  const listeners = new Set<() => void>();
  let closed = false;
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
          submitting: false,
          submitError: null,
        };
  let state = derive(values);

  function derive(next: Values): ApiEndpointFormState {
    const hasSavedKey = seed.mode === "edit" && seed.endpoint.hasApiKey;
    const draft = next.modelDraft.trim();
    const baseUrlInvalid = next.baseUrl.trim() !== "" && !isHttpUrl(next.baseUrl.trim());
    const hasKey = next.apiKey.trim() !== "" || hasSavedKey;
    return {
      mode: seed.mode,
      ...next,
      hasSavedKey,
      baseUrlInvalid,
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
    return {
      provider: seed.provider,
      ...(seed.mode === "edit" ? { endpointId: seed.endpoint.id } : {}),
      name: values.name.trim(),
      baseUrl: values.baseUrl.trim(),
      ...(apiKey ? { apiKey } : {}),
      models: values.models,
      defaultModelId: values.defaultModelId,
    };
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setName: (name) => update({ name }),
    setBaseUrl: (baseUrl) => update({ baseUrl }),
    setApiKey: (apiKey) => update({ apiKey }),
    setModelDraft: (modelDraft) => update({ modelDraft }),
    addModel() {
      if (!state.canAddModel) return;
      const id = values.modelDraft.trim();
      update({
        models: [...values.models, { id }],
        defaultModelId: values.defaultModelId ?? id,
        modelDraft: "",
        modelDraftGeneration: values.modelDraftGeneration + 1,
      });
    },
    removeModel(id) {
      const models = values.models.filter((model) => model.id !== id);
      update({
        models,
        defaultModelId:
          values.defaultModelId === id ? (models[0]?.id ?? null) : values.defaultModelId,
      });
    },
    setDefaultModel(id) {
      if (!values.models.some((model) => model.id === id)) return;
      update({ defaultModelId: id });
    },
    async submit() {
      const request = buildRequest();
      if (!request) return false;
      update({ submitting: true, submitError: null });
      const result = await deps.save(request);
      update({ submitting: false, submitError: result.ok ? null : result.message });
      return result.ok;
    },
    close() {
      closed = true;
      listeners.clear();
    },
  };
}

// 原生端的 URL 实现不完整，用正则做粗校验；严格校验在 daemon。
const HTTP_URL = /^https?:\/\/[^\s/?#]+[^\s]*$/i;

function isHttpUrl(value: string): boolean {
  return HTTP_URL.test(value);
}
