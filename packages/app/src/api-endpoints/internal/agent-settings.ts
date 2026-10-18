import type {
  ApiEndpoint,
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

/** 提示区一条可以做的处理：重新应用、切回官方、保留当前设置，以及打开、关掉「保留 claude.ai 登录」。 */
export type AgentIssueAction =
  | "reapply"
  | "switchToOfficial"
  | "keepCurrent"
  | "keepClaudeAiLogin"
  | "stopKeepingClaudeAiLogin";

export type AgentIssueKind =
  | "notThroughGateway"
  | "configUnparsable"
  | "codexProfileOverride"
  | "settingsHasComments"
  // 云平台开关开着：params.source 说写在哪（managed、settings、global_config、shell）。
  | "cloudSwitchOn"
  // 托管设置的 ANTHROPIC_BASE_URL 不指向中转站。
  | "managedBaseUrl"
  // 保留 claude.ai 登录开着，口令却被填回去。
  | "claudeAiLoginTokenSet"
  // 保留 claude.ai 登录关着，口令却是空的或没了（params.how：empty / missing）。
  | "claudeAiLoginTokenEmpty"
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
  claude_ai_login_token_set: "claudeAiLoginTokenSet",
  claude_ai_login_token_empty: "claudeAiLoginTokenEmpty",
};

const ISSUE_ACTIONS: Record<AgentIssueKind, AgentIssueAction[]> = {
  notThroughGateway: ["reapply", "switchToOfficial", "keepCurrent"],
  configUnparsable: [],
  codexProfileOverride: [],
  settingsHasComments: [],
  // 写在 Osuna 改不了的地方：重新应用没用，只能切回官方或保留当前设置。
  cloudSwitchOn: ["switchToOfficial", "keepCurrent"],
  managedBaseUrl: ["switchToOfficial", "keepCurrent"],
  // 照 magpie 的两种不一致：按选项把口令写回该有的样子，或者改选项迁就文件。
  claudeAiLoginTokenSet: ["reapply", "stopKeepingClaudeAiLogin"],
  claudeAiLoginTokenEmpty: ["keepClaudeAiLogin", "reapply"],
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

/**
 * 默认模型的一个选项（ADR 0012）：光秃秃的模型名（endpointName 为 null，哪家提供都行），
 * 或「接口标识/模型名」（指定这一家，显示成「模型名（接口名）」）。
 */
export interface DefaultModelOption {
  id: string;
  model: string;
  endpointName: string | null;
}

export interface AgentApiEndpointsView {
  enabled: boolean;
  // 总开关关着时打不开的原因；开着时总能关，恒为 null。
  enableBlockedBy: AgentSwitchBlock | null;
  defaultModelId: string | null;
  // 当前默认模型的显示；对不上任何选项时照原样（endpointName 为 null）。
  defaultModel: DefaultModelOption | null;
  // 先是开着的接口的已选模型，按创建顺序合并去重的光秃秃名字；主机给了接口标识时再接上每家的「接口标识/模型名」。
  modelOptions: DefaultModelOption[];
  summary: AgentEndpointsSummary;
  // 提示区，按主机给的顺序。
  issues: AgentIssueView[];
  // 「保留 claude.ai 登录」开着没有（ADR 0012）；只有 Claude Code 有这个选项，别的 Agent 为 null。
  keepsClaudeAiLogin: boolean | null;
}

export function selectAgentApiEndpointsView(input: {
  state: Extract<HostEndpointsLoadState, { status: "ready" }>;
  provider: string;
  now: Date;
}): AgentApiEndpointsView {
  const { state, provider, now } = input;
  const agent = state.agents[provider] ?? { enabled: false, defaultModelId: null };
  const enabledEndpoints = state.endpoints.filter((endpoint) => endpoint.enabled !== false);
  const modelOptions = defaultModelOptions(enabledEndpoints);

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

  // 只有 Claude Code 有「保留 claude.ai 登录」。
  let keepsClaudeAiLogin: boolean | null = null;
  if (provider === "claude") keepsClaudeAiLogin = agent.keepsClaudeAiLogin === true;

  return {
    enabled: agent.enabled,
    enableBlockedBy,
    defaultModelId: agent.defaultModelId,
    defaultModel: displayedDefaultModel(modelOptions, agent.defaultModelId),
    modelOptions,
    summary: { enabledCount: enabledEndpoints.length, cooling },
    issues: (state.agentIssues[provider] ?? []).map(toIssueView),
    keepsClaudeAiLogin,
  };
}

/** 光秃秃的名字在前（按创建顺序去重），再是每家的「接口标识/模型名」；老主机不给接口标识就只有前一种。 */
function defaultModelOptions(enabledEndpoints: ApiEndpoint[]): DefaultModelOption[] {
  const options: DefaultModelOption[] = [];
  const ids = new Set<string>();
  const add = (option: DefaultModelOption) => {
    if (ids.has(option.id)) return;
    ids.add(option.id);
    options.push(option);
  };
  for (const endpoint of enabledEndpoints) {
    for (const model of endpoint.models) add({ id: model.id, model: model.id, endpointName: null });
  }
  for (const endpoint of enabledEndpoints) {
    if (!endpoint.slug) continue;
    for (const model of endpoint.models) {
      add({ id: `${endpoint.slug}/${model.id}`, model: model.id, endpointName: endpoint.name });
    }
  }
  return options;
}

function displayedDefaultModel(
  options: DefaultModelOption[],
  id: string | null,
): DefaultModelOption | null {
  if (id === null) return null;
  return options.find((option) => option.id === id) ?? { id, model: id, endpointName: null };
}
