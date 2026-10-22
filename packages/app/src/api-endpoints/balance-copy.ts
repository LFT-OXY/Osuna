// 重置次数的说法照 magpie（https://github.com/yetone/magpie，internal/provider/codex_resets.go 的 ResetCredits.Words，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { TFunction } from "i18next";
import {
  API_ENDPOINT_BALANCE_FAILURES,
  API_ENDPOINT_BALANCE_HINTS,
  API_ENDPOINT_BALANCE_PARTS,
  type ApiEndpointBalanceFailure,
  type ApiEndpointBalanceFailureReason,
  type ApiEndpointBalanceHint,
  type ApiEndpointBalanceItem,
  type ApiEndpointBalancePart,
  type ApiEndpointBalanceResets,
  type ApiEndpointBalanceWindow,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/*
 * 余额读数按界面语言的说法：详情页「余额与套餐用量」与编辑窗口「查询余额」的结果共用。
 */

const FAILURE_KEYS: Record<ApiEndpointBalanceFailureReason, string> = {
  wrong_url: "settings.apiEndpoints.balance.failure.wrongUrl",
  token_rejected: "settings.apiEndpoints.balance.failure.tokenRejected",
  not_offered: "settings.apiEndpoints.balance.failure.notOffered",
  no_value: "settings.apiEndpoints.balance.failure.noValue",
  temporary: "settings.apiEndpoints.balance.failure.temporary",
};

const HINT_KEYS: Record<ApiEndpointBalanceHint, string> = {
  opencode_no_balance: "settings.apiEndpoints.balance.hint.opencodeNoBalance",
  siliconflow_retired: "settings.apiEndpoints.balance.hint.siliconflowRetired",
  aihubmix_no_limit: "settings.apiEndpoints.balance.hint.aihubmixNoLimit",
  not_asked: "settings.apiEndpoints.balance.hint.notAsked",
  token_on_key_url: "settings.apiEndpoints.balance.hint.tokenOnKeyUrl",
  new_api_user_missing: "settings.apiEndpoints.balance.hint.newApiUserMissing",
  glm_key_refused: "settings.apiEndpoints.balance.hint.glmKeyRefused",
  opencode_go_no_subscription: "settings.apiEndpoints.balance.hint.opencodeGoNoSubscription",
  opencode_key_refused: "settings.apiEndpoints.balance.hint.opencodeKeyRefused",
  access_key_refused: "settings.apiEndpoints.balance.hint.accessKeyRefused",
};

const SPAN_KEYS: Record<string, { one: string; many: string }> = {
  h: {
    one: "settings.apiEndpoints.balance.window.hoursOne",
    many: "settings.apiEndpoints.balance.window.hoursMany",
  },
  d: {
    one: "settings.apiEndpoints.balance.window.daysOne",
    many: "settings.apiEndpoints.balance.window.daysMany",
  },
  min: {
    one: "settings.apiEndpoints.balance.window.minutesOne",
    many: "settings.apiEndpoints.balance.window.minutesMany",
  },
};
const NAMED_WINDOW_KEYS: Record<string, string> = {
  month: "settings.apiEndpoints.balance.window.month",
  allowance: "settings.apiEndpoints.balance.window.allowance",
  mcp_month: "settings.apiEndpoints.balance.window.mcpMonth",
  session: "settings.apiEndpoints.balance.window.session",
  credits: "settings.apiEndpoints.balance.window.credits",
};
const BUCKET_KEYS: Record<string, string> = {
  video: "settings.apiEndpoints.balance.window.bucketVideo",
  image: "settings.apiEndpoints.balance.window.bucketImage",
};

/**
 * 窗口的名字按界面语言写，看代号（daemon 的约定见 ApiEndpointBalanceWindowSchema）：5h、7d、30min、month…；别的桶带
 * 「桶名:」前缀，同名重复的带「#序号」后缀。认不得的写 daemon 给的 label。
 */
export function windowLabel(input: { t: TFunction; window: ApiEndpointBalanceWindow }): string {
  const { t, window } = input;
  const id = window.id.replace(/#\d+$/, "");
  const colon = id.indexOf(":");
  const span = spanLabel({ t, id: colon < 0 ? id : id.slice(colon + 1) });
  if (span === null) return window.label;
  if (colon < 0) return span;
  const bucket = id.slice(0, colon);
  const bucketKey = BUCKET_KEYS[bucket];
  // 没翻译的桶名照 daemon 的 label 写（「Speech · 5 hours」的前半）。
  const bucketName = bucketKey ? t(bucketKey) : window.label.split(" · ")[0] || bucket;
  return t("settings.apiEndpoints.balance.window.bucket", { bucket: bucketName, window: span });
}

function spanLabel(input: { t: TFunction; id: string }): string | null {
  const named = NAMED_WINDOW_KEYS[input.id];
  if (named) return input.t(named);
  const match = /^(\d+)(h|d|min)$/.exec(input.id);
  if (!match) return null;
  const count = Number(match[1]);
  const keys = SPAN_KEYS[match[2]!]!;
  return input.t(count === 1 ? keys.one : keys.many, { count });
}

const RESET_KEY = "settings.apiEndpoints.balance.resets";

/**
 * 「还有 2 次 5 小时重置 · 1 次周重置」：按窗口计的（智谱团队）分开写，没有的那种不写；否则「还有 N 次重置」
 * （照 magpie ResetCredits.Words）。
 */
export function resetsLine(input: { t: TFunction; resets: ApiEndpointBalanceResets }): string {
  const { t, resets } = input;
  const counted = (count: number, kind: "count" | "fiveHour" | "weekly") =>
    t(`${RESET_KEY}.${kind}${count === 1 ? "One" : "Many"}`, { count });
  const parts = resets.byWindow
    ? [
        ...((resets.fiveHour ?? 0) > 0 ? [counted(resets.fiveHour ?? 0, "fiveHour")] : []),
        ...((resets.weekly ?? 0) > 0 ? [counted(resets.weekly ?? 0, "weekly")] : []),
      ]
    : [counted(resets.count, "count")];
  return t(`${RESET_KEY}.left`, { resets: parts.join(" · ") });
}

/** 窗口用量的单位：美元以外认得的翻译，别的照 daemon 给的写。 */
export function windowUnitLabel(input: { t: TFunction; unit: string }): string {
  if (input.unit === "videos") return input.t("settings.apiEndpoints.balance.window.unitVideos");
  if (input.unit === "credits") return input.t("settings.apiEndpoints.balance.window.unitCredits");
  if (input.unit === "tokens") return input.t("settings.apiEndpoints.balance.window.unitTokens");
  return input.unit;
}

const PART_KEYS: Record<ApiEndpointBalancePart, string> = {
  granted: "settings.apiEndpoints.balance.part.granted",
  topped_up: "settings.apiEndpoints.balance.part.toppedUp",
};

/** 赠送 / 充值按界面语言写；daemon 以后多出的部分写它给的 label，余额本身写「余额」。 */
export function itemLabel(input: { t: TFunction; item: ApiEndpointBalanceItem }): string {
  const part = API_ENDPOINT_BALANCE_PARTS.find((candidate) => candidate === input.item.part);
  if (part) return input.t(PART_KEYS[part]);
  return input.item.label ?? input.t("settings.apiEndpoints.balance.balance");
}

export function hintOf(input: {
  t: TFunction;
  failure: ApiEndpointBalanceFailure | null;
}): string | null {
  const hint = API_ENDPOINT_BALANCE_HINTS.find((candidate) => candidate === input.failure?.hint);
  if (!hint) return null;
  // 令牌配错地址：写出该改用的地址（daemon 总会给）。
  return input.t(HINT_KEYS[hint], { url: input.failure?.useUrl ?? "" });
}

export function failureTitle(input: {
  t: TFunction;
  failure: ApiEndpointBalanceFailure | null;
}): string {
  const reason = input.failure?.reason;
  const known = API_ENDPOINT_BALANCE_FAILURES.find((candidate) => candidate === reason);
  const text = input.t(
    known ? FAILURE_KEYS[known] : "settings.apiEndpoints.balance.rowUnavailable",
  );
  const status = input.failure?.status ?? null;
  if (status === null) return text;
  return input.t("settings.apiEndpoints.balance.withStatus", { text, status });
}
