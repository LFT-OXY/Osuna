import {
  API_ENDPOINT_REQUEST_FORMATS,
  type ApiEndpoint,
  type ApiEndpointModelDefaults,
  type ApiEndpointModelSetting,
  type ApiEndpointModelSettings,
  type ApiEndpointRequestFormat,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  choosableEfforts,
  MODEL_TOKEN_FIELDS,
  resolveModelFacts,
  settleModelDefaults,
  isRequestFormat,
  settleModelSetting,
  upstreamModelName,
  type ModelTokenField,
} from "@getpaseo/protocol/api-endpoint/model-settings";

/*
 * 「模型设置」窗口与详情页「整家默认」的表单模型：纯 TypeScript，无 React（docs/forms.md）。
 * 打开时按这家已存的模型设置填好；输入框空着就是用自动的值，框里灰字显示自动的值是多少（整家默认在 Osuna 自动取到的前面）。
 * 有没有改动按 protocol 的 settleModelSetting 收拢后比较，和 daemon 存的是同一份规则：勾回全部档位不算改动。
 * 保存时整份模型设置一起交给 daemon。
 * 「全部恢复默认」去掉这个模型的全部设置并立刻保存；显示名旁的「恢复默认」只清空显示名，保存时才算。
 * 上游模型名空着就按整家默认（`*` 换成模型 id），灰字写出现在发的名字；「只用这种格式」照 magpie 的 Names & levels：
 * 这家有两种以上格式的地址时可选「自动」或其中一种，存着的格式没地址了也列出来并说明已作废。
 */

export type TokenFieldName = ModelTokenField;

export interface TokenField {
  text: string;
  // 灰字：空着时用的值；不知道为 null。
  automatic: number | null;
  invalid: boolean;
}

/** 按界面语言写 token 数（千分位），并认回这种写法。 */
export interface TokenFormat {
  format(value: number): string;
  // 这种语言的千分位符号（如 en 的「,」、es 的「.」、ar 的「٬」）。
  group: string;
  // 这种语言写数字用的字符到 0–9（ar 写阿拉伯-印度数字）。
  digits: ReadonlyMap<string, string>;
}

/**
 * 界面语言的千分位写法（Intl）。千分位符号从一百万里读：有的语言（es）四位数不分组，从 1000 读不到。
 */
export function tokenFormatOf(locale: string): TokenFormat {
  const numbers = new Intl.NumberFormat(locale);
  const grouped = numbers.formatToParts(1_000_000).find((part) => part.type === "group");
  const digits = new Map<string, string>();
  for (let digit = 0; digit <= 9; digit += 1) digits.set(numbers.format(digit), String(digit));
  return { format: (value) => numbers.format(value), group: grouped?.value ?? ",", digits };
}

export type ModelSettingsStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "restoring" }
  | { kind: "failed"; message: string };

export interface ModelSettingsFormState {
  modelId: string;
  name: { text: string; automatic: string; generation: number };
  context: TokenField;
  output: TokenField;
  compact: TokenField;
  // levels：能勾的档位；picked：勾着的；isSet：用户设过（没设时按自动的档位）。
  efforts: { levels: string[]; picked: string[]; isSet: boolean };
  images: { value: boolean; isSet: boolean };
  // automatic：空着时发给这家的名字。
  upstreamName: { text: string; automatic: string };
  format: FormatChoice;
  status: ModelSettingsStatus;
  // 有改动、数都读得懂、不在保存中。
  canSubmit: boolean;
  isBusy: boolean;
}

/**
 * 「只用这种格式」：options 是可选的格式（不含「自动」），没有就不显示这一项；value 为 null 即自动；
 * isVoid：选着的格式这家已没有地址（设置作废，照 magpie 仍显示它）。
 */
export interface FormatChoice {
  options: ApiEndpointRequestFormat[];
  value: ApiEndpointRequestFormat | null;
  isVoid: boolean;
}

/** 这家可以给模型选的格式：有两种以上格式的地址时是它们（照 magpie modelAPIs），按协议的顺序。 */
export function choosableFormats(
  endpoint: Pick<ApiEndpoint, "baseUrls">,
): ApiEndpointRequestFormat[] {
  const formats = API_ENDPOINT_REQUEST_FORMATS.filter((format) =>
    (endpoint.baseUrls ?? []).some((entry) => entry.format === format),
  );
  return formats.length < 2 ? [] : formats;
}

/** 存着的格式：中转站认的才算；不认识的（手改的文件）当自动，daemon 本来就不收。 */
function storedFormatOf(setting: ApiEndpointModelSetting): ApiEndpointRequestFormat | null {
  const { format } = setting;
  return format !== undefined && isRequestFormat(format) ? format : null;
}

