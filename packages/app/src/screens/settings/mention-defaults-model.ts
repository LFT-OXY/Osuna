import type {
  AgentModelDefinition,
  ProviderSnapshotEntry,
  ProviderStatus,
} from "@osuna/protocol/agent-types";
import type { ProviderMentionDefaults } from "@osuna/protocol/provider-config";

/**
 * 「提及 Agent 默认值」卡片的纯视图模型。回退规则与 daemon 的
 * `packages/server/src/server/agent/routing-block.ts` `resolveAgainstCatalog` 一致：
 * 卡片显示的"默认（X）"和"将使用默认（X）"就是发送时 Routing block 写出的值。
 */

export type MentionDefaultsField = keyof ProviderMentionDefaults;

export const MENTION_DEFAULTS_FIELDS = [
  "model",
  "thinkingOptionId",
  "modeId",
] as const satisfies readonly MentionDefaultsField[];

export interface MentionDefaultsOption {
  id: string;
  label: string;
}

export type MentionDefaultsFieldView =
  /** 目录没就绪、出错或 provider 不可用：只能显示已存的原值。 */
  | { kind: "unresolved"; storedValue: string | null }
  | { kind: "unsupported" }
  | { kind: "default"; defaultLabel: string | null }
  | { kind: "set"; label: string }
  | { kind: "stale"; storedValue: string; fallbackLabel: string | null };

export interface MentionDefaultsFieldModel {
  view: MentionDefaultsFieldView;
  /** 下拉首项"默认（X）"里的 X；取不到时为 null。 */
  defaultLabel: string | null;
  options: MentionDefaultsOption[];
  /** 目录里有、且已存的选项 id；未设或失效时为 null。 */
  selectedId: string | null;
}

export type MentionDefaultsFields = Record<MentionDefaultsField, MentionDefaultsFieldModel>;

export type MentionDefaultsSummary =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "allDefault" }
  | { kind: "values"; parts: string[]; othersDefault: boolean };

export interface MentionDefaultsProviderModel {
  status: ProviderStatus;
  fields: MentionDefaultsFields;
  summary: MentionDefaultsSummary;
  hasStale: boolean;
  hasOverrides: boolean;
}

export type MentionDefaultsPickNotice =
  | { kind: "thinkingReset"; defaultLabel: string | null }
  | { kind: "thinkingUnsupported"; modelLabel: string };

export interface MentionDefaultsPick {
  entry: ProviderSnapshotEntry;
  stored: ProviderMentionDefaults | undefined;
  field: MentionDefaultsField;
  /** null 表示选了"默认（X）"，清除该项。 */
  value: string | null;
}

export interface MentionDefaultsPickResult {
  next: ProviderMentionDefaults;
  notice: MentionDefaultsPickNotice | null;
}

interface EffectiveModel {
  model: AgentModelDefinition | null;
  /** 已存的模型不在目录里。 */
  isStale: boolean;
}

interface FieldViewInput {
  stored: string | undefined;
  options: MentionDefaultsOption[];
  defaultLabel: string | null;
  /** 模型失效时档位跟着失效，与 daemon 一致。 */
  forceStale: boolean;
  canBeUnsupported: boolean;
}

function toOption({ id, label }: MentionDefaultsOption): MentionDefaultsOption {
  return { id, label };
}

function selectableModels(entry: ProviderSnapshotEntry): AgentModelDefinition[] {
  return entry.models?.filter((model) => model.isSelectable !== false) ?? [];
}

function selectDefaultModel(models: readonly AgentModelDefinition[]): AgentModelDefinition | null {
  return models.find((model) => model.isDefault) ?? models[0] ?? null;
}

function defaultThinkingId(model: AgentModelDefinition | null): string | null {
  const fromModel = model?.defaultThinkingOptionId;
  const fromOptions = model?.thinkingOptions?.find((option) => option.isDefault)?.id;
  return fromModel ?? fromOptions ?? null;
}

function thinkingOptions(model: AgentModelDefinition | null): MentionDefaultsOption[] {
  return model?.thinkingOptions?.map(toOption) ?? [];
}

function labelOf(options: readonly MentionDefaultsOption[], id: string | null | undefined) {
  return options.find((option) => option.id === id)?.label ?? null;
}

/** 按目录解析出生效的模型：已存且在目录里就用它，否则用默认模型。 */
function resolveEffectiveModel(
  models: readonly AgentModelDefinition[],
  storedModel: string | undefined,
): EffectiveModel {
  const configured = storedModel ? models.find((model) => model.id === storedModel) : undefined;
  return {
    model: configured ?? selectDefaultModel(models),
    isStale: storedModel !== undefined && !configured,
  };
}

function fieldView(input: FieldViewInput): MentionDefaultsFieldView {
  const { stored, options, defaultLabel } = input;
  if (stored === undefined) {
    const hasNoOptions = input.canBeUnsupported && options.length === 0;
    return hasNoOptions ? { kind: "unsupported" } : { kind: "default", defaultLabel };
  }
  const label = labelOf(options, stored);
  if (label === null || input.forceStale) {
    return { kind: "stale", storedValue: stored, fallbackLabel: defaultLabel };
  }
  return { kind: "set", label };
}

