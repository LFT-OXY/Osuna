// 每家的冷却设置（额度用完后冷却多久、冷却最长多久、原因不明的失败不冷却）与它们的范围移植自 magpie
// （https://github.com/yetone/magpie，internal/provider/provider.go 的 QuotaRest、RestCap，
// internal/provider/concurrency.go 的 MaxQuotaRest、QuotaRestFor、RestCapOff、RestCapOr、SetQuotaRest、SetRestCap）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

/*
 * 冷却设置（Cooldown settings）：中转站算这家冷却时用它，没设的项用中转站自己的时长。
 * daemon 保存时拿它校验、中转站拿它取值；app 在表单里拿它当场提示、显示缺省值。
 */

/** 两项设置最大都是八天（分钟）：一周的窗口再多一天（magpie MaxQuotaRest）。 */
export const API_ENDPOINT_COOLDOWN_MAX_MINUTES = 8 * 24 * 60;

/** 不设时中转站自己的时长（分钟），与 daemon 的 COOLDOWN 常量一致：额度用完 15 分钟，冷却最长失败 10 分钟、限流 30 分钟。 */
export const API_ENDPOINT_COOLDOWN_DEFAULTS = {
  quotaRestMinutes: 15,
  failRestCapMinutes: 10,
  rateRestCapMinutes: 30,
} as const;

/** 冷却设置里以分钟计的两项。 */
export const API_ENDPOINT_COOLDOWN_MINUTE_FIELDS = ["quotaRestMinutes", "restCapMinutes"] as const;
export type ApiEndpointCooldownMinuteField = (typeof API_ENDPOINT_COOLDOWN_MINUTE_FIELDS)[number];

/** 一项不在范围里：不是 0 到八天的整数分钟。 */
export interface CooldownSettingsProblem {
  field: ApiEndpointCooldownMinuteField;
}

/** 分钟数能不能存：0（用中转站自己的）到八天的整数（magpie SetQuotaRest、SetRestCap）。 */
export function isCooldownMinutes(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= API_ENDPOINT_COOLDOWN_MAX_MINUTES;
}

/** 按 quotaRestMinutes、restCapMinutes 的顺序，第一项不在范围里的；都对为 null。 */
export function cooldownSettingsProblem(settings: {
  quotaRestMinutes?: number;
  restCapMinutes?: number;
}): CooldownSettingsProblem | null {
  for (const field of API_ENDPOINT_COOLDOWN_MINUTE_FIELDS) {
    const value = settings[field];
    if (value !== undefined && !isCooldownMinutes(value)) return { field };
  }
  return null;
}
