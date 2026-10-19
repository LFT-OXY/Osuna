import {
  API_ENDPOINT_REQUEST_FORMATS,
  type ApiEndpoint,
  type ApiEndpointDetectFormatsRequest,
  type ApiEndpointFormatDetection,
  type ApiEndpointRequestFormat,
  type ApiEndpointSaveRequest,
  type ApiEndpointTemplate,
  type ApiEndpointTemplateRegion,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { siteChoicesOf, type TemplateSiteChoice } from "./templates";

/*
 * 第三方接口「添加 / 编辑连接」弹窗的表单模型：纯 TypeScript，无 React（docs/forms.md）。
 * 只管连接：名称、一把 key、自动检测用的地址、三种格式的地址；模型在详情页挑，编辑时原样带回。
 * key 框从空开始：留空提交就不带 apiKey，daemon 保留原 key；自动检测同理带 endpointId。
 * 主机声明了 apiEndpointManagement 时 key 选填：没 key 也能检测、保存，daemon 不带认证头；老主机仍要 key。
 * 同样只在这种主机上：「复制」以原来那家开一个新建表单（key 留空即沿用它的，daemon 拷），key 框旁有「显示」，
 * 编辑时按它读回已存 key 的原文放进框里；读回来的不算新 key，改了才算（照 magpie）。
 * 从模板（Template）添加时名称与各格式地址按模板填好，不用自动检测；有区域或套餐的可切换，新建时国际站与中国站也可切换，
 * 切换只保留 key（照 magpie：切区域保留名称，切站点连名称一起换）。编辑从模板加的接口时同样能切区域或套餐。
 * 要填用户自己资源地址的模板（Azure OpenAI，endpointExample）没有地址：表单只要一个资源地址，原样当 Chat 与
 * Responses 的地址保存，daemon 把它放到资源的 v1 API 上（照 magpie 编辑窗口的 Endpoint 框）。
 */

export type ConnectionFormSeed =
  // templateId 为 null 是「自定义」；「再加一家」用那家的模板。认不出的模板按「自定义」开。
  | { mode: "create"; templateId: string | null }
  | { mode: "edit"; endpoint: ApiEndpoint }
  // name 是调用方按界面语言起好的「原名 副本」；重名由 daemon 避让。
  | { mode: "duplicate"; source: ApiEndpoint; name: string };

// provider 由调用方补上：接口是主机共用的，按哪个 provider 存都一样。
export type ConnectionSaveRequest = Omit<ApiEndpointSaveRequest, "type" | "requestId" | "provider">;

export type ConnectionSaveResult =
  | { status: "saved"; endpointId: string }
  | { status: "failed"; message: string };

export type ConnectionRevealKeyResult =
  | { status: "revealed"; apiKey: string | null }
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
  // 同上：key 框旁有「显示」，能读回已存的 key。
  canRevealKey: boolean;
  // 主机给的模板清单；老主机没有，为空。
  templates: readonly ApiEndpointTemplate[];
}

/** 表单用的模板：区域或套餐、站点（国际 / 中国，只在新建时）与当前的「去拿 key」页面。 */
export interface ConnectionTemplateState {
  id: string;
  name: string;
  note: string | null;
  keyHint: string | null;
  // daemon 给的字符串：region（区域）或 plan（套餐）。
  regionLabel: string;
  regions: { id: string; name: string }[] | null;
  regionId: string | null;
  sites: TemplateSiteChoice[] | null;
  keysUrl: string | null;
  // 官网：区域或套餐有自己的文档页时跟着它（照 magpie 编辑窗口顶上的链接）。
  websiteUrl: string | null;
  // 要填自己资源地址的模板：地址框的示例与框下的英文说明；别的模板为 null。
  endpointExample: string | null;
  endpointHint: string | null;
}

