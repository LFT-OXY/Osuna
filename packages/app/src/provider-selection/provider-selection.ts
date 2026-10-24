import type {
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  ApiEndpointModelGroup,
  ProviderSnapshotEntry,
} from "@getpaseo/protocol/agent-types";
import {
  apiEndpointNameDisplayOf,
  showsEndpointNames,
  type ApiEndpointNameDisplay,
} from "@getpaseo/protocol/api-endpoint/endpoint-names";
import type { AgentProviderDefinition } from "@getpaseo/protocol/provider-manifest";
import type { DraftCommandTarget } from "@/hooks/use-agent-commands-query";
import { i18n } from "@/i18n/i18next";
import { compareMatchScores, scoreTextFields } from "@getpaseo/protocol/search/text-match";
import { filterSelectableModels } from "./model-catalog";
import { supportsApiEndpoints } from "@/api-endpoints";

export interface ProviderSelectionModelRow {
  /**
   * Row identity — `provider:modelId`. Used as the React key and as the row's
   * stable handle across list rebuilds. The name is historical; it has nothing
   * to do with the removed favourites feature.
   */
  favoriteKey: string;
  provider: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  description?: string;
  isDefault?: boolean;
  // 第三方接口启用时这一行所属的接口：组标题是接口名，index 是接口顺序。
  apiEndpointGroup?: ApiEndpointRowGroup;
}

export interface ApiEndpointRowGroup {
  name: string;
  index: number;
  // 接口名怎么显示（主机的接口名显示方式）：heading 每家一个组标题（一直显示）；inline 写在这一行模型名后面
  // （同名时显示，这一行和别家撞名）；none 不写。
  nameShown: "heading" | "inline" | "none";
}

function buildModelRowKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

export type ProviderModelSelection =
  | { kind: "models"; rows: ProviderSelectionModelRow[] }
  | { kind: "loading" }
  | { kind: "error"; message: string };

export interface ProviderSelectorProvider {
  id: string;
  label: string;
  modelSelection: ProviderModelSelection;
}

export interface ProviderSelectionState {
  provider: AgentProvider | null;
  modelId: string;
  modeId: string;
  thinkingOptionId: string;
  availableModels: AgentModelDefinition[];
  modeOptions: AgentMode[];
}

export interface ProviderSelectionReadiness {
  ok: boolean;
  reason?: string;
}

function buildModelRows(
  provider: string,
  providerLabel: string,
  models: AgentModelDefinition[],
): ProviderSelectionModelRow[] {
  return models.map((model) => ({
    favoriteKey: buildModelRowKey(provider, model.id),
    provider,
    providerLabel,
    modelId: model.id,
    modelLabel: model.label,
    description: model.description ?? model.id,
    isDefault: model.isDefault,
  }));
}

function buildSyntheticDefaultRow(
  provider: string,
  providerLabel: string,
): ProviderSelectionModelRow {
  return {
    favoriteKey: buildModelRowKey(provider, ""),
    provider,
    providerLabel,
    modelId: "",
    modelLabel: i18n.t("providerSelection.defaultModel"),
    description: undefined,
    isDefault: true,
  };
}

function buildModelSelection(
  provider: string,
  providerLabel: string,
  models: AgentModelDefinition[] | null,
): ProviderModelSelection {
  if (models === null) {
    return { kind: "loading" };
  }
  const selectableModels = filterSelectableModels(models) ?? [];
  if (selectableModels.length === 0) {
    return { kind: "models", rows: [buildSyntheticDefaultRow(provider, providerLabel)] };
  }
  return { kind: "models", rows: buildModelRows(provider, providerLabel, selectableModels) };
}

/**
 * 选择器与新建表单可选的模型：第三方接口启用时是按接口展开的 `接口标识/模型名`（同名模型各家一条），
 * 否则是快照里的 models。没有条目或条目还没有模型时为 null。
 */
export function selectableEntryModels(
  entry: ProviderSnapshotEntry | null | undefined,
): AgentModelDefinition[] | null {
  if (!entry) return null;
  const groupedModels = chatEndpointGroups(entry)?.flatMap((group) => group.models);
  return filterSelectableModels(groupedModels ?? entry.models ?? null);
}

