import type { UsageText } from "@/usage/text";
import type { ProviderUsageListPayload, ProviderUsageView } from "./types";

/**
 * 客户端还没建好时抛的哨兵。它是翻译键而不是句子：取数层不碰 i18n，渲染时才变成
 * 当前语言。抛错和还原都必须用这个常量——复制字面量的话，改名会让界面直接显示
 * 原始键，而 typecheck、lint 和现有测试全都不报。
 */
export const PROVIDER_USAGE_CLIENT_UNAVAILABLE_KEY = "usage.planUsage.clientUnavailable";

export interface ProviderUsageViewInput {
  isConnected: boolean;
  /** 主机是否公布了 `providerUsageList`。 */
  isSupported: boolean;
  payload: ProviderUsageListPayload | undefined;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
}

/**
 * 「用量」页的卡片与会话内的弹层读的是同一份取数结果，状态推导放一处，两边就不会
 * 各自演化出不同的消息。
 */
export function resolveProviderUsageView(input: ProviderUsageViewInput): ProviderUsageView {
  if (!input.isConnected) {
    return { kind: "error", message: { key: "usage.planUsage.hostUnavailable" } };
  }
  // 未连接的主机没有 server_info，标志读出来也是 false，所以这一步必须排在后面。
  if (!input.isSupported) {
    return { kind: "error", message: { key: "usage.planUsage.hostUpgradeRequired" } };
  }
  if (input.payload) {
    return { kind: "ready", payload: input.payload, isRefreshing: input.isFetching };
  }
  if (input.isError) {
    return { kind: "error", message: describeProviderUsageError(input.error) };
  }
  return { kind: "loading" };
}

function describeProviderUsageError(error: unknown): UsageText {
  const message = error instanceof Error ? error.message : String(error);
  return message === PROVIDER_USAGE_CLIENT_UNAVAILABLE_KEY ? { key: message } : { text: message };
}
