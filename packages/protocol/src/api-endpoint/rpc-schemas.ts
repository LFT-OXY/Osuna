import { z } from "zod";

/*
 * 第三方接口（API endpoint）：整台主机共用的上游连接；每个 Agent（Claude Code / Codex）一个
 * 「使用第三方接口」总开关与一个默认模型。provider 用字符串而非枚举，以后支持更多提供方时老客户端照常解析。
 * API key 只会出现在 save 请求里；任何响应都只带 hasApiKey。
 *
 * 老客户端（含官方 Paseo 手机 App）不认识主机级字段，只读单接口投影：每个接口的 provider / baseUrl /
 * defaultModelId 与 activeEndpointId 都按请求的 provider 换算。新字段全部可选，
 * 新客户端在 server_info.features.apiEndpointGateway 为 true 时才读它们。
 */

export const ApiEndpointModelSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
});
export type ApiEndpointModel = z.infer<typeof ApiEndpointModelSchema>;

/**
 * Claude 的模型映射：每档写进 settings.json 的 ANTHROPIC_DEFAULT_<档位>_MODEL，只改写 `/model opus` 这类别名。
 * 每档都是勾选的模型之一；没有的档位不写。Codex 接口没有映射。
 */
export const API_ENDPOINT_MODEL_TIERS = ["opus", "sonnet", "haiku", "fable"] as const;
export type ApiEndpointModelTier = (typeof API_ENDPOINT_MODEL_TIERS)[number];

/** 有模型映射的提供方；App 据此显示映射区，daemon 据此拒绝其他提供方的映射。 */
const MODEL_MAPPING_PROVIDERS: ReadonlySet<string> = new Set(["claude"]);

export function apiEndpointHasModelMapping(provider: string): boolean {
  return MODEL_MAPPING_PROVIDERS.has(provider);
}

/** 测试连接用的、也是 CLI 自己说的协议；App 在「不支持该协议」的提示里显示它。 */
const TEST_PROTOCOL_NAMES: Readonly<Record<string, string>> = {
  claude: "Anthropic Messages",
  codex: "OpenAI Responses",
};

export function apiEndpointProtocolName(provider: string): string {
  return TEST_PROTOCOL_NAMES[provider] ?? provider;
}

export const ApiEndpointModelMappingSchema = z.object({
  opus: z.string().optional(),
  sonnet: z.string().optional(),
  haiku: z.string().optional(),
  fable: z.string().optional(),
});
export type ApiEndpointModelMapping = z.infer<typeof ApiEndpointModelMappingSchema>;

/**
 * 请求格式：发给上游的请求用哪种协议格式，与模型家族无关。线上是字符串，
 * 以后新增格式时老客户端照常解析；daemon 只认下面三种。
 */
export const API_ENDPOINT_REQUEST_FORMATS = [
  "anthropic_messages",
  "openai_chat",
  "openai_responses",
] as const;
export type ApiEndpointRequestFormat = (typeof API_ENDPOINT_REQUEST_FORMATS)[number];

/** 一种请求格式的地址；一家接口每种格式最多一个，至少一个。 */
export const ApiEndpointBaseUrlSchema = z.object({
  format: z.string(),
  url: z.string(),
});
export type ApiEndpointBaseUrl = z.infer<typeof ApiEndpointBaseUrlSchema>;

