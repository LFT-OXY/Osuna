import type { AgentModelDefinition, ProviderStatus } from "@getpaseo/protocol/agent-types";
import { filterSelectableModels } from "@/provider-selection/model-catalog";

export type ProviderStatusTone = "success" | "warning" | "danger" | "muted" | "loading";

// 文案描述，由组件经 t(key, params) 渲染。
export interface ProviderStatusCopy {
  key: string;
  params?: Record<string, string | number>;
}

export interface ProviderStatusDisplay {
  tone: ProviderStatusTone;
  label: ProviderStatusCopy;
}

interface ProviderStatusInput {
  status: ProviderStatus;
  enabled: boolean;
}

export interface ProviderStatusLineInput extends ProviderStatusInput {
  modelCount: number;
  activeApiEndpointName: string | null;
}

export function countSelectableModels(models: AgentModelDefinition[] | undefined): number {
  return filterSelectableModels(models ?? null)?.length ?? 0;
}

// 详情头部徽章与列表状态行共用的判定，按顺序第一条命中即用。
export function resolveProviderStatus(input: ProviderStatusInput): ProviderStatusDisplay {
  if (!input.enabled) {
    return { tone: "muted", label: { key: "settings.providers.statuses.disabled" } };
  }
  if (input.status === "loading") {
    return { tone: "loading", label: { key: "settings.providers.statuses.loading" } };
  }
  if (input.status === "error") {
    return { tone: "danger", label: { key: "settings.providers.statuses.error" } };
  }
  if (input.status === "ready") {
    return { tone: "success", label: { key: "settings.providers.statuses.available" } };
  }
  return { tone: "warning", label: { key: "settings.providers.statuses.notInstalled" } };
}

export function describeProviderModelCount(count: number): ProviderStatusCopy {
  if (count === 1) return { key: "settings.providers.models.one" };
  return { key: "settings.providers.models.many", params: { count } };
}

// 列表行的状态行：可用时换成第三方接口名或模型数，其余沿用状态文字。
export function resolveProviderStatusLine(input: ProviderStatusLineInput): ProviderStatusDisplay {
  const status = resolveProviderStatus(input);
  if (status.tone !== "success") return status;
  if (input.activeApiEndpointName) {
    const params = { name: input.activeApiEndpointName };
    return { tone: "success", label: { key: "settings.providers.statuses.apiEndpoint", params } };
  }
  return { tone: "success", label: describeProviderModelCount(input.modelCount) };
}
