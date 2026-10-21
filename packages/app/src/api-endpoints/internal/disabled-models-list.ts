// 已禁用的模型区的命中与可挑模型移植自 magpie（https://github.com/yetone/magpie，internal/provider/disabled.go 的 DisabledHits，internal/gui/assets/app.js 的 titleModels）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  cleanDisabledModels,
  endpointModelDisabledBy,
  listedDisabledEntry,
  withoutDisabledModels,
} from "@getpaseo/protocol/api-endpoint/disabled-models";

/*
 * 「第三方接口」页底部的「已禁用的模型」（照 magpie 设置页的 Disabled models）：纯 TypeScript，无 React（docs/forms.md）。
 * 每次增删都把整份名单交给主机；只差大小写的重复不加（选单里那一项已经置灰写明）。存失败时名单回到原样，原因留在原处。
 * 每条现在命中谁、能从哪些模型里挑，按开着的接口的已选模型算（magpie DisabledHits、titleModels）。
 */

export type DisabledModelsStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "failed"; message: string };

export interface DisabledModelsListState {
  patterns: string[];
  status: DisabledModelsStatus;
}

export type DisabledModelsChangeResult = "saved" | "unchanged" | "duplicate" | "failed";

export interface DisabledModelsList {
  getState(): DisabledModelsListState;
  subscribe(listener: () => void): () => void;
  disable(pattern: string): Promise<DisabledModelsChangeResult>;
  enable(pattern: string): Promise<DisabledModelsChangeResult>;
}

export function openDisabledModelsList(input: {
  initial: string[];
  // 失败原因，成功为 null。
  save: (models: string[]) => Promise<string | null>;
}): DisabledModelsList {
  let state: DisabledModelsListState = { patterns: input.initial, status: { kind: "idle" } };
  const listeners = new Set<() => void>();
  function publish(next: DisabledModelsListState) {
    state = next;
    for (const listener of listeners) listener();
  }
  async function saveList(next: string[]): Promise<DisabledModelsChangeResult> {
    const before = state.patterns;
    publish({ patterns: next, status: { kind: "saving" } });
    const failure = await input.save(next);
    if (failure === null) {
      publish({ patterns: next, status: { kind: "idle" } });
      return "saved";
    }
    publish({ patterns: before, status: { kind: "failed", message: failure } });
    return "failed";
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    disable(typed) {
      const pattern = typed.trim();
      if (pattern === "") return Promise.resolve("unchanged");
      if (listedDisabledEntry({ patterns: state.patterns, pattern }) !== null) {
        return Promise.resolve("duplicate");
      }
      return saveList(cleanDisabledModels([...state.patterns, pattern]));
    },
    enable(pattern) {
      return saveList(state.patterns.filter((known) => known !== pattern));
    },
  };
}

function enabledOf(endpoints: readonly ApiEndpoint[]): ApiEndpoint[] {
  return endpoints.filter((endpoint) => endpoint.enabled !== false);
}

/** 每条现在命中开着的接口里的哪些已选模型，写成「接口标识/模型」。 */
export function disabledModelHits(input: {
  patterns: readonly string[];
  endpoints: readonly ApiEndpoint[];
}): Record<string, string[]> {
  const hits: Record<string, string[]> = {};
  for (const pattern of input.patterns) {
    hits[pattern] = enabledOf(input.endpoints).flatMap((endpoint) => {
      const slug = endpoint.slug ?? "";
      return endpoint.models
        .filter((model) => endpointModelDisabledBy({ patterns: [pattern], slug, model: model.id }))
        .map((model) => `${slug}/${model.id}`);
    });
  }
  return hits;
}

export interface DisableChoice {
  // 「接口标识/模型」：只禁这一家的（magpie 的选单给的也是「服务商/模型」）。
  id: string;
  label: string;
  description: string;
}

/** 选单里能挑的：开着的接口的已选模型，还没被禁的。 */
export function disableChoices(input: {
  endpoints: readonly ApiEndpoint[];
  patterns: readonly string[];
}): DisableChoice[] {
  return withoutDisabledEndpointModels({
    endpoints: enabledOf(input.endpoints),
    patterns: input.patterns,
  }).flatMap((endpoint) =>
    endpoint.models.map((model) => ({
      id: `${endpoint.slug ?? ""}/${model.id}`,
      label: model.id,
      description: endpoint.name,
    })),
  );
}

/** 去掉每家被禁的已选模型：默认模型候选不再列它们。名单是空的原样返回。 */
export function withoutDisabledEndpointModels(input: {
  endpoints: ApiEndpoint[];
  patterns: readonly string[];
}): ApiEndpoint[] {
  const { patterns } = input;
  if (patterns.length === 0) return input.endpoints;
  return input.endpoints.map((endpoint) => ({
    ...endpoint,
    models: withoutDisabledModels({ patterns, slug: endpoint.slug ?? "", models: endpoint.models }),
  }));
}
