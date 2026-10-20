import type { TFunction } from "i18next";
import type {
  ApiEndpointError,
  ApiEndpointTestConnectionResult,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { HeaderProblem } from "@getpaseo/protocol/api-endpoint/request-extras";
import type { ExtraBodyTextProblem } from "./internal/request-extras-form";

/** 请求头、附加请求体哪里不对，按界面语言说（表单当场提示与 daemon 拒收保存都用）。 */
export function headerProblemText(t: TFunction, problem: HeaderProblem): string {
  if (problem.reason === "name") {
    return t("settings.apiEndpoints.form.extras.headerBadName", { name: problem.name });
  }
  return t("settings.apiEndpoints.form.extras.headerBadValue", { name: problem.name });
}

export function extraBodyProblemText(t: TFunction, problem: ExtraBodyTextProblem): string {
  switch (problem.reason) {
    case "notJson":
      return t("settings.apiEndpoints.form.extras.extraBodyProblems.notJson");
    case "notObject":
      return t("settings.apiEndpoints.form.extras.extraBodyProblems.notObject");
    case "unnamed":
      return t("settings.apiEndpoints.form.extras.extraBodyProblems.unnamed");
    case "reserved":
      return t("settings.apiEndpoints.form.extras.extraBodyProblems.reserved", {
        field: problem.field,
      });
    case "duplicate":
      return t("settings.apiEndpoints.form.extras.extraBodyProblems.duplicate", {
        field: problem.field,
      });
  }
}

/** daemon 拒收保存的 invalid_header、invalid_extra_body、insecure_tls_template 按界面语言说；别的错误为 null。 */
export function requestExtrasErrorText(t: TFunction, error: ApiEndpointError): string | null {
  if (error.code === "insecure_tls_template") {
    return t("settings.apiEndpoints.form.insecureTls.templateRefused");
  }
  const params = error.params ?? {};
  const name = params.name ?? "";
  const field = params.field ?? "";
  if (error.code === "invalid_header") {
    const reason = params.reason === "value" ? "value" : "name";
    return headerProblemText(t, { reason, name });
  }
  if (error.code !== "invalid_extra_body") return null;
  if (params.reason === "reserved") return extraBodyProblemText(t, { reason: "reserved", field });
  if (params.reason === "duplicate") return extraBodyProblemText(t, { reason: "duplicate", field });
  return extraBodyProblemText(t, { reason: "unnamed" });
}

/** 测试连接的结论里 daemon 说「请求头发不出去」的，原因换成界面语言；别的照原样。 */
export function localizedTestResult(
  t: TFunction,
  result: ApiEndpointTestConnectionResult,
): ApiEndpointTestConnectionResult {
  const { error } = result;
  if (error === null) return result;
  const localized = requestExtrasErrorText(t, error);
  if (localized === null) return result;
  return { ...result, error: { ...error, message: localized } };
}
