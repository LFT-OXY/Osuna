// 余额查询方法与按地址给的默认取值写法照 magpie（https://github.com/yetone/magpie，internal/provider/balance.go 的
// balanceMethodOf、balancePathOf、balanceURLPath，internal/gui/assets/app.js 的 balanceFieldOf，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

/*
 * 接口的余额设置（余额查询地址、方法、取值写法）：daemon 按它查余额，app 在编辑窗口拿它当场给默认写法的占位。
 */

/** 余额查询地址只用这两种方法问；POST 不带正文（magpie #2368）。 */
export const API_ENDPOINT_BALANCE_METHODS = ["GET", "POST"] as const;
export type ApiEndpointBalanceMethod = (typeof API_ENDPOINT_BALANCE_METHODS)[number];

/** 写的方法读成哪种：空即 GET，大小写不论；别的为 null（不发，也不当 GET 发）。 */
export function balanceMethodOf(raw: string | undefined): ApiEndpointBalanceMethod | null {
  const method = (raw ?? "").trim().toUpperCase();
  if (method === "" || method === "GET") return "GET";
  if (method === "POST") return "POST";
  return null;
}

/**
 * 回复已知的几种查询，取值写法空着时照这个取（magpie #881）：new-api 的 key 级与账户级（500000 换 1 美元）、
 * sub2api 的 key 级与账户级、OpenAI 旧式的 credit grants；别的地址没有默认写法。
 */
export function defaultBalanceField(balanceUrl: string): string | null {
  let path: string;
  try {
    path = new URL(balanceUrl.trim()).pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
  if (path === "/api/user/self") return "$data.quota / 500000";
  if (path === "/api/usage/token") return "$data.total_available / 500000";
  if (path === "/api/v1/user/profile") return "$data.balance";
  if (path === "/v1/usage") return "$remaining";
  if (path.endsWith("/dashboard/billing/credit_grants")) return "$total_available";
  return null;
}
