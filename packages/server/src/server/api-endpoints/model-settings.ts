// 保存模型设置时的校验与收拢移植自 magpie（https://github.com/yetone/magpie，internal/provider/modelprefs.go 的
// setModelName、setModelEfforts、setModelImage，models.go 的 SetModelOutput，compact.go 的 SetModelCompacts）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type {
  ApiEndpointModelDefaults,
  ApiEndpointModelFacts,
  ApiEndpointModelSetting,
  ApiEndpointModelSettings,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { keptEfforts, MODEL_NAME_MAX_LENGTH } from "@getpaseo/protocol/api-endpoint/model-settings";
import type { StoredApiEndpoint } from "./store.js";

export type ModelSettingsSettled =
  | { kind: "settled"; settings: ApiEndpointModelSettings | undefined }
  | { kind: "invalid"; message: string };

const TOKEN_FIELDS = ["context", "output", "compact"] as const;

/**
 * 要存的模型设置：显示名收拢空白（空的去掉，最长 80 个字符）；token 数是正整数；档位按 keptEfforts 收拢，留了全部即没设；
 * 和自动取到的一样的看图答案不记；空的条目、空的整家默认都不留，什么都没有时为 undefined。
 * 和原来一样的条目原样留下，不再校验：模型从清单里下架了，它的设置照留（照 magpie，设置不随清单走）。
 */
export function settleModelSettings(input: {
  requested: ApiEndpointModelSettings;
  stored: ApiEndpointModelSettings | undefined;
  isOwnModel: (modelId: string) => boolean;
  autoFacts: (modelId: string) => ApiEndpointModelFacts;
}): ModelSettingsSettled {
  const defaults = settleTokens(input.requested.defaults ?? {}, "defaults");
  if (defaults.kind === "invalid") return defaults;
  const models: Record<string, ApiEndpointModelSetting> = {};
  for (const [modelId, setting] of Object.entries(input.requested.models ?? {})) {
    const before = input.stored?.models?.[modelId];
    if (before !== undefined && JSON.stringify(before) === JSON.stringify(setting)) {
      models[modelId] = before;
      continue;
    }
    const settled = settleModel({ modelId, setting, auto: input.autoFacts(modelId) });
    if (settled.kind === "invalid") return settled;
    if (Object.keys(settled.setting).length === 0) continue;
    if (!input.isOwnModel(modelId)) {
      return { kind: "invalid", message: `This endpoint has no model ${modelId}` };
    }
    models[modelId] = settled.setting;
  }
  const hasDefaults = Object.keys(defaults.setting).length > 0;
  const hasModels = Object.keys(models).length > 0;
  if (!hasDefaults && !hasModels) return { kind: "settled", settings: undefined };
  return {
    kind: "settled",
    settings: {
      ...(hasDefaults ? { defaults: defaults.setting } : {}),
      ...(hasModels ? { models } : {}),
    },
  };
}

/** 这家有这个模型：已选、上游清单里或手动添加的（magpie serves）。 */
export function endpointKnowsModel(endpoint: StoredApiEndpoint, modelId: string): boolean {
  const lists = [endpoint.models, endpoint.catalog?.models ?? [], endpoint.manualModels ?? []];
  return lists.some((models) => models.some((model) => model.id === modelId));
}

type Settled<T> = { kind: "settled"; setting: T } | { kind: "invalid"; message: string };

function settleModel(input: {
  modelId: string;
  setting: ApiEndpointModelSetting;
  auto: ApiEndpointModelFacts;
}): Settled<ApiEndpointModelSetting> {
  const { modelId, setting, auto } = input;
  const tokens = settleTokens(setting, modelId);
  if (tokens.kind === "invalid") return tokens;
  const out: ApiEndpointModelSetting = { ...tokens.setting };
  if (setting.name !== undefined) {
    const name = setting.name.split(/\s+/).filter(Boolean).join(" ");
    if ([...name].length > MODEL_NAME_MAX_LENGTH) {
      return {
        kind: "invalid",
        message: `A model's name is at most ${MODEL_NAME_MAX_LENGTH} characters`,
      };
    }
    if (name !== "") out.name = name;
  }
  if (setting.efforts !== undefined) {
    const kept = keptEfforts({ picked: setting.efforts, known: auto.efforts });
    if (kept.kind === "invalid") {
      return { kind: "invalid", message: `${modelId} has no reasoning level "${kept.level}"` };
    }
    if (kept.efforts !== undefined) out.efforts = kept.efforts;
  }
  if (setting.images !== undefined && setting.images !== auto.images) out.images = setting.images;
  return { kind: "settled", setting: out };
}

function settleTokens(
  setting: ApiEndpointModelDefaults,
  owner: string,
): Settled<ApiEndpointModelDefaults> {
  const out: ApiEndpointModelDefaults = {};
  for (const field of TOKEN_FIELDS) {
    const value = setting[field];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value <= 0) {
      return {
        kind: "invalid",
        message: `${owner}: ${field} is a number of tokens above zero, not ${value}`,
      };
    }
    out[field] = value;
  }
  return { kind: "settled", setting: out };
}