/**
 * 对话里能选的按接口分组的模型：只有 Osuna 对话换成接口模型的提供方。Pi 的分组只给设置页挑默认模型，
 * 对话里还是 Pi 自己的模型（Pi 要 `osuna/` 开头的写法，工单 03 接上）。
 */
function chatEndpointGroups(entry: ProviderSnapshotEntry): ApiEndpointModelGroup[] | undefined {
  return supportsApiEndpoints(entry.provider) ? entry.apiEndpointModelGroups : undefined;
}

function buildApiEndpointGroupRows(input: {
  provider: string;
  providerLabel: string;
  groups: ApiEndpointModelGroup[];
  nameDisplay: ApiEndpointNameDisplay;
}): ProviderSelectionModelRow[] {
  const { provider, providerLabel } = input;
  const listed = input.groups.flatMap((group, index) =>
    (filterSelectableModels(group.models) ?? []).map((model) => ({ group, index, model })),
  );
  const isHeading = input.nameDisplay === "always";
  const shows = showsEndpointNames({
    display: input.nameDisplay,
    names: listed.map(({ model }) => model.label),
  });
  return listed.map(({ group, index, model }, position) => {
    let nameShown: ApiEndpointRowGroup["nameShown"] = "heading";
    if (!isHeading) nameShown = shows[position] ? "inline" : "none";
    return {
      favoriteKey: buildModelRowKey(provider, model.id),
      provider,
      providerLabel,
      modelId: model.id,
      modelLabel: model.label,
      // 不显示 id：它带着接口标识。撞名的这一行在模型名后面写接口名。
      description: nameShown === "inline" ? group.name : model.description,
      isDefault: model.isDefault,
      apiEndpointGroup: { name: group.name, index, nameShown },
    };
  });
}

function buildEntryModelSelection(
  entry: ProviderSnapshotEntry,
  label: string,
): ProviderModelSelection {
  const groups = chatEndpointGroups(entry);
  if (groups && groups.length > 0) {
    return {
      kind: "models",
      rows: buildApiEndpointGroupRows({
        provider: entry.provider,
        providerLabel: label,
        groups,
        nameDisplay:
          // COMPAT(apiEndpointNameDisplay): added in v0.17.0, remove fallback after 2027-04-20. 老主机不发，当一直显示。
          entry.apiEndpointNameDisplay === undefined
            ? "always"
            : // 认不出的方式（以后加的）当一直显示，长久保留。
              apiEndpointNameDisplayOf(entry.apiEndpointNameDisplay),
      }),
    };
  }
  if ((entry.models?.length ?? 0) > 0) {
    return buildModelSelection(entry.provider, label, entry.models ?? null);
  }
  if (entry.status === "ready") {
    return buildModelSelection(entry.provider, label, entry.models ?? null);
  }
  if (entry.status === "loading") {
    return { kind: "loading" };
  }
  return {
    kind: "error",
    message:
      entry.error ??
      (entry.status === "unavailable"
        ? i18n.t("providerSelection.unavailable")
        : i18n.t("providerSelection.unknownError")),
  };
}

export function buildProviderSelectorProviders(input: {
  providerDefinitions: AgentProviderDefinition[];
  modelsByProvider: Map<string, AgentModelDefinition[]>;
}): ProviderSelectorProvider[] {
  return input.providerDefinitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    modelSelection: buildModelSelection(
      definition.id,
      definition.label,
      input.modelsByProvider.has(definition.id)
        ? (input.modelsByProvider.get(definition.id) ?? [])
        : null,
    ),
  }));
}

export function buildSelectableProviderSelectorProviders(
  entries: ProviderSnapshotEntry[] | undefined,
): ProviderSelectorProvider[] {
  return (entries ?? [])
    .filter((entry) => entry.enabled)
    .map((entry) => {
      const label = entry.label ?? entry.provider;
      return {
        id: entry.provider,
        label,
        modelSelection: buildEntryModelSelection(entry, label),
      };
    });
}

export interface ProviderMenuItem {
  id: string;
  label: string;
}

export interface ProviderMenuGroups {
  flat: ProviderMenuItem[];
  more: ProviderMenuItem[];
}

