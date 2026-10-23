// 取值写法的占位照 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的 balanceFieldOf，7597c132）；
// 令牌配错地址与缺用户 ID 的提示照同一文件的 balanceFix；团队两个 ID 要都填照同一文件编辑器保存时的 zhipuTeam 检查，
// 哪些地址给这两栏照 internal/provider/planquota.go 的 TakesZhipuTeam。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import {
  balanceMethodOf,
  balanceUrlPath,
  defaultBalanceField,
  NEW_API_BALANCE_QUERIES,
  SUB2API_BALANCE_QUERIES,
  type ApiEndpointBalanceMethod,
} from "@getpaseo/protocol/api-endpoint/balance-settings";
import type {
  ApiEndpointBalanceReading,
  ApiEndpointBalanceSettings,
  ApiEndpointBalanceUrlAttempt,
  ApiEndpointSaveRequest,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/*
 * 添加 / 编辑窗口「高级」里余额设置的纯逻辑：存的设置与表单里的样子互相换算。
 */

/** 表单里的余额设置：余额查询地址、方法、取值写法、new-api 的用户 ID、智谱团队组织 ID 与项目 ID。 */
export interface BalanceFields {
  balanceUrlText: string;
  balanceMethod: ApiEndpointBalanceMethod;
  balanceFieldText: string;
  balanceUserIdText: string;
  balanceTeamOrgIdText: string;
  balanceTeamProjectIdText: string;
}

/** 「查询余额」：没按过、查询中、查到的读数（含查不到的原因）、请求本身没成立（断线、主机拒收）。 */
export type BalanceCheck =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "done"; reading: ApiEndpointBalanceReading }
  | { status: "failed"; message: string };

/**
 * 「自动识别」：没按过、识别中、试中了（地址已填进表单，带它查出的读数）、都不中（每个试过的地址与原因）、
 * 请求本身没成立（断线、主机拒收）。
 */
export type BalanceDetect =
  | { status: "idle" }
  | { status: "detecting" }
  | { status: "found"; url: string; reading: ApiEndpointBalanceReading }
  | { status: "missed"; attempts: ApiEndpointBalanceUrlAttempt[] }
  | { status: "failed"; message: string };

export function balanceFieldsOf(settings: ApiEndpointBalanceSettings | undefined): BalanceFields {
  return {
    balanceUrlText: settings?.url ?? "",
    balanceMethod: balanceMethodOf(settings?.method) === "POST" ? "POST" : "GET",
    balanceFieldText: settings?.field ?? "",
    balanceUserIdText: settings?.userId ?? "",
    balanceTeamOrgIdText: settings?.teamOrgId ?? "",
    balanceTeamProjectIdText: settings?.teamProjectId ?? "",
  };
}

/** 填了余额查询地址或智谱团队的 ID：表单一打开就展开「高级」。 */
export function hasBalanceSettings(fields: BalanceFields): boolean {
  return [fields.balanceUrlText, fields.balanceTeamOrgIdText, fields.balanceTeamProjectIdText].some(
    (text) => text.trim() !== "",
  );
}

/**
 * 保存与「查询余额」时整份发的样子：去掉首尾空白，空的不发，GET 是缺省不发；没有地址时只发智谱团队的 ID，
 * 都没有即 {}（清掉）。
 */
export function balanceSettingsOf(fields: BalanceFields): ApiEndpointBalanceSettings {
  const teamOrgId = fields.balanceTeamOrgIdText.trim();
  const teamProjectId = fields.balanceTeamProjectIdText.trim();
  const team = {
    ...(teamOrgId === "" ? {} : { teamOrgId }),
    ...(teamProjectId === "" ? {} : { teamProjectId }),
  };
  const url = fields.balanceUrlText.trim();
  if (url === "") return team;
  const field = fields.balanceFieldText.trim();
  const userId = fields.balanceUserIdText.trim();
  return {
    url,
    ...(fields.balanceMethod === "POST" ? { method: "POST" } : {}),
    ...(field === "" ? {} : { field }),
    ...(userId === "" ? {} : { userId }),
    ...team,
  };
}

/** 团队的两个 ID 只填了一个：照 magpie 不让保存，要么都填要么都空。 */
export function hasLoneTeamId(fields: BalanceFields): boolean {
  const hasOrg = fields.balanceTeamOrgIdText.trim() !== "";
  const hasProject = fields.balanceTeamProjectIdText.trim() !== "";
  return hasOrg !== hasProject;
}

const ZHIPU_HOSTS = new Set(["open.bigmodel.cn", "api.z.ai"]);

/** 这家的地址在智谱或 Z.ai（照 magpie TakesZhipuTeam）：编辑窗口给团队组织 ID 与项目 ID 两栏。 */
export function isZhipuAddress(addresses: readonly string[]): boolean {
  return addresses.some((address) => {
    try {
      return ZHIPU_HOSTS.has(new URL(address.trim()).hostname.toLowerCase());
    } catch {
      return false;
    }
  });
}

