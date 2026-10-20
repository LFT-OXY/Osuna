import {
  API_ENDPOINT_MODEL_TIERS,
  type ApiEndpointModelMapping,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { StoredApiEndpoint } from "./store.js";

/*
 * 服务范围与自动勾选规则（prd 第 17、18a 条）。在服务的模型总写在 models 里，选单、默认模型、档位映射、
 * 中转站路由与自动切换都只看它；「跟随接口清单」时由这里按上游清单算好写回，清单或地址一变就重算。
 * - vendor：上游清单去掉没有对应地址的模型（照 magpie NoAPIFor），超过 24 个取清单顺序的前 24 个
 *   （magpie models.go 的 manyModels），手动添加的总在里面。
 * - picked（缺省）：用户勾的那些；自动勾选规则只在这时起作用，只加不减（照 magpie autolist.go）。
 */

type StoredModel = StoredApiEndpoint["models"][number];

export const SERVED_LIST_LIMIT = 24;

const RE_PREFIX = "re:";

export function followsList(endpoint: Pick<StoredApiEndpoint, "modelScope">): boolean {
  return endpoint.modelScope === "vendor";
}

/** 「跟随接口清单」时在服务的模型。 */
export function vendorServedModels(endpoint: StoredApiEndpoint): StoredModel[] {
  const formats = new Set(endpoint.baseUrls.map((entry) => entry.format));
  // 清单没记哪种格式列过它的（这版以前拉的、添加窗口带来的）不算没有地址。
  const listed = (endpoint.catalog?.models ?? []).filter(
    (model) =>
      model.formats === undefined ||
      model.formats.length === 0 ||
      model.formats.some((format) => formats.has(format)),
  );
  const served: StoredModel[] = listed
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

/** 规则读成正则：glob 的 * 是任意一段字符（含 /），其余照字面、不分大小写；`re:` 后是要整名匹配的正则（照 magpie compilePattern）。 */
function compileRule(rule: string): RegExp | string {
  if (rule.startsWith(RE_PREFIX)) {
    const source = rule.slice(RE_PREFIX.length);
    if (source.trim() === "") return `"${rule}" has no regular expression after ${RE_PREFIX}`;
    try {
      return new RegExp(`^(?:${source})$`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return `"${rule}" is not a regular expression Osuna can read: ${reason}`;
    }
  }
  const escaped = rule.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".*")}$`, "i");
}

/**
 * 规则按存的样子：去掉首尾空白、空的与重复的；每条都要是规则（有 *，或以 re: 开头）且读得懂（照 magpie CleanAutoInclude）。
 * 读不懂时回原因。
 */
export function cleanAutoPickRules(
  rules: string[],
): { ok: true; rules: string[] } | { ok: false; message: string } {
  const cleaned: string[] = [];
  for (const raw of rules) {
    const rule = raw.trim();
    if (rule === "" || cleaned.includes(rule)) continue;
    if (!rule.startsWith(RE_PREFIX) && !rule.includes("*")) {
      return {
        ok: false,
        message: `"${rule}" is a model's id, not a rule: a rule has a * in it, or starts with ${RE_PREFIX}`,
      };
    }
    const compiled = compileRule(rule);
    if (typeof compiled === "string") return { ok: false, message: compiled };
    cleaned.push(rule);
  }
  return { ok: true, rules: cleaned };
}

/**
 * 「只用挑选的」时按规则勾上清单里 isNew 说是新的、规则匹配、还没勾的模型，新勾的排在前面（照 magpie takeMatching）；
 * 已勾的不动。没有规则或没有可勾的原样返回。
 */
export function withAutoPicked(
  endpoint: StoredApiEndpoint,
  isNew: (modelId: string) => boolean,
): StoredModel[] {
  const rules = (endpoint.autoPick ?? []).flatMap((rule) => {
    const compiled = compileRule(rule);
    return typeof compiled === "string" ? [] : [compiled];
  });
  if (rules.length === 0) return endpoint.models;
  const picked = new Set(endpoint.models.map((model) => model.id));
  const taken: StoredModel[] = [];
  for (const model of endpoint.catalog?.models ?? []) {
    if (picked.has(model.id) || !isNew(model.id)) continue;
    if (!rules.some((rule) => rule.test(model.id))) continue;
    picked.add(model.id);
    taken.push(model.label ? { id: model.id, label: model.label } : { id: model.id });
  }
  return taken.length === 0 ? endpoint.models : [...taken, ...endpoint.models];
}

/**
 * 按服务范围定下 models：跟随时重算在服务的模型，指向不再在服务的模型的档位去掉；挑选时按规则勾上新模型。
 * isNew 为 null 时不按规则勾（这次没有新清单，规则也没改）。
 */
export function settleServedModels(
  endpoint: StoredApiEndpoint,
  isNew: ((modelId: string) => boolean) | null,
): StoredApiEndpoint {
  if (followsList(endpoint)) {
    const models = vendorServedModels(endpoint);
    const { modelMapping: _mapping, ...rest } = endpoint;
    const modelMapping = keepValidMapping(endpoint.modelMapping, models);
    return { ...rest, models, ...(modelMapping ? { modelMapping } : {}) };
  }
  if (isNew === null) return endpoint;
  const models = withAutoPicked(endpoint, isNew);
  return models === endpoint.models ? endpoint : { ...endpoint, models };
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
