// 冷却设置的读法（空即用中转站自己的、整数分钟 0 到八天、「原因不明不冷却」与冷却上限互斥）移植自 magpie
// （https://github.com/yetone/magpie，internal/provider/concurrency.go 的 SetQuotaRest、SetRestCap、RestCapOff）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import {
  cooldownSettingsProblem,
  type CooldownSettingsProblem,
} from "@getpaseo/protocol/api-endpoint/cooldown-settings";
import type { ApiEndpointCooldownSettings } from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/*
 * 添加 / 编辑窗口「高级」里冷却设置的纯逻辑：存的设置与表单里的样子互相换算，以及哪一项不在范围里（当场提示，挡住保存）。
 */

/** 表单里的冷却设置：两个分钟框的文字（空即用中转站自己的）与「原因不明的失败不冷却」。 */
export interface CooldownFields {
  quotaRestText: string;
  restCapText: string;
  noFailRest: boolean;
}

export function cooldownFieldsOf(
  settings: ApiEndpointCooldownSettings | undefined,
): CooldownFields {
  const textOf = (minutes: number | undefined) =>
    minutes !== undefined && minutes > 0 ? String(minutes) : "";
  return {
    quotaRestText: textOf(settings?.quotaRestMinutes),
    restCapText: textOf(settings?.restCapMinutes),
    noFailRest: settings?.noFailRest === true,
  };
}

/** 设了任一项：表单一打开就展开「高级」。 */
export function hasCooldownSettings(fields: CooldownFields): boolean {
  return fields.quotaRestText !== "" || fields.restCapText !== "" || fields.noFailRest;
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
 * 表单读成保存时整份发的冷却设置：空的与 0 不发（用中转站自己的），「原因不明不冷却」开着时冷却上限不发（照 magpie
 * RestCapOff 与 RestCap 是同一项）；不是 0 到八天的整数分钟时是哪一项不对。
 */
export function cooldownFieldsRead(fields: CooldownFields): CooldownFieldsRead {
  const quotaRestMinutes = minutesOf(fields.quotaRestText);
  const restCapMinutes = fields.noFailRest ? undefined : minutesOf(fields.restCapText);
  const problem = cooldownSettingsProblem({ quotaRestMinutes, restCapMinutes });
  if (problem !== null) return { kind: "invalid", problem };
  const value: ApiEndpointCooldownSettings = {};
  if (quotaRestMinutes !== undefined && quotaRestMinutes > 0) {
    value.quotaRestMinutes = quotaRestMinutes;
  }
  if (restCapMinutes !== undefined && restCapMinutes > 0) value.restCapMinutes = restCapMinutes;
  if (fields.noFailRest) value.noFailRest = true;
  return { kind: "ok", value };
}
