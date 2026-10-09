import type { UsagePricingListResponse } from "@osuna/protocol/usage/rpc-schemas";
import type { UsageText } from "@/usage/text";

export type PriceTablePayload = UsagePricingListResponse["payload"];

/**
 * 客户端还没建好时抛的哨兵，形状与 `provider-usage/view.ts` 的同名常量一致：它是
 * 翻译键而不是句子，抛错和还原都用这个常量。今天 `enabled` 已经检查过 client，所以
 * 这条路走不到；留着是为了两个兄弟模块对同一形状给同一个答案。
 */
export const PRICE_TABLE_CLIENT_UNAVAILABLE_KEY = "settings.host.priceTable.unavailable";

/**
 * 一个状态一个分支：布尔袋能同时表示「加载中且出错」，靠判断顺序兜住。
 * `unavailable` 与 `error` 分开，是因为只有后者重试才有意义——主机没连上或太旧时
 * 查询本身是关着的，给它一个重试按钮只会按下去什么也不发生。
 */
export type PriceTableView =
  | { kind: "loading" }
  | { kind: "unavailable"; message: UsageText }
  | { kind: "error"; message: UsageText }
  | { kind: "ready"; payload: PriceTablePayload };

export function resolvePriceTableView(input: {
  isConnected: boolean;
  isSupported: boolean;
  payload: PriceTablePayload | undefined;
  isError: boolean;
  error: unknown;
}): PriceTableView {
  if (!input.isConnected) {
    return { kind: "unavailable", message: { key: "settings.host.priceTable.unavailable" } };
  }
  // 未连接的主机没有 server_info，标志读出来也是 false，所以这一步必须排在后面。
  if (!input.isSupported) {
    return { kind: "unavailable", message: { key: "settings.host.priceTable.upgradeRequired" } };
  }
  if (input.payload) return { kind: "ready", payload: input.payload };
  if (input.isError) {
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    return message === PRICE_TABLE_CLIENT_UNAVAILABLE_KEY
      ? { kind: "unavailable", message: { key: message } }
      : { kind: "error", message: { text: message } };
  }
  return { kind: "loading" };
}