const FLAT_PROVIDER_MENU_STATUSES = new Set<ProviderSnapshotEntry["status"]>(["ready", "loading"]);

// 可用的平铺，出错或不可用的折进「More agents」，但仍可选中去看错误并重试。
export function groupProviderMenuEntries(
  entries: ProviderSnapshotEntry[] | undefined,
): ProviderMenuGroups {
  const groups: ProviderMenuGroups = { flat: [], more: [] };
  for (const entry of entries ?? []) {
    if (!entry.enabled) continue;
    const item = { id: entry.provider, label: entry.label ?? entry.provider };
    if (FLAT_PROVIDER_MENU_STATUSES.has(entry.status)) {
      groups.flat.push(item);
    } else {
      groups.more.push(item);
    }
  }
  return groups;
}

export function getProviderModelRows(
  provider: ProviderSelectorProvider,
): ProviderSelectionModelRow[] {
  return provider.modelSelection.kind === "models" ? provider.modelSelection.rows : [];
}

export function getAllProviderModelRows(
  providers: ProviderSelectorProvider[],
): ProviderSelectionModelRow[] {
  return providers.flatMap(getProviderModelRows);
}

export function resolveSelectedModelLabel(input: {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  isLoading: boolean;
}): string {
  const selectedProvider = input.selectedProvider.trim();
  if (!selectedProvider) {
    return input.isLoading
      ? i18n.t("providerSelection.loading")
      : i18n.t("providerSelection.selectModel");
  }

  const provider = input.providers.find((entry) => entry.id === selectedProvider);
  if (!provider) {
    return input.isLoading
      ? i18n.t("providerSelection.loading")
      : i18n.t("providerSelection.selectModel");
  }
  if (provider.modelSelection.kind === "loading") {
    return i18n.t("providerSelection.loading");
  }
  if (provider.modelSelection.kind === "error") {
    return i18n.t("providerSelection.error");
  }
  if (provider.modelSelection.kind !== "models") {
    return i18n.t("providerSelection.selectModel");
  }

  const model = provider.modelSelection.rows.find((entry) => entry.modelId === input.selectedModel);
  const selectedModel = input.selectedModel.trim();
  if (!model && selectedModel) {
    return selectedModel;
  }
  const defaultModel = provider.modelSelection.rows.find((row) => row.isDefault);
  return (
    model?.modelLabel ??
    defaultModel?.modelLabel ??
    provider.modelSelection.rows[0]?.modelLabel ??
    i18n.t("providerSelection.selectModel")
  );
}

/** 会话里记的模型 id 在界面上的名字；第三方接口的 `接口标识/模型名` 读作光秃秃的模型名。 */
export function resolveSnapshotModelLabel(
  entries: readonly ProviderSnapshotEntry[] | undefined,
  provider: string,
  modelId: string,
): string {
  const entry = entries?.find((candidate) => candidate.provider === provider);
  const models = selectableEntryModels(entry);
  return models?.find((model) => model.id === modelId)?.label ?? modelId;
}

export function buildSelectedTriggerLabel(modelLabel: string): string {
  return modelLabel;
}

/**
 * Cross-provider result rows need the provider named up front: the same model
 * label ships on several providers at once.
 */
export function buildProviderQualifiedDescription(row: ProviderSelectionModelRow): string {
  const group = row.apiEndpointGroup;
  const detail = group && group.nameShown !== "none" ? group.name : row.description;
  return detail ? `${row.providerLabel} · ${detail}` : row.providerLabel;
}

export function matchesModelSearch(
  row: ProviderSelectionModelRow,
  normalizedQuery: string,
): boolean {
  return scoreModelRow(row, normalizedQuery) !== null;
}

function getModelRowSearchFields(row: ProviderSelectionModelRow): string[] {
  return [
    row.modelLabel,
    row.modelId,
    row.providerLabel,
    row.description ?? "",
    row.apiEndpointGroup?.name ?? "",
  ];
}

export function scoreModelRow(row: ProviderSelectionModelRow, normalizedQuery: string) {
  return scoreTextFields(normalizedQuery, getModelRowSearchFields(row));
}

