// 每家的冷却设置（额度用完后冷却多久或冷却到每天几点、冷却最长多久、原因不明的失败不冷却）与它们的范围、时刻的读法移植自 magpie
// （https://github.com/yetone/magpie，internal/provider/provider.go 的 QuotaRest、QuotaResetAt、RestCap，
// internal/provider/concurrency.go 的 MaxQuotaRest、QuotaRestFor、ParseResetAt、NextResetAt、OwnQuotaRest、RestCapOff、
// RestCapOr、SetQuotaRest、SetQuotaResetAt、SetRestCap）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

/*
 * 冷却设置（Cooldown settings）：中转站算这家冷却时用它，没设的项用中转站自己的时长。
 * daemon 保存时拿它校验、中转站拿它取值；app 在表单里拿它当场提示、显示缺省值。
 */

/** 冷却最多八天：一周的窗口再多一天（magpie MaxQuotaRest）。 */
export const API_ENDPOINT_COOLDOWN_MAX_DAYS = 8;
/** 两个分钟数的上限。 */
export const API_ENDPOINT_COOLDOWN_MAX_MINUTES = API_ENDPOINT_COOLDOWN_MAX_DAYS * 24 * 60;

/** 不设时中转站自己的时长（分钟），与 daemon 的 COOLDOWN 常量一致：额度用完 15 分钟，冷却最长失败 10 分钟、限流 30 分钟。 */
export const API_ENDPOINT_COOLDOWN_DEFAULTS = {
  quotaRestMinutes: 15,
  failRestCapMinutes: 10,
  rateRestCapMinutes: 30,
} as const;

/** 冷却设置里以分钟计的两项。 */
export const API_ENDPOINT_COOLDOWN_MINUTE_FIELDS = ["quotaRestMinutes", "restCapMinutes"] as const;
export type ApiEndpointCooldownMinuteField = (typeof API_ENDPOINT_COOLDOWN_MINUTE_FIELDS)[number];

/** 校验时会报的项：两个分钟数，与「冷却到每天几点」的时刻。 */
export type ApiEndpointCooldownField = ApiEndpointCooldownMinuteField | "quotaResetAt";

/** 一项不对：分钟数不是 0 到八天的整数，或时刻读不懂。 */
export interface CooldownSettingsProblem {
  field: ApiEndpointCooldownField;
}

/** 分钟数能不能存：0（用中转站自己的）到八天的整数（magpie SetQuotaRest、SetRestCap）。 */
export function isCooldownMinutes(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= API_ENDPOINT_COOLDOWN_MAX_MINUTES;
}

/** 每天的一个时刻：几点几分，按 daemon 所在机器的时钟（offsetMinutes 为 null），或按与 UTC 固定差多少分钟。 */
export interface ResetAt {
  hour: number;
  minute: number;
  offsetMinutes: number | null;
}

/** 读时刻的结果：空的是没设，读不懂的是 invalid。 */
export type ResetAtRead = { kind: "none" } | { kind: "ok"; at: ResetAt } | { kind: "invalid" };

/** Go 的 time.Parse("-07:00", …)：带符号、两位小时、冒号、两位分钟；小时过 24、分钟过 60 不认。 */
function offsetMinutesOf(zone: string): number | null {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(zone);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 24 || minutes > 60) return null;
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}

/**
 * 照 magpie ParseResetAt 读时刻：「08:00」「8:30」按本机时钟，「00:00+08:00」按厂商的时差，「16:00Z」按 UTC；
 * 分钟两位，小时 0–23，分钟 0–59。前后空白不算。
 */
export function parseResetAt(text: string): ResetAtRead {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "none" };
  const zoneAt = trimmed.search(/[+\-Zz]/);
  const clock = zoneAt >= 0 ? trimmed.slice(0, zoneAt) : trimmed;
  const zone = zoneAt >= 0 ? trimmed.slice(zoneAt) : "";
  const match = /^(\d+):(\d{2})$/.exec(clock);
  if (!match) return { kind: "invalid" };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return { kind: "invalid" };
  if (zone === "") return { kind: "ok", at: { hour, minute, offsetMinutes: null } };
  if (zone === "Z" || zone === "z") return { kind: "ok", at: { hour, minute, offsetMinutes: 0 } };
  const offsetMinutes = offsetMinutesOf(zone);
  if (offsetMinutes === null) return { kind: "invalid" };
  return { kind: "ok", at: { hour, minute, offsetMinutes } };
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * 照 magpie NextResetAt：这个时刻在 now 之后最早的一次——今天的，今天的不晚于 now 就是明天的（毫秒）。
 * 没设或读不懂为 null。
 */
export function nextResetAt(input: { text: string; now: number }): number | null {
  const read = parseResetAt(input.text);
  if (read.kind !== "ok") return null;
  const { hour, minute, offsetMinutes } = read.at;
  if (offsetMinutes === null) {
    const today = new Date(input.now);
    const at = (dayShift: number) =>
      new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + dayShift,
        hour,
        minute,
      ).getTime();
    const todays = at(0);
    return todays > input.now ? todays : at(1);
  }
  // 按固定时差：把 now 挪到那个时区的「墙上时间」，在那里取当天的零点。
  const offsetMs = offsetMinutes * MINUTE_MS;
  const wall = input.now + offsetMs;
  const midnight = wall - (((wall % DAY_MS) + DAY_MS) % DAY_MS);
  const todays = midnight + (hour * 60 + minute) * MINUTE_MS - offsetMs;
  return todays > input.now ? todays : todays + DAY_MS;
}

/** 按 quotaRestMinutes、restCapMinutes、quotaResetAt 的顺序，第一项不对的；都对为 null。 */
export function cooldownSettingsProblem(settings: {
  quotaRestMinutes?: number;
  restCapMinutes?: number;
  quotaResetAt?: string;
}): CooldownSettingsProblem | null {
  for (const field of API_ENDPOINT_COOLDOWN_MINUTE_FIELDS) {
    const value = settings[field];
    if (value !== undefined && !isCooldownMinutes(value)) return { field };
  }
  const resetAt = settings.quotaResetAt;
  const isBadTime = resetAt !== undefined && parseResetAt(resetAt).kind === "invalid";
  if (isBadTime) return { field: "quotaResetAt" };
  return null;
}