function fieldModel(input: FieldViewInput): MentionDefaultsFieldModel {
  const view = fieldView(input);
  return {
    view,
    defaultLabel: input.defaultLabel,
    options: input.options,
    selectedId: view.kind === "set" ? (input.stored ?? null) : null,
  };
}

function buildReadyFields(
  entry: ProviderSnapshotEntry,
  stored: ProviderMentionDefaults,
): MentionDefaultsFields {
  const models = selectableModels(entry);
  const effective = resolveEffectiveModel(models, stored.model);
  const levelOptions = thinkingOptions(effective.model);
  const modeOptions = (entry.modes ?? []).map(toOption);
  const defaultModeLabel = labelOf(modeOptions, entry.defaultModeId) ?? modeOptions[0]?.label;

  return {
    model: fieldModel({
      stored: stored.model,
      options: models.map(toOption),
      defaultLabel: selectDefaultModel(models)?.label ?? null,
      forceStale: false,
      canBeUnsupported: false,
    }),
    thinkingOptionId: fieldModel({
      stored: stored.thinkingOptionId,
      options: levelOptions,
      defaultLabel: labelOf(levelOptions, defaultThinkingId(effective.model)),
      forceStale: effective.isStale,
      canBeUnsupported: true,
    }),
    modeId: fieldModel({
      stored: stored.modeId,
      options: modeOptions,
      defaultLabel: defaultModeLabel ?? null,
      forceStale: false,
      canBeUnsupported: true,
    }),
  };
}

function unresolvedField(value: string | undefined): MentionDefaultsFieldModel {
  return {
    view: { kind: "unresolved", storedValue: value ?? null },
    defaultLabel: null,
    options: [],
    selectedId: null,
  };
}

function buildUnresolvedFields(stored: ProviderMentionDefaults): MentionDefaultsFields {
  return {
    model: unresolvedField(stored.model),
    thinkingOptionId: unresolvedField(stored.thinkingOptionId),
    modeId: unresolvedField(stored.modeId),
  };
}

/** 摘要里显示的值：设了的显示名称，失效或读不到目录的显示原值。 */
function summaryPart(view: MentionDefaultsFieldView): string | null {
  switch (view.kind) {
    case "set":
      return view.label;
    case "stale":
      return view.storedValue;
    case "unresolved":
      return view.storedValue;
    default:
      return null;
  }
}

function buildSummary(
  status: ProviderStatus,
  fields: MentionDefaultsFields,
): MentionDefaultsSummary {
  if (status === "loading") return { kind: "loading" };
  if (status === "unavailable") return { kind: "unavailable" };
  const parts = MENTION_DEFAULTS_FIELDS.flatMap((field) => summaryPart(fields[field].view) ?? []);
  if (parts.length === 0) return { kind: "allDefault" };
  return { kind: "values", parts, othersDefault: parts.length < MENTION_DEFAULTS_FIELDS.length };
}

export function buildMentionDefaultsProviderModel(
  entry: ProviderSnapshotEntry,
  stored: ProviderMentionDefaults | undefined,
): MentionDefaultsProviderModel {
  const values = stored ?? {};
  const catalogReady = entry.status === "ready";
  const fields = catalogReady ? buildReadyFields(entry, values) : buildUnresolvedFields(values);
  return {
    status: entry.status,
    fields,
    summary: buildSummary(entry.status, fields),
    hasStale: MENTION_DEFAULTS_FIELDS.some((field) => fields[field].view.kind === "stale"),
    hasOverrides: MENTION_DEFAULTS_FIELDS.some((field) => values[field] !== undefined),
  };
}

function thinkingClearedNotice(
  model: AgentModelDefinition | null,
): MentionDefaultsPickNotice | null {
  if (!model) return null;
  const levels = thinkingOptions(model);
  if (levels.length === 0) return { kind: "thinkingUnsupported", modelLabel: model.label };
  return { kind: "thinkingReset", defaultLabel: labelOf(levels, defaultThinkingId(model)) };
}

/**
 * 选中一项后要写入的整份 `mentionDefaults`（daemon 整体替换）。换模型后已选档位不属于新模型时清回默认，
 * 并给出要短暂提示的内容。
 */
export function applyMentionDefaultsPick(pick: MentionDefaultsPick): MentionDefaultsPickResult {
  const next: ProviderMentionDefaults = { ...pick.stored };
  if (pick.value === null) {
    delete next[pick.field];
  } else {
    next[pick.field] = pick.value;
  }
  const storedLevel = next.thinkingOptionId;
  const modelMayDropLevel = pick.field === "model" && storedLevel !== undefined;
  if (!modelMayDropLevel) return { next, notice: null };

  const { model } = resolveEffectiveModel(selectableModels(pick.entry), next.model);
  const modelOffersLevel = thinkingOptions(model).some((option) => option.id === storedLevel);
  if (modelOffersLevel) return { next, notice: null };

  delete next.thinkingOptionId;
  return { next, notice: thinkingClearedNotice(model) };
}
