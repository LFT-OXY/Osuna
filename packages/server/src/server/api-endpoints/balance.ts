// 按地址认出的厂商余额、失败的说法照 magpie（https://github.com/yetone/magpie，internal/provider/balance.go 的
// balanceSourceOf、balanceRead、balanceRefusal、money、currencySign、number 与各厂商的 read*，7597c132；
// DeepSeek 的赠送 / 充值拆分与 OpenCode Zen 的说明照最新版 ea6be159 的 readDeepSeekSplit、errOpenCodeNoBalance、openCodeZen）。
// 填了余额查询地址时的自定义余额照 magpie 的 balanceRead、balanceMethodOf、balanceKeyNames、withBalanceKey（7597c132）。
// 账户令牌照 magpie 的 keyQueryOf、keyNotToken、balanceAuthorization、errKeyQueryWithToken、newAPIUserHint、
// readAiHubMixAccount，sub2api 的限额窗口照 sub2api_usage.go 的 readSub2APIKeyLimits 与 Balance（7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import {
  balanceMethodOf,
  balanceUrlPath,
  defaultBalanceField,
  NEW_API_BALANCE_QUERIES,
  SUB2API_BALANCE_QUERIES,
} from "@getpaseo/protocol/api-endpoint/balance-settings";
import type {
  ApiEndpointBalanceFailure,
  ApiEndpointBalanceFailureReason,
  ApiEndpointBalanceHint,
  ApiEndpointBalanceItem,
  ApiEndpointBalanceReading,
  ApiEndpointBalanceWindow,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  secretsOf,
  unsendableHeader,
  unsendableHeaderMessage,
  withUserHeaders,
  type RequestExtras,
} from "./request-extras.js";
import { numberOf, readBalanceField } from "./balance-field.js";
import { upstreamFetch, type UpstreamResponse } from "./insecure-tls.js";
import type { StoredApiEndpoint } from "./store.js";
import {
  describeNetworkError,
  isRecord,
  parseJson,
  redactKey,
  structuredErrorMessage,
} from "./upstream-http.js";
import { hostOf } from "./vendor-status.js";

/*
 * 接口的余额：厂商自己的余额接口说这把 key 还剩多少。只显示，从不进中转站选路。
 * 填了余额查询地址就按它查（GET 或不带正文的 POST），按取值写法取值，不再按地址认（照 magpie balanceSourceOf）；
 * 地址与请求头里的 {key} 一类占位换成 key（地址里先转义）。
 * 没填时厂商按接口各格式地址的主机名精确认（顺序同 magpie：Chat、Responses、Anthropic），不看模板。
 * 请求带 key 的 Bearer 头、Accept、Osuna 的 User-Agent，再写上这家自己的请求头（用户的可以盖过 User-Agent，ADR 0008）。
 * 填了账户令牌（new-api、sub2api、AiHubMix 的账户余额）时用它代替 key 作 Authorization：形如 JWT 的加「Bearer 」，
 * 其余原样（照 magpie balanceAuthorization）；new-api 的用户 ID 只在这里作为 New-Api-User 发出。
 * 回复里的 key、令牌与请求头的值打码后截到 200 字给界面看。
 */

/** 各厂商的余额查询（照 magpie balanceSourceOf）；测试 daemon 把它们换成本机地址。 */
export const BALANCE_VENDOR_URLS = {
  deepseek: "https://api.deepseek.com/user/balance",
  moonshot_cn: "https://api.moonshot.cn/v1/users/me/balance",
  moonshot_ai: "https://api.moonshot.ai/v1/users/me/balance",
  openrouter: "https://openrouter.ai/api/v1/credits",
  siliconflow_cn: "https://api.siliconflow.cn/v1/user/info",
  siliconflow_com: "https://api.siliconflow.com/v1/user/info",
  stepfun_com: "https://api.stepfun.com/v1/accounts",
  stepfun_ai: "https://api.stepfun.ai/v1/accounts",
  commandcode: "https://api.commandcode.ai/alpha/billing/credits",
  ollama: "https://ollama.com/api/balance",
  aihubmix: "https://aihubmix.com/dashboard/billing/remain",
  // 填了账户令牌时问整个账户的余额。
  aihubmix_account: "https://aihubmix.com/api/user/self",
} as const;

export type BalanceVendorId = keyof typeof BALANCE_VENDOR_URLS;

/** 回复说明这家不给查（或要别的凭据），不是没取到值。 */
interface BalanceNotOffered {
  kind: "not_offered";
  hint: ApiEndpointBalanceHint;
  seeAt: string | null;
}

