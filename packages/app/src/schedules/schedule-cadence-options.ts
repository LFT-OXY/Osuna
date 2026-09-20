import type { ScheduleCadence } from "@getpaseo/protocol/schedule/types";
import { everyMsToParts } from "@/utils/schedule-format";

type CronCadence = Extract<ScheduleCadence, { type: "cron" }>;

export interface CadencePresetOption {
  id: string;
  /** 预设文案的翻译键，由选择器用 t() 渲染。 */
  labelKey: string;
  expression: string;
}

export const CUSTOM_CRON_PRESET_ID = "custom";
const CUSTOM_CRON_LABEL_KEY = "schedules.cadence.presets.custom";

export const CADENCE_PRESET_OPTIONS: CadencePresetOption[] = [
  {
    id: "every-minute",
    labelKey: "schedules.cadence.presets.everyMinute",
    expression: "* * * * *",
  },
  { id: "every-hour", labelKey: "schedules.cadence.presets.everyHour", expression: "0 * * * *" },
  { id: "daily-9", labelKey: "schedules.cadence.presets.daily9", expression: "0 9 * * *" },
  {
    id: "weekdays-9",
    labelKey: "schedules.cadence.presets.weekdays9",
    expression: "0 9 * * 1-5",
  },
  { id: "mondays-9", labelKey: "schedules.cadence.presets.mondays9", expression: "0 9 * * 1" },
];

export function resolveCronPresetId(cadence: CronCadence): string {
  const expression = cadence.expression.trim();
  return (
    CADENCE_PRESET_OPTIONS.find((option) => option.expression === expression)?.id ??
    CUSTOM_CRON_PRESET_ID
  );
}

export function resolveCronPresetDisplay(cadence: CronCadence): { labelKey: string } {
  return {
    labelKey:
      CADENCE_PRESET_OPTIONS.find((option) => option.id === resolveCronPresetId(cadence))
        ?.labelKey ?? CUSTOM_CRON_LABEL_KEY,
  };
}

export function normalizeScheduleFormCadence(
  cadence: ScheduleCadence,
  timezone: string,
): CronCadence {
  if (cadence.type === "cron") {
    return { ...cadence, timezone: cadence.timezone ?? timezone };
  }

  return {
    type: "cron",
    expression: everyMsToCronExpression(cadence.everyMs),
    timezone,
  };
}

function everyMsToCronExpression(everyMs: number): string {
  const { value, unit } = everyMsToParts(everyMs);
  if (unit === "minutes") {
    return value === 1 ? "* * * * *" : `*/${Math.min(value, 59)} * * * *`;
  }
  if (unit === "hours") {
    return value === 1 ? "0 * * * *" : `0 */${Math.min(value, 23)} * * *`;
  }
  return value === 1 ? "0 9 * * *" : `0 9 */${Math.min(value, 31)} * *`;
}