export interface ConnectionFormState {
  mode: ConnectionFormSeed["mode"];
  // 「自定义」或模板认不出时为 null。
  template: ConnectionTemplateState | null;
  name: string;
  // 换站点改写了名称时加一，名称框据此换成新值。
  nameGeneration: number;
  // 用户打的 key；空即不换（编辑保留原 key，复制沿用原来那家的）。
  apiKey: string;
  // key 框里显示的值与它换值的次数：读回已存的 key 时放进去，再藏起来时清掉；不是用户打的不进 apiKey。
  keyBoxValue: string;
  keyBoxGeneration: number;
  // 编辑时这家已存了 key；复制时原来那家有 key。
  hasSavedKey: boolean;
  canShowKey: boolean;
  isKeyVisible: boolean;
  isRevealingKey: boolean;
  revealError: string | null;
  isKeyOptional: boolean;
  address: string;
  addressInvalid: boolean;
  // 资源地址（template.endpointExample 不为 null 时才用）：就是 Chat 与 Responses 的地址。
  endpoint: string;
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
  revealKey: (endpointId: string) => Promise<ConnectionRevealKeyResult>;
}

export interface ConnectionFormModel {
  getState(): ConnectionFormState;
  subscribe(listener: () => void): () => void;
  setName(value: string): void;
  // 切区域或套餐：各格式地址与「去拿 key」页面跟着换，key 与名称保留。
  setRegion(regionId: string): void;
  // 新建时切国际站 / 中国站：只保留 key，其余按那个模板重来。
  setSite(templateId: string): void;
  setApiKey(value: string): void;
  // 「显示 / 隐藏」：编辑已存了 key、框里没打新的时先读回原文。
  toggleKeyVisible(): void;
  setAddress(value: string): void;
  // 填自己资源地址的模板：Chat 与 Responses 都用它。
  setEndpoint(value: string): void;
  setUrl(format: ApiEndpointRequestFormat, value: string): void;
  detect(): void;
  cancelDetect(): void;
  submit(): Promise<ConnectionSaveResult | null>;
  close(): void;
}

type Urls = Record<ApiEndpointRequestFormat, string>;
type Labels = Partial<Record<ApiEndpointRequestFormat, FormatDetectionLabel>>;

