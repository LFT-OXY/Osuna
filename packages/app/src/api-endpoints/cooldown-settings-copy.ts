import type { TFunction } from "i18next";
import {
  API_ENDPOINT_COOLDOWN_MAX_DAYS,
  API_ENDPOINT_COOLDOWN_MAX_MINUTES,
  type CooldownSettingsProblem,
} from "@getpaseo/protocol/api-endpoint/cooldown-settings";
import type { ApiEndpointError } from "@getpaseo/protocol/api-endpoint/rpc-schemas";

const KEY = "settings.apiEndpoints.form.extras.cooldown";

/** 冷却设置哪一项不对，按界面语言说（表单当场提示与 daemon 拒收保存都用）。 */
export function cooldownProblemText(t: TFunction, problem: CooldownSettingsProblem): string {
  if (problem.field === "quotaResetAt") return t(`${KEY}.timeProblem`);
  return t(`${KEY}.problem`, {
    max: API_ENDPOINT_COOLDOWN_MAX_MINUTES,
    days: API_ENDPOINT_COOLDOWN_MAX_DAYS,
  });
}

/** daemon 拒收保存的 invalid_cooldown_settings 按界面语言说；别的错误为 null。 */
export function cooldownSettingsErrorText(t: TFunction, error: ApiEndpointError): string | null {
  if (error.code !== "invalid_cooldown_settings") return null;
  const field = error.params?.field === "quotaResetAt" ? "quotaResetAt" : "quotaRestMinutes";
  return cooldownProblemText(t, { field });
}
