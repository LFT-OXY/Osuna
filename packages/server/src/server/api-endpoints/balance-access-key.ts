// 火山方舟与腾讯云 Token Plan 企业版的套餐窗口移植自 magpie（https://github.com/yetone/magpie，
// internal/provider/volcengine_usage.go 的 volcPlanOf、volcRegion、volcSign、volcQuery、volcOpenAPICall、volcRefusesKey、
// volcReadCodingPlan、volcReadAFP、volcWindow、volcTime，tencent_usage.go 的 tencentPlanRegion、tencentPlanCards、
// tencentPlan.window、tc3Sign、tencentAPICall、tcRefusesKey，access_key_card.go，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { createHash, createHmac } from "node:crypto";
import {
  accessKeyVendorOf,
  TENCENT_TOKEN_PLAN_REGIONS,
} from "@getpaseo/protocol/api-endpoint/balance-settings";
import type { ApiEndpointStoppedPlan } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { numberOf } from "./balance-field.js";
import type { PlanWindow } from "./balance-plan.js";
import type { StoredApiEndpoint } from "./store.js";
import { isRecord } from "./upstream-http.js";

/*
 * 火山方舟 Coding Plan / Agent Plan 与腾讯云 Token Plan 企业版只把窗口告诉账户的控制面：用云账号密钥（火山的
 * AccessKey ID 与 Secret Access Key、腾讯的 SecretId 与 SecretKey）签名去问两家的开放平台，套餐 key 问不到。
 * 签名是纯函数：火山照官方 SDK（volc-sdk-golang base/sign.go GetSignRequest），腾讯照 TC3-HMAC-SHA256 签名文档。
 */

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function hmac(key: string | Buffer, text: string): Buffer {
  return createHmac("sha256", key).update(text).digest();
}

