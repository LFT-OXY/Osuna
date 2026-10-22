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
};

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
  return hint ? input.t(HINT_KEYS[hint]) : null;
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