/**
 * 读一份回复的结果：余额各项（空的是这家现在没有余额可显示）、这家不给查、取不到值（detail 是 magpie 给的说明）、
 * 回复说令牌不对。
 */
type BalanceRead =
  | { kind: "items"; items: ApiEndpointBalanceItem[] }
  | BalanceNotOffered
  | { kind: "no_value"; detail: string | null }
  | { kind: "rejected"; detail: string };

const NO_VALUE: BalanceRead = { kind: "no_value", detail: null };

function itemsOf(...items: ApiEndpointBalanceItem[]): BalanceRead {
  return { kind: "items", items };
}

interface BalanceVendor {
  id: BalanceVendorId;
  host: string;
  read: (body: unknown) => BalanceRead;
  // 状态 ≥300 时这家已知的说法（照 magpie balanceSource.failed）；不是它时 null。
  failed?: (status: number, body: unknown) => BalanceNotOffered | null;
  // 填了账户令牌时改问整个账户：令牌代替 key，这家自己的请求头不带（照 magpie）。
  account?: { id: BalanceVendorId; read: (body: unknown) => BalanceRead };
}

const BALANCE_VENDORS: readonly BalanceVendor[] = [
  { id: "deepseek", host: "api.deepseek.com", read: readDeepSeek },
  { id: "moonshot_cn", host: "api.moonshot.cn", read: readMoonshot("CNY") },
  { id: "moonshot_ai", host: "api.moonshot.ai", read: readMoonshot("USD") },
  { id: "openrouter", host: "openrouter.ai", read: readOpenRouter },
  {
    id: "siliconflow_cn",
    host: "api.siliconflow.cn",
    read: readSiliconFlow("CNY"),
    failed: siliconFlowGone("https://cloud.siliconflow.cn"),
  },
  {
    id: "siliconflow_com",
    host: "api.siliconflow.com",
    read: readSiliconFlow("USD"),
    failed: siliconFlowGone("https://cloud.siliconflow.com"),
  },
  { id: "stepfun_com", host: "api.stepfun.com", read: readStepFun("CNY") },
  { id: "stepfun_ai", host: "api.stepfun.ai", read: readStepFun("USD") },
  { id: "commandcode", host: "api.commandcode.ai", read: readCommandCode },
  // 套餐之外买的 credits（magpie #1888）；套餐额度是套餐窗口，不在这里。
  { id: "ollama", host: "ollama.com", read: readOllamaCredits },
  // 不填令牌时问 key 自己还剩多少，填了问整个账户。
  {
    id: "aihubmix",
    host: "aihubmix.com",
    read: readAiHubMix,
    account: { id: "aihubmix_account", read: readAiHubMixAccount },
  },
];

/** OpenCode 的控制台：Zen 的按量 credits 只在这里（Overview → Credits）给工作区的所有者与管理员看。 */
const OPENCODE_CONSOLE = "https://opencode.ai/console";

// 照 magpie balanceSourceOf 的先后。
const FORMAT_ORDER = ["openai_chat", "openai_responses", "anthropic_messages"] as const;

export const BALANCE_READ_TIMEOUT_MS = 15_000;
// 一次读余额请求（整页刷新）最多等这么久，照 magpie 单卡刷新的 30 秒（gui/usage.go）。
export const BALANCE_PAGE_TIMEOUT_MS = 30_000;
// 每家的读数留这么久，照 magpie keyBalanceCache。
export const BALANCE_KEPT_MS = 60_000;
// 回复最多读这么多字节（照 magpie io.LimitReader）。
const MAX_BODY_BYTES = 1 << 20;
const MAX_DETAIL_CHARS = 200;

/** 这家接口的地址对上的余额厂商；中转站与认不出的为 null。 */
export function balanceVendorOf(baseUrls: StoredApiEndpoint["baseUrls"]): BalanceVendorId | null {
  for (const format of FORMAT_ORDER) {
    const url = baseUrls.find((entry) => entry.format === format)?.url;
    if (url === undefined) continue;
    const host = hostOf(url);
    const vendor = BALANCE_VENDORS.find((candidate) => candidate.host === host);
    if (vendor) return vendor.id;
  }
  return null;
}

export interface ReadBalanceInput {
  endpoint: Pick<StoredApiEndpoint, "id" | "baseUrls" | "balance">;
  apiKey: string | null;
  // 账户令牌；没有为 null。
  balanceToken: string | null;
  extras: RequestExtras;
  userAgent: string;
  now: () => Date;
  // 只给测试：把厂商表里的真实地址换成本机假服务。
  vendorUrls?: Partial<Record<BalanceVendorId, string>>;
  // 连接断了：抛错，不回读数。
  signal: AbortSignal;
  // 整页的期限到了：和单次超时一样算暂时查不到。
  deadline: AbortSignal;
}

