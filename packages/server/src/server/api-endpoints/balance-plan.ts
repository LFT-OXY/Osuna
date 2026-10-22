// 套餐窗口移植自 magpie（https://github.com/yetone/magpie，internal/provider/planquota.go 的 planQuotaSourceOf、
// readZhipuPlan、readKimiCode、kimiCodeBase、readMiniMaxPlan、miniMaxCount、readOpenCodeGo、planBody、zhipuRefused，
// zhipu_envelope.go 的 zhipuEnvelope、ZhipuKeyRefused，opencode_client.go 的 OpenCodeSession、openCodeNewID，
// commandcode_plan.go 的 cmdWindows、cmdLeft、cmdPlans、cmdQuotaOf、cmdKeyWindows、cmdSubscription、cmdTime，
// ollama_usage.go 的 readOllamaPlan，planquota.go 的 planKeyWindows、zhipuKeyTeamWindows、zhipuTeamRoots，
// zcode_team.go 的 zcodeBizRoot、zcodeTeamHeaders、zhipuResets、zcodeWhen，zcode.go 的 zhipuTime，7597c132；
// OpenCode Go 也认 /inference/go 照最新版 ea6be159）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { randomBytes } from "node:crypto";
import type {
  ApiEndpointBalanceReading,
  ApiEndpointBalanceReset,
  ApiEndpointBalanceResets,
  ApiEndpointBalanceWindow,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { numberOf } from "./balance-field.js";
import type { StoredApiEndpoint } from "./store.js";
import { isRecord } from "./upstream-http.js";
import { hostOf } from "./vendor-status.js";
import { paceBetween, windowStart, type WindowSpan } from "./window-pace.js";

/*
 * 套餐 key 的窗口：GLM Coding Plan、Kimi Code、MiniMax、OpenCode Go、Command Code、Ollama Cloud 这些按 5 小时 / 周 / 月
 * 限量的套餐，厂商把窗口告诉 key。
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
  // 智谱团队套餐：open.bigmodel.cn 问不出时再问 bigmodel.cn（ZCode 问的站点）；Z.ai 只有 api.z.ai。
  glm_cn_biz: "https://bigmodel.cn/api/monitor/usage/quota/limit",
  // 余额也问这两个地址（balance.ts）。
  commandcode: "https://api.commandcode.ai/alpha/billing/credits",
  ollama: "https://ollama.com/api/balance",
  // credits 回复没写套餐时问这把 key 的订阅，拿套餐每月给多少 credits。
  commandcode_subscriptions: "https://api.commandcode.ai/alpha/billing/subscriptions",
  // 火山方舟与腾讯云 Token Plan 企业版的开放平台：用云账号密钥签名问套餐窗口（balance-access-key.ts）。
  volcengine_open: "https://open.volcengineapi.com/",
  tencent_open: "https://tokenhub.tencentcloudapi.com/",
} as const;

export type PlanVendorId = keyof typeof PLAN_VENDOR_URLS;

/** 读出的一个窗口，还没算配速。 */
export interface PlanWindow {
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
  // 智谱团队套餐在哪几处问（照 magpie zhipuTeamRoots，先这把 key 自己的站点）与 Set-Language；不是智谱为 null。
  team: { urls: string[]; language: "zh" | "en" } | null;
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
      const bigModel = zhipu === "glm_cn";
      return {
        vendor: zhipu,
        url: urlOf(zhipu),
        bearer: false,
        sure: base.includes("/api/coding/"),
        read: readZhipuPlan,
        keysAt: ZHIPU_KEYS[zhipu],
        opencode: false,
        team: {
          urls: bigModel ? [urlOf(zhipu), urlOf("glm_cn_biz")] : [urlOf(zhipu)],
          language: bigModel ? "zh" : "en",
        },
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
        team: null,
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
        team: null,
      };
    }
    if (host === "api.commandcode.ai") {
      // 套餐的 key（Studio 里建的或登录拿的）在这里有 5 小时与周窗口；按量付费的 key 没有，不显示。
      return {
        vendor: "commandcode",
        url: urlOf("commandcode"),
        bearer: true,
        sure: false,
        read: readCommandCodePlan,
        keysAt: null,
        opencode: false,
        team: null,
      };
    }
    if (host === "ollama.com") {
      // Ollama Cloud 套餐含的额度（magpie #1888）；没有的 key 不显示。
      return {
        vendor: "ollama",
        url: urlOf("ollama"),
        bearer: true,
        sure: false,
        read: readOllamaPlan,
        keysAt: null,
        opencode: false,
        team: null,
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
        team: null,
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

/** 重置时间：秒或毫秒，或 RFC 3339（照 magpie cmdTime）。 */
function commandCodeTime(value: unknown): string | null {
  if (typeof value === "string") {
    const at = Date.parse(value);
    if (!Number.isNaN(at) && /\d{4}-\d{2}-\d{2}T/.test(value)) return isoOfMs(at);
  }
  const n = numberOf(value);
  if (n === null || n <= 0) return null;
  return isoOfMs(n < 1e12 ? n * 1000 : n);
}

/**
 * Command Code 的 /alpha/billing/credits（同 CLI 的 /usage）：{"credits":{"planId":…,"monthlyCredits":41.2,
 * "purchasedCredits":5,"freeCredits":0},"windowLimits":{"fiveHour":{"used":3.1,"cap":10,"resetAt":…},"weekly":{…}}}。
 * 这里只读给了上限的 5 小时与周窗口；没有窗口的是按量付费的 key。credits 那个窗口要知道套餐（commandCodeCredits）。
 */
function readCommandCodePlan(body: unknown): PlanRead {
  const limits = isRecord(body) && isRecord(body.windowLimits) ? body.windowLimits : {};
  const windows: PlanWindow[] = [];
  const known = [
    { key: "fiveHour", id: "5h", label: "5 hours", span: 5 * 3_600_000 },
    { key: "weekly", id: "7d", label: "7 days", span: 7 * 24 * 3_600_000 },
  ];
  for (const entry of known) {
    const window = limits[entry.key];
    if (!isRecord(window)) continue;
    const used = numberOf(window.used);
    const cap = numberOf(window.cap);
    if (used === null || cap === null || cap <= 0) continue;
    windows.push({
      id: entry.id,
      label: entry.label,
      usedPct: Math.min(100, (100 * Math.max(0, used)) / cap),
      resetsAt: commandCodeTime(window.resetAt),
      span: entry.span,
    });
  }
  return { kind: "windows", windows };
}

/** 套餐 id 的开头（最长的在前）与每月给多少美元的 credits，照 CLI 的 getPlanInfo；individual-pro-v1 是旧 Pro。 */
const COMMAND_CODE_PLANS = [
  { id: "individual-provider", monthly: 15 },
  { id: "individual-pro-v1", monthly: 80 },
  { id: "individual-goat", monthly: 70 },
  { id: "individual-ultra", monthly: 300 },
  { id: "individual-max", monthly: 150 },
  { id: "individual-pro", monthly: 30 },
  { id: "individual-go", monthly: 10 },
  { id: "teams-pro", monthly: 40 },
] as const;

/** credits 回复里写的套餐 id；没写为 null。 */
export function commandCodePlanIdOf(body: unknown): string | null {
  const credits = isRecord(body) && isRecord(body.credits) ? body.credits : null;
  const planId = typeof credits?.planId === "string" ? credits.planId : "";
  return planId === "" ? null : planId;
}

/**
 * 套餐的月度 credits 也作一个窗口（照 magpie cmdQuotaOf）：池子是套餐每月给的（剩的更多时取剩的）加上买的与送的，
 * 已用是池子减剩下的；不知道套餐或回复没说 credits 时没有这个窗口。
 */
export function commandCodeCreditsWindow(input: {
  body: unknown;
  planId: string | null;
}): PlanWindow | null {
  const id = (input.planId ?? "").toLowerCase().replaceAll("_", "-");
  const plan = COMMAND_CODE_PLANS.find((candidate) => id.startsWith(candidate.id));
  if (!plan) return null;
  const credits = isRecord(input.body) && isRecord(input.body.credits) ? input.body.credits : {};
  let monthly = 0;
  let left = 0;
  let isKnown = false;
  for (const [index, value] of [
    credits.monthlyCredits,
    credits.purchasedCredits,
    credits.freeCredits,
  ].entries()) {
    const n = numberOf(value);
    if (n === null) continue;
    const kept = Math.max(0, n);
    if (index === 0) monthly = kept;
    left += kept;
    isKnown = true;
  }
  if (!isKnown) return null;
  const pool = Math.max(plan.monthly, monthly) + left - monthly;
  const used = pool - left;
  return {
    id: "credits",
    label: "Credits",
    usedPct: Math.min(100, (100 * used) / pool),
    resetsAt: null,
    span: null,
    used,
    limit: pool,
    unit: "USD",
  };
}

/**
 * Command Code 的订阅（照 magpie cmdSubscription）：{"success":true,"data":{"planId":…,"status":"active"}}；
 * 取消了、过期了或没有的是没有套餐（""）。读不出为 null。
 */
export function commandCodeSubscriptionPlanId(body: unknown): string | null {
  if (!isRecord(body) || body.success === false) return null;
  const data = isRecord(body.data) ? body.data : null;
  const planId = typeof data?.planId === "string" ? data.planId : "";
  const status = typeof data?.status === "string" ? data.status : "";
  if (planId === "" || status === "canceled" || status === "incomplete_expired") return "";
  return planId;
}

/**
 * Ollama Cloud 的 /api/balance：{"included":{"balance_usd":72.5,"allowance_usd":100,"period":{"from":…,"until":…}},
 * "purchased":{"balance_usd":25}}；旧套餐没有美元额度，是 session 与 weekly 两个限额（给剩余百分比）。
 * 套餐含的额度是一个窗口（27–32 天的叫 Month），用完会花买的 credits，所以买过 credits 时这些窗口放一旁。
 */
function readOllamaPlan(body: unknown): PlanRead {
  const included = isRecord(body) && isRecord(body.included) ? body.included : null;
  if (included === null) return { kind: "windows", windows: [] };
  const purchased = isRecord(body) && isRecord(body.purchased) ? body.purchased : null;
  const isBought = (numberOf(purchased?.balance_usd) ?? 0) > 0;
  const allowance = ollamaAllowance(included);
  const windows = [...ollamaLimits(included), ...(allowance === null ? [] : [allowance])];
  return {
    kind: "windows",
    windows: isBought ? windows.map((window) => ({ ...window, aside: true })) : windows,
  };
}

/** 旧套餐的 session 与 weekly 限额（给的是剩余百分比）；session 多长回复不说，没有长度，周就是一周。 */
function ollamaLimits(included: Record<string, unknown>): PlanWindow[] {
  const limits = [
    { key: "session", id: "session", label: "Session limit", span: null },
    { key: "weekly", id: "7d", label: "7 days", span: 7 * 24 * 3_600_000 },
  ];
  const windows: PlanWindow[] = [];
  for (const entry of limits) {
    const limit = included[entry.key];
    const left = isRecord(limit) ? numberOf(limit.remaining_percent) : null;
    if (!isRecord(limit) || left === null) continue;
    const reset = typeof limit.resets_at === "string" ? Date.parse(limit.resets_at) : Number.NaN;
    windows.push({
      id: entry.id,
      label: entry.label,
      usedPct: clampPct(100 - left),
      resetsAt: Number.isNaN(reset) ? null : isoOfMs(reset),
      span: entry.span,
    });
  }
  return windows;
}

/** 套餐含的美元额度：这一期用了多少，期末重置；回复没说额度或剩多少时没有这个窗口。 */
function ollamaAllowance(included: Record<string, unknown>): PlanWindow | null {
  const allowance = numberOf(included.allowance_usd);
  const left = numberOf(included.balance_usd);
  if (allowance === null || left === null || allowance <= 0) return null;
  const used = Math.min(allowance, Math.max(0, allowance - left));
  const period = isRecord(included.period) ? included.period : {};
  const until = typeof period.until === "string" ? Date.parse(period.until) : Number.NaN;
  const from = typeof period.from === "string" ? Date.parse(period.from) : Number.NaN;
  const span = until > from ? until - from : null;
  const days = (span ?? 0) / (24 * 3_600_000);
  const isMonth = days >= 27 && days <= 32;
  return {
    id: isMonth ? "month" : "allowance",
    label: isMonth ? "Month" : "Allowance",
    usedPct: clampPct((used / allowance) * 100),
    resetsAt: Number.isNaN(until) ? null : isoOfMs(until),
    span,
    used,
    limit: allowance,
    unit: "USD",
  };
}

/** 问智谱团队窗口的请求头（照 magpie zhipuKeyTeamAt 与 zcodeTeamHeaders）：裸 key、团队的组织与项目、Set-Language。 */
export function zhipuTeamHeaders(input: {
  apiKey: string;
  org: string;
  project: string;
  language: "zh" | "en";
  userAgent: string;
}): Record<string, string> {
  return {
    authorization: input.apiKey,
    accept: "application/json",
    "accept-language": "en-US,en",
    "user-agent": input.userAgent,
    "bigmodel-organization": input.org,
    "bigmodel-project": input.project,
    "set-language": input.language,
  };
}

/** 团队窗口的地址：个人的查询带 type=2。 */
export function zhipuTeamQuotaUrl(quotaUrl: string): string {
  return `${quotaUrl}?type=2`;
}

/** 团队的重置清单在同一站点（magpie zhipuTeamResets 的 customer-package-reset/list，targetType=TEAM）。 */
export function zhipuTeamResetsUrl(quotaUrl: string): string {
  const root = quotaUrl.replace(/\/api\/monitor\/usage\/quota\/limit$/, "");
  return `${root}/api/biz/customer-package-reset/list?targetType=TEAM`;
}

/** 智谱的时间：「2026-10-18 12:00:00」按北京时间，也有秒或毫秒（照 magpie zcodeWhen、zhipuTime）。 */
function zhipuWhen(value: unknown): string | null {
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?$/.exec(value.trim());
    if (match) return isoOfMs(Date.parse(`${match[1]}T${match[2] ?? "00:00:00"}+08:00`));
  }
  const n = numberOf(value);
  if (n === null || n <= 0) return null;
  return isoOfMs(n > 1e12 ? n : n * 1000);
}

/**
 * 重置清单（照 magpie zhipuResets）：{"code":200,"data":{"fiveHourResets":[{"available":true,"expireTime":…}],
 * "weekResets":[…]}}。只数还能用的（用掉的还列一周）；读不出或一次都没有为 null，不显示 0。
 */
export function readZhipuResets(body: unknown): ApiEndpointBalanceResets | null {
  if (!isRecord(body)) return null;
  const code = body.code === undefined || body.code === null ? "" : String(body.code).trim();
  if (code !== "" && code !== "0" && code !== "200") return null;
  const data = isRecord(body.data) ? body.data : null;
  if (data === null) return null;
  const each: ApiEndpointBalanceReset[] = [];
  const count = (list: unknown, window: "fiveHour" | "weekly") => {
    const resets = Array.isArray(list) ? list.filter(isRecord) : [];
    let n = 0;
    for (const reset of resets) {
      if (reset.available !== true) continue;
      n += 1;
      each.push({ until: zhipuWhen(reset.expireTime), window });
    }
    return n;
  };
  const fiveHour = count(data.fiveHourResets, "fiveHour");
  const weekly = count(data.weekResets, "weekly");
  if (fiveHour + weekly === 0) return null;
  // 最早过期的在前，不过期的在后。
  each.sort((a, b) => {
    if (a.until === null || b.until === null)
      return Number(a.until === null) - Number(b.until === null);
    return Date.parse(a.until) - Date.parse(b.until);
  });
  return {
    count: fiveHour + weekly,
    until: each[0]?.until ?? null,
    byWindow: true,
    fiveHour,
    weekly,
    each,
  };
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
