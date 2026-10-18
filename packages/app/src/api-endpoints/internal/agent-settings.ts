import type {
  ApiEndpoint,
  ApiEndpointAgentIssue,
  ApiEndpointAgentSettings,
  ApiEndpointHealthIssue,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { ApiEndpointModelGroup } from "@getpaseo/protocol/agent-types";
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

/**
 * 提示区一条可以做的处理：重新应用、切回官方、保留当前设置，以及打开、关掉「保留 claude.ai 登录」。
 * 「模型被换掉」的保留当前设置（keepReplacedModel）只留下 CLI 的模型、总开关照开，与关掉总开关的那个分开。
 */
export type AgentIssueAction =
  | "reapply"
  | "switchToOfficial"
  | "keepCurrent"
  | "keepReplacedModel"
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
  // CLI 自己把模型换成了哪家接口都没有的（params.model 为空串是删掉了模型，params.defaultModel 是 Osuna 的默认模型）。
  | "modelReplaced"
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
  model_replaced: "modelReplaced",
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
  // 照 magpie 的 replaced：写回默认模型，或留下 CLI 的模型不再提示。
  modelReplaced: ["reapply", "keepReplacedModel"],
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

/** 默认思考档位的一个选项：档位 id 与聊天里的显示名。 */
export interface DefaultThinkingOption {
  id: string;
  label: string;
}

/**
 * 默认思考档位（glossary「默认思考档位」）：主机报的档位（null 为没设；Claude Code 的主机已按默认模型实际跑的那一档报）、
 * 默认模型能选的档位、Ultra Code（null 为这个模型没有），以及每个会话都锁在的档位（主机说的）。
 */
export interface DefaultThinkingView {
  value: string | null;
  options: DefaultThinkingOption[];
  usesUltraCode: boolean | null;
  lockedAt: string | null;
}

/**
 * Claude Code 的后台小任务模型、Subagent 模型与它的思考档位（PRD 第 32 条）：模型为 null 是跟主模型；
 * Subagent 思考档位的选项来自 Subagent 模型（跟主模型时是默认模型）在聊天模型选择器里的档位。
 */
export interface ClaudeSideModelsView {
  backgroundModel: DefaultModelOption | null;
  subagentModel: DefaultModelOption | null;
  subagentThinking: SubagentThinkingView;
}

export interface SubagentThinkingView {
  // null 为没设，按 Claude Code 给 Subagent 的那一档。
  value: string | null;
  options: DefaultThinkingOption[];
}

// 与 Osuna 对话里 Claude 的 Ultra Code 档位同一个 id。
const ULTRA_CODE_OPTION_ID = "ultracode";

export interface AgentApiEndpointsView {
  enabled: boolean;
  // 总开关关着时打不开的原因；开着时总能关，恒为 null。
  enableBlockedBy: AgentSwitchBlock | null;
  defaultModelId: string | null;
  // 当前默认模型的显示；对不上任何选项时照原样（endpointName 为 null）。
  defaultModel: DefaultModelOption | null;
  // 先是开着的接口的已选模型，按创建顺序合并去重的光秃秃名字；再是聊天模型选择器里每家的「接口标识/模型名」。
  modelOptions: DefaultModelOption[];
  summary: AgentEndpointsSummary;
  // 提示区，按主机给的顺序。
  issues: AgentIssueView[];
  // 「保留 claude.ai 登录」开着没有（ADR 0012）；只有 Claude Code 有这个选项，别的 Agent 为 null。
  keepsClaudeAiLogin: boolean | null;
  // 总开关关着、默认模型没有档位或主机太旧（快照里没有分组）时为 null，不显示这一行。
  defaultThinking: DefaultThinkingView | null;
  // 只有 Claude Code 有；总开关关着或主机太旧（设置里没有这几项）时为 null，不显示这几行。
  sideModels: ClaudeSideModelsView | null;
}

export function selectAgentApiEndpointsView(input: {
  state: Extract<HostEndpointsLoadState, { status: "ready" }>;
  provider: string;
  // 提供方快照里按接口分组的模型（id 是「接口标识/模型名」）；主机认不出指定某一家的默认模型时为 null。
  endpointModelGroups: ApiEndpointModelGroup[] | null;
  // 提供方快照说每个会话都锁在的思考档位（第三方接口的默认思考档位是 max 时）；没有为 null。
  lockedThinkingOptionId: string | null;
  now: Date;
}): AgentApiEndpointsView {
  const { state, provider, now } = input;
  const agent = state.agents[provider] ?? { enabled: false, defaultModelId: null };
  const enabledEndpoints = state.endpoints.filter((endpoint) => endpoint.enabled !== false);
  const modelOptions = defaultModelOptions({
    enabledEndpoints,
    groups: input.endpointModelGroups ?? [],
  });

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

  // 和默认模型一样只在总开关开着时设。
  let defaultThinking: DefaultThinkingView | null = null;
  if (agent.enabled) {
    defaultThinking = defaultThinkingView({
      groups: input.endpointModelGroups ?? [],
      defaultModelId: agent.defaultModelId,
      value: agent.defaultThinkingOptionId ?? null,
      usesUltraCode: agent.usesUltraCode === true,
      lockedAt: input.lockedThinkingOptionId,
    });
  }

  const sideModels = claudeSideModelsView({
    provider,
    agent,
    modelOptions,
    groups: input.endpointModelGroups ?? [],
  });

  return {
    enabled: agent.enabled,
    enableBlockedBy,
    defaultModelId: agent.defaultModelId,
    defaultModel: displayedDefaultModel(modelOptions, agent.defaultModelId),
    modelOptions,
    summary: { enabledCount: enabledEndpoints.length, cooling },
    issues: (state.agentIssues[provider] ?? []).map(toIssueView),
    keepsClaudeAiLogin,
    defaultThinking,
    sideModels,
  };
}

/**
 * 选项来自默认模型在聊天模型选择器里的那一条（主机按这个模型的档位给出；Claude Code 支持 xhigh 时里面有 Ultra Code，
 * 这里拆出来做开关）：指定某一家的找那一家，光秃秃的名字找第一家提供它的。
 */
function defaultThinkingView(input: {
  groups: ApiEndpointModelGroup[];
  defaultModelId: string | null;
  value: string | null;
  usesUltraCode: boolean;
  lockedAt: string | null;
}): DefaultThinkingView | null {
  const { defaultModelId } = input;
  if (defaultModelId === null) return null;
  const thinkingOptions = modelThinkingOptions(input.groups, defaultModelId);
  const options = levelsWithoutUltraCode(thinkingOptions);
  // COMPAT(apiEndpointCliWiring): added in v0.17.0, remove after 2027-04-18. 老 daemon 的分组模型不带思考档位，这一行不显示（没有档位的模型同样不显示）。
  if (options.length === 0) return null;
  const hasUltraCode = thinkingOptions.some((option) => option.id === ULTRA_CODE_OPTION_ID);
  return {
    value: input.value,
    options,
    usesUltraCode: hasUltraCode ? input.usesUltraCode : null,
    lockedAt: input.lockedAt,
  };
}

/** 后台小任务模型与 Subagent 的显示；只有 Claude Code、总开关开着、主机报了这几项时才有。 */
function claudeSideModelsView(input: {
  provider: string;
  agent: ApiEndpointAgentSettings;
  modelOptions: DefaultModelOption[];
  groups: ApiEndpointModelGroup[];
}): ClaudeSideModelsView | null {
  const { agent, modelOptions } = input;
  // COMPAT(apiEndpointClaudeSideModels): added in v0.17.0, remove after 2027-04-18. 老 daemon 不报这几项，也不收。
  const reportsSideModels = agent.backgroundModelId !== undefined;
  const showsSideModels = input.provider === "claude" && agent.enabled && reportsSideModels;
  if (!showsSideModels) return null;
  const subagentModelId = agent.subagentModelId ?? null;
  return {
    backgroundModel: displayedDefaultModel(modelOptions, agent.backgroundModelId ?? null),
    subagentModel: displayedDefaultModel(modelOptions, subagentModelId),
    subagentThinking: {
      value: agent.subagentThinkingOptionId ?? null,
      options: modelLevels(input.groups, subagentModelId ?? agent.defaultModelId),
    },
  };
}

/** 模型在聊天模型选择器里的档位：指定某一家的找那一家，光秃秃的名字找第一家提供它的。 */
function modelThinkingOptions(
  groups: ApiEndpointModelGroup[],
  modelId: string,
): DefaultThinkingOption[] {
  const models = groups.flatMap((group) => group.models);
  const named = models.find((model) => model.id === modelId);
  const bare = models.find((model) => model.id.slice(model.id.indexOf("/") + 1) === modelId);
  return (named ?? bare)?.thinkingOptions ?? [];
}

/** 档位选项去掉 Ultra Code（它是单独的开关）。 */
function levelsWithoutUltraCode(options: DefaultThinkingOption[]): DefaultThinkingOption[] {
  return options
    .filter((option) => option.id !== ULTRA_CODE_OPTION_ID)
    .map((option) => ({ id: option.id, label: option.label }));
}

function modelLevels(
  groups: ApiEndpointModelGroup[],
  modelId: string | null,
): DefaultThinkingOption[] {
  if (modelId === null) return [];
  return levelsWithoutUltraCode(modelThinkingOptions(groups, modelId));
}

/** 光秃秃的名字在前（按创建顺序去重），再是聊天模型选择器里每家的「接口标识/模型名」。 */
function defaultModelOptions(input: {
  enabledEndpoints: ApiEndpoint[];
  groups: ApiEndpointModelGroup[];
}): DefaultModelOption[] {
  const options: DefaultModelOption[] = [];
  const ids = new Set<string>();
  const add = (option: DefaultModelOption) => {
    if (ids.has(option.id)) return;
    ids.add(option.id);
    options.push(option);
  };
  for (const endpoint of input.enabledEndpoints) {
    for (const model of endpoint.models) add({ id: model.id, model: model.id, endpointName: null });
  }
  for (const group of input.groups) {
    for (const model of group.models) {
      // 接口标识里没有斜杠：第一个斜杠后面就是模型名。
      const bare = model.id.slice(model.id.indexOf("/") + 1);
      add({ id: model.id, model: bare, endpointName: group.name });
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