/** 「自动刷新余额与套餐用量」关着、这次不是用户要求的读取、也还没有读数：什么都不发（照 magpie errNotAsked）。 */
export function notAskedReading(endpointId: string): ApiEndpointBalanceReading {
  return {
    endpointId,
    status: "failed",
    items: [],
    readAt: null,
    failure: { reason: "temporary", detail: null, status: null, hint: "not_asked" },
  };
}

/** 读一家的余额：认不出或没有 key 时什么都不发（magpie 同样不查没 key 的）。 */
export async function readEndpointBalance(
  input: ReadBalanceInput,
): Promise<ApiEndpointBalanceReading> {
  const endpointId = input.endpoint.id;
  const readAt = input.now().toISOString();
  const failed = (failure: ApiEndpointBalanceFailure): ApiEndpointBalanceReading => ({
    endpointId,
    status: "failed",
    items: [],
    readAt,
    failure,
  });
  const source = sourceOf(input);
  if (source === null && input.apiKey && openCodeZen(input.endpoint.baseUrls)) {
    // OpenCode 不给 key 查 Zen 的余额：照 magpie 说明去哪看，不发请求，也就没有读数时间。
    return {
      endpointId,
      status: "failed",
      items: [],
      readAt: null,
      failure: {
        reason: "not_offered",
        detail: null,
        status: null,
        hint: "opencode_no_balance",
        seeAt: OPENCODE_CONSOLE,
      },
    };
  }
  if (source === null || !input.apiKey) {
    return { endpointId, status: "unsupported", items: [], readAt: null, failure: null };
  }
  const apiKey = input.apiKey;
  const extras = withKeyInHeaders(input.extras, apiKey);
  const secrets = [
    ...secretsOf({ apiKey, extras }),
    queryEscape(apiKey),
    ...(source.token === null ? [] : [source.token]),
  ];
  const keyQuery = source.token === null ? null : keyQueryInsteadOf(source.url);
  if (keyQuery !== null) {
    // 令牌配了只认 key 的查询：问了也只会被拒，照 magpie 不发，说该改用哪个地址。
    return failed({
      reason: "wrong_url",
      detail: null,
      status: null,
      hint: "token_on_key_url",
      useUrl: keyQuery,
    });
  }
  if (source.method === null) {
    // 手改坏的方法照 magpie 不发，也不当 GET 发。
    return failed({
      reason: "wrong_url",
      detail: `the balance method ${JSON.stringify(input.endpoint.balance?.method ?? "")} is neither GET nor POST`,
      status: null,
    });
  }
  const problem = unsendableHeader(extras);
  if (problem !== null) {
    // 这家自己的请求头发不出去：照 magpie 当作没查成（它原样报错，界面归为暂时查不到），原因写明是哪个头。
    return failed({
      reason: "temporary",
      detail: unsendableHeaderMessage(problem),
      status: null,
    });
  }
  const headers = requestHeadersOf({ source, apiKey, extras, userAgent: input.userAgent });
  let status: number;
  let text: string;
  try {
    const response = await upstreamFetch({
      url: withKeyInUrl(source.url, apiKey),
      init: {
        ...(source.method === "POST" ? { method: "POST" as const } : {}),
        headers,
        signal: AbortSignal.any([
          input.signal,
          AbortSignal.timeout(BALANCE_READ_TIMEOUT_MS),
          input.deadline,
        ]),
      },
      uncheckedHosts: input.extras.uncheckedHosts,
    });
    status = response.status;
    text = await readCapped(response);
  } catch (error) {
    if (input.signal.aborted) throw error;
    return failed({
      reason: "temporary",
      detail: clip(redactKey(describeNetworkError(error), secrets)),
      status: null,
    });
  }
  const replied = readReply({ source, status, text, secrets });
  if ("items" in replied) {
    return {
      endpointId,
      status: "ok",
      items: replied.items,
      ...(replied.windows.length > 0 ? { windows: replied.windows } : {}),
      readAt,
      failure: null,
    };
  }
  return failed(replied);
}

/**
 * 这次请求的头。用 key 问：key 的 Bearer 头、Accept、User-Agent，再写这家的请求头（可以盖过前面的）。
 * 用令牌问用户填的地址：这家的请求头照带，Authorization 换成令牌；问认得的厂商（AiHubMix）只带令牌（照 magpie balanceRead）。
 * 用户填的地址带上用户 ID 作 New-Api-User，盖过请求头里的。
 */