/** 时刻写成 20261009T083015Z（UTC）。 */
function compactUtc(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** 查询串照 SDK 签名与发送的写法：按键排序、百分号编码，空格写 %20。 */
function volcQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key] ?? "")}`)
    .join("&");
}

const VOLC_CONTENT_TYPE = "application/json";
const VOLC_SERVICE = "ark";
const VOLC_SIGNED_HEADERS = "content-type;host;x-content-sha256;x-date";

export interface VolcSigned {
  authorization: string;
  xDate: string;
  contentSha256: string;
}

/**
 * 火山开放平台一次 POST「/」的签名：签 Content-Type、Host、X-Content-Sha256、X-Date 四个头，scope 是
 * 日期/region/ark/request，签名密钥由 Secret 原文逐层派生。host 是真正发往的主机（测试里是本机地址加端口）。
 */
export function volcSign(input: {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  host: string;
  query: Record<string, string>;
  body: string;
  now: number;
}): VolcSigned {
  const xDate = compactUtc(input.now);
  const date = xDate.slice(0, 8);
  const contentSha256 = sha256Hex(input.body);
  const canonical = [
    "POST",
    "/",
    volcQuery(input.query),
    `content-type:${VOLC_CONTENT_TYPE}\nhost:${input.host}\nx-content-sha256:${contentSha256}\nx-date:${xDate}\n`,
    VOLC_SIGNED_HEADERS,
    contentSha256,
  ].join("\n");
  const scope = `${date}/${input.region}/${VOLC_SERVICE}/request`;
  const toSign = ["HMAC-SHA256", xDate, scope, sha256Hex(canonical)].join("\n");
  let key = hmac(input.secretAccessKey, date);
  for (const part of [input.region, VOLC_SERVICE, "request"]) key = hmac(key, part);
  const signature = hmac(key, toSign).toString("hex");
  return {
    authorization: `HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${VOLC_SIGNED_HEADERS}, Signature=${signature}`,
    xDate,
    contentSha256,
  };
}

/**
 * 腾讯云 TC3-HMAC-SHA256 的 Authorization：签 content-type、host、x-tc-action（动作小写），scope 是
 * 日期/服务/tc3_request（日期按 UTC），签名密钥由「TC3」加 SecretKey 逐层派生。
 */
export function tc3Sign(input: {
  secretId: string;
  secretKey: string;
  service: string;
  host: string;
  action: string;
  contentType: string;
  body: string;
  timestamp: number;
}): string {
  const date = new Date(input.timestamp * 1000).toISOString().slice(0, 10);
  const signedHeaders = "content-type;host;x-tc-action";
  const canonical = [
    "POST",
    "/",
    "",
    `content-type:${input.contentType}\nhost:${input.host}\nx-tc-action:${input.action.toLowerCase()}\n`,
    signedHeaders,
    sha256Hex(input.body),
  ].join("\n");
  const scope = `${date}/${input.service}/tc3_request`;
  const toSign = ["TC3-HMAC-SHA256", String(input.timestamp), scope, sha256Hex(canonical)].join(
    "\n",
  );
  const key = hmac(hmac(hmac(`TC3${input.secretKey}`, date), input.service), "tc3_request");
  const signature = hmac(key, toSign).toString("hex");
  return `TC3-HMAC-SHA256 Credential=${input.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/** 火山两个套餐各问哪个动作（GetCodingPlanUsage 是 Coding Plan 的，GetAFPUsage 是 Agent Plan 的）、在哪个区。 */
export type AccessKeyPlan =
  | { vendor: "volcengine"; action: "GetCodingPlanUsage" | "GetAFPUsage"; region: string }
  | { vendor: "tencent"; region: "ap-guangzhou" | "ap-singapore" };

const VOLC_FORMAT_ORDER = ["openai_chat", "anthropic_messages", "openai_responses"] as const;
const TENCENT_FORMAT_ORDER = ["openai_chat", "openai_responses", "anthropic_messages"] as const;
const VOLC_DEFAULT_REGION = "cn-beijing";

function urlsInOrder(baseUrls: StoredApiEndpoint["baseUrls"], order: readonly string[]): URL[] {
  return order.flatMap((format) => {
    const base = baseUrls.find((entry) => entry.format === format)?.url.trim();
    if (!base) return [];
    try {
      return [new URL(base)];
    } catch {
      return [];
    }
  });
}

/** 路径补上末尾的斜杠，方便按前缀认（/api/coding 与 /api/coding/v3 都算）。 */
function slashedPath(url: URL): string {
  return `${url.pathname.replace(/\/+$/, "")}/`;
}

/**
 * 这家接口的套餐要用云账号密钥读（照 magpie volcPlanOf、tencentPlanRegion）：火山方舟 /api/coding 是 Coding Plan、
 * /api/plan 是 Agent Plan，区按主机名（ark.cn-beijing.volces.com 是 cn-beijing）；腾讯云 Token Plan 企业版按主机在广州或
 * 新加坡。按量付费（火山的 /api/v3）、别的厂商为 null。
 */
export function accessKeyPlanOf(baseUrls: StoredApiEndpoint["baseUrls"]): AccessKeyPlan | null {
  const vendor = accessKeyVendorOf(baseUrls.map((entry) => entry.url));
  if (vendor === "volcengine") {
    for (const url of urlsInOrder(baseUrls, VOLC_FORMAT_ORDER)) {
      if (!url.hostname.toLowerCase().endsWith(".volces.com")) continue;
      const path = slashedPath(url);
      const region = volcRegion(url.hostname);
      if (path.startsWith("/api/coding/")) return { vendor, action: "GetCodingPlanUsage", region };
      if (path.startsWith("/api/plan/")) return { vendor, action: "GetAFPUsage", region };
    }
    return null;
  }
  if (vendor === "tencent") {
    for (const url of urlsInOrder(baseUrls, TENCENT_FORMAT_ORDER)) {
      const region = TENCENT_TOKEN_PLAN_REGIONS[url.hostname.toLowerCase()];
      if (region !== undefined && slashedPath(url).startsWith("/plan/")) return { vendor, region };
    }
  }
  return null;
}

function volcRegion(host: string): string {
  const labels = host.toLowerCase().split(".");
  if (labels.length === 4 && labels[0] === "ark" && labels[1]) return labels[1];
  return VOLC_DEFAULT_REGION;
}

const VOLC_API_VERSION = "2024-01-01";
const TENCENT_API_VERSION = "2026-03-22";
const TENCENT_SERVICE = "tokenhub";
const TENCENT_CONTENT_TYPE = "application/json; charset=utf-8";

/** 一次要发的开放平台请求：地址、请求头与正文；只发往两家的开放平台。 */
export interface OpenApiRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** 问火山开放平台：POST「/?Action=…&Version=2024-01-01」，正文 {}，按 SDK 签名。 */
export function volcRequest(input: {
  openUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
  action: string;
  region: string;
  userAgent: string;
  now: number;
}): OpenApiRequest {
  const open = new URL(input.openUrl);
  const query = { Action: input.action, Version: VOLC_API_VERSION };
  const body = "{}";
  const signed = volcSign({
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    region: input.region,
    host: open.host,
    query,
    body,
    now: input.now,
  });
  return {
    url: `${open.origin}/?${volcQuery(query)}`,
    headers: {
      "content-type": VOLC_CONTENT_TYPE,
      "x-date": signed.xDate,
      "x-content-sha256": signed.contentSha256,
      authorization: signed.authorization,
      accept: "application/json",
      "user-agent": input.userAgent,
    },
    body,
  };
}

/** 问腾讯云 TokenHub 的云 API：POST「/」，动作、版本、区与时间戳在 X-TC-* 头里，TC3 签名（照 magpie 不带 Accept）。 */
export function tencentRequest(input: {
  openUrl: string;
  secretId: string;
  secretKey: string;
  action: string;
  params: Record<string, unknown>;
  region: string;
  userAgent: string;
  now: number;
}): OpenApiRequest {
  const open = new URL(input.openUrl);
  const body = JSON.stringify(input.params);
  const timestamp = Math.floor(input.now / 1000);
  return {
    url: `${open.origin}/`,
    headers: {
      "content-type": TENCENT_CONTENT_TYPE,
      "x-tc-action": input.action,
      "x-tc-version": TENCENT_API_VERSION,
      "x-tc-region": input.region,
      "x-tc-timestamp": String(timestamp),
      authorization: tc3Sign({
        secretId: input.secretId,
        secretKey: input.secretKey,
        service: TENCENT_SERVICE,
        host: open.host,
        action: input.action,
        contentType: TENCENT_CONTENT_TYPE,
        body,
        timestamp,
      }),
      "user-agent": input.userAgent,
    },
    body,
  };
}

/** 开放平台在回复里说的错误：火山在 ResponseMetadata.Error，腾讯（总是 200）在 Response.Error。 */
export interface OpenApiError {
  code: string;
  message: string;
  // 说的是密钥或它的权限，不是套餐（照 magpie volcRefusesKey、tcRefusesKey）。
  refusesKey: boolean;
  // 对方忙、限流或内部错误：下次再读。
  isPassing: boolean;
}

export function openApiErrorOf(input: {
  vendor: AccessKeyPlan["vendor"];
  body: unknown;
}): OpenApiError | null {
  if (!isRecord(input.body)) return null;
  const holder = input.vendor === "volcengine" ? input.body.ResponseMetadata : input.body.Response;
  const error = isRecord(holder) && isRecord(holder.Error) ? holder.Error : null;
  if (error === null) return null;
  const code = typeof error.Code === "string" ? error.Code : "";
  const message = typeof error.Message === "string" ? error.Message : "";
  if (code === "" && message === "") return null;
  const lower = code.toLowerCase();
  const refusesKey =
    input.vendor === "volcengine"
      ? [
          "accesskey",
          "signature",
          "accessdenied",
          "unauthorized",
          "forbidden",
          "credential",
          "authfailure",
        ].some((word) => lower.includes(word))
      : lower.startsWith("authfailure") || lower.includes("unauthorized");
  const isPassing = ["limitexceeded", "internalerror", "unavailable", "timeout"].some((word) =>
    lower.includes(word),
  );
  return { code, message, refusesKey, isPassing };
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** 火山的级别读成哪个窗口，名字同别家的套餐（session 5 小时、weekly 7 天、monthly 月，月按 30 天算配速）。 */
function volcWindow(level: string): Pick<PlanWindow, "id" | "label" | "span"> | null {
  switch (level.trim().toLowerCase()) {
    case "session":
      return { id: "5h", label: "5 hours", span: 5 * HOUR_MS };
    case "weekly":
      return { id: "7d", label: "7 days", span: 7 * DAY_MS };
    case "monthly":
      return { id: "month", label: "Month", span: 30 * DAY_MS };
    default:
      return null;
  }
}

/** 火山给的重置时间：秒（Coding Plan）、毫秒（Agent Plan）或 RFC 3339；没有为 null。 */
function volcTime(value: unknown): string | null {
  if (typeof value === "string") {
    const text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
      const parsed = Date.parse(text);
      if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
    }
  }
  const n = numberOf(value);
  if (n === null || n <= 0) return null;
  // 1e11 秒是 5138 年、1e11 毫秒是 1973 年：重置时间不会落在另一边。
  return new Date(n > 1e11 ? n : n * 1000).toISOString();
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * GetCodingPlanUsage 的 Result：{"QuotaUsage":[{"Level":"session","Percent":10.5,"ResetTimestamp":1758100000},…]}，
 * Percent 是已用的百分比；认不得的级别不要。
 */
function readVolcCodingPlan(result: Record<string, unknown>): PlanWindow[] {
  const usage = Array.isArray(result.QuotaUsage) ? result.QuotaUsage.filter(isRecord) : [];
  return usage.flatMap((entry) => {
    const window = volcWindow(typeof entry.Level === "string" ? entry.Level : "");
    const used = numberOf(entry.Percent);
    if (window === null || used === null) return [];
    return [{ ...window, usedPct: used, resetsAt: volcTime(entry.ResetTimestamp) }];
  });
}

/**
 * GetAFPUsage 的 Result：AFPFiveHour、AFPWeekly、AFPMonthly（AFPDaily 火山自己的控制台也不显示），每桶给 Percent，或
 * Used 与 Quota（或 Total），重置在 ResetTime 或 ResetTimestamp；没有额度的桶不在这个套餐里。
 */
function readVolcAgentPlan(result: Record<string, unknown>): PlanWindow[] {
  const buckets = [
    ["session", result.AFPFiveHour],
    ["weekly", result.AFPWeekly],
    ["monthly", result.AFPMonthly],
  ] as const;
  return buckets.flatMap(([level, bucket]) => {
    if (!isRecord(bucket)) return [];
    const window = volcWindow(level);
    if (window === null) return [];
    const resetsAt = volcTime(bucket.ResetTime) ?? volcTime(bucket.ResetTimestamp);
    const percent = numberOf(bucket.Percent);
    if (percent !== null) return [{ ...window, usedPct: percent, resetsAt }];
    const used = numberOf(bucket.Used);
    const limit = numberOf(bucket.Quota) ?? numberOf(bucket.Total);
    if (used === null || limit === null || limit <= 0) return [];
    return [{ ...window, usedPct: (used / limit) * 100, resetsAt, used, limit }];
  });
}

/** 火山回复读成窗口；没有窗口（这个账户没有这个套餐，或回复的样子认不得）为空。 */
export function readVolcPlan(input: {
  action: "GetCodingPlanUsage" | "GetAFPUsage";
  body: unknown;
}): { windows: PlanWindow[]; tier: string | null } {
  const result = isRecord(input.body) && isRecord(input.body.Result) ? input.body.Result : null;
  if (result === null) return { windows: [], tier: null };
  if (input.action === "GetCodingPlanUsage") {
    return { windows: readVolcCodingPlan(result), tier: null };
  }
  // Agent Plan 的档位（照 magpie 接在套餐名后）。
  const tier = typeof result.Tier === "string" ? result.Tier.trim() : "";
  return { windows: readVolcAgentPlan(result), tier: tier === "" ? null : tier };
}

/** DescribeTokenPlanList 与 DescribeTokenPlan 说的一个团队套餐（文档的 TokenPlanListItem 与 DescribeTokenPlan 的输出）。 */
export interface TencentPlan {
  teamId: string;
  name: string;
  productType: string;
  status: string;
  stopReason: string;
  packageInfo: Record<string, unknown> | null;
  tokenSummary: Record<string, unknown> | null;
}

function tencentPlanOf(entry: Record<string, unknown>): TencentPlan {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    teamId: text(entry.TeamId),
    name: text(entry.Name).trim(),
    productType: text(entry.ProductType),
    status: text(entry.Status).trim(),
    stopReason: text(entry.StopReason).trim(),
    packageInfo: isRecord(entry.PackageInfo) ? entry.PackageInfo : null,
    tokenSummary: isRecord(entry.TokenSummary) ? entry.TokenSummary : null,
  };
}

/** DescribeTokenPlanList 列出的团队套餐（有 TeamId 的）；回复读不懂为 null。 */
export function readTencentPlanList(body: unknown): TencentPlan[] | null {
  const response = isRecord(body) && isRecord(body.Response) ? body.Response : null;
  if (response === null) return null;
  const set = Array.isArray(response.TokenPlanSet) ? response.TokenPlanSet.filter(isRecord) : [];
  return set.map(tencentPlanOf).filter((plan) => plan.teamId !== "");
}

/** DescribeTokenPlan 说的比清单多的那几样（套餐包、本周期起止、产品类型）盖在清单的上面。 */
export function withTencentDetail(plan: TencentPlan, body: unknown): TencentPlan {
  const response = isRecord(body) && isRecord(body.Response) ? body.Response : null;
  if (response === null) return plan;
  const detail = tencentPlanOf(response);
  return {
    ...plan,
    packageInfo: detail.packageInfo ?? plan.packageInfo,
    tokenSummary: detail.tokenSummary ?? plan.tokenSummary,
    productType: detail.productType || plan.productType,
    ...(detail.status === "" ? {} : { status: detail.status, stopReason: detail.stopReason }),
  };
}

/**
 * 套餐停用了（Status 不是 enable：用完、欠费、冻结，照 magpie）时的状态与原因；NORMAL、none 一类不算原因。没停用为 null。
 */
export function tencentStopped(
  plan: TencentPlan,
): { status: string; reason: string | null } | null {
  if (plan.status === "" || plan.status.toLowerCase() === "enable") return null;
  const reason = plan.stopReason;
  const isNoReason = reason === "" || ["normal", "none"].includes(reason.toLowerCase());
  return { status: plan.status, reason: isNoReason ? null : reason };
}

function rfc3339(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value.trim());
  return Number.isNaN(parsed) ? null : parsed;
}

