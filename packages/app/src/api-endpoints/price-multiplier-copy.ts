import type { TFunction } from "i18next";
import { API_ENDPOINT_PRICE_MULTIPLIER_MAX } from "@getpaseo/protocol/api-endpoint/price-multiplier";
import type { ApiEndpointError } from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/** 价格倍率不对，按界面语言说（表单当场提示与 daemon 拒收保存都用）。 */
export function priceMultiplierProblemText(t: TFunction): string {
  return t("settings.apiEndpoints.form.extras.priceMultiplier.problem", {
    max: API_ENDPOINT_PRICE_MULTIPLIER_MAX,
  });
}

/** daemon 拒收保存的 invalid_price_multiplier 按界面语言说；别的错误为 null。 */
export function priceMultiplierErrorText(t: TFunction, error: ApiEndpointError): string | null {
  return error.code === "invalid_price_multiplier" ? priceMultiplierProblemText(t) : null;
}