function requestHeadersOf(input: {
  source: BalanceSource;
  apiKey: string;
  extras: RequestExtras;
  userAgent: string;
}): Record<string, string> {
  const { source, extras } = input;
  const base = { accept: "application/json", "user-agent": input.userAgent };
  let headers: Record<string, string>;
  if (source.token === null) {
    headers = withUserHeaders({ authorization: `Bearer ${input.apiKey}`, ...base }, extras);
  } else if (source.isCustom) {
    headers = withoutHeader(withUserHeaders(base, extras), "authorization");
    headers.authorization = balanceAuthorization(source.token);
  } else {
    headers = { ...base, authorization: balanceAuthorization(source.token) };
  }
  if (source.userId !== null) {
    headers = withoutHeader(headers, "new-api-user");
    headers["new-api-user"] = source.userId;
  }
  return headers;
}

function withoutHeader(headers: Record<string, string>, name: string): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== name));
}

/** 令牌作 Authorization（照 magpie balanceAuthorization）：带空格的原样（已写了方案），形如 JWT 的加「Bearer 」，其余原样。 */
function balanceAuthorization(token: string): string {
  if (token.includes(" ")) return token;
  if (token.startsWith("eyJ") && token.split(".").length === 3) return `Bearer ${token}`;
  return token;
}

/** 对方的回复读成余额各项，或失败的原因（照 magpie balanceRead 的先后：拒绝、状态、不是 JSON、取值）。 */
function readReply(input: {
  source: BalanceSource;
  status: number;
  text: string;
  secrets: readonly string[];
}): BalanceReplyItems | ApiEndpointBalanceFailure {
  const { source, status, text, secrets } = input;
  const notOffered = (note: BalanceNotOffered): ApiEndpointBalanceFailure => ({
    reason: "not_offered",
    detail: null,
    status,
    hint: note.hint,
    seeAt: note.seeAt,
  });
  const body = parseJson(text);
  const refusal = refusalOf(body);
  if (refusal !== null) {
    // new-api 一类的 {"success":false,"message":…}：不论状态码都是拒绝；说缺 New-Api-User 的提示补上用户 ID（magpie newAPIUserHint）。
    return {
      reason: "token_rejected",
      detail: clip(redactKey(refusal, secrets)),
      status,
      ...(refusal.toLowerCase().includes("new-api-user")
        ? { hint: "new_api_user_missing" as const }
        : {}),
    };
  }
  if (status >= 300) {
    const known = source.failed?.(status, body) ?? null;
    if (known !== null) return notOffered(known);
    return { reason: failureOfStatus(status), detail: quoted(text, secrets), status };
  }
  if (body === undefined) return { reason: "wrong_url", detail: null, status };
  const windows = source.readsKeyLimits ? sub2ApiKeyLimits(body) : [];
  const read = source.read(body);
  if (read.kind === "not_offered") return notOffered(read);
  if (read.kind === "rejected") {
    return { reason: "token_rejected", detail: clip(redactKey(read.detail, secrets)), status };
  }
  if (read.kind === "no_value") {
    const limitsOnly = windows.length > 0 && !source.namesField;
    if (limitsOnly) {
      // 只给了限额、没有总额度的 key 没有 remaining：它现在能花的是剩得最少的那个窗口（照 magpie Balance）。
      const left = Math.min(...windows.map((window) => (window.limit ?? 0) - (window.used ?? 0)));
      return { items: [moneyItem("USD", Math.max(0, left))], windows };
    }
    return {
      reason: "no_value",
      detail: read.detail && clip(redactKey(read.detail, secrets)),
      status,
    };
  }
  return { items: read.items, windows };
}

/** 去哪问、怎么问、怎么读回复；认不出且没填余额查询地址时为 null。 */
interface BalanceSource {
  url: string;
  // 方法读不懂（手改坏的）为 null：不发。
  method: "GET" | "POST" | null;
  read: (body: unknown) => BalanceRead;
  failed?: BalanceVendor["failed"];
  // 用户填的余额查询地址（不是按主机名认的厂商）。
  isCustom: boolean;
  // 代替 key 作 Authorization 的账户令牌；用 key 问时为 null。
  token: string | null;
  // 作 New-Api-User 发出的用户 ID；没填或不是用户填的地址时为 null。
  userId: string | null;
  // 用户自己写了取值写法。
  namesField: boolean;
  // sub2api 的 key 级查询：回复里另读限额窗口。
  readsKeyLimits: boolean;
}

