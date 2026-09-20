import type {
  ProviderUsage,
  ProviderUsageBalance,
  ProviderUsageDetail,
  ProviderUsageListResponseMessage,
  ProviderUsageStatus,
  ProviderUsageTone,
  ProviderUsageWindow,
} from "@osuna/protocol/messages";
import type { UsageText } from "@/usage/text";

export type {
  ProviderUsage,
  ProviderUsageBalance,
  ProviderUsageDetail,
  ProviderUsageStatus,
  ProviderUsageTone,
  ProviderUsageWindow,
};

export type ProviderUsageBalanceUnit = ProviderUsageBalance["unit"];
export type ProviderUsageListPayload = ProviderUsageListResponseMessage["payload"];

/** `message` 是描述对象：取数层不碰 i18n，由渲染它的组件翻译。 */
export type ProviderUsageView =
  | { kind: "loading" }
  | { kind: "error"; message: UsageText }
  | { kind: "ready"; payload: ProviderUsageListPayload; isRefreshing: boolean };