/** 照 Go 的 AddDate(0, months, 0)（UTC）。 */
function addMonths(ms: number, months: number): number {
  const at = new Date(ms);
  at.setUTCMonth(at.getUTCMonth() + months);
  return at.getTime();
}

/** 没有本周期起止时：从套餐包的 StartTime 起按月数到现在，且不晚于 ExpireTime；周期不按月或没有起点为 null。 */
function tencentCycleEnd(pack: Record<string, unknown>, now: number): number | null {
  const start = rfc3339(pack.StartTime);
  const unit = typeof pack.CycleUnit === "string" ? pack.CycleUnit : "";
  if (start === null || (unit !== "" && unit.toLowerCase() !== "month")) return null;
  let n = numberOf(pack.CurrentCycle) ?? 0;
  let end = addMonths(start, Math.max(Math.trunc(n), 1));
  while (end <= now && n < 1200) {
    n += 1;
    end = addMonths(start, n);
  }
  const expires = rfc3339(pack.ExpireTime);
  return expires !== null && expires < end ? expires : end;
}

/**
 * 团队套餐的月窗口：本周期额度 CycleQuota（没有用 TotalQuota）用了多少 TotalUsed，专业套餐（enterprise）按积分、
 * 轻享套餐（enterprise-auto）按 token；重置在 TokenSummary 的 CycleEndTime，没有时见 tencentCycleEnd。没说额度为 null。
 */
