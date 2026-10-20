import type { ApiEndpointRequestFormat } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { ModelFacts } from "./model-facts.js";
import type { ListedModel } from "./upstream-models.js";

/*
 * 一家接口有几种格式地址就各拉一次，按模型 id 合并成一份上游清单（照 magpie provider/models.go 的 fetchOne）。
 * 顺序以先列出的为准；显示名与模型资料先列出的格式说了算，它没说的由后面的补（prd 第 14 条）。
 * 每个模型记下哪些格式列过它（formats）：下次某种格式没答上时，它上次列过、别的格式这次也没列的模型留着（magpie #904）。
 */

export interface CatalogModel extends ListedModel {
  formats?: ApiEndpointRequestFormat[];
}

export interface FormatList {
  format: ApiEndpointRequestFormat;
  models: ListedModel[];
}

export function mergeFormatLists(lists: FormatList[]): CatalogModel[] {
  const merged: CatalogModel[] = [];
  const byId = new Map<string, CatalogModel>();
  for (const { format, models } of lists) {
    for (const model of models) {
      const existing = byId.get(model.id);
      if (!existing) {
        const entry: CatalogModel = { ...model, formats: [format] };
        byId.set(model.id, entry);
        merged.push(entry);
        continue;
      }
      if (existing.label === undefined && model.label !== undefined) existing.label = model.label;
      const facts = fillFacts(existing.facts, model.facts);
      if (facts !== undefined) existing.facts = facts;
      if (!existing.formats?.includes(format)) {
        existing.formats = [...(existing.formats ?? []), format];
      }
    }
  }
  return merged;
}

/**
 * 这次没答上的格式上次列过的模型，接在合并结果后面（照 magpie keepDeadSides）。
 * 上次的清单没记 formats（这个版本以前拉的）时无从判断，什么都不留。
 */
export function keepFailedFormats(input: {
  merged: CatalogModel[];
  previous: CatalogModel[];
  failed: ApiEndpointRequestFormat[];
}): CatalogModel[] {
  if (input.failed.length === 0) return input.merged;
  const listed = new Set(input.merged.map((model) => model.id));
  const kept: CatalogModel[] = [];
  for (const model of input.previous) {
    if (listed.has(model.id)) continue;
    const formats = (model.formats ?? []).filter((format) => input.failed.includes(format));
    if (formats.length > 0) kept.push({ ...model, formats });
  }
  return [...input.merged, ...kept];
}

function fillFacts(
  first: ModelFacts | undefined,
  later: ModelFacts | undefined,
): ModelFacts | undefined {
  if (later === undefined) return first;
  if (first === undefined) return later;
  return { ...later, ...withoutUndefined(first) };
}

function withoutUndefined(facts: ModelFacts): ModelFacts {
  return Object.fromEntries(
    Object.entries(facts).filter(([, value]) => value !== undefined),
  ) as ModelFacts;
}
