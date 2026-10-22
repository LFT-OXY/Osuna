// 取值写法的占位照 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的 balanceFieldOf，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import {
  balanceMethodOf,
  defaultBalanceField,
  type ApiEndpointBalanceMethod,
} from "@getpaseo/protocol/api-endpoint/balance-settings";
import type {
  ApiEndpointBalanceReading,
  ApiEndpointBalanceSettings,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/*
 * 添加 / 编辑窗口「高级」里余额设置的纯逻辑：存的设置与表单里的样子互相换算。
 */

/** 表单里的余额设置：余额查询地址、方法、取值写法。 */
export interface BalanceFields {
  balanceUrlText: string;
  balanceMethod: ApiEndpointBalanceMethod;
  balanceFieldText: string;
}

/** 「查询余额」：没按过、查询中、查到的读数（含查不到的原因）、请求本身没成立（断线、主机拒收）。 */
export type BalanceCheck =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "done"; reading: ApiEndpointBalanceReading }
  | { status: "failed"; message: string };

export function balanceFieldsOf(settings: ApiEndpointBalanceSettings | undefined): BalanceFields {
  return {
    balanceUrlText: settings?.url ?? "",
    balanceMethod: balanceMethodOf(settings?.method) === "POST" ? "POST" : "GET",
    balanceFieldText: settings?.field ?? "",
  };
}

/** 填了余额查询地址：表单一打开就展开「高级」。 */
export function hasBalanceSettings(fields: BalanceFields): boolean {
  return fields.balanceUrlText.trim() !== "";
}

/** 保存与「查询余额」时整份发的样子：去掉首尾空白，空的不发，GET 是缺省不发；没有地址即 {}（清掉）。 */
export function balanceSettingsOf(fields: BalanceFields): ApiEndpointBalanceSettings {
  const url = fields.balanceUrlText.trim();
  if (url === "") return {};
  const field = fields.balanceFieldText.trim();
  return {
    url,
    ...(fields.balanceMethod === "POST" ? { method: "POST" } : {}),
    ...(field === "" ? {} : { field }),
  };
}

/** 取值写法框的占位：地址是回复已知的查询时写出默认写法，别的写一个例子（照 magpie）。 */
export function balanceFieldPlaceholder(balanceUrl: string): string {
  return defaultBalanceField(balanceUrl) ?? "data.balance";
}