// 先后照 magpie tokenQueries。
const TOKEN_QUERIES = [SUB2API_BALANCE_QUERIES, NEW_API_BALANCE_QUERIES] as const;

/** 用户填的余额查询地址与取值写法，问之前可能换成同站点的 key 查询（keyQueryWithoutToken）。 */
interface AskedQuery {
  url: string;
  field: string;
}

/** 一份回复读出的余额各项与限额窗口。 */
interface BalanceReplyItems {
  items: ApiEndpointBalanceItem[];
  windows: ApiEndpointBalanceWindow[];
}

function sourceOf(input: ReadBalanceInput): BalanceSource | null {
  const token = tokenOtherThanKey(input.balanceToken, input.apiKey);
  const custom = input.endpoint.balance;
  const savedUrl = custom?.url.trim() ?? "";
  if (custom !== undefined && savedUrl !== "") {
    const asked = keyQueryWithoutToken({
      url: savedUrl,
      field: custom.field?.trim() ?? "",
      token,
      extras: input.extras,
    });
    // 用户填的地址：取值写法空着时按地址给默认写法（magpie #881），都没有时照 magpie 说要写哪里。
    const field = asked.field || defaultBalanceField(asked.url) || "";
    return {
      url: asked.url,
      method: balanceMethodOf(custom.method),
      read: (body) => readBalanceField(body, field),
      isCustom: true,
      token,
      userId: custom.userId?.trim() || null,
      namesField: asked.field !== "",
      readsKeyLimits: balanceUrlPath(asked.url) === SUB2API_BALANCE_QUERIES.key,
    };
  }
  const vendorId = balanceVendorOf(input.endpoint.baseUrls);
  const vendor = BALANCE_VENDORS.find((candidate) => candidate.id === vendorId);
  if (!vendor) return null;
  const account = token === null ? undefined : vendor.account;
  const asked = account ?? vendor;
  // 认得的厂商照它的回答方式问：方法只跟用户自己的地址走。
  return {
    url: input.vendorUrls?.[asked.id] ?? BALANCE_VENDOR_URLS[asked.id],
    method: "GET",
    read: asked.read,
    ...(vendor.failed ? { failed: vendor.failed } : {}),
    isCustom: false,
    token: account === undefined ? null : token,
    userId: null,
    namesField: false,
    readsKeyLimits: false,
  };
}

/** 令牌只是这家的 key 再粘一遍（可带「Bearer 」）时当没有令牌，照用 key 的方式问（magpie keyNotToken）。 */
function tokenOtherThanKey(token: string | null, apiKey: string | null): string | null {
  let bare = token?.trim() ?? "";
  if (bare.length > 7 && bare.slice(0, 7).toLowerCase() === "bearer ") bare = bare.slice(7).trim();
  if (bare === "" || bare === apiKey?.trim()) return null;
  return token?.trim() ?? null;
}

/**
 * 填的是只认账户令牌的查询却没有令牌：改问同站点只认 key 的查询（magpie keyQueryOf），取值写法是账户查询的默认写法时
 * 改用 key 查询的默认写法。有令牌、用户自己写了 Authorization 或 Cookie 头时照填的问。
 */
function keyQueryWithoutToken(input: {
  url: string;
  field: string;
  token: string | null;
  extras: RequestExtras;
}): AskedQuery {
  const asSet = { url: input.url, field: input.field };
  if (input.token !== null) return asSet;
  const ownsAuth = Object.entries(input.extras.headers).some(
    ([name, value]) =>
      value.trim() !== "" && ["authorization", "cookie"].includes(name.toLowerCase()),
  );
  if (ownsAuth) return asSet;
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return asSet;
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  for (const query of TOKEN_QUERIES) {
    if (!path.endsWith(query.account)) continue;
    const accountField = defaultBalanceField(input.url);
    parsed.pathname = path.slice(0, -query.account.length) + query.key;
    parsed.search = "";
    parsed.hash = "";
    return { url: parsed.toString(), field: input.field === accountField ? "" : input.field };
  }
  return asSet;
}

/**
 * 令牌配了只认 key 的查询（new-api 的 /api/usage/token、sub2api 的 /v1/usage）：该改用的同站点账户查询（magpie
 * errKeyUsageWithToken、errSub2APIKeyUsageWithToken）；别的地址为 null。
 */
