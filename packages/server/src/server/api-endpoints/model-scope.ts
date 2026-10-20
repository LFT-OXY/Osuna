import { isDeepStrictEqual } from "node:util";
import {
  autoPickRuleProblem,
  compileAutoPickRule,
  type AutoPickRuleProblem,
} from "@getpaseo/protocol/api-endpoint/auto-pick-rules";
import {
  API_ENDPOINT_MODEL_TIERS,
  type ApiEndpointModelMapping,
  type ApiEndpointModelScope,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { StoredApiEndpoint } from "./store.js";

/*
 * 服务范围与自动勾选规则（prd 第 17、18a 条）。在服务的模型总写在 models 里，选单、默认模型、档位映射、
 * 中转站路由与自动切换都只看它；「跟随接口清单」时由这里按上游清单算好写回，清单或地址一变就重算。
 * - vendor：上游清单去掉没有对应地址的模型（照 magpie NoAPIFor），超过 24 个取清单顺序的前 24 个
 *   （magpie models.go 的 manyModels），手动添加的总在里面。
 * - picked（缺省）：用户勾的那些，同样去掉没有对应地址的；自动勾选规则只在这时起作用，只加不减（照 magpie autolist.go）。
 */

type StoredModel = StoredApiEndpoint["models"][number];

export type ModelScope = ApiEndpointModelScope;

export const SERVED_LIST_LIMIT = 24;

export function followsList(endpoint: { modelScope?: string | undefined }): boolean {
  return endpoint.modelScope === "vendor";
}

/**
 * 清单说只在这家没填地址的格式上列过它（照 magpie NoAPIFor）：哪种范围都不服务它，规则也不勾它。
 * 清单没记格式的（这版以前拉的、添加窗口带来的）与手动添加的不算。
 */
function noAddressFilter(endpoint: StoredApiEndpoint): (modelId: string) => boolean {
  const formats = new Set(endpoint.baseUrls.map((entry) => entry.format));
  const manual = new Set((endpoint.manualModels ?? []).map((model) => model.id));
  const unreachable = new Set(
    (endpoint.catalog?.models ?? [])
      .filter(
        (model) =>
          model.formats !== undefined &&
          model.formats.length > 0 &&
          !model.formats.some((format) => formats.has(format)),
      )
      .map((model) => model.id),
  );
  return (modelId) => unreachable.has(modelId) && !manual.has(modelId);
}

/** 「跟随接口清单」时在服务的模型。 */
export function vendorServedModels(endpoint: StoredApiEndpoint): StoredModel[] {
  const hasNoAddress = noAddressFilter(endpoint);
  const served: StoredModel[] = (endpoint.catalog?.models ?? [])
    .filter((model) => !hasNoAddress(model.id))
    .slice(0, SERVED_LIST_LIMIT)
    .map((model) => (model.label ? { id: model.id, label: model.label } : { id: model.id }));
  const ids = new Set(served.map((model) => model.id));
  for (const model of endpoint.manualModels ?? []) {
    if (ids.has(model.id)) continue;
    ids.add(model.id);
    served.push(model);
  }
  return served;
}

export type CleanedAutoPickRules =
  | { ok: true; rules: string[] }
  | { ok: false; rule: string; problem: AutoPickRuleProblem };

/**
 * 规则按存的样子：去掉首尾空白、空的与重复的；每条都要是能用的规则（auto-pick-rules.ts，照 magpie CleanAutoInclude，
 * 用 RE2 编译，读不懂的拒收）。不能用时回是哪条、什么问题。
 */
export function cleanAutoPickRules(rules: string[]): CleanedAutoPickRules {
  const cleaned: string[] = [];
  for (const raw of rules) {
    const rule = raw.trim();
    if (rule === "" || cleaned.includes(rule)) continue;
    const problem = autoPickRuleProblem(rule);
    if (problem !== null) return { ok: false, rule, problem };
    cleaned.push(rule);
  }
  return { ok: true, rules: cleaned };
}

/**
 * 「只用挑选的」时按规则勾上清单里 isNew 说是新的、规则匹配、还没勾、有地址的模型，新勾的排在前面（照 magpie takeMatching）；
 * 已勾的不动。没有规则或没有可勾的原样返回。
 */
function withAutoPicked(
  endpoint: StoredApiEndpoint,
  isNew: (modelId: string) => boolean,
): StoredModel[] {
  // 存下的规则保存时都校验过；手改坏的跳过。
  const rules = (endpoint.autoPick ?? []).flatMap((rule) =>
    autoPickRuleProblem(rule) === null ? [compileAutoPickRule(rule)] : [],
  );
  if (rules.length === 0) return endpoint.models;
  const hasNoAddress = noAddressFilter(endpoint);
  const picked = new Set(endpoint.models.map((model) => model.id));
  const taken: StoredModel[] = [];
  for (const model of endpoint.catalog?.models ?? []) {
    if (picked.has(model.id) || !isNew(model.id) || hasNoAddress(model.id)) continue;
    if (!rules.some((rule) => rule.matches(model.id))) continue;
    picked.add(model.id);
    taken.push(model.label ? { id: model.id, label: model.label } : { id: model.id });
  }
  return taken.length === 0 ? endpoint.models : [...taken, ...endpoint.models];
}

/**
 * 按服务范围定下 models，指向不再在服务的模型的档位去掉。跟随时重算在服务的模型；挑选时去掉没有地址的
 * （照 magpie 在 picks 上也跑 NoAPIFor），再按规则勾上新模型。isNew 为 null 时不按规则勾（这次没有新清单，规则也没改）。
 */
export function settleServedModels(
  endpoint: StoredApiEndpoint,
  isNew: ((modelId: string) => boolean) | null,
): StoredApiEndpoint {
  let models: StoredModel[];
  if (followsList(endpoint)) {
    models = vendorServedModels(endpoint);
  } else {
    const hasNoAddress = noAddressFilter(endpoint);
    const reachable = { ...endpoint, models: endpoint.models.filter((m) => !hasNoAddress(m.id)) };
    models = isNew === null ? reachable.models : withAutoPicked(reachable, isNew);
  }
  if (isDeepStrictEqual(models, endpoint.models)) return endpoint;
  const { modelMapping: _mapping, ...rest } = endpoint;
  const modelMapping = keepValidMapping(endpoint.modelMapping, models);
  return { ...rest, models, ...(modelMapping ? { modelMapping } : {}) };
}

/** 档位只留指向 models 里的。 */
export function keepValidMapping(
  mapping: ApiEndpointModelMapping | undefined,
  models: readonly { id: string }[],
): ApiEndpointModelMapping | undefined {
  if (!mapping) return undefined;
  const kept: ApiEndpointModelMapping = {};
  for (const tier of API_ENDPOINT_MODEL_TIERS) {
    const modelId = mapping[tier];
    if (modelId && models.some((model) => model.id === modelId)) kept[tier] = modelId;
  }
  return Object.keys(kept).length === 0 ? undefined : kept;
}