export function filterAndRankModelRows(
  rows: ProviderSelectionModelRow[],
  normalizedQuery: string,
): ProviderSelectionModelRow[] {
  if (!normalizedQuery) return rows;
  const scored = rows
    .map((row) => ({ row, score: scoreModelRow(row, normalizedQuery) }))
    .filter(
      (
        entry,
      ): entry is { row: ProviderSelectionModelRow; score: NonNullable<typeof entry.score> } =>
        Boolean(entry.score),
    );

  scored.sort((a, b) => {
    const cmp = compareMatchScores(a.score, b.score);
    if (cmp !== 0) return cmp;
    return a.row.modelLabel.localeCompare(b.row.modelLabel);
  });

  return scored.map((entry) => entry.row);
}

export function resolveEffectiveComposerModelId(selection: ProviderSelectionState): string {
  const selectedModelId = selection.modelId.trim();
  if (selectedModelId) {
    return selectedModelId;
  }
  return (
    selection.availableModels.find((model) => model.isDefault)?.id ??
    selection.availableModels[0]?.id ??
    ""
  );
}

export function resolveEffectiveComposerThinkingOptionId(
  selection: ProviderSelectionState,
  effectiveModelId: string,
): string {
  const selectedThinkingOptionId = selection.thinkingOptionId.trim();
  if (selectedThinkingOptionId) {
    return selectedThinkingOptionId;
  }

  const selectedModelDefinition =
    selection.availableModels.find((model) => model.id === effectiveModelId) ?? null;
  return selectedModelDefinition?.defaultThinkingOptionId ?? "";
}

export function buildDraftCommandTarget(input: {
  selection: ProviderSelectionState;
  cwd: string;
  effectiveModelId: string;
  effectiveThinkingOptionId: string;
  featureValues?: Record<string, unknown>;
}): DraftCommandTarget {
  const cwd = input.cwd.trim();
  if (!cwd) {
    return { status: "needs-project" };
  }
  if (!input.selection.provider) {
    return { status: "needs-provider" };
  }

  const config = {
    provider: input.selection.provider,
    cwd,
    ...(input.selection.modeOptions.length > 0 && input.selection.modeId !== ""
      ? { modeId: input.selection.modeId }
      : {}),
    ...(input.effectiveModelId ? { model: input.effectiveModelId } : {}),
    ...(input.effectiveThinkingOptionId
      ? { thinkingOptionId: input.effectiveThinkingOptionId }
      : {}),
    ...(input.featureValues ? { featureValues: input.featureValues } : {}),
  };
  return { status: "ready", config };
}

export function resolveSubmissionReadiness(input: {
  text: string;
  allowsEmptyAutoSubmit: boolean;
  providerCount: number;
  selection: {
    provider: AgentProvider | string | null;
    modelId: string;
    availableModels: readonly unknown[];
    isModelLoading: boolean;
  };
  autoSubmitConfig: { provider: string; model: string | null } | null;
  workspaceDirectory: string | null;
  hasClient: boolean;
}): ProviderSelectionReadiness {
  if (!input.allowsEmptyAutoSubmit && !input.text.trim()) {
    return { ok: false, reason: i18n.t("providerSelection.readiness.initialPromptRequired") };
  }
  if (input.providerCount === 0) {
    return { ok: false, reason: i18n.t("providerSelection.readiness.noProviders") };
  }
  if (!(input.autoSubmitConfig?.provider ?? input.selection.provider)) {
    return { ok: false, reason: i18n.t("providerSelection.selectModel") };
  }
  if (input.selection.isModelLoading) {
    return { ok: false, reason: i18n.t("providerSelection.readiness.modelDefaultsLoading") };
  }
  const hasSelectedModel = Boolean(input.autoSubmitConfig?.model ?? input.selection.modelId);
  if (!hasSelectedModel && input.selection.availableModels.length > 0) {
    return { ok: false, reason: i18n.t("providerSelection.readiness.noModelAvailable") };
  }
  if (!input.workspaceDirectory) {
    return { ok: false, reason: i18n.t("providerSelection.readiness.workspaceDirectoryNotFound") };
  }
  if (!input.hasClient) {
    return { ok: false, reason: i18n.t("providerSelection.readiness.hostDisconnected") };
  }
  return { ok: true };
}
