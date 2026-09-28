import {
  filterAndRankModelRows,
  getAllProviderModelRows,
  getProviderModelRows,
  type ProviderSelectionModelRow,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";

export type ModelBrowserView =
  | { kind: "all" }
  | { kind: "provider"; providerId: string; providerLabel: string };

/**
 * `selectedProvider` 用在旁边有独立提供方按钮的地方：浏览器只看当前提供方，
 * 没有跨提供方的根视图。没有提供方按钮的页面必须用 `allProviders`，否则换不了提供方。
 */
export type ModelBrowserScope = "allProviders" | "selectedProvider";

export function scopeModelBrowserProviders({
  providers,
  selectedProvider,
  scope,
}: {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  scope: ModelBrowserScope;
}): ProviderSelectorProvider[] {
  if (scope === "allProviders") {
    return providers;
  }
  return providers.filter((provider) => provider.id === selectedProvider);
}

/** 提供方视图里按搜索词筛过的模型行。 */
export function resolveProviderViewModelRows(
  provider: ProviderSelectorProvider | null,
  normalizedQuery: string,
): ProviderSelectionModelRow[] {
  return provider ? filterAndRankModelRows(getProviderModelRows(provider), normalizedQuery) : [];
}

/**
 * 限定为当前提供方时没有根视图，profiles 只能在提供方视图里套用，所以全部展示；
 * 套用跨提供方的 profile 会顺带切换提供方。跨提供方浏览时，根视图已有全部 profiles，
 * 下钻后只留该提供方的。
 */
export function selectProviderViewProfileRows<T extends { provider: string }>({
  rows,
  providerId,
  scope,
}: {
  rows: readonly T[];
  providerId: string;
  scope: ModelBrowserScope;
}): T[] {
  if (scope === "selectedProvider") {
    return [...rows];
  }
  return rows.filter((row) => row.provider === providerId);
}

export function resolveModelBrowserScrolling({
  isNative,
  isCompact,
}: {
  isNative: boolean;
  isCompact: boolean;
}): "sheet" | "independent" {
  return isNative && isCompact ? "sheet" : "independent";
}

/** A profile's model reference; used to match profiles back to model rows. */
export interface ModelProfileRef {
  provider: string;
  modelId: string;
}

/**
 * Groups profiles by `provider:modelId`, skipping profiles that name no model.
 * Pure so the model browser can test it apart from the component tree.
 */
export function groupProfilesByProviderModel<T extends ModelProfileRef>(
  refs: readonly T[],
): Map<string, T[]> {
  const lookup = new Map<string, T[]>();
  for (const ref of refs) {
    const modelId = ref.modelId.trim();
    if (!modelId) {
      continue;
    }
    const key = `${ref.provider}:${modelId}`;
    const existing = lookup.get(key);
    if (existing) {
      existing.push(ref);
    } else {
      lookup.set(key, [ref]);
    }
  }
  return lookup;
}

/** What the root view shows: the provider drill-down, or ranked cross-provider results. */
export type ModelBrowserAllView =
  | { kind: "browse" }
  | { kind: "searchResults"; rows: ProviderSelectionModelRow[] }
  | { kind: "noSearchMatches" };

export function resolveModelBrowserAllView({
  providers,
  normalizedQuery,
  isSearchFocused,
}: {
  providers: ProviderSelectorProvider[];
  normalizedQuery: string;
  isSearchFocused: boolean;
}): ModelBrowserAllView {
  if (!normalizedQuery && !isSearchFocused) {
    return { kind: "browse" };
  }
  const allRows = getAllProviderModelRows(providers);
  const rows = normalizedQuery ? filterAndRankModelRows(allRows, normalizedQuery) : allRows;
  if (rows.length === 0) {
    return { kind: "noSearchMatches" };
  }
  return { kind: "searchResults", rows };
}

/**
 * 限定为当前提供方时，提供方视图始终是当前提供方：打开期间在旁边换了提供方，也不停在旧的那家。
 * 根视图（手机 sheet 的设置列表）不受影响。
 */
export function followSelectedProviderView({
  view,
  selectedProviderView,
  scope,
}: {
  view: ModelBrowserView;
  selectedProviderView: ModelBrowserView;
  scope: ModelBrowserScope;
}): ModelBrowserView {
  if (scope !== "selectedProvider" || view.kind !== "provider") {
    return view;
  }
  return selectedProviderView;
}

/** Where the picker lands when it opens. A sole provider skips the redundant root view. */
export function resolveInitialModelBrowserView({
  providers,
  selectedProvider,
  selectedModel,
  hasProfiles,
  scope,
}: {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  hasProfiles: boolean;
  scope: ModelBrowserScope;
}): ModelBrowserView {
  // 当前提供方还不在列表里（快照未到或已停用）时也停在它的视图，不能回落到跨提供方的根视图。
  if (scope === "selectedProvider") {
    const provider = providers.find((entry) => entry.id === selectedProvider);
    return {
      kind: "provider",
      providerId: selectedProvider,
      providerLabel: provider?.label ?? selectedProvider,
    };
  }

  const singleProvider = providers.length === 1 ? providers[0] : undefined;
  if (singleProvider) {
    return {
      kind: "provider",
      providerId: singleProvider.id,
      providerLabel: singleProvider.label,
    };
  }

  if (hasProfiles) {
    return { kind: "all" };
  }

  if (selectedProvider.length > 0 && selectedModel.length > 0) {
    const provider = providers.find((entry) => entry.id === selectedProvider);
    if (provider) {
      return { kind: "provider", providerId: provider.id, providerLabel: provider.label };
    }
  }

  return { kind: "all" };
}