function keyQueryInsteadOf(url: string): string | null {
  const path = balanceUrlPath(url);
  const query = TOKEN_QUERIES.find((candidate) => candidate.key === path);
  if (query === undefined) return null;
  try {
    const parsed = new URL(url.trim());
    return `${parsed.origin}${query.account}`;
  } catch {
    return query.account;
  }
}

const SUB2API_WINDOWS = [
  { id: "5h", label: "5 hours" },
  { id: "1d", label: "1 day" },
  { id: "7d", label: "7 days" },
] as const;

/**
 * sub2api key 的限额窗口（照 magpie readSub2APIKeyLimits）：rate_limits 里每个窗口的已用、上限（美元）与重置时间，
 * 依 5 小时、1 天、7 天排；上限不是正数的不算。没有 reset_at 的窗口还没开始，或用完后还没再用。
 */
function sub2ApiKeyLimits(body: unknown): ApiEndpointBalanceWindow[] {
  if (!isRecord(body) || !Array.isArray(body.rate_limits)) return [];
  const limits = body.rate_limits.filter(isRecord);
  const windows: ApiEndpointBalanceWindow[] = [];
  for (const known of SUB2API_WINDOWS) {
    for (const entry of limits) {
      const limit = numberOf(entry.limit);
      const window = typeof entry.window === "string" ? entry.window.trim() : "";
      if (window !== known.id || limit === null || limit <= 0) continue;
      const used = Math.max(0, numberOf(entry.used) ?? 0);
      const usedPct = Math.min(100, Math.max(0, (used / limit) * 100));
      windows.push({
        id: known.id,
        label: known.label,
        usedPct,
        remainingPct: 100 - usedPct,
        resetsAt: isoOf(entry.reset_at),
        used,
        limit,
        unit: "USD",
      });
      break;
    }
  }
  return windows;
}

function isoOf(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** 地址或请求头的值里怎么写 key（照 magpie balanceKeyNames）：{key} {apiKey} {api_key} {API_KEY} {token} {{key}} ${API_KEY}，大小写不论。 */
const KEY_NAMES = /\$?\{\{?\s*(?:key|api[_-]?key|token)\s*\}?\}/gi;

function withKeyInUrl(url: string, apiKey: string): string {
  const escaped = queryEscape(apiKey);
  return url.replace(KEY_NAMES, () => escaped);
}

/** 这家的请求头里写的 key 占位换成 key（照 magpie withBalanceKey，只在查余额时）。 */
function withKeyInHeaders(extras: RequestExtras, apiKey: string): RequestExtras {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(extras.headers)) {
    headers[name] = value.replace(KEY_NAMES, () => apiKey);
  }
  return { ...extras, headers };
}

/** 照 Go 的 url.QueryEscape：空格写成 +，字母数字与 - _ . ~ 之外的都转义。 */
function queryEscape(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

/** 读回复的前 1 MB，读够就不再收。 */
async function readCapped(response: UpstreamResponse): Promise<string> {
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.chunks()) {
    const left = MAX_BODY_BYTES - size;
    parts.push(chunk.byteLength > left ? chunk.subarray(0, left) : chunk);
    size += Math.min(chunk.byteLength, left);
    if (size >= MAX_BODY_BYTES) break;
  }
  return Buffer.concat(parts).toString("utf8");
}

function failureOfStatus(status: number): ApiEndpointBalanceFailureReason {
  if (status === 401 || status === 403) return "token_rejected";
  if (status === 408 || status === 429 || status >= 500) return "temporary";
  // 404 与别的 4xx：问的地址或请求不对。
  return "wrong_url";
}

function refusalOf(body: unknown): string | null {
  if (!isRecord(body) || body.success !== false || typeof body.message !== "string") return null;
  const message = body.message.trim();
  return message === "" ? null : message;
}

/** 对方回的 JSON 怎么说（它写的错误信息，没有就整份压成一行）；网页与别的文字不引。 */
function quoted(text: string, secrets: readonly string[]): string | null {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine.startsWith("{") && !oneLine.startsWith("[")) return null;
  return clip(redactKey(structuredErrorMessage(text) ?? oneLine, secrets));
}

function clip(text: string): string {
  const chars = [...text];
  return chars.length > MAX_DETAIL_CHARS ? `${chars.slice(0, MAX_DETAIL_CHARS).join("")}…` : text;
}

/** 币种的符号：人民币 ¥、美元 $，别的写代码加空格。 */
function currencySign(code: string): string {
  const upper = code.toUpperCase();
  if (upper === "CNY" || upper === "RMB") return "¥";
  if (upper === "USD") return "$";
  if (upper === "") return "";
  return `${upper} `;
}

