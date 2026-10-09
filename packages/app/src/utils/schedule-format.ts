import type { ScheduleCadence, ScheduleSummary } from "@osuna/protocol/schedule/types";
import { validateCronExpression } from "@osuna/protocol/schedule/cron-expression";
import type { TFunction } from "i18next";

export type IntervalUnit = "minutes" | "hours" | "days";
type CronCadence = Extract<ScheduleCadence, { type: "cron" }>;

/**
 * 面向用户的计划文案不在这里拼英文，而是返回「翻译键 + 参数」，由组件层用
 * 当前语言渲染；`{ text }` 表示无需翻译的原文（如原始 cron 表达式、agent 标题）。
 * 参数里可以再嵌套描述（如「每周 {{day}} 09:00」里的 day），渲染时递归展开。
 */
export type ScheduleDescription =
  | { key: string; params?: Record<string, string | number | ScheduleDescription> }
  | { text: string };

export type ScheduleProduct = "heartbeat" | "schedule";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = MS_PER_MINUTE * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

const UNIT_MS: Record<IntervalUnit, number> = {
  minutes: MS_PER_MINUTE,
  hours: MS_PER_HOUR,
  days: MS_PER_DAY,
};

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export function renderScheduleDescription(t: TFunction, description: ScheduleDescription): string {
  if ("text" in description) {
    return description.text;
  }
  const params = description.params
    ? Object.fromEntries(
        Object.entries(description.params).map(([name, value]) => [
          name,
          typeof value === "object" ? renderScheduleDescription(t, value) : value,
        ]),
      )
    : undefined;
  return t(description.key, params);
}

export function isNewAgentSchedule(schedule: ScheduleSummary): boolean {
  return schedule.target.type === "new-agent";
}

export function scheduleProductName(schedule: ScheduleSummary): ScheduleProduct {
  return schedule.target.type === "agent" ? "heartbeat" : "schedule";
}

/** 依次取名称、配置标题、提示词首行；都没有时返回 null，由 resolveScheduleDisplayTitle 给本地化回退。 */
export function resolveScheduleTitle(schedule: ScheduleSummary): string | null {
  const name = schedule.name?.trim();
  if (name) {
    return name;
  }
  if (schedule.target.type === "new-agent") {
    const configTitle = schedule.target.config.title?.trim();
    if (configTitle) {
      return configTitle;
    }
  }
  const firstPromptLine = schedule.prompt
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstPromptLine || null;
}

export function resolveScheduleDisplayTitle(t: TFunction, schedule: ScheduleSummary): string {
  return (
    resolveScheduleTitle(schedule) ?? t(`schedules.row.untitled.${scheduleProductName(schedule)}`)
  );
}

export function everyMsToParts(ms: number): { value: number; unit: IntervalUnit } {
  if (!Number.isFinite(ms) || ms <= 0) {
    return { value: 1, unit: "hours" };
  }
  if (ms % MS_PER_DAY === 0) {
    return { value: ms / MS_PER_DAY, unit: "days" };
  }
  if (ms % MS_PER_HOUR === 0) {
    return { value: ms / MS_PER_HOUR, unit: "hours" };
  }
  return { value: Math.max(1, Math.round(ms / MS_PER_MINUTE)), unit: "minutes" };
}

export function partsToEveryMs(value: number, unit: IntervalUnit): number {
  const normalized = Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
  return normalized * UNIT_MS[unit];
}

// 单复数拆成独立键并带 count 参数（与 modelCountPlural 做法一致），不用 i18next 复数后缀。
const INTERVAL_KEYS: Record<IntervalUnit, { one: string; many: string }> = {
  minutes: {
    one: "schedules.cadence.interval.minuteOne",
    many: "schedules.cadence.interval.minuteMany",
  },
  hours: {
    one: "schedules.cadence.interval.hourOne",
    many: "schedules.cadence.interval.hourMany",
  },
  days: { one: "schedules.cadence.interval.dayOne", many: "schedules.cadence.interval.dayMany" },
};

function formatEvery(everyMs: number): ScheduleDescription {
  const { value, unit } = everyMsToParts(everyMs);
  const keys = INTERVAL_KEYS[unit];
  return { key: value === 1 ? keys.one : keys.many, params: { count: value } };
}

