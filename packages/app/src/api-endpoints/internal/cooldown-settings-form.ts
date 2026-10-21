// 冷却设置的读法（空即用中转站自己的、整数分钟 0 到八天、冷却多久与冷却到每天几点二选一、「原因不明不冷却」与冷却上限互斥）
// 移植自 magpie（https://github.com/yetone/magpie，internal/provider/concurrency.go 的 SetQuotaRest、SetQuotaResetAt、
// SetRestCap、RestCapOff，internal/cli/providers_cli.go 的 quotaRestCmd）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import {
  cooldownSettingsProblem,
  type CooldownSettingsProblem,
} from "@getpaseo/protocol/api-endpoint/cooldown-settings";
import type { ApiEndpointCooldownSettings } from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/*
 * 添加 / 编辑窗口「高级」里冷却设置的纯逻辑：存的设置与表单里的样子互相换算，以及哪一项不对（当场提示，挡住保存）。
 */

/** 额度用完后怎么冷却：冷却多少分钟，或冷却到每天的某个时刻（magpie 的 quota-rest 30m 与 quota-rest until 08:00）。 */
export const QUOTA_REST_MODES = ["minutes", "time"] as const;
export type QuotaRestMode = (typeof QUOTA_REST_MODES)[number];

/** 表单里的冷却设置：额度冷却的设法与两个框的文字、冷却上限的分钟框（空即用中转站自己的）、「原因不明的失败不冷却」。 */
export interface CooldownFields {
  quotaRestMode: QuotaRestMode;
  quotaRestText: string;
  quotaResetAtText: string;
  restCapText: string;
  noFailRest: boolean;
}

export function cooldownFieldsOf(
  settings: ApiEndpointCooldownSettings | undefined,
): CooldownFields {
  const textOf = (minutes: number | undefined) =>
    minutes !== undefined && minutes > 0 ? String(minutes) : "";
  const quotaResetAtText = settings?.quotaResetAt ?? "";
  return {
    quotaRestMode: quotaResetAtText !== "" ? "time" : "minutes",
    quotaRestText: textOf(settings?.quotaRestMinutes),
    quotaResetAtText,
    restCapText: textOf(settings?.restCapMinutes),
    noFailRest: settings?.noFailRest === true,
  };
}

/** 设了任一项：表单一打开就展开「高级」。 */
export function hasCooldownSettings(fields: CooldownFields): boolean {
  const hasQuotaRest = fields.quotaRestText !== "" || fields.quotaResetAtText !== "";
  return hasQuotaRest || fields.restCapText !== "" || fields.noFailRest;
}

export type CooldownFieldsRead =
  | { kind: "ok"; value: ApiEndpointCooldownSettings }
  | { kind: "invalid"; problem: CooldownSettingsProblem };

/** 框里的文字不是数时当 NaN，交给范围检查报这一项。 */
function minutesOf(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/**
 * 表单读成保存时整份发的冷却设置：只发选中的那种额度冷却（时刻与分钟数是同一项），空的与 0 不发（用中转站自己的），
 * 「原因不明不冷却」开着时冷却上限不发（照 magpie RestCapOff 与 RestCap 是同一项）；哪一项不对时是那一项。
 */
export function cooldownFieldsRead(fields: CooldownFields): CooldownFieldsRead {
  const isTime = fields.quotaRestMode === "time";
  const resetAt = fields.quotaResetAtText.trim();
  const quotaResetAt = isTime && resetAt !== "" ? resetAt : undefined;
  const quotaRestMinutes = isTime ? undefined : minutesOf(fields.quotaRestText);
  const restCapMinutes = fields.noFailRest ? undefined : minutesOf(fields.restCapText);
  const problem = cooldownSettingsProblem({ quotaRestMinutes, restCapMinutes, quotaResetAt });
  if (problem !== null) return { kind: "invalid", problem };
  const value: ApiEndpointCooldownSettings = {};
  if (quotaResetAt !== undefined) value.quotaResetAt = quotaResetAt;
  if (quotaRestMinutes !== undefined && quotaRestMinutes > 0) {
    value.quotaRestMinutes = quotaRestMinutes;
  }
  if (restCapMinutes !== undefined && restCapMinutes > 0) value.restCapMinutes = restCapMinutes;
  if (fields.noFailRest) value.noFailRest = true;
  return { kind: "ok", value };
}