function moneyItem(code: string, value: number): ApiEndpointBalanceItem {
  const unit = code.toUpperCase();
  return {
    label: null,
    text: `${currencySign(unit)}${value.toFixed(2)}`,
    value,
    unit: unit === "" ? null : unit,
  };
}

interface DeepSeekAmount {
  code: string;
  total: number;
  // 赠送与充值：回复两项都给了才有。
  split: { granted: number; topped: number } | null;
}

/**
 * DeepSeek：{"balance_infos":[{"currency":"CNY","total_balance":"110.00","granted_balance":"10.00","topped_up_balance":"100.00"}]}。
 * 各币种「 · 」拼成一项，有余额的在前、同组按币种代码排（DeepSeek 每次给的顺序不同）；
 * 有赠送的币种在总额下拆出「赠送 / 充值」（magpie 最新版 readDeepSeekSplit）。
 */
function readDeepSeek(body: unknown): BalanceRead {
  if (!isRecord(body) || !Array.isArray(body.balance_infos)) return NO_VALUE;
  const amounts: DeepSeekAmount[] = [];
  for (const info of body.balance_infos) {
    if (!isRecord(info)) continue;
    const total = numberOf(info.total_balance);
    if (total === null) continue;
    const granted = numberOf(info.granted_balance);
    const topped = numberOf(info.topped_up_balance);
    amounts.push({
      code: typeof info.currency === "string" ? info.currency.toUpperCase() : "",
      total,
      split: granted !== null && topped !== null ? { granted, topped } : null,
    });
  }
  if (amounts.length === 0) return NO_VALUE;
  amounts.sort((a, b) => {
    if (a.total > 0 !== b.total > 0) return a.total > 0 ? -1 : 1;
    if (a.code === b.code) return 0;
    return a.code < b.code ? -1 : 1;
  });
  const [first] = amounts;
  const items: ApiEndpointBalanceItem[] = [
    {
      ...moneyItem(first.code, first.total),
      text: amounts.map((amount) => moneyItem(amount.code, amount.total).text).join(" · "),
    },
  ];
  for (const amount of amounts) {
    // 没有赠送的币种全是充值，总额已经说了。
    if (amount.split === null || amount.split.granted === 0) continue;
    items.push(
      { ...moneyItem(amount.code, amount.split.granted), label: "Granted", part: "granted" },
      { ...moneyItem(amount.code, amount.split.topped), label: "Topped up", part: "topped_up" },
    );
  }
  return itemsOf(...items);
}

/** Moonshot：{"code":0,"data":{"available_balance":49.58},"status":true}；.cn 人民币、.ai 美元。 */
function readMoonshot(code: string) {
  return (body: unknown): BalanceRead => {
    const value =
      isRecord(body) && isRecord(body.data) ? numberOf(body.data.available_balance) : null;
    return value === null ? NO_VALUE : itemsOf(moneyItem(code, value));
  };
}

/** OpenRouter：{"data":{"total_credits":20,"total_usage":3.5}}，美元，剩的是总额减已用。 */
function readOpenRouter(body: unknown): BalanceRead {
  if (!isRecord(body) || !isRecord(body.data)) return NO_VALUE;
  const credits = numberOf(body.data.total_credits);
  if (credits === null) return NO_VALUE;
  return itemsOf(moneyItem("USD", credits - (numberOf(body.data.total_usage) ?? 0)));
}

/** 硅基流动：{"code":20000,"data":{"totalBalance":"88.88"}}。 */
function readSiliconFlow(code: string) {
  return (body: unknown): BalanceRead => {
    const value = isRecord(body) && isRecord(body.data) ? numberOf(body.data.totalBalance) : null;
    return value === null ? NO_VALUE : itemsOf(moneyItem(code, value));
  };
}

/**
 * 硅基流动 2026-08-14 下线了 /v1/user/info（410，code 20092，magpie #1094），还没有替代的接口，
 * 余额与代金券只能去控制台看。key 本身被拒（401 30014）照原样说。
 */
function siliconFlowGone(consoleUrl: string) {
  return (status: number, body: unknown): BalanceNotOffered | null => {
    const code = isRecord(body) ? body.code : undefined;
    if (status !== 410 && code !== 20092) return null;
    return { kind: "not_offered", hint: "siliconflow_retired", seeAt: consoleUrl };
  };
}

/** 阶跃：{"object":"account","balance":26.00,…}，balance 是还能花的，含代金券。 */
function readStepFun(code: string) {
  return (body: unknown): BalanceRead => {
    const value = isRecord(body) ? numberOf(body.balance) : null;
    return value === null ? NO_VALUE : itemsOf(moneyItem(code, value));
  };
}