interface Values {
  template: ApiEndpointTemplate | null;
  regionId: string | null;
  name: string;
  nameGeneration: number;
  apiKey: string;
  keyBoxValue: string;
  keyBoxGeneration: number;
  isKeyVisible: boolean;
  // 框里是读回来的原 key，不是用户打的。
  isKeyRevealed: boolean;
  isRevealingKey: boolean;
  revealError: string | null;
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
  const { isKeyOptional, canRevealKey, templates } = options;
  const listeners = new Set<() => void>();
  // 编辑的这家，或复制的原来那家：没打 key 时检测、保存都用它已存的 key。
  const keyOwner = keyOwnerOf(seed);
  const hasSavedKey = keyOwner?.hasApiKey === true;
  let closed = false;
  // 当前这次自动检测；取消或重新检测后，旧请求晚到的结果不再生效。
  let pendingDetect: AbortController | null = null;
  const seededTemplate = templateOf(seed, templates);
  const seededRegion = seededTemplate ? initialRegionOf(seed, seededTemplate) : null;
  const seededUrls = initialUrlsOf({
    keyOwner,
    template: seededTemplate,
    region: seededRegion,
  });
  let values: Values = {
    template: seededTemplate,
    regionId: seededRegion?.id ?? null,
    name: seededTemplate && seed.mode === "create" ? seededTemplate.name : initialNameOf(seed),
    nameGeneration: 0,
    apiKey: "",
    keyBoxValue: "",
    keyBoxGeneration: 0,
    isKeyVisible: false,
    isKeyRevealed: false,
    isRevealingKey: false,
    revealError: null,
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
    const endpoint = next.urls.openai_chat;
    const asksEndpoint = next.template?.endpointExample !== undefined;
    // 至少填了一个地址，且填了的都像 http(s) 地址；资源地址只有资源名也行，由 daemon 补全并校验。
    const hasValidUrls = asksEndpoint
      ? endpoint.trim() !== ""
      : formats.some((field) => field.url.trim() !== "") && !formats.some((field) => field.invalid);
    const hasValidAddress = address !== "" && !addressInvalid;
    // 检测或保存进行中时两个按钮都不可点。
    const busy = next.detecting || next.submitting;
    return {
      mode: seed.mode,
      template: next.template ? templateStateOf(next.template, next.regionId) : null,
      name: next.name,
      nameGeneration: next.nameGeneration,
      apiKey: next.apiKey,
      keyBoxValue: next.keyBoxValue,
      keyBoxGeneration: next.keyBoxGeneration,
      hasSavedKey,
      canShowKey: canRevealKey,
      isKeyVisible: next.isKeyVisible,
      isRevealingKey: next.isRevealingKey,
      revealError: next.revealError,
      isKeyOptional,
      address: next.address,
      addressInvalid,
      endpoint,
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

  function templateStateOf(
    template: ApiEndpointTemplate,
    regionId: string | null,
  ): ConnectionTemplateState {
    const region = template.regions?.find((candidate) => candidate.id === regionId) ?? null;
    return {
      id: template.id,
      name: template.name,
      note: template.note ?? null,
      keyHint: template.keyHint ?? null,
      regionLabel: template.regionLabel ?? "region",
      regions: template.regions?.map(({ id, name }) => ({ id, name })) ?? null,
      regionId,
      // 国际站与中国站只在新建时切换（照 magpie）。
      sites: seed.mode === "create" ? siteChoicesOf(templates, template.id) : null,
      keysUrl: region?.keysUrl ?? template.keysUrl ?? null,
      websiteUrl: region?.website ?? template.website ?? null,
      endpointExample: template.endpointExample ?? null,
      endpointHint: template.endpointHint ?? null,
    };
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
        ...(keyOwner && !apiKey ? { endpointId: keyOwner.id } : {}),
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
    return {
      ...(seed.mode === "edit" ? { endpointId: seed.endpoint.id } : {}),
      name: values.name.trim(),
      baseUrls,
      ...(apiKey ? { apiKey } : {}),
      ...(values.template ? { templateId: values.template.id } : {}),
      ...(values.regionId ? { region: values.regionId } : {}),
      // 连接弹窗不挑模型：新建时一个都没有，编辑、复制时把已选模型与档位映射原样带上。
      models: keyOwner?.models ?? [],
      ...(keyOwner?.modelMapping ? { modelMapping: keyOwner.modelMapping } : {}),
      // 复制：上游清单、手动添加的模型、联网搜索开关等其余设置由 daemon 从原来那家拷。
      ...(seed.mode === "duplicate" ? { copyOf: seed.source.id } : {}),
    };
  }

  async function runReveal(endpointId: string): Promise<void> {
    const outcome = await deps.revealKey(endpointId);
    if (!values.isRevealingKey) return;
    if (outcome.status === "failed") {
      update({ isRevealingKey: false, revealError: outcome.message });
      return;
    }
    // 等的时候已经打了新 key，或这家其实没存 key：只把框里的显示出来，不拿原 key 盖掉。
    const hasTypedKey = values.apiKey !== "";
    const savedKey = outcome.apiKey;
    if (hasTypedKey || savedKey === null) {
      update({ isRevealingKey: false, isKeyVisible: true });
      return;
    }
    update({
      isRevealingKey: false,
      isKeyVisible: true,
      isKeyRevealed: true,
      keyBoxValue: savedKey,
      keyBoxGeneration: values.keyBoxGeneration + 1,
    });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setName: (name) => update({ name }),
    setRegion(regionId) {
      const region = values.template?.regions?.find((candidate) => candidate.id === regionId);
      if (!values.template || !region) return;
      update({
        regionId,
        urls: urlsOf(region.baseUrls),
        labels: {},
        urlGeneration: values.urlGeneration + 1,
      });
    },
    setSite(templateId) {
      const template = templates.find((candidate) => candidate.id === templateId);
      const isSiteChoice = state.template?.sites?.some(
        (choice) => choice.templateId === templateId,
      );
      if (!template || !isSiteChoice) return;
      const region = template.regions?.[0] ?? null;
      update({
        template,
        regionId: region?.id ?? null,
        name: template.name,
        nameGeneration: values.nameGeneration + 1,
        urls: urlsOf(templateBaseUrls(template, region)),
        labels: {},
        urlGeneration: values.urlGeneration + 1,
      });
    },
    setApiKey(apiKey) {
      abortPendingDetect();
      update({
        apiKey,
        keyBoxValue: apiKey,
        isRevealingKey: false,
        revealError: null,
        labels: {},
        detecting: false,
        detectError: null,
      });
    },
    toggleKeyVisible() {
      if (!canRevealKey || values.isRevealingKey) return;
      if (values.isKeyVisible) {
        // 读回来又没改的原 key 不留在框里（照 magpie）。
        const clearsBox = values.isKeyRevealed && values.apiKey === "";
        update({
          isKeyVisible: false,
          isKeyRevealed: false,
          ...(clearsBox ? { keyBoxValue: "", keyBoxGeneration: values.keyBoxGeneration + 1 } : {}),
        });
        return;
      }
      const readsSavedKey = seed.mode === "edit" && hasSavedKey && values.apiKey === "";
      if (readsSavedKey) {
        update({ isRevealingKey: true, revealError: null });
        void runReveal(seed.endpoint.id);
        return;
      }
      update({ isKeyVisible: true, revealError: null });
    },
    setAddress(address) {
      abortPendingDetect();
      update({ address, labels: {}, detecting: false, detectError: null });
    },
    setEndpoint(endpoint) {
      update({ urls: { ...values.urls, openai_chat: endpoint, openai_responses: endpoint } });
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

function initialNameOf(seed: ConnectionFormSeed): string {
  if (seed.mode === "edit") return seed.endpoint.name;
  if (seed.mode === "duplicate") return seed.name;
  return "";
}

function keyOwnerOf(seed: ConnectionFormSeed): ApiEndpoint | null {
  if (seed.mode === "edit") return seed.endpoint;
  if (seed.mode === "duplicate") return seed.source;
  return null;
}

/** 模板起步的那家：新建是 templateId 指的，编辑、复制是这家记下的；清单里没有就当「自定义」。 */
function templateOf(
  seed: ConnectionFormSeed,
  templates: readonly ApiEndpointTemplate[],
): ApiEndpointTemplate | null {
  const templateId =
    seed.mode === "create" ? seed.templateId : (keyOwnerOf(seed)?.templateId ?? null);
  if (templateId === null) return null;
  return templates.find((candidate) => candidate.id === templateId) ?? null;
}

/** 新建从第一个区域或套餐起步；编辑、复制用这家记下的，没记或已不在模板里时也用第一个（照 magpie）。 */
function initialRegionOf(
  seed: ConnectionFormSeed,
  template: ApiEndpointTemplate,
): ApiEndpointTemplateRegion | null {
  const regions = template.regions ?? [];
  const saved = keyOwnerOf(seed)?.region;
  return regions.find((candidate) => candidate.id === saved) ?? regions[0] ?? null;
}

/** 编辑、复制从这家存的地址起步；新建从模板（和它的第一个区域）起步；「自定义」全空。 */
function initialUrlsOf(input: {
  keyOwner: ApiEndpoint | null;
  template: ApiEndpointTemplate | null;
  region: ApiEndpointTemplateRegion | null;
}): Urls {
  if (input.keyOwner) return urlsOf(input.keyOwner.baseUrls ?? []);
  if (input.template) return urlsOf(templateBaseUrls(input.template, input.region));
  return EMPTY_URLS;
}

function templateBaseUrls(
  template: ApiEndpointTemplate,
  region: ApiEndpointTemplateRegion | null,
): ApiEndpointTemplate["baseUrls"] {
  return region?.baseUrls ?? template.baseUrls;
}

function urlsOf(baseUrls: ApiEndpointTemplate["baseUrls"]): Urls {
  const urls = { ...EMPTY_URLS };
  for (const entry of baseUrls) {
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
