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

export type ModelListItem =
  | { kind: "group"; key: string; name: string }
  | { kind: "row"; key: string; row: ProviderSelectionModelRow };

/**
 * 模型列表的条目。第三方接口启用时（每行都带接口）在单个提供方的视图里每家接口一个组标题，
 * 组按创建顺序排，组内保留传进来的顺序（搜索时即命中排名）；其余情况原样平铺。
 */
export function buildModelListItems(
  rows: ProviderSelectionModelRow[],
  options: { groupByApiEndpoint: boolean },
): ModelListItem[] {
  const groups = new Map<number, { name: string; rows: ProviderSelectionModelRow[] }>();
  for (const row of rows) {
    const group = row.apiEndpointGroup;
    if (!options.groupByApiEndpoint || group?.nameShown !== "heading") {
      return rows.map((entry) => ({ kind: "row", key: entry.favoriteKey, row: entry }));
    }
    const bucket = groups.get(group.index) ?? { name: group.name, rows: [] };
    bucket.rows.push(row);
    groups.set(group.index, bucket);
  }
  const items: ModelListItem[] = [];
  for (const [index, bucket] of [...groups.entries()].sort(([a], [b]) => a - b)) {
    items.push({ kind: "group", key: `group:${index}`, name: bucket.name });
    for (const row of bucket.rows) items.push({ kind: "row", key: row.favoriteKey, row });
  }
  return items;
}

const DESKTOP_PROVIDER_VIEW_MIN_HEIGHT = 220;
const DESKTOP_PROVIDER_VIEW_MAX_HEIGHT = 400;
// 标题与搜索框，加列表上下留白。
const DESKTOP_PROVIDER_VIEW_BASE_HEIGHT = 120;
const DESKTOP_MODEL_ROW_HEIGHT = 40;
const DESKTOP_SECTION_HEADING_HEIGHT = 28;
const DESKTOP_PROFILE_ROW_HEIGHT = 36;

function measureModelList(view: ModelBrowserView, providers: ProviderSelectorProvider[]): number {
  if (view.kind === "all") {
    return getAllProviderModelRows(providers).length * DESKTOP_MODEL_ROW_HEIGHT;
  }
  const provider = providers.find((entry) => entry.id === view.providerId);
  if (provider?.modelSelection.kind !== "models") {
    return 0;
  }
  // 提供方视图按接口分组渲染，组标题也占一行。
  const items = buildModelListItems(getProviderModelRows(provider), { groupByApiEndpoint: true });
  let height = 0;
  for (const item of items) {
    height += item.kind === "group" ? DESKTOP_SECTION_HEADING_HEIGHT : DESKTOP_MODEL_ROW_HEIGHT;
  }
  return height;
}

/** 提供方视图顶部的配置区：没有配置时只有「创建 Agent 配置」一行，有配置时是标题加每个配置一行。 */
function measureProfilesSection({
  view,
  profileRows,
  scope,
}: {
  view: ModelBrowserView;
  profileRows: readonly { provider: string }[] | null;
  scope: ModelBrowserScope;
}): number {
  if (profileRows === null || view.kind !== "provider") {
    return 0;
  }
  const profileCount = selectProviderViewProfileRows({
    rows: profileRows,
    providerId: view.providerId,
    scope,
  }).length;
  if (profileCount === 0) {
    return DESKTOP_PROFILE_ROW_HEIGHT;
  }
  return DESKTOP_SECTION_HEADING_HEIGHT + profileCount * DESKTOP_PROFILE_ROW_HEIGHT;
}

/**
 * 桌面弹框打开时定下的固定高度，按搜索词为空时的内容估算；弹框开着时高度不随搜索变。
 * `profileRows` 为 null 表示不显示配置区。
 */
export function resolveModelBrowserDesktopHeight({
  view,
  providers,
  profileRows,
  scope,
}: {
  view: ModelBrowserView;
  providers: ProviderSelectorProvider[];
  profileRows: readonly { provider: string }[] | null;
  scope: ModelBrowserScope;
}): number {
  const contentHeight =
    measureModelList(view, providers) + measureProfilesSection({ view, profileRows, scope });
  return Math.min(
    Math.max(DESKTOP_PROVIDER_VIEW_MIN_HEIGHT, DESKTOP_PROVIDER_VIEW_BASE_HEIGHT + contentHeight),
    DESKTOP_PROVIDER_VIEW_MAX_HEIGHT,
  );
}