/**
 * 每个 Agent 的设置：enabled 为「使用第三方接口」总开关；defaultModelId 是光秃秃的模型名，
 * 或「接口标识/模型名」（先用那家，不行再自动切换到提供同名模型的别家，ADR 0012）。
 * keepsClaudeAiLogin 只对 Claude Code 有意义：「保留 claude.ai 登录」（ADR 0012），开着时 CLI 配置里的口令写成空值；
 * 没有即为关，老 daemon 不发。
 * defaultThinkingOptionId 是「默认思考档位」：终端新会话与 Osuna 新对话从这一档起步，取值是思考档位 id；
 * null 或没有为没设，用 CLI 自己的。usesUltraCode 只对 Claude Code 有意义：Ultra Code 开（true）、关（false），
 * 没有为没设、不碰 settings.json 里的 ultracode。老 daemon 都不发。
 * backgroundModelId（后台小任务模型）只对 Claude Code 有意义；subagentModelId（Subagent 模型，Codex 是默认 Subagent 模型）
 * 与 subagentThinkingOptionId（它的思考档位）对两者都有意义；memoryModelId（记忆模型）只对 Codex 有意义。
 * 模型取值同 defaultModelId；null 或没有为没设，跟主模型（记忆模型没设用 Codex 自己的）。老 daemon 都不发。
 * forcedSubagentModelId（强制 Subagent 模型）与 allowsAnySubagentModel（「Codex Subagent 可用任意模型」）只对 Codex 有意义：
 * 前者不写 Codex 配置，中转站把 Subagent 的请求改到这个模型，null 或没有为没设；后者把给 Codex 的模型清单里的多 Agent 版本标成 v1，
 * 没有即为关。老 daemon 都不发。
 */
export const ApiEndpointAgentSettingsSchema = z.object({
  enabled: z.boolean(),
  defaultModelId: z.string().nullable(),
  keepsClaudeAiLogin: z.boolean().optional(),
  defaultThinkingOptionId: z.string().nullable().optional(),
  usesUltraCode: z.boolean().optional(),
  backgroundModelId: z.string().nullable().optional(),
  subagentModelId: z.string().nullable().optional(),
  subagentThinkingOptionId: z.string().nullable().optional(),
  memoryModelId: z.string().nullable().optional(),
  forcedSubagentModelId: z.string().nullable().optional(),
  allowsAnySubagentModel: z.boolean().optional(),
});
export type ApiEndpointAgentSettings = z.infer<typeof ApiEndpointAgentSettingsSchema>;

/**
 * 自动切换给接口的状态。`state` 是字符串：cooling_down（冷却中，`until` 是恢复时刻）、
 * needs_check（key 无效或无权限，`until` 为 null，编辑这家接口后恢复）；`reason` 是失败分类
 * （credit、quota、rate、other、auth）。只记在 daemon 内存里，重启清零。
 */
export const ApiEndpointCooldownSchema = z.object({
  state: z.string(),
  reason: z.string(),
  until: z.string().nullable(),
});
export type ApiEndpointCooldown = z.infer<typeof ApiEndpointCooldownSchema>;

/** daemon 上次向上游列出的模型（详情页按格式拉取后记下）；只用来挑选，不等于已选。 */
export const ApiEndpointModelCatalogSchema = z.object({
  fetchedAt: z.string(),
  models: z.array(ApiEndpointModelSchema),
});
export type ApiEndpointModelCatalog = z.infer<typeof ApiEndpointModelCatalogSchema>;

export const ApiEndpointSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  models: z.array(ApiEndpointModelSchema),
  defaultModelId: z.string(),
  modelMapping: ApiEndpointModelMappingSchema.optional(),
  hasApiKey: z.boolean(),
  // 主机级字段；老 daemon 不发。baseUrl 是其中按 provider 选出的一个。
  baseUrls: z.array(ApiEndpointBaseUrlSchema).optional(),
  // 接口开关：关着即「已关闭」，对所有 Agent 生效。
  enabled: z.boolean().optional(),
  // 没有或为 null 即可用；老 daemon 不发。
  cooldown: ApiEndpointCooldownSchema.nullable().optional(),
  // 上次拉回来的上游清单；还没拉过时没有。
  catalog: ApiEndpointModelCatalogSchema.optional(),
  // 用户手动添加的模型名，不管开没开都留在清单里。
  manualModels: z.array(ApiEndpointModelSchema).optional(),
  // 「自己能联网搜索」（ADR 0009）：只在这家有 Anthropic 或 OpenAI Responses 地址时算数；老 daemon 不发即为关。
  searchesWeb: z.boolean().optional(),
});
export type ApiEndpoint = z.infer<typeof ApiEndpointSchema>;

