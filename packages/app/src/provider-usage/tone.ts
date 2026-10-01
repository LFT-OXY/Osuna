import type { Theme } from "@/styles/theme";
import type { ProviderUsageTone } from "./types";

/** tone 用哪个主题色：卡片进度条和窄栏圆环共用这张表。 */
export const TONE_COLOR_TOKEN = {
  ok: "statusSuccess",
  warning: "statusWarning",
  danger: "statusDanger",
  default: "foregroundMuted",
} as const satisfies Record<ProviderUsageTone, keyof Theme["colors"]>;

export function deriveTone(usedPct: number | null | undefined): ProviderUsageTone {
  if (usedPct == null) return "default";
  if (usedPct > 90) return "danger";
  if (usedPct >= 70) return "warning";
  return "default";
}
