// 厂商状态页提示移植自 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的 upstreamOf、upstreamBadge）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import {
  API_ENDPOINT_VENDOR_LEVELS,
  type ApiEndpointVendorLevel,
  type ApiEndpointVendorStatus,
  type ApiEndpointVendorStatusResponse,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/*
 * 厂商官方状态页在接口行与用量页订阅卡片上的提示（照 magpie app.js 的 upstreamOf、upstreamBadge）：
 * 页面说 API 降级、中断或维护时提示并给链接；DeepSeek 只给链接；读不到的页什么都不标（不知道，不是正常也不是故障）。
 */

export type VendorNoticeTone = "warning" | "danger" | "muted";

export type VendorNoticeDetail =
  | { kind: "part"; name: string; status: string }
  | { kind: "incident"; name: string };

export interface VendorNotice {
  vendorName: string;
  // 有事件页时先开事件页，否则开状态页。
  link: string;
  // 只给链接时为 null。
  problem: { tone: VendorNoticeTone; details: VendorNoticeDetail[] } | null;
}

// 正常不提示。
const LEVEL_TONES: Record<ApiEndpointVendorLevel, VendorNoticeTone | null> = {
  ok: null,
  degraded: "warning",
  partial: "danger",
  major: "danger",
  maintenance: "muted",
};

export type VendorStatusAnswer = Pick<
  ApiEndpointVendorStatusResponse["payload"],
  "vendors" | "endpointVendors"
>;

export function vendorNoticeOf(status: ApiEndpointVendorStatus): VendorNotice | null {
  if (status.isLinkOnly) {
    return { vendorName: status.name, link: status.page, problem: null };
  }
  // 不认识的等级（daemon 以后多的）不提示。
  const level = API_ENDPOINT_VENDOR_LEVELS.find((known) => known === status.level);
  const tone = level === undefined ? null : LEVEL_TONES[level];
  if (tone === null) return null;
  const incidentPage = status.incidents.find((incident) => incident.url !== null)?.url;
  const details: VendorNoticeDetail[] = [
    ...status.parts.map((part) => ({ kind: "part" as const, ...part })),
    ...status.incidents
      .filter((incident) => incident.name !== "")
      .map((incident) => ({ kind: "incident" as const, name: incident.name })),
  ];
  return { vendorName: status.name, link: incidentPage ?? status.page, problem: { tone, details } };
}

/** 接口 id → 它对上的厂商的提示；没有提示的接口不在里面。 */
export function endpointVendorNotices(
  answer: VendorStatusAnswer | null,
): ReadonlyMap<string, VendorNotice> {
  const notices = new Map<string, VendorNotice>();
  if (answer === null) return notices;
  for (const [endpointId, vendorId] of Object.entries(answer.endpointVendors)) {
    const notice = vendorNoticeById({ answer, vendorId });
    if (notice !== null) notices.set(endpointId, notice);
  }
  return notices;
}

export function vendorNoticeById(input: {
  answer: VendorStatusAnswer | null;
  vendorId: string;
}): VendorNotice | null {
  const status = input.answer?.vendors.find((vendor) => vendor.vendor === input.vendorId);
  return status ? vendorNoticeOf(status) : null;
}

// 用量页的订阅卡片：Claude Code 的订阅走 Anthropic 的 API，Codex 的 ChatGPT 账号走 OpenAI 的（magpie 按订阅账号的地址对厂商）。
const SUBSCRIPTION_VENDORS: ReadonlyMap<string, string> = new Map([
  ["claude", "anthropic"],
  ["codex", "openai"],
]);

/** 用量来源对上的厂商；不是这两家订阅的为 null。 */
export function subscriptionVendorOf(sourceId: string): string | null {
  return SUBSCRIPTION_VENDORS.get(sourceId) ?? null;
}
