import type { TFunction } from "i18next";
import type {
  ApiEndpointError,
  ApiEndpointImportLinkRefusal,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { importLinkRefusalOf } from "./internal/import-link";

/*
 * 导入链接的失败与拒收按界面语言说：主机只给 code 与 params，从不照搬主机的英文。
 */

/** 主机拒收导入链接的原因与参数（params 只有参数名、模板与区域）。 */
export interface ImportLinkRefusalCopy {
  reason: ApiEndpointImportLinkRefusal | "unknown";
  params: Record<string, string>;
}

/** 链接里给地址的参数，按确认框里「地址」一栏的叫法说（chat 是 OpenAI Chat）。 */
function fieldLabel(t: TFunction, field: string | undefined): string {
  switch (field) {
    case "anthropic":
      return t("settings.apiEndpoints.formats.anthropic_messages");
    case "chat":
      return t("settings.apiEndpoints.formats.openai_chat");
    case "responses":
      return t("settings.apiEndpoints.formats.openai_responses");
    case "gemini":
      return "Gemini";
    default:
      return field ?? "";
  }
}

export function importLinkRefusalText(t: TFunction, refusal: ImportLinkRefusalCopy): string {
  const { params } = refusal;
  const field = fieldLabel(t, params.field);
  return t(`settings.apiEndpoints.importLink.refusals.${refusal.reason}`, {
    field,
    template: params.template ?? "",
    region: params.region ?? "",
  });
}

/** 主机说的失败（添加时、读链接时）：拒收说为什么，别的按 code 说。 */
export function importLinkErrorText(t: TFunction, error: ApiEndpointError): string {
  const reason = importLinkRefusalOf(error);
  if (reason !== null) {
    const text = importLinkRefusalText(t, { reason, params: error.params ?? {} });
    return t("settings.apiEndpoints.importLink.refusedShort", { reason: text });
  }
  if (error.code === "endpoints_unparsable") {
    return t("settings.apiEndpoints.importLink.endpointsUnparsable");
  }
  return t("settings.apiEndpoints.importLink.failed");
}
