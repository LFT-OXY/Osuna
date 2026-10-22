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
 * new-api 与 sub2api 各有一个只认账户令牌的查询（账户余额）和同站点只认 key 的查询（这把 key 的余额），
 * 照 magpie 的 newAPIUserSelf、newAPIKeyUsage、sub2APIProfile、sub2APIKeyUsage 与 tokenQueries。
 */
export const NEW_API_BALANCE_QUERIES = {
  account: "/api/user/self",
  key: "/api/usage/token",
} as const;
export const SUB2API_BALANCE_QUERIES = {
  account: "/api/v1/user/profile",
  key: "/v1/usage",
} as const;

/** 地址的路径，去掉末尾的斜杠；读不懂为空（照 magpie balanceURLPath）。 */
export function balanceUrlPath(balanceUrl: string): string {
  try {
    return new URL(balanceUrl.trim()).pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/**
 * 回复已知的几种查询，取值写法空着时照这个取（magpie #881）：new-api 的 key 级与账户级（500000 换 1 美元）、
 * sub2api 的 key 级与账户级、OpenAI 旧式的 credit grants；别的地址没有默认写法。
 */
export function defaultBalanceField(balanceUrl: string): string | null {
  const path = balanceUrlPath(balanceUrl);
  if (path === "") return null;
  if (path === NEW_API_BALANCE_QUERIES.account) return "$data.quota / 500000";
  if (path === NEW_API_BALANCE_QUERIES.key) return "$data.total_available / 500000";
  if (path === SUB2API_BALANCE_QUERIES.account) return "$data.balance";
  if (path === SUB2API_BALANCE_QUERIES.key) return "$remaining";
  if (path.endsWith("/dashboard/billing/credit_grants")) return "$total_available";
  return null;
}

/**
 * 要用云账号密钥读套餐窗口的地址是哪家的（照 magpie AccessKeyVendor）：volcengine 是火山方舟（ark.<region>.volces.com，
 * 不论哪个套餐），tencent 是腾讯云 Token Plan 企业版（tokenhub.tencentmaas.com 或 tokenhub-intl.tencentmaas.com 的 /plan 下）；
 * 别的为 null。编辑窗口只在这两家的地址给 AccessKey 两栏。
 */
export type ApiEndpointAccessKeyVendor = "volcengine" | "tencent";

/** 腾讯云 Token Plan 企业版的两个主机与各自云 API 的区（广州、新加坡）。 */
export const TENCENT_TOKEN_PLAN_REGIONS: Readonly<Record<string, "ap-guangzhou" | "ap-singapore">> =
  {
    "tokenhub.tencentmaas.com": "ap-guangzhou",
    "tokenhub-intl.tencentmaas.com": "ap-singapore",
  };

export function accessKeyVendorOf(addresses: readonly string[]): ApiEndpointAccessKeyVendor | null {
  const parsed = addresses.flatMap((address) => {
    try {
      return [new URL(address.trim())];
    } catch {
      return [];
    }
  });
  const isArk = parsed.some((url) => {
    const host = url.hostname.toLowerCase();
    return host.startsWith("ark.") && host.endsWith(".volces.com");
  });
  if (isArk) return "volcengine";
  const isTokenPlan = parsed.some(
    (url) =>
      Object.hasOwn(TENCENT_TOKEN_PLAN_REGIONS, url.hostname.toLowerCase()) &&
      `${url.pathname.replace(/\/+$/, "")}/`.startsWith("/plan/"),
  );
  return isTokenPlan ? "tencent" : null;
}