export function tencentPlanWindow(input: { plan: TencentPlan; now: number }): PlanWindow | null {
  const pack = input.plan.packageInfo;
  if (pack === null) return null;
  const cycle = numberOf(pack.CycleQuota);
  const limit = cycle !== null && cycle > 0 ? cycle : numberOf(pack.TotalQuota);
  const used = numberOf(pack.TotalUsed);
  if (limit === null || used === null || limit <= 0) return null;
  let span: number = 30 * DAY_MS;
  const summary = input.plan.tokenSummary;
  let resetsAt = summary === null ? null : rfc3339(summary.CycleEndTime);
  const start = summary === null ? null : rfc3339(summary.CycleStartTime);
  if (resetsAt !== null && start !== null && resetsAt > start) span = resetsAt - start;
  resetsAt ??= tencentCycleEnd(pack, input.now);
  return {
    id: "month",
    label: "Month",
    usedPct: clampPct((used / limit) * 100),
    resetsAt: resetsAt === null ? null : new Date(resetsAt).toISOString(),
    span,
    used,
    limit,
    unit: input.plan.productType.toLowerCase() === "enterprise-auto" ? "tokens" : "credits",
  };
}

/** 一个团队套餐读出的：团队名、月窗口（读不出为 null）与停用的状态。 */
export interface TencentTeam {
  name: string;
  window: PlanWindow | null;
  stopped: ApiEndpointStoppedPlan | null;
}

/** 几个团队时窗口与停用的状态写上团队名（照 magpie 每个团队一张卡、以团队名区分）。 */
export function tencentTeamOf(input: {
  plan: TencentPlan;
  isSeveral: boolean;
  now: number;
}): TencentTeam {
  const name = input.plan.name || input.plan.teamId;
  const window = tencentPlanWindow({ plan: input.plan, now: input.now });
  if (window !== null && input.isSeveral) {
    window.id = `${name.replace(/[:#]/g, "_")}:month`;
    window.label = `${name} · Month`;
  }
  const stopped = tencentStopped(input.plan);
  return {
    name,
    window,
    stopped: stopped === null ? null : { team: input.isSeveral ? name : null, ...stopped },
  };
}
