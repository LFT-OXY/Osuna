import {
  API_ENDPOINT_REQUEST_FORMATS,
  type ApiEndpoint,
  type ApiEndpointDetectFormatsRequest,
  type ApiEndpointFormatDetection,
  type ApiEndpointRequestFormat,
  type ApiEndpointSaveRequest,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/*
 * 第三方接口「添加 / 编辑连接」弹窗的表单模型：纯 TypeScript，无 React（docs/forms.md）。
 * 只管连接：名称、一把 key、自动检测用的地址、三种格式的地址；模型在详情页挑，编辑时原样带回。
 * key 只写不读：编辑时从空开始，留空提交就不带 apiKey，daemon 保留原 key；自动检测同理带 endpointId。
 * 主机声明了 apiEndpointManagement 时 key 选填：没 key 也能检测、保存，daemon 不带认证头；老主机仍要 key。
 */

export type ConnectionFormSeed = { mode: "create" } | { mode: "edit"; endpoint: ApiEndpoint };

// provider 由调用方补上：接口是主机共用的，按哪个 provider 存都一样。
export type ConnectionSaveRequest = Omit<ApiEndpointSaveRequest, "type" | "requestId" | "provider">;

export type ConnectionSaveResult =
  | { status: "saved"; endpointId: string }
  | { status: "failed"; message: string };

export type ConnectionDetectRequest = Omit<ApiEndpointDetectFormatsRequest, "type" | "requestId">;

// failed：请求本身没成立（缺 key、地址无效、断线）；每种格式的失败在 done 的 results 里。
export type ConnectionDetectResult =
  | { status: "done"; results: ApiEndpointFormatDetection[] }
  | { status: "failed"; message: string }
  | { status: "cancelled" };

// 一种格式的检测结论；null 是没检测过，或检测之后改过这一栏。
export type FormatDetectionLabel = "ok" | "not_detected" | "auth_failed";

export interface ConnectionFormatField {
  format: ApiEndpointRequestFormat;
  url: string;
  detection: FormatDetectionLabel | null;
  invalid: boolean;
}

export interface ConnectionFormOptions {
  // 主机声明了 apiEndpointManagement：key 可以不填。
  isKeyOptional: boolean;
}

export interface ConnectionFormState {
  mode: "create" | "edit";
  name: string;
  apiKey: string;
  hasSavedKey: boolean;
  isKeyOptional: boolean;
  address: string;
  addressInvalid: boolean;
  formats: ConnectionFormatField[];
  // 自动检测改写了地址栏时加一，输入框据此换成新值。
  urlGeneration: number;
  detecting: boolean;
  detectError: string | null;
  // 上游拒绝了这把 key（401 / 403）；改 key 之前一直标红。
  keyRejected: boolean;
  canDetect: boolean;
  canSubmit: boolean;
  submitting: boolean;
  submitError: string | null;
}

export interface ConnectionFormDeps {
  save: (request: ConnectionSaveRequest) => Promise<ConnectionSaveResult>;
  detect: (
    request: ConnectionDetectRequest,
    signal: AbortSignal,
  ) => Promise<ConnectionDetectResult>;
}

export interface ConnectionFormModel {
  getState(): ConnectionFormState;
  subscribe(listener: () => void): () => void;
  setName(value: string): void;
  setApiKey(value: string): void;
  setAddress(value: string): void;
  setUrl(format: ApiEndpointRequestFormat, value: string): void;
  detect(): void;
  cancelDetect(): void;
  submit(): Promise<ConnectionSaveResult | null>;
  close(): void;
}

type Urls = Record<ApiEndpointRequestFormat, string>;
type Labels = Partial<Record<ApiEndpointRequestFormat, FormatDetectionLabel>>;

interface Values {
  name: string;
  apiKey: string;
  address: string;
  urls: Urls;
  urlGeneration: number;
  labels: Labels;
  detecting: boolean;
  detectError: string | null;
  submitting: boolean;
  submitError: string | null;
}

const EMPTY_URLS: Urls = { anthropic_messages: "", openai_chat: "", openai_responses: "" };

export function createConnectionFormModel(
  seed: ConnectionFormSeed,
  deps: ConnectionFormDeps,
  options: ConnectionFormOptions,
): ConnectionFormModel {
  const { isKeyOptional } = options;
  const listeners = new Set<() => void>();
  const hasSavedKey = seed.mode === "edit" && seed.endpoint.hasApiKey;
  let closed = false;
  // 当前这次自动检测；取消或重新检测后，旧请求晚到的结果不再生效。
  let pendingDetect: AbortController | null = null;
  const seededUrls = seed.mode === "edit" ? urlsOf(seed.endpoint) : EMPTY_URLS;
  let values: Values = {
    name: seed.mode === "edit" ? seed.endpoint.name : "",
    apiKey: "",
    address: API_ENDPOINT_REQUEST_FORMATS.map((format) => seededUrls[format]).find(Boolean) ?? "",
    urls: seededUrls,
    urlGeneration: 0,
    labels: {},
    detecting: false,
    detectError: null,
    submitting: false,
    submitError: null,
  };
  let state = derive(values);

  function derive(next: Values): ConnectionFormState {
    const hasKey = isKeyOptional || next.apiKey.trim() !== "" || hasSavedKey;
    const address = next.address.trim();
    const addressInvalid = address !== "" && !isHttpUrl(address);
    const formats = API_ENDPOINT_REQUEST_FORMATS.map((format) => {
      const url = next.urls[format];
      return {
        format,
        url,
        detection: next.labels[format] ?? null,
        invalid: url.trim() !== "" && !isHttpUrl(url.trim()),
      };
    });
    const keyRejected = Object.values(next.labels).includes("auth_failed");
    // 至少填了一个地址，且填了的都像 http(s) 地址。
    const hasValidUrls =
      formats.some((field) => field.url.trim() !== "") && !formats.some((field) => field.invalid);
    const hasValidAddress = address !== "" && !addressInvalid;
    // 检测或保存进行中时两个按钮都不可点。
    const busy = next.detecting || next.submitting;
    return {
      mode: seed.mode,
      name: next.name,
      apiKey: next.apiKey,
      hasSavedKey,
      isKeyOptional,
      address: next.address,
      addressInvalid,
      formats,
      urlGeneration: next.urlGeneration,
      detecting: next.detecting,
      detectError: next.detectError,
      keyRejected,
      canDetect: !busy && hasKey && hasValidAddress,
      canSubmit: !busy && next.name.trim() !== "" && hasKey && hasValidUrls,
      submitting: next.submitting,
      submitError: next.submitError,
    };
  }

  function update(patch: Partial<Values>): void {
    if (closed) return;
    values = { ...values, ...patch };
    state = derive(values);
    for (const listener of listeners) listener();
  }

  function abortPendingDetect(): void {
    pendingDetect?.abort();
    pendingDetect = null;
  }

  function typedKey(): string | undefined {
    const apiKey = values.apiKey.trim();
    return apiKey === "" ? undefined : apiKey;
  }

  async function runDetect(controller: AbortController): Promise<void> {
    const apiKey = typedKey();
    const outcome = await deps.detect(
      {
        ...(seed.mode === "edit" && !apiKey ? { endpointId: seed.endpoint.id } : {}),
        baseUrl: values.address.trim(),
        ...(apiKey ? { apiKey } : {}),
      },
      controller.signal,
    );
    if (pendingDetect !== controller) return;
    pendingDetect = null;
    if (outcome.status === "failed") {
      update({ detecting: false, detectError: outcome.message });
      return;
    }
    if (outcome.status === "cancelled") {
      update({ detecting: false });
      return;
    }
    // 检测通过的填上建议地址；没通过的保留原值，用户手填的不被抹掉。
    const urls = { ...values.urls };
    const labels: Labels = {};
    for (const result of outcome.results) {
      const format = API_ENDPOINT_REQUEST_FORMATS.find((candidate) => candidate === result.format);
      if (!format) continue;
      labels[format] = toLabel(result.status);
      if (result.status === "ok") urls[format] = result.url;
    }
    update({
      detecting: false,
      urls,
      labels,
      urlGeneration: values.urlGeneration + 1,
    });
  }

  function buildRequest(): ConnectionSaveRequest {
    const apiKey = typedKey();
    const baseUrls = API_ENDPOINT_REQUEST_FORMATS.flatMap((format) => {
      const url = values.urls[format].trim();
      return url ? [{ format, url }] : [];
    });
    const endpoint = seed.mode === "edit" ? seed.endpoint : null;
    return {
      ...(endpoint ? { endpointId: endpoint.id } : {}),
      name: values.name.trim(),
      baseUrls,
      ...(apiKey ? { apiKey } : {}),
      // 连接弹窗不挑模型：新建时一个都没有，编辑时把已选模型与档位映射原样带回。
      models: endpoint?.models ?? [],
      ...(endpoint?.modelMapping ? { modelMapping: endpoint.modelMapping } : {}),
    };
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setName: (name) => update({ name }),
    setApiKey(apiKey) {
      abortPendingDetect();
      update({ apiKey, labels: {}, detecting: false, detectError: null });
    },
    setAddress(address) {
      abortPendingDetect();
      update({ address, labels: {}, detecting: false, detectError: null });
    },
    setUrl(format, url) {
      const { [format]: _dropped, ...labels } = values.labels;
      update({ urls: { ...values.urls, [format]: url }, labels });
    },
    detect() {
      if (!state.canDetect) return;
      abortPendingDetect();
      const controller = new AbortController();
      pendingDetect = controller;
      update({ detecting: true, detectError: null, labels: {} });
      void runDetect(controller);
    },
    cancelDetect() {
      if (!pendingDetect) return;
      abortPendingDetect();
      update({ detecting: false });
    },
    async submit() {
      if (!state.canSubmit) return null;
      update({ submitting: true, submitError: null });
      const result = await deps.save(buildRequest());
      update({
        submitting: false,
        submitError: result.status === "failed" ? result.message : null,
      });
      return result;
    },
    close() {
      abortPendingDetect();
      closed = true;
      listeners.clear();
    },
  };
}

function urlsOf(endpoint: ApiEndpoint): Urls {
  const urls = { ...EMPTY_URLS };
  for (const entry of endpoint.baseUrls ?? []) {
    const format = API_ENDPOINT_REQUEST_FORMATS.find((candidate) => candidate === entry.format);
    if (format) urls[format] = entry.url;
  }
  return urls;
}

// 线上 status 是字符串；认不出的新结论按「未检测到」显示。
function toLabel(status: string): FormatDetectionLabel {
  if (status === "ok" || status === "auth_failed") return status;
  return "not_detected";
}

// 原生端的 URL 实现不完整，用正则做粗校验；严格校验在 daemon。
const HTTP_URL = /^https?:\/\/[^\s/?#]+[^\s]*$/i;

function isHttpUrl(value: string): boolean {
  return HTTP_URL.test(value);
}