export function formatCadence(cadence: ScheduleCadence): ScheduleDescription {
  if (cadence.type === "every") {
    return formatEvery(cadence.everyMs);
  }
  return describeCron(cadence) ?? { text: cadence.expression };
}

/** 只把常见的几种 5 段 cron 形态转成可读描述；合法但不认识的形态返回 null，调用方回退到原始表达式。 */
export function describeCron(cadence: CronCadence): ScheduleDescription | null {
  const trimmed = cadence.expression.trim();
  if (validateCron(trimmed) !== null) {
    return null;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = trimmed.split(/\s+/);

  // 只处理「固定时间」这一族：分钟/小时为字面量，日期字段要么通配、要么是认识的星期约束。
  const minuteNum = Number.parseInt(minute, 10);
  const isLiteralMinute = /^\d+$/.test(minute);
  const isWildcardMonth = month === "*";
  const isWildcardDom = dayOfMonth === "*";

  if (minute === "*" && hour === "*" && isWildcardMonth && isWildcardDom && dayOfWeek === "*") {
    return { key: "schedules.cadence.everyMinute" };
  }

  if (!isLiteralMinute || !isWildcardMonth || !isWildcardDom) {
    return null;
  }

  // 「每小时」/「每小时 :MM」
  if (hour === "*") {
    if (dayOfWeek !== "*") {
      return null;
    }
    return minuteNum === 0
      ? { key: "schedules.cadence.everyHour" }
      : { key: "schedules.cadence.everyHourAt", params: { minute: pad2(minuteNum) } };
  }

  if (!/^\d+$/.test(hour)) {
    return null;
  }
  const time = `${pad2(Number.parseInt(hour, 10))}:${pad2(minuteNum)}`;
  const timezone = cadence.timezone ?? "UTC";
  const day = describeCronDay(dayOfWeek);
  return day ? { key: "schedules.cadence.atTime", params: { day, time, timezone } } : null;
}

function describeCronDay(dayOfWeek: string): ScheduleDescription | null {
  if (dayOfWeek === "*") {
    return { key: "schedules.cadence.daily" };
  }
  if (dayOfWeek === "1-5") {
    return { key: "schedules.cadence.weekdays" };
  }
  if (dayOfWeek === "0,6" || dayOfWeek === "6,0") {
    return { key: "schedules.cadence.weekends" };
  }
  if (/^\d$/.test(dayOfWeek)) {
    const day = DAY_KEYS[Number.parseInt(dayOfWeek, 10)];
    return day ? { key: `schedules.cadence.days.${day}` } : null;
  }
  return null;
}

/** 合法时返回 null；空输入是独立键，解析库的英文原因作为参数交给本地化外壳。 */
export function validateCron(expr: string): ScheduleDescription | null {
  const trimmed = expr.trim();
  if (!trimmed) {
    return { key: "schedules.cadence.errors.empty" };
  }

  const error = validateCronExpression(trimmed);
  if (!error) {
    return null;
  }
  return {
    key: "schedules.cadence.errors.invalid",
    params: { detail: error.replace(/^Invalid cron /, "Invalid ") },
  };
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 下次运行的相对时间描述（即将 / N 分钟后 / N 小时后 / N 天后）；没有下次运行时返回 null。 */
export function formatNextRun(iso: string | null): ScheduleDescription | null {
  if (!iso) {
    return null;
  }
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) {
    return null;
  }

  const diffMs = target - Date.now();
  if (diffMs < MS_PER_MINUTE) {
    return { key: "schedules.row.nextRunIn.soon" };
  }
  if (diffMs < MS_PER_HOUR) {
    return {
      key: "schedules.row.nextRunIn.minutes",
      params: { count: Math.round(diffMs / MS_PER_MINUTE) },
    };
  }
  if (diffMs < MS_PER_DAY) {
    return {
      key: "schedules.row.nextRunIn.hours",
      params: { count: Math.round(diffMs / MS_PER_HOUR) },
    };
  }
  return {
    key: "schedules.row.nextRunIn.days",
    params: { count: Math.round(diffMs / MS_PER_DAY) },
  };
}