/** Command Code：{"credits":{"monthlyCredits":41.2,"purchasedCredits":5,"freeCredits":0}}，三项之和（负数按 0），美元。 */
function readCommandCode(body: unknown): BalanceRead {
  if (!isRecord(body) || !isRecord(body.credits)) return NO_VALUE;
  const credits = body.credits;
  let left = 0;
  let found = false;
  for (const value of [credits.monthlyCredits, credits.purchasedCredits, credits.freeCredits]) {
    const amount = numberOf(value);
    if (amount === null) continue;
    left += Math.max(0, amount);
    found = true;
  }
  return found ? itemsOf(moneyItem("USD", left)) : NO_VALUE;
}

/**
 * Ollama Cloud：{"included":{…},"purchased":{"balance_usd":25.0}}，套餐之外买的 credits（美元）。
 * 没买过的不出这一项；included、purchased 都没有的回复取不到值。
 */
function readOllamaCredits(body: unknown): BalanceRead {
  if (!isRecord(body)) return NO_VALUE;
  const purchased = isRecord(body.purchased) ? body.purchased : null;
  if (purchased === null) {
    if (isRecord(body.included)) return itemsOf();
    return {
      kind: "no_value",
      detail: `Ollama's reply has no included or purchased balance: ${shapeOf(body)}`,
    };
  }
  const value = numberOf(purchased.balance_usd);
  return value === null ? itemsOf() : itemsOf(moneyItem("USD", value));
}

/** 回复的结构（照 magpie shapeOf）：顶层与第二层的字段名，排序后最多 12 个，不带值。 */
function shapeOf(body: Record<string, unknown>): string {
  const names: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    const inner = isRecord(value) ? Object.keys(value) : [];
    if (inner.length === 0) names.push(key);
    else names.push(...inner.map((name) => `${key}.${name}`));
  }
  if (names.length === 0) return "an empty object";
  names.sort();
  const shown = names.length > 12 ? [...names.slice(0, 12), "…"] : names;
  return `fields ${shown.join(", ")}`;
}

/**
 * AiHubMix：{"object":"list","total_usage":12.5}，名字叫 usage 其实是 key 还剩的美元。
 * 没设上限的 key 回负数：它没有自己的余额，账户余额只告诉账户令牌，不告诉 key。
 */
function readAiHubMix(body: unknown): BalanceRead {
  const value = isRecord(body) ? numberOf(body.total_usage) : null;
  if (value === null) return NO_VALUE;
  if (value < 0) return { kind: "not_offered", hint: "aihubmix_no_limit", seeAt: null };
  return itemsOf(moneyItem("USD", value));
}

/**
 * AiHubMix 的账户（填了账户令牌）：{"success":true,"data":{"quota":2500000}}，按 500000 换 1 美元。
 * 拒绝且有话说的在 refusalOf 里已经认出；没话说的照 magpie 说没收下令牌。
 */
function readAiHubMixAccount(body: unknown): BalanceRead {
  if (!isRecord(body)) return NO_VALUE;
  if (body.success !== true) {
    return { kind: "rejected", detail: "AiHubMix didn't take the access token" };
  }
  const quota = isRecord(body.data) ? numberOf(body.data.quota) : null;
  return quota === null ? NO_VALUE : itemsOf(moneyItem("USD", quota / 500000));
}

/**
 * 接口在 OpenCode Zen 上（照 magpie openCodeZen / openCodeGateway）：opencode.ai 下 /zen、/inference 开头；
 * 有一个地址是 Go（/zen/go、/inference/go）就不算，用户自己挂在 /inference/custom 下的也不算。
 */
function openCodeZen(baseUrls: StoredApiEndpoint["baseUrls"]): boolean {
  let zen = false;
  for (const format of FORMAT_ORDER) {
    const url = baseUrls.find((entry) => entry.format === format)?.url;
    if (url === undefined) continue;
    const gateway = openCodeGateway(url);
    if (gateway === "go") return false;
    if (gateway === "zen") zen = true;
  }
  return zen;
}

function openCodeGateway(base: string): "go" | "zen" | null {
  let parsed: URL;
  try {
    parsed = new URL(base.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (host !== "opencode.ai" && !host.endsWith(".opencode.ai")) return null;
  const segments = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (segments[0] !== "zen" && segments[0] !== "inference") return null;
  if (segments[1] === "go") return "go";
  if (segments[1] === "custom") return null;
  return "zen";
}
