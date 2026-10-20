// 拒收已禁用的模型移植自 magpie（https://github.com/yetone/magpie，internal/gateway/disabled.go 的 disabledError、idOff、
// codexNativeOff，internal/provider/disabled.go 的 BareDisabled）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import {
  askedModelDisabledBy,
  endpointModelDisabledBy,
  withoutDisabledModels as withoutDisabledEndpointModels,
} from "@getpaseo/protocol/api-endpoint/disabled-models";
import { ONE_MILLION_MARK } from "./claude-model-hints.js";
import type { ApiEndpointState, StoredApiEndpoint } from "./store.js";

/*
 * 已禁用的模型（prd 第 31 条，magpie #1867）：名单存在 endpoints.json 的 disabledModels。命中的模型从每家接口在服务的模型里
 * 去掉（withoutDisabledModels），所以选单、默认模型候选、自动切换、写给 CLI 的模型都看不到它；存下的已选模型不改，
 * 解禁后原样回来。CLI 硬要用它时，中转站在问任何上游之前按请求的格式回 403，写明命中的条目和在哪改（disabledMessage）。
 */

/** Codex 自己的模型（ChatGPT 登录）在名单里按「codex/模型」也认（magpie ModelDisabled("codex", …)）。 */
const CODEX_OWN_SLUG = "codex";

export function disabledPatterns(state: ApiEndpointState): string[] {
  return state.disabledModels ?? [];
}

/** 去掉每家接口被禁的已选模型，和映射到它们的 Claude 档位。名单是空的原样返回。 */
export function withoutDisabledModels(state: ApiEndpointState): ApiEndpointState {
  const patterns = disabledPatterns(state);
  if (patterns.length === 0) return state;
  return {
    ...state,
    endpoints: state.endpoints.map((endpoint) => withoutDisabled({ endpoint, patterns })),
  };
}

function withoutDisabled(input: {
  endpoint: StoredApiEndpoint;
  patterns: readonly string[];
}): StoredApiEndpoint {
  const { endpoint, patterns } = input;
  const models = withoutDisabledEndpointModels({
    patterns,
    slug: endpoint.slug,
    models: endpoint.models,
  });
  const isOff = (model: string) =>
    endpointModelDisabledBy({ patterns, slug: endpoint.slug, model }) !== null;
  const mapping = Object.entries(endpoint.modelMapping ?? {});
  const isMappedOff = mapping.some(([, model]) => typeof model === "string" && isOff(model));
  if (models.length === endpoint.models.length && !isMappedOff) return endpoint;
  if (endpoint.modelMapping === undefined) return { ...endpoint, models };
  // 只去掉指向被禁模型的档位；指向没选的模型的归 keepValidMapping 管，这里不动。
  const kept = mapping.filter(([, model]) => typeof model !== "string" || !isOff(model));
  return { ...endpoint, models, modelMapping: Object.fromEntries(kept) };
}

/** 中转站拒收时说的话（magpie disabledError，换成 Osuna 的说法；Osuna 没有对应的命令行，只说在哪改）。 */
export function disabledMessage(input: { model: string; pattern: string }): string {
  return (
    `model ${input.model} is disabled in Osuna (it matches ${JSON.stringify(input.pattern)} in ` +
    `Settings › API endpoints › Disabled models); enable it there. Only requests through Osuna are refused`
  );
}

/** Claude Code 给 1M 窗口的模型名后面加的 [1m] 不算名字的一部分。 */
function withoutOneMillionMark(model: string): string {
  return model.toLowerCase().endsWith(ONE_MILLION_MARK)
    ? model.slice(0, -ONE_MILLION_MARK.length)
    : model;
}

/** 按请求里的名字（`~` 当 `/`）就被禁了：回命中的条目，否则 null（magpie IDDisabled）。 */
export function askedDisabledBy(input: { state: ApiEndpointState; model: string }): string | null {
  const patterns = disabledPatterns(input.state);
  if (patterns.length === 0) return null;
  const model = withoutOneMillionMark(input.model.trim()).replaceAll("~", "/");
  return askedModelDisabledBy({ patterns, model });
}

/** 一家接口的一个模型（按这家的写法）被哪条禁了；没有为 null。 */
export function endpointDisabledBy(input: {
  state: ApiEndpointState;
  endpoint: Pick<StoredApiEndpoint, "slug">;
  model: string;
}): string | null {
  const patterns = disabledPatterns(input.state);
  if (patterns.length === 0) return null;
  return endpointModelDisabledBy({ patterns, slug: input.endpoint.slug, model: input.model });
}

/** Codex 自己的模型（光秃秃的名字，交给 ChatGPT 的）被哪条禁了（magpie codexNativeOff）。 */
export function codexOwnDisabledBy(input: {
  patterns: readonly string[];
  model: string;
}): string | null {
  const { patterns, model } = input;
  if (patterns.length === 0 || model === "") return null;
  return (
    askedModelDisabledBy({ patterns, model }) ??
    endpointModelDisabledBy({ patterns, slug: CODEX_OWN_SLUG, model })
  );
}
