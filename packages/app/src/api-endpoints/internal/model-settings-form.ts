import type {
  ApiEndpoint,
  ApiEndpointModelDefaults,
  ApiEndpointModelSetting,
  ApiEndpointModelSettings,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  choosableEfforts,
  resolveModelFacts,
} from "@getpaseo/protocol/api-endpoint/model-settings";

/*
 * 「模型设置」窗口与详情页「整家默认」的表单模型：纯 TypeScript，无 React（docs/forms.md）。
 * 打开时按这家已存的模型设置填好；输入框空着就是用自动的值，框里灰字显示自动的值是多少（整家默认在 Osuna 自动取到的前面）。
 * 只把改过的项写进这个模型的设置，保存时整份模型设置一起交给 daemon（它按 protocol 的 model-settings.ts 收拢）。
 * 「恢复默认」去掉这个模型的全部设置并立刻保存；显示名旁的「恢复默认」只清空显示名，保存时才算。
 */

export type TokenFieldName = "context" | "output" | "compact";

export interface TokenField {
  text: string;
  // 灰字：空着时用的值；不知道为 null。
  automatic: number | null;
  invalid: boolean;
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
  status: ModelSettingsStatus;
  // 有改动、数都读得懂、不在保存中。
  canSubmit: boolean;
  isBusy: boolean;
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
}

export interface ModelSettingsForm {
  getState(): ModelSettingsFormState;
  subscribe(listener: () => void): () => void;
  setName(text: string): void;
  restoreName(): void;
  setTokens(field: TokenFieldName, text: string): void;
  toggleEffort(level: string): void;
  setImages(value: boolean): void;
  submit(): Promise<FormSubmitResult>;
  restoreDefaults(): Promise<FormSubmitResult>;
}

/** 「200000」「200,000」「200 000」都认；不是大于零的整数为 invalid。 */
export function parseTokens(text: string):
  | { kind: "empty" }
  | { kind: "count"; value: number }
  | {
      kind: "invalid";
    } {
  const cleaned = text.replace(/[\s,_]/g, "");
  if (cleaned === "") return { kind: "empty" };
  if (!/^\d+$/.test(cleaned)) return { kind: "invalid" };
  const value = Number(cleaned);
  return value > 0 && Number.isSafeInteger(value) ? { kind: "count", value } : { kind: "invalid" };
}

