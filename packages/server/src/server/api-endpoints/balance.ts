// 按地址认出的厂商余额、失败的说法照 magpie（https://github.com/yetone/magpie，internal/provider/balance.go 的
// balanceSourceOf、balanceRead、balanceRefusal、money、currencySign、number、readDeepSeek，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type {
  ApiEndpointBalanceFailure,
  ApiEndpointBalanceFailureReason,
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

export type BalanceVendorId = "deepseek";

interface BalanceVendor {
  id: BalanceVendorId;
  hosts: readonly string[];
  url: string;
  read: (body: unknown) => ApiEndpointBalanceItem[] | null;
}

const BALANCE_VENDORS: readonly BalanceVendor[] = [
  {
    id: "deepseek",
    hosts: ["api.deepseek.com"],
    url: "https://api.deepseek.com/user/balance",
    read: readDeepSeek,
  },
];

// 照 magpie balanceSourceOf 的先后。
const FORMAT_ORDER = ["openai_chat", "openai_responses", "anthropic_messages"] as const;

export const BALANCE_READ_TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 1 << 20;
const MAX_DETAIL_CHARS = 200;

/** 这家接口的地址对上的余额厂商；中转站与认不出的为 null。 */
export function balanceVendorOf(baseUrls: StoredApiEndpoint["baseUrls"]): BalanceVendorId | null {
  for (const format of FORMAT_ORDER) {
    const url = baseUrls.find((entry) => entry.format === format)?.url;
    if (url === undefined) continue;
    const host = hostOf(url);
    const vendor = BALANCE_VENDORS.find((candidate) => candidate.hosts.includes(host));
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
  signal: AbortSignal;
}

/** 读一家的余额：认不出或没有 key 时什么都不发（magpie 同样不查没 key 的）。 */
export async function readEndpointBalance(
  input: ReadBalanceInput,
): Promise<ApiEndpointBalanceReading> {
  const endpointId = input.endpoint.id;
  const vendorId = balanceVendorOf(input.endpoint.baseUrls);
  const vendor = BALANCE_VENDORS.find((candidate) => candidate.id === vendorId);
  if (!vendor || !input.apiKey) {
    return { endpointId, status: "unsupported", items: [], readAt: null, failure: null };
  }
  const readAt = input.now().toISOString();
  const failed = (failure: ApiEndpointBalanceFailure): ApiEndpointBalanceReading => ({
    endpointId,
    status: "failed",
    items: [],
    readAt,
    failure,
  });
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
      url: input.vendorUrls?.[vendor.id] ?? vendor.url,
      init: {
        headers,
        signal: AbortSignal.any([input.signal, AbortSignal.timeout(BALANCE_READ_TIMEOUT_MS)]),
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
    return failed({ reason: failureOfStatus(status), detail: quoted(text, secrets), status });
  }
  if (body === undefined) return failed({ reason: "wrong_url", detail: null, status });
  const items = vendor.read(body);
  if (items === null || items.length === 0) {
    return failed({ reason: "no_value", detail: null, status });
  }
  return { endpointId, status: "ok", items, readAt, failure: null };
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

/**
 * DeepSeek：{"is_available":true,"balance_infos":[{"currency":"CNY","total_balance":"110.00",…}]}。
 * 先只取第一个读得出数的币种（多币种的排序与赠送 / 充值拆分另做）。
 */
function readDeepSeek(body: unknown): ApiEndpointBalanceItem[] | null {
  if (!isRecord(body) || !Array.isArray(body.balance_infos)) return null;
  for (const info of body.balance_infos) {
    if (!isRecord(info)) continue;
    const value = numberOf(info.total_balance);
    if (value === null) continue;
    return [moneyItem(typeof info.currency === "string" ? info.currency : "", value)];
  }
  return null;
}
