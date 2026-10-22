// 按地址认出的厂商余额、失败的说法照 magpie（https://github.com/yetone/magpie，internal/provider/balance.go 的
// balanceSourceOf、balanceRead、balanceRefusal、money、currencySign、number 与各厂商的 read*，7597c132；
// DeepSeek 的赠送 / 充值拆分与 OpenCode Zen 的说明照最新版 ea6be159 的 readDeepSeekSplit、errOpenCodeNoBalance、openCodeZen）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type {
  ApiEndpointBalanceFailure,
  ApiEndpointBalanceFailureReason,
  ApiEndpointBalanceHint,
  ApiEndpointBalanceItem,
  ApiEndpointBalanceReading,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  secretsOf,
  unsendableHeader,
  unsendableHeaderMessage,
  withUserHeaders,
  type RequestExtras,
} from "./request-extras.js";
import { upstreamFetch } from "./insecure-tls.js";
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
 * 厂商按接口各格式地址的主机名精确认（顺序同 magpie：Chat、Responses、Anthropic），不看模板。
 * 请求带 key 的 Bearer 头、Accept、Osuna 的 User-Agent，再写上这家自己的请求头（用户的可以盖过 User-Agent，ADR 0008）。
 * 回复里的 key 与请求头的值打码后截到 200 字给界面看。
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
} as const;

export type BalanceVendorId = keyof typeof BALANCE_VENDOR_URLS;

/** 回复说明这家不给查（或要别的凭据），不是没取到值。 */
interface BalanceNotOffered {
  kind: "not_offered";
  hint: ApiEndpointBalanceHint;
  seeAt: string | null;
}

/** 读一份回复的结果：余额各项（空的是这家现在没有余额可显示）、这家不给查、取不到值（detail 是 magpie 给的说明）。 */
type BalanceRead =
  | { kind: "items"; items: ApiEndpointBalanceItem[] }
  | BalanceNotOffered
  | { kind: "no_value"; detail: string | null };

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
  // 不填令牌时问 key 自己还剩多少；填账户令牌查账户余额另做（工单 06）。
  { id: "aihubmix", host: "aihubmix.com", read: readAiHubMix },
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
const MAX_BODY_CHARS = 1 << 20;
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
  endpoint: Pick<StoredApiEndpoint, "id" | "baseUrls">;
  apiKey: string | null;
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
  const vendorId = balanceVendorOf(input.endpoint.baseUrls);
  const vendor = BALANCE_VENDORS.find((candidate) => candidate.id === vendorId);
  const readAt = input.now().toISOString();
  const failed = (failure: ApiEndpointBalanceFailure): ApiEndpointBalanceReading => ({
    endpointId,
    status: "failed",
    items: [],
    readAt,
    failure,
  });
  const notOffered = (note: BalanceNotOffered, status: number | null) =>
    failed({ reason: "not_offered", detail: null, status, hint: note.hint, seeAt: note.seeAt });
  if (!vendor && input.apiKey && openCodeZen(input.endpoint.baseUrls)) {
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
  if (!vendor || !input.apiKey) {
    return { endpointId, status: "unsupported", items: [], readAt: null, failure: null };
  }
  const secrets = secretsOf({ apiKey: input.apiKey, extras: input.extras });
  const problem = unsendableHeader(input.extras);
  if (problem !== null) {
    // 这家自己的请求头发不出去：照 magpie 当作没查成（它原样报错，界面归为暂时查不到），原因写明是哪个头。
    return failed({
      reason: "temporary",
      detail: unsendableHeaderMessage(problem),
      status: null,
    });
  }
  const headers = withUserHeaders(
    {
      authorization: `Bearer ${input.apiKey}`,
      accept: "application/json",
      "user-agent": input.userAgent,
    },
    input.extras,
  );
  let status: number;
  let text: string;
  try {
    const response = await upstreamFetch({
      url: input.vendorUrls?.[vendor.id] ?? BALANCE_VENDOR_URLS[vendor.id],
      init: {
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
    text = (await response.text()).slice(0, MAX_BODY_CHARS);
  } catch (error) {
    if (input.signal.aborted) throw error;
    return failed({
      reason: "temporary",
      detail: clip(redactKey(describeNetworkError(error), secrets)),
      status: null,
    });
  }
  const body = parseJson(text);
  const refusal = refusalOf(body);
  if (refusal !== null) {
    // new-api 一类的 {"success":false,"message":…}：不论状态码都是拒绝。
    return failed({ reason: "token_rejected", detail: clip(redactKey(refusal, secrets)), status });
  }
  if (status >= 300) {
    const known = vendor.failed?.(status, body) ?? null;
    if (known !== null) return notOffered(known, status);
    return failed({ reason: failureOfStatus(status), detail: quoted(text, secrets), status });
  }
  if (body === undefined) return failed({ reason: "wrong_url", detail: null, status });
  const read = vendor.read(body);
  if (read.kind === "not_offered") return notOffered(read, status);
  if (read.kind === "no_value") {
    return failed({ reason: "no_value", detail: read.detail && clip(read.detail), status });
  }
  return { endpointId, status: "ok", items: read.items, readAt, failure: null };
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

/** JSON 数或写成数的字符串。 */
function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
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