function tokenText(value: number | undefined): string {
  return value === undefined ? "" : String(value);
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

export function openModelSettingsForm(input: ModelSettingsFormInput): ModelSettingsForm {
  const { endpoint, modelId } = input;
  const settings = endpoint.modelSettings ?? {};
  const own: ApiEndpointModelSetting = settings.models?.[modelId] ?? {};
  const auto = endpoint.modelFacts?.[modelId] ?? {};
  // 灰字：不看这个模型自己的设置，只看整家默认与自动取到的。
  const fallback = resolveModelFacts({
    settings: settings.defaults ? { defaults: settings.defaults } : undefined,
    modelId,
    auto,
  });
  const levels = choosableEfforts(auto.efforts);
  const autoPicked = auto.efforts?.length ? auto.efforts : [];

  let name = own.name ?? "";
  let nameGeneration = 0;
  const tokens: Record<TokenFieldName, string> = {
    context: tokenText(own.context),
    output: tokenText(own.output),
    compact: tokenText(own.compact),
  };
  let efforts: string[] | null = own.efforts ?? null;
  let images: boolean | null = own.images ?? null;
  let status: ModelSettingsStatus = { kind: "idle" };
  const initial = JSON.stringify(entryOf());

  function entryOf(): ApiEndpointModelSetting | null {
    const entry: ApiEndpointModelSetting = {};
    const trimmed = name.trim();
    if (trimmed !== "") entry.name = trimmed;
    for (const field of ["context", "output", "compact"] as const) {
      const parsed = parseTokens(tokens[field]);
      if (parsed.kind === "invalid") return null;
      if (parsed.kind === "count") entry[field] = parsed.value;
    }
    if (efforts !== null) entry.efforts = levels.filter((level) => efforts?.includes(level));
    if (images !== null) entry.images = images;
    return entry;
  }

  function tokenField(field: TokenFieldName): TokenField {
    return {
      text: tokens[field],
      automatic: fallback[field] ?? null,
      invalid: parseTokens(tokens[field]).kind === "invalid",
    };
  }

  function build(): ModelSettingsFormState {
    const entry = entryOf();
    const isBusy = status.kind === "saving" || status.kind === "restoring";
    return {
      modelId,
      name: { text: name, automatic: fallback.name ?? modelId, generation: nameGeneration },
      context: tokenField("context"),
      output: tokenField("output"),
      compact: tokenField("compact"),
      efforts: {
        levels,
        picked: efforts === null ? autoPicked : levels.filter((level) => efforts?.includes(level)),
        isSet: efforts !== null,
      },
      images: { value: images ?? auto.images ?? false, isSet: images !== null },
      status,
      canSubmit: !isBusy && entry !== null && JSON.stringify(entry) !== initial,
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
    const failure = await input.save((current) => withModelSetting(current, modelId, entry));
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
      tokens[field] = text;
      publish();
    },
    toggleEffort(level) {
      const current = efforts ?? autoPicked;
      efforts = current.includes(level)
        ? current.filter((kept) => kept !== level)
        : [...current, level];
      publish();
    },
    setImages(value) {
      images = value;
      publish();
    },
    async submit() {
      const entry = entryOf();
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
  status: ModelDefaultsStatus;
  canSubmit: boolean;
}

export interface ModelDefaultsForm {
  getState(): ModelDefaultsFormState;
  subscribe(listener: () => void): () => void;
  setTokens(field: TokenFieldName, text: string): void;
  submit(): Promise<FormSubmitResult>;
}

/** 整家默认：上下文、回复上限、压缩阈值；空着就是没设（每个模型按自己自动取到的）。 */
export function openModelDefaultsForm(input: {
  endpoint: ApiEndpoint;
  save: SaveModelSettings;
}): ModelDefaultsForm {
  const defaults = input.endpoint.modelSettings?.defaults ?? {};
  const tokens: Record<TokenFieldName, string> = {
    context: tokenText(defaults.context),
    output: tokenText(defaults.output),
    compact: tokenText(defaults.compact),
  };
  let saved = JSON.stringify(defaultsOf());
  let status: ModelDefaultsStatus = { kind: "idle" };

  function defaultsOf(): ApiEndpointModelDefaults | null {
    const out: ApiEndpointModelDefaults = {};
    for (const field of ["context", "output", "compact"] as const) {
      const parsed = parseTokens(tokens[field]);
      if (parsed.kind === "invalid") return null;
      if (parsed.kind === "count") out[field] = parsed.value;
    }
    return out;
  }

  function tokenFieldOf(name: TokenFieldName): TokenField {
    return {
      text: tokens[name],
      automatic: null,
      invalid: parseTokens(tokens[name]).kind === "invalid",
    };
  }

  function build(): ModelDefaultsFormState {
    const next = defaultsOf();
    return {
      context: tokenFieldOf("context"),
      output: tokenFieldOf("output"),
      compact: tokenFieldOf("compact"),
      status,
      canSubmit: status.kind !== "saving" && next !== null && JSON.stringify(next) !== saved,
    };
  }

  const store = createStore(build());
  const publish = () => store.set(build());

  return {
    getState: store.get,
    subscribe: store.subscribe,
    setTokens(name, text) {
      tokens[name] = text;
      publish();
    },
    async submit() {
      const next = defaultsOf();
      if (next === null) return "invalid";
      status = { kind: "saving" };
      publish();
      const failure = await input.save((current) => ({
        ...(Object.keys(next).length > 0 ? { defaults: next } : {}),
        ...(current?.models ? { models: current.models } : {}),
      }));
      if (failure === null) saved = JSON.stringify(next);
      status = failure === null ? { kind: "idle" } : { kind: "failed", message: failure };
      publish();
      return failure === null ? "saved" : "failed";
    },
  };
}

/** 换掉一个模型的设置；entry 为 null 或空即去掉它。 */
function withModelSetting(
  current: ApiEndpointModelSettings | undefined,
  modelId: string,
  entry: ApiEndpointModelSetting | null,
): ApiEndpointModelSettings {
  const { [modelId]: _own, ...others } = current?.models ?? {};
  const models = entry && Object.keys(entry).length > 0 ? { ...others, [modelId]: entry } : others;
  return {
    ...(current?.defaults ? { defaults: current.defaults } : {}),
    ...(Object.keys(models).length > 0 ? { models } : {}),
  };
}
