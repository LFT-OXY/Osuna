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

/**
 * 服务范围（Model scope）：vendor「跟随接口清单」——在服务的模型是上游清单去掉没有对应地址的模型后的前 24 个，
 * 加上手动添加的；picked「只用挑选的」——用户勾的那些。线上是字符串，以后加范围时老客户端照常解析；缺省当 picked。
 */
export const API_ENDPOINT_MODEL_SCOPES = ["vendor", "picked"] as const;
export type ApiEndpointModelScope = (typeof API_ENDPOINT_MODEL_SCOPES)[number];

/**
 * 模型设置（Model settings）：用户给这家某个模型手改的资料，按模型 id 记，外加一份整家默认（Defaults for all models）。
 * 取值顺序：单个模型 → 整家默认 → 上游清单 → models.dev → 内置默认（model-settings.ts 的 resolveModelFacts）。
 * name：显示名；context、output、compact：上下文、回复上限、压缩阈值，都按 token 数；images：能不能看图；
 * efforts：留下的思考档位，空数组是一档不留——中转站不发任何思考参数。没有的项用自动取到的值。
 * upstreamName：上游模型名，中转站发往这家时换成它，`*` 换成模型 id（model-settings.ts 的 upstreamModelName）；
 * format：只用这种格式（请求格式），这家没有这种格式的地址时作废（pinnedFormat）。老 daemon 不发也不认。
 */
export const ApiEndpointModelSettingSchema = z.object({
  name: z.string().optional(),
  context: z.number().optional(),
  output: z.number().optional(),
  efforts: z.array(z.string()).optional(),
  images: z.boolean().optional(),
  compact: z.number().optional(),
  upstreamName: z.string().optional(),
  format: z.string().optional(),
});
export type ApiEndpointModelSetting = z.infer<typeof ApiEndpointModelSettingSchema>;

export const ApiEndpointModelDefaultsSchema = ApiEndpointModelSettingSchema.pick({
  context: true,
  output: true,
  compact: true,
  upstreamName: true,
});
export type ApiEndpointModelDefaults = z.infer<typeof ApiEndpointModelDefaultsSchema>;

export const ApiEndpointModelSettingsSchema = z.object({
  defaults: ApiEndpointModelDefaultsSchema.optional(),
  models: z.record(z.string(), ApiEndpointModelSettingSchema).optional(),
});
export type ApiEndpointModelSettings = z.infer<typeof ApiEndpointModelSettingsSchema>;

/**
 * 长对话（Long conversations，整台主机共用，照 magpie 的 FullContext 与 CompactAt）：告诉 Codex、Claude Code 的窗口。
 * fullContext 为 true 时告诉模型的整个窗口；否则比压缩阈值大的窗口说成压缩阈值——compactAt，没有就是 272K。
 * 单个模型或整家默认的压缩阈值在它之前。都没有即关着、272K。老 daemon 不发。
 */
export const ApiEndpointLongConversationsSchema = z.object({
  fullContext: z.boolean().optional(),
  compactAt: z.number().optional(),
});
export type ApiEndpointLongConversations = z.infer<typeof ApiEndpointLongConversationsSchema>;

/** Osuna 自动取到的模型资料（上游清单在前，models.dev 补上）：不含用户的模型设置，模型设置窗口拿它当「默认」。 */
export const ApiEndpointModelFactsSchema = z.object({
  name: z.string().optional(),
  context: z.number().optional(),
  output: z.number().optional(),
  efforts: z.array(z.string()).optional(),
  images: z.boolean().optional(),
});
export type ApiEndpointModelFacts = z.infer<typeof ApiEndpointModelFactsSchema>;

/** daemon 上次向上游列出的模型（详情页按格式拉取后记下）；只用来挑选，不等于已选。 */
export const ApiEndpointModelCatalogSchema = z.object({
  fetchedAt: z.string(),
  models: z.array(ApiEndpointModelSchema),
});
export type ApiEndpointModelCatalog = z.infer<typeof ApiEndpointModelCatalogSchema>;

/**
 * 这家能用的一种 CLI 测法（ADR 0013）：`method` 是 test_models 的测法（claude_code、codex）。只列这家提供的：
 * 按 Claude Code 测只给有 Anthropic 地址的中转服务（模板分组是 relay，或「自定义」加的），按 Codex 测给有 Responses 或 Chat 地址的。
 * `unavailable` 为 null 即现在就能测；否则是现在测不了的原因（cli_sample_missing：还没有 Claude Code 请求经过中转站）。
 */
