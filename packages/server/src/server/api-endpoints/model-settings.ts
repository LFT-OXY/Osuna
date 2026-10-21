// 保存模型设置时的校验与收拢移植自 magpie（https://github.com/yetone/magpie，internal/provider/modelprefs.go 的
// setModelName、setModelEfforts、setModelImage、setModelAPI、SetUpstreamName，models.go 的 SetModelOutput，compact.go 的 SetModelCompacts）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type {
  ApiEndpointModelSetting,
  ApiEndpointModelSettings,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  MODEL_NAME_MAX_LENGTH,
  settleModelDefaults,
  settleModelSetting,
  setsOnlyEfforts,
  type ModelSettingProblem,
} from "@getpaseo/protocol/api-endpoint/model-settings";
import type { StoredApiEndpoint } from "./store.js";

export type ModelSettingsSettled =
  | { kind: "settled"; settings: ApiEndpointModelSettings | undefined }
  | { kind: "invalid"; message: string };

/** 收拢一个模型的设置要知道的：它已知的档位，与上游清单明说的能否看图。 */
export interface ModelSettingBasis {
  knownEfforts: string[] | undefined;
  listedImages: boolean | undefined;
}

/**
 * 要存的模型设置：每个模型按 protocol 的 settleModelSetting 收拢（app 判断有没有改动用的是同一份），整家默认按
 * settleModelDefaults；空的条目、空的整家默认都不留，什么都没有时为 undefined。
 * 和原来一样的条目原样留下，不再校验：模型从清单里下架了，它的设置照留（照 magpie，设置不随清单走）。
 * 新改的条目除了只设档位的（magpie setModelEfforts 只对着已知的档位查），都要是这家的模型（magpie serves）；
 * 新设的「只用这种格式」要是这家有地址的格式。
 */
export function settleModelSettings(input: {
  requested: ApiEndpointModelSettings;
  stored: ApiEndpointModelSettings | undefined;
  isOwnModel: (modelId: string) => boolean;
  basisOf: (modelId: string) => ModelSettingBasis;
  // 这家（按要存的地址）有这种格式的地址。
  hasUrlFor: (format: string) => boolean;
}): ModelSettingsSettled {
  const defaults = settleModelDefaults(input.requested.defaults ?? {});
  if (defaults.kind === "invalid") return invalid("defaults", defaults.problem);
  const models: Record<string, ApiEndpointModelSetting> = {};
  for (const [modelId, setting] of Object.entries(input.requested.models ?? {})) {
    const before = input.stored?.models?.[modelId];
    const isUnchanged = isSameSetting(before, setting);
    if (before !== undefined && isUnchanged) {
      models[modelId] = before;
      continue;
    }
    const settled = settleModelSetting({ setting, ...input.basisOf(modelId) });
    if (settled.kind === "invalid") return invalid(modelId, settled.problem);
    const kept = settled.setting;
    if (Object.keys(kept).length === 0) continue;
    const needsOwnModel = !setsOnlyEfforts(kept);
    if (needsOwnModel && !input.isOwnModel(modelId)) {
      return { kind: "invalid", message: `This endpoint has no model ${modelId}` };
    }
    const formatProblem = newFormatProblem({ modelId, kept, before, hasUrlFor: input.hasUrlFor });
    if (formatProblem !== null) return { kind: "invalid", message: formatProblem };
    models[modelId] = kept;
  }
  const hasDefaults = Object.keys(defaults.setting).length > 0;
  const hasModels = Object.keys(models).length > 0;
  if (!hasDefaults && !hasModels) return { kind: "settled", settings: undefined };
  const settings: ApiEndpointModelSettings = {};
  if (hasDefaults) settings.defaults = defaults.setting;
  if (hasModels) settings.models = models;
  return { kind: "settled", settings };
}

/** 新设的「只用这种格式」要有那种地址（magpie setModelAPI）；原来设的那地址后来删了，设置照留、只是作废。 */
function newFormatProblem(input: {
  modelId: string;
  kept: ApiEndpointModelSetting;
  before: ApiEndpointModelSetting | undefined;
  hasUrlFor: (format: string) => boolean;
}): string | null {
  const { format } = input.kept;
  if (format === undefined || format === input.before?.format) return null;
  if (input.hasUrlFor(format)) return null;
  return `This endpoint has no ${format} URL to ask ${input.modelId} on: add it first`;
}

/** 这家有这个模型：已选、上游清单里或手动添加的（magpie serves）。 */
export function endpointKnowsModel(endpoint: StoredApiEndpoint, modelId: string): boolean {
  const lists = [endpoint.models, endpoint.catalog?.models ?? [], endpoint.manualModels ?? []];
  return lists.some((models) => models.some((model) => model.id === modelId));
}

function isSameSetting(
  before: ApiEndpointModelSetting | undefined,
  setting: ApiEndpointModelSetting,
): boolean {
  return JSON.stringify(before) === JSON.stringify(setting);
}

function invalid(owner: string, problem: ModelSettingProblem): ModelSettingsSettled {
  return { kind: "invalid", message: problemMessage(owner, problem) };
}

function problemMessage(owner: string, problem: ModelSettingProblem): string {
  if (problem.kind === "tokens") {
    return `${owner}: ${problem.field} is a number of tokens above zero, not ${problem.value}`;
  }
  if (problem.kind === "name_too_long") {
    return `A model's name is at most ${MODEL_NAME_MAX_LENGTH} characters`;
  }
  if (problem.kind === "format") {
    return `${owner}: a model is asked in anthropic_messages, openai_chat or openai_responses, not "${problem.format}"`;
  }
  return `${owner} has no reasoning level "${problem.level}"`;
}