function formatChoiceOf(input: {
  choosable: ApiEndpointRequestFormat[];
  stored: ApiEndpointRequestFormat | null;
  value: ApiEndpointRequestFormat | null;
  hasUrl: (format: ApiEndpointRequestFormat) => boolean;
}): FormatChoice {
  const { choosable, stored, value } = input;
  // 存着的格式不在可选里（地址没了，或这家只剩一种地址）也列出来，免得看不到它设着什么（照 magpie）。
  const isListed = stored === null || choosable.includes(stored);
  const options = isListed ? choosable : [...choosable, stored];
  return { options, value, isVoid: value !== null && !input.hasUrl(value) };
}

export type FormSubmitResult = "saved" | "failed" | "invalid";

/**
 * 交出改动：拿保存那一刻这家的模型设置算出整份新的（页面开着时别处可能已改过别的模型），返回失败原因，成功为 null。
 */
export type SaveModelSettings = (
  update: (current: ApiEndpointModelSettings | undefined) => ApiEndpointModelSettings,
) => Promise<string | null>;

export interface ModelSettingsFormInput {
  endpoint: ApiEndpoint;
  modelId: string;
  save: SaveModelSettings;
  tokenFormat: TokenFormat;
}

export interface ModelSettingsForm {
  getState(): ModelSettingsFormState;
  subscribe(listener: () => void): () => void;
  setName(text: string): void;
  restoreName(): void;
  setTokens(field: TokenFieldName, text: string): void;
  toggleEffort(level: string): void;
  setImages(value: boolean): void;
  setUpstreamName(text: string): void;
  // null 即自动。
  setFormat(format: ApiEndpointRequestFormat | null): void;
  submit(): Promise<FormSubmitResult>;
  restoreDefaults(): Promise<FormSubmitResult>;
}

type ParsedTokens = { kind: "empty" } | { kind: "count"; value: number } | { kind: "invalid" };

/**
 * 认空白、逗号、下划线、这种语言的千分位符号与数字写法；也认 magpie 的简写（ParseTokens、parseContexts）：
 * 带 k、m 的数，前面可以有小数点（272k、1.5m），不分大小写。不是大于零的整数为 invalid。
 */
export function parseTokens(text: string, tokenFormat: TokenFormat): ParsedTokens {
  const ascii = [...text].map((char) => tokenFormat.digits.get(char) ?? char).join("");
  const compact = ascii.toLowerCase().replace(/[\s_]/g, "");
  if (compact === "") return { kind: "empty" };
  const shorthand = /^(\d+(?:\.\d+)?)([km])$/.exec(compact);
  if (shorthand) {
    const [, number = "", unit] = shorthand;
    return tokenCount(Math.round(Number(number) * (unit === "m" ? 1_000_000 : 1_000)));
  }
  const cleaned = compact.replace(/,/g, "").split(tokenFormat.group).join("");
  if (!/^\d+$/.test(cleaned)) return { kind: "invalid" };
  return tokenCount(Number(cleaned));
}

function tokenCount(value: number): ParsedTokens {
  const isTokenCount = value > 0 && Number.isSafeInteger(value);
  return isTokenCount ? { kind: "count", value } : { kind: "invalid" };
}