/** 账户令牌在保存与「查询余额」里的样子：打了的发（去掉首尾空白），移除了发空字符串，没动不发（daemon 留原来的）。 */
export function balanceTokenRequest(input: {
  typed: string;
  removed: boolean;
}): Pick<ApiEndpointSaveRequest, "balanceToken"> {
  const typed = input.typed.trim();
  if (typed !== "") return { balanceToken: typed };
  return input.removed ? { balanceToken: "" } : {};
}

/**
 * 云账号密钥在保存里的样子：各自打了的发（去掉首尾空白）；移除了的没重打的那样发空字符串；没动不发（daemon 留原来的）。
 */
export function accessKeyRequest(input: {
  typedId: string;
  typedSecret: string;
  removed: boolean;
}): Pick<ApiEndpointSaveRequest, "accessKeyId" | "secretAccessKey"> {
  const id = input.typedId.trim();
  const secret = input.typedSecret.trim();
  const cleared = input.removed ? "" : undefined;
  const accessKeyId = id === "" ? cleared : id;
  const secretAccessKey = secret === "" ? cleared : secret;
  return {
    ...(accessKeyId === undefined ? {} : { accessKeyId }),
    ...(secretAccessKey === undefined ? {} : { secretAccessKey }),
  };
}

/** 存下来有 ID 却没有 Secret（打了的或存着没移除的）：要补上 Secret（照 magpie「Give the access key's Secret too」）。 */
export function hasLoneAccessKey(input: { hasId: boolean; hasSecret: boolean }): boolean {
  return input.hasId && !input.hasSecret;
}

/**
 * 令牌与地址对不上时的提示（照 magpie balanceFix）：令牌配了只认 key 的查询，或没填地址，给同站点该改用的账户查询；
 * new-api 的账户查询没有用户 ID（也没有 New-Api-User 头）时提示补上。没有令牌时什么都不说。
 */
export type BalanceFix =
  | {
      kind: "token_url";
      reason: "new_api_key_query" | "sub2api_key_query" | "no_url";
      useUrls: string[];
    }
  | { kind: "user_id" };

// 「改用 …」给的账户查询，先后照 magpie balanceFix。
const ACCOUNT_QUERIES = [NEW_API_BALANCE_QUERIES.account, SUB2API_BALANCE_QUERIES.account] as const;

export function balanceFixOf(input: {
  hasToken: boolean;
  balanceUrl: string;
  userId: string;
  // 这家的各格式地址，依 Chat、Anthropic、Responses 的先后（照 magpie），没认出站点时用第一个像样的。
  addresses: readonly string[];
  headerNames: readonly string[];
}): BalanceFix | null {
  if (!input.hasToken) return null;
  const url = input.balanceUrl.trim();
  const path = balanceUrlPath(url);
  const reason = tokenUrlReasonOf({ url, path, addresses: input.addresses });
  if (reason !== null) {
    const site = originOf(url) ?? input.addresses.map(originOf).find((origin) => origin !== null);
    const queries =
      reason === "sub2api_key_query" ? [SUB2API_BALANCE_QUERIES.account] : ACCOUNT_QUERIES;
    return { kind: "token_url", reason, useUrls: site ? queries.map((query) => site + query) : [] };
  }
  const hasUserHeader = input.headerNames.some(
    (name) => name.trim().toLowerCase() === "new-api-user",
  );
  const lacksUserId = input.userId.trim() === "" && !hasUserHeader;
  if (path === NEW_API_BALANCE_QUERIES.account && lacksUserId) {
    return { kind: "user_id" };
  }
  return null;
}

/**
 * 改用账户查询时取值写法怎么办（照 magpie）：空的或是 key 查询那几种写法的，让位给新地址的默认写法（清空，占位写出默认写法）；
 * 用户自己写的别的写法留着。
 */
export function fieldAfterUsing(field: string): string {
  const keyQueryField = /total_(available|granted|used)|unlimited_quota|^\s*\$?remaining\s*$/;
  return field.trim() === "" || keyQueryField.test(field) ? "" : field;
}

/** 令牌配的地址哪里不对：只认 key 的查询，或没填地址（AiHubMix 不用填）；没问题为 null。 */
function tokenUrlReasonOf(input: {
  url: string;
  path: string;
  addresses: readonly string[];
}): "new_api_key_query" | "sub2api_key_query" | "no_url" | null {
  if (input.path === NEW_API_BALANCE_QUERIES.key) return "new_api_key_query";
  if (input.path === SUB2API_BALANCE_QUERIES.key) return "sub2api_key_query";
  if (input.url === "" && !input.addresses.some(isAiHubMix)) return "no_url";
  return null;
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** AiHubMix 不填地址也认令牌：问它的账户余额（daemon 按主机名认）。 */
function isAiHubMix(address: string): boolean {
  try {
    return new URL(address.trim()).hostname.toLowerCase() === "aihubmix.com";
  } catch {
    return false;
  }
}

/** 取值写法框的占位：地址是回复已知的查询时写出默认写法，别的写一个例子（照 magpie）。 */
export function balanceFieldPlaceholder(balanceUrl: string): string {
  return defaultBalanceField(balanceUrl) ?? "data.balance";
}