/**
 * 请求被拒的原因。`code` 是字符串，daemon 新增错误码时老客户端照常解析并显示 message。`params` 是 app 用界面语言说明时要的参数，值都是字符串；老 daemon 不发。
 * config_unparsable：file、detail（解析器原文）；settings.json 另有 reason（syntax 带 line、column，
 * root_not_object，key_not_object / key_not_array 带 key）。
 */
export const ApiEndpointErrorSchema = z.object({
  code: z.string(),
  params: z.record(z.string(), z.string()).optional(),
  message: z.string(),
});
export type ApiEndpointError = z.infer<typeof ApiEndpointErrorSchema>;

export const ApiEndpointListRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.list.request"),
  requestId: z.string(),
  provider: z.string(),
});
export type ApiEndpointListRequest = z.infer<typeof ApiEndpointListRequestSchema>;

/** 一个已保存的第三方接口：提供方快照里当前启用的接口、会话恢复提示里的当前模式都用它。 */
export const ApiEndpointRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type ApiEndpointRef = z.infer<typeof ApiEndpointRefSchema>;

/**
 * 恢复的会话创建时所处的模式与当前模式不同，挂在时间线的 notification 上。
 * null 即「官方」；name 为 null 表示该接口已被删除。v0.16 起 daemon 不再发送，schema 留着让老消息照常解析。
 */
export const ApiEndpointCreatedRefSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
});
export type ApiEndpointCreatedRef = z.infer<typeof ApiEndpointCreatedRefSchema>;

export const ApiEndpointModeMismatchSchema = z.object({
  createdIn: ApiEndpointCreatedRefSchema.nullable(),
  current: ApiEndpointRefSchema.nullable(),
});
export type ApiEndpointModeMismatch = z.infer<typeof ApiEndpointModeMismatchSchema>;

/**
 * CLI 配置文件的一条健康问题，列表查询时读真实文件得出。`code` 是字符串：
 * modified_externally、config_unparsable、codex_profile_override；
 * v0.15 及以前的 daemon 还会发 codex_version_unsupported。
 */
export const ApiEndpointHealthIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ApiEndpointHealthIssue = z.infer<typeof ApiEndpointHealthIssueSchema>;

/**
 * 提供方设置页提示区的一条「设置被改过」，读状态时检测。`code` 是字符串，app 按它翻译，认不出的照 `message`（英文）显示：
 * not_through_gateway（params：file、keys）、config_unparsable（file、detail，settings.json 另有 reason 等，
 * 同 ApiEndpointErrorSchema）、codex_profile_override（file、profile、keys）、
 * settings_has_comments（file：settings.json 带注释或尾随逗号，Claude Code 读不了）、
 * claude_ai_login_token_set（file：保留 claude.ai 登录开着，口令却被填回去）、
 * claude_ai_login_token_empty（file、how：empty / missing；保留 claude.ai 登录关着，口令却是空的或没了）、
 * codex_multi_agent_v2_on（file：「Codex Subagent 可用任意模型」开着，config.toml 里 Codex 自己的 multi_agent_v2 也开着、盖过它）、
 * codex_multi_agent_v2_unreadable（file、detail：「Codex Subagent 可用任意模型」开着，却读不了 config.toml、查不了 multi_agent_v2）、
 * bypassed（how：used / elsewhere / refused，at：ISO 时间，elsewhere 另有 host：设置没问题，但 CLI 自己的记录显示最近一次改写之后
 * 用过，中转站却没收到它的请求）。
 * 后面会加新的 code；params 的值都是字符串，keys 用 ", " 连接。
 */
export const ApiEndpointAgentIssueSchema = z.object({
  code: z.string(),
  params: z.record(z.string(), z.string()).optional(),
  message: z.string(),
});
export type ApiEndpointAgentIssue = z.infer<typeof ApiEndpointAgentIssueSchema>;