function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: T) {
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** 三个 token 数输入框：模型设置窗口与整家默认共用。 */
function createTokenInputs(input: { initial: ApiEndpointModelDefaults; tokenFormat: TokenFormat }) {
  const { tokenFormat } = input;
  const texts = {} as Record<TokenFieldName, string>;
  for (const field of MODEL_TOKEN_FIELDS) {
    const value = input.initial[field];
    texts[field] = value === undefined ? "" : tokenFormat.format(value);
  }
  const parsed = (field: TokenFieldName) => parseTokens(texts[field], tokenFormat);
  return {
    set(field: TokenFieldName, text: string) {
      texts[field] = text;
    },
    field(field: TokenFieldName, automatic: number | null): TokenField {
      return { text: texts[field], automatic, invalid: parsed(field).kind === "invalid" };
    },
    /** 填了的数；有读不懂的为 null。 */
    values(): ApiEndpointModelDefaults | null {
      const out: ApiEndpointModelDefaults = {};
      for (const field of MODEL_TOKEN_FIELDS) {
        const result = parsed(field);
        if (result.kind === "invalid") return null;
        if (result.kind === "count") out[field] = result.value;
      }
      return out;
    },
  };
}

export function openModelSettingsForm(input: ModelSettingsFormInput): ModelSettingsForm {
  const { endpoint, modelId } = input;
  const settings = endpoint.modelSettings ?? {};
  const own: ApiEndpointModelSetting = settings.models?.[modelId] ?? {};
  const auto = endpoint.modelFacts?.[modelId] ?? {};
  // 灰字：不看这个模型自己的设置，只看整家默认与自动取到的。
  const defaultsOnly = settings.defaults ? { defaults: settings.defaults } : undefined;
  const fallback = resolveModelFacts({ settings: defaultsOnly, modelId, auto });
  const levels = choosableEfforts(auto.efforts);
  const autoPicked = auto.efforts?.length ? auto.efforts : [];
  const autoImages = auto.images ?? false;

  let name = own.name ?? "";
  let nameGeneration = 0;
  const tokens = createTokenInputs({ initial: own, tokenFormat: input.tokenFormat });
  let efforts: string[] | null = own.efforts ?? null;
  let images: boolean | null = own.images ?? null;
  let upstreamName = own.upstreamName ?? "";
  const storedFormat = storedFormatOf(own);
  let format = storedFormat;
  const choosable = choosableFormats(endpoint);
  const hasUrl = (candidate: ApiEndpointRequestFormat) =>
    (endpoint.baseUrls ?? []).some((entry) => entry.format === candidate);
  const automaticUpstreamName = upstreamModelName({ settings: defaultsOnly, modelId });
  let status: ModelSettingsStatus = { kind: "idle" };

  /** 按 daemon 的同一份规则收拢后的这个模型的设置；有读不懂的数为 null。 */
  function settledEntry(): ApiEndpointModelSetting | null {
    const counts = tokens.values();
    if (counts === null) return null;
    const raw: ApiEndpointModelSetting = { ...counts, name, upstreamName };
    if (efforts !== null) raw.efforts = efforts;
    if (images !== null) raw.images = images;
    if (format !== null) raw.format = format;
    const settled = settleModelSetting({
      setting: raw,
      knownEfforts: auto.efforts,
      // 线上的自动资料不分清单明说的与 models.dev 补的，留给 daemon 判断（setImages 切回原样时已不算改动）。
      listedImages: undefined,
    });
    return settled.kind === "settled" ? settled.setting : null;
  }
  const initial = JSON.stringify(settledEntry());

  function tokenField(field: TokenFieldName): TokenField {
    return tokens.field(field, fallback[field] ?? null);
  }

  function build(): ModelSettingsFormState {
    const entry = settledEntry();
    const isBusy = status.kind === "saving" || status.kind === "restoring";
    const isReadable = entry !== null;
    const isChanged = JSON.stringify(entry) !== initial;
    const picked =
      efforts === null ? autoPicked : levels.filter((level) => efforts?.includes(level));
    const imagesValue = images ?? autoImages;
    return {
      modelId,
      name: { text: name, automatic: fallback.name ?? modelId, generation: nameGeneration },
      context: tokenField("context"),
      output: tokenField("output"),
      compact: tokenField("compact"),
      efforts: { levels, picked, isSet: efforts !== null },
      images: { value: imagesValue, isSet: images !== null },
      upstreamName: { text: upstreamName, automatic: automaticUpstreamName },
      format: formatChoiceOf({ choosable, stored: storedFormat, value: format, hasUrl }),
      status,
      canSubmit: !isBusy && isReadable && isChanged,
      isBusy,
    };
  }

  const store = createStore(build());
  const publish = () => store.set(build());

  async function saveWith(
    entry: ApiEndpointModelSetting | null,
    busy: "saving" | "restoring",
  ): Promise<FormSubmitResult> {
    status = { kind: busy };
    publish();
    const failure = await input.save((current) => withModelSetting({ current, modelId, entry }));
    status = failure === null ? { kind: "idle" } : { kind: "failed", message: failure };
    publish();
    return failure === null ? "saved" : "failed";
  }

  return {
    getState: store.get,
    subscribe: store.subscribe,
    setName(text) {
      name = text;
      publish();
    },
    restoreName() {
      name = "";
      nameGeneration += 1;
      publish();
    },
    setTokens(field, text) {
      tokens.set(field, text);
      publish();
    },
    toggleEffort(level) {
      const current = efforts ?? autoPicked;
      const isPicked = current.includes(level);
      efforts = isPicked ? current.filter((kept) => kept !== level) : [...current, level];
      publish();
    },
    setImages(value) {
      // 切回打开时的样子就是没改。
      const opened = own.images ?? autoImages;
      images = value === opened ? (own.images ?? null) : value;
      publish();
    },
    setUpstreamName(text) {
      upstreamName = text;
      publish();
    },
    setFormat(next) {
      format = next;
      publish();
    },
    async submit() {
      const entry = settledEntry();
      if (entry === null) return "invalid";
      return saveWith(entry, "saving");
    },
    restoreDefaults() {
      return saveWith(null, "restoring");
    },
  };
}

export type ModelDefaultsStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "failed"; message: string };

