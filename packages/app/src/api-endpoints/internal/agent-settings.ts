import type {
  ApiEndpointAgentIssue,
  ApiEndpointHealthIssue,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  endpointRowStatus,
  type CooldownRemaining,
  type HostEndpointsLoadState,
} from "./host-list";

/*
 * Claude Code / Codex 提供方页「第三方接口」区的纯计算：总开关能不能打开、默认模型的候选、
 * 「管理第三方接口」入口行的汇总、提示区的「设置被改过」。规则与 daemon 一致（R-A2、R-B6、ADR 0012）。
 */

export type AgentSwitchBlock =
  | { kind: "noUsableEndpoint" }
  | { kind: "gateway"; issue: ApiEndpointHealthIssue };

export interface AgentEndpointsSummary {
  enabledCount: number;
  // 开着的接口里最早恢复的那家冷却中的。
  cooling: { name: string; remaining: CooldownRemaining } | null;
}

/** 提示区一条可以做的处理：重新应用、切回官方、保留当前设置。 */
export type AgentIssueAction = "reapply" | "switchToOfficial" | "keepCurrent";

export type AgentIssueKind =
  | "notThroughGateway"
  | "configUnparsable"
  | "codexProfileOverride"
  | "settingsHasComments"
  // 云平台开关开着：params.source 说写在哪（managed、settings、global_config、shell）。
  | "cloudSwitchOn"
  // 托管设置的 ANTHROPIC_BASE_URL 不指向中转站。
  | "managedBaseUrl"
  // 认不出的 code：照主机给的英文原文显示，不给按钮。
  | "unknown";

export interface AgentIssueView {
  kind: AgentIssueKind;
  // 翻译用的参数（file、keys、detail、profile）。
  params: Record<string, string>;
  message: string;
  actions: AgentIssueAction[];
  // 带「如何修复」：点开看修复步骤，不发请求。
  hasFixSteps: boolean;
}

const ISSUE_KINDS: Record<string, Exclude<AgentIssueKind, "unknown">> = {
  not_through_gateway: "notThroughGateway",
  config_unparsable: "configUnparsable",
  codex_profile_override: "codexProfileOverride",
  settings_has_comments: "settingsHasComments",
  cloud_switch_on: "cloudSwitchOn",
  managed_base_url: "managedBaseUrl",
};

const ISSUE_ACTIONS: Record<AgentIssueKind, AgentIssueAction[]> = {
  notThroughGateway: ["reapply", "switchToOfficial", "keepCurrent"],
  configUnparsable: [],
  codexProfileOverride: [],
  settingsHasComments: [],
  // 写在 Osuna 改不了的地方：重新应用没用，只能切回官方或保留当前设置。
  cloudSwitchOn: ["switchToOfficial", "keepCurrent"],
  managedBaseUrl: ["switchToOfficial", "keepCurrent"],
  unknown: [],
};

const KINDS_WITH_FIX_STEPS: ReadonlySet<AgentIssueKind> = new Set([
  "settingsHasComments",
  "cloudSwitchOn",
  "managedBaseUrl",
]);

function toIssueView(issue: ApiEndpointAgentIssue): AgentIssueView {
  const kind = ISSUE_KINDS[issue.code] ?? "unknown";
  const params = issue.params ?? {};
  // 开关又写回了 Osuna 管的 settings.json：重新应用会再拿掉它，和「不再经过中转站」一样处理。
  const isCloudSwitchInSettings = kind === "cloudSwitchOn" && params.source === "settings";
  return {
    kind,
    params,
    message: issue.message,
    actions: isCloudSwitchInSettings ? ISSUE_ACTIONS.notThroughGateway : ISSUE_ACTIONS[kind],
    hasFixSteps: KINDS_WITH_FIX_STEPS.has(kind) && !isCloudSwitchInSettings,
  };
}

export interface AgentApiEndpointsView {
  enabled: boolean;
  // 总开关关着时打不开的原因；开着时总能关，恒为 null。
  enableBlockedBy: AgentSwitchBlock | null;
  defaultModelId: string | null;
  // 开着的接口的已选模型，按创建顺序合并去重的光秃秃模型名。
  modelOptions: string[];
  summary: AgentEndpointsSummary;
  // 提示区，按主机给的顺序。
  issues: AgentIssueView[];
}

export function selectAgentApiEndpointsView(input: {
  state: Extract<HostEndpointsLoadState, { status: "ready" }>;
  provider: string;
  now: Date;
}): AgentApiEndpointsView {
  const { state, provider, now } = input;
  const agent = state.agents[provider] ?? { enabled: false, defaultModelId: null };
  const enabledEndpoints = state.endpoints.filter((endpoint) => endpoint.enabled !== false);
  const modelOptions: string[] = [];
  for (const endpoint of enabledEndpoints) {
    for (const model of endpoint.models) {
      if (!modelOptions.includes(model.id)) modelOptions.push(model.id);
    }
  }

  let enableBlockedBy: AgentSwitchBlock | null = null;
  if (!agent.enabled) {
    if (state.gatewayUnavailable) {
      enableBlockedBy = { kind: "gateway", issue: state.gatewayUnavailable };
    } else if (modelOptions.length === 0) {
      enableBlockedBy = { kind: "noUsableEndpoint" };
    }
  }

  let cooling: AgentEndpointsSummary["cooling"] = null;
  let coolingUntil = Number.POSITIVE_INFINITY;
  for (const endpoint of enabledEndpoints) {
    const status = endpointRowStatus(endpoint, now);
    const until = Date.parse(endpoint.cooldown?.until ?? "");
    if (status.kind === "cooling" && until < coolingUntil) {
      coolingUntil = until;
      cooling = { name: endpoint.name, remaining: status.remaining };
    }
  }

  return {
    enabled: agent.enabled,
    enableBlockedBy,
    defaultModelId: agent.defaultModelId,
    modelOptions,
    summary: { enabledCount: enabledEndpoints.length, cooling },
    issues: (state.agentIssues[provider] ?? []).map(toIssueView),
  };
}