/**
 * `activeEndpointId: null` 表示「官方」；否则是持有该 Agent 默认模型、开着的接口里最早建的一家（投影）。
 * `agents` 是每个 Agent 的设置，按 provider 索引；老 daemon 不发。`health` 为空即正常；
 * `cliBaseUrl` 只在官方模式下给出，是 CLI 自身配置实际指向的地址。
 * `runningSessionCount` 是该提供方下还活着的 Agent session 数（初始化中、空闲、运行中），
 * 切换或改写配置会影响到它们；App 写进确认框。
 * `gatewayUnavailable` 非空时 daemon 内置中转站用不了（如 daemon 以 socket 监听，code 为 gateway_requires_tcp），
 * 「使用第三方接口」总开关打不开；老 daemon 不发。
 */
export const ApiEndpointListResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.list.response"),
  payload: z.object({
    requestId: z.string(),
    provider: z.string(),
    endpoints: z.array(ApiEndpointSchema),
    activeEndpointId: z.string().nullable(),
    health: z.array(ApiEndpointHealthIssueSchema).optional(),
    cliBaseUrl: z.string().nullable().optional(),
    runningSessionCount: z.number().optional(),
    agents: z.record(z.string(), ApiEndpointAgentSettingsSchema).optional(),
    gatewayUnavailable: ApiEndpointHealthIssueSchema.nullable().optional(),
    // 每个 Agent 的提示区，按 provider 索引，与请求的 provider 无关；老 daemon 不发。
    agentIssues: z.record(z.string(), z.array(ApiEndpointAgentIssueSchema)).optional(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointListResponse = z.infer<typeof ApiEndpointListResponseSchema>;

/**
 * 没有 endpointId 是新建，有则更新。更新时省略 apiKey 表示保留原 key；
 * 新建时 apiKey 必填。modelMapping 每次都整份提交，省略即不映射。
 *
 * 新客户端带 baseUrls，不带 baseUrl / defaultModelId，models 可以为空；接口开关不在这里改。
 * 老客户端带 baseUrl（按 provider 落进对应格式）与 defaultModelId。
 * manualModels 省略即保留这家已有的手动添加模型；拉回来的上游清单只由 fetch_models 改。
 * searchesWeb 省略即保留这家原来的「自己能联网搜索」，老客户端保存时不会把它关掉。
 */
export const ApiEndpointSaveRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.save.request"),
  requestId: z.string(),
  provider: z.string(),
  endpointId: z.string().optional(),
  name: z.string(),
  baseUrl: z.string().optional(),
  baseUrls: z.array(ApiEndpointBaseUrlSchema).optional(),
  apiKey: z.string().optional(),
  models: z.array(ApiEndpointModelSchema),
  defaultModelId: z.string().optional(),
  modelMapping: ApiEndpointModelMappingSchema.optional(),
  manualModels: z.array(ApiEndpointModelSchema).optional(),
  searchesWeb: z.boolean().optional(),
});
export type ApiEndpointSaveRequest = z.infer<typeof ApiEndpointSaveRequestSchema>;

export const ApiEndpointSaveResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.save.response"),
  payload: z.object({
    requestId: z.string(),
    endpoint: ApiEndpointSchema.nullable(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointSaveResponse = z.infer<typeof ApiEndpointSaveResponseSchema>;

/**
 * 接口是主机共用的，删除对所有 Agent 生效；provider 只用来换算响应里的 activeEndpointId。
 * 某个 Agent 的默认模型因此找不到时改成别的可用模型，一个都不剩就回到官方。
 */
export const ApiEndpointDeleteRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.delete.request"),
  requestId: z.string(),
  provider: z.string(),
  endpointId: z.string(),
});
export type ApiEndpointDeleteRequest = z.infer<typeof ApiEndpointDeleteRequestSchema>;

export const ApiEndpointDeleteResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.delete.response"),
  payload: z.object({
    requestId: z.string(),
    activeEndpointId: z.string().nullable(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointDeleteResponse = z.infer<typeof ApiEndpointDeleteResponseSchema>;

/**
 * 老客户端的切换：`endpointId` 打开该 Agent 的总开关并确保这家开着（不关别的接口），
 * `null` 关掉总开关（官方）。新客户端用 set_agent_settings 与 set_endpoint_state。
 */
export const ApiEndpointSetActiveRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.set_active.request"),
  requestId: z.string(),
  provider: z.string(),
  endpointId: z.string().nullable(),
});
export type ApiEndpointSetActiveRequest = z.infer<typeof ApiEndpointSetActiveRequestSchema>;

export const ApiEndpointSetActiveResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.set_active.response"),
  payload: z.object({
    requestId: z.string(),
    activeEndpointId: z.string().nullable(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointSetActiveResponse = z.infer<typeof ApiEndpointSetActiveResponseSchema>;

/**
 * 设置一个 Agent 的「使用第三方接口」总开关与默认模型。只在至少一家接口开着且已选模型时能打开；
 * 打开时省略 defaultModelId 就照 magpie 依次挑（见 ApiEndpointConnectionSchema），结果在 `connection` 里；
 * 关掉时忽略 defaultModelId，从不被拒。失败时 `agent` 是该 Agent 未变的设置。
 * `reapply`（「重新应用」，与 enabled: true 一起）：设置没变也按当前设置重写 CLI 配置，盖掉外部改动；老 daemon 忽略它。
 * `keepsClaudeAiLogin`：只给 Claude Code，设「保留 claude.ai 登录」，总开关开着、关着都能设；省略即不变，老 daemon 忽略它。
 * `defaultThinkingOptionId`：设「默认思考档位」；null 为不设，省略即不变。Claude Code 要是默认模型收的档位，
 * Codex 收它认的任何档位（换了默认模型时 daemon 把新模型不收的改到最近一档）。老 daemon 忽略它。
 * `usesUltraCode`：只给 Claude Code，开关 Ultra Code，打开要求默认模型支持 xhigh；省略即不变。老 daemon 忽略它。
 * `backgroundModelId`、`subagentModelId`、`subagentThinkingOptionId`：设后台小任务模型（只给 Claude Code）、Subagent 模型
 * 与它的思考档位；模型要是开着的接口的已选模型，Claude Code 的档位是 none、minimal、low、medium、high、xhigh、max 之一，
 * Codex 的档位要是 Subagent 模型（没设时是主模型）收的；null 为不设，省略即不变。老 daemon 忽略它们。
 * `memoryModelId`：只给 Codex，设记忆模型，取值同 subagentModelId。老 daemon 忽略它。
 * `forcedSubagentModelId`、`allowsAnySubagentModel`：只给 Codex，设强制 Subagent 模型（取值同 subagentModelId，null 为不设）
 * 与「Codex Subagent 可用任意模型」；省略即不变，老 daemon 忽略它们。
 */
export const ApiEndpointSetAgentSettingsRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.set_agent_settings.request"),
  requestId: z.string(),
  provider: z.string(),
  enabled: z.boolean(),
  defaultModelId: z.string().optional(),
  reapply: z.boolean().optional(),
  keepsClaudeAiLogin: z.boolean().optional(),
  defaultThinkingOptionId: z.string().nullable().optional(),
  usesUltraCode: z.boolean().optional(),
  backgroundModelId: z.string().nullable().optional(),
  subagentModelId: z.string().nullable().optional(),
  subagentThinkingOptionId: z.string().nullable().optional(),
  memoryModelId: z.string().nullable().optional(),
  forcedSubagentModelId: z.string().nullable().optional(),
  allowsAnySubagentModel: z.boolean().optional(),
});
export type ApiEndpointSetAgentSettingsRequest = z.infer<
  typeof ApiEndpointSetAgentSettingsRequestSchema
>;

/**
 * 打开总开关时默认模型是怎么挑的（ADR 0012，照 magpie 的 Connection）。`how` 是字符串，后面会加新的：
 * kept（本来就开着或 CLI 还指向中转站，原样不动）、again（回到上次关掉前用的）、joined（用 ChatGPT 登录的 Codex 保持它自己选的模型，
 * 接口模型并进 /model）、same（沿用 CLI 原来的模型）、alike（CLI 用的档位名指向的模型）、first（没有接口提供原来的模型，取第一个）。
 * `model` 是挑中的默认模型，`previousModel` 是挑之前 CLI 配置里的模型（没设为 null）。
 */
export const ApiEndpointConnectionSchema = z.object({
  how: z.string(),
  model: z.string(),
  previousModel: z.string().nullable(),
});
export type ApiEndpointConnection = z.infer<typeof ApiEndpointConnectionSchema>;

export const ApiEndpointSetAgentSettingsResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.set_agent_settings.response"),
  payload: z.object({
    requestId: z.string(),
    provider: z.string(),
    agent: ApiEndpointAgentSettingsSchema.nullable(),
    // 打开总开关且没指定默认模型时才有；老 daemon 不发。
    connection: ApiEndpointConnectionSchema.nullable().optional(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointSetAgentSettingsResponse = z.infer<
  typeof ApiEndpointSetAgentSettingsResponseSchema
>;

/**
 * 「保留当前设置」：关掉该 Agent 的「使用第三方接口」总开关，但 CLI 配置文件保持现在的样子、不按接管记录改回，
 * 此后不再提示设置被改过。总开关已经关着时什么都不做。失败时 `agent` 是该 Agent 未变的设置。
 * `code`：回应的是哪条提示。`model_replaced`（模型被换掉）只留下 CLI 现在的模型、不再提示，总开关照开；
 * 省略时是上面的意思。老 daemon 忽略它，但它们也不报 model_replaced。
 */
export const ApiEndpointKeepCurrentSettingsRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.keep_current_settings.request"),
  requestId: z.string(),
  provider: z.string(),
  code: z.string().optional(),
});
export type ApiEndpointKeepCurrentSettingsRequest = z.infer<
  typeof ApiEndpointKeepCurrentSettingsRequestSchema
>;

export const ApiEndpointKeepCurrentSettingsResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.keep_current_settings.response"),
  payload: z.object({
    requestId: z.string(),
    provider: z.string(),
    agent: ApiEndpointAgentSettingsSchema.nullable(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointKeepCurrentSettingsResponse = z.infer<
  typeof ApiEndpointKeepCurrentSettingsResponseSchema
>;

/**
 * 关「使用第三方接口」会改的一行（照 magpie 的 LineDiff）。`op`：removed（Osuna 写的行拿掉）、
 * added（放回接入前的一行）、restored（同一个键改回接入前的值，`was` 是现在这一行）。像密钥的值已遮住。
 * 用字符串而非枚举：以后加新值时老客户端照常解析。
 */
export const ApiEndpointSwitchOffLineSchema = z.object({
  op: z.string(),
  text: z.string(),
  was: z.string().optional(),
});
export type ApiEndpointSwitchOffLine = z.infer<typeof ApiEndpointSwitchOffLineSchema>;

/**
 * 关掉后一个文件的变化（照 magpie 的 FileChange）。`path` 在家目录下时以 `~/` 开头。
 * `change`：edited（改几行）、created（新建，`lines` 是它的内容）、removed（删掉，没有 `lines`）。
 */
export const ApiEndpointSwitchOffFileSchema = z.object({
  path: z.string(),
  change: z.string(),
  lines: z.array(ApiEndpointSwitchOffLineSchema),
});
export type ApiEndpointSwitchOffFile = z.infer<typeof ApiEndpointSwitchOffFileSchema>;

/** 关掉会改的文件，空数组表示没有要改的。 */
export const ApiEndpointSwitchOffPreviewSchema = z.object({
  files: z.array(ApiEndpointSwitchOffFileSchema),
});
export type ApiEndpointSwitchOffPreview = z.infer<typeof ApiEndpointSwitchOffPreviewSchema>;

/**
 * 关「使用第三方接口」之前的预览：用真正关掉时同一套还原逻辑，在 CLI 配置的当前内容上算出关掉以后的样子，
 * 什么都不写。算不出（如文件读不懂，`config_unparsable`）时 `preview` 为 null、`error` 说明原因，
 * app 改用文字说明，仍可确认关掉。只有新客户端在 apiEndpointCliWiring 为 true 时才发。
 */
export const ApiEndpointPreviewSwitchOffRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.preview_switch_off.request"),
  requestId: z.string(),
  provider: z.string(),
});
export type ApiEndpointPreviewSwitchOffRequest = z.infer<
  typeof ApiEndpointPreviewSwitchOffRequestSchema
>;

export const ApiEndpointPreviewSwitchOffResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.preview_switch_off.response"),
  payload: z.object({
    requestId: z.string(),
    provider: z.string(),
    preview: ApiEndpointSwitchOffPreviewSchema.nullable(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointPreviewSwitchOffResponse = z.infer<
  typeof ApiEndpointPreviewSwitchOffResponseSchema
>;

/**
 * 一家接口的状态：`enabled` 是接口开关（对所有 Agent 生效）；`clearCooldown` 是「立刻恢复」，
 * 清掉这家的冷却。关掉开关可能让某个 Agent 的默认模型改变或回到官方，规则同删除。
 */
export const ApiEndpointSetEndpointStateRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.set_endpoint_state.request"),
  requestId: z.string(),
  endpointId: z.string(),
  enabled: z.boolean().optional(),
  clearCooldown: z.boolean().optional(),
});
export type ApiEndpointSetEndpointStateRequest = z.infer<
  typeof ApiEndpointSetEndpointStateRequestSchema
>;

export const ApiEndpointSetEndpointStateResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.set_endpoint_state.response"),
  payload: z.object({
    requestId: z.string(),
    endpointId: z.string(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointSetEndpointStateResponse = z.infer<
  typeof ApiEndpointSetEndpointStateResponseSchema
>;

/**
 * daemon 在主机上向上游列出模型，key 不经过客户端。编辑已保存的接口时带 endpointId、
 * 省略 apiKey（或留空），就用已保存的 key。可以用 cancel 按 requestId 取消。
 *
 * 新客户端带 `format`：baseUrl 是这种请求格式的地址，认证头按格式给，provider 不再起作用；
 * 同时带 endpointId 时，列出的模型记作这家的上游清单（列表里的 `catalog`）。
 * 老客户端不带 format，按 provider 走 CLI 自己的格式，只读不记。
 */
export const ApiEndpointFetchModelsRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.fetch_models.request"),
  requestId: z.string(),
  provider: z.string(),
  endpointId: z.string().optional(),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  format: z.string().optional(),
});
export type ApiEndpointFetchModelsRequest = z.infer<typeof ApiEndpointFetchModelsRequestSchema>;

export const ApiEndpointFetchModelsResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.fetch_models.response"),
  payload: z.object({
    requestId: z.string(),
    models: z.array(ApiEndpointModelSchema),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointFetchModelsResponse = z.infer<typeof ApiEndpointFetchModelsResponseSchema>;

/**
 * 自动检测：daemon 从用户填的一个地址推出三种请求格式各自的地址，先向上游列出模型挑一个，
 * 再按每种格式各发一条最小对话请求。key 的规则和 fetch_models 相同；可以用 cancel 按 requestId 取消。
 */
export const ApiEndpointDetectFormatsRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.detect_formats.request"),
  requestId: z.string(),
  endpointId: z.string().optional(),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
});
export type ApiEndpointDetectFormatsRequest = z.infer<typeof ApiEndpointDetectFormatsRequestSchema>;

/**
 * 一种格式的检测结果。`status` 是字符串：ok（检测通过）、auth_failed（上游回 401 / 403，key 无效）、
 * not_detected（其余失败，原因在 `message`）。`url` 是这种格式的建议地址；`httpStatus` 没收到响应时为 null。
 */
export const ApiEndpointFormatDetectionSchema = z.object({
  format: z.string(),
  url: z.string(),
  status: z.string(),
  httpStatus: z.number().nullable(),
  message: z.string().nullable(),
});
export type ApiEndpointFormatDetection = z.infer<typeof ApiEndpointFormatDetectionSchema>;

/** 请求本身被拒（缺 key、地址无效、找不到接口、被取消）时 `results` 为空，原因在 `error`。 */
export const ApiEndpointDetectFormatsResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.detect_formats.response"),
  payload: z.object({
    requestId: z.string(),
    results: z.array(ApiEndpointFormatDetectionSchema),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointDetectFormatsResponse = z.infer<
  typeof ApiEndpointDetectFormatsResponseSchema
>;

/**
 * 取消同一连接上还在进行的上游请求；被取消的请求照常回一条 error.code 为 cancelled 的响应。
 * `cancelled: false` 表示那条请求已经结束或不存在。
 */
export const ApiEndpointCancelRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.cancel.request"),
  requestId: z.string(),
  targetRequestId: z.string(),
});
export type ApiEndpointCancelRequest = z.infer<typeof ApiEndpointCancelRequestSchema>;

export const ApiEndpointCancelResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.cancel.response"),
  payload: z.object({
    requestId: z.string(),
    cancelled: z.boolean(),
  }),
});
export type ApiEndpointCancelResponse = z.infer<typeof ApiEndpointCancelResponseSchema>;

/**
 * 测试连接：daemon 在主机上用 CLI 实际使用的协议发一条最小对话请求（Claude 走 Anthropic Messages，
 * Codex 走 OpenAI Responses）。key 的规则和 fetch_models 相同；可以用 cancel 按 requestId 取消。
 *
 * 新客户端带 `format`：按这种请求格式向 baseUrl 发最小请求，provider 不再起作用；
 * 省略 modelId 时 daemon 从这家已选的模型、上游清单里挑一个适合该格式的，都没有就先向上游列一次。
 * 上游回 401 / 403 时结果的 error.code 是 auth_failed（key 无效）。老客户端不带 format，modelId 必填。
 */
export const ApiEndpointTestConnectionRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.test_connection.request"),
  requestId: z.string(),
  provider: z.string(),
  endpointId: z.string().optional(),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  modelId: z.string().optional(),
  format: z.string().optional(),
});
export type ApiEndpointTestConnectionRequest = z.infer<
  typeof ApiEndpointTestConnectionRequestSchema
>;

/**
 * 上游给出的结论。`status` 是 HTTP 状态码，没收到响应（连不上、超时）时为 null；
 * `error` 是上游侧的失败，code 如 upstream_error、protocol_unsupported；按格式测试时 key 被拒是 auth_failed。
 */
export const ApiEndpointTestConnectionResultSchema = z.object({
  ok: z.boolean(),
  status: z.number().nullable(),
  durationMs: z.number(),
  error: ApiEndpointErrorSchema.nullable(),
});
export type ApiEndpointTestConnectionResult = z.infer<typeof ApiEndpointTestConnectionResultSchema>;

/** 请求本身被拒（缺 key、找不到接口、被取消）时 `result` 为 null，原因在 `error`。 */
export const ApiEndpointTestConnectionResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.test_connection.response"),
  payload: z.object({
    requestId: z.string(),
    result: ApiEndpointTestConnectionResultSchema.nullable(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointTestConnectionResponse = z.infer<
  typeof ApiEndpointTestConnectionResponseSchema
>;