export const ApiEndpointTestAsSchema = z.object({
  method: z.string(),
  unavailable: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type ApiEndpointTestAs = z.infer<typeof ApiEndpointTestAsSchema>;

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
  // 服务范围（API_ENDPOINT_MODEL_SCOPES）；没有即 picked。models 总是在服务的模型。老 daemon 不发。
  modelScope: z.string().optional(),
  // 自动勾选规则：glob（* 任意字符，不分大小写）或 `re:` 开头的整名正则；只在 picked 时起作用。老 daemon 不发。
  autoPick: z.array(z.string()).optional(),
  // 「自己能联网搜索」（ADR 0009）：只在这家有 Anthropic 或 OpenAI Responses 地址时算数；老 daemon 不发即为关。
  searchesWeb: z.boolean().optional(),
  // 接口标识：默认模型写「接口标识/模型名」时用的那段；列表搜索也按它找。老 daemon 不发。
  slug: z.string().optional(),
  // 列表行上的 key 打码（头尾各 4 个字符）；没有 key 时不发，老 daemon 不发。
  apiKeyMask: z.string().optional(),
  // 默认模型先去这家的 Agent（provider）：默认模型指定了这家，或光秃秃的名字在接口顺序里最先由这家提供；老 daemon 不发。
  defaultModelProviders: z.array(z.string()).optional(),
  // 从哪个模板（Template）加的、选的哪个区域或套餐；「自定义」加的没有。老 daemon 不发。
  templateId: z.string().optional(),
  region: z.string().optional(),
  // 「自定义」加的接口自己选的图标：内置图标的名字（如 deepseek-color），或 `file:<名字>`——daemon 存的图片副本，
  // 经 read_icon 取回（照 magpie）。没有就按模板或名称首字画。老 daemon 不发。
  icon: z.string().optional(),
  // 模型设置；没有即都用自动取到的值。老 daemon 不发。
  modelSettings: ApiEndpointModelSettingsSchema.optional(),
  // 在服务的、上游清单里的与手动添加的模型各自自动取到的资料，按模型 id；老 daemon 不发。
  modelFacts: z.record(z.string(), ApiEndpointModelFactsSchema).optional(),
  // 「按 Claude Code / Codex 的样子测」这家提供哪几种；老 daemon 不发，即都不提供。
  testsAs: z.array(ApiEndpointTestAsSchema).optional(),
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
 * 用过，中转站却没收到它的请求）、
 * codex_proxied（host、proxy、from：HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / windows_settings / system_settings，
 * fix：environment / windows / other：Codex 经代理发给中转站的请求被代理吞掉，直连能通、经代理不通）。
 * 后面会加新的 code；params 的值都是字符串，keys 用 ", " 连接。
 */
export const ApiEndpointAgentIssueSchema = z.object({
  code: z.string(),
  params: z.record(z.string(), z.string()).optional(),
  message: z.string(),
});
export type ApiEndpointAgentIssue = z.infer<typeof ApiEndpointAgentIssueSchema>;

/**
 * 提示区里一类还在用旧设置、要重开才用上新设置的副本（PRD 第 36 条）。`kind` 是字符串，app 按它翻译，
 * 认不出的、缺了该有的字段的照 `message`（英文）显示：osuna_sessions（count：Osuna 里在 CLI 启动时读的那部分
 * 最近一次变了之前启动、还在运行的会话）；cli、ide（count，since：其中最早的启动时间，ISO）：终端、编辑器里的 CLI；
 * app、embedded（count，since，app：桌面应用或自带这个 CLI 的应用名，每个应用一行）；
 * app_server（since、command：Codex 共用的后台 app-server 早于改动启动，有客户端连着或自动重启没成，要用户执行 command）；
 * app_server_restarted（since：Osuna 已重启那个 app-server）；claude_live_env（Claude Code 哪些改动正在跑的会话立刻用上，
 * 有要重开的才发）。后面可能加新的 kind。
 */
export const ApiEndpointReopenHintSchema = z.object({
  kind: z.string(),
  count: z.number().optional(),
  since: z.string().optional(),
  app: z.string().optional(),
  command: z.string().optional(),
  message: z.string(),
});
export type ApiEndpointReopenHint = z.infer<typeof ApiEndpointReopenHintSchema>;

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
    // 每个 Agent 要重开的副本，按 provider 索引，与请求的 provider 无关；老 daemon 不发。
    reopenHints: z.record(z.string(), z.array(ApiEndpointReopenHintSchema)).optional(),
    // 整台主机的长对话设置，与请求的 provider 无关；老 daemon 不发。
    longConversations: ApiEndpointLongConversationsSchema.optional(),
    // 已禁用的模型（整台主机共用，照存的样子）：完整 id 或 glob，不分大小写；老 daemon 不发。
    disabledModels: z.array(z.string()).optional(),
    // 接口名显示方式（endpoint-names.ts 的 API_ENDPOINT_NAME_DISPLAYS），整台主机共用；没设为 always，老 daemon 不发。
    endpointNameDisplay: z.string().optional(),
    // 接口名显示方式管不到的 Agent（provider）：它的模型列表里本来就没有 Osuna 给的接口名
    // （用 API key 接的 Codex 只列光秃秃的名字）。老 daemon 不发。
    endpointNamesUnreached: z.array(z.string()).optional(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointListResponse = z.infer<typeof ApiEndpointListResponseSchema>;

/**
 * 没有 endpointId 是新建，有则更新。更新时省略 apiKey 表示保留原 key。
 * 新建时省略 apiKey 即这家没有 key，发请求时不带认证头；老 daemon（没有 apiEndpointManagement）新建时要求 apiKey。
 * modelMapping 每次都整份提交，省略即不映射；其余省略的字段保留这家原来的值。
 *
 * 新客户端带 baseUrls，不带 baseUrl / defaultModelId，models 可以为空；接口开关不在这里改。
 * 老客户端带 baseUrl（按 provider 落进对应格式）与 defaultModelId。
 * manualModels 省略即保留这家已有的手动添加模型；拉回来的上游清单只由 fetch_models 改。
 * searchesWeb 省略即保留这家原来的「自己能联网搜索」，老客户端保存时不会把它关掉。
 *
 * copyOf（复制，Duplicate）：新建时从这家起步——请求没给的字段（上游清单、手动添加的模型、联网搜索开关与以后加的设置）
 * 取它的，apiKey 留空就用它的 key；名称、标识重了 daemon 自动避让。与 endpointId 一起给时拒收。老 daemon 忽略它。
 *
 * templateId、region：从哪个模板加的、选的哪个区域或套餐（地址由客户端按模板填好放进 baseUrls）。
 * 不认识的模板、不属于它的区域拒收；省略即保留这家原来的。老 daemon 忽略它们。
 *
 * icon：「自定义」加的接口的图标（取值见 ApiEndpointSchema.icon）；null 去掉，省略即保留。`file:` 的要先经 store_icon 存过；
 * 从模板加的接口带图标拒收。老 daemon 忽略它。
 *
 * modelScope：服务范围，省略即保留这家原来的（新建时为 picked）；vendor 时 models 由 daemon 按清单算，请求里的忽略。
 * 不认识的范围拒收。autoPick：自动勾选规则，整份替换，空数组清掉；改了规则时当前清单里匹配的也勾上（照 magpie）。
 * 不是规则的（没有 *、不以 re: 开头）或读不懂的拒收。老 daemon 忽略这两项。
 *
 * modelSettings：模型设置，整份替换（ApiEndpointModelSettingsSchema）；省略即保留这家原来的。数不是正整数、档位不是这个模型的、
 * 显示名超过 80 个字符的拒收。老 daemon 忽略它。
 *
 * catalog：添加窗口里保存前拉到的上游清单，随保存记作这家的上游清单（拉取时间记为保存时刻）；省略即保留这家原来的
 * （复制时是原来那家的）。老 daemon 忽略它。
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
  copyOf: z.string().optional(),
  templateId: z.string().optional(),
  region: z.string().optional(),
  icon: z.string().nullable().optional(),
  catalog: z.array(ApiEndpointModelSchema).optional(),
  modelScope: z.string().optional(),
  autoPick: z.array(z.string()).optional(),
  modelSettings: ApiEndpointModelSettingsSchema.optional(),
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
 * 接口顺序（Endpoint order）：整体改写，`endpointIds` 是新的顺序。同一个 id 出现两次或不是接口时拒收；
 * 没列出的接口按现在的先后接在后面（照 magpie SetOrder）。自动切换先后、只写模型名时归哪家都按它。
 */
export const ApiEndpointSetOrderRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.set_order.request"),
  requestId: z.string(),
  endpointIds: z.array(z.string()),
});
export type ApiEndpointSetOrderRequest = z.infer<typeof ApiEndpointSetOrderRequestSchema>;

export const ApiEndpointSetOrderResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.set_order.response"),
  payload: z.object({
    requestId: z.string(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointSetOrderResponse = z.infer<typeof ApiEndpointSetOrderResponseSchema>;

/**
 * 设长对话（照 magpie settings/full-context）：fullContext 开关「完整窗口」；compactAt 为正整数时设全局压缩阈值，
 * null 回到 272K，省略即不变。设成 272K 等于不设。数不是正整数时拒收。只有声明了 apiEndpointManagement 的 daemon 认它。
 */
export const ApiEndpointSetLongConversationsRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.set_long_conversations.request"),
  requestId: z.string(),
  fullContext: z.boolean(),
  compactAt: z.number().nullable().optional(),
});
export type ApiEndpointSetLongConversationsRequest = z.infer<
  typeof ApiEndpointSetLongConversationsRequestSchema
>;

export const ApiEndpointSetLongConversationsResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.set_long_conversations.response"),
  payload: z.object({
    requestId: z.string(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointSetLongConversationsResponse = z.infer<
  typeof ApiEndpointSetLongConversationsResponseSchema
>;

/**
 * 设已禁用的模型（照 magpie settings/disabled-models）：整份名单一起发，daemon 去掉首尾空白、空的与只差大小写的重复后存下。
 * 命中的模型从每家接口在服务的模型里去掉，中转站拒收对它的请求。只有声明了 apiEndpointManagement 的 daemon 认它。
 */
export const ApiEndpointSetDisabledModelsRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.set_disabled_models.request"),
  requestId: z.string(),
  models: z.array(z.string()),
});
export type ApiEndpointSetDisabledModelsRequest = z.infer<
  typeof ApiEndpointSetDisabledModelsRequestSchema
>;

export const ApiEndpointSetDisabledModelsResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.set_disabled_models.response"),
  payload: z.object({
    requestId: z.string(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointSetDisabledModelsResponse = z.infer<
  typeof ApiEndpointSetDisabledModelsResponseSchema
>;

/**
 * 设接口名显示方式（照 magpie settings/plain-names）：display 是 always、clash 或 never，别的拒收。
 * 作用于聊天模型选择器、默认模型选项和写给 Codex 的显示名。只有声明了 apiEndpointManagement 的 daemon 认它。
 */
export const ApiEndpointSetEndpointNameDisplayRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.set_endpoint_name_display.request"),
  requestId: z.string(),
  display: z.string(),
});
export type ApiEndpointSetEndpointNameDisplayRequest = z.infer<
  typeof ApiEndpointSetEndpointNameDisplayRequestSchema
>;

export const ApiEndpointSetEndpointNameDisplayResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.set_endpoint_name_display.response"),
  payload: z.object({
    requestId: z.string(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointSetEndpointNameDisplayResponse = z.infer<
  typeof ApiEndpointSetEndpointNameDisplayResponseSchema
>;

/**
 * 读回一家接口已保存的 key 原文（编辑窗口的「显示」）；没有 key 时 apiKey 为 null。照 magpie 不确认、不限次数。
 * 只有声明了 apiEndpointManagement 的 daemon 认它。
 */
export const ApiEndpointRevealKeyRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.reveal_key.request"),
  requestId: z.string(),
  endpointId: z.string(),
});
export type ApiEndpointRevealKeyRequest = z.infer<typeof ApiEndpointRevealKeyRequestSchema>;

export const ApiEndpointRevealKeyResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.reveal_key.response"),
  payload: z.object({
    requestId: z.string(),
    apiKey: z.string().nullable(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointRevealKeyResponse = z.infer<typeof ApiEndpointRevealKeyResponseSchema>;

/** 图标图片最多 1 MB：base64 写出来最长这么多字，更长的在解码前就拒收。 */
export const API_ENDPOINT_ICON_MAX_BASE64_LENGTH = 4 * Math.ceil((1 << 20) / 3);

/**
 * 存一张图片给接口当图标（照 magpie 的 `file:` 图标）：data 是 base64 的原始字节，PNG、JPEG、GIF、WebP、ICO 或 SVG，
 * 不超过 1 MB。按内容起名，同一张只存一份；返回保存时要带的 icon 值。没有接口再用它时 daemon 删掉副本。
 * 失败的 code：icon_too_large、icon_not_image。只有声明了 apiEndpointManagement 的 daemon 认它。
 */
export const ApiEndpointStoreIconRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.store_icon.request"),
  requestId: z.string(),
  data: z.string().max(API_ENDPOINT_ICON_MAX_BASE64_LENGTH),
});
export type ApiEndpointStoreIconRequest = z.infer<typeof ApiEndpointStoreIconRequestSchema>;

export const ApiEndpointStoreIconResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.store_icon.response"),
  payload: z.object({
    requestId: z.string(),
    icon: z.string().nullable(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointStoreIconResponse = z.infer<typeof ApiEndpointStoreIconResponseSchema>;

/**
 * 从网站取图标（照 magpie FaviconFor）：daemon 按 baseUrl 找它所在网站的图标，像 store_icon 一样存下，返回 icon 值；
 * new-api / one-api 面板没有自己的 logo 时用 name 的首字画一块。只连公网 https 主机，只在用户点按钮时发。
 * 可以用 cancel 按 requestId 取消。失败的 code：site_icon_no_address（地址不是网址）、site_icon_local（地址在本机或局域网）、
 * site_icon_not_found（message 写明问过哪些站点与最后的原因）。只有声明了 apiEndpointManagement 的 daemon 认它。
 */
export const ApiEndpointFetchSiteIconRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.fetch_site_icon.request"),
  requestId: z.string(),
  baseUrl: z.string(),
  name: z.string(),
});
export type ApiEndpointFetchSiteIconRequest = z.infer<typeof ApiEndpointFetchSiteIconRequestSchema>;

export const ApiEndpointFetchSiteIconResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.fetch_site_icon.response"),
  payload: z.object({
    requestId: z.string(),
    icon: z.string().nullable(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointFetchSiteIconResponse = z.infer<
  typeof ApiEndpointFetchSiteIconResponseSchema
>;

/** 取回 store_icon 存下的图片（icon 是 `file:<名字>`）：base64 与 MIME 类型；不在了为 not_found。 */
export const ApiEndpointReadIconRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.read_icon.request"),
  requestId: z.string(),
  icon: z.string(),
});
export type ApiEndpointReadIconRequest = z.infer<typeof ApiEndpointReadIconRequestSchema>;

export const ApiEndpointIconImageSchema = z.object({
  data: z.string(),
  mimeType: z.string(),
});
export type ApiEndpointIconImage = z.infer<typeof ApiEndpointIconImageSchema>;

export const ApiEndpointReadIconResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.read_icon.response"),
  payload: z.object({
    requestId: z.string(),
    icon: ApiEndpointIconImageSchema.nullable(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointReadIconResponse = z.infer<typeof ApiEndpointReadIconResponseSchema>;

/**
 * 模板（Template）的一个区域或套餐：自己的一套各格式地址；keysUrl、website、modelsDevIds 只在和模板的不同时给。
 * models 是这个套餐的内置模型清单；listsModels 是模板整体没有清单接口（noModelList）时这里却有。
 */
export const ApiEndpointTemplateRegionSchema = z.object({
  id: z.string(),
  // 英文原名；客户端认得的按界面语言显示，认不出的照原文。
  name: z.string(),
  baseUrls: z.array(ApiEndpointBaseUrlSchema),
  keysUrl: z.string().optional(),
  website: z.string().optional(),
  modelsDevIds: z.array(z.string()).optional(),
  models: z.array(z.string()).optional(),
  listsModels: z.boolean().optional(),
});
export type ApiEndpointTemplateRegion = z.infer<typeof ApiEndpointTemplateRegionSchema>;

/**
 * 内置模板，随 daemon 版本走、不联网下载（照 magpie presets.go）。`group` 是字符串：vendor（厂商）、relay（中转服务）、
 * local（本机），以后可能加新的。国际站与中国站各是一个模板，中国站的 id 是国际站的加 `-cn`（照 magpie），客户端合成一行。
 * regions 的第一个是默认；`regionLabel` 说它们是 region（区域）还是 plan（套餐），没有即 region。
 * keyOptional：不填 key 也能用（本机服务、免费模型）；keyHint 是 key 框里的英文提示。
 * modelsDevIds 是 models.dev 里的 id（补模型资料用）；models 是内置模型清单，noModelList 时它就是清单；
 * modelIdPrefix：这家的清单里只有以它开头的模型属于这个模板（照 magpie Only）。headerHints 是厂商文档里可加的请求头名。
 * endpointExample：要填用户自己资源地址的厂商（Azure OpenAI）没有 baseUrls，表单按这个示例要一个地址，endpointHint 是框下的英文说明
 * （照 magpie Endpoint、EndpointHint）。
 */
export const ApiEndpointTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string().optional(),
  group: z.string(),
  note: z.string().optional(),
  baseUrls: z.array(ApiEndpointBaseUrlSchema),
  website: z.string().optional(),
  keysUrl: z.string().optional(),
  keyOptional: z.boolean().optional(),
  keyHint: z.string().optional(),
  modelsDevIds: z.array(z.string()),
  regionLabel: z.string().optional(),
  regions: z.array(ApiEndpointTemplateRegionSchema).optional(),
  headerHints: z.array(z.string()).optional(),
  models: z.array(z.string()).optional(),
  noModelList: z.boolean().optional(),
  modelIdPrefix: z.string().optional(),
  endpointExample: z.string().optional(),
  endpointHint: z.string().optional(),
});
export type ApiEndpointTemplate = z.infer<typeof ApiEndpointTemplateSchema>;

/** 模板清单（「+」先出的列表）。只有声明了 apiEndpointManagement 的 daemon 认它。 */
export const ApiEndpointListTemplatesRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.list_templates.request"),
  requestId: z.string(),
});
export type ApiEndpointListTemplatesRequest = z.infer<typeof ApiEndpointListTemplatesRequestSchema>;

export const ApiEndpointListTemplatesResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.list_templates.response"),
  payload: z.object({
    requestId: z.string(),
    templates: z.array(ApiEndpointTemplateSchema),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointListTemplatesResponse = z.infer<
  typeof ApiEndpointListTemplatesResponseSchema
>;

/**
 * daemon 在主机上向上游列出模型，key 不经过客户端。编辑已保存的接口时带 endpointId、
 * 省略 apiKey（或留空），就用已保存的 key；没有已保存的 key 时不带认证头（老 daemon 拒绝）。可以用 cancel 按 requestId 取消。
 *
 * 新客户端带 `format`：baseUrl 是这种请求格式的地址，认证头按格式给，provider 不再起作用；
 * 同时带 endpointId 时，列出的模型记作这家的上游清单（列表里的 `catalog`），除非带 `preview: true`：
 * 添加窗口保存前拉的只看不记，endpointId 只为借那家已保存的 key（复制时 key 框留空）。
 * 老客户端不带 format，按 provider 走 CLI 自己的格式，只读不记。
 *
 * templateId、region：表单当前的模板与区域或套餐（同 save）。给了就按它们定认证头、Azure 的地址与列法、
 * 没有清单接口时的内置清单，不看 endpointId 那家记下的；省略时用那家的，没有 endpointId 即「自定义」。
 * 不认识的模板拒收。老 daemon 忽略这三个字段。
 *
 * baseUrls：这家的全部格式地址。给了就每种格式各拉一次、按模型 id 合并（照 magpie）：顺序以先列出的为准，
 * 显示名与模型资料先列出的格式说了算，没说的由后面的补；baseUrl、format 不再起作用（照旧要带，给老 daemon）。
 * 有一种格式答上就算成功；记作上游清单时，这次没答上的格式上次列过的模型留着。只有声明了 apiEndpointManagement 的 daemon 认它。
 */
export const ApiEndpointFetchModelsRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.fetch_models.request"),
  requestId: z.string(),
  provider: z.string(),
  endpointId: z.string().optional(),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  format: z.string().optional(),
  preview: z.boolean().optional(),
  templateId: z.string().optional(),
  region: z.string().optional(),
  baseUrls: z.array(ApiEndpointBaseUrlSchema).optional(),
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
 * 丢掉拉回的清单：清空这家的上游清单与拉取时间（照 magpie unfetch），已选与手动添加的模型不动，下次拉取再有。
 * 只有声明了 apiEndpointManagement 的 daemon 认它。
 */
export const ApiEndpointForgetCatalogRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.forget_catalog.request"),
  requestId: z.string(),
  endpointId: z.string(),
});
export type ApiEndpointForgetCatalogRequest = z.infer<typeof ApiEndpointForgetCatalogRequestSchema>;

export const ApiEndpointForgetCatalogResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.forget_catalog.response"),
  payload: z.object({
    requestId: z.string(),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointForgetCatalogResponse = z.infer<
  typeof ApiEndpointForgetCatalogResponseSchema
>;

/** 一次自动检测最多问这么多个表单里的模型（照 magpie DetectMax）；daemon 截断、界面说明都用它。 */
export const API_ENDPOINT_DETECT_MAX_MODELS = 30;

/**
 * 自动检测：daemon 从用户填的一个地址推出三种请求格式各自的地址，按每种格式各发一条最小对话请求（照 magpie Detect）。
 * 问哪个模型：`modelId`（用户填的试用模型）每种格式都问它；没填时按格式从 `modelIds`（表单里已选、还没保存的模型，
 * 最多取前 API_ENDPOINT_DETECT_MAX_MODELS 个）挑，也没有才向上游列出模型挑。key 的规则和 fetch_models 相同；可以用 cancel 按 requestId 取消。
 * 老 daemon 忽略 modelId、modelIds，总是先列模型。
 * `eachModel`（逐个模型，照 magpie Detect 的 Each picked model）：`modelIds` 的前 API_ENDPOINT_DETECT_MAX_MODELS 个
 * 每个在每种格式上各问一次，回应里 `models` 逐个模型列出，`results` 是每种格式第一个答上的（都没答上为第一个模型的）。
 * apiEndpointManagement 能力位与 eachModel 在同一个版本里加入（还没发布过声明它的 daemon），所以声明了它的 daemon 都认 eachModel。
 */
export const ApiEndpointDetectFormatsRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.detect_formats.request"),
  requestId: z.string(),
  endpointId: z.string().optional(),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  modelId: z.string().optional(),
  modelIds: z.array(z.string()).optional(),
  eachModel: z.boolean().optional(),
});
export type ApiEndpointDetectFormatsRequest = z.infer<typeof ApiEndpointDetectFormatsRequestSchema>;

/**
 * 一种格式的检测结果。`status` 是字符串：ok（检测通过）、auth_failed（上游回 401 / 403，key 无效）、
 * not_detected（其余失败，原因在 `message`）。`url` 是这种格式的建议地址；`httpStatus` 没收到响应时为 null。
 * `durationMs` 是这一问的耗时，`modelId` 是问的模型（没有模型可问时没有）；老 daemon 都不发。
 * `code`、`params`：逐个模型识别时 daemon 自己定的原因（界面按语言说，`message` 是英文原文）：
 * upstream_timeout（params.seconds 秒内没回）、batch_timeout（问了，整次识别到点还没回）、not_asked（整次识别到点，没轮到问）、
 * image_model（生图模型，不问）、no_model_to_try（没有模型可问）、models_list_failed（列模型失败，params.detail 是列模型的原因）、
 * upstream_unreachable（没连上，params.detail 是网络库的原话）、wrong_shape（2xx 但不是 params.format 这种格式的回答）。
 * 上游给的失败没有 code。
 */
export const ApiEndpointFormatDetectionSchema = z.object({
  format: z.string(),
  url: z.string(),
  status: z.string(),
  httpStatus: z.number().nullable(),
  message: z.string().nullable(),
  durationMs: z.number().optional(),
  modelId: z.string().optional(),
  code: z.string().optional(),
  params: z.record(z.string(), z.string()).optional(),
});
export type ApiEndpointFormatDetection = z.infer<typeof ApiEndpointFormatDetectionSchema>;

/** 逐个模型识别的一个模型：每种格式一条结论，按 Anthropic、Chat、Responses。 */
export const ApiEndpointModelDetectionSchema = z.object({
  modelId: z.string(),
  results: z.array(ApiEndpointFormatDetectionSchema),
});
export type ApiEndpointModelDetection = z.infer<typeof ApiEndpointModelDetectionSchema>;

/**
 * 请求本身被拒（地址无效、找不到接口、被取消；老 daemon 还有缺 key）时 `results` 为空，原因在 `error`。
 * `models` 只在逐个模型识别（eachModel）时有。
 */
export const ApiEndpointDetectFormatsResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.detect_formats.response"),
  payload: z.object({
    requestId: z.string(),
    results: z.array(ApiEndpointFormatDetectionSchema),
    models: z.array(ApiEndpointModelDetectionSchema).optional(),
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
 *
 * 添加 / 编辑窗口保存前测试时带上表单的值：templateId、region 同 fetch_models；`modelIds` 是表单里的模型（已选的在前、
 * 拉到的清单在后），给了就从它们里挑，不看 endpointId 那家的；挑不到时照常列一次（没有清单接口的模板用内置清单）。
 * 老 daemon 忽略这三个字段。
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
  templateId: z.string().optional(),
  region: z.string().optional(),
  modelIds: z.array(z.string()).optional(),
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

/** 请求本身被拒（找不到接口、被取消；老 daemon 还有缺 key）时 `result` 为 null，原因在 `error`。 */
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

/**
 * 测试模型（Test models，照 magpie TestModels）：daemon 给这家的每个在服务的模型发一条最小请求（「hi」，回复上限 16），
 * 并发 4 个、单个 20 秒、整批 3 分钟。给了 `modelId` 只测这一个（可以不在服务）。`method` 是测法：缺省 plain，
 * 按这家的地址依次试格式（设了「只用这种格式」的只试那种）；claude_code、codex 带中转站记下的那个 CLI 的请求头、
 * 以流式发到那个 CLI 的格式（ADR 0013，见 ApiEndpointTestAsSchema）；这家不提供的测法拒收（invalid_input），
 * 还没有 Claude Code 样本时每个模型记成 cli_sample_missing、不发请求。以后加的测法老 daemon 拒收。
 * 开测前推一条 test_models.started（要测哪些），每测完一个推一条 test_models.progress，最后回 test_models.response 带全部结果。用 cancel 按 requestId 取消：
 * 不再发新请求，回应带已测完的结果与 cancelled。只有声明了 apiEndpointManagement 的 daemon 认它。
 */
export const API_ENDPOINT_MODEL_TEST_METHODS = ["plain", "claude_code", "codex"] as const;
export type ApiEndpointModelTestMethod = (typeof API_ENDPOINT_MODEL_TEST_METHODS)[number];

export const ApiEndpointTestModelsRequestSchema = z.object({
  type: z.literal("provider.api_endpoint.test_models.request"),
  requestId: z.string(),
  endpointId: z.string(),
  modelId: z.string().optional(),
  method: z.string().optional(),
});
export type ApiEndpointTestModelsRequest = z.infer<typeof ApiEndpointTestModelsRequestSchema>;

/**
 * 一个模型的测试结果。`format` 是答上（或最后失败）的请求格式，没发请求（已禁用、没有能问的地址）时为 null；
 * `status` 是 HTTP 状态码，没收到响应时为 null；`durationMs` 是这个模型花的时间。
 * `error.code`：model_disabled（params：model、pattern）、auth_failed、upstream_error、upstream_unreachable、
 * upstream_timeout（单个超时，params：seconds）、batch_timeout（整批超时，没来得及测或被打断）、no_format（这家没有能问它的地址）、
 * cli_sample_missing（按 Claude Code 测，但还没有 Claude Code 请求经过中转站）。
 * `error.message` 是原因本身（上游的原文），不带请求地址与状态码。
 */
export const ApiEndpointModelTestResultSchema = z.object({
  modelId: z.string(),
  ok: z.boolean(),
  format: z.string().nullable(),
  status: z.number().nullable(),
  durationMs: z.number(),
  error: ApiEndpointErrorSchema.nullable(),
});
export type ApiEndpointModelTestResult = z.infer<typeof ApiEndpointModelTestResultSchema>;

/**
 * 开测前推一条：daemon 这次要测的模型，按测试顺序（一周内下线的不在里面，被禁用的在、会直接记成已禁用）。
 * 客户端据此标「测试中」，没列进来的不标。
 */
export const ApiEndpointTestModelsStartedSchema = z.object({
  type: z.literal("provider.api_endpoint.test_models.started"),
  payload: z.object({
    requestId: z.string(),
    modelIds: z.array(z.string()),
  }),
});
export type ApiEndpointTestModelsStarted = z.infer<typeof ApiEndpointTestModelsStartedSchema>;

/** 测完一个模型推一条；done / total 是这次已测完与一共要测的个数。 */
export const ApiEndpointTestModelsProgressSchema = z.object({
  type: z.literal("provider.api_endpoint.test_models.progress"),
  payload: z.object({
    requestId: z.string(),
    result: ApiEndpointModelTestResultSchema,
    done: z.number(),
    total: z.number(),
  }),
});
export type ApiEndpointTestModelsProgress = z.infer<typeof ApiEndpointTestModelsProgressSchema>;

/** 全部结果按测试顺序；请求被拒（找不到接口、不认识的测法）时为空，被取消时是已测完的，原因在 `error`。 */
export const ApiEndpointTestModelsResponseSchema = z.object({
  type: z.literal("provider.api_endpoint.test_models.response"),
  payload: z.object({
    requestId: z.string(),
    results: z.array(ApiEndpointModelTestResultSchema),
    error: ApiEndpointErrorSchema.nullable(),
  }),
});
export type ApiEndpointTestModelsResponse = z.infer<typeof ApiEndpointTestModelsResponseSchema>;
