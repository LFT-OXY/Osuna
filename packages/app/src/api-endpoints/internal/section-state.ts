import type {
  ApiEndpoint,
  ApiEndpointError,
  ApiEndpointHealthIssue,
  ApiEndpointListResponse,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";

type ListPayload = ApiEndpointListResponse["payload"];

export type ApiEndpointsLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      endpoints: ApiEndpoint[];
      activeEndpointId: string | null;
      health: ApiEndpointHealthIssue[];
      cliBaseUrl: string | null;
      // 该提供方下还活着的会话数；主机没给时为 null，确认框里就不写数字。
      runningSessionCount: number | null;
    };

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
      // 协议规定新字段可选，读取时补上「没有问题」「没有指向」的默认值；不是可删除的兼容分支。
      health: input.data.health ?? [],
      cliBaseUrl: input.data.cliBaseUrl ?? null,
      runningSessionCount: input.data.runningSessionCount ?? null,
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
  if (error.code === "config_conflict") {
    return "settings.providers.apiEndpoints.configConflict";
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

const HEALTH_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  modified_externally: "settings.providers.apiEndpoints.health.modifiedExternally",
  config_unparsable: "settings.providers.apiEndpoints.health.unparsable",
  codex_version_unsupported: "settings.providers.apiEndpoints.codexVersionUnsupported",
  codex_profile_override: "settings.providers.apiEndpoints.health.codexProfileOverride",
};

/** 健康问题的本地化文案 key；未知的问题显示 daemon 原文。 */
export function apiEndpointHealthMessageKey(issue: ApiEndpointHealthIssue): string | null {
  return HEALTH_MESSAGE_KEYS[issue.code] ?? null;
}

// 只可能让切换不生效、CLI 本身还能用的问题；其余（含未知的）按出错处理。
const WARNING_ONLY_CODES: ReadonlySet<string> = new Set(["codex_profile_override"]);

export interface ApiEndpointHealthAlert {
  variant: "error" | "warning";
  // 「已被外部修改」排在最前。
  issues: ApiEndpointHealthIssue[];
  // 「已被外部修改」且有启用中的接口时给出：可以「重新应用」它，或「切回官方」。
  activeEndpoint: ApiEndpoint | null;
}

export interface ApiEndpointHealthView {
  // 模式区只放一个 Alert，所有问题都在里面。
  alert: ApiEndpointHealthAlert | null;
  // 官方模式下 CLI 自身配置指向的地址。
  officialTarget: string | null;
}

export function selectApiEndpointHealthView(state: ApiEndpointsLoadState): ApiEndpointHealthView {
  if (state.status !== "ready") return { alert: null, officialTarget: null };
  const officialTarget = state.activeEndpointId === null ? state.cliBaseUrl : null;
  if (state.health.length === 0) return { alert: null, officialTarget };

  const isModified = (issue: ApiEndpointHealthIssue) => issue.code === "modified_externally";
  const issues = [
    ...state.health.filter(isModified),
    ...state.health.filter((i) => !isModified(i)),
  ];
  const onlyWarnings = issues.every((issue) => WARNING_ONLY_CODES.has(issue.code));
  const active = state.endpoints.find((endpoint) => endpoint.id === state.activeEndpointId);
  const canReapply = active !== undefined && issues.some(isModified);
  const alert: ApiEndpointHealthAlert = {
    variant: onlyWarnings ? "warning" : "error",
    issues,
    activeEndpoint: canReapply ? active : null,
  };
  return { alert, officialTarget };
}

/**
 * 保存或删除的是当前启用的接口：会立即改写 CLI 配置，和切换一样先确认、写明影响；
 * 其余保存和删除只动 Osuna 自己的记录。
 */
export function isActiveApiEndpoint(
  state: ApiEndpointsLoadState,
  endpointId: string | undefined,
): boolean {
  return (
    state.status === "ready" && endpointId !== undefined && state.activeEndpointId === endpointId
  );
}

export interface ApiEndpointTranslation {
  key: string;
  count?: number;
}

// Claude Code 会把 settings.json 的 env 改动重新应用到正在运行的会话上；
// Codex 是否立即生效以它的实际行为为准，其余提供方同样按「可能受影响」措辞。
const IMMEDIATE_SWITCH_PROVIDERS: ReadonlySet<string> = new Set(["claude"]);

/** 切换类确认框的影响说明：受影响的会话数，以及终端里的 CLI 也会切换。 */
export function selectApiEndpointImpact(input: {
  provider: string;
  runningSessionCount: number | null;
}): ApiEndpointTranslation[] {
  const terminal = { key: "settings.providers.apiEndpoints.impact.terminal" };
  const count = input.runningSessionCount;
  if (count === null) return [terminal];
  if (count === 0) return [{ key: "settings.providers.apiEndpoints.impact.noSessions" }, terminal];
  const key = IMMEDIATE_SWITCH_PROVIDERS.has(input.provider)
    ? "settings.providers.apiEndpoints.impact.sessions"
    : "settings.providers.apiEndpoints.impact.sessionsMaybe";
  return [{ key, count }, terminal];
}

/** 测试耗时：一秒以内按毫秒，否则按秒保留一位小数。单位不翻译。 */
export function formatApiEndpointTestDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}
