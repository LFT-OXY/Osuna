import type {
  ApiEndpoint,
  ApiEndpointError,
  ApiEndpointListResponse,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";

type ListPayload = ApiEndpointListResponse["payload"];

export type ApiEndpointsLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; endpoints: ApiEndpoint[]; activeEndpointId: string | null };

/** 数据优先于错误：后台刷新失败时保留已有列表，而不是换成错误行。 */
export function selectApiEndpointsState(input: {
  data: ListPayload | undefined;
  error: Error | null;
}): ApiEndpointsLoadState {
  if (input.data && input.data.error === null) {
    return {
      status: "ready",
      endpoints: input.data.endpoints,
      activeEndpointId: input.data.activeEndpointId,
    };
  }
  if (input.data?.error) {
    return { status: "error", message: input.data.error.message };
  }
  if (input.error) {
    return { status: "error", message: input.error.message };
  }
  return { status: "loading" };
}

/** 已知错误码给本地化文案的 key；未知错误码显示 daemon 原文。 */
export function apiEndpointErrorMessageKey(error: ApiEndpointError): string | null {
  if (error.code === "config_unparsable") {
    return "settings.providers.apiEndpoints.configUnparsable";
  }
  if (error.code === "codex_version_unsupported") {
    return "settings.providers.apiEndpoints.codexVersionUnsupported";
  }
  if (error.code === "models_unsupported") {
    return "settings.providers.apiEndpoints.form.modelsUnsupported";
  }
  if (error.code === "upstream_timeout") {
    return "settings.providers.apiEndpoints.form.fetchTimeout";
  }
  if (error.code === "protocol_unsupported") {
    return "settings.providers.apiEndpoints.form.testProtocolUnsupported";
  }
  return null;
}

/** 测试耗时：一秒以内按毫秒，否则按秒保留一位小数。单位不翻译。 */
export function formatApiEndpointTestDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}