export interface ModelDefaultsFormState {
  context: TokenField;
  output: TokenField;
  compact: TokenField;
  // 整家的上游模型名：`*` 换成模型 id，没有 `*` 时每个模型都用这个名字。
  upstreamName: string;
  status: ModelDefaultsStatus;
  canSubmit: boolean;
}

export interface ModelDefaultsForm {
  getState(): ModelDefaultsFormState;
  subscribe(listener: () => void): () => void;
  setTokens(field: TokenFieldName, text: string): void;
  setUpstreamName(text: string): void;
  submit(): Promise<FormSubmitResult>;
}

/** 整家默认：上下文、回复上限、压缩阈值与上游模型名；空着就是没设（每个模型按自己自动取到的）。 */
export function openModelDefaultsForm(input: {
  endpoint: ApiEndpoint;
  save: SaveModelSettings;
  tokenFormat: TokenFormat;
}): ModelDefaultsForm {
  const initial = input.endpoint.modelSettings?.defaults ?? {};
  const tokens = createTokenInputs({ initial, tokenFormat: input.tokenFormat });
  let upstreamName = initial.upstreamName ?? "";
  function settledDefaults(): ApiEndpointModelDefaults | null {
    const counts = tokens.values();
    if (counts === null) return null;
    const settled = settleModelDefaults({ ...counts, upstreamName });
    return settled.kind === "settled" ? settled.setting : null;
  }
  let saved = JSON.stringify(settledDefaults());
  let status: ModelDefaultsStatus = { kind: "idle" };

  function build(): ModelDefaultsFormState {
    const next = settledDefaults();
    const isSaving = status.kind === "saving";
    const isReadable = next !== null;
    const isChanged = JSON.stringify(next) !== saved;
    return {
      context: tokens.field("context", null),
      output: tokens.field("output", null),
      compact: tokens.field("compact", null),
      upstreamName,
      status,
      canSubmit: !isSaving && isReadable && isChanged,
    };
  }

  const store = createStore(build());
  const publish = () => store.set(build());

  return {
    getState: store.get,
    subscribe: store.subscribe,
    setTokens(field, text) {
      tokens.set(field, text);
      publish();
    },
    setUpstreamName(text) {
      upstreamName = text;
      publish();
    },
    async submit() {
      const next = settledDefaults();
      if (next === null) return "invalid";
      status = { kind: "saving" };
      publish();
      const failure = await input.save((current) => withDefaults({ current, defaults: next }));
      if (failure === null) saved = JSON.stringify(next);
      status = failure === null ? { kind: "idle" } : { kind: "failed", message: failure };
      publish();
      return failure === null ? "saved" : "failed";
    },
  };
}

/** 换掉一个模型的设置；entry 为 null 或空即去掉它。 */
function withModelSetting(input: {
  current: ApiEndpointModelSettings | undefined;
  modelId: string;
  entry: ApiEndpointModelSetting | null;
}): ApiEndpointModelSettings {
  const { current, modelId, entry } = input;
  const { [modelId]: _own, ...models } = current?.models ?? {};
  const hasEntry = entry !== null && Object.keys(entry).length > 0;
  if (hasEntry) models[modelId] = entry;
  const next: ApiEndpointModelSettings = {};
  if (current?.defaults) next.defaults = current.defaults;
  if (Object.keys(models).length > 0) next.models = models;
  return next;
}

/** 换掉整家默认；空的即去掉。 */
function withDefaults(input: {
  current: ApiEndpointModelSettings | undefined;
  defaults: ApiEndpointModelDefaults;
}): ApiEndpointModelSettings {
  const next: ApiEndpointModelSettings = {};
  if (Object.keys(input.defaults).length > 0) next.defaults = input.defaults;
  if (input.current?.models) next.models = input.current.models;
  return next;
}

/**
 * 只改一个模型的「只用这种格式」，它别的设置与整家默认照旧；format 为 null 即回到自动（模型行菜单、自动检测的「只在…上问」用）。
 */
export function withModelFormat(input: {
  current: ApiEndpointModelSettings | undefined;
  modelId: string;
  format: ApiEndpointRequestFormat | null;
}): ApiEndpointModelSettings {
  const { current, modelId, format } = input;
  const { format: _format, ...rest } = current?.models?.[modelId] ?? {};
  const entry: ApiEndpointModelSetting = format === null ? rest : { ...rest, format };
  return withModelSetting({ current, modelId, entry });
}
