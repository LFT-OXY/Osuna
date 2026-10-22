// 套餐窗口移植自 magpie（https://github.com/yetone/magpie，internal/provider/planquota.go 的 planQuotaSourceOf、
// readZhipuPlan、readKimiCode、kimiCodeBase、readMiniMaxPlan、miniMaxCount、readOpenCodeGo、planBody、zhipuRefused，
// zhipu_envelope.go 的 zhipuEnvelope、ZhipuKeyRefused，opencode_client.go 的 OpenCodeSession、openCodeNewID，7597c132；
// OpenCode Go 也认 /inference/go 照最新版 ea6be159）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { randomBytes } from "node:crypto";
import type {
  ApiEndpointBalanceReading,
  ApiEndpointBalanceWindow,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { numberOf } from "./balance-field.js";
import type { StoredApiEndpoint } from "./store.js";
import { isRecord } from "./upstream-http.js";
import { hostOf } from "./vendor-status.js";
import { paceBetween, windowStart, type WindowSpan } from "./window-pace.js";

/*
 * 套餐 key 的窗口：GLM Coding Plan、Kimi Code、MiniMax、OpenCode Go 这些按 5 小时 / 周 / 月限量的套餐，厂商把窗口告诉 key。
 * 按接口各格式地址的主机名与路径认（照 magpie 的先后：Chat、Anthropic、Responses），不看模板，也不看余额查询地址。
 * 只显示，不进中转站选路。请求只带认证、Accept、Accept-Language 与 Osuna 的 User-Agent，不带这家自己的请求头。
 */

/** 各家的套餐窗口查询；测试 daemon 把它们换成本机地址。Kimi Code 的查询跟着接口的路径走，这里只是站点。 */
export const PLAN_VENDOR_URLS = {
  glm_cn: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
  glm_z: "https://api.z.ai/api/monitor/usage/quota/limit",
  kimi_code_com: "https://api.kimi.com",
  kimi_code_ai: "https://api.kimi.ai",
  minimax_cn: "https://api.minimaxi.com/v1/token_plan/remains",
  minimax_io: "https://api.minimax.io/v1/token_plan/remains",
  opencode_go: "https://opencode.ai/zen/go/v1/usage",
} as const;

export type PlanVendorId = keyof typeof PLAN_VENDOR_URLS;

/** 读出的一个窗口，还没算配速。 */
interface PlanWindow {
  id: string;
  label: string;
  usedPct: number;
  resetsAt: string | null;
  span: WindowSpan | null;
  aside?: boolean;
  used?: number;
  limit?: number;
  unit?: string;
}

/** 读一份回复的结果：窗口（空的是这把 key 没有套餐）、key 被拒（GLM 的 1000–1005）、取不到值。 */
export type PlanRead =
  | { kind: "windows"; windows: PlanWindow[] }
  | { kind: "key_refused"; detail: string }
  | { kind: "no_value"; detail: string };

export interface PlanSource {
  vendor: PlanVendorId;
  url: string;
  // 智谱把裸 key 当 Authorization，别家加「Bearer 」。
  bearer: boolean;
  // 认得出是套餐，不只是这家厂商：按量付费的 key 没有窗口，读不出时不显示（照 magpie planQuotaSource.sure）。
  sure: boolean;
  read: (body: unknown) => PlanRead;
  // 智谱不认 key 时去哪换一把。
  keysAt: string | null;
  opencode: boolean;
}

const PLAN_FORMAT_ORDER = ["openai_chat", "anthropic_messages", "openai_responses"] as const;

const ZHIPU_HOSTS: Record<string, "glm_cn" | "glm_z"> = {
  "open.bigmodel.cn": "glm_cn",
  "api.z.ai": "glm_z",
};
const KIMI_HOSTS: Record<string, "kimi_code_com" | "kimi_code_ai"> = {
  "api.kimi.com": "kimi_code_com",
  "api.kimi.ai": "kimi_code_ai",
};
const MINIMAX_HOSTS: Record<string, "minimax_cn" | "minimax_io"> = {
  "api.minimaxi.com": "minimax_cn",
  "api.minimax.io": "minimax_io",
};

const ZHIPU_KEYS = {
  glm_cn: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
  glm_z: "https://z.ai/manage-apikey/apikey-list",
} as const;

/** 这家接口的套餐窗口在哪查；不是认得的套餐为 null。 */
export function planSourceOf(input: {
  baseUrls: StoredApiEndpoint["baseUrls"];
  vendorUrls?: Partial<Record<string, string>>;
}): PlanSource | null {
  const urlOf = (vendor: PlanVendorId) => input.vendorUrls?.[vendor] ?? PLAN_VENDOR_URLS[vendor];
  for (const format of PLAN_FORMAT_ORDER) {
    const base = input.baseUrls.find((entry) => entry.format === format)?.url.trim();
    if (base === undefined) continue;
    const host = hostOf(base);
    const zhipu = ZHIPU_HOSTS[host] ?? null;
    if (zhipu !== null) {
      return {
        vendor: zhipu,
        url: urlOf(zhipu),
        bearer: false,
        sure: base.includes("/api/coding/"),
        read: readZhipuPlan,
        keysAt: ZHIPU_KEYS[zhipu],
        opencode: false,
      };
    }
    const kimi = KIMI_HOSTS[host] ?? null;
    if (kimi !== null && base.includes("/coding")) {
      return {
        vendor: kimi,
        url: `${urlOf(kimi).replace(/\/+$/, "")}${pathOf(kimiCodeBase(base))}/usages`,
        bearer: true,
        sure: true,
        read: readKimiCode,
        keysAt: null,
        opencode: false,
      };
    }
    const minimax = MINIMAX_HOSTS[host] ?? null;
    if (minimax !== null) {
      // 套餐 key（sk-cp-…）才有窗口；按量付费的 key 读不出，不显示（magpie #387）。
      return {
        vendor: minimax,
        url: urlOf(minimax),
        bearer: true,
        sure: false,
        read: readMiniMaxPlan,
        keysAt: null,
        opencode: false,
      };
    }
    if (host === "opencode.ai" && isOpenCodeGo(base)) {
      return {
        vendor: "opencode_go",
        url: urlOf("opencode_go"),
        bearer: true,
        sure: true,
        read: readOpenCodeGo,
        keysAt: null,
        opencode: true,
      };
    }
  }
  return null;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** Kimi Code 的 OpenAI 地址 /coding/v1：Anthropic 地址 /coding 补上 /v1。 */
function kimiCodeBase(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  return trimmed.endsWith("/coding") ? `${trimmed}/v1` : trimmed;
}

/** OpenCode Go：路径是 /zen/go 或 /inference/go，或在它们下面。 */
function isOpenCodeGo(base: string): boolean {
  const trimmed = base.replace(/\/+$/, "");
  return ["/zen/go", "/inference/go"].some(
    (gateway) => trimmed.endsWith(gateway) || trimmed.includes(`${gateway}/`),
  );
}

/** 问套餐窗口的请求头：认证、Accept、Accept-Language、User-Agent；OpenCode 的网关还要一个会话。 */
export function planRequestHeaders(input: {
  source: PlanSource;
  apiKey: string;
  userAgent: string;
  now: number;
}): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: input.source.bearer ? `Bearer ${input.apiKey}` : input.apiKey,
    accept: "application/json",
    "accept-language": "en-US,en",
    "user-agent": input.userAgent,
  };
  if (input.source.opencode) {
    // 2026-09 起 OpenCode 的网关不路由没说会话的请求（400）；不是对话的请求也给一个自己的会话。
    const session = openCodeSessionId(input.now);
    headers["x-opencode-session"] = session;
    headers["x-opencode-session-id"] = session;
  }
  return headers;
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const openCodeIds = { last: 0, counter: 0 };

/** OpenCode 样子的会话 id：ses_ 加 12 位倒序的时间计数（十六进制）加 14 个随机字符。 */
function openCodeSessionId(now: number): string {
  if (now !== openCodeIds.last) {
    openCodeIds.last = now;
    openCodeIds.counter = 0;
  }
  openCodeIds.counter += 1;
  const current = BigInt(now) * 0x1000n + BigInt(openCodeIds.counter);
  const descending = ~current & 0xffffffffffffn;
  const random = [...randomBytes(14)].map((byte) => BASE62[byte % BASE62.length]).join("");
  return `ses_${descending.toString(16).padStart(12, "0")}${random}`;
}

/** 智谱不认 key：不论状态码，回复是 success:false 且 code 在 1000–1005（过期、删了、粘错）。 */
export function zhipuKeyRefusal(body: unknown): string | null {
  if (!isRecord(body) || body.success !== false) return null;
  const code = numberOf(body.code);
  if (code === null || code < 1000 || code > 1005) return null;
  return typeof body.msg === "string" ? body.msg.trim() : "";
}

/** 窗口按长度命名（照 magpie）：超过一天且整天的写天，整小时的写小时，别的写分钟；不知道长度的叫 Allowance。 */
function spanName(span: number | null): { id: string; label: string } {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  if (span === null || span <= 0) return { id: "allowance", label: "Allowance" };
  if (span > DAY && span % DAY === 0) return { id: `${span / DAY}d`, label: `${span / DAY} days` };
  if (span >= HOUR && span % HOUR === 0) {
    return { id: `${span / HOUR}h`, label: `${span / HOUR} hours` };
  }
  const minutes = Math.floor(span / 60_000);
  return { id: `${minutes}min`, label: `${minutes} minutes` };
}

function isoOfMs(ms: number): string {
  return new Date(ms).toISOString();
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * GLM Coding Plan：{"success":true,"data":{"level":"pro","limits":[{"type":"TOKENS_LIMIT","unit":3,"number":5,
 * "percentage":12,"nextResetTime":1758800000000},…]}}。unit 3 是 N 小时（团队的没有 number，按 5），unit 6 是 7 天；
 * TIME_LIMIT 是当月的 MCP 工具调用，用完不挡模型，放一旁。
 */
function readZhipuPlan(body: unknown): PlanRead {
  const refused = zhipuKeyRefusal(body);
  if (refused !== null) return { kind: "key_refused", detail: refused };
  if (!isRecord(body)) return { kind: "no_value", detail: "no plan in the reply" };
  const msg = typeof body.msg === "string" ? body.msg.trim() : "";
  if (body.success === false || !isRecord(body.data)) {
    return { kind: "no_value", detail: msg || "no plan in the reply" };
  }
  const limits = Array.isArray(body.data.limits) ? body.data.limits.filter(isRecord) : [];
  const windows: PlanWindow[] = [];
  for (const limit of limits) {
    const reset = numberOf(limit.nextResetTime) ?? 0;
    const base = {
      usedPct: numberOf(limit.percentage) ?? 0,
      resetsAt: reset > 0 ? isoOfMs(reset) : null,
    };
    const unit = numberOf(limit.unit);
    const type = typeof limit.type === "string" ? limit.type : "";
    if (type.toUpperCase() === "TIME_LIMIT") {
      windows.push({ ...base, id: "mcp_month", label: "MCP · Month", span: "month", aside: true });
    } else if (unit === 3) {
      const number = numberOf(limit.number) ?? 0;
      const hours = number <= 0 ? 5 : number;
      windows.push({ ...base, id: `${hours}h`, label: `${hours} hours`, span: hours * 3_600_000 });
    } else if (unit === 6) {
      windows.push({ ...base, id: "7d", label: "7 days", span: 7 * 24 * 3_600_000 });
    } else {
      windows.push({ ...base, id: "allowance", label: "Allowance", span: null });
    }
  }
  return { kind: "windows", windows };
}

/**
 * Kimi Code 的 /usages（照 kimi-cli 的 /usage）：{"usage":{"limit":"100","used":"12","resetTime":"…"},
 * "limits":[{"window":{"duration":300,"timeUnit":"TIME_UNIT_MINUTE"},"detail":{"limit":"100","remaining":"88",…}}]}。
 * usage 是这周的，limits 每项是更短的窗口；数可能是字符串，给的是已用或剩余。
 */
function readKimiCode(body: unknown): PlanRead {
  if (!isRecord(body)) return { kind: "no_value", detail: "no usage in the reply" };
  const windows: PlanWindow[] = [];
  const limits = Array.isArray(body.limits) ? body.limits.filter(isRecord) : [];
  for (const entry of limits) {
    const window = isRecord(entry.window) ? entry.window : {};
    const detail = isRecord(entry.detail) ? entry.detail : window;
    const duration = numberOf(window.duration) ?? 0;
    const unit = typeof window.timeUnit === "string" ? window.timeUnit : "";
    let span: number | null = null;
    if (unit.includes("MINUTE")) span = duration * 60_000;
    else if (unit.includes("HOUR")) span = duration * 3_600_000;
    else if (unit.includes("DAY")) span = duration * 24 * 3_600_000;
    const read = kimiWindow({ detail, ...spanName(span), span });
    if (read !== null) windows.push(read);
  }
  if (isRecord(body.usage)) {
    const week = kimiWindow({
      detail: body.usage,
      id: "7d",
      label: "7 days",
      span: 7 * 24 * 3_600_000,
    });
    if (week !== null) windows.push(week);
  }
  if (windows.length === 0) return { kind: "no_value", detail: "no usage in the reply" };
  return { kind: "windows", windows };
}

function kimiWindow(input: {
  detail: Record<string, unknown>;
  id: string;
  label: string;
  span: number | null;
}): PlanWindow | null {
  const { detail } = input;
  const limit = numberOf(detail.limit);
  if (limit === null || limit <= 0) return null;
  let used = numberOf(detail.used);
  if (used === null) {
    const left = numberOf(detail.remaining);
    if (left === null) return null;
    used = limit - left;
  }
  let resetsAt: string | null = null;
  for (const key of ["resetTime", "resetAt", "reset_at", "reset_time"]) {
    const value = detail[key];
    if (typeof value !== "string" || value === "") continue;
    const at = Date.parse(value);
    if (!Number.isNaN(at)) {
      resetsAt = isoOfMs(at);
      break;
    }
  }
  return {
    id: input.id,
    label: input.label,
    usedPct: clampPct((used / limit) * 100),
    resetsAt,
    span: input.span,
  };
}

/**
 * MiniMax 的 /v1/token_plan/remains（magpie #387）：model_remains 每个桶有区间与周两个窗口，给的是剩余百分比。
 * general 是模型用的；别的桶（video、image…）单独计，用完不挡模型，加桶名放一旁。套餐里没有的桶两个窗口都是不限（status 3）
 * 且没有总数，不显示；不限的窗口不显示；status 2 是用完，不管百分比。拒绝 key 也回 200，原因在 base_resp。
 */
function readMiniMaxPlan(body: unknown): PlanRead {
  if (!isRecord(body) || !isRecord(body.base_resp)) {
    return { kind: "no_value", detail: "no plan in the reply" };
  }
  const code = numberOf(body.base_resp.status_code) ?? 0;
  if (code !== 0) {
    const msg = typeof body.base_resp.status_msg === "string" ? body.base_resp.status_msg : "";
    return { kind: "no_value", detail: msg || `MiniMax said ${code}` };
  }
  const buckets = Array.isArray(body.model_remains) ? body.model_remains.filter(isRecord) : [];
  const windows: PlanWindow[] = [];
  for (const bucket of buckets) {
    const name = typeof bucket.model_name === "string" ? bucket.model_name.trim() : "";
    if (name === "" || miniMaxNotInPlan(bucket)) continue;
    for (const part of miniMaxParts(bucket)) {
      const window = miniMaxWindow({ part, name });
      if (window !== null) windows.push(window);
    }
  }
  return { kind: "windows", windows };
}

function miniMaxNotInPlan(bucket: Record<string, unknown>): boolean {
  const isZero = (value: unknown) => numberOf(value) === 0;
  return (
    numberOf(bucket.current_interval_status) === 3 &&
    numberOf(bucket.current_weekly_status) === 3 &&
    isZero(bucket.current_interval_total_count) &&
    isZero(bucket.current_weekly_total_count)
  );
}

interface MiniMaxPart {
  left: number | null;
  status: number;
  start: number;
  end: number;
  week: boolean;
  count: number | null;
  total: number | null;
}

/** 一个桶的区间与周两个窗口。 */
function miniMaxParts(bucket: Record<string, unknown>): MiniMaxPart[] {
  return [
    {
      left: numberOf(bucket.current_interval_remaining_percent),
      status: numberOf(bucket.current_interval_status) ?? 0,
      start: numberOf(bucket.start_time) ?? 0,
      end: numberOf(bucket.end_time) ?? 0,
      week: false,
      count: numberOf(bucket.current_interval_usage_count),
      total: numberOf(bucket.current_interval_total_count),
    },
    {
      left: numberOf(bucket.current_weekly_remaining_percent),
      status: numberOf(bucket.current_weekly_status) ?? 0,
      start: numberOf(bucket.weekly_start_time) ?? 0,
      end: numberOf(bucket.weekly_end_time) ?? 0,
      week: true,
      count: numberOf(bucket.current_weekly_usage_count),
      total: numberOf(bucket.current_weekly_total_count),
    },
  ];
}

/** MiniMax 的时间有秒也有毫秒。 */
function miniMaxMs(value: number): number {
  return value < 1e12 ? value * 1000 : value;
}

/** 一个窗口：不限的、什么都没说的为 null；别的桶加桶名放一旁，视频按个数计。 */
function miniMaxWindow(input: { part: MiniMaxPart; name: string }): PlanWindow | null {
  const { part, name } = input;
  const isUsedUp = part.status === 2;
  const tellsNothing = part.status === 3 || (part.left === null && !isUsedUp);
  if (tellsNothing) return null;
  let span: number | null = null;
  if (part.start > 0 && part.end > part.start) span = miniMaxMs(part.end) - miniMaxMs(part.start);
  else if (part.week) span = 7 * 24 * 3_600_000;
  const named = part.week ? { id: "7d", label: "7 days" } : spanName(span);
  const usedPct = isUsedUp ? 100 : clampPct(100 - (part.left ?? 0));
  const window: PlanWindow = {
    ...named,
    usedPct,
    resetsAt: part.end > 0 ? isoOfMs(miniMaxMs(part.end)) : null,
    span,
  };
  const counted = miniMaxCount(part);
  if (counted !== null) {
    window.used = isUsedUp ? counted.total : counted.used;
    window.limit = counted.total;
    if (name.toLowerCase() === "video") window.unit = "videos";
  }
  if (name.toLowerCase() !== "general") {
    window.id = `${name.toLowerCase()}:${window.id}`;
    window.label = `${name.charAt(0).toUpperCase()}${name.slice(1)} · ${window.label}`;
    window.aside = true;
  }
  return window;
}

/**
 * MiniMax 窗口的数（照 mmx-cli 的读法）：usage_count 有时是已用、有时是剩余，看剩余百分比和哪种对得上（差 1 点以内），
 * 都对不上就不写数。总数是 0（general 按 token 计）或数超出总数的也不写。
 */
function miniMaxCount(input: {
  count: number | null;
  total: number | null;
  left: number | null;
}): { used: number; total: number } | null {
  const { count, total, left } = input;
  if (count === null || total === null || left === null) return null;
  if (total <= 0 || count < 0 || count > total) return null;
  const asUsed = Math.abs(((total - count) / total) * 100 - left);
  const asLeft = Math.abs((count / total) * 100 - left);
  if (Math.min(asUsed, asLeft) > 1) return null;
  return asUsed < asLeft ? { used: count, total } : { used: total - count, total };
}

/**
 * OpenCode Go：{"usage":{"rolling":{"percent":37,"resetsAt":"…"},"weekly":{…},"monthly":{…}}}。
 * 0% 的窗口给的 resetsAt 是现在加窗口长度，那时什么都不会发生，丢掉。
 */
function readOpenCodeGo(body: unknown): PlanRead {
  const usage = isRecord(body) && isRecord(body.usage) ? body.usage : {};
  const windows: PlanWindow[] = [];
  const known = [
    { key: "rolling", id: "5h", label: "5 hours", span: 5 * 3_600_000 },
    { key: "weekly", id: "7d", label: "7 days", span: 7 * 24 * 3_600_000 },
    { key: "monthly", id: "month", label: "Month", span: "month" as const },
  ];
  for (const entry of known) {
    const window = usage[entry.key];
    const percent = isRecord(window) ? numberOf(window.percent) : null;
    if (!isRecord(window) || percent === null) continue;
    const reset = typeof window.resetsAt === "string" ? Date.parse(window.resetsAt) : Number.NaN;
    const hasReset = !Number.isNaN(reset) && percent > 0;
    const resetsAt = hasReset ? isoOfMs(reset) : null;
    windows.push({
      id: entry.id,
      label: entry.label,
      usedPct: percent,
      resetsAt,
      span: entry.span,
    });
  }
  if (windows.length === 0) {
    return {
      kind: "no_value",
      detail: "OpenCode Go's reply has no rolling, weekly or monthly window",
    };
  }
  return { kind: "windows", windows };
}

/** 窗口照协议的形状写出，带上读数时的配速；同名的代号加序号，界面拿它作 key。 */
export function shownWindows(input: {
  windows: readonly PlanWindow[];
  now: number;
}): ApiEndpointBalanceWindow[] {
  const seen = new Map<string, number>();
  return input.windows.map((window) => {
    const times = (seen.get(window.id) ?? 0) + 1;
    seen.set(window.id, times);
    const id = times === 1 ? window.id : `${window.id}#${times}`;
    return withPace({
      window: {
        id,
        label: window.label,
        usedPct: window.usedPct,
        remainingPct: 100 - clampPct(window.usedPct),
        resetsAt: window.resetsAt,
        ...(window.used === undefined ? {} : { used: window.used }),
        ...(window.limit === undefined ? {} : { limit: window.limit }),
        ...(window.unit === undefined ? {} : { unit: window.unit }),
        ...(window.aside ? { aside: true } : {}),
      },
      span: window.span,
      now: input.now,
    });
  });
}

/** 窗口带上开始时间与读数时的配速；不知道开始时间时都不带，现在不在窗口里时不带配速。 */
export function withPace(input: {
  window: ApiEndpointBalanceWindow;
  span: WindowSpan | null;
  now: number;
}): ApiEndpointBalanceWindow {
  const { window } = input;
  const start = windowStart({ resetsAt: window.resetsAt ?? null, span: input.span });
  if (start === null) return window;
  const pacePct = paceBetween({
    usedPct: window.usedPct ?? 0,
    start,
    end: Date.parse(window.resetsAt ?? ""),
    now: input.now,
  });
  const startsAt = new Date(start).toISOString();
  return pacePct === null ? { ...window, startsAt } : { ...window, startsAt, pacePct };
}

/** 读数里每个知道起止的窗口按 now 重算配速（照 magpie 每次显示时算）：留着的、上次的读数不带着当时的配速。 */
export function withPaceAt(input: {
  reading: ApiEndpointBalanceReading;
  now: number;
}): ApiEndpointBalanceReading {
  const { reading, now } = input;
  if (reading.windows === undefined) return reading;
  const windows = reading.windows.map((window) => {
    const { pacePct: _was, ...rest } = window;
    if (!window.startsAt || !window.resetsAt) return window;
    const pacePct = paceBetween({
      usedPct: window.usedPct ?? 0,
      start: Date.parse(window.startsAt),
      end: Date.parse(window.resetsAt),
      now,
    });
    return pacePct === null ? rest : { ...rest, pacePct };
  });
  return { ...reading, windows };
}
