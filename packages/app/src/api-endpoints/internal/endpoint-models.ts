import {
  API_ENDPOINT_MODEL_TIERS,
  type ApiEndpointModel,
  type ApiEndpointModelCatalog,
  type ApiEndpointModelMapping,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { MODEL_FAMILIES, modelFamilyOf, type ModelFamilyId } from "./model-families";

/*
 * 接口详情页「模型」区的纯计算。清单 = 上次拉回来的上游模型 + 手动添加的 + 已选却两边都不在的；
 * 开关只决定是否在已选（models）里。拉回来的默认关；上游没了的已选模型留着并标出来。
 */

export interface ModelSource {
  models: ApiEndpointModel[];
  // null：还没拉过，这时无从判断上游有没有。
  catalog: ApiEndpointModelCatalog | null;
  manualModels: ApiEndpointModel[];
}

export interface ModelEntry {
  id: string;
  label?: string;
  family: ModelFamilyId;
  selected: boolean;
  manual: boolean;
  // 已选、不是手动添加，而上次拉回来的清单里没有。
  goneUpstream: boolean;
}

export function buildModelEntries(source: ModelSource): ModelEntry[] {
  const selectedIds = new Set(source.models.map((model) => model.id));
  const manualIds = new Set(source.manualModels.map((model) => model.id));
  const upstream = source.catalog?.models ?? [];
  const upstreamIds = new Set(upstream.map((model) => model.id));
  const seen = new Set<string>();
  const entries: ModelEntry[] = [];
  for (const model of [...upstream, ...source.manualModels, ...source.models]) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    const manual = manualIds.has(model.id);
    const selected = selectedIds.has(model.id);
    const missingFromLastFetch = source.catalog !== null && !upstreamIds.has(model.id);
    entries.push({
      id: model.id,
      ...(model.label ? { label: model.label } : {}),
      family: modelFamilyOf(model.id),
      selected,
      manual,
      goneUpstream: selected && !manual && missingFromLastFetch,
    });
  }
  return entries;
}

export interface ModelFamilyGroup {
  family: ModelFamilyId;
  // 计数不随搜索变。
  selected: number;
  total: number;
  // 搜索命中的模型；没有搜索时是整组。
  matches: ModelEntry[];
}

/** 按家族固定顺序分组；搜索时只留有命中的家族。 */
export function groupModelEntries(entries: ModelEntry[], query: string): ModelFamilyGroup[] {
  const needle = query.trim().toLowerCase();
  const matchesQuery = (entry: ModelEntry) =>
    !needle ||
    entry.id.toLowerCase().includes(needle) ||
    (entry.label?.toLowerCase().includes(needle) ?? false);
  const groups: ModelFamilyGroup[] = [];
  for (const { id: family } of MODEL_FAMILIES) {
    const members = entries.filter((entry) => entry.family === family);
    const matches = members.filter(matchesQuery);
    if (matches.length === 0) continue;
    groups.push({
      family,
      selected: members.filter((entry) => entry.selected).length,
      total: members.length,
      matches,
    });
  }
  return groups;
}

export function setModelSelected({
  models,
  entry,
  selected,
}: {
  models: ApiEndpointModel[];
  entry: Pick<ModelEntry, "id" | "label">;
  selected: boolean;
}): ApiEndpointModel[] {
  const without = models.filter((model) => model.id !== entry.id);
  if (!selected) return without;
  return [...without, toModel(entry)];
}

/** 当前显示的这组都开着时按钮是「全不选」。 */
export function familySelectAllState(group: ModelFamilyGroup): "selectAll" | "selectNone" {
  return group.matches.every((entry) => entry.selected) ? "selectNone" : "selectAll";
}

/** 全选 / 全不选只作用于这组当前显示的模型（搜索时即命中的那些）。 */
export function setFamilySelected({
  models,
  group,
  selected,
}: {
  models: ApiEndpointModel[];
  group: ModelFamilyGroup;
  selected: boolean;
}): ApiEndpointModel[] {
  const shownIds = new Set(group.matches.map((entry) => entry.id));
  if (!selected) return models.filter((model) => !shownIds.has(model.id));
  const selectedIds = new Set(models.map((model) => model.id));
  return [...models, ...group.matches.filter((entry) => !selectedIds.has(entry.id)).map(toModel)];
}

/** 手动添加的模型记作手动添加并直接打开；已有的不重复加。 */
export function addManualModels(
  current: Pick<ModelSource, "models" | "manualModels">,
  ids: string[],
): Pick<ModelSource, "models" | "manualModels"> {
  const append = (list: ApiEndpointModel[]) => {
    const present = new Set(list.map((entry) => entry.id));
    return [...list, ...ids.filter((id) => !present.has(id)).map((id) => ({ id }))];
  };
  return { models: append(current.models), manualModels: append(current.manualModels) };
}

/** 添加框里打的模型 id：按逗号与换行拆开（id 里可以有空格，照 magpie typedIds），去掉空的与重复的。 */
export function typedModelIds(text: string): string[] {
  const ids = text
    .split(/[,\n]/)
    .map((id) => id.trim())
    .filter((id) => id !== "");
  return [...new Set(ids)];
}

/** daemon 拒绝指向未选模型的档位；关掉模型时把指向它的档位一起去掉。 */
export function keepMappingWithin(
  mapping: ApiEndpointModelMapping | undefined,
  models: ApiEndpointModel[],
): ApiEndpointModelMapping | undefined {
  if (!mapping) return undefined;
  const kept: ApiEndpointModelMapping = {};
  for (const tier of API_ENDPOINT_MODEL_TIERS) {
    const modelId = mapping[tier];
    if (modelId && models.some((model) => model.id === modelId)) kept[tier] = modelId;
  }
  return Object.keys(kept).length === 0 ? undefined : kept;
}

function toModel(entry: Pick<ModelEntry, "id" | "label">): ApiEndpointModel {
  return entry.label ? { id: entry.id, label: entry.label } : { id: entry.id };
}
