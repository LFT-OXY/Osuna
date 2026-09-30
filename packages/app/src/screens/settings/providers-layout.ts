// Providers 页的两列尺寸：左右 padding 16、列表 280、间距 24、详情 400–720。
// padding 是设置详情区 styles.content 的 spacing[4]。
const PROVIDERS_PAGE_PADDING = 16;
export const PROVIDERS_LIST_WIDTH = 280;
export const PROVIDERS_COLUMN_GAP = 24;
const PROVIDERS_DETAIL_MIN_WIDTH = 400;
export const PROVIDERS_DETAIL_MAX_WIDTH = 720;

const PROVIDERS_SPLIT_MIN_CONTENT_WIDTH =
  PROVIDERS_PAGE_PADDING * 2 +
  PROVIDERS_LIST_WIDTH +
  PROVIDERS_COLUMN_GAP +
  PROVIDERS_DETAIL_MIN_WIDTH;
export const PROVIDERS_SPLIT_MAX_WIDTH =
  PROVIDERS_PAGE_PADDING * 2 +
  PROVIDERS_LIST_WIDTH +
  PROVIDERS_COLUMN_GAP +
  PROVIDERS_DETAIL_MAX_WIDTH;

export type ProvidersLayout = "split" | "stacked";

export interface ProvidersLayoutInput {
  // 设置详情区的实测宽度。
  contentWidth: number;
  isCompact: boolean;
}

export function resolveProvidersLayout(input: ProvidersLayoutInput): ProvidersLayout {
  if (input.isCompact) return "stacked";
  return input.contentWidth >= PROVIDERS_SPLIT_MIN_CONTENT_WIDTH ? "split" : "stacked";
}

export interface SelectedProviderInput {
  // 地址里的提供方。
  requested: string | null;
  providerIds: readonly string[];
}

export function resolveSelectedProvider(input: SelectedProviderInput): string | null {
  if (input.requested && input.providerIds.includes(input.requested)) return input.requested;
  return input.providerIds[0] ?? null;
}

export type StackedProvidersView =
  | { kind: "list" }
  | { kind: "detail"; provider: string }
  // 地址里的提供方不在已加载的列表里，回到列表。
  | { kind: "missing" };

export interface StackedProvidersViewInput {
  // 地址里的提供方。
  requested: string | null;
  // 列表还没到（未连接或加载中）时为 null，此时不判定地址。
  providerIds: readonly string[] | null;
}

export function resolveStackedProvidersView(
  input: StackedProvidersViewInput,
): StackedProvidersView {
  if (input.requested === null || input.providerIds === null) return { kind: "list" };
  if (input.providerIds.includes(input.requested)) {
    return { kind: "detail", provider: input.requested };
  }
  return { kind: "missing" };
}
