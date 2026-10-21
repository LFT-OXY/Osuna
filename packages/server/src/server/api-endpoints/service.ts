// 保留 claude.ai 登录时口令的两种不一致移植自 magpie（https://github.com/yetone/magpie，internal/agent/claude.go 的 Check）；
// 跟着 CLI 自己存下的选择走与「模型被换掉」照 internal/agent/claude.go 的 Follow、internal/agent/applied.go 的 Drift（replaced）与 Keep；
// 后台小任务与 Subagent 模型照 internal/agent/claude.go 的 writeTiers、tierWith 与 subagent、subagent_effort 字段；
// Codex 的默认 Subagent 模型、档位与记忆模型照 internal/agent/codex.go 的 subagents、subagent_effort、memories 字段与 settle、dropSubEffort
// 「被绕过」只在设置本身没问题时看、改写时刻随「重新应用」更新，照 internal/agent/applied.go 的 Drift、record 与 Reapply
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { randomBytes, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type pino from "pino";
import {
  API_ENDPOINT_MODEL_SCOPES,
  API_ENDPOINT_MODEL_TEST_METHODS,
  API_ENDPOINT_MODEL_TIERS,
  API_ENDPOINT_REQUEST_FORMATS,
  apiEndpointHasModelMapping,
  type ApiEndpointModelScope,
  type ApiEndpoint,
  type ApiEndpointAgentIssue,
  type ApiEndpointAgentSettings,
  type ApiEndpointBaseUrl,
  type ApiEndpointConnection,
  type ApiEndpointCooldown,
  type ApiEndpointError,
  type ApiEndpointFormatDetection,
  type ApiEndpointModelDetection,
  type ApiEndpointHealthIssue,
  type ApiEndpointListResponse,
  type ApiEndpointLongConversations,
  type ApiEndpointModel,
  type ApiEndpointModelMapping,
  type ApiEndpointModelFacts,
  type ApiEndpointModelSettings,
  type ApiEndpointCooldownSettings,
  type ApiEndpointRef,
  type ApiEndpointRequestFormat,
  type ApiEndpointSwitchOffFile,
  type ApiEndpointSwitchOffPreview,
  type ApiEndpointIconImage,
  type ApiEndpointTemplate,
  type ApiEndpointTestConnectionResult,
  type ApiEndpointVendorStatusResponse,
  type ApiEndpointImportItem,
  type ApiEndpointImportPick,
  type ApiEndpointImportSource,
  type ApiEndpointImportCandidate,
  type ApiEndpointImportLinkPreview,
  API_ENDPOINT_IMPORT_ACTIONS,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  API_ENDPOINT_TEMPLATES,
  findTemplate,
  listsNoModels,
  modelFormatsAt,
  planModelsOf,
  servedFormats,
  templateBaseUrl,
  templateBaseUrls,
  type TemplatePlace,
} from "./templates.js";
import { resolveAgentHookConfigPath } from "../../terminal/agent-hooks/agent-hook-installer.js";
import { claudeAgentHookProvider } from "../../terminal/agent-hooks/claude/claude.js";
import { codexAgentHookProvider } from "../../terminal/agent-hooks/codex/codex.js";
import type {
  AgentModelDefinition,
  AgentSelectOption,
  ApiEndpointModelGroup,
  ApiEndpointSideModelOption,
} from "../agent/agent-sdk-types.js";
import {
  findCodexCommand,
  normalizeOpenAICompatibleBaseUrl,
} from "../agent/providers/codex-app-server-agent.js";
import {
  CLAUDE_CLOUD_SWITCH_KEYS,
  claudeManagedSettingsFiles,
  defaultClaudeManagedSettingsDir,
  findClaudeCloudSwitch,
  managedBaseUrl,
  readClaudeEnvFile,
  type ClaudeCloudSwitchFinding,
} from "./claude-cloud-switches.js";
import {
  createGatewayReach,
  createGatewayProbe,
  proxyBase,
  type ProbeGatewayAt,
} from "./gateway-reach.js";
import { createLoginShellEnvReader, type ReadLoginShellEnv } from "./login-shell-env.js";
import { claudeHints, markOneMillion, type ClaudeHintModel } from "./claude-model-hints.js";
import { claudeSpelled } from "./claude-spelling.js";
import {
  applyClaudeApiEndpoint,
  inspectClaudeSettings,
  keepClaudeCliModel,
  readClaudeCliPicks,
  readClaudeModel,
  readClaudeStartupReads,
  type ClaudeSettingsUnparsableReason,
  restoreClaudeOfficial,
  type ClaudeAuthTokenState,
  type ClaudeGatewayWiring,
  type ClaudeSubagentWiring,
  type ClaudeSettingsTakeover,
} from "./claude-settings-patch.js";
import {
  applyCodexApiEndpoint,
  CODEX_API_ENDPOINT_PROVIDER_ID,
  forgetCodexEffortOriginal,
  inspectCodexConfig,
  keepCodexCliModel,
  readCodexCliPicks,
  isCodexMirrorKey,
  codexKeepsOwnModel,
  readCodexCatalogPath,
  readCodexModel,
  readCodexStartupReads,
  readCodexMultiAgentV2,
  readCodexRespectsSystemProxy,
  readCodexReasoningEffort,
  refreshCodexProviderTable,
  restoreCodexOfficial,
  type CodexConfigTakeover,
  type CodexSubagentWiring,
} from "./codex-config-patch.js";
import {
  buildCodexModelCatalog,
  codexDefaultLevel,
  codexEndpointEntries,
  type CodexEndpointListing,
} from "./codex-model-catalog.js";
import {
  claudeClamp,
  defaultThinkingLevels,
  settleCodexThinking,
  takesUltraCode,
  thinkingOptionsOf,
} from "./default-thinking.js";
import { CLAUDE_ULTRA_CODE } from "./claude-model-name.js";
import type { CliModelHold, CliPicks, CliSidePick } from "./cli-model-hold.js";
import {
  codexListTag,
  codexOwnFirstModel,
  codexOwnModels,
  markCodexModelsCacheStale,
  readCodexModelsCache,
  type CodexOwnModel,
} from "./codex-models-cache.js";
import type { CodexSignIn, ReadCodexSignIn } from "./codex-sign-in.js";
import { CHATGPT_BACKEND_PATH } from "./gateway/chatgpt-backend.js";
import { FIXED_EFFORTS, askedAt } from "./gateway/fixed-effort.js";
import type { ChatGptModelsListing } from "./gateway/chatgpt-models.js";
import { agentsV1Tag } from "./codex-agent-versions.js";
import type { EndpointCooldowns } from "./gateway/cooldown.js";
import {
  findCliBypass,
  readCliUse,
  type CliBypass,
  type GatewaySightings,
  type ReadCliUse,
} from "./cli-bypass.js";
import type { RetiredModels } from "./retired-models.js";
import { switchOffFileChange } from "./switch-off-preview.js";
import {
  createSystemHostProcesses,
  HostProcessesError,
  type FindCodexCommand,
  type HostProcesses,
} from "./host-processes.js";
import {
  CODEX_PROXY_ENV_KEYS,
  codexProxiedMessage,
  CodexProxyCheck,
  probeThroughProxy,
  type ProbeThroughProxy,
  type ProxyEnv,
} from "./codex-proxy.js";
import { createSystemProxyReader, NO_SYSTEM_PROXY, type SystemProxy } from "./system-proxy.js";
import {
  CliReopenHints,
  cliChangedAt,
  type CliStartupReads,
  type ReopenHintsSubject,
} from "./reopen-hints.js";
import { API_ENDPOINT_GATEWAY_PATH } from "./gateway/gateway.js";
import { someEndpointSearchesWeb } from "./gateway/web-search.js";
import {
  readOptionalFile,
  writeConfigFileGuarded,
  type ConfigFileChange,
  type ConfigFilePlan,
} from "./config-file.js";
import {
  AGENT_REQUEST_FORMAT,
  agentTargetEndpoint,
  defaultModelProvidersOf,
  maskApiKey,
  bareDefaultModel,
  defaultModelChoices,
  findEndpoint,
  isDefaultModelChoice,
  namedDefaultModel,
  generateEndpointSlug,
  legacyAgentBaseUrl,
  projectedBaseUrl,
  projectedDefaultModelId,
  settleAgentSettings,
  endpointModelGroups,
  type EndpointGroupModel,
  isAutoModeReviewed,
  usableModels,
} from "./host-endpoints.js";
import {
  API_ENDPOINT_PROVIDERS,
  ApiEndpointStore,
  ApiEndpointsFileUnparsableError,
  endpointNameDisplayOf,
  type ApiEndpointProvider,
  type ApiEndpointState,
  type GatewayTokens,
  type StoredApiEndpoint,
} from "./store.js";
import { testUpstreamConnection } from "./upstream-connection.js";
import {
  mappedTierModel,
  pickDefaultModel,
  servedModel,
  type DefaultModelPick,
  type DefaultModelPickInput,
  type DefaultModelReconnect,
} from "./default-model-pick.js";

/** 让一个 Agent 的 CLI 配置跟上：wiring 为 null 时切回官方；agent 是落下后的设置，切回官方时记下它的默认模型（again）。 */
interface CliSync {
  provider: ApiEndpointProvider;
  wiring: CliWiring | null;
  agent: ApiEndpointAgentSettings;
  // CLI 自己换过的模型也写回默认模型（「重新应用」、在 Osuna 里换了默认模型）；省略为留着 CLI 的。
  shouldRewriteModel?: boolean;
}

/** 把中转站写进 CLI 配置：要写的内容，与 CLI 自己换过的模型要不要写回。 */
interface CliEndpointWrite {
  wiring: CliWiring;
  shouldRewriteModel: boolean;
}

/** Osuna 对话里一个接口模型的思考档位选项与新对话的起步档位；模型没有档位时为空。 */
type ChatThinking = Pick<AgentModelDefinition, "thinkingOptions" | "defaultThinkingOptionId">;

// 没设默认思考档位时 Osuna 的 Claude 新对话起步的档位，同 Claude 自定义模型（agent/providers/claude/model-manifest.ts）。
const CLAUDE_START_THINKING = "high";

/** 挑默认模型时从 CLI 配置与接管记录里读的那些。 */
type CliPickInput = Omit<DefaultModelPickInput, "state" | "provider">;
import { detectUpstreamFormats, pickProbeModel, probeUpstreamFormat } from "./upstream-detect.js";
import { DETECT_EACH_DEFAULTS, detectEachModel, type DetectEachLimits } from "./detect-models.js";
import {
  cachedCodexVersion,
  codexSignHeaders,
  newestCodexVersion,
  readCodexSystem,
  SeenCodexVersion,
} from "./cli-header-samples.js";
import {
  cliTestAddress,
  cliTestRefusal,
  cliTestsOffered,
  CLI_SAMPLE_MISSING,
  isCliTestClient,
  needsCliSample,
} from "./test-as.js";
import {
  MODEL_TEST_DEFAULTS,
  runModelTests,
  type ModelTestAttempt,
  type ModelTestIdentity,
  type ModelTestLimits,
  type ModelTestPlan,
  type ModelTestProgress,
  type ModelTestsOutcome,
} from "./model-tests.js";
import { isClaudeModel } from "./gateway/routing.js";
import {
  hostOf,
  mergeModelFacts,
  type EndpointModelFacts,
  type ModelFacts,
} from "./model-facts.js";
import { ModelsDevCatalog } from "./models-dev.js";
import {
  createPublicFetchSite,
  fetchIconPicture,
  findSiteIcon,
  SiteIconError,
  type FetchSite,
  type SiteIconFailure,
} from "./site-icon.js";
import {
  EndpointIcons,
  iconMimeType,
  isBuiltInIconName,
  StoreIconError,
  storedIconName,
  type StoredIcon,
  type StoreIconFailure,
} from "./endpoint-icons.js";
import { isErrnoException } from "../../utils/errno.js";
import { REAL_PRICING_TIMERS, type UsagePricingTimers } from "../usage/pricing/service.js";
import {
  fetchUpstreamModels,
  type ListedModel,
  type UpstreamFailure,
  type UpstreamFailureCode,
} from "./upstream-models.js";
import {
  keepFailedFormats,
  mergeFormatLists,
  type CatalogModel,
  type FormatList,
} from "./catalog-merge.js";
import { CatalogRefreshSchedule, type CatalogRefreshOutcome } from "./catalog-refresh.js";
import { VendorStatusPages, vendorOfBaseUrls, type VendorId } from "./vendor-status.js";
import type { DataFileSystem } from "./last-good.js";
import {
  defaultImportSourcePaths,
  readImportSources,
  sameAccount,
  settleImports,
  type FoundEndpoint,
  type HeldEndpoint,
  type ImportReadContext,
  type ImportSourcePaths,
  type SettledEntry,
} from "./import-apps.js";
import {
  cutImportLinkName,
  ImportLinkRefusedError,
  isKeyLike,
  parseImportLink,
  type ParsedImportLink,
} from "./import-link.js";
import {
  askedDisabledBy,
  disabledMessage,
  endpointDisabledBy,
  withoutDisabledModels,
} from "./disabled-models.js";
import { cleanDisabledModels } from "@getpaseo/protocol/api-endpoint/disabled-models";
import { isPreselectedImport } from "@getpaseo/protocol/api-endpoint/import-offer";
import {
  isApiEndpointNameDisplay,
  showsEndpointNames,
  type ApiEndpointNameDisplay,
} from "@getpaseo/protocol/api-endpoint/endpoint-names";
import type { AutoPickRuleProblem } from "@getpaseo/protocol/api-endpoint/auto-pick-rules";
import {
  WORKING_WINDOW,
  distinctModelLabels,
  pinnedFormat,
  resolveModelFacts,
  upstreamModelName,
} from "@getpaseo/protocol/api-endpoint/model-settings";
import {
  cleanRequestHeaders,
  extraBodyProblem,
  type ApiEndpointKeyHeader,
  type ExtraBodyProblem,
} from "@getpaseo/protocol/api-endpoint/request-extras";
import {
  API_ENDPOINT_COOLDOWN_MAX_DAYS,
  API_ENDPOINT_COOLDOWN_MAX_MINUTES,
  cooldownSettingsProblem,
  type ApiEndpointCooldownField,
} from "@getpaseo/protocol/api-endpoint/cooldown-settings";
import {
  closeUncheckedDispatchers,
  liveUncheckedHostsOf,
  releaseUncheckedHosts,
  uncheckedHostsOf,
} from "./insecure-tls.js";
import { storedRequestExtras, type RequestExtras } from "./request-extras.js";
import { endpointKnowsModel, settleModelSettings } from "./model-settings.js";
import {
  cleanAutoPickRules,
  followsList,
  keepValidMapping,
  settleServedModels,
  vendorServedModels,
} from "./model-scope.js";

export type ApiEndpointErrorCode =
  | "unsupported_provider"
  | "invalid_input"
  | "not_found"
  | "config_unparsable"
  // 写入时文件一直在被别人改，重试三次后放弃，什么都没写。
  | "config_conflict"
  // daemon 内置中转站用不了，总开关打不开。
  | GatewayUnavailableCode
  // endpoints.json 读不懂；什么都不写。
  | "endpoints_unparsable"
  // 没有开着且已选模型的接口，总开关打不开。
  | "no_usable_model"
  // 模型设置里的数不是正整数、档位不是这个模型的、显示名太长，或设的模型这家没有。
  | "invalid_model_settings"
  // 附加请求体字段没名字、是保留字段、同名写了两次（params.reason、field）。
  | "invalid_extra_body"
  // 从模板加的接口打开不校验证书（params.template）。
  | "insecure_tls_template"
  // 冷却设置的分钟数不是 0 到八天的整数（params.field、max）。
  | "invalid_cooldown_settings"
  // 导入时那一条已经不在它的软件里了（重新扫描）；替换给的不是名称撞上的那条（params.name）。
  | "import_gone"
  | "import_cannot_replace"
  // 加某一条时写文件等出了错（params.reason 是 errno 或错误名）。
  | "import_failed"
  // 「忽略」没记上（params.reason：errno、endpoints_unparsable 或错误名）。
  | "import_ignore_failed"
  // 不安全或读不懂的导入链接（params.reason 见 protocol 的 API_ENDPOINT_IMPORT_LINK_REFUSALS，另有 field、template、region）。
  | "import_link_refused"
  // 给接口当图标的图片超过 1 MB，或不是认得的图片格式。
  | StoreIconFailure
  // 从网站取图标：地址不是网址、在本机或局域网、找不到图标。
  | SiteIconFailure
  | UpstreamFailureCode;

const DEFAULT_UPSTREAM_TIMEOUT_MS = 15_000;
// Claude Code /model 里已带接口名的行的说明（magpie 的 "via magpie"）。
const VIA_OSUNA = "via Osuna";
// Codex 的自定义 provider 地址要带上它，Claude Code 的不带。
const CODEX_GATEWAY_SUFFIX = "/v1";
// 保存后当场拉清单最多等这么久（照 magpie），过了就照常回保存的结果。
const SAVE_LIST_TIMEOUT_MS = 8_000;
// 导入链接给的图标图片最多等这么久，过了就用默认图标。
const IMPORT_LINK_ICON_TIMEOUT_MS = 15_000;
// 确认框打开时取到的导入链接图片，内存里最多留这么几张，等添加时存下。
const MAX_KEPT_LINK_PICTURES = 8;

/** 导入链接 icon= 的图片：取到、认得，还没存。 */
interface ImportLinkPicture {
  bytes: Buffer;
  mimeType: string;
}
// 每天刷新时一家各格式加起来最多拉这么久。
const DAILY_LIST_TIMEOUT_MS = 60_000;
// 测试连接要等模型真正回一句话，比列出模型慢。
const DEFAULT_CONNECTION_TEST_TIMEOUT_MS = 30_000;

export interface ApiEndpointRequestErrorInput {
  code: ApiEndpointErrorCode;
  message: string;
  // app 用来按界面语言说明原因的参数（如 config_unparsable 的 file、reason）；多数错误没有。
  params?: Record<string, string>;
}

export class ApiEndpointRequestError extends Error {
  readonly code: ApiEndpointErrorCode;
  readonly params: Record<string, string> | undefined;

  constructor(input: ApiEndpointRequestErrorInput) {
    super(input.message);
    this.name = "ApiEndpointRequestError";
    this.code = input.code;
    this.params = input.params;
  }
}

/**
 * 请求带的请求头、附加请求体、key 放哪个头（会话层已把 keyHeader 换成 ApiEndpointKeyHeader）。
 * 保存时各自整份替换（空的、both 清掉），省略保留原来的（复制时是原来那家的）；拉模型、测试、检测时给了就用它们，
 * 不看 endpointId 那家存的（requestExtras）。
 */
export interface ApiEndpointRequestExtrasInput {
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  keyHeader?: ApiEndpointKeyHeader;
  // 不校验证书：保存时 false 关掉；模板接口打开拒收（insecure_tls_template）。
  insecureTls?: boolean;
}

/**
 * 新客户端带 baseUrls；老客户端带 baseUrl（按 provider 落进对应格式）与 defaultModelId。
 * 两种都没有就拒绝。
 */
export interface ApiEndpointSaveInput extends ApiEndpointRequestExtrasInput {
  endpointId?: string;
  name: string;
  baseUrl?: string;
  baseUrls?: ApiEndpointBaseUrl[];
  // undefined 或空白：新建时不存 key，更新时保留原 key。
  apiKey?: string;
  models: ApiEndpointModel[];
  defaultModelId?: string;
  modelMapping?: ApiEndpointModelMapping;
  // undefined：保留这家已有的手动添加模型。
  manualModels?: ApiEndpointModel[];
  // undefined：保留这家原来的「自己能联网搜索」。
  searchesWeb?: boolean;
  // 复制：新建时从这家起步，没给的字段与留空的 key 都取它的。不能和 endpointId 一起给。
  copyOf?: string;
  // undefined：保留这家原来的模板与区域或套餐。
  templateId?: string;
  region?: string;
  // 「自定义」加的接口的图标：内置图标名或 store_icon 给的 `file:` 值；null 去掉，undefined 保留。
  icon?: string | null;
  // 添加窗口里保存前拉到的上游清单：记作这家的上游清单；undefined 保留原来的（复制时是原来那家的）。
  catalog?: ApiEndpointModel[];
  // 服务范围（会话层已用 validateModelScope 校验）；undefined 保留原来的，新建时为 picked。
  modelScope?: ApiEndpointModelScope;
  // 自动勾选规则，整份替换、空数组清掉；undefined 保留原来的。
  autoPick?: string[];
  // 模型设置，整份替换；undefined 保留原来的。
  modelSettings?: ApiEndpointModelSettings;
  // 冷却设置，整份替换、空对象清掉；undefined 保留原来的（复制时是原来那家的）。
  cooldownSettings?: ApiEndpointCooldownSettings;
}

export interface ApiEndpointAgentSettingsInput {
  enabled: boolean;
  defaultModelId?: string;
  // 「重新应用」：开着时设置没变也按当前设置重写 CLI 配置。
  reapply?: boolean;
  // 「保留 claude.ai 登录」，只给 Claude Code；省略即不变。
  keepsClaudeAiLogin?: boolean;
  // 默认思考档位：null 为不设，省略即不变。
  defaultThinkingOptionId?: string | null;
  // Ultra Code，只给 Claude Code；省略即不变。
  usesUltraCode?: boolean;
  // 后台小任务模型（只给 Claude Code）、Subagent 模型与它的思考档位、记忆模型（只给 Codex）：null 为不设，省略即不变。
  backgroundModelId?: string | null;
  subagentModelId?: string | null;
  subagentThinkingOptionId?: string | null;
  memoryModelId?: string | null;
  // 强制 Subagent 模型与「Codex Subagent 可用任意模型」，只给 Codex；省略即不变，模型 null 为不设。
  forcedSubagentModelId?: string | null;
  allowsAnySubagentModel?: boolean;
}

/** 改完的设置；打开总开关且没指定默认模型时另有默认模型是怎么挑的。 */
export interface ApiEndpointAgentSettingsResult {
  agent: ApiEndpointAgentSettings;
  connection: ApiEndpointConnection | null;
}

export interface ApiEndpointStateInput {
  endpointId: string;
  enabled?: boolean;
  clearCooldown?: boolean;
}

// 拉取模型和测试连接都要的上游地址与 key。
export interface ApiEndpointUpstreamInput extends ApiEndpointRequestExtrasInput {
  // 编辑已保存的接口时带上；apiKey 留空就用它已保存的 key，这家也没存 key 时不带认证头。
  endpointId?: string;
  baseUrl: string;
  apiKey?: string;
  // 新客户端按「地址 + 格式」请求；不带时按 provider 走 CLI 自己的格式。
  format?: string;
  // 表单当前的模板与区域或套餐：给了就按它们，不看 endpointId 那家记下的。
  templateId?: string;
  region?: string;
}

export interface ApiEndpointFetchModelsInput extends ApiEndpointUpstreamInput {
  // 添加窗口保存前拉的：只看不记，endpointId 只为借它的 key。
  preview?: boolean;
  // 这家的全部格式地址：给了就各拉一次再合并，baseUrl、format 不再起作用。
  baseUrls?: { format: string; url: string }[];
}

export interface ApiEndpointTestConnectionInput extends ApiEndpointUpstreamInput {
  // 按格式测试时可省，daemon 自己挑。
  modelId?: string;
  // 表单里的模型（已选的在前、拉到的清单在后）：给了就从它们里挑，不看 endpointId 那家的。
  modelIds?: string[];
}

export interface ApiEndpointDetectInput extends ApiEndpointRequestExtrasInput {
  endpointId?: string;
  baseUrl: string;
  apiKey?: string;
  // 用户填的试用模型；没填时从 modelIds（表单里已选的）挑，也没有才向上游列。
  modelId?: string;
  modelIds?: string[];
  // 逐个模型：modelIds 的前 30 个每个在每种格式上各问一次。
  eachModel?: boolean;
}

/** 自动识别的结论：每种格式一条；逐个模型识别时另有逐个模型的，否则为 null。 */
export interface ApiEndpointDetectOutcome {
  results: ApiEndpointFormatDetection[];
  models: ApiEndpointModelDetection[] | null;
}

export interface ApiEndpointTestModelsInput {
  endpointId: string;
  // 只测这一个（可以不在服务）；省略为这家所有在服务的模型。
  modelId?: string;
  // 测法；省略为 plain。
  method?: string;
}

export interface ApiEndpointServiceOptions {
  paseoHome: string;
  logger: pino.Logger;
  // 中转站记下的冷却；列表显示它，「立刻恢复」、编辑连接与删除清掉它。
  cooldowns: EndpointCooldowns;
  // 中转站记下的已下线模型；给 Agent 选模型的列表都去掉它们，接口页与默认模型不受影响。
  retiredModels: RetiredModels;
  // 中转站记下的每个提供方最近一次收到请求的时刻；列表据此判断「被绕过」。
  sightings: GatewaySightings;
  // 读 CLI 自己的记录（history.jsonl、Codex 的日志库）；缺省读 CLI 目录下的真实文件，测试指到临时目录或换成假的。
  readCliUse?: ReadCliUse;
  // 定位 CLI 配置文件用；缺省取 daemon 自己的环境，测试注入临时目录。
  // 查云平台开关时，登录 shell 没答出的变量也看它（magpie 的 claudeShellEnv）。
  env?: NodeJS.ProcessEnv;
  // 问登录 shell 要变量（一分钟缓存）；缺省真的起登录 shell，测试一律换成假的。
  readLoginShellEnv?: ReadLoginShellEnv;
  // 问一个代理地址后面是不是中转站；缺省发 HTTP，测试可换。
  probeGatewayAt?: ProbeGatewayAt;
  // 经 Codex 的代理问中转站（codex-proxy.ts）；缺省真的发，测试 daemon 一律换成假的，只有起了本机假代理的用例用真的。
  probeThroughProxy?: ProbeThroughProxy;
  // daemon 自己的代理变量（登录 shell 没答出时 Codex 用它们）；缺省取 env，测试 daemon 一律给空的，绝不带上开发者的代理。
  proxyEnv?: ProxyEnv;
  // Claude Code 托管设置所在的目录；缺省按系统（claude-cloud-switches.ts），
  // 环境里有 PASEO_CLAUDE_MANAGED_SETTINGS_DIR 时用它。测试一律指到临时目录，绝不读真实的系统目录。
  claudeManagedSettingsDir?: string;
  homeDir?: string;
  now?: () => Date;
  // 某个 Agent 的总开关、默认模型、可用模型或指向的接口变了之后调用；daemon 据此刷新该提供方的快照。
  onActiveEndpointChanged?: (provider: ApiEndpointProvider) => void;
  // 该提供方下还活着的 Agent session 数；改写 CLI 配置会影响到它们，列表查询时带给 App 写进确认框。
  countLiveSessions: (provider: ApiEndpointProvider) => number;
  // 该提供方下 before 之前启动、还活着的 Agent session 数：提示区说它们要重开才用上新设置。
  countSessionsStartedBefore: (input: { provider: ApiEndpointProvider; before: Date }) => number;
  // 列本机进程、执行 CLI 自己的命令（reopen-hints.ts）、读系统代理（codex-proxy.ts）；
  // 缺省用真的，测试一律换成假的（真的在测试里一造就抛错）。
  hostProcesses?: HostProcesses;
  // daemon 的版本：Osuna 自己发出的请求（经代理问中转站、问托管地址是不是中转站）带 Osuna/<版本>。
  daemonVersion: string;
  // 真的适配器找哪个 codex 执行它自己的命令；缺省按默认找，daemon 传用户配的 codex 命令（假的适配器自己答）。
  findCodexCommand?: FindCodexCommand;
  // 本机 Codex CLI 自报的版本（没有 Codex 样本时「按 Codex 的样子测」用，magpie codexCLIVersion）；daemon 传跑
  // `codex --version` 的，缺省不查。测试一律换成假的，绝不跑真的 codex。
  readCodexCliVersion?: () => Promise<string | null>;
  // 经中转站来过的 Codex 里最新的版本；daemon 传中转站共用的那个，缺省是空的。
  codexSeenVersion?: SeenCodexVersion;
  upstreamTimeoutMs?: number;
  connectionTestTimeoutMs?: number;
  // 测试模型的并发与时限；缺省 4 个、单个 20 秒、整批 3 分钟（model-tests.ts），测试换成短的。
  modelTests?: Partial<ModelTestLimits>;
  // 逐个模型识别的并发与时限；缺省 8 个一起、单个 12 秒、整次 2 分钟（detect-models.ts），测试换成短的。
  detectEach?: Partial<DetectEachLimits>;
  // 测试模型与逐个模型识别的单个与整批计时器；测试换成手动到点的。
  modelTestTimers?: UsagePricingTimers;
  // 价格表的自动更新开关：开着才下载 models.dev（另外还要 Claude Code 或 Codex 的总开关开着），
  // 也才每天给开着的接口重新拉清单；缺省都不做。
  isModelsDevAutoUpdate?: () => boolean;
  // 只给进程内 daemon 测试换掉 models.dev 的下载与检查定时器，生产不传。
  modelsDevFetch?: typeof globalThis.fetch;
  modelsDevTimers?: UsagePricingTimers;
  // 「从网站取图标」取网址用的；缺省真的连公网 https 站点，测试 daemon 一律换成假的，关心它的用例换成本机假站点。
  fetchSite?: FetchSite;
  // daemon 自己发起的拉清单（新建或换 key 保存后当场、每天刷新）前，问这个地址能不能去；
  // 缺省都能去，测试 daemon 只放行本机地址（不上网）。
  reachesUnasked?: (baseUrl: string) => boolean;
  // 每天刷新清单的检查定时器；测试换成手动到点的。
  catalogRefreshTimers?: UsagePricingTimers;
  // 厂商状态页的 summary.json 换成别的地址；测试 daemon 一律指到本机，关心它的用例指到本机假页面。
  vendorStatusUrls?: Partial<Record<VendorId, string>>;
  // 界面第一次看状态页时等候的计时器；测试换成手动到点的。
  vendorStatusTimers?: UsagePricingTimers;
  // 从别的软件导入时读的 CC Switch 目录、Alma 数据库与 OpenCode 的 auth.json；缺省按 magpie 的位置，
  // 测试 daemon 一律指到临时目录。Claude Code、Codex 的配置跟着 env 与 homeDir 走。
  // endpoints.json 等文件的读与改名；只给测试换成会失败的假文件系统（如导入写到一半出错）。
  dataFileSystem?: DataFileSystem;
  importSourcePaths?: Partial<
    Pick<ImportSourcePaths, "ccSwitchDir" | "almaDatabase" | "openCodeAuth">
  >;
  // 每隔一会儿看要重开谁的计时器；测试换成手动触发的。
  reopenHintsTimers?: UsagePricingTimers;
  // 问 Codex 自己是怎么登录的（ADR 0010）；生产起临时 app-server，测试换成固定答案。缺省按判断不出处理。
  readCodexSignIn?: ReadCodexSignIn;
  // 改写 CLI 配置时，落下接管记录之后、替换前重读比对之前调用。
  // 只给进程内 daemon 测试模拟「别的工具同时在改这份文件」，生产不传。
  beforeConfigRecheck?: (filePath: string) => void;
}

export type VendorStatusResult = Omit<
  ApiEndpointVendorStatusResponse["payload"],
  "requestId" | "error"
>;

// 发现提示一分钟内只真读一次别的软件的文件（magpie discoverLocalProviders 的 60000）。
const DISCOVERY_READ_INTERVAL_MS = 60_000;

// 已忽略的记录最多留这么多条，多了丢最早的。
const MAX_IGNORED_IMPORTS = 500;
const IMPORT_FINGERPRINT = /^[0-9a-f]{64}$/;

// 发现提示存着的上次结果：只有指纹与来源软件，不留 key 原文。
interface DiscoveryRead {
  at: number;
  candidates: ApiEndpointImportCandidate[];
}

/** 线上 `code` 是字符串；daemon 这一侧只会发这几种。 */
type ApiEndpointHealthCode = "modified_externally" | "config_unparsable" | "codex_profile_override";

/** 提示区的 code（ADR 0012「Changed outside Osuna」）；后面的工单往这里加。 */
type ApiEndpointAgentIssueCode =
  | "not_through_gateway"
  | "config_unparsable"
  | "codex_profile_override"
  // settings.json 带注释或尾随逗号：Osuna 照改，但 Claude Code 自己读不了、整份跳过。
  | "settings_has_comments"
  // 设置没问题，但 CLI 自己的记录显示最近一次改写之后用过，中转站却没收到它的请求（params.how：used / elsewhere / refused，
  // at：那次的 ISO 时间；elsewhere 另有 host）。
  | "bypassed"
  // 云平台开关开着（托管设置、settings.json、~/.claude.json 或登录 shell）：请求发给云平台，不经过中转站。
  | "cloud_switch_on"
  // 托管设置的 ANTHROPIC_BASE_URL 不指向中转站，盖过 Osuna 写的地址。
  | "managed_base_url"
  // 保留 claude.ai 登录开着，口令却被填回去。
  | "claude_ai_login_token_set"
  // 保留 claude.ai 登录关着，口令却是空的或没了（params.how：empty / missing）。
  | "claude_ai_login_token_empty"
  // CLI 自己把模型换成了哪家接口都没有的（params.model：换成的模型，没设为空串；params.defaultModel：Osuna 的默认模型）。
  | "model_replaced"
  // 「Codex Subagent 可用任意模型」开着，config.toml 里 Codex 自己的 multi_agent_v2 也开着、盖过它（params.file）。
  | "codex_multi_agent_v2_on"
  // 「Codex Subagent 可用任意模型」开着，却读不了 config.toml、查不了 multi_agent_v2（params.file、detail）。
  | "codex_multi_agent_v2_unreadable"
  // Codex 经代理发给中转站的请求被代理吞掉：直连能通、经代理不通（params.host、proxy、from、fix，codex-proxy.ts）。
  | "codex_proxied";

/** 「保留当前设置」回应的提示：model_replaced 只留下 CLI 的模型；省略为关掉总开关、不改回文件。 */
export type KeepCurrentSettingsCode = "model_replaced";

interface KeepCurrentSettingsInput {
  provider: string;
  code?: KeepCurrentSettingsCode;
}

/** 跟着 CLI 走之后的设置、CLI 的模型记成哪种归属，以及要不要忘掉 Codex 接管前的档位。 */
interface FollowedCliPicks {
  agent: ApiEndpointAgentSettings;
  held: CliModelHold | null;
  isEffortOriginalForgotten: boolean;
}

interface AgentIssue extends ApiEndpointAgentIssue {
  code: ApiEndpointAgentIssueCode;
}

/**
 * 这些负责的键被外部改了，CLI 的请求就不再经过中转站（地址、口令；Codex 另有选哪个服务商、模型目录，
 * 以及 ChatGPT 接法下 CC Switch 镜像表的地址，见 isCodexMirrorKey）。
 * 其余负责的键被改仍只算 modified_externally，不进提示区。
 */
const ROUTING_KEYS: Record<ApiEndpointProvider, readonly string[]> = {
  claude: ["env.ANTHROPIC_BASE_URL", "env.ANTHROPIC_AUTH_TOKEN"],
  codex: [
    "model_provider",
    "model_catalog_json",
    "openai_base_url",
    `model_providers.${CODEX_API_ENDPOINT_PROVIDER_ID}`,
  ],
};

const AGENT_NAMES: Record<ApiEndpointProvider, string> = { claude: "Claude Code", codex: "Codex" };

// 问登录 shell 的变量：云平台开关与代理变量一次问齐（magpie proc 的 shellVars 连同 ProxyVars），共用一分钟的答案。
const LOGIN_SHELL_KEYS: readonly string[] = [...CLAUDE_CLOUD_SWITCH_KEYS, ...CODEX_PROXY_ENV_KEYS];

/** 只是提醒、不说明设置有问题的提示；有它们时照样看是不是被绕过。 */
const NOTICE_CODES: ReadonlySet<ApiEndpointAgentIssueCode> = new Set<ApiEndpointAgentIssueCode>([
  "codex_multi_agent_v2_on",
  "codex_multi_agent_v2_unreadable",
]);

interface HealthIssue extends ApiEndpointHealthIssue {
  code: ApiEndpointHealthCode;
}

/** 中转站用不了的原因：daemon 不在 TCP 上监听，或还没绑定端口。列表与拒绝打开总开关用同一个 code。 */
type GatewayUnavailableCode = "gateway_requires_tcp" | "gateway_not_ready";

interface GatewayUnavailableIssue extends ApiEndpointHealthIssue {
  code: GatewayUnavailableCode;
}

/** health 为空即正常；cliBaseUrl 只在官方模式下给出。 */
export type ApiEndpointListResult = Required<
  Pick<
    ApiEndpointListResponse["payload"],
    | "endpoints"
    | "activeEndpointId"
    | "health"
    | "cliBaseUrl"
    | "runningSessionCount"
    | "agents"
    | "gatewayUnavailable"
    | "agentIssues"
    | "reopenHints"
    | "longConversations"
    | "disabledModels"
    | "endpointNameDisplay"
    | "endpointNamesUnreached"
  >
>;

/**
 * 总开关开着时 CLI 配置里写的一切：daemon 中转站地址、该 Agent 的口令、新会话的起始模型。
 * Claude 原样写；Codex 地址补 /v1，另写模型目录路径。
 */
type CliWiring = ClaudeGatewayWiring & {
  // Codex：开着的接口的「接口标识/模型名」，聊天模型选择器的顺序（ChatGPT 登录、用着用户自己的服务商时从中挑模型）。
  endpointModels: string[];
  // Codex 的记忆模型（已是写给 Codex 的写法）；null 为没设，Claude Code 恒为 null。
  memoryModel: string | null;
};

/** CLI 配置里上次写进去的中转站地址与口令。 */
interface WrittenGateway {
  url: string;
  token: string;
}

/** daemon 绑定端口之后才知道中转站地址；不在 TCP 上监听时没有地址。 */
type GatewayAddress = { kind: "pending" } | { kind: "bound"; url: string } | { kind: "socket" };

interface ApiEndpointFileStatus {
  health: HealthIssue[];
  // 提示区：同一份检查换成带参数的 code。
  issues: AgentIssue[];
  baseUrl: string | null;
}

/**
 * 管理第三方接口，并在总开关打开/关掉时改写 CLI 自身的配置文件，让它指向 daemon 内置中转站（ADR 0004、0007）。
 * 所有变更串行执行：改文件是「读—算—写」，并发的两次切换会互相覆盖接管记录。
 */
export class ApiEndpointService {
  private readonly store: ApiEndpointStore;
  private readonly logger: pino.Logger;
  private readonly env: NodeJS.ProcessEnv;
  private readonly homeDir: string;
  private readonly claudeManagedSettingsDir: string;
  private readonly readLoginShellEnv: ReadLoginShellEnv;
  private readonly reachesGateway: (base: string) => Promise<boolean>;
  private readonly now: () => Date;
  private readonly onActiveEndpointChanged: (provider: ApiEndpointProvider) => void;
  private readonly countLiveSessions: (provider: ApiEndpointProvider) => number;
  private readonly countSessionsStartedBefore: ApiEndpointServiceOptions["countSessionsStartedBefore"];
  private readonly reopenHints: CliReopenHints;
  private readonly codexProxy: CodexProxyCheck;
  private readonly proxyEnv: ProxyEnv;
  private readonly upstreamTimeoutMs: number;
  private readonly connectionTestTimeoutMs: number;
  private readonly modelTestLimits: ModelTestLimits;
  private readonly detectEachLimits: DetectEachLimits;
  private readonly modelTestTimers: UsagePricingTimers;
  private readonly beforeConfigRecheck: ((filePath: string) => void) | undefined;
  private readonly cooldowns: EndpointCooldowns;
  private readonly retiredModels: RetiredModels;
  private readonly sightings: GatewaySightings;
  private readonly readCodexCliVersion: (() => Promise<string | null>) | null;
  private readonly codexSeenVersion: SeenCodexVersion;
  // 本机 Codex CLI 的版本隔一阵才重新问一次（magpie codexVersionCache 的 10 分钟）。
  private codexCliVersionCache: { at: number; version: string | null } | null = null;
  private readonly readCliUse: ReadCliUse;
  // daemon（和它里面的中转站）起来的时刻：之前中转站没收到说明不了什么。
  private readonly startedAt: Date;
  private readonly modelsDev: ModelsDevCatalog;
  private readonly icons: EndpointIcons;
  private readonly fetchSite: FetchSite;
  // 确认框打开时取到的导入链接图片（按图片地址），添加时存下。
  private readonly importLinkPictures = new Map<string, ImportLinkPicture>();
  private readonly reachesUnasked: (baseUrl: string) => boolean;
  private readonly catalogRefresh: CatalogRefreshSchedule;
  private readonly vendorStatusPages: VendorStatusPages;
  private readonly importSourcePaths: ApiEndpointServiceOptions["importSourcePaths"];
  // 导入指纹的 HMAC 密钥：存在 api-endpoints/ 下（0600），第一次扫描时读出（import-apps.ts）。
  private importSecret: Buffer | null = null;
  // 发现提示上次真读别的软件的结果（不含 OpenCode）与时刻：一分钟内照用，导入之后丢掉。
  private discoveryRead: DiscoveryRead | null = null;
  private readonly isAutoUpdate: () => boolean;
  private readonly readCodexSignIn: ReadCodexSignIn;
  // 最近一次判断出的 Codex 登录方式；还没判断过、或一直判断不出时为 null，按接管记录现在的接法。
  private codexSignIn: CodexSignIn | null = null;
  private codexSignInCheck: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private gateway: GatewayAddress = { kind: "pending" };

  constructor(options: ApiEndpointServiceOptions) {
    this.logger = options.logger.child({ module: "api-endpoints" });
    this.store = new ApiEndpointStore({
      paseoHome: options.paseoHome,
      logger: this.logger,
      fileSystem: options.dataFileSystem,
    });
    this.env = options.env ?? process.env;
    this.homeDir = options.homeDir ?? homedir();
    this.claudeManagedSettingsDir =
      options.claudeManagedSettingsDir ??
      this.env.PASEO_CLAUDE_MANAGED_SETTINGS_DIR ??
      defaultClaudeManagedSettingsDir(process.platform);
    this.readLoginShellEnv =
      options.readLoginShellEnv ?? createLoginShellEnvReader({ env: this.env });
    this.proxyEnv = options.proxyEnv ?? this.env;
    const userAgent = `Osuna/${options.daemonVersion}`;
    this.reachesGateway = createGatewayReach({
      probe: options.probeGatewayAt ?? createGatewayProbe({ userAgent }),
    });
    this.now = options.now ?? (() => new Date());
    this.onActiveEndpointChanged = options.onActiveEndpointChanged ?? (() => undefined);
    this.countLiveSessions = options.countLiveSessions;
    this.countSessionsStartedBefore = options.countSessionsStartedBefore;
    let adapter = options.hostProcesses ?? null;
    // 真的适配器用到时才造：测试里一造就抛错。
    const hostProcesses = (): HostProcesses => {
      adapter ??= createSystemHostProcesses({
        findCodex: options.findCodexCommand ?? ((input) => findCodexCommand(input)),
      });
      return adapter;
    };
    this.reopenHints = new CliReopenHints({
      hostProcesses,
      subjects: () => ({
        claude: this.reopenSubject("claude"),
        codex: this.reopenSubject("codex"),
      }),
      timers: options.reopenHintsTimers ?? REAL_PRICING_TIMERS,
      now: this.now,
      logger: this.logger,
      ownPid: process.pid,
    });
    this.reopenHints.start();
    this.codexProxy = new CodexProxyCheck({
      readEnv: () => this.readCodexProxyEnv(),
      readSystemProxy: createSystemProxyReader({
        read: () => this.readSystemProxy(hostProcesses),
      }),
      probeThroughProxy: options.probeThroughProxy ?? probeThroughProxy,
      reachesGateway: this.reachesGateway,
      userAgent,
      platform: process.platform,
      logger: this.logger,
    });
    this.upstreamTimeoutMs = options.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
    this.connectionTestTimeoutMs =
      options.connectionTestTimeoutMs ?? DEFAULT_CONNECTION_TEST_TIMEOUT_MS;
    ({ limits: this.modelTestLimits, timers: this.modelTestTimers } = modelTestSetup(options));
    this.detectEachLimits = { ...DETECT_EACH_DEFAULTS, ...options.detectEach };
    this.beforeConfigRecheck = options.beforeConfigRecheck;
    this.cooldowns = options.cooldowns;
    this.retiredModels = options.retiredModels;
    this.sightings = options.sightings;
    ({ readCli: this.readCodexCliVersion, seen: this.codexSeenVersion } =
      codexVersionSources(options));
    this.readCliUse = options.readCliUse ?? readCliUse;
    this.startedAt = this.now();
    this.icons = new EndpointIcons({ endpointsDir: this.store.endpointsDir, now: this.now });
    this.fetchSite = options.fetchSite ?? createPublicFetchSite({ userAgent });
    this.reachesUnasked = options.reachesUnasked ?? reachesAnyAddress;
    this.readCodexSignIn =
      options.readCodexSignIn ??
      (() => Promise.reject(new Error("No way to tell how Codex is signed in")));
    const isModelsDevAutoUpdate = options.isModelsDevAutoUpdate ?? (() => false);
    this.isAutoUpdate = isModelsDevAutoUpdate;
    this.importSourcePaths = options.importSourcePaths;
    this.vendorStatusPages = new VendorStatusPages({
      logger: this.logger,
      now: this.now,
      summaryUrls: options.vendorStatusUrls,
      timers: options.vendorStatusTimers,
    });
    this.modelsDev = new ModelsDevCatalog({
      filePath: this.store.modelsDevPath,
      logger: this.logger,
      isAllowed: () => isModelsDevAutoUpdate() && usesModelFacts(this.readStateForSnapshot()),
      onUpdated: () => {
        void this.refreshModelFacts();
      },
      fetch: options.modelsDevFetch,
      timers: options.modelsDevTimers,
    });
    this.modelsDev.start();
    this.catalogRefresh = new CatalogRefreshSchedule({
      logger: this.logger,
      now: this.now,
      isAllowed: isModelsDevAutoUpdate,
      candidates: () =>
        (this.readStateForSnapshot()?.endpoints ?? []).map((endpoint) => ({
          id: endpoint.id,
          enabled: endpoint.enabled,
          fetchedAt: endpoint.catalog?.fetchedAt,
        })),
      refresh: (endpointId, signal) =>
        this.refreshCatalog({
          endpointId,
          signal: AbortSignal.any([signal, AbortSignal.timeout(DAILY_LIST_TIMEOUT_MS)]),
        }),
      timers: options.catalogRefreshTimers,
    });
    this.catalogRefresh.start();
  }

  /**
   * 列表连同健康状态：每次都读真实文件，负责的键不再是上次写入的值就报「已被外部修改」。
   * 只在这里和写入时检测，不在后台监听文件。接口是主机共用的；provider 只决定投影字段怎么换算。
   */
  async list(provider: string): Promise<ApiEndpointListResult> {
    const supported = requireProvider(provider);
    await this.followCodexSignIn();
    await this.exclusive(() => this.followCliPicks());
    const state = this.readState();
    const enabled = state.agents[supported].enabled;
    const statuses: Record<ApiEndpointProvider, ApiEndpointFileStatus> = {
      claude: this.inspectClaude(state.agents.claude),
      codex: this.inspectCodex(state.agents.codex.enabled),
    };
    for (const agentProvider of API_ENDPOINT_PROVIDERS) {
      const replaced = this.modelReplacedIssue(state, agentProvider);
      if (replaced) statuses[agentProvider].issues.push(replaced);
    }
    // 读不懂的 config.toml 照 magpie 两条都说：「读不懂」说改不了配置，这条说查不了 multi_agent_v2。
    const multiAgentV2 = this.codexMultiAgentV2Issue(state);
    if (multiAgentV2 !== null) statuses.codex.issues.push(multiAgentV2);
    // 托管地址与云平台开关：要问代理与登录 shell，只在列表里查（ADR 0012）。
    if (state.agents.claude.enabled) {
      statuses.claude.issues.push(...(await this.claudeBypassIssues()));
    }
    // 照 magpie：设置本身有问题时先说那个，没有问题再看 Codex 是不是被代理挡住，都没有才看是不是被绕过。
    for (const agentProvider of API_ENDPOINT_PROVIDERS) {
      const issues = statuses[agentProvider].issues;
      const isSettingsRight = issues.every((issue) => NOTICE_CODES.has(issue.code));
      const isChecked = state.agents[agentProvider].enabled && isSettingsRight;
      if (!isChecked) continue;
      if (agentProvider === "codex") {
        const proxied = await this.codexProxiedIssue();
        if (proxied !== null) {
          issues.push(proxied);
          continue;
        }
      }
      const bypassed = this.bypassedIssue(agentProvider);
      if (bypassed !== null) issues.push(bypassed);
    }
    const status = statuses[supported];
    const reopenHints = await this.reopenHints.read();
    return {
      endpoints: state.endpoints.map((endpoint) => this.toWire(state, endpoint, supported)),
      activeEndpointId: agentTargetEndpoint(state, supported)?.id ?? null,
      agents: this.shownAgents(state),
      health: status.health,
      cliBaseUrl: enabled ? null : status.baseUrl,
      runningSessionCount: this.countLiveSessions(supported),
      gatewayUnavailable: this.gatewayUnavailable(),
      agentIssues: { claude: statuses.claude.issues, codex: statuses.codex.issues },
      reopenHints,
      longConversations: state.longConversations ?? {},
      disabledModels: state.disabledModels ?? [],
      endpointNameDisplay: endpointNameDisplayOf(state),
      endpointNamesUnreached: this.endpointNamesUnreached(state),
    };
  }

  /**
   * 刚改写了配置的 CLI：记下改写时刻；在后台看一次要重开谁，Codex 共用的后台 app-server 还是改动之前的设置、
   * 没人连着就重启它，不等它。
   */
  private recordCliRewrites(synced: ApiEndpointProvider[]): void {
    // 这之前 CLI 的使用不再算「被绕过」（「重新应用」也走这里）。
    const rewrittenAt = this.now();
    for (const provider of synced) this.store.recordCliRewrite({ provider, at: rewrittenAt });
    if (synced.length === 0) return;
    this.reopenHints.refresh({ includesCopies: true }).catch((error: unknown) => {
      this.logger.error({ err: error }, "Failed to look at the running CLI copies");
    });
  }

  /** daemon 停下：不再每隔一会儿看要重开谁。 */
  dispose(): void {
    this.reopenHints.dispose();
    this.catalogRefresh.dispose();
    closeUncheckedDispatchers();
  }

  /** 一个 CLI 要重开谁的依据：配置目录、启动时读的那部分最近一次变了的时刻、Osuna 里那之前启动的会话数。 */
  private reopenSubject(provider: ApiEndpointProvider): ReopenHintsSubject {
    const cliDir = path.dirname(this.resolveCliConfigPath(provider));
    const changedAt = this.cliChangedAt(provider);
    if (changedAt === null) return { cliDir, changedAt, osunaSessions: 0 };
    const osunaSessions = this.countSessionsStartedBefore({ provider, before: changedAt });
    return { cliDir, changedAt, osunaSessions };
  }

  /** Osuna 改写过的 CLI 启动时读的那部分最近一次变了的时刻；Osuna 从没改写过它为 null（不是 Osuna 的事）。 */
  private cliChangedAt(provider: ApiEndpointProvider): Date | null {
    if (this.store.readCliRewrittenAt(provider) === null) return null;
    const { changedAt, remember } = cliChangedAt({
      startup: this.cliStartupReads(provider),
      stored: this.store.readCliStartRead(provider),
    });
    if (remember === null) return changedAt;
    try {
      this.store.writeCliStartRead({ provider, read: remember });
    } catch (error) {
      // 记不下只影响提示：下次照样按文件的修改时刻算。
      if (!isErrnoException(error)) throw error;
      this.logger.warn({ err: error, provider }, "Failed to remember what the CLI reads at start");
    }
    return changedAt;
  }

  /** CLI 启动时读的文件与其中 Osuna 写的那部分（magpie startsWith）；Codex 连同 Osuna 的模型目录。 */
  private cliStartupReads(provider: ApiEndpointProvider): CliStartupReads {
    const configPath = this.resolveCliConfigPath(provider);
    const text = this.readForReopenHints({
      file: configPath,
      read: () => readOptionalFile(configPath)?.toString("utf8") ?? null,
    });
    if (provider === "claude") return { files: [configPath], reads: readClaudeStartupReads(text) };
    const catalog =
      this.readForReopenHints({
        file: this.store.codexModelCatalogPath,
        read: () => this.store.readCodexModelCatalog(),
      }) ?? "";
    return {
      files: [configPath, this.store.codexModelCatalogPath],
      reads: `${readCodexStartupReads(text)}\n${catalog}`,
    };
  }

  /**
   * 「要重开谁」读 CLI 启动时读的文件：读不了（如那个位置是个文件夹）只记日志、按空的算，不让列表失败；
   * 不是 errno 的错照常抛。
   */
  private readForReopenHints(input: { file: string; read: () => string | null }): string | null {
    try {
      return input.read();
    } catch (error) {
      if (!isErrnoException(error)) throw error;
      this.logger.warn(
        { err: error, file: input.file },
        "Could not read what the CLI reads at start",
      );
      return null;
    }
  }

  /**
   * daemon 绑定端口之后调用；`url` 为 null 表示不在 TCP 上监听，中转站用不了，总开关打不开。
   * 开着总开关的 Agent 没有口令就补一个（旧数据换算来的从没经历「从关到开」），
   * CLI 配置里的中转站地址或口令不是现在的就重写，其它内容不动；Codex 的模型目录跟着补齐。
   * 关着的 Codex 留着的服务商表改指这次的端口（ADR 0010）。出错只记日志，不挡 daemon 启动。
   */
  async attachGateway(url: string | null): Promise<void> {
    await this.exclusive(async () => {
      this.gateway = url === null ? { kind: "socket" } : { kind: "bound", url };
      await this.followCliPicks();
      const state = this.readStateForSnapshot();
      if (!state) return;
      const current = this.store.readGatewayTokens();
      const tokens = nextGatewayTokens(state, current);
      if (!sameTokens(tokens, current)) this.store.writeGatewayTokens(tokens);
      if (url === null) {
        if (API_ENDPOINT_PROVIDERS.some((provider) => state.agents[provider].enabled)) {
          this.logger.warn("API endpoints are on, but the daemon listens on a socket");
        }
        return;
      }
      for (const provider of API_ENDPOINT_PROVIDERS) {
        try {
          this.reconcileCli(state, provider, tokens, url);
        } catch (error) {
          this.logger.error({ err: error, provider }, "Failed to point the CLI at the gateway");
        }
      }
      this.staleCodexModels(state);
    });
    // 先按上次的接法对账，不让启动等 Codex；登录方式变了再在后台改写。
    void this.followCodexSignIn();
  }

  activeEndpointId(provider: string): string | null {
    return agentTargetEndpoint(this.readState(), requireProvider(provider))?.id ?? null;
  }

  agentSettings(provider: string): ApiEndpointAgentSettings {
    const state = this.readState();
    return this.shownAgent(state, requireProvider(provider));
  }

  /** 每个 Agent 回给客户端的设置（shownAgent）。 */
  private shownAgents(
    state: ApiEndpointState,
  ): Record<ApiEndpointProvider, ApiEndpointAgentSettings> {
    return { claude: this.shownAgent(state, "claude"), codex: this.shownAgent(state, "codex") };
  }

  /**
   * 回给客户端的设置照 magpie 的 Get：Claude Code 的默认思考档位按 claudeClamp 显示默认模型实际跑的那一档，
   * Ultra Code 只在默认模型支持 xhigh 时算开（settings.json 里留着的 ultracode 对别的模型不起作用）。存下的设置不改；
   * Codex 原样（magpie 只在换模型时 settle）。
   */
  private shownAgent(
    state: ApiEndpointState,
    provider: ApiEndpointProvider,
  ): ApiEndpointAgentSettings {
    const agent = state.agents[provider];
    if (provider !== "claude") return agent;
    const levels = this.claudeLevels(state, agent);
    const chosen = agent.defaultThinkingOptionId ?? null;
    const shown = chosen === null ? null : claudeClamp(chosen, levels);
    const thinking = chosen === null ? {} : { defaultThinkingOptionId: shown ?? chosen };
    const isUltraCodeShownOff = agent.usesUltraCode === true && !takesUltraCode(levels);
    const ultraCode = isUltraCodeShownOff ? { usesUltraCode: false } : {};
    return { ...agent, ...thinking, ...ultraCode };
  }

  /** 老客户端眼里当前启用的接口；官方模式、不支持的提供方或文件读不懂时为 null。 */
  activeEndpoint(provider: string): ApiEndpointRef | null {
    const state = this.readStateForSnapshot();
    const supported = findProvider(provider);
    if (!state || !supported) return null;
    const endpoint = agentTargetEndpoint(state, supported);
    return endpoint ? { id: endpoint.id, name: endpoint.name } : null;
  }

  /**
   * 总开关开着时，所有开着的接口的已选模型（按 id 去重，去掉已下线的），默认模型即该 Agent 的默认模型。
   * 官方模式、不支持的提供方或文件读不懂时返回 null，模型目录照旧。
   */
  activeModels(provider: string): AgentModelDefinition[] | null {
    const state = this.readStateForSnapshot();
    const supported = findProvider(provider);
    if (!state || !supported) return null;
    const agent = state.agents[supported];
    if (!agent.enabled) return null;
    // 指定了某一家的默认模型，在老客户端的光秃秃列表里标它的模型名。
    const defaultModel = bareDefaultModel(state, agent.defaultModelId);
    const thinkingOf = this.chatThinking(state, supported);
    const models = usableModels(this.served(state));
    const labels = this.bareModelLabels(state, models);
    return models.map((model, index) =>
      Object.assign(
        {
          provider: supported,
          id: model.id,
          label: labels[index] ?? model.id,
          isDefault: model.id === defaultModel,
        },
        thinkingOf(model.id),
      ),
    );
  }

  /**
   * Osuna 对话里接口模型的思考档位：选项同默认思考档位，Claude Code 的模型支持 xhigh 时另有 Ultra Code（对话里它是一档）。
   * 新对话没有记住的选择时从默认思考档位起步：Claude Code 开着 Ultra Code 就是 Ultra Code，否则按 claudeClamp 取这个模型
   * 跑得到的一档，没设时从 high 起；Codex 取 ModelDefault，没设时按 config.toml 里的那档。
   */
  private chatThinking(
    state: ApiEndpointState,
    provider: ApiEndpointProvider,
  ): (modelId: string) => ChatThinking {
    const agent = state.agents[provider];
    const chosen = agent.defaultThinkingOptionId ?? null;
    const codexOwn = provider === "codex" ? this.codexReasoningEffort() : null;
    return (modelId) => {
      const levels = this.thinkingLevelsFor({ state, provider, modelId });
      if (levels.length === 0) return {};
      if (provider === "codex") {
        return {
          thinkingOptions: thinkingOptionsOf({ levels }),
          defaultThinkingOptionId: codexDefaultLevel(levels, chosen ?? codexOwn),
        };
      }
      const hasUltraCode = takesUltraCode(levels);
      const options = hasUltraCode ? [...levels, CLAUDE_ULTRA_CODE] : levels;
      const startsAtUltraCode = hasUltraCode && agent.usesUltraCode === true;
      const level = claudeClamp(chosen ?? CLAUDE_START_THINKING, levels) ?? levels[0];
      return {
        thinkingOptions: thinkingOptionsOf({ levels: options }),
        defaultThinkingOptionId: startsAtUltraCode ? CLAUDE_ULTRA_CODE : level,
      };
    };
  }

  /** 第三方接口的默认思考档位是 max 时，Claude Code 的每个会话都锁在 max（CLAUDE_CODE_EFFORT_LEVEL 盖过每次选的档位）。 */
  lockedThinkingOptionId(provider: string): string | null {
    const state = this.readStateForSnapshot();
    if (!state || findProvider(provider) !== "claude") return null;
    const agent = state.agents.claude;
    const isLockedAtMax = agent.enabled && agent.defaultThinkingOptionId === "max";
    return isLockedAtMax ? "max" : null;
  }

  /**
   * 总开关开着时按接口分组的可选模型（去掉已下线的），给新客户端的聊天模型选择器；label 是光秃秃的模型名，
   * isDefault 标在含默认模型的第一家上。官方模式、不支持的提供方或文件读不懂时返回 null。
   */
  activeModelGroups(provider: string): ApiEndpointModelGroup[] | null {
    const state = this.readStateForSnapshot();
    const supported = findProvider(provider);
    if (!state || !supported) return null;
    const agent = state.agents[supported];
    if (!agent.enabled) return null;
    const agentProvider = supported;
    // 默认模型指定了某一家就标那一家，否则标含它的第一家。
    const isNamed = namedDefaultModel(state, agent.defaultModelId) !== null;
    let defaultMarked = false;
    function isDefaultEntry({ id, model }: EndpointGroupModel): boolean {
      if (isNamed) return id === agent.defaultModelId;
      return model.id === agent.defaultModelId;
    }
    const thinkingOf = this.chatThinking(state, supported);
    function toDefinition(entry: EndpointGroupModel, label: string): AgentModelDefinition {
      const { id } = entry;
      const isDefault = !defaultMarked && isDefaultEntry(entry);
      if (isDefault) defaultMarked = true;
      return { provider: agentProvider, id, label, isDefault, ...thinkingOf(id) };
    }
    return endpointModelGroups(this.served(state)).map((group) => {
      const labels = this.groupModelLabels(group);
      const models = group.models.map((entry, index) =>
        toDefinition(entry, labels[index] ?? entry.model.id),
      );
      return { name: group.endpoint.name, models };
    });
  }

  /**
   * 新建一家或换了 key 时，保存后当场向上游拉一次清单（照 magpie providers.go 的 save：限时 8 秒，失败不挡保存），
   * 保存完这家就有带模型资料的上游清单；拉不到时留着请求带来的那份（添加窗口里预览的）。
   */
  async save(provider: string, input: ApiEndpointSaveInput): Promise<ApiEndpoint> {
    const saved = await this.saveQueued(provider, input);
    if (!saved.fetchesList) return saved.endpoint;
    const supported = requireProvider(provider);
    await this.fetchListAfterSave({ provider: supported, endpointId: saved.endpoint.id });
    const state = this.readState();
    const stored = findEndpoint(state, saved.endpoint.id);
    // 拉的这几秒里被删了：回刚保存的样子。
    if (!stored) return saved.endpoint;
    return this.toWire(state, stored, supported);
  }

  private async fetchListAfterSave(input: {
    provider: ApiEndpointProvider;
    endpointId: string;
  }): Promise<void> {
    await this.refreshCatalog({
      endpointId: input.endpointId,
      signal: AbortSignal.timeout(SAVE_LIST_TIMEOUT_MS),
    });
  }

  /**
   * daemon 自己发起的拉清单（保存后当场、每天刷新）：按这家已存的地址与 key 各格式拉一次、合并后记下；
   * 只问 reachesUnasked 放行的地址。都没答上只记日志，清单不动。
   */
  private async refreshCatalog(input: {
    endpointId: string;
    signal: AbortSignal;
  }): Promise<CatalogRefreshOutcome> {
    const endpoint = findEndpoint(this.readState(), input.endpointId);
    if (!endpoint) return "failed";
    const addresses = endpoint.baseUrls.filter(({ url }) => this.reachesUnasked(url));
    if (addresses.length === 0) return "failed";
    try {
      await this.fetchMergedModels({
        input: { endpointId: endpoint.id, baseUrl: addresses[0]?.url ?? "" },
        addresses,
        keeps: true,
        signal: input.signal,
      });
      return "listed";
    } catch (error) {
      if (!(error instanceof ApiEndpointRequestError)) throw error;
      this.logger.info(
        { endpointId: endpoint.id, code: error.code },
        "Could not fetch the model list",
      );
      return "failed";
    }
  }

  private saveQueued(
    provider: string,
    input: ApiEndpointSaveInput,
  ): Promise<{ endpoint: ApiEndpoint; fetchesList: boolean }> {
    return this.exclusiveFollowing(async () => {
      const supported = requireProvider(provider);
      const state = this.readState();
      const existing = input.endpointId ? findEndpoint(state, input.endpointId) : null;
      if (input.endpointId && !existing) {
        throw new ApiEndpointRequestError({ code: "not_found", message: "API endpoint not found" });
      }
      const copySource = copySourceOf(state, input);
      // 编辑的这家，或复制时原来那家：请求没给的从它取。
      const base = existing ?? copySource;
      // key 选填：新建时不填就不留条目，发请求时不带认证头；编辑时不填保留原 key；复制时不填用原来那家的。
      const apiKey = savedKeyOf({ input, copySource, store: this.store });
      const isLegacyForm = input.baseUrls === undefined;
      const template = validateTemplate(input, base);
      // Azure 模板的地址不论怎么粘来（只有资源名也行），都先放到资源的 v1 API 上再校验。
      const templateId = input.templateId ?? base?.templateId;
      const { fields, modelScope } = savedFieldsOf({
        provider: supported,
        input,
        existing,
        base,
        templateId,
      });
      this.validateIcon({ icon: input.icon, templateId });
      const built = buildEndpoint({
        state,
        existing,
        copySource,
        fields,
        template,
        searchesWeb: keptSearchesWeb(input.searchesWeb, base),
        icon: input.icon,
        catalog: input.catalog,
        requestExtras: savedRequestExtras({ request: input, base, templateId }),
        cooldownSettings: savedCooldownSettings({ requested: input.cooldownSettings, base }),
        // 新客户端建的接口默认开着；老客户端建的要等 set_active 才开，和以前「保存不启用」一样。
        enabledWhenNew: !isLegacyForm,
        timestamp: this.now().toISOString(),
      });
      const scoped = settleSavedScope({
        endpoint: built,
        base,
        input,
        modelScope,
        isLegacyForm,
      });
      const endpoint = this.withModelSettings(scoped, input.modelSettings);
      const endpoints = withEndpoint(state.endpoints, endpoint);
      const fetchesList = fetchesListOnSave({ existing, apiKey, store: this.store });
      let agents = state.agents;
      // 老客户端编辑它眼里启用中的接口：表单里的默认模型就是该 Agent 的默认模型。
      const editsActiveEndpoint =
        existing !== null && agentTargetEndpoint(state, supported)?.id === existing.id;
      if (isLegacyForm && editsActiveEndpoint) {
        agents = {
          ...agents,
          [supported]: {
            ...agents[supported],
            enabled: true,
            defaultModelId: fields.legacyDefaultModelId ?? null,
          },
        };
      }
      const next = await this.commit(
        state,
        { ...state, endpoints, agents },
        {
          keys: apiKey ? { [endpoint.id]: apiKey } : {},
        },
      );
      // 编辑过这家接口就解除「需要检查」；改了连接（key 或地址）时冷却也是旧连接的，一并清掉。
      if (existing) {
        const connectionEdited =
          apiKey !== undefined ||
          JSON.stringify(existing.baseUrls) !== JSON.stringify(endpoint.baseUrls);
        if (connectionEdited) this.cooldowns.clear(existing.id);
        else this.cooldowns.clearNeedsCheck(existing.id);
      }
      return { endpoint: this.toWire(next, endpoint, supported), fetchesList };
    });
  }

  /**
   * 请求带了模型设置就整份换上（照 magpie SetModelPrefs 等的校验与收拢），没带保留原来的。
   * 新改的那几个模型要是这家的（已选、清单里或手动添加的）；和自动取到的一样的看图答案不记（magpie setModelImage）。
   */
  private withModelSettings(
    endpoint: StoredApiEndpoint,
    requested: ApiEndpointModelSettings | undefined,
  ): StoredApiEndpoint {
    if (requested === undefined) return endpoint;
    const { modelSettings: stored, ...rest } = endpoint;
    const settled = settleModelSettings({
      requested,
      stored,
      isOwnModel: (modelId) => endpointKnowsModel(endpoint, modelId),
      hasUrlFor: (format) => endpoint.baseUrls.some((entry) => entry.format === format),
      basisOf: (modelId) => ({
        knownEfforts: this.autoModelFacts(endpoint, modelId).efforts,
        listedImages: listedFactsOf(endpoint, modelId)?.images,
      }),
    });
    if (settled.kind === "invalid") {
      throw new ApiEndpointRequestError({
        code: "invalid_model_settings",
        message: settled.message,
      });
    }
    return settled.settings === undefined ? rest : { ...rest, modelSettings: settled.settings };
  }

  /** 内置模板清单（templates.ts），随版本走，不联网。 */
  listTemplates(): ApiEndpointTemplate[] {
    return [...API_ENDPOINT_TEMPLATES];
  }

  /** 存一张图片给接口当图标，返回保存时要带的 icon 值（照 magpie StoreIcon）。 */
  storeIcon(bytes: Buffer): string {
    try {
      return this.icons.store(bytes);
    } catch (error) {
      if (error instanceof StoreIconError) {
        throw new ApiEndpointRequestError({ code: error.code, message: error.message });
      }
      throw error;
    }
  }

  /** 从地址所在的网站找图标并存下，返回图标值（照 magpie FaviconFor）；只在用户点「从网站取图标」时调用。 */
  async fetchSiteIcon(
    input: { baseUrl: string; name: string },
    signal: AbortSignal,
  ): Promise<string> {
    try {
      return await findSiteIcon({
        ...input,
        fetchSite: this.fetchSite,
        store: (bytes) => this.icons.store(bytes),
        signal,
      });
    } catch (error) {
      if (error instanceof SiteIconError) {
        throw new ApiEndpointRequestError({ code: error.code, message: error.message });
      }
      throw error;
    }
  }

  /** 取回存下的图标图片（base64）；不是存下的、或已经删了为 not_found。 */
  readIcon(icon: string): ApiEndpointIconImage {
    const image = this.icons.read(icon);
    if (!image) {
      throw new ApiEndpointRequestError({ code: "not_found", message: "Icon not found" });
    }
    return { data: image.data.toString("base64"), mimeType: image.mimeType };
  }

  /** 图标只给「自定义」加的接口选（照 magpie）；`file:` 的要是存下的，别的要像内置图标的名字。 */
  private validateIcon(input: { icon: string | null | undefined; templateId: string | undefined }) {
    const { icon } = input;
    if (icon === undefined || icon === null) return;
    if (input.templateId !== undefined) {
      throw new ApiEndpointRequestError({
        code: "invalid_input",
        message: "An endpoint added from a template uses the template's icon",
      });
    }
    const isKnown =
      storedIconName(icon) !== null ? this.icons.isStored(icon) : isBuiltInIconName(icon);
    if (!isKnown) {
      throw new ApiEndpointRequestError({
        code: "invalid_input",
        message: `Unknown icon: ${icon}`,
      });
    }
  }

  /** 读回一家接口已保存的 key 原文（编辑窗口的「显示」）；没有 key 为 null。照 magpie 不确认、不限次数。 */
  revealKey(endpointId: string): string | null {
    if (!findEndpoint(this.readState(), endpointId)) {
      throw new ApiEndpointRequestError({ code: "not_found", message: "API endpoint not found" });
    }
    return this.store.getApiKey(endpointId);
  }

  /** 接口是主机共用的，删除对所有 Agent 生效；返回值按 provider 投影。 */
  delete(provider: string, endpointId: string): Promise<{ activeEndpointId: string | null }> {
    return this.exclusiveFollowing(async () => {
      const supported = requireProvider(provider);
      const state = this.readState();
      if (!findEndpoint(state, endpointId)) {
        throw new ApiEndpointRequestError({ code: "not_found", message: "API endpoint not found" });
      }
      const next = await this.commit(state, {
        ...state,
        endpoints: state.endpoints.filter((endpoint) => endpoint.id !== endpointId),
      });
      this.store.removeApiKey(endpointId);
      this.cooldowns.clear(endpointId);
      return { activeEndpointId: agentTargetEndpoint(next, supported)?.id ?? null };
    });
  }

  /**
   * 老客户端的切换。`endpointId`：打开总开关、确保这家开着（不关别的接口，否则会影响另一个 Agent），
   * 默认模型取老客户端眼里这家的默认模型；`null`：关掉总开关。
   */
  setActive(
    provider: string,
    endpointId: string | null,
  ): Promise<{ activeEndpointId: string | null }> {
    return this.exclusiveFollowing(async () => {
      const supported = requireProvider(provider);
      const state = this.readState();
      if (endpointId === null) {
        const agent = state.agents[supported];
        await this.commit(
          state,
          { ...state, agents: { ...state.agents, [supported]: { ...agent, enabled: false } } },
          { rewrite: supported },
        );
        return { activeEndpointId: null };
      }
      const endpoint = findEndpoint(state, endpointId);
      if (!endpoint) {
        throw new ApiEndpointRequestError({ code: "not_found", message: "API endpoint not found" });
      }
      if (endpoint.models.length === 0) {
        throw new ApiEndpointRequestError({
          code: "no_usable_model",
          message: "This endpoint has no models selected",
        });
      }
      const defaultModelId = projectedDefaultModelId(state.agents[supported], endpoint);
      const next = await this.commit(
        state,
        {
          ...state,
          endpoints: withEndpoint(state.endpoints, { ...endpoint, enabled: true }),
          agents: {
            ...state.agents,
            [supported]: { ...state.agents[supported], enabled: true, defaultModelId },
          },
        },
        { rewrite: supported },
      );
      return { activeEndpointId: agentTargetEndpoint(next, supported)?.id ?? null };
    });
  }

  /**
   * 「使用第三方接口」总开关与默认模型。打开要求至少一家接口开着且已选模型；
   * 省略默认模型时保留当前的（还能用的话），否则取接口顺序里最靠前的开着接口的第一个已选模型。关掉时忽略默认模型。
   */
  setAgentSettings(
    provider: string,
    input: ApiEndpointAgentSettingsInput,
  ): Promise<ApiEndpointAgentSettingsResult> {
    return this.exclusiveFollowing(async () => {
      const supported = requireProvider(provider);
      const setsClaudeAiLogin = input.keepsClaudeAiLogin !== undefined;
      if (setsClaudeAiLogin && supported !== "claude") {
        throw new ApiEndpointRequestError({
          code: "invalid_input",
          message: "Only Claude Code can keep its claude.ai sign-in",
        });
      }
      if (supported === "codex" && input.enabled) await this.checkCodexSignIn();
      const state = this.readState();
      const requested = input.defaultModelId?.trim();
      const pick = input.enabled && !requested ? this.pickDefaultModel(state, supported) : null;
      const enabledOrOff = input.enabled
        ? enabledAgentSettings({ state, provider: supported, requested, pick })
        : // 关掉总开关从不被拒；默认模型留着，下次打开时还能用就沿用。
          { ...state.agents[supported], enabled: false };
      const withLogin = setsClaudeAiLogin
        ? { ...enabledOrOff, keepsClaudeAiLogin: input.keepsClaudeAiLogin }
        : enabledOrOff;
      const withThinking = this.withDefaultThinking({
        state,
        provider: supported,
        agent: withLogin,
        requested: input.defaultThinkingOptionId,
      });
      const withUltraCode = this.withUltraCode({
        state,
        provider: supported,
        agent: withThinking,
        requested: input.usesUltraCode,
      });
      const agent = this.withSideModels({
        state,
        provider: supported,
        agent: withUltraCode,
        requested: input,
      });
      const reapply = input.enabled && input.reapply === true;
      const next = await this.commit(
        state,
        { ...state, agents: { ...state.agents, [supported]: agent } },
        reapply ? { rewrite: supported } : {},
      );
      let connection: ApiEndpointConnection | null = null;
      if (pick) {
        connection = {
          how: pick.how,
          model: pick.defaultModelId,
          previousModel: pick.previousModel,
        };
      }
      return { agent: this.shownAgent(next, supported), connection };
    });
  }

  /**
   * 设默认思考档位（照 magpie 的 Set）：Claude Code 要是默认模型收的档位（claudeTakes）；Codex 收它认的任何档位，
   * 不要求先有默认模型。省略时不变（Codex 换默认模型后的取法在 commit 里）。
   */
  private withDefaultThinking(input: {
    state: ApiEndpointState;
    provider: ApiEndpointProvider;
    agent: ApiEndpointAgentSettings;
    requested: string | null | undefined;
  }): ApiEndpointAgentSettings {
    const { state, provider, agent } = input;
    if (input.requested === undefined) return agent;
    if (input.requested === null) return { ...agent, defaultThinkingOptionId: null };
    const requested = input.requested.trim();
    if (requested === "") {
      throw new ApiEndpointRequestError({
        code: "invalid_input",
        message: "The default thinking can't be empty",
      });
    }
    if (provider === "codex") return { ...agent, defaultThinkingOptionId: requested };
    const levels = this.claudeLevels(state, agent);
    if (!levels.includes(requested)) {
      throw new ApiEndpointRequestError({
        code: "invalid_input",
        message: `Claude Code runs ${agent.defaultModelId ?? "the default model"} at ${levels.join(", ") || "no level"}, not ${requested}`,
      });
    }
    return { ...agent, defaultThinkingOptionId: requested };
  }

  /** 开关 Ultra Code（照 magpie 的 ultracode 字段）：只有 Claude Code；打开要求默认模型支持 xhigh。省略时不变。 */
  private withUltraCode(input: {
    state: ApiEndpointState;
    provider: ApiEndpointProvider;
    agent: ApiEndpointAgentSettings;
    requested: boolean | undefined;
  }): ApiEndpointAgentSettings {
    const { state, provider, agent, requested } = input;
    if (requested === undefined) return agent;
    if (provider !== "claude") {
      throw new ApiEndpointRequestError({
        code: "invalid_input",
        message: "Only Claude Code has Ultra Code",
      });
    }
    const isRefused = requested && !takesUltraCode(this.claudeLevels(state, agent));
    if (isRefused) {
      throw new ApiEndpointRequestError({
        code: "invalid_input",
        message: `Claude Code has Ultra Code only on a model that takes xhigh, and ${agent.defaultModelId ?? "the default model"} doesn't`,
      });
    }
    return { ...agent, usesUltraCode: requested };
  }

  /** Claude Code 默认模型收的档位；还没有默认模型时为空。 */
  private claudeLevels(state: ApiEndpointState, agent: ApiEndpointAgentSettings): string[] {
    const modelId = agent.defaultModelId;
    if (modelId === null) return [];
    return this.thinkingLevelsFor({ state, provider: "claude", modelId });
  }

  /** 默认模型是这个模型时默认思考档位能选的档位；资料按中转站先发给的那家查。 */
  private thinkingLevelsFor(input: {
    state: ApiEndpointState;
    provider: ApiEndpointProvider;
    modelId: string;
  }): string[] {
    const { state, provider, modelId } = input;
    return defaultThinkingLevels({
      provider,
      modelId,
      facts: this.startModelFacts(state, modelId),
    });
  }

  /**
   * Codex 换了默认模型后，新模型不收的默认思考档位照 magpie 的 settle 改掉；设档位本身照它的 Set 原样写下。
   * Claude Code 不改：magpie 只在显示时 claudeClamp，Claude Code 自己也把模型不收的档位降到不高于它的一档。
   */
  private settleThinking(input: {
    previous: ApiEndpointState;
    next: ApiEndpointState;
  }): ApiEndpointState {
    const state = input.next;
    const agent = state.agents.codex;
    const chosen = agent.defaultThinkingOptionId ?? null;
    const modelId = agent.defaultModelId;
    const isModelChanged = input.previous.agents.codex.defaultModelId !== modelId;
    const isSettled = !agent.enabled || modelId === null || chosen === null || !isModelChanged;
    if (isSettled) return state;
    const levels = this.thinkingLevelsFor({ state, provider: "codex", modelId });
    const settled = settleCodexThinking({ levels, chosen });
    if (settled === chosen) return state;
    return {
      ...state,
      agents: { ...state.agents, codex: { ...agent, defaultThinkingOptionId: settled } },
    };
  }

  /**
   * Codex 的默认 Subagent 档位是 Subagent 跑的模型不收的就拿掉（照 magpie 的 settle 与 dropSubEffort，每次改写都看）：
   * Codex 派 Subagent 时会因档位不收而失败。档位不清楚时不动。
   */
  private settleSubagentThinking(state: ApiEndpointState): ApiEndpointState {
    const agent = state.agents.codex;
    const chosen = agent.subagentThinkingOptionId ?? null;
    if (!agent.enabled || chosen === null) return state;
    const levels = this.codexSubagentLevels(state, agent);
    const isTaken = levels.length === 0 || levels.includes(chosen);
    if (isTaken) return state;
    return {
      ...state,
      agents: { ...state.agents, codex: { ...agent, subagentThinkingOptionId: null } },
    };
  }

  /**
   * Codex 的 Subagent 跑的模型收的档位（magpie subEfforts）：默认 Subagent 模型，没设时是主模型；
   * 主模型是 ChatGPT 自带的或 Codex 自己的默认、档位不清楚时为空。
   */
  private codexSubagentLevels(state: ApiEndpointState, agent: ApiEndpointAgentSettings): string[] {
    const modelId = agent.subagentModelId ?? this.codexMainModel(agent);
    // ChatGPT 接法下 Codex 自己的模型在前（magpie models()：catalog.Codex() 加上接口的），光秃秃的名字指它们。
    const own = this.codexOwnModels().find((model) => model.slug === modelId);
    if (own) return own.levels;
    if (!isDefaultModelChoice(state, modelId)) return [];
    return this.thinkingLevelsFor({ state, provider: "codex", modelId });
  }

  /** Codex 主对话的模型（magpie get("model")）：ChatGPT 接法下模型归 Codex，读 config.toml；否则是默认模型。 */
  private codexMainModel(agent: ApiEndpointAgentSettings): string | null {
    if (!this.codexUsesChatGpt()) return agent.defaultModelId;
    const text = readOptionalFile(this.resolveCodexConfigPath())?.toString("utf8") ?? null;
    return readCodexModel(text);
  }

  /**
   * 用 ChatGPT 登录时 Codex 自己的模型（它存的 models_cache.json，照 magpie 的 catalog.Codex()）：默认 Subagent 模型与
   * 记忆模型也能选它们。用 API key 时 Codex 只认 Osuna 的模型目录，为空。
   */
  private codexOwnModels(): CodexOwnModel[] {
    if (!this.codexUsesChatGpt()) return [];
    return codexOwnModels(readCodexModelsCache(path.dirname(this.resolveCodexConfigPath())));
  }

  /**
   * Codex 的默认 Subagent 模型与记忆模型的选项（照 magpie modelOptions）：用 ChatGPT 登录时 Codex 自己的模型在前，
   * 再是开着的接口的模型（光秃秃的名字去重，再是每家的「接口标识/模型名」）；同名时光秃秃的名字指 Codex 自己的，
   * 不再列接口的那条。总开关关着或不是 Codex 时为 null。
   */
  sideModelOptions(provider: string): ApiEndpointSideModelOption[] | null {
    const state = this.readStateForSnapshot();
    if (!state || findProvider(provider) !== "codex") return null;
    if (!state.agents.codex.enabled) return null;
    const listed = this.served(state);
    const options: ApiEndpointSideModelOption[] = this.codexOwnModels().map((model) => ({
      id: model.slug,
      model: model.label,
      endpointName: CODEX_OWN_MODELS_SOURCE,
    }));
    const ids = new Set(options.map((option) => option.id));
    const add = (option: ApiEndpointSideModelOption) => {
      if (ids.has(option.id)) return;
      ids.add(option.id);
      options.push(option);
    };
    for (const model of usableModels(listed))
      add({ id: model.id, model: model.id, endpointName: null });
    for (const group of endpointModelGroups(listed)) {
      for (const { id, model } of group.models) {
        add({ id, model: model.id, endpointName: group.endpoint.name });
      }
    }
    return options;
  }

  /** Codex 认得的 Subagent 与记忆模型：开着的接口的已选模型，ChatGPT 接法下另有 Codex 自己的。 */
  private codexSideModel(state: ApiEndpointState, requested: string | null): string | null {
    if (requested === null) return null;
    const model = requested.trim();
    const isOwn = this.codexOwnModels().some((own) => own.slug === model);
    if (isOwn) return model;
    return sideModel({ state, requested: model });
  }

  /**
   * 写进 config.toml 的名字：ChatGPT 接法下光秃秃的名字指 Codex 自己的模型，所以是它自己的照写，
   * 接口的写成第一家提供它的「接口标识/模型名」（/model 里的写法）；API key 时照写（模型目录两种都有）。
   */
  private codexListedName(state: ApiEndpointState, modelId: string): string {
    if (!this.codexUsesChatGpt()) return modelId;
    const isOwn = this.codexOwnModels().some((own) => own.slug === modelId);
    const named = endpointModelGroups(state).flatMap((group) => group.models.map(({ id }) => id));
    if (isOwn || named.includes(modelId)) return modelId;
    const listed = named.find((id) => id.slice(id.indexOf("/") + 1) === modelId);
    return listed ?? modelId;
  }

  /**
   * 设后台小任务模型（只有 Claude Code）、Subagent 模型与它的思考档位、记忆模型（只有 Codex），照 magpie 这几个字段的 Set：
   * 模型要是开着的接口的已选模型；Claude Code 的档位收 magpie 认的任何一档，Codex 的档位要是 Subagent 跑的模型收的。
   * 省略的不变，null 为不设。
   */
  private withSideModels(input: {
    state: ApiEndpointState;
    provider: ApiEndpointProvider;
    agent: ApiEndpointAgentSettings;
    requested: ApiEndpointAgentSettingsInput;
  }): ApiEndpointAgentSettings {
    const { state, provider, requested } = input;
    const { backgroundModelId, subagentModelId, subagentThinkingOptionId, memoryModelId } =
      requested;
    const isBackgroundRefused = backgroundModelId !== undefined && provider !== "claude";
    if (isBackgroundRefused) {
      throw new ApiEndpointRequestError({
        code: "invalid_input",
        message: "Only Claude Code has a background task model",
      });
    }
    const isMemoryRefused = memoryModelId !== undefined && provider !== "codex";
    if (isMemoryRefused) {
      throw new ApiEndpointRequestError({
        code: "invalid_input",
        message: "Only Codex has a memory model",
      });
    }
    let agent = this.withCodexSubagentRouting(input);
    if (backgroundModelId !== undefined) {
      agent = { ...agent, backgroundModelId: sideModel({ state, requested: backgroundModelId }) };
    }
    if (subagentModelId !== undefined) {
      let model: string | null = null;
      if (provider === "codex") model = this.codexSideModel(state, subagentModelId);
      else model = sideModel({ state, requested: subagentModelId });
      agent = { ...agent, subagentModelId: model };
    }
    if (memoryModelId !== undefined) {
      agent = { ...agent, memoryModelId: this.codexSideModel(state, memoryModelId) };
    }
    if (subagentThinkingOptionId === undefined) return agent;
    if (provider === "claude") {
      return { ...agent, subagentThinkingOptionId: subagentLevel(subagentThinkingOptionId) };
    }
    const level = this.codexSubagentLevel({ state, agent, requested: subagentThinkingOptionId });
    return { ...agent, subagentThinkingOptionId: level };
  }

  /**
   * 强制 Subagent 模型（magpie CodexSubagentModel）与「Codex Subagent 可用任意模型」（magpie CodexAgentsV1）：只有 Codex，
   * 都不写 Codex 配置。模型取值同默认 Subagent 模型；省略的不变，null 为不设。
   */
  private withCodexSubagentRouting(input: {
    state: ApiEndpointState;
    provider: ApiEndpointProvider;
    agent: ApiEndpointAgentSettings;
    requested: ApiEndpointAgentSettingsInput;
  }): ApiEndpointAgentSettings {
    const { state, provider, requested } = input;
    const { forcedSubagentModelId, allowsAnySubagentModel } = requested;
    const setsRouting = forcedSubagentModelId !== undefined || allowsAnySubagentModel !== undefined;
    if (setsRouting && provider !== "codex") {
      throw new ApiEndpointRequestError({
        code: "invalid_input",
        message: "Only Codex has a forced Subagent model and Subagents on any model",
      });
    }
    let agent = input.agent;
    if (forcedSubagentModelId !== undefined) {
      const forced = this.codexSideModel(state, forcedSubagentModelId);
      agent = { ...agent, forcedSubagentModelId: forced };
    }
    if (allowsAnySubagentModel !== undefined) agent = { ...agent, allowsAnySubagentModel };
    return agent;
  }

  /** Codex 的默认 Subagent 档位（magpie subagent_effort 的 Set）：Subagent 跑的模型收的才行，档位不清楚时都收。 */
  private codexSubagentLevel(input: {
    state: ApiEndpointState;
    agent: ApiEndpointAgentSettings;
    requested: string | null;
  }): string | null {
    const { state, agent } = input;
    if (input.requested === null) return null;
    const level = input.requested.trim();
    if (level === "") {
      throw new ApiEndpointRequestError({
        code: "invalid_input",
        message: "The Subagent thinking can't be empty",
      });
    }
    const levels = this.codexSubagentLevels(state, agent);
    const isRefused = levels.length > 0 && !levels.includes(level);
    if (isRefused) {
      const modelId = agent.subagentModelId ?? this.codexMainModel(agent) ?? "the model";
      throw new ApiEndpointRequestError({
        code: "invalid_input",
        message: `Codex runs ${modelId} at ${levels.join(", ")}, not ${level}: it would refuse to start a subagent`,
      });
    }
    return level;
  }

  /**
   * 打开总开关时照 magpie 挑默认模型（default-model-pick.ts）：读 CLI 配置里现在的模型、它是否还指向中转站、
   * 上次关掉时记下的模型；用 ChatGPT 登录、模型归 Codex 自己时是 joined。读不出的配置按没设（打开时写配置会照旧报错）。
   */
  private pickDefaultModel(
    state: ApiEndpointState,
    provider: ApiEndpointProvider,
  ): DefaultModelPick | null {
    const cli = provider === "claude" ? this.claudePickInput() : this.codexPickInput();
    return pickDefaultModel({ state, provider, ...cli });
  }

  /** Claude Code 自己的默认照 magpie 取 models.dev 上最新的 Claude（claudeOwn）。 */
  private claudePickInput(): CliPickInput {
    const text = readOptionalFile(this.resolveClaudeSettingsPath())?.toString("utf8") ?? null;
    return {
      cliModel: readClaudeModel(text),
      ownDefaultModel: this.modelsDev.claudeCodeModels()[0] ?? null,
      isWired: this.claudePointsAtGateway(),
      reconnect: this.store.readClaudeTakeover().reconnect ?? null,
      joinsOwnModel: false,
      writesEndpointName: false,
    };
  }

  /**
   * ChatGPT 登录时：用着内置 openai 或镜像的 Codex 模型归它自己（joined）；用着用户自己的服务商时写进去的是
   * 「接口标识/模型名」（09 号工单）。Codex 自己的默认取 models_cache.json 里排在最前的。
   */
  private codexPickInput(): CliPickInput {
    const configPath = this.resolveCodexConfigPath();
    const text = readOptionalFile(configPath)?.toString("utf8") ?? null;
    const usesChatGpt = this.codexUsesChatGpt();
    const keepsOwnModel = codexKeepsOwnModel(text);
    return {
      cliModel: readCodexModel(text),
      ownDefaultModel: codexOwnFirstModel(readCodexModelsCache(path.dirname(configPath))),
      isWired: this.codexPointsAtGateway(),
      reconnect: this.store.readCodexTakeover().reconnect ?? null,
      joinsOwnModel: usesChatGpt && keepsOwnModel,
      writesEndpointName: usesChatGpt && !keepsOwnModel,
    };
  }

  /** settings.json 现在指向中转站（官方模式下也查，例如「保留当前设置」之后）。 */
  private claudePointsAtGateway(): boolean {
    const gatewayUrl = this.gatewayUrlFor("claude");
    const { baseUrl } = this.inspectClaude({ enabled: false, defaultModelId: null });
    if (gatewayUrl === null || baseUrl === null) return false;
    return trimTrailingSlashes(baseUrl) === gatewayUrl;
  }

  /** config.toml 生效的地址是中转站的服务商地址或 ChatGPT 后端地址。 */
  private codexPointsAtGateway(): boolean {
    const gatewayUrl = this.gatewayUrlFor("codex");
    const { baseUrl } = this.inspectCodex(false);
    if (gatewayUrl === null || baseUrl === null) return false;
    const gatewayUrls = [
      `${gatewayUrl}${CODEX_GATEWAY_SUFFIX}`,
      `${gatewayUrl}${CHATGPT_BACKEND_PATH}`,
    ];
    return gatewayUrls.includes(trimTrailingSlashes(baseUrl));
  }

  /**
   * 关「使用第三方接口」前的预览（照 magpie 的 DisconnectPreview）：用关开关同一份还原计划（claudeRestorePlan、
   * codexRestorePlan）在 CLI 配置的当前内容上算出关掉以后的样子，逐行比较。什么都不写，也不先跟 CLI 的选择走
   * （那会改写文件）。总开关关着或没有接管记录时没有要改的。读不懂时抛 config_unparsable。
   */
  previewSwitchOff(provider: string): Promise<ApiEndpointSwitchOffPreview> {
    return this.exclusive(() => {
      const supported = requireProvider(provider);
      const agent = this.readState().agents[supported];
      const file = agent.enabled ? this.switchOffFile(supported, agent.defaultModelId) : null;
      const files = file === null ? [] : [file];
      return { files };
    });
  }

  private switchOffFile(
    provider: ApiEndpointProvider,
    defaultModelId: string | null,
  ): ApiEndpointSwitchOffFile | null {
    if (provider === "claude") {
      const { takeover } = this.store.readClaudeTakeover();
      if (!takeover) return null;
      const filePath = this.resolveClaudeSettingsPath();
      const before = readOptionalFile(filePath)?.toString("utf8") ?? null;
      const plan = claudeRestorePlan({ filePath, text: before, takeover, defaultModelId });
      return switchOffFileChange({
        path: filePath,
        homeDir: this.homeDir,
        before,
        after: plan.change,
      });
    }
    const { takeover } = this.store.readCodexTakeover();
    if (!takeover) return null;
    const filePath = this.resolveCodexConfigPath();
    const before = readOptionalFile(filePath)?.toString("utf8") ?? null;
    const plan = codexRestorePlan({ filePath, text: before, takeover, defaultModelId });
    return switchOffFileChange({
      path: filePath,
      homeDir: this.homeDir,
      before,
      after: plan.change,
    });
  }

  /**
   * 「保留当前设置」（ADR 0012）：关掉总开关，但不按接管记录改回 CLI 配置；接管记录一并忘掉，此后不再提示。
   * 先忘掉接管记录再落下关开关，commit 里的切回官方因此什么都不改；落不下时把接管记录放回去。
   */
  keepCurrentSettings(input: KeepCurrentSettingsInput): Promise<ApiEndpointAgentSettings> {
    return this.exclusive(async () => {
      const supported = requireProvider(input.provider);
      await this.followCliPicks();
      const state = this.readState();
      const agent = state.agents[supported];
      if (!agent.enabled) return agent;
      // 「模型被换掉」的保留当前设置：CLI 现在的模型记作它自己的，不再提示，总开关照开（照 magpie 的 Keep）。
      if (input.code === "model_replaced") {
        this.keepCliModel({ provider: supported, held: "kept" });
        return this.shownAgent(state, supported);
      }
      const forget = this.forgetTakeover(supported);
      try {
        const next = await this.commit(state, {
          ...state,
          agents: { ...state.agents, [supported]: { ...agent, enabled: false } },
        });
        return this.shownAgent(next, supported);
      } catch (error) {
        forget.undo();
        throw error;
      }
    });
  }

  /** 把 CLI 配置里现在的模型记作 CLI 自己的（跟过去的，或保留当前设置后不再提示的）：重写不碰它。 */
  private keepCliModel(input: { provider: ApiEndpointProvider; held: CliModelHold }): void {
    const { provider, held } = input;
    if (provider === "claude") {
      const record = this.store.readClaudeTakeover();
      const text = readOptionalFile(this.resolveClaudeSettingsPath())?.toString("utf8") ?? null;
      const takeover = keepClaudeCliModel({ text, takeover: record.takeover, held });
      // 读状态时每次都会走到这里：记录没变就不写。
      if (!isDeepStrictEqual(takeover, record.takeover)) {
        this.store.writeClaudeTakeover({ ...record, takeover });
      }
      return;
    }
    const record = this.store.readCodexTakeover();
    const text = readOptionalFile(this.resolveCodexConfigPath())?.toString("utf8") ?? null;
    const takeover = keepCodexCliModel({ text, takeover: record.takeover, held });
    if (!isDeepStrictEqual(takeover, record.takeover)) {
      this.store.writeCodexTakeover({ ...record, takeover });
    }
  }

  /** CLI 配置里自己存下的选择；没开开关、没有接管记录或读不懂时为 null。 */
  private readCliPicks(provider: ApiEndpointProvider): CliPicks | null {
    if (provider === "claude") {
      const text = readOptionalFile(this.resolveClaudeSettingsPath())?.toString("utf8") ?? null;
      return readClaudeCliPicks({ text, takeover: this.store.readClaudeTakeover().takeover });
    }
    const text = readOptionalFile(this.resolveCodexConfigPath())?.toString("utf8") ?? null;
    return readCodexCliPicks({ text, takeover: this.store.readCodexTakeover().takeover });
  }

  /**
   * CLI 存下的模型对上的默认模型（ADR 0012）：光秃秃的、带接口标识的、带 [1m] 的、只差写法的都算，
   * Claude Code 的档位名按映射；ChatGPT 接法下光秃秃的名字是 ChatGPT 自带的，只认「接口标识/模型名」。对不上为 null。
   */
  private followedModel(input: {
    state: ApiEndpointState;
    provider: ApiEndpointProvider;
    cliModel: string | null;
  }): string | null {
    const { state, provider, cliModel } = input;
    if (cliModel === null) return null;
    const isChatGptWiredCodex = provider === "codex" && this.isCodexChatGptWired();
    if (isChatGptWiredCodex) {
      const named = endpointModelGroups(state).flatMap((group) => group.models);
      return named.find((entry) => entry.id === cliModel)?.id ?? null;
    }
    const served = servedModel(state, cliModel);
    const isTierNameLeft = served === null && provider === "claude";
    return isTierNameLeft ? mappedTierModel(state, cliModel) : served;
  }

  private isCodexChatGptWired(): boolean {
    return isChatGptWiring(this.store.readCodexTakeover().takeover);
  }

  /**
   * 照 magpie 的 Follow：读状态时与改写前，CLI 自己存下的选择跟着走。模型换成某家接口提供的就是新的默认模型、记作 CLI 的；
   * Codex 用 ChatGPT 登录时在 /model 里选 ChatGPT 自带模型不算被改（magpie 的 Beside），同样记作它的；
   * 之前已保留过的再换成别家都没有的，照样记作它的、不再提示（magpie 的 Keep 之后没有记录可比）。思考档位与 Ultra Code 换了就跟过去。
   * 跟随默认模型的字段（模型提示、modelSettings 档位、Codex 模型目录）随之重写。写不成只记日志。
   */
  private async followCliPicks(): Promise<void> {
    for (const provider of API_ENDPOINT_PROVIDERS) {
      try {
        await this.followCliPicksOf(provider);
      } catch (error) {
        if (!(error instanceof ApiEndpointRequestError)) throw error;
        this.logger.warn({ err: error, provider }, "Could not follow the CLI's own picks");
      }
    }
  }

  private async followCliPicksOf(provider: ApiEndpointProvider): Promise<void> {
    const state = this.readStateForSnapshot();
    const isWired =
      state?.agents[provider].enabled === true && this.gatewayUrlFor(provider) !== null;
    if (!state || !isWired) return;
    const picks = this.readCliPicks(provider);
    if (!picks) return;
    const before = state.agents[provider];
    const followed = this.followedCliPicks({ state, provider, picks });
    const { agent } = followed;
    // 先落下跟过去的设置，再记模型归 CLI：落不下时记录不动，下次照样跟。
    if (agent !== before) {
      await this.commit(
        state,
        { ...state, agents: { ...state.agents, [provider]: agent } },
        { isFollowingCli: true },
      );
      this.logger.info({ provider }, "Followed the CLI's own picks");
    }
    if (followed.held !== null) this.keepCliModel({ provider, held: followed.held });
    if (followed.isEffortOriginalForgotten) this.forgetCodexEffortOriginal();
  }

  /**
   * 跟过去后的设置（照 magpie：档位与 Ultra Code 一律读文件），与 CLI 的模型要记成哪种归属（不用记为 null）；
   * Codex 删掉了档位时，接管前的档位也不再放回。
   */
  private followedCliPicks(input: {
    state: ApiEndpointState;
    provider: ApiEndpointProvider;
    picks: CliPicks;
  }): FollowedCliPicks {
    const { state, provider, picks } = input;
    let agent = state.agents[provider];
    let held: CliModelHold | null = null;
    if (picks.model) {
      const followed = this.followedModel({ state, provider, cliModel: picks.model.now });
      const isChatGptOwnModel = provider === "codex" && this.isCodexChatGptWired();
      if (followed !== null) {
        if (followed !== agent.defaultModelId) agent = { ...agent, defaultModelId: followed };
        held = "followed";
      } else if (isChatGptOwnModel) {
        held = "followed";
      } else if (picks.model.isKept) {
        held = "kept";
      }
    }
    const isLevelChanged = picks.level !== (agent.defaultThinkingOptionId ?? null);
    if (isLevelChanged) agent = { ...agent, defaultThinkingOptionId: picks.level };
    const isUltraCodeOn = picks.isUltraCodeOn;
    if (isUltraCodeOn !== null) {
      const isUltraCodeChanged = isUltraCodeOn !== (agent.usesUltraCode === true);
      if (isUltraCodeChanged) agent = { ...agent, usesUltraCode: isUltraCodeOn };
    }
    if (provider === "codex") {
      agent = this.followedCodexSide({ state, agent, picks });
    } else if (picks.subagent) {
      agent = followedSubagent({ state, agent, now: picks.subagent.now });
    }
    const isEffortOriginalForgotten =
      provider === "codex" && isLevelChanged && picks.level === null;
    return { agent, held, isEffortOriginalForgotten };
  }

  /**
   * config.toml 里的默认 Subagent 模型、档位与记忆模型被改了之后的设置（照 magpie 这几个字段的 Get 读文件）：删掉了就不设；
   * 模型改成接口提供的就跟过去，哪家都没有的不跟（仍算被改过，下次改写写回）；档位照文件跟。没变时原样返回同一个对象。
   */
  private followedCodexSide(input: {
    state: ApiEndpointState;
    agent: ApiEndpointAgentSettings;
    picks: CliPicks;
  }): ApiEndpointAgentSettings {
    const { state, picks } = input;
    let agent = input.agent;
    if (picks.subagent) {
      const subagentModelId = this.followedCodexModel({
        state,
        pick: picks.subagent,
        current: agent.subagentModelId ?? null,
      });
      if (subagentModelId !== (agent.subagentModelId ?? null))
        agent = { ...agent, subagentModelId };
    }
    const level = picks.subagentLevel?.now ?? null;
    const isLevelChanged =
      picks.subagentLevel !== null && level !== (agent.subagentThinkingOptionId ?? null);
    if (isLevelChanged) agent = { ...agent, subagentThinkingOptionId: level };
    if (picks.memory) {
      const memoryModelId = this.followedCodexModel({
        state,
        pick: picks.memory,
        current: agent.memoryModelId ?? null,
      });
      if (memoryModelId !== (agent.memoryModelId ?? null)) agent = { ...agent, memoryModelId };
    }
    return agent;
  }

  private followedCodexModel(input: {
    state: ApiEndpointState;
    pick: CliSidePick;
    current: string | null;
  }): string | null {
    const { state, pick } = input;
    if (pick.now === null) return null;
    // Codex 自己的模型（ChatGPT 接法下）也照文件跟（magpie 的 Get 读文件），不写回、不算被改过。
    const isOwn = this.codexOwnModels().some((own) => own.slug === pick.now);
    if (isOwn) return pick.now;
    const served = this.followedModel({ state, provider: "codex", cliModel: pick.now });
    return served ?? input.current;
  }

  private forgetCodexEffortOriginal(): void {
    const record = this.store.readCodexTakeover();
    if (!record.takeover) return;
    this.store.writeCodexTakeover({
      ...record,
      takeover: forgetCodexEffortOriginal(record.takeover),
    });
  }

  /** 「模型被换掉」：CLI 自己换成了哪家接口都没有的模型，还没保留过（ADR 0012）。 */
  private modelReplacedIssue(
    state: ApiEndpointState,
    provider: ApiEndpointProvider,
  ): AgentIssue | null {
    const agent = state.agents[provider];
    if (!agent.enabled) return null;
    const picks = this.readCliPicks(provider);
    const model = picks?.model;
    if (!model) return null;
    if (model.isKept) return null;
    if (this.followedModel({ state, provider, cliModel: model.now }) !== null) return null;
    const isChatGptOwnModel = provider === "codex" && this.isCodexChatGptWired();
    if (isChatGptOwnModel) return null;
    const file =
      provider === "claude" ? this.resolveClaudeSettingsPath() : this.resolveCodexConfigPath();
    const now = model.now ?? "";
    const shown = model.now ?? `${AGENT_NAMES[provider]}'s own default`;
    return {
      code: "model_replaced",
      params: { file, model: now, defaultModel: agent.defaultModelId ?? "" },
      message: `${AGENT_NAMES[provider]}'s model was changed to ${shown} in ${file}, and none of your enabled API endpoints serve it`,
    };
  }

  /** 忘掉接管记录（备份留着，只供手动找回）；返回放回去的办法。 */
  private forgetTakeover(provider: ApiEndpointProvider): { undo: () => void } {
    if (provider === "claude") {
      const record = this.store.readClaudeTakeover();
      this.store.writeClaudeTakeover({ ...record, takeover: null });
      return { undo: () => this.store.writeClaudeTakeover(record) };
    }
    const record = this.store.readCodexTakeover();
    // 服务商表被外部改过：保留就是保留，启动时也不改回指向中转站。
    const tableKept = this.inspectCodex(true).issues.some((issue) =>
      issue.params?.keys?.split(", ").includes(`model_providers.${CODEX_API_ENDPOINT_PROVIDER_ID}`),
    );
    this.store.writeCodexTakeover({
      ...record,
      takeover: null,
      ...(tableKept ? { tableKept: true } : {}),
    });
    return { undo: () => this.store.writeCodexTakeover(record) };
  }

  /** 接口开关与「立刻恢复」。关掉开关按默认模型失踪规则处理各 Agent。 */
  setEndpointState(input: ApiEndpointStateInput): Promise<void> {
    return this.exclusiveFollowing(async () => {
      const state = this.readState();
      const endpoint = findEndpoint(state, input.endpointId);
      if (!endpoint) {
        throw new ApiEndpointRequestError({ code: "not_found", message: "API endpoint not found" });
      }
      if (input.clearCooldown) this.cooldowns.clear(endpoint.id);
      if (input.enabled === undefined || input.enabled === endpoint.enabled) return;
      await this.commit(state, {
        ...state,
        endpoints: withEndpoint(state.endpoints, { ...endpoint, enabled: input.enabled }),
      });
    });
  }

  /**
   * 整体改写接口顺序（照 magpie SetOrder）：同一个 id 出现两次或不是接口就拒收；没列出的按现在的先后接在后面。
   * 顺序也决定 Codex 模型目录、Claude Code 选单的先后，所以走 commit 让 CLI 配置跟上。
   */
  setOrder(endpointIds: string[]): Promise<void> {
    return this.exclusiveFollowing(async () => {
      const state = this.readState();
      const byId = new Map(state.endpoints.map((endpoint) => [endpoint.id, endpoint]));
      const named = new Set<string>();
      for (const id of endpointIds) {
        if (named.has(id)) {
          throw new ApiEndpointRequestError({
            code: "invalid_input",
            message: `${id} is in the order twice`,
          });
        }
        if (!byId.has(id)) {
          throw new ApiEndpointRequestError({
            code: "invalid_input",
            message: `${id} is not an API endpoint`,
          });
        }
        named.add(id);
      }
      const endpoints = [
        ...endpointIds.flatMap((id) => byId.get(id) ?? []),
        ...state.endpoints.filter((endpoint) => !named.has(endpoint.id)),
      ];
      await this.commit(state, { ...state, endpoints });
    });
  }

  /**
   * 长对话（照 magpie SetFullContext、SetCompactAt）：fullContext 开关「完整窗口」；compactAt 为正整数时设全局压缩阈值
   * （272K 等于不设），null 回到 272K，省略即不变。告诉 Codex 的窗口与 Claude Code 的压缩阈值跟着改，所以走 commit。
   */
  setLongConversations(input: { fullContext: boolean; compactAt?: number | null }): Promise<void> {
    return this.exclusiveFollowing(async () => {
      const { compactAt } = input;
      const isTokenCount =
        compactAt === undefined ||
        compactAt === null ||
        (Number.isInteger(compactAt) && compactAt > 0);
      if (!isTokenCount) {
        throw new ApiEndpointRequestError({
          code: "invalid_input",
          message: `Compact at must be a number of tokens, not ${compactAt}`,
        });
      }
      const state = this.readState();
      let kept = state.longConversations?.compactAt;
      if (compactAt !== undefined) kept = compactAt ?? undefined;
      if (kept === WORKING_WINDOW) kept = undefined;
      const longConversations: ApiEndpointLongConversations = {
        ...(input.fullContext ? { fullContext: true } : {}),
        ...(kept === undefined ? {} : { compactAt: kept }),
      };
      const { longConversations: _previous, ...rest } = state;
      const isEmpty = Object.keys(longConversations).length === 0;
      await this.commit(state, isEmpty ? rest : { ...rest, longConversations });
    });
  }

  /**
   * 已禁用的模型（照 magpie SetDisabledModels）：整份名单换掉，去掉首尾空白、空的与只差大小写的重复。命中的模型不再在服务，
   * 默认模型被禁时按失踪规则换掉，CLI 配置与 Codex 目录跟着改，所以走 commit。
   */
  setDisabledModels(input: { models: string[] }): Promise<void> {
    return this.exclusiveFollowing(async () => {
      const state = this.readState();
      const disabledModels = cleanDisabledModels(input.models);
      const { disabledModels: _previous, ...rest } = state;
      await this.commit(state, disabledModels.length === 0 ? rest : { ...rest, disabledModels });
    });
  }

  /**
   * 接口名显示方式（照 magpie SetSuffixMode）：always 不存。写给 Codex 的显示名跟着改、Codex 的清单标记跟着变，所以走 commit。
   */
  setEndpointNameDisplay(input: { display: string }): Promise<void> {
    return this.exclusiveFollowing(async () => {
      const { display } = input;
      if (!isApiEndpointNameDisplay(display)) {
        throw new ApiEndpointRequestError({
          code: "invalid_input",
          message: `Endpoint name in model lists must be always, clash or never, not ${display}`,
        });
      }
      const state = this.readState();
      const { endpointNameDisplay: _previous, ...rest } = state;
      await this.commit(
        state,
        display === "always" ? rest : { ...rest, endpointNameDisplay: display },
      );
    });
  }

  /**
   * 接口名显示方式管不到的 Agent（magpie noNamesSaid / agent.NoNames）：开着、用 API key 接的 Codex，
   * 它的 /model 只列光秃秃的名字（模型目录），本来就不带接口名。
   */
  private endpointNamesUnreached(state: ApiEndpointState): ApiEndpointProvider[] {
    if (!state.agents.codex.enabled) return [];
    return this.isCodexChatGptWired() ? [] : ["codex"];
  }

  /** 选择器里接口名的显示方式；官方模式、不支持的提供方或文件读不懂时返回 null。 */
  endpointNameDisplay(provider: string): ApiEndpointNameDisplay | null {
    const state = this.readStateForSnapshot();
    const supported = findProvider(provider);
    if (!state || !supported || !state.agents[supported].enabled) return null;
    return endpointNameDisplayOf(state);
  }

  /** 在服务的模型：去掉一周内下线的与已禁用的。选单、默认模型、写给 CLI 的模型都按它。 */
  private served(state: ApiEndpointState): ApiEndpointState {
    return withoutDisabledModels(this.retiredModels.listed(state));
  }

  /**
   * 落下一次变更：先按默认模型失踪规则整理各 Agent，再让 Codex 模型目录与 CLI 配置跟上（改不成就整个不保存），
   * 最后写 key、endpoints.json 与口令，并通知设置有变的 Agent。返回落下的状态。
   * 开着却没有口令的补一个；口令关掉不作废（nextGatewayTokens）。
   */
  private async commit(
    previous: ApiEndpointState,
    proposed: ApiEndpointState,
    options: {
      keys?: Record<string, string>;
      // 老客户端的「重新应用」：内容没变也重写这个 Agent 的 CLI 配置，盖掉外部改动。
      rewrite?: ApiEndpointProvider;
      // 这次变更是跟着 CLI 自己存下的选择：默认模型变了也不写回 CLI 配置里的模型。
      isFollowingCli?: boolean;
    } = {},
  ): Promise<ApiEndpointState> {
    this.forgetDiscoveryIfHeldChanges({ previous, proposed, keys: options.keys });
    const ownModels = this.codexOwnModels().map((model) => model.slug);
    // 默认模型等按在服务的模型整理：被禁的和删掉的一样换掉；存下的已选模型不动。
    const { agents } = settleAgentSettings({
      state: withoutDisabledModels(proposed),
      codexOwnModels: ownModels,
    });
    const settled = this.settleThinking({ previous, next: { ...proposed, agents } });
    const next = this.settleSubagentThinking(settled);
    for (const provider of API_ENDPOINT_PROVIDERS) {
      if (!previous.agents[provider].enabled && next.agents[provider].enabled) {
        this.requireGateway();
      }
    }
    const previousTokens = this.store.readGatewayTokens();
    const tokens = nextGatewayTokens(next, previousTokens);

    // 不在 TCP 上监听、CLI 配置也从没指向过中转站的开着的 Agent：没有地址可写，留到下次以 TCP 启动时对账；
    // 打开总开关在上面已经拒绝，这里只放过关接口、删模型这类连带改动。
    const unreachable = (provider: ApiEndpointProvider) =>
      next.agents[provider].enabled && this.gatewayUrlFor(provider) === null;
    const changed = API_ENDPOINT_PROVIDERS.filter(
      (provider) =>
        !unreachable(provider) &&
        (provider === options.rewrite ||
          this.cliFingerprint(previous, provider, previousTokens) !==
            this.cliFingerprint(next, provider, tokens)),
    );
    const catalogBefore = this.store.readCodexModelCatalog();
    const catalog = next.agents.codex.enabled ? this.codexModelCatalog(next) : null;
    const synced: ApiEndpointProvider[] = [];
    try {
      // 先有目录文件，config.toml 才指向它。
      if (catalog !== null && catalog !== catalogBefore) this.store.writeCodexModelCatalog(catalog);
      for (const provider of changed) {
        this.syncCli({
          provider,
          wiring: this.cliWiring(next, provider, tokens),
          agent: next.agents[provider],
          shouldRewriteModel: shouldRewriteCliModel({ previous, next, provider, options }),
        });
        synced.push(provider);
      }
    } catch (error) {
      // 已经改好的 CLI 配置和目录退回去，状态整个不保存。
      for (const provider of synced) {
        try {
          this.syncCli({
            provider,
            wiring: this.cliWiring(previous, provider, previousTokens),
            agent: previous.agents[provider],
          });
        } catch (revertError) {
          this.logger.error({ err: revertError, provider }, "Failed to revert CLI config");
        }
      }
      if (catalog !== catalogBefore) this.store.writeCodexModelCatalog(catalogBefore);
      throw error;
    }
    if (catalog === null && catalogBefore !== null && !this.codexConfigNamesCatalog()) {
      this.store.writeCodexModelCatalog(null);
    }

    for (const [id, apiKey] of Object.entries(options.keys ?? {})) {
      this.store.setApiKey(id, apiKey);
    }
    this.store.writeState(next);
    releaseUncheckedHosts(releasedUncheckedHosts({ previous, next }));
    this.icons.prune({ usedBefore: endpointIcons(previous), usedNow: endpointIcons(next) });
    if (!sameTokens(tokens, previousTokens)) this.store.writeGatewayTokens(tokens);
    this.recordCliRewrites(synced);
    this.staleCodexModels(next);
    this.announceCommitted(previous, next);
    return next;
  }

  /** 通知设置有变的 Agent；两个总开关从都关着到有一个打开时让 models.dev 马上检查一次。 */
  private announceCommitted(previous: ApiEndpointState, next: ApiEndpointState): void {
    for (const provider of API_ENDPOINT_PROVIDERS) {
      if (agentFingerprint(previous, provider) !== agentFingerprint(next, provider)) {
        this.onActiveEndpointChanged(provider);
      }
    }
    if (!usesModelFacts(previous) && usesModelFacts(next)) this.modelsDev.wake();
  }

  private syncCli(input: CliSync): void {
    const { provider, wiring, agent } = input;
    const shouldRewriteModel = input.shouldRewriteModel === true;
    if (!wiring) {
      this.restoreOfficial(provider, agent.defaultModelId);
    } else if (provider === "codex") {
      this.writeCodexEndpoint({ wiring, shouldRewriteModel });
    } else {
      this.writeClaudeEndpoint({ wiring, shouldRewriteModel });
    }
  }

  /**
   * 启动时的对账：开着的 Agent 只在 CLI 配置里的中转站地址或口令不是现在的时才重写，
   * 用户手改的其它负责的键留给健康检查报告；官方模式下的 Codex 只改留着的服务商表。
   */
  private reconcileCli(
    state: ApiEndpointState,
    provider: ApiEndpointProvider,
    tokens: GatewayTokens,
    url: string,
  ): void {
    const wiring = this.cliWiring(state, provider, tokens);
    if (provider === "codex") {
      const catalog = wiring ? this.codexModelCatalog(state) : null;
      const isNamed = catalog === null && this.codexConfigNamesCatalog();
      if (catalog !== this.store.readCodexModelCatalog() && !isNamed) {
        this.store.writeCodexModelCatalog(catalog);
      }
    }
    if (!wiring) {
      if (provider === "codex") this.refreshKeptCodexTable(url);
      return;
    }
    const written = this.writtenGateway(provider);
    const claudeTakeover = provider === "claude" ? this.store.readClaudeTakeover().takeover : null;
    // COMPAT(claudeModelPickerRecord): added after v0.15.0, remove after 2027-04-15.
    // 工单 17 以前的接管记录没有 modelPicker：补写一次，终端 /model 才列出接口模型。
    const isPickerUnrecorded = provider === "claude" && claudeTakeover?.modelPicker === undefined;
    // COMPAT(claudeModelHintRecord): added after v0.15.0, remove after 2027-04-15.
    // 工单 18 以前的接管记录没有 hintEnv：补写一次模型提示。
    const isHintUnrecorded = provider === "claude" && claudeTakeover?.hintEnv === undefined;
    const isUpToDate = written?.url === url && written.token === wiring.token;
    const isRewired = provider === "codex" && this.codexWiringChanged();
    if (isUpToDate && !isPickerUnrecorded && !isHintUnrecorded && !isRewired) return;
    this.syncCli({ provider, wiring, agent: state.agents[provider] });
    this.logger.info({ provider }, "CLI config pointed at the API endpoint gateway");
  }

  /** 没有接管、或记录是旧版本直接指向接口时写的（地址不是中转站）为 null。 */
  private writtenGateway(provider: ApiEndpointProvider): WrittenGateway | null {
    if (provider === "claude") {
      const env = this.store.readClaudeTakeover().takeover?.env;
      const url = env?.ANTHROPIC_BASE_URL?.written;
      const token = env?.ANTHROPIC_AUTH_TOKEN?.written;
      // 保留 claude.ai 登录时写的是空口令。
      const isGatewayToken = typeof token === "string";
      return url?.endsWith(API_ENDPOINT_GATEWAY_PATH) && isGatewayToken ? { url, token } : null;
    }
    const table = this.store.readCodexTakeover().takeover?.table;
    if (!table?.baseUrl.endsWith(CODEX_GATEWAY_SUFFIX)) return null;
    return {
      url: table.baseUrl.slice(0, -CODEX_GATEWAY_SUFFIX.length),
      token: table.bearerToken,
    };
  }

  /** 写进 CLI 配置的中转站地址：绑定的地址；不在 TCP 上监听时沿用上次写进去的。 */
  private gatewayUrlFor(provider: ApiEndpointProvider): string | null {
    if (this.gateway.kind === "bound") return this.gateway.url;
    return this.writtenGateway(provider)?.url ?? null;
  }

  private cliWiring(
    state: ApiEndpointState,
    provider: ApiEndpointProvider,
    tokens: GatewayTokens,
  ): CliWiring | null {
    const agent = state.agents[provider];
    if (!agent.enabled || agent.defaultModelId === null) return null;
    const baseUrl = this.gatewayUrlFor(provider);
    const token = tokens[provider];
    if (baseUrl === null) throw this.gatewayError();
    // nextGatewayTokens 给每个开着的 Agent 都发了口令。
    if (token === undefined) throw new Error(`No gateway token for ${provider}`);
    // 保留 claude.ai 登录：口令写成空值，Claude Code 于是带着 claude.ai 登录来（ADR 0012）。
    const keepsSignIn = provider === "claude" && agent.keepsClaudeAiLogin === true;
    return {
      baseUrl,
      token: keepsSignIn ? "" : token,
      ...this.cliModels(state, provider, agent.defaultModelId),
      allowWebSearch: someEndpointSearchesWeb(state),
      isAutoModeReviewed: isAutoModeReviewed(state),
      defaultThinking: agent.defaultThinkingOptionId ?? null,
      ultraCode: provider === "claude" ? (agent.usesUltraCode ?? null) : null,
      ...this.sideModels(state, provider),
    };
  }

  /** 后台小任务模型、Subagent 与记忆模型写给 CLI 的样子；没设为 null。 */
  private sideModels(
    state: ApiEndpointState,
    provider: ApiEndpointProvider,
  ): Pick<CliWiring, "backgroundModel" | "subagent" | "memoryModel"> {
    if (provider === "claude")
      return { ...this.claudeSideModels(state, provider), memoryModel: null };
    const agent = state.agents[provider];
    const subagentModelId = agent.subagentModelId ?? null;
    const memoryModelId = agent.memoryModelId ?? null;
    const effort = agent.subagentThinkingOptionId ?? null;
    let model: string | null = null;
    if (subagentModelId !== null) model = this.codexListedName(state, subagentModelId);
    let memoryModel: string | null = null;
    if (memoryModelId !== null) memoryModel = this.codexListedName(state, memoryModelId);
    const isSubagentSet = model !== null || effort !== null;
    let subagent: CodexSubagentWiring | null = null;
    if (isSubagentSet) subagent = { model, effort };
    return { backgroundModel: null, subagent, memoryModel };
  }

  /**
   * 后台小任务模型与 Subagent 写给 Claude Code 的样子（照 magpie 的 writeTiers）：1M 的模型标 [1m]，带点的 Claude 版本写成连字符；
   * Subagent 的档位与只设档位时接在哪个主模型后面由补丁按文件定（照 magpie 的 setSubagent）。没设为 null。
   */
  private claudeSideModels(
    state: ApiEndpointState,
    provider: ApiEndpointProvider,
  ): Pick<CliWiring, "backgroundModel" | "subagent"> {
    const agent = state.agents[provider];
    const none = { backgroundModel: null, subagent: null };
    if (provider !== "claude" || agent.defaultModelId === null) return none;
    const backgroundModelId = agent.backgroundModelId ?? null;
    const subagentModelId = agent.subagentModelId ?? null;
    const effort = agent.subagentThinkingOptionId ?? null;
    let backgroundModel: string | null = null;
    if (backgroundModelId !== null) backgroundModel = this.claudeEnvModel(state, backgroundModelId);
    let model: string | null = null;
    if (subagentModelId !== null) model = this.claudeEnvModel(state, subagentModelId);
    const isSubagentSet = model !== null || effort !== null;
    let subagent: ClaudeSubagentWiring | null = null;
    if (isSubagentSet) subagent = { model, effort };
    return { backgroundModel, subagent };
  }

  /** 一个模型写进 Claude Code env 的写法（同起始模型）。 */
  private claudeEnvModel(state: ApiEndpointState, modelId: string): string {
    const listed = this.served(state);
    const marked = markOneMillion({ id: modelId, facts: this.startModelFacts(listed, modelId) });
    const served = [
      ...usableModels(listed).map((model) => model.id),
      ...defaultModelChoices(listed),
    ];
    return claudeSpelled({ model: marked, served });
  }

  /**
   * Subagent 思考档位能选的档位（照 magpie subagent_effort 字段的 Options）：Subagent 模型的档位，跟主模型时
   * Claude Code 是 settings.json 里现在的主模型的（tierEfforts(cmp.Or(m, mainModel()))），Codex 是主对话模型的（subEfforts）。
   * 总开关关着时为 null。
   */
  subagentThinkingOptions(provider: string): AgentSelectOption[] | null {
    const state = this.readStateForSnapshot();
    const supported = findProvider(provider);
    if (!state || !supported) return null;
    const agent = state.agents[supported];
    if (!agent.enabled || agent.defaultModelId === null) return null;
    if (supported === "codex") {
      // 档位不清楚时照 magpie 给 low、medium、high、xhigh。
      const levels = this.codexSubagentLevels(state, agent);
      const isKnown = levels.length > 0;
      const shown = isKnown ? levels : CODEX_UNKNOWN_SUBAGENT_LEVELS;
      return thinkingOptionsOf({ levels: shown });
    }
    const modelId = agent.subagentModelId ?? this.claudeMainModel() ?? agent.defaultModelId;
    const levels = this.thinkingLevelsFor({ state, provider: "claude", modelId });
    return thinkingOptionsOf({ levels });
  }

  /** settings.json 里现在的主模型；读不到为 null。 */
  private claudeMainModel(): string | null {
    const text = readOptionalFile(this.resolveClaudeSettingsPath())?.toString("utf8") ?? null;
    return readClaudeModel(text);
  }

  /**
   * CLI 看到的起始模型；Claude Code 另有终端 /model 里的接口模型（与聊天模型选择器同样的分组和顺序，每行直达那一家，
   * 去掉已下线的）和按已知模型资料算出的提示。Codex 的模型列表在单独的目录文件里，不进 config.toml。
   */
  private cliModels(
    state: ApiEndpointState,
    provider: ApiEndpointProvider,
    defaultModelId: string,
  ): Pick<
    CliWiring,
    "model" | "modelPicker" | "hintEnv" | "compactYieldsToOwn" | "endpointModels"
  > {
    if (provider !== "claude") {
      const endpointModels = endpointModelGroups(this.served(state)).flatMap((group) =>
        group.models.map(({ id }) => id),
      );
      return { model: defaultModelId, modelPicker: [], hintEnv: {}, endpointModels };
    }
    const listed = this.served(state);
    const named = endpointModelGroups(listed).flatMap((group) => {
      const labels = this.groupModelLabels(group);
      return group.models.map(({ id, model }, index) => ({
        hint: { id, facts: this.modelFacts(group.endpoint, model.id) },
        name: labels[index] ?? model.id,
        endpointName: group.endpoint.name,
      }));
    });
    // 接口名显示方式也管终端 /model（magpie listLabels）：带接口名的行写「模型名 (接口名)」，说明换成 via Osuna，
    // 不重复说接口名；不带的照旧在说明里写接口名（magpie 的 note 同样留着提供方）。
    const shows = showsEndpointNames({
      display: endpointNameDisplayOf(state),
      names: named.map(({ name }) => name),
    });
    const rows = named.map(({ hint, name, endpointName }, index) =>
      shows[index]
        ? { hint, label: `${name} (${endpointName})`, description: VIA_OSUNA }
        : { hint, label: name, description: endpointName },
    );
    // 带点的 Claude 版本写成连字符（只在能唯一对回时），中转站再认回这家自己的写法。
    const served = [
      ...usableModels(listed).map((model) => model.id),
      ...rows.map((row) => row.hint.id),
    ];
    const spelled = (model: ClaudeHintModel): ClaudeHintModel => ({
      id: claudeSpelled({ model: model.id, served }),
      facts: model.facts,
    });
    const hintModel = (modelId: string): ClaudeHintModel =>
      spelled({ id: modelId, facts: this.startModelFacts(listed, modelId) });
    const start = hintModel(defaultModelId);
    // 后台小任务模型是 magpie 的 haiku 档位模型；Subagent 模型只在设了时算（只设档位时跟主模型）。
    const agent = state.agents.claude;
    const tiers = agent.backgroundModelId ? [hintModel(agent.backgroundModelId)] : [];
    const subagent = agent.subagentModelId ? hintModel(agent.subagentModelId) : null;
    const hints = claudeHints({
      start,
      tiers,
      subagent,
      listed: rows.map((row) => spelled(row.hint)),
      longConversations: state.longConversations,
    });
    return {
      model: markOneMillion(start),
      modelPicker: rows.map((row) => ({
        model: markOneMillion(spelled(row.hint)),
        label: row.label,
        description: row.description,
      })),
      hintEnv: hints.env,
      compactYieldsToOwn: hints.compactYieldsToOwn,
      endpointModels: [],
    };
  }

  /** 起始模型是不带接口标识的模型名，中转站先发给接口顺序里最靠前、开着、选了它的那家：资料也按那家查。 */
  private startModelFacts(state: ApiEndpointState, modelId: string): ModelFacts {
    // 指定了某一家的默认模型按那一家查。
    const named = namedDefaultModel(state, modelId);
    if (named) return this.modelFacts(named.endpoint, named.model.id);
    const endpoint = state.endpoints.find(
      (entry) => entry.enabled && entry.models.some((model) => model.id === modelId),
    );
    return endpoint ? this.modelFacts(endpoint, modelId) : this.modelsDev.facts(modelId);
  }

  /**
   * 这家这个模型的资料：这家上游清单给的在前，models.dev 补上没给的。
   * Codex 模型目录、Claude Code 的模型提示与中转站（翻译时的档位、回复上限、采样参数，选路时的窗口）都按它查。
   */
  modelFacts(endpoint: StoredApiEndpoint, modelId: string): EndpointModelFacts {
    const auto = this.autoModelFacts(endpoint, modelId);
    const resolved = resolveModelFacts({ settings: endpoint.modelSettings, modelId, auto });
    const { noThinking, contextSet, ...facts } = resolved;
    // 档位不知道的模型（或知道它没有可挑的）由用户给的几档当它自己的（magpie Efforts）。
    const vendorEfforts = auto.efforts?.length ? auto.efforts : resolved.efforts;
    // 收不收采样参数只认这家自己（按地址的主机名）在 models.dev 的条目，不借别家的目录。
    const hosts = endpoint.baseUrls.map((base) => hostOf(base.url));
    const takesSampling = this.modelsDev.takesSampling({ hosts, modelId });
    return {
      ...facts,
      ...(vendorEfforts === undefined ? {} : { vendorEfforts }),
      ...(noThinking ? { noThinking } : {}),
      ...(contextSet ? { contextSet } : {}),
      ...(takesSampling === undefined ? {} : { takesSampling }),
    };
  }

  /**
   * 不看模型设置、Osuna 自动取到的资料：这家上游清单给的在前，models.dev 补上没给的；显示名先取这家清单（或已选、
   * 手动添加时记下）的，再取 models.dev 的。
   */
  private autoModelFacts(endpoint: StoredApiEndpoint, modelId: string): ModelFacts {
    const listed = endpoint.catalog?.models.find((model) => model.id === modelId);
    const known = this.modelsDev.facts(modelId);
    const facts = mergeModelFacts(listed?.facts, known);
    const label =
      listed?.label ??
      endpoint.models.find((model) => model.id === modelId)?.label ??
      endpoint.manualModels?.find((model) => model.id === modelId)?.label;
    return label === undefined ? facts : { ...facts, name: label };
  }

  /** 这家这个模型的名字：用户起的，再是清单或 models.dev 的，都没有就是模型 id。 */
  private modelName(endpoint: StoredApiEndpoint, modelId: string): string {
    return this.modelFacts(endpoint, modelId).name ?? modelId;
  }

  /** 一家的模型在选单里的名字；同一家里撞名的显示模型 id（照 magpie）。不同家的由分组或接口名分开。 */
  private groupModelLabels(group: {
    endpoint: StoredApiEndpoint;
    models: EndpointGroupModel[];
  }): string[] {
    return distinctModelLabels(
      group.models.map(({ model }) => ({
        id: model.id,
        label: this.modelName(group.endpoint, model.id),
      })),
    );
  }

  /** 光秃秃的模型名在选单里的名字：按接口顺序里最靠前、开着、选了它的那家查（中转站也先发给那家）；撞名的显示模型 id。 */
  private bareModelLabels(
    state: ApiEndpointState,
    models: ReadonlyArray<{ id: string }>,
  ): string[] {
    const named = models.map(({ id }) => {
      const endpoint = firstEnabledServing(state, id);
      const label = endpoint ? this.modelName(endpoint, id) : id;
      return { id, label };
    });
    return distinctModelLabels(named);
  }

  /**
   * 模型资料变了（models.dev 更新、上游清单重拉）或有模型下线、恢复：开着的 Claude Code 跟着重写。
   * 负责的键被外部改过时不动，留给健康检查和用户；写不成只记日志，不挡调用方。
   */
  private rewriteClaudeHints(state: ApiEndpointState): void {
    if (!state.agents.claude.enabled || this.gatewayUrlFor("claude") === null) return;
    if (this.inspectClaude(state.agents.claude).health.length > 0) {
      this.logger.info("Claude settings changed outside Osuna; model hints left as they are");
      return;
    }
    try {
      this.syncCli({
        provider: "claude",
        wiring: this.cliWiring(state, "claude", this.store.readGatewayTokens()),
        agent: state.agents.claude,
      });
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to rewrite the Claude model hints");
    }
  }

  /**
   * 中转站记下或恢复了已下线模型（含满一周到期）：走「接口变了」的流程，重写 Codex 模型目录与
   * Claude Code 的模型选择列表，再通知客户端刷新开着总开关的 Agent。接口与默认模型都不动。
   */
  retiredModelsChanged(): Promise<void> {
    return this.exclusiveFollowing(() => {
      const state = this.readStateForSnapshot();
      if (!state) return;
      this.rewriteCodexCatalog(state);
      this.rewriteClaudeHints(state);
      for (const provider of API_ENDPOINT_PROVIDERS) {
        if (state.agents[provider].enabled) this.onActiveEndpointChanged(provider);
      }
    });
  }

  /** models.dev 更新了：开着的 Agent 按新资料重写 Codex 模型目录与 Claude Code 的模型提示。 */
  private refreshModelFacts(): Promise<void> {
    return this.exclusiveFollowing(() => {
      const state = this.readStateForSnapshot();
      if (!state) return;
      this.rewriteCodexCatalog(state);
      this.rewriteClaudeHints(state);
    });
  }

  /** Codex 开着时按现在的接口与模型资料重写模型目录，内容不变不写。 */
  private rewriteCodexCatalog(state: ApiEndpointState): void {
    if (!state.agents.codex.enabled) return;
    const catalog = this.codexModelCatalog(state);
    if (catalog !== this.store.readCodexModelCatalog()) this.store.writeCodexModelCatalog(catalog);
    this.staleCodexModels(state);
  }

  /**
   * 用 ChatGPT 登录的 Codex 的模型清单里接在 ChatGPT 自带模型后面的接口模型（中转站合并清单时用）、
   * 这部分清单的标记，与正被改写的 config.toml 所在的 CODEX_HOME（ChatGPT 拿不到时读 Codex 上次的清单）。
   * 标记也跟着 Codex 的默认模型变。endpoints.json 读不懂时没有接口模型。
   */
  codexChatGptListing(): ChatGptModelsListing {
    const codexHome = path.dirname(this.resolveCodexConfigPath());
    const state = this.readStateForSnapshot();
    const marksAgentsV1 = state?.agents.codex.allowsAnySubagentModel === true;
    let endpoints: CodexEndpointListing = { entries: [], endpointNames: [] };
    if (state) {
      endpoints = codexEndpointEntries({
        state: this.served(state),
        reasoningEffort: this.codexStartEffort(state),
        factsFor: (endpoint, modelId) => this.modelFacts(endpoint, modelId),
        marksAgentsV1,
      });
    }
    const nameDisplay = state ? endpointNameDisplayOf(state) : "always";
    const defaultModelId = state?.agents.codex.defaultModelId ?? null;
    const disabledModels = state?.disabledModels ?? [];
    // 被禁的 Codex 自己的模型也从清单里拿掉（magpie 把名单算进标记），名单一变 Codex 就重拉；
    // 接口名与显示方式变了显示名就变，也算进标记。
    let tag = codexListTag({
      entries: endpoints.entries,
      endpointNames: endpoints.endpointNames,
      nameDisplay,
      defaultModelId,
      ...(disabledModels.length === 0 ? {} : { disabledModels }),
    });
    if (marksAgentsV1) tag = agentsV1Tag(tag);
    return {
      endpoints,
      nameDisplay,
      tag,
      codexHome,
      marksAgentsV1,
      agentVersionsPath: this.store.codexAgentVersionsPath,
      disabledModels,
    };
  }

  /**
   * Codex 开着、按 ChatGPT 接法接着时，它存的模型清单不是现在这份就标成过期（magpie codexStaleCache），
   * 下一个启动的 Codex 马上重拉。只动正被改写的 CODEX_HOME 里的缓存；写不成只记日志。
   */
  private staleCodexModels(state: ApiEndpointState): void {
    if (!state.agents.codex.enabled) return;
    if (!isChatGptWiring(this.store.readCodexTakeover().takeover)) return;
    const { codexHome, tag } = this.codexChatGptListing();
    try {
      const marked = markCodexModelsCacheStale({ codexHome, tag });
      // Codex 正在改写它：不硬写，等它自己的缓存过期（几分钟）或下一次 X-Models-Etag 不同时重拉。
      if (marked.kind === "conflict") {
        this.logger.warn({ codexHome }, "Codex's model list kept changing; not marked stale");
      }
    } catch (error) {
      this.logger.warn({ err: error }, "Could not mark Codex's model list stale");
    }
  }

  /** CLI 配置里会写进去的一切；前后不同才改写文件。 */
  private cliFingerprint(
    state: ApiEndpointState,
    provider: ApiEndpointProvider,
    tokens: GatewayTokens,
  ): string {
    const agent = state.agents[provider];
    if (!agent.enabled || agent.defaultModelId === null) return "official";
    return JSON.stringify([
      this.gatewayUrlFor(provider),
      tokens[provider] ?? null,
      provider === "claude" && agent.keepsClaudeAiLogin === true,
      this.cliModels(state, provider, agent.defaultModelId),
      provider === "claude" && someEndpointSearchesWeb(state),
      provider === "claude" && isAutoModeReviewed(state),
      agent.defaultThinkingOptionId ?? null,
      agent.usesUltraCode ?? null,
      this.sideModels(state, provider),
    ]);
  }

  private gatewayUnavailable(): GatewayUnavailableIssue | null {
    switch (this.gateway.kind) {
      case "bound":
        return null;
      case "socket":
        return {
          code: "gateway_requires_tcp",
          message:
            "The daemon listens on a socket, and the API endpoint gateway needs a TCP port. Set the daemon to listen on a TCP address to use API endpoints",
        };
      case "pending":
        return { code: "gateway_not_ready", message: "The daemon has not finished starting" };
    }
  }

  private requireGateway(): void {
    if (this.gateway.kind !== "bound") throw this.gatewayError();
  }

  private gatewayError(): ApiEndpointRequestError {
    const issue = this.gatewayUnavailable() ?? {
      code: "gateway_not_ready",
      message: "The daemon has not finished starting",
    };
    return new ApiEndpointRequestError({ code: issue.code, message: issue.message });
  }

  /** 读不懂时记一条错误日志，按 endpoints_unparsable 拒绝请求。 */
  private readState(): ApiEndpointState {
    try {
      return this.store.readState();
    } catch (error) {
      if (!(error instanceof ApiEndpointsFileUnparsableError)) throw error;
      this.logger.error(
        { err: error, filePath: error.filePath },
        "API endpoints file could not be parsed",
      );
      throw new ApiEndpointRequestError({ code: "endpoints_unparsable", message: error.message });
    }
  }

  /** 快照这一路不能因为文件坏了就整个失败：读不懂时按官方模式处理。 */
  private readStateForSnapshot(): ApiEndpointState | null {
    try {
      return this.readState();
    } catch (error) {
      if (error instanceof ApiEndpointRequestError) return null;
      throw error;
    }
  }

  /**
   * 从上游列出模型。只读，不进串行队列：慢的上游不该挡住切换。
   * 失败抛 ApiEndpointRequestError，code 区分鉴权/不支持/超时/取消。
   * 带 baseUrls 时各格式各拉一次再合并（fetchMergedModels）。
   */
  async fetchModels(
    provider: string,
    input: ApiEndpointFetchModelsInput,
    signal: AbortSignal,
  ): Promise<ApiEndpointModel[]> {
    const supported = requireProvider(provider);
    if (input.baseUrls !== undefined) {
      const addresses = input.baseUrls.map(({ format, url }) => ({
        format: requireFormat(format),
        url,
      }));
      const models = await this.fetchMergedModels({
        input,
        addresses,
        keeps: input.endpointId !== undefined && input.preview !== true,
        signal,
      });
      return models.map(toWireModel);
    }
    const format = input.format === undefined ? null : requireFormat(input.format);
    // 从模板加的这家：没有清单接口的用内置清单、不问上游，有前缀的只留套餐自己的（照 magpie）。
    const place = this.upstreamPlace(input);
    const baseUrl = upstreamBaseUrl({ place, format, raw: input.baseUrl });
    const apiKey = this.resolveRequestKey(input);
    let models: ListedModel[];
    if (listsNoModels(place)) {
      models = planModelsOf(place, []);
    } else {
      const result = await fetchUpstreamModels({
        provider: format === null ? supported : providerWithListingHeaders(format),
        baseUrl,
        apiKey,
        templateId: place.templateId,
        extras: this.requestExtras(input),
        signal,
        timeoutMs: this.upstreamTimeoutMs,
      });
      if (!result.ok) throw requestErrorOf(result.error);
      models = planModelsOf(place, result.models);
    }
    if (format !== null && input.endpointId && input.preview !== true) {
      await this.keepCatalog(input.endpointId, models);
    }
    return models.map(toWireModel);
  }

  /**
   * 有几种格式地址就各拉一次，按模型 id 合并（catalog-merge.ts，照 magpie fetchOne）；同一个列表地址只问一次。
   * 有一种答上就算成功：keeps 时记作这家的上游清单，这次没答上的格式上次列过的模型留着。都没答上抛最后的原因。
   */
  private async fetchMergedModels(options: {
    input: ApiEndpointUpstreamInput;
    addresses: { format: ApiEndpointRequestFormat; url: string }[];
    keeps: boolean;
    signal: AbortSignal;
  }): Promise<CatalogModel[]> {
    const { input, addresses, signal } = options;
    const place = this.upstreamPlace(input);
    const apiKey = this.resolveRequestKey(input);
    const extras = this.requestExtras(input);
    const endpointId = options.keeps ? input.endpointId : undefined;
    let models: CatalogModel[];
    if (listsNoModels(place)) {
      models = planModelsOf(place, []);
    } else {
      const asked = new Map<string, ReturnType<typeof fetchUpstreamModels>>();
      const lists: FormatList[] = [];
      const failed: ApiEndpointRequestFormat[] = [];
      let lastFailure: UpstreamFailure | null = null;
      for (const { format, url } of addresses) {
        const baseUrl = upstreamBaseUrl({ place, format, raw: url });
        const listing = providerWithListingHeaders(format);
        const key = `${listing} ${baseUrl}`;
        let pending = asked.get(key);
        if (!pending) {
          pending = fetchUpstreamModels({
            provider: listing,
            baseUrl,
            apiKey,
            templateId: place.templateId,
            extras,
            signal,
            timeoutMs: this.upstreamTimeoutMs,
          });
          asked.set(key, pending);
        }
        const result = await pending;
        if (result.ok) {
          lists.push({ format, models: result.models });
          continue;
        }
        if (result.error.code === "cancelled") throw requestErrorOf(result.error);
        failed.push(format);
        lastFailure = result.error;
      }
      if (lists.length === 0) {
        throw lastFailure
          ? requestErrorOf(lastFailure)
          : new ApiEndpointRequestError({ code: "invalid_input", message: "No base URL to ask" });
      }
      const previous = endpointId
        ? (findEndpoint(this.readState(), endpointId)?.catalog?.models ?? [])
        : [];
      models = planModelsOf(
        place,
        keepFailedFormats({ merged: mergeFormatLists(lists), previous, failed }),
      );
    }
    if (endpointId) await this.keepCatalog(endpointId, models);
    return models;
  }

  /**
   * 记下这家的上游清单，不影响路由。拉取期间被删的接口不再写回。
   * 清单带的模型资料改变了 Codex 模型目录或 Claude Code 的模型提示时，跟着重写。
   */
  private keepCatalog(endpointId: string, models: CatalogModel[]): Promise<void> {
    return this.writeCatalog(endpointId, { fetchedAt: this.now().toISOString(), models });
  }

  /**
   * 各接口对上的厂商（按各格式地址的主机名）与这些厂商、另外要的厂商的状态页读数。
   * 「价格表自动更新」关着时一页都不读（docs/usage.md「Outbound requests」）。
   */
  async vendorStatus(input: { vendors: readonly string[] }): Promise<VendorStatusResult> {
    const endpointVendors: Record<string, string> = {};
    for (const endpoint of this.readState().endpoints) {
      const vendor = vendorOfBaseUrls(endpoint.baseUrls.map((baseUrl) => baseUrl.url));
      if (vendor !== null) endpointVendors[endpoint.id] = vendor;
    }
    const vendorIds = [...new Set([...Object.values(endpointVendors), ...input.vendors])];
    if (!this.isAutoUpdate()) {
      return {
        autoUpdate: false,
        vendors: this.vendorStatusPages.unread(vendorIds),
        endpointVendors,
      };
    }
    const vendors = await this.vendorStatusPages.read({ vendors: vendorIds });
    return { autoUpdate: true, vendors, endpointVendors };
  }

  /**
   * 本机别的软件里的接口配置，对照已有的接口（从别的软件导入，ADR 0013）。只读；key 只给打码的。
   * includeOpenCode 为 false 时不碰 OpenCode 的 auth.json。
   */
  scanImports(input: { includeOpenCode: boolean }): ApiEndpointImportSource[] {
    const settled = this.settledImports(input);
    // 刚读过的比发现提示存着的新：提示照它算（不含 OpenCode），一分钟从这一刻重新算。
    const withoutOpenCode = settled.filter(({ source }) => source.id !== "opencode");
    this.discoveryRead = {
      at: this.now().getTime(),
      candidates: offeredCandidates(withoutOpenCode),
    };
    return settled.map(({ source, entries }) => ({
      id: source.id,
      name: source.name,
      path: this.homeRelative(source.path),
      found: source.found,
      error: source.error,
      items: entries.map(wireImportItem),
    }));
  }

  /**
   * 导入选中的发现（magpie ImportFromApps）：重读一遍来源、按指纹找回 key，一条一条地加；一条不成就停下，前面加好的留着，
   * 回出错的那条与原因。已添加的、读不了的跳过；新增一家时名称重了照 freeEndpointName 加「 2」；替换保留那家的 id、标识与顺序位置。
   * 加好的照保存那样当场拉一次清单。
   */
  async importFromApps(picks: readonly ApiEndpointImportPick[]): Promise<ImportOutcome> {
    const outcome = await this.exclusiveFollowing(() => this.importPicked(picks));
    // 导入之后的发现提示重新读一遍（magpie 导入后 discoverLocalProviders(true)）。
    this.discoveryRead = null;
    await Promise.all(
      outcome.imported.map(({ endpointId }) =>
        this.refreshCatalog({ endpointId, signal: AbortSignal.timeout(SAVE_LIST_TIMEOUT_MS) }),
      ),
    );
    return outcome;
  }

  private async importPicked(picks: readonly ApiEndpointImportPick[]): Promise<ImportOutcome> {
    const entries = this.settledImports({ includeOpenCode: true }).flatMap(
      (source) => source.entries,
    );
    const imported: ImportedEndpointRef[] = [];
    for (const pick of picks) {
      const entry = entries.find((candidate) => candidate.fingerprint === pick.fingerprint);
      // 指纹对不上（来源变了、daemon 重启过）：扫描结果过时了，没有可说的那一条。
      if (entry === undefined) return { imported, failed: null, error: importGone() };
      try {
        const added = await this.importOne({ pick, entry });
        if (added !== null) imported.push(added);
      } catch (error) {
        // 任何错都停在这一条，回前面加好的（magpie 不论什么错都回 added）。
        const failed = { fingerprint: pick.fingerprint, name: entry.name };
        return { imported, failed, error: this.importItemError({ error, entry }) };
      }
    }
    return { imported, failed: null, error: null };
  }

  /** 一条没成的原因：请求的错照原样；写文件等别的错记日志，换成 import_failed（params.reason 是 errno 或错误名）。 */
  private importItemError(input: { error: unknown; entry: SettledEntry }): ApiEndpointRequestError {
    const { error } = input;
    if (error instanceof ApiEndpointRequestError) return error;
    this.logger.error({ err: error, source: input.entry.source }, "Importing an endpoint failed");
    let reason = "unknown";
    if (isErrnoException(error) && error.code !== undefined) reason = error.code;
    else if (error instanceof Error) reason = error.name;
    return new ApiEndpointRequestError({
      code: "import_failed",
      message: `Osuna couldn't save ${input.entry.name} (${reason})`,
      params: { reason },
    });
  }

  /** 加一条或换上一条，单独落下（magpie 每条 Save 一次）；已经有了的为 null。 */
  private async importOne(input: {
    pick: ApiEndpointImportPick;
    entry: SettledEntry;
  }): Promise<ImportedEndpointRef | null> {
    const { pick, entry } = input;
    const found = entry.found;
    if (found === null || entry.status === "added") return null;
    const action = importActionOf({ pick, found });
    const previous = this.readState();
    if (action.kind === "replace") {
      const index = replaceTargetIndex({ entry, endpoints: previous.endpoints });
      return this.landImported({
        previous,
        found,
        name: found.name,
        replaceIndex: index,
        icon: null,
      });
    }
    // 两个软件里是同一个账号、两条都选了：只加一次（magpie holds）。
    const holds = previous.endpoints.some((held) =>
      sameAccount({ have: { ...held, key: this.store.getApiKey(held.id) }, found }),
    );
    if (holds) return null;
    const name = freeEndpointName(previous, action.name);
    return this.landImported({ previous, found, name, replaceIndex: null, icon: null });
  }

  /**
   * 导入的一家落下（从别的软件导入与导入链接共用）：replaceIndex 是被换掉的那家（保留它的 id、标识与顺序位置），
   * 为 null 时用 name 新增一家、加在最后。没有 key 的换上后去掉原来那家的 key。
   */
  private async landImported(input: {
    previous: ApiEndpointState;
    found: FoundEndpoint;
    name: string;
    replaceIndex: number | null;
    icon: string | null;
  }): Promise<ImportedEndpointRef> {
    const { previous, found, name, replaceIndex, icon } = input;
    const timestamp = this.now().toISOString();
    let endpoints: StoredApiEndpoint[];
    let endpoint: StoredApiEndpoint;
    if (replaceIndex !== null) {
      const target = previous.endpoints[replaceIndex];
      if (target === undefined) throw importGone();
      endpoint = importedEndpoint({ found, name, kept: target, timestamp, icon });
      endpoints = previous.endpoints.with(replaceIndex, endpoint);
    } else {
      const slug = generateEndpointSlug(name, new Set(previous.endpoints.map((held) => held.slug)));
      const kept = { id: `ep_${randomUUID()}`, slug, createdAt: timestamp };
      endpoint = importedEndpoint({ found, name, kept, timestamp, icon });
      endpoints = [...previous.endpoints, endpoint];
    }
    const keys = found.key === null ? {} : { [endpoint.id]: found.key };
    await this.commit(previous, { ...previous, endpoints }, { keys });
    // 换成不要 key 的那家：原来那把 key 不再是它的。
    if (found.key === null && this.store.getApiKey(endpoint.id) !== null) {
      this.store.removeApiKey(endpoint.id);
    }
    if (replaceIndex !== null) this.cooldowns.clear(endpoint.id);
    return { endpointId: endpoint.id, name: endpoint.name };
  }

  /**
   * 读一条导入链接给确认框（ADR 0013，magpie importlink.go）：照 magpie 解析、拒收，说会替换哪家；不存任何东西。
   * 链接给了图标图片的，确认框一打开就去取（magpie：确认框开着就是同意），图片先留在内存里，添加成功时才存下。
   */
  async previewImportLink(link: string): Promise<ApiEndpointImportLinkPreview> {
    const parsed = parsedImportLinkOrRefuse(link);
    const target = importLinkTarget({ endpoints: this.readState().endpoints, parsed });
    const hostNames = parsed.baseUrls.map(({ url }) => new URL(url).host);
    const hosts = [...new Set(hostNames)];
    let replaces: ApiEndpointImportLinkPreview["replaces"] = null;
    if (target !== null) replaces = { endpointId: target.id, name: target.name };
    const picture = await this.importLinkPicture(parsed);
    let iconImage: ApiEndpointImportLinkPreview["iconImage"] = null;
    if (picture !== null) {
      const data = picture.bytes.toString("base64");
      iconImage = { data, mimeType: picture.mimeType };
    }
    return {
      name: parsed.name,
      key: parsed.key,
      baseUrls: parsed.baseUrls,
      hosts,
      models: parsed.models,
      templateId: parsed.templateId,
      region: parsed.region,
      keysUrl: parsed.keysUrl,
      replaces,
      ignoredGemini: parsed.ignoredGemini,
      icon: parsed.icon,
      iconImage,
    };
  }

  /**
   * 确认框里点了添加：重新解析、拒收一遍链接（客户端说的不算），用确认框里的名称（同样截到 80 字节）与 key 加上那家，
   * 或换上 magpie Find(id) 找到的那家（Save 整个换上）。icon= 的图片有就用它（模板接口也一样），否则用 catalog= 的图标；
   * 图片在这一刻才存下，没加成就删掉。加好的照保存那样当场拉一次清单。
   */
  async addFromImportLink(input: {
    link: string;
    name: string;
    key: string;
  }): Promise<ImportedEndpointRef> {
    const parsed = parsedImportLinkOrRefuse(input.link);
    const name = cutImportLinkName(validateName(input.name));
    const key = input.key.trim();
    if (!isKeyLike(key)) {
      throw new ApiEndpointRequestError({
        code: "import_link_refused",
        message: "That is not a key",
        params: { reason: "bad_key" },
      });
    }
    const picture = await this.importLinkPicture(parsed);
    const found: FoundEndpoint = {
      name,
      key: key === "" ? null : key,
      baseUrls: parsed.baseUrls,
      models: parsed.models,
      headers: null,
      templateId: parsed.templateId,
      region: parsed.region,
    };
    const added = await this.exclusiveFollowing(async () => {
      const previous = this.readState();
      const target = importLinkTarget({ endpoints: previous.endpoints, parsed });
      let stored: StoredIcon | null = null;
      if (picture !== null) stored = this.icons.storeTracked(picture.bytes);
      const icon = stored?.icon ?? parsed.icon;
      let landed = false;
      try {
        let replaceIndex: number | null = null;
        let freeName = freeEndpointName(previous, name);
        if (target !== null) {
          // 改了名的不和别的几家重名；和被换掉的那家同名不算。
          const othersHeld = previous.endpoints.filter((held) => held !== target);
          freeName = freeEndpointName({ ...previous, endpoints: othersHeld }, name);
          replaceIndex = previous.endpoints.indexOf(target);
        }
        const ref = await this.landImported({
          previous,
          found,
          name: freeName,
          replaceIndex,
          icon,
        });
        landed = true;
        return ref;
      } finally {
        // 没加成：这次才存下的图片没人用，删掉。
        if (!landed && stored?.isNew === true) this.icons.discard(stored.icon);
      }
    });
    if (parsed.iconUrl !== null) this.importLinkPictures.delete(parsed.iconUrl);
    const signal = AbortSignal.timeout(SAVE_LIST_TIMEOUT_MS);
    await this.refreshCatalog({ endpointId: added.endpointId, signal });
    return added;
  }

  /**
   * 导入链接的 icon= 图片：确认框打开时取过的从内存里拿，没有就现取。取不到、不是认得的图片为 null（用默认图标），
   * 原因写一行日志（只有主机名与原因，不写 key 与查询串）。
   */
  private async importLinkPicture(parsed: ParsedImportLink): Promise<ImportLinkPicture | null> {
    const url = parsed.iconUrl;
    if (url === null) return null;
    const kept = this.importLinkPictures.get(url);
    if (kept !== undefined) return kept;
    const signal = AbortSignal.timeout(IMPORT_LINK_ICON_TIMEOUT_MS);
    const fetched = await fetchIconPicture({ url, fetchSite: this.fetchSite, signal });
    const host = new URL(url).host;
    if (!fetched.ok) {
      this.logger.warn({ host, reason: fetched.reason }, "Import link icon couldn't be fetched");
      return null;
    }
    const mimeType = iconMimeType(fetched.bytes);
    if (mimeType === null) {
      this.logger.warn({ host, reason: "not_image" }, "Import link icon couldn't be fetched");
      return null;
    }
    const picture = { bytes: fetched.bytes, mimeType };
    this.importLinkPictures.set(url, picture);
    // 只留最近几张：确认框关了没加的不一直占着内存。
    for (const old of [...this.importLinkPictures.keys()].slice(0, -MAX_KEPT_LINK_PICTURES)) {
      this.importLinkPictures.delete(old);
    }
    return picture;
  }

  /**
   * 发现提示（magpie importapps/discovery）：导入窗口打开时会默认选上、又没被忽略的那几条。不含 OpenCode；
   * 一分钟内只真读、对照一次（magpie 的发现也是整个一分钟一次），接口变了或导入之后重来。已忽略的每次现滤。
   */
  discoverImports(): ApiEndpointImportCandidate[] {
    const ignored = new Set(this.readState().ignoredImports ?? []);
    return this.discoveryCandidates().filter((candidate) => !ignored.has(candidate.fingerprint));
  }

  /**
   * 「忽略」：这几条的指纹并进主机的已忽略记录（magpie 记在 localStorage，这里记在主机上、跨客户端）。
   * 不是指纹的拒收；最多留 MAX_IGNORED_IMPORTS 条，丢最早的。暂时不在的不删（magpie 也不忘：来源一时读不到时照样认得）。
   */
  ignoreImports(input: { fingerprints: readonly string[] }): Promise<void> {
    const malformed = input.fingerprints.find(
      (fingerprint) => !IMPORT_FINGERPRINT.test(fingerprint),
    );
    if (malformed !== undefined) {
      return Promise.reject(
        new ApiEndpointRequestError({
          code: "invalid_input",
          message: `'${malformed}' isn't an import fingerprint`,
        }),
      );
    }
    return this.exclusiveFollowing(async () => {
      const state = this.readState();
      const merged = [...new Set([...(state.ignoredImports ?? []), ...input.fingerprints])];
      const ignoredImports = merged.slice(-MAX_IGNORED_IMPORTS);
      await this.commit(state, { ...state, ignoredImports });
    }).catch((error: unknown) => {
      throw this.ignoreError(error);
    });
  }

  /** 忽略没记上的原因：请求的错照原样；别的记日志，换成 import_ignore_failed（params.reason 同 import_failed）。 */
  private ignoreError(error: unknown): ApiEndpointRequestError {
    if (error instanceof ApiEndpointRequestError) return error;
    this.logger.error({ err: error }, "Ignoring import candidates failed");
    let reason = "unknown";
    if (isErrnoException(error) && error.code !== undefined) reason = error.code;
    else if (error instanceof ApiEndpointsFileUnparsableError) reason = "endpoints_unparsable";
    else if (error instanceof Error) reason = error.name;
    return new ApiEndpointRequestError({
      code: "import_ignore_failed",
      message: `Osuna couldn't save the ignored entries (${reason})`,
      params: { reason },
    });
  }

  /** 接口或 key 变了：发现提示存着的对照结果作废。 */
  private forgetDiscoveryIfHeldChanges(input: {
    previous: ApiEndpointState;
    proposed: ApiEndpointState;
    keys: Record<string, string> | undefined;
  }): void {
    const changesHeld =
      input.previous.endpoints !== input.proposed.endpoints || input.keys !== undefined;
    if (changesHeld) this.discoveryRead = null;
  }

  private discoveryCandidates(): ApiEndpointImportCandidate[] {
    const at = this.now().getTime();
    const cached = this.discoveryRead;
    if (cached !== null && at - cached.at < DISCOVERY_READ_INTERVAL_MS) return cached.candidates;
    this.discoveryRead = null;
    const settled = settleImports({
      sources: readImportSources({ context: this.importContext(), includeOpenCode: false }),
      held: this.heldForImport(this.readState()),
      fingerprintSecret: this.importFingerprintSecret(),
    });
    const candidates = offeredCandidates(settled);
    this.discoveryRead = { at, candidates };
    return candidates;
  }

  private importFingerprintSecret(): Buffer {
    this.importSecret ??= this.store.readImportFingerprintSecret();
    return this.importSecret;
  }

  private heldForImport(state: ApiEndpointState): HeldEndpoint[] {
    return state.endpoints.map((endpoint) => ({
      id: endpoint.id,
      name: endpoint.name,
      slug: endpoint.slug,
      baseUrls: endpoint.baseUrls,
      headers: endpoint.headers,
      key: this.store.getApiKey(endpoint.id),
    }));
  }

  private settledImports(input: { includeOpenCode: boolean }) {
    const sources = readImportSources({
      context: this.importContext(),
      includeOpenCode: input.includeOpenCode,
    });
    return settleImports({
      sources,
      held: this.heldForImport(this.readState()),
      fingerprintSecret: this.importFingerprintSecret(),
    });
  }

  private importContext(): ImportReadContext {
    const defaults = defaultImportSourcePaths({
      homeDir: this.homeDir,
      env: this.env,
      claudeSettings: this.resolveClaudeSettingsPath(),
      codexConfig: this.resolveCodexConfigPath(),
    });
    return {
      paths: { ...defaults, ...this.importSourcePaths },
      homeDir: this.homeDir,
      isGatewayUrl: (url) => this.isGatewayUrl(url),
      claudeOriginalEnv: () => this.claudeOriginalEnv(),
      osunaCodexCatalog: this.store.codexModelCatalogPath,
    };
  }

  /** 本机上指向中转站的地址：路径是中转站的，或端口是它监听的（magpie gatewayURL）。 */
  private isGatewayUrl(url: URL): boolean {
    if (!LOOPBACK_HOSTS.has(url.hostname)) return false;
    if (url.pathname.startsWith(API_ENDPOINT_GATEWAY_PATH)) return true;
    const gateway = this.gatewayUrlFor("claude") ?? this.gatewayUrlFor("codex");
    if (gateway === null || !URL.canParse(gateway)) return false;
    return new URL(gateway).port === url.port;
  }

  /** Osuna 接管 Claude Code 时 ADR 0004 记下的 env 原值；没接管为 null。 */
  private claudeOriginalEnv(): Record<string, string> | null {
    const takeover = this.store.readClaudeTakeover().takeover;
    if (takeover === null) return null;
    const env: Record<string, string> = {};
    for (const [name, record] of Object.entries(takeover.env)) {
      const original = record.original;
      if (original.present && typeof original.value === "string") env[name] = original.value;
    }
    return env;
  }

  /** 家目录下的路径写成 ~ 开头（magpie 的导入窗口这样显示）。 */
  private homeRelative(filePath: string): string {
    const relative = path.relative(this.homeDir, filePath);
    const isInside = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    return isInside ? path.join("~", relative) : filePath;
  }

  /** 丢掉拉回的清单：清空上游清单与拉取时间，已选与手动添加的不动（照 magpie unfetch）。 */
  async forgetCatalog(endpointId: string): Promise<void> {
    if (!findEndpoint(this.readState(), endpointId)) {
      throw new ApiEndpointRequestError({ code: "not_found", message: "API endpoint not found" });
    }
    await this.writeCatalog(endpointId, undefined);
  }

  /**
   * 换上新清单（或丢掉）。在服务的模型跟着定（model-scope.ts）：跟随清单时重算，挑选时按规则勾上清单里新出的；
   * 它们变了就和保存一样走 commit，默认模型与 CLI 配置跟着对账。
   */
  private writeCatalog(endpointId: string, catalog: StoredApiEndpoint["catalog"]): Promise<void> {
    return this.exclusiveFollowing(async () => {
      const state = this.readState();
      const endpoint = findEndpoint(state, endpointId);
      if (!endpoint) return;
      const { catalog: _previous, ...rest } = endpoint;
      const listedBefore = new Set((endpoint.catalog?.models ?? []).map((model) => model.id));
      const updated = settleServedModels(
        catalog ? { ...rest, catalog } : rest,
        (modelId) => !listedBefore.has(modelId),
      );
      const next = { ...state, endpoints: withEndpoint(state.endpoints, updated) };
      const servesOthers =
        !isDeepStrictEqual(updated.models, endpoint.models) ||
        !isDeepStrictEqual(updated.modelMapping, endpoint.modelMapping);
      if (servesOthers) {
        await this.commit(state, next);
        return;
      }
      this.store.writeState(next);
      this.rewriteCodexCatalog(next);
      const tokens = this.store.readGatewayTokens();
      if (
        this.cliFingerprint(state, "claude", tokens) !== this.cliFingerprint(next, "claude", tokens)
      ) {
        this.rewriteClaudeHints(next);
      }
    });
  }

  /**
   * 用选中的模型向上游发一条最小对话请求。和拉取模型一样只读、不进串行队列。
   * 上游的结论（含失败）放在返回值里；请求本身不成立或被取消才抛 ApiEndpointRequestError。
   */
  async testConnection(
    provider: string,
    input: ApiEndpointTestConnectionInput,
    signal: AbortSignal,
  ): Promise<ApiEndpointTestConnectionResult> {
    const supported = requireProvider(provider);
    if (input.format !== undefined) {
      return this.testFormat(requireFormat(input.format), input, signal);
    }
    const modelId = input.modelId?.trim();
    if (!modelId) {
      throw new ApiEndpointRequestError({ code: "invalid_input", message: "A model is required" });
    }
    const disabled = this.testDisabledResult(input.endpointId, modelId);
    if (disabled !== null) return disabled;
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const apiKey = this.resolveRequestKey(input);
    const { templateId } = this.upstreamPlace(input);
    const outcome = await testUpstreamConnection({
      provider: supported,
      // Codex 和写进 config.toml 的 base_url 一样补 /v1。
      baseUrl:
        supported === "codex" ? (normalizeOpenAICompatibleBaseUrl(baseUrl) ?? baseUrl) : baseUrl,
      apiKey,
      templateId,
      modelId,
      sentModel: this.sentNameOf(input.endpointId)(modelId),
      extras: this.requestExtras(input),
      signal,
      timeoutMs: this.connectionTestTimeoutMs,
    });
    if (outcome.kind === "cancelled") {
      throw new ApiEndpointRequestError({ code: "cancelled", message: "Request cancelled" });
    }
    return outcome.result;
  }

  /** 按一种请求格式向一个地址发最小请求；上游回 401 / 403 时结论的 code 是 auth_failed。 */
  private async testFormat(
    format: ApiEndpointRequestFormat,
    input: ApiEndpointTestConnectionInput,
    signal: AbortSignal,
  ): Promise<ApiEndpointTestConnectionResult> {
    const place = this.upstreamPlace(input);
    const { templateId } = place;
    const baseUrl = upstreamBaseUrl({ place, format, raw: input.baseUrl });
    const apiKey = this.resolveRequestKey(input);
    const extras = this.requestExtras(input);
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);
    const isAskable = this.isTestAskable(input.endpointId);
    const servedHere = (ids: string[]) =>
      ids.filter(
        (model) =>
          isAskable(model) && (modelFormatsAt({ templateId, model })?.includes(format) ?? true),
      );
    const typedModelId = input.modelId?.trim();
    if (typedModelId) {
      const disabled = this.testDisabledResult(input.endpointId, typedModelId);
      if (disabled !== null) return disabled;
    }
    let modelId =
      typedModelId ||
      (input.modelIds === undefined
        ? this.probeModelFromEndpoint(input.endpointId, format)
        : pickProbeModel(servedHere(input.modelIds), format));
    if (!modelId && listsNoModels(place)) {
      // 没有清单接口的模板（Bedrock）：从内置清单挑，不问上游。
      modelId = pickProbeModel(
        servedHere(planModelsOf(place, []).map((model) => model.id)),
        format,
      );
    }
    if (!modelId) {
      // 这家还没选模型也没拉过清单：先列一次（不花钱）再挑。
      const listed = await fetchUpstreamModels({
        provider: providerWithListingHeaders(format),
        baseUrl,
        apiKey,
        templateId,
        extras,
        signal,
        timeoutMs: this.upstreamTimeoutMs,
      });
      if (!listed.ok) {
        if (listed.error.code === "cancelled") {
          throw new ApiEndpointRequestError({ code: "cancelled", message: "Request cancelled" });
        }
        const status = listed.error.status ?? null;
        const code = status === 401 || status === 403 ? "auth_failed" : listed.error.code;
        const error: ApiEndpointError = { code, message: listed.error.message };
        if (listed.error.params !== undefined) error.params = listed.error.params;
        return { ok: false, status, durationMs: elapsed(), error };
      }
      modelId = pickProbeModel(
        servedHere(planModelsOf(place, listed.models).map((model) => model.id)),
        format,
      );
    }
    const detection = await probeUpstreamFormat({
      format,
      baseUrl,
      apiKey,
      templateId,
      modelId: modelId ?? null,
      sentModel: modelId ? this.sentNameOf(input.endpointId)(modelId) : null,
      extras,
      signal,
      timeoutMs: this.connectionTestTimeoutMs,
    });
    if (signal.aborted)
      throw new ApiEndpointRequestError({ code: "cancelled", message: "Request cancelled" });
    return testResultOf(detection, elapsed());
  }

  /**
   * 拉模型、测试用的模板与区域：表单给了就按表单（保存前的添加 / 编辑窗口），否则按 endpointId 那家记下的；
   * 都没有即「自定义」。不认识的模板拒收。
   */
  private upstreamPlace(input: ApiEndpointUpstreamInput): TemplatePlace {
    if (input.templateId !== undefined) {
      if (!findTemplate(input.templateId)) {
        throw new ApiEndpointRequestError({
          code: "invalid_input",
          message: `Unknown template: ${input.templateId}`,
        });
      }
      return {
        templateId: input.templateId,
        ...(input.region === undefined ? {} : { region: input.region }),
      };
    }
    if (!input.endpointId) return {};
    const endpoint = findEndpoint(this.readState(), input.endpointId);
    if (!endpoint) return {};
    return {
      ...(endpoint.templateId === undefined ? {} : { templateId: endpoint.templateId }),
      ...(endpoint.region === undefined ? {} : { region: endpoint.region }),
    };
  }

  /**
   * 从这家已选的模型、再从上游清单里挑一个适合该格式的；都没有时为 null。
   * Bedrock 只从在这种格式上给的模型里挑（modelFormatsAt）。
   */
  private probeModelFromEndpoint(
    endpointId: string | undefined,
    format: ApiEndpointRequestFormat,
  ): string | null {
    if (!endpointId) return null;
    const endpoint = findEndpoint(this.readState(), endpointId);
    if (!endpoint) return null;
    const { templateId } = endpoint;
    const isAskable = this.isTestAskable(endpointId);
    const servedHere = (ids: string[]) =>
      ids.filter(
        (model) =>
          isAskable(model) && (modelFormatsAt({ templateId, model })?.includes(format) ?? true),
      );
    return (
      pickProbeModel(servedHere(endpoint.models.map((model) => model.id)), format) ??
      pickProbeModel(servedHere((endpoint.catalog?.models ?? []).map((model) => model.id)), format)
    );
  }

  /**
   * 自动检测：从一个地址推出三种格式各自的地址，各发一条最小请求。和拉取模型一样只读、不进串行队列。
   * 每种格式的结论（含失败）放在返回值里；请求本身不成立或被取消才抛 ApiEndpointRequestError。
   */
  async detectFormats(
    input: ApiEndpointDetectInput,
    signal: AbortSignal,
  ): Promise<ApiEndpointDetectOutcome> {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const apiKey = this.resolveRequestKey(input);
    if (input.eachModel === true) {
      return this.detectEachModel({ input, baseUrl, apiKey, signal });
    }
    const outcome = await detectUpstreamFormats({
      baseUrl,
      apiKey,
      modelId: input.modelId?.trim() || null,
      // 检测照样问被禁的模型（magpie Detect 不看禁用，只有测试和中转站看）。
      pickedModelIds: input.modelIds ?? [],
      sentNameOf: this.sentNameOf(input.endpointId),
      extras: this.requestExtras(input),
      signal,
      modelsTimeoutMs: this.upstreamTimeoutMs,
      probeTimeoutMs: this.connectionTestTimeoutMs,
    });
    if (outcome.kind === "cancelled") {
      throw new ApiEndpointRequestError({ code: "cancelled", message: "Request cancelled" });
    }
    return { results: outcome.results, models: null };
  }

  /** 逐个模型识别（照 magpie DetectModels）：和单次检测一样，被禁的模型也问。 */
  private async detectEachModel(args: {
    input: ApiEndpointDetectInput;
    baseUrl: string;
    apiKey: string | null;
    signal: AbortSignal;
  }): Promise<ApiEndpointDetectOutcome> {
    const { input } = args;
    const sentNameOf = this.sentNameOf(input.endpointId);
    const outcome = await detectEachModel({
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      modelIds: input.modelIds ?? [],
      sentNameOf,
      extras: this.requestExtras(input),
      limits: this.detectEachLimits,
      timers: this.modelTestTimers,
      signal: args.signal,
    });
    if (outcome.kind === "cancelled") {
      throw new ApiEndpointRequestError({ code: "cancelled", message: "Request cancelled" });
    }
    if (outcome.kind === "noModels") {
      throw new ApiEndpointRequestError({
        code: "invalid_input",
        message: "No model to try: pick the models first",
      });
    }
    return { results: outcome.results, models: outcome.models };
  }

  /**
   * 测试模型（照 magpie TestModels）：给 modelId 只测那一个，否则测这家所有在服务的模型（一周内下线的不算），
   * 被禁的不发请求、记成已禁用。每测完一个调 onResult。和拉取模型一样只读、不进串行队列。
   */
  async testModels(input: {
    request: ApiEndpointTestModelsInput;
    signal: AbortSignal;
    // 开测前：要测的模型，按测试顺序。
    onStarted: (modelIds: string[]) => void;
    onResult: (progress: ModelTestProgress) => void;
  }): Promise<ModelTestsOutcome> {
    const { request } = input;
    const method = request.method ?? "plain";
    if (!API_ENDPOINT_MODEL_TEST_METHODS.some((known) => known === method)) {
      throw new ApiEndpointRequestError({
        code: "invalid_input",
        message: `Unknown test method '${method}'`,
      });
    }
    const state = this.readState();
    const endpoint = findEndpoint(state, request.endpointId);
    if (!endpoint) {
      throw new ApiEndpointRequestError({ code: "not_found", message: "API endpoint not found" });
    }
    const listed = findEndpoint(this.retiredModels.listed(state), endpoint.id) ?? endpoint;
    const typed = request.modelId?.trim();
    const modelIds = typed ? [typed] : listed.models.map((model) => model.id);
    const identity = await this.testIdentity({ endpoint, method });
    // 按 CLI 的样子测只问那个 CLI 的请求去的格式，不管「只用这种格式」（magpie clientProto）。
    let cliAddress: ModelTestAttempt | null = null;
    if (isCliTestClient(method)) cliAddress = cliTestAddress({ endpoint, client: method });
    const plans = modelIds.map((modelId): ModelTestPlan => {
      const sentModel = upstreamModelName({ settings: endpoint.modelSettings, modelId });
      const disabledBy = endpointDisabledBy({ state, endpoint, model: modelId });
      let attempts = testAttempts({ endpoint, modelId });
      if (cliAddress !== null) attempts = [cliAddress];
      return { modelId, sentModel, disabledBy, attempts };
    });
    input.onStarted(modelIds);
    const apiKey = this.store.getApiKey(endpoint.id);
    const clock = { now: this.now, timers: this.modelTestTimers };
    return runModelTests({
      plans,
      apiKey,
      templateId: endpoint.templateId,
      extras: storedRequestExtras(endpoint),
      identity,
      limits: this.modelTestLimits,
      clock,
      signal: input.signal,
      onResult: input.onResult,
    });
  }

  /**
   * 以谁的样子测（ADR 0013）：plain 是 Osuna 自己；按 CLI 测时这家不提供就拒收，Claude Code 没有样本时每个模型记成
   * cli_sample_missing，Codex 没有样本时用 ChatGPT 账号那套 Codex 请求头（magpie clientHeaders）。
   */
  private async testIdentity(input: {
    endpoint: StoredApiEndpoint;
    method: string;
  }): Promise<ModelTestIdentity> {
    const { endpoint, method } = input;
    if (!isCliTestClient(method)) return { kind: "own" };
    const refusal = cliTestRefusal({ endpoint, client: method });
    if (refusal !== null) {
      throw new ApiEndpointRequestError({ code: "invalid_input", message: refusal });
    }
    const sample = this.store.readCliHeaderSample(method);
    if (sample !== null) return { kind: "cli", client: method, headers: sample };
    if (needsCliSample(method)) return { kind: "sampleMissing", error: CLI_SAMPLE_MISSING };
    const cached = readCodexModelsCache(path.dirname(this.resolveCodexConfigPath()));
    const version = newestCodexVersion([
      cachedCodexVersion(cached),
      await this.installedCodexVersion(),
      this.codexSeenVersion.version(),
    ]);
    const headers = codexSignHeaders({ version, system: await readCodexSystem() });
    return { kind: "cli", client: method, headers };
  }

  /** 本机 Codex CLI 的版本，十分钟内问过就用上次的；问不到为 null。 */
  private async installedCodexVersion(): Promise<string | null> {
    const read = this.readCodexCliVersion;
    if (read === null) return null;
    const now = this.now().getTime();
    const cache = this.codexCliVersionCache;
    if (cache !== null && now - cache.at < CODEX_CLI_VERSION_TTL_MS) return cache.version;
    const version = await read();
    this.codexCliVersionCache = { at: now, version };
    return version;
  }

  /**
   * 测试连接不挑被禁的模型（magpie test.go 的 testOne、testModel；检测不看禁用）：已保存的那家按它的接口标识认，
   * 还没保存的只按名字认。
   */
  private isTestAskable(endpointId: string | undefined): (modelId: string) => boolean {
    const state = this.readState();
    const endpoint = endpointId ? findEndpoint(state, endpointId) : null;
    const disabledBy = (modelId: string): string | null => {
      // 已保存的那家按它的接口标识认，还没保存的只按名字认。
      if (endpoint) return endpointDisabledBy({ state, endpoint, model: modelId });
      return askedDisabledBy({ state, model: modelId });
    };
    return (modelId) => disabledBy(modelId) === null;
  }

  /** 点名测一个被禁的模型：不发请求，结论写明命中的条目（magpie testOne）；没被禁为 null。 */
  private testDisabledResult(
    endpointId: string | undefined,
    modelId: string,
  ): ApiEndpointTestConnectionResult | null {
    const state = this.readState();
    const endpoint = endpointId ? findEndpoint(state, endpointId) : null;
    const pattern = endpoint
      ? endpointDisabledBy({ state, endpoint, model: modelId })
      : askedDisabledBy({ state, model: modelId });
    if (pattern === null) return null;
    return {
      ok: false,
      status: null,
      durationMs: 0,
      error: {
        code: "model_disabled",
        params: { model: modelId, pattern },
        message: disabledMessage({ model: modelId, pattern }),
      },
    };
  }

  /** 测试与自动检测发给上游的模型名：已保存那家的上游模型名（magpie test.go、detect.go 的 UpstreamName）；新加的按模型 id。 */
  private sentNameOf(endpointId: string | undefined): (modelId: string) => string {
    const endpoint = endpointId ? findEndpoint(this.readState(), endpointId) : null;
    const settings = endpoint?.modelSettings;
    return (modelId) => upstreamModelName({ settings, modelId });
  }

  /**
   * 请求里带了 key 就用它；否则用 endpointId 对应的已保存 key。都没有为 null：不带认证头。
   * key 从不回给客户端。
   */
  private resolveRequestKey(input: { endpointId?: string; apiKey?: string }): string | null {
    const typed = input.apiKey?.trim();
    if (typed) return typed;
    if (!input.endpointId) return null;
    if (!findEndpoint(this.readState(), input.endpointId)) {
      throw new ApiEndpointRequestError({ code: "not_found", message: "API endpoint not found" });
    }
    return this.store.getApiKey(input.endpointId);
  }

  /**
   * 拉模型、测试、检测带的请求头、附加请求体、key 放哪个头与不校验证书：表单给了的用表单的（保存前），没给的用 endpointId
   * 那家存的。不校验证书的主机取表单盖过那家之后的地址（formAddressesOver，照 magpie typed），模板按表单的、没给按那家的。
   */
  private requestExtras(
    input: {
      endpointId?: string;
      baseUrl: string;
      format?: string;
      baseUrls?: { format: string; url: string }[];
      templateId?: string;
    } & ApiEndpointRequestExtrasInput,
  ): RequestExtras {
    let endpoint: StoredApiEndpoint | null = null;
    if (input.endpointId) endpoint = findEndpoint(this.readState(), input.endpointId);
    const saved = storedRequestExtras(endpoint);
    let { headers } = saved;
    if (input.headers !== undefined) headers = cleanRequestHeaders(input.headers) ?? {};
    const extraBody = input.extraBody ?? saved.extraBody;
    const keyHeader = input.keyHeader ?? saved.keyHeader;
    const uncheckedHosts = uncheckedHostsOf({
      insecureTls: input.insecureTls ?? endpoint?.insecureTls,
      templateId: input.templateId ?? endpoint?.templateId,
      urls: formAddressesOver({ saved: endpoint?.baseUrls ?? [], form: input }),
    });
    return { headers, extraBody, keyHeader, uncheckedHosts };
  }

  resolveClaudeSettingsPath(): string {
    return resolveAgentHookConfigPath(claudeAgentHookProvider, {
      env: this.env,
      homeDir: this.homeDir,
    });
  }

  /** 与终端 hooks 安装器同一套规则：CODEX_HOME 优先，缺省 ~/.codex。 */
  resolveCodexConfigPath(): string {
    const hooksPath = resolveAgentHookConfigPath(codexAgentHookProvider, {
      env: this.env,
      homeDir: this.homeDir,
    });
    return path.join(path.dirname(hooksPath), "config.toml");
  }

  /**
   * config.toml 自己还写着 Osuna 的模型目录（「保留当前设置」后、或用户手抄的）：关着开关也不删目录文件，
   * 否则 Codex 读不到它。读不出按没写。
   */
  private codexConfigNamesCatalog(): boolean {
    try {
      const text = readOptionalFile(this.resolveCodexConfigPath())?.toString("utf8") ?? null;
      return readCodexCatalogPath(text) === this.store.codexModelCatalogPath;
    } catch (error) {
      this.logger.warn({ err: error }, "Could not read the Codex model list path");
      return false;
    }
  }

  /** 目录的默认档跟着默认思考档位，没设时跟着用户 config.toml 的 model_reasoning_effort；读不出按没设。 */
  private codexModelCatalog(state: ApiEndpointState): string {
    return buildCodexModelCatalog({
      state: this.served(state),
      reasoningEffort: this.codexStartEffort(state),
      factsFor: (endpoint, modelId) => this.modelFacts(endpoint, modelId),
      marksAgentsV1: state.agents.codex.allowsAnySubagentModel === true,
    });
  }

  /** Codex 新会话从哪一档起：默认思考档位（开关开着时），没设就是 config.toml 里用户自己的。 */
  private codexStartEffort(state: ApiEndpointState): string | null {
    const agent = state.agents.codex;
    const chosen = agent.enabled ? (agent.defaultThinkingOptionId ?? null) : null;
    return chosen ?? this.codexReasoningEffort();
  }

  /** config.toml 顶层的 model_reasoning_effort；读不出按没设。 */
  private codexReasoningEffort(): string | null {
    try {
      return readCodexReasoningEffort(
        readOptionalFile(this.resolveCodexConfigPath())?.toString("utf8") ?? null,
      );
    } catch (error) {
      this.logger.warn({ err: error }, "Could not read Codex reasoning effort");
      return null;
    }
  }

  private restoreOfficial(provider: ApiEndpointProvider, defaultModelId: string | null): void {
    if (provider === "codex") {
      this.restoreCodexOfficial(defaultModelId);
    } else {
      this.restoreClaudeOfficial(defaultModelId);
    }
  }

  private writeClaudeEndpoint(input: CliEndpointWrite): void {
    const { wiring, shouldRewriteModel } = input;
    const settingsPath = this.resolveClaudeSettingsPath();
    const record = this.store.readClaudeTakeover();
    // 这次首次改写做出的副本；比对不通过重试时收回，免得留下多份。
    let createdBackup: string | null = null;
    this.writeConfigFile<{ takeover: ClaudeSettingsTakeover; current: Buffer | null }>({
      filePath: settingsPath,
      compute: (text, current) => {
        const result = applyClaudeApiEndpoint({
          text,
          wiring,
          takeover: record.takeover,
          shouldRewriteModel,
        });
        if (result.kind === "unparsable") {
          throw unparsable({
            filePath: settingsPath,
            detail: result.message,
            reason: result.reason,
          });
        }
        return {
          change: { kind: "write", text: result.text },
          value: { takeover: result.takeover, current },
        };
      },
      // 先记接管记录再替换文件：替换失败时接管记录回滚；反过来会丢掉原值。
      commit: ({ takeover, current }) => {
        if (!record.backup) {
          createdBackup = this.store.writeClaudeSettingsBackup(current, this.now());
        }
        this.store.writeClaudeTakeover({
          takeover,
          backup: record.backup ?? { path: createdBackup },
        });
      },
      rollback: () => {
        this.store.writeClaudeTakeover(record);
        if (createdBackup) this.store.discardBackup(createdBackup);
        createdBackup = null;
      },
    });
    this.logger.info({ settingsPath }, "Claude settings pointed at the API endpoint gateway");
  }

  private restoreClaudeOfficial(defaultModelId: string | null): void {
    const record = this.store.readClaudeTakeover();
    const { takeover } = record;
    if (!takeover) return;
    const settingsPath = this.resolveClaudeSettingsPath();
    this.writeConfigFile({
      filePath: settingsPath,
      compute: (text) =>
        claudeRestorePlan({ filePath: settingsPath, text, takeover, defaultModelId }),
      commit: (value) =>
        this.store.writeClaudeTakeover({
          takeover: null,
          backup: record.backup,
          reconnect: value.reconnect,
        }),
      rollback: () => this.store.writeClaudeTakeover(record),
    });
    this.logger.info({ settingsPath }, "Claude settings restored to Official");
  }

  /**
   * 先算好 config.toml 的新内容（解析失败就什么都不写），再写接管记录，重读比对通过后替换 config.toml。
   * config.toml 替换不成时接管记录退回切换前的样子。
   */
  private writeCodexEndpoint(input: CliEndpointWrite): void {
    const { wiring, shouldRewriteModel } = input;
    const configPath = this.resolveCodexConfigPath();
    const record = this.store.readCodexTakeover();
    let createdBackup: string | null = null;
    this.writeConfigFile<{ takeover: CodexConfigTakeover; current: Buffer | null }>({
      filePath: configPath,
      compute: (text, current) => {
        const result = applyCodexApiEndpoint({
          text,
          wiring: {
            ...wiring,
            baseUrl: `${wiring.baseUrl}${CODEX_GATEWAY_SUFFIX}`,
            catalogPath: this.store.codexModelCatalogPath,
            chatgptBaseUrl: this.codexUsesChatGpt()
              ? `${wiring.baseUrl}${CHATGPT_BACKEND_PATH}`
              : null,
          },
          takeover: record.takeover,
          shouldRewriteModel,
        });
        if (result.kind === "unparsable")
          throw unparsable({ filePath: configPath, detail: result.message });
        return {
          change: { kind: "write", text: result.text },
          value: { takeover: result.takeover, current },
        };
      },
      commit: ({ takeover, current }) => {
        if (!record.backup) {
          createdBackup = this.store.writeCodexConfigBackup(current, this.now());
        }
        this.store.writeCodexTakeover({
          takeover,
          backup: record.backup ?? { path: createdBackup },
        });
      },
      rollback: () => {
        this.store.writeCodexTakeover(record);
        if (createdBackup) this.store.discardBackup(createdBackup);
        createdBackup = null;
      },
    });
    // 旧版本写的 auth.command 已经随专用表一起换掉，它读的 key 文件没用了。
    // COMPAT(codexLegacyProviderTable): added after v0.15.0, remove after 2027-04-14.
    this.store.removeLegacyCodexKeyFile();
    this.logger.info({ configPath }, "Codex config pointed at the API endpoint gateway");
  }

  /**
   * 问一次 Codex 是怎么登录的；同一时间只问一次。判断不出（没装 Codex、超时、回答认不出）就记日志、
   * 保持上次的结果，从没判断出时按接管记录现在的接法。
   */
  private checkCodexSignIn(): Promise<void> {
    this.codexSignInCheck ??= this.readSignInOnce().finally(() => {
      this.codexSignInCheck = null;
    });
    return this.codexSignInCheck;
  }

  private async readSignInOnce(): Promise<void> {
    try {
      const codexHome = path.dirname(this.resolveCodexConfigPath());
      const signIn = await this.readCodexSignIn({ codexHome });
      if (signIn !== this.codexSignIn) this.logger.info({ signIn }, "Codex sign-in read");
      this.codexSignIn = signIn;
    } catch (error) {
      this.logger.warn({ err: error }, "Could not tell how Codex is signed in");
    }
  }

  /** Codex 开着时问一次登录方式，与 config.toml 现在的接法不同就按新方式重写（daemon 启动、读状态时）。 */
  private async followCodexSignIn(): Promise<void> {
    if (!this.readStateForSnapshot()?.agents.codex.enabled) return;
    await this.checkCodexSignIn();
    await this.exclusiveFollowing(() => {
      const state = this.readStateForSnapshot();
      if (!state?.agents.codex.enabled || !this.codexWiringChanged()) return;
      if (this.gatewayUrlFor("codex") === null) return;
      // 负责的路由键被别的程序改过：不替用户改回，留给提示区的「重新应用」（按新的登录方式写）。
      if (this.inspectCodex(true).issues.some((issue) => issue.code === "not_through_gateway")) {
        this.logger.info("Codex config changed outside Osuna; not rewired for its new sign-in");
        return;
      }
      try {
        this.syncCli({
          provider: "codex",
          wiring: this.cliWiring(state, "codex", this.store.readGatewayTokens()),
          agent: state.agents.codex,
        });
        this.staleCodexModels(state);
        this.onActiveEndpointChanged("codex");
      } catch (error) {
        this.logger.warn({ err: error }, "Failed to rewire Codex for its sign-in");
      }
    });
  }

  private codexUsesChatGpt(): boolean {
    if (this.codexSignIn !== null) return this.codexSignIn === "chatgpt";
    return isChatGptWiring(this.store.readCodexTakeover().takeover);
  }

  /** 接管着、且 config.toml 现在的接法与 Codex 的登录方式不符。 */
  private codexWiringChanged(): boolean {
    const takeover = this.store.readCodexTakeover().takeover;
    return takeover !== null && isChatGptWiring(takeover) !== this.codexUsesChatGpt();
  }

  private restoreCodexOfficial(defaultModelId: string | null): void {
    const record = this.store.readCodexTakeover();
    const { takeover } = record;
    if (!takeover) return;
    const configPath = this.resolveCodexConfigPath();
    this.writeConfigFile({
      filePath: configPath,
      compute: (text) => codexRestorePlan({ filePath: configPath, text, takeover, defaultModelId }),
      commit: (value) =>
        this.store.writeCodexTakeover({ ...record, takeover: null, reconnect: value.reconnect }),
      rollback: () => this.store.writeCodexTakeover(record),
    });
    this.store.removeLegacyCodexKeyFile();
    this.logger.info({ configPath }, "Codex config restored to Official");
  }

  /**
   * 官方模式下留着的 Osuna 服务商表（ADR 0010）：记在它名下的 Codex 对话还要经中转站续，启动时改指这次的端口与 Codex 的口令。
   * 文件里没有这张表、或「保留当前设置」时它已被外部改过（tableKept，ADR 0012）就不写；旧版本（v0.15）留下的 auth.command 表同样换成指向中转站的。
   * 从没发过 Codex 口令（旧版本关开关时作废了）就补一个，先落口令文件再替换 config.toml。
   */
  private refreshKeptCodexTable(url: string): void {
    const record = this.store.readCodexTakeover();
    if (record.takeover || record.tableKept) return;
    const configPath = this.resolveCodexConfigPath();
    const tokensBefore = this.store.readGatewayTokens();
    const token = tokensBefore.codex ?? newGatewayToken();
    const written = this.writeConfigFile({
      filePath: configPath,
      compute: (text) => {
        const result = refreshCodexProviderTable({
          text,
          table: { baseUrl: `${url}${CODEX_GATEWAY_SUFFIX}`, bearerToken: token },
        });
        if (result.kind === "unparsable")
          throw unparsable({ filePath: configPath, detail: result.message });
        const change: ConfigFileChange =
          result.kind === "patched" && result.text !== text
            ? { kind: "write", text: result.text }
            : { kind: "keep" };
        return { change, value: change.kind === "write" };
      },
      commit: (changed) => {
        if (changed && tokensBefore.codex === undefined) {
          this.store.writeGatewayTokens({ ...tokensBefore, codex: token });
        }
      },
      rollback: () => this.store.writeGatewayTokens(tokensBefore),
    });
    // COMPAT(codexLegacyProviderTable): added after v0.15.0, remove after 2027-04-14.
    this.store.removeLegacyCodexKeyFile();
    if (written)
      this.logger.info({ configPath }, "Kept Codex provider table pointed at the gateway");
  }

  /** 冲突保护见 writeConfigFileGuarded；三次都没写成就报 config_conflict。 */
  private writeConfigFile<T>(input: {
    filePath: string;
    // `current` 是原始字节，首次改写时拿去做完整副本。
    compute: (text: string | null, current: Buffer | null) => ConfigFilePlan<T>;
    commit: (value: T) => void;
    rollback: () => void;
  }): T {
    const result = writeConfigFileGuarded({
      filePath: input.filePath,
      compute: (current) => input.compute(current?.toString("utf8") ?? null, current),
      commit: input.commit,
      rollback: input.rollback,
      ...(this.beforeConfigRecheck ? { beforeRecheck: this.beforeConfigRecheck } : {}),
    });
    if (result.kind === "conflict") {
      throw new ApiEndpointRequestError({
        code: "config_conflict",
        message: `${input.filePath} kept changing while Osuna was writing it, so nothing was written`,
      });
    }
    return result.value;
  }

  private inspectClaude(agent: ApiEndpointAgentSettings): ApiEndpointFileStatus {
    const { enabled } = agent;
    const settingsPath = this.resolveClaudeSettingsPath();
    const result = inspectClaudeSettings({
      text: readOptionalFile(settingsPath)?.toString("utf8") ?? null,
      takeover: enabled ? this.store.readClaudeTakeover().takeover : null,
    });
    if (result.kind === "unparsable") {
      return unparsableStatus({
        filePath: settingsPath,
        detail: result.message,
        reason: result.reason,
      });
    }
    const token = claudeTokenFinding({
      modifiedKeys: result.modifiedKeys,
      authToken: result.authToken,
      keepsClaudeAiLogin: agent.keepsClaudeAiLogin === true,
      filePath: settingsPath,
    });
    const modifiedKeys = token.modifiedKeys;
    const issues = notThroughGatewayIssues("claude", settingsPath, token.routingKeys);
    if (token.issue) issues.push(token.issue);
    // 只在开关开着时提示：这时 Claude Code 跳过这份文件，就不经过中转站（ADR 0012）。
    if (enabled && !result.isReadableByClaudeCode) {
      issues.push({
        code: "settings_has_comments",
        params: { file: settingsPath },
        message: `${settingsPath} has comments or trailing commas. Claude Code can't read it and skips the whole file, so Claude sessions Osuna starts go to the official API. Remove the comments and trailing commas to fix this.`,
      });
    }
    return {
      health: modifiedExternallyIssues(settingsPath, modifiedKeys),
      issues,
      baseUrl: result.baseUrl,
    };
  }

  /** 托管设置的地址与开着的云平台开关：都会让 Claude Code 绕开中转站（ADR 0012）。 */
  private async claudeBypassIssues(): Promise<AgentIssue[]> {
    const issues: AgentIssue[] = [];
    const managed = claudeManagedSettingsFiles(this.claudeManagedSettingsDir).map(
      readClaudeEnvFile,
    );
    const managedUrl = managedBaseUrl(managed);
    if (managedUrl && !(await this.pointsAtGateway(managedUrl.url))) {
      issues.push({
        code: "managed_base_url",
        params: { file: managedUrl.file, url: managedUrl.url },
        message: `Claude Code's managed settings (${managedUrl.file}) set ANTHROPIC_BASE_URL to ${managedUrl.url}, which wins over the gateway's`,
      });
    }
    // CLAUDE_CONFIG_DIR 设了时 Claude Code 读它下面的 .claude.json，否则读家目录下的。
    const configDir = this.env.CLAUDE_CONFIG_DIR?.trim();
    const globalConfigPath = path.join(configDir || this.homeDir, ".claude.json");
    const loginShellVars = await this.readLoginShellEnv(LOGIN_SHELL_KEYS);
    const finding = findClaudeCloudSwitch({
      managed,
      settings: readClaudeEnvFile(this.resolveClaudeSettingsPath()),
      globalConfig: readClaudeEnvFile(globalConfigPath),
      // 登录 shell 的，没有再看 daemon 自己的（magpie 的 claudeShellEnv）。
      shellEnv: { ...this.env, ...loginShellVars },
    });
    if (finding) issues.push(cloudSwitchIssue(finding));
    return issues;
  }

  /** 地址是中转站自己的，或是一条问得到中转站的代理（照 magpie 的 reachesMagpie）。 */
  private async pointsAtGateway(url: string): Promise<boolean> {
    const gatewayUrl = this.gatewayUrlFor("claude");
    if (gatewayUrl === null) return false;
    if (trimTrailingSlashes(url) === trimTrailingSlashes(gatewayUrl)) return true;
    const base = proxyBase({ value: url, gateway: gatewayUrl });
    return base !== null && (await this.reachesGateway(base));
  }

  /** Codex 经代理到不了中转站（codex-proxy.ts）；直连、代理转得过去、还没查完都为 null。 */
  private async codexProxiedIssue(): Promise<AgentIssue | null> {
    const base = this.gatewayUrlFor("codex");
    if (base === null) return null;
    const configText = readOptionalFile(this.resolveCodexConfigPath())?.toString("utf8") ?? null;
    const finding = await this.codexProxy.read({
      base,
      respectsSystemProxy: readCodexRespectsSystemProxy(configText),
    });
    if (finding === null) return null;
    return {
      code: "codex_proxied",
      params: { ...finding },
      message: codexProxiedMessage(finding),
    };
  }

  /** Codex 读到的代理变量：登录 shell 的，没有再用 daemon 自己的（magpie 的 codexEnv）。 */
  private async readCodexProxyEnv(): Promise<ProxyEnv> {
    const shell = await this.readLoginShellEnv(LOGIN_SHELL_KEYS);
    const env: Record<string, string | undefined> = {};
    for (const key of CODEX_PROXY_ENV_KEYS) env[key] = shell[key] ?? this.proxyEnv[key];
    return env;
  }

  /** 问不到系统时按没设代理，记日志，不挡列表。 */
  private async readSystemProxy(hostProcesses: () => HostProcesses): Promise<SystemProxy> {
    try {
      return await hostProcesses().readSystemProxy();
    } catch (error) {
      if (!(error instanceof HostProcessesError)) throw error;
      this.logger.warn({ err: error }, "Could not read the system proxy");
      return NO_SYSTEM_PROXY;
    }
  }

  /** CLI 自己的记录显示最近一次改写之后用过，中转站却没收到（cli-bypass.ts）；没有为 null。 */
  private bypassedIssue(provider: ApiEndpointProvider): AgentIssue | null {
    // 没记下改写时刻（打开开关后才升级到记它的版本）时，照 magpie 总有 rec.At 的样子从 daemon 起来时算。
    const rewrittenAt = this.store.readCliRewrittenAt(provider) ?? this.startedAt;
    const now = this.now();
    const use = this.readCliUse({
      provider,
      configDir: path.dirname(this.resolveCliConfigPath(provider)),
      since: rewrittenAt,
      now,
    });
    const gatewayUrls = [this.gatewayUrlFor(provider), this.writtenGateway(provider)?.url].filter(
      (url): url is string => url !== null && url !== undefined,
    );
    const bypass = findCliBypass({
      use,
      startedAt: this.startedAt,
      rewrittenAt,
      lastSeen: this.sightings.lastSeen(provider),
      gatewayUrls,
      now,
    });
    if (bypass === null) return null;
    return bypassedIssue({ agent: AGENT_NAMES[provider], bypass });
  }

  /** 这个 CLI 的配置文件：Claude Code 的 settings.json、Codex 的 config.toml。 */
  private resolveCliConfigPath(provider: ApiEndpointProvider): string {
    if (provider === "claude") return this.resolveClaudeSettingsPath();
    return this.resolveCodexConfigPath();
  }

  /**
   * 「Codex Subagent 可用任意模型」开着、Codex 经过中转站时，Codex 自己的 multi_agent_v2 开着就盖过它（magpie codexSubAgentsV1Warning）：
   * 只提示，Osuna 不改这个键。读不了文件时另一条，不当作没开。
   */
  private codexMultiAgentV2Issue(state: ApiEndpointState): AgentIssue | null {
    const agent = state.agents.codex;
    const isChecked = agent.enabled && agent.allowsAnySubagentModel === true;
    if (!isChecked) return null;
    const file = this.resolveCodexConfigPath();
    const found = readCodexMultiAgentV2(readOptionalFile(file)?.toString("utf8") ?? null);
    switch (found.kind) {
      case "off":
        return null;
      case "on":
        return {
          code: "codex_multi_agent_v2_on",
          params: { file },
          message: `${file} turns Codex's own multi_agent_v2 on, which takes over the multi-agent V1 the API endpoint models ask for; turn it off in Codex's config to run Subagents on them`,
        };
      case "unparsable":
        return {
          code: "codex_multi_agent_v2_unreadable",
          params: { file, detail: found.message },
          message: `Subagents on any model is on, but Osuna couldn't read ${file} to check Codex's own multi_agent_v2`,
        };
    }
  }

  private inspectCodex(enabled: boolean): ApiEndpointFileStatus {
    const configPath = this.resolveCodexConfigPath();
    const result = inspectCodexConfig({
      text: readOptionalFile(configPath)?.toString("utf8") ?? null,
      takeover: enabled ? this.store.readCodexTakeover().takeover : null,
    });
    if (result.kind === "unparsable")
      return unparsableStatus({ filePath: configPath, detail: result.message });
    const health = modifiedExternallyIssues(configPath, result.modifiedKeys);
    const issues = notThroughGatewayIssues("codex", configPath, result.modifiedKeys);
    if (result.profileOverride) {
      const { profile, keys } = result.profileOverride;
      const overridden = keys.join(", ");
      const issue: AgentIssue = {
        code: "codex_profile_override",
        params: { file: configPath, profile, keys: overridden },
        message: `${configPath} selects profile "${profile}", and [profiles.${profile}] sets ${overridden}, which overrides the API endpoint`,
      };
      health.push({ code: "codex_profile_override", message: issue.message });
      issues.push(issue);
    }
    return { health, issues, baseUrl: result.baseUrl };
  }

  /** 主机级字段原样给出；provider、baseUrl、defaultModelId 是给老客户端的投影。 */
  private toWire(
    state: ApiEndpointState,
    endpoint: StoredApiEndpoint,
    provider: ApiEndpointProvider,
  ): ApiEndpoint {
    const apiKey = this.store.getApiKey(endpoint.id);
    return {
      id: endpoint.id,
      provider,
      name: endpoint.name,
      slug: endpoint.slug,
      baseUrl: projectedBaseUrl(endpoint, provider),
      baseUrls: endpoint.baseUrls,
      models: endpoint.models,
      defaultModelId: projectedDefaultModelId(state.agents[provider], endpoint),
      ...(endpoint.modelMapping ? { modelMapping: endpoint.modelMapping } : {}),
      enabled: endpoint.enabled,
      hasApiKey: apiKey !== null,
      ...(apiKey !== null ? { apiKeyMask: maskApiKey(apiKey) } : {}),
      defaultModelProviders: defaultModelProvidersOf(state, endpoint.id),
      cooldown: this.cooldownOf(endpoint.id),
      ...(endpoint.catalog
        ? {
            catalog: {
              fetchedAt: endpoint.catalog.fetchedAt,
              models: endpoint.catalog.models.map(toWireModel),
            },
          }
        : {}),
      ...(endpoint.manualModels ? { manualModels: endpoint.manualModels } : {}),
      ...(endpoint.modelScope !== undefined ? { modelScope: endpoint.modelScope } : {}),
      ...(endpoint.autoPick ? { autoPick: endpoint.autoPick } : {}),
      searchesWeb: endpoint.searchesWeb === true,
      ...(endpoint.templateId !== undefined ? { templateId: endpoint.templateId } : {}),
      ...(endpoint.region !== undefined ? { region: endpoint.region } : {}),
      ...(endpoint.icon !== undefined ? { icon: endpoint.icon } : {}),
      ...(endpoint.modelSettings !== undefined ? { modelSettings: endpoint.modelSettings } : {}),
      modelFacts: this.wireModelFacts(endpoint),
      testsAs: cliTestsOffered({
        endpoint,
        hasSample: (client) => this.store.readCliHeaderSample(client) !== null,
      }),
      ...(endpoint.headers !== undefined ? { headers: endpoint.headers } : {}),
      ...(endpoint.extraBody !== undefined ? { extraBody: endpoint.extraBody } : {}),
      ...(endpoint.keyHeader !== undefined ? { keyHeader: endpoint.keyHeader } : {}),
      ...(endpoint.insecureTls === true ? { insecureTls: true } : {}),
      ...(endpoint.cooldownSettings !== undefined
        ? { cooldownSettings: endpoint.cooldownSettings }
        : {}),
    };
  }

  /** 这家每个模型（在服务的、清单里的、手动添加的）自动取到的资料，模型设置窗口拿它当默认。 */
  private wireModelFacts(endpoint: StoredApiEndpoint): Record<string, ApiEndpointModelFacts> {
    const models = [
      ...endpoint.models,
      ...(endpoint.catalog?.models ?? []),
      ...(endpoint.manualModels ?? []),
    ];
    const facts: Record<string, ApiEndpointModelFacts> = {};
    for (const { id } of models) facts[id] ??= this.autoModelFacts(endpoint, id);
    return facts;
  }

  /** 整家接口的冷却；只冷却了某个模型的不算。 */
  private cooldownOf(endpointId: string): ApiEndpointCooldown | null {
    const rest = this.cooldowns.endpointRest(endpointId);
    if (!rest) return null;
    return {
      state: rest.why === "auth" ? "needs_check" : "cooling_down",
      reason: rest.why,
      until: rest.until === null ? null : new Date(rest.until).toISOString(),
    };
  }

  /** 先让 CLI 自己存下的选择跟过去，再做会改写 CLI 配置的事：改写不盖掉它们（ADR 0012）。 */
  private exclusiveFollowing<T>(run: () => T | Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      await this.followCliPicks();
      return run();
    });
  }

  private exclusive<T>(run: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

/** 导入窗口会默认选上的那几条（发现提示的候选）：只留指纹与来源软件。 */
function offeredCandidates(
  settled: ReturnType<typeof settleImports>,
): ApiEndpointImportCandidate[] {
  const candidates: ApiEndpointImportCandidate[] = [];
  for (const { source, entries } of settled) {
    for (const entry of entries) {
      const facts = { ...entry, hasOtherKey: entry.otherKey !== null };
      if (!isPreselectedImport(facts)) continue;
      candidates.push({ fingerprint: entry.fingerprint, sourceId: source.id, source: source.name });
    }
  }
  return candidates;
}

/** 接口顺序里最靠前、开着、选了这个模型的那家（中转站对光秃秃的模型名先发给它）。 */
function firstEnabledServing(
  state: ApiEndpointState,
  modelId: string,
): StoredApiEndpoint | undefined {
  return state.endpoints.find(
    (entry) => entry.enabled && entry.models.some((model) => model.id === modelId),
  );
}

/** 这家上游清单自己给的资料（不含 models.dev 补的）。 */
function listedFactsOf(endpoint: StoredApiEndpoint, modelId: string): ModelFacts | undefined {
  return endpoint.catalog?.models.find((model) => model.id === modelId)?.facts;
}

function findProvider(provider: string): ApiEndpointProvider | undefined {
  return API_ENDPOINT_PROVIDERS.find((candidate) => candidate === provider);
}

function requireProvider(provider: string): ApiEndpointProvider {
  const supported = findProvider(provider);
  if (!supported) {
    throw new ApiEndpointRequestError({
      code: "unsupported_provider",
      message: `API endpoints are not supported for provider '${provider}'`,
    });
  }
  return supported;
}

/**
 * 口令发了就一直用（ADR 0010）：开着却没有的补一个，关掉不作废，再打开沿用，
 * 关掉后还在跑的会话和 CLI 配置里留着的口令照样认得出是哪个 Agent。
 */
function nextGatewayTokens(next: ApiEndpointState, current: GatewayTokens): GatewayTokens {
  const tokens: GatewayTokens = { ...current };
  for (const provider of API_ENDPOINT_PROVIDERS) {
    if (next.agents[provider].enabled && !tokens[provider]) tokens[provider] = newGatewayToken();
  }
  return tokens;
}

function newGatewayToken(): string {
  return randomBytes(32).toString("base64url");
}

function sameTokens(a: GatewayTokens, b: GatewayTokens): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 快照里该 Agent 的一切：模型列表、默认模型、当前接口；前后不同才通知刷新。 */
function agentFingerprint(state: ApiEndpointState, provider: ApiEndpointProvider): string {
  const agent = state.agents[provider];
  if (!agent.enabled) return "official";
  const target = agentTargetEndpoint(state, provider);
  return JSON.stringify([
    agent.defaultModelId,
    agent.defaultThinkingOptionId ?? null,
    agent.usesUltraCode ?? null,
    agent.backgroundModelId ?? null,
    agent.subagentModelId ?? null,
    agent.subagentThinkingOptionId ?? null,
    agent.memoryModelId ?? null,
    usableModels(state),
    state.disabledModels ?? null,
    state.endpointNameDisplay ?? null,
    target ? [target.id, target.name] : null,
    endpointModelGroups(state).map((group) => [
      group.endpoint.name,
      group.models.map((entry) => [entry.id, entry.model.label]),
      // 模型设置改了显示名与思考档位。
      group.endpoint.modelSettings ?? null,
    ]),
  ]);
}

function requestErrorOf(failure: UpstreamFailure): ApiEndpointRequestError {
  return new ApiEndpointRequestError(failure);
}

/** 上游清单里的模型资料只留在 daemon 里；发给客户端的只有 id 和显示名。 */
function toWireModel(model: ListedModel): ApiEndpointModel {
  return model.label === undefined ? { id: model.id } : { id: model.id, label: model.label };
}

/** 打开总开关后的设置；没有可用模型或指定的默认模型不可用时拒绝。没指定时用照 magpie 挑中的（pick）。 */
function enabledAgentSettings(input: {
  state: ApiEndpointState;
  provider: ApiEndpointProvider;
  requested: string | undefined;
  pick: DefaultModelPick | null;
}): ApiEndpointAgentSettings {
  const { state, requested, pick } = input;
  if (usableModels(state).length === 0) {
    throw new ApiEndpointRequestError({
      code: "no_usable_model",
      message: "Turn on an API endpoint and select at least one of its models first",
    });
  }
  if (requested && !isDefaultModelChoice(state, requested)) {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message: "The default model must be one of the models selected on an endpoint that is on",
    });
  }
  const agent = state.agents[input.provider];
  const defaultModelId = requested || pick?.defaultModelId;
  // 有可用模型时总挑得出来。
  if (!defaultModelId) throw new Error("No default model was picked");
  return { ...agent, enabled: true, defaultModelId };
}

// Codex 自己的模型在选项里标的出处（产品名，不翻译）。
const CODEX_OWN_MODELS_SOURCE = "ChatGPT";

// Codex 的 Subagent 跑的模型档位不清楚时给的选项（magpie subagent_effort 的 static）。
const CODEX_UNKNOWN_SUBAGENT_LEVELS = ["low", "medium", "high", "xhigh"];

// Subagent 能固定的思考档位（magpie MemberEfforts）。
const SUBAGENT_EFFORTS: ReadonlySet<string> = new Set(FIXED_EFFORTS);

function sideModel(input: { state: ApiEndpointState; requested: string | null }): string | null {
  if (input.requested === null) return null;
  const requested = input.requested.trim();
  if (!isDefaultModelChoice(input.state, requested)) {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message: `${requested} is not one of the models selected on an endpoint that is on`,
    });
  }
  return requested;
}

function subagentLevel(requested: string | null): string | null {
  if (requested === null) return null;
  const level = requested.trim().toLowerCase();
  if (!SUBAGENT_EFFORTS.has(level)) {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message: `The Subagent thinking is one of ${FIXED_EFFORTS.join(", ")}, not ${requested}`,
    });
  }
  return level;
}

/**
 * CLI 配置里的 Subagent 模型被改了之后的设置（照 magpie subagent 字段的 Get 读文件）：删掉了就跟主模型；
 * 改成某家接口提供的模型就是新的 Subagent 模型（就是默认模型时算跟主模型），「:档位」是它的思考档位；
 * 哪家都没有的不跟，下次改写时照 Osuna 的设置写回（magpie 同样不留）。
 */
function followedSubagent(input: {
  state: ApiEndpointState;
  agent: ApiEndpointAgentSettings;
  now: string | null;
}): ApiEndpointAgentSettings {
  const { state, agent } = input;
  if (input.now === null) {
    return { ...agent, subagentModelId: null, subagentThinkingOptionId: null };
  }
  const split = askedAt({ id: input.now, isListed: (id) => isDefaultModelChoice(state, id) });
  const served = servedModel(state, split.model);
  if (served === null) return agent;
  const subagentModelId = served === agent.defaultModelId ? null : served;
  return { ...agent, subagentModelId, subagentThinkingOptionId: split.effort };
}

/**
 * 这次改写要不要盖掉 CLI 自己换过的模型：「重新应用」，或在 Osuna 里换了默认模型（跟着 CLI 换的不算）。
 */
function shouldRewriteCliModel(input: {
  previous: ApiEndpointState;
  next: ApiEndpointState;
  provider: ApiEndpointProvider;
  options: { rewrite?: ApiEndpointProvider; isFollowingCli?: boolean };
}): boolean {
  const { previous, next, provider, options } = input;
  if (provider === options.rewrite) return true;
  const isDefaultModelChanged =
    previous.agents[provider].defaultModelId !== next.agents[provider].defaultModelId;
  return isDefaultModelChanged && options.isFollowingCli !== true;
}

/** 关掉时还原 CLI 配置的计划。 */
interface RestorePlanInput<Takeover> {
  filePath: string;
  text: string | null;
  takeover: Takeover;
  defaultModelId: string | null;
}

/** 关掉时 settings.json 怎么改回（关开关与关前预览共用）；读不懂时抛 config_unparsable。 */
function claudeRestorePlan(
  input: RestorePlanInput<ClaudeSettingsTakeover>,
): ConfigFilePlan<ReconnectRecord> {
  const result = restoreClaudeOfficial({ text: input.text, takeover: input.takeover });
  if (result.kind === "unparsable") {
    throw unparsable({ filePath: input.filePath, detail: result.message, reason: result.reason });
  }
  let change: ConfigFileChange = { kind: "keep" };
  let left: string | null = null;
  if (result.kind === "patched") {
    change = { kind: "write", text: result.text };
    left = readClaudeModel(result.text);
  }
  if (result.kind === "delete") change = { kind: "delete" };
  return { change, value: reconnectRecord(input.defaultModelId, left) };
}

/** 关掉时 config.toml 怎么改回（关开关与关前预览共用）；读不懂时抛 config_unparsable。 */
function codexRestorePlan(
  input: RestorePlanInput<CodexConfigTakeover>,
): ConfigFilePlan<ReconnectRecord> {
  const result = restoreCodexOfficial({ text: input.text, takeover: input.takeover });
  if (result.kind === "unparsable") {
    throw unparsable({ filePath: input.filePath, detail: result.message });
  }
  let change: ConfigFileChange = { kind: "keep" };
  let left: string | null = null;
  if (result.kind === "patched") {
    change = { kind: "write", text: result.text };
    left = readCodexModel(result.text);
  }
  if (result.kind === "delete") change = { kind: "delete" };
  return { change, value: reconnectRecord(input.defaultModelId, left) };
}

/** 写进接管记录的 reconnect；没有默认模型时不写。 */
interface ReconnectRecord {
  reconnect?: DefaultModelReconnect;
}

/** 切回官方时要记下的默认模型与 CLI 配置里留下的模型；没有默认模型就不记。 */
function reconnectRecord(defaultModelId: string | null, left: string | null): ReconnectRecord {
  return defaultModelId === null ? {} : { reconnect: { model: defaultModelId, left } };
}

/** 按 id 替换，找不到就追加到末尾：新建的接口排在接口顺序的最后。 */
function withEndpoint(
  endpoints: StoredApiEndpoint[],
  endpoint: StoredApiEndpoint,
): StoredApiEndpoint[] {
  const index = endpoints.findIndex((entry) => entry.id === endpoint.id);
  return index === -1 ? [...endpoints, endpoint] : endpoints.with(index, endpoint);
}

/** 存下的图标：请求给了就用它（null 是去掉），没给留下原来的。 */
function iconFieldOf(input: {
  requested: string | null | undefined;
  kept: string | undefined;
}): Pick<StoredApiEndpoint, "icon"> {
  const icon = input.requested === undefined ? input.kept : input.requested;
  return icon === undefined || icon === null ? {} : { icon };
}

/** 接口用着的图标值（存下的图片与内置图标都算；prune 只看 `file:` 的）。 */
function endpointIcons(state: ApiEndpointState): string[] {
  return state.endpoints.flatMap((endpoint) =>
    endpoint.icon === undefined ? [] : [endpoint.icon],
  );
}

/** 复制（copyOf）的原来那家；不复制时为 null。和 endpointId 一起给、或那家不在了都拒收。 */
function copySourceOf(
  state: ApiEndpointState,
  input: ApiEndpointSaveInput,
): StoredApiEndpoint | null {
  if (input.copyOf === undefined) return null;
  if (input.endpointId !== undefined) {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message: "A save that duplicates an endpoint cannot also edit one",
    });
  }
  const source = findEndpoint(state, input.copyOf);
  if (!source) {
    throw new ApiEndpointRequestError({ code: "not_found", message: "API endpoint not found" });
  }
  return source;
}

/** 这次保存要存的 key：打了就用打的；没打时复制用原来那家的，其余为 undefined（新建不存、编辑保留）。 */
function savedKeyOf(input: {
  input: ApiEndpointSaveInput;
  copySource: StoredApiEndpoint | null;
  store: ApiEndpointStore;
}): string | undefined {
  const typed = input.input.apiKey?.trim();
  if (typed) return typed;
  if (!input.copySource) return undefined;
  return input.store.getApiKey(input.copySource.id) ?? undefined;
}

function reachesAnyAddress(): boolean {
  return true;
}

/** 照 magpie：新建一家，或换成了另一把 key，保存后当场拉一次清单。要在写入新 key 之前问。 */
function fetchesListOnSave(input: {
  existing: StoredApiEndpoint | null;
  apiKey: string | undefined;
  store: ApiEndpointStore;
}): boolean {
  const { existing, apiKey } = input;
  if (existing === null) return true;
  return apiKey !== undefined && apiKey !== input.store.getApiKey(existing.id);
}

/**
 * 新建的接口名称重了（不分大小写）就加「 2」「 3」……（照 magpie freeName）；编辑时不改用户起的名字。
 */
function freeEndpointName(state: ApiEndpointState, name: string): string {
  const taken = new Set(state.endpoints.map((entry) => entry.name.toLowerCase()));
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${name} ${n}`;
  return candidate;
}

/** 这次保存的模板与区域：templateId undefined 即沿用 base 的；region 给了就用，否则 keepsRegion 时沿用 base 的。 */
interface SavedTemplate {
  templateId: string | undefined;
  region: string | undefined;
  keepsRegion: boolean;
}

/** 存下的模板与区域：没给模板就由 kept 带着原来的；换了模板而没给区域时，原来的区域不属于新模板，不留。 */
function templateFieldsOf(
  saved: SavedTemplate,
  keptRegion: string | undefined,
): Pick<StoredApiEndpoint, "templateId" | "region"> {
  const region = saved.region ?? (saved.keepsRegion ? keptRegion : undefined);
  return {
    ...(saved.templateId !== undefined ? { templateId: saved.templateId } : {}),
    ...(region !== undefined ? { region } : {}),
  };
}

/** 模板要是内置的，区域要是那个模板的；区域单给时按这家原来的模板查。 */
function validateTemplate(
  input: ApiEndpointSaveInput,
  base: StoredApiEndpoint | null,
): SavedTemplate {
  const templateId = input.templateId ?? base?.templateId;
  const keepsRegion = input.templateId === undefined || input.templateId === base?.templateId;
  if (input.templateId === undefined && input.region === undefined) {
    return { templateId: undefined, region: undefined, keepsRegion };
  }
  const template = templateId === undefined ? null : findTemplate(templateId);
  if (!template) {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message:
        templateId === undefined
          ? "A region needs the template it belongs to"
          : `Unknown template: ${templateId}`,
    });
  }
  const regionIsTemplates =
    input.region === undefined ||
    (template.regions ?? []).some((candidate) => candidate.id === input.region);
  if (!regionIsTemplates) {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message: `Template ${template.id} has no region ${input.region}`,
    });
  }
  return { templateId: input.templateId, region: input.region, keepsRegion };
}

/** 保存请求省略「自己能联网搜索」时沿用这家原来的；新建为关。 */
function keptSearchesWeb(
  requested: boolean | undefined,
  existing: StoredApiEndpoint | null,
): boolean {
  return requested ?? existing?.searchesWeb === true;
}

/**
 * 从已有的这家起步，只换掉这次保存给的字段：没给的保留原值，老客户端（含官方 Paseo 手机 App）
 * 不认识的字段不会被它的保存清掉（上游清单、开关、别的格式的地址，以及以后加的字段）。
 * 档位映射每次整份提交、省略即不映射；手动添加的模型与「自己能联网搜索」由下面按请求换算。新建时生成标识。
 */
function buildEndpoint(input: {
  state: ApiEndpointState;
  existing: StoredApiEndpoint | null;
  // 复制时原来那家：没给的字段取它的，id、标识、开关、时间仍按新建。
  copySource: StoredApiEndpoint | null;
  fields: EndpointFields;
  // 「自己能联网搜索」：请求省略时调用方已换成这家原来的值。
  searchesWeb: boolean;
  // 模板与区域：validateTemplate 已换算好，undefined 的那项从 base 原样留下。
  template: SavedTemplate;
  // 请求给的图标：null 去掉，undefined 留下 base 的。
  icon: string | null | undefined;
  // 添加窗口里保存前拉到的上游清单：拉取时间记为保存时刻；undefined 留下 base 的。
  catalog: ApiEndpointModel[] | undefined;
  // 请求头、附加请求体、key 放哪个头：savedRequestExtras 已按请求与 base 定好，没有的项就是没有。
  requestExtras: StoredRequestExtras;
  // 冷却设置：savedCooldownSettings 已按请求与 base 定好，没设就没有这项。
  cooldownSettings: StoredCooldownSettings;
  enabledWhenNew: boolean;
  timestamp: string;
}): StoredApiEndpoint {
  const { state, existing, fields } = input;
  const base = existing ?? input.copySource;
  const legacyDefaultModelId = fields.legacyDefaultModelId ?? base?.legacyDefaultModelId;
  const manualModels = fields.manualModels ?? base?.manualModels;
  const {
    modelMapping: _resubmitted,
    manualModels: _manualModels,
    searchesWeb: _searchesWeb,
    region: keptRegion,
    icon: keptIcon,
    headers: _headers,
    extraBody: _extraBody,
    keyHeader: _keyHeader,
    insecureTls: _insecureTls,
    cooldownSettings: _cooldownSettings,
    ...kept
  } = base ?? {};
  const name = existing ? fields.name : freeEndpointName(state, fields.name);
  return {
    ...kept,
    ...templateFieldsOf(input.template, keptRegion),
    id: existing?.id ?? `ep_${randomUUID()}`,
    slug:
      existing?.slug ??
      generateEndpointSlug(name, new Set(state.endpoints.map((entry) => entry.slug))),
    ...fields,
    name,
    enabled: existing?.enabled ?? input.enabledWhenNew,
    ...(legacyDefaultModelId ? { legacyDefaultModelId } : {}),
    ...(manualModels && manualModels.length > 0 ? { manualModels } : {}),
    ...(input.searchesWeb ? { searchesWeb: true as const } : {}),
    ...iconFieldOf({ requested: input.icon, kept: keptIcon }),
    ...catalogFieldOf({ requested: input.catalog, timestamp: input.timestamp }),
    ...input.requestExtras,
    ...input.cooldownSettings,
    createdAt: existing?.createdAt ?? input.timestamp,
    updatedAt: input.timestamp,
  };
}

type StoredRequestExtras = Pick<
  StoredApiEndpoint,
  "headers" | "extraBody" | "keyHeader" | "insecureTls"
>;

/**
 * 存下的请求头、附加请求体、key 放哪个头与不校验证书：请求给了的换上（空的、both、false 不存），没给的留 base 的。
 * 请求头照 magpie 照存，发不出去的头发时每个请求报 invalid_header；附加请求体校验后才存。
 * 模板接口打开不校验证书拒收（照 magpie Validate 的 TakesInsecureTLS）。
 */
function savedRequestExtras(input: {
  request: ApiEndpointSaveInput;
  base: StoredApiEndpoint | null;
  templateId: string | undefined;
}): StoredRequestExtras {
  const { request, base, templateId } = input;
  const insecureTls = request.insecureTls ?? base?.insecureTls === true;
  if (insecureTls && templateId !== undefined) {
    throw new ApiEndpointRequestError({
      code: "insecure_tls_template",
      message: `An endpoint added from the ${templateId} template always checks its certificate: only an endpoint you added as Custom can skip it`,
      params: { template: templateId },
    });
  }
  let headers = base?.headers ?? null;
  if (request.headers !== undefined) headers = cleanRequestHeaders(request.headers);
  let extraBody = base?.extraBody ?? null;
  if (request.extraBody !== undefined) extraBody = validatedExtraBody(request.extraBody);
  let keyHeader: ApiEndpointKeyHeader = base?.keyHeader ?? "both";
  if (request.keyHeader !== undefined) keyHeader = request.keyHeader;
  const saved: StoredRequestExtras = {};
  if (headers !== null) saved.headers = headers;
  if (extraBody !== null) saved.extraBody = extraBody;
  if (keyHeader !== "both") saved.keyHeader = keyHeader;
  if (insecureTls) saved.insecureTls = true;
  return saved;
}

type StoredCooldownSettings = Pick<StoredApiEndpoint, "cooldownSettings">;

/**
 * 存下的冷却设置：请求给了就整份换上（0 是用中转站自己的，不存；「原因不明不冷却」开着时冷却上限不存，照 magpie 的
 * RestCapOff 与 RestCap 是同一项；设了每天几点恢复时分钟数不存），没给留 base 的。分钟数不是 0 到八天的整数、时刻读不懂的拒收
 * （照 magpie SetQuotaRest、SetRestCap、SetQuotaResetAt）。
 * 什么都没设时没有这项。
 */
function savedCooldownSettings(input: {
  requested: ApiEndpointCooldownSettings | undefined;
  base: StoredApiEndpoint | null;
}): StoredCooldownSettings {
  const { requested } = input;
  const kept = input.base?.cooldownSettings;
  if (requested === undefined) return kept !== undefined ? { cooldownSettings: kept } : {};
  const problem = cooldownSettingsProblem(requested);
  if (problem !== null) {
    throw new ApiEndpointRequestError({
      code: "invalid_cooldown_settings",
      message: cooldownProblemMessage({ field: problem.field, requested }),
      params: { field: problem.field, max: String(API_ENDPOINT_COOLDOWN_MAX_MINUTES) },
    });
  }
  const saved: ApiEndpointCooldownSettings = {};
  const noFailRest = requested.noFailRest === true;
  const quotaRest = requested.quotaRestMinutes ?? 0;
  const restCap = requested.restCapMinutes ?? 0;
  const resetAt = requested.quotaResetAt?.trim() ?? "";
  // 每天几点恢复与分钟数是同一项的两种设法（magpie SetQuotaResetAt 清掉 QuotaRest）：两个都给时时刻说了算。
  if (resetAt !== "") saved.quotaResetAt = resetAt;
  else if (quotaRest > 0) saved.quotaRestMinutes = quotaRest;
  if (noFailRest) saved.noFailRest = true;
  else if (restCap > 0) saved.restCapMinutes = restCap;
  return Object.keys(saved).length > 0 ? { cooldownSettings: saved } : {};
}

/** 冷却设置哪一项不对，用英文说给老客户端看（新客户端按 field 用界面语言说）。 */
function cooldownProblemMessage(input: {
  field: ApiEndpointCooldownField;
  requested: ApiEndpointCooldownSettings;
}): string {
  const { field, requested } = input;
  if (field === "quotaResetAt") {
    return `quotaResetAt is a time of day like 08:00, or 00:00+08:00 on the vendor's clock, not "${requested.quotaResetAt}"`;
  }
  return `${field} is whole minutes from 0 (the gateway's own) to ${API_ENDPOINT_COOLDOWN_MAX_MINUTES} (${API_ENDPOINT_COOLDOWN_MAX_DAYS} days), not ${requested[field]}`;
}

/** 这次变更后不再不校验证书的主机：地址换了、不校验关了、整家关了或删了的那几家原来的。 */
function releasedUncheckedHosts(input: {
  previous: ApiEndpointState;
  next: ApiEndpointState;
}): string[] {
  const released: string[] = [];
  for (const before of input.previous.endpoints) {
    const after = findEndpoint(input.next, before.id);
    const kept = after ? liveUncheckedHostsOf(after) : [];
    for (const host of liveUncheckedHostsOf(before)) {
      if (!kept.includes(host)) released.push(host);
    }
  }
  return released;
}

/**
 * 拉模型、测试、检测时这家的地址：表单的盖过存的（照 magpie typed）。给了 baseUrls 是表单的全部地址；只给一种格式的
 * baseUrl 就换掉存的那种格式，被换掉的旧地址不再算这家的；不带格式（自动检测问的那个地址）就加上它。
 */
function formAddressesOver(input: {
  saved: { format: string; url: string }[];
  form: { baseUrl: string; format?: string; baseUrls?: { format: string; url: string }[] };
}): string[] {
  const { form } = input;
  if (form.baseUrls !== undefined) return form.baseUrls.map(({ url }) => url);
  const byFormat = new Map(input.saved.map(({ format, url }) => [format, url]));
  if (form.format === undefined) return [...byFormat.values(), form.baseUrl];
  byFormat.set(form.format, form.baseUrl);
  return [...byFormat.values()];
}

/** 附加请求体：字段没名字、是保留字段、同名写了两次的拒收（照 magpie ExtraBodyOK）。空的为 null。 */
function validatedExtraBody(raw: Record<string, unknown>): Record<string, unknown> | null {
  if (Object.keys(raw).length === 0) return null;
  const problem = extraBodyProblem(raw);
  if (problem === null) return raw;
  const field = problem.reason === "unnamed" ? "" : problem.field;
  const messages: Record<ExtraBodyProblem["reason"], string> = {
    unnamed: "An extra body field needs a name",
    reserved: `Extra body can't set "${field}": Osuna sets the model, stream and the conversation itself`,
    duplicate: `Extra body names "${field}" twice`,
  };
  throw new ApiEndpointRequestError({
    code: "invalid_extra_body",
    message: messages[problem.reason],
    params: { reason: problem.reason, field },
  });
}

/** 请求里的字段与这次定下的服务范围（省略时取原来那家的）。 */
function savedFieldsOf(input: {
  provider: ApiEndpointProvider;
  input: ApiEndpointSaveInput;
  existing: StoredApiEndpoint | null;
  base: StoredApiEndpoint | null;
  templateId: string | undefined;
}): { fields: EndpointFields; modelScope: ApiEndpointModelScope | undefined } {
  const { input: request } = input;
  const modelScope = request.modelScope ?? storedModelScopeOf(input.base);
  if (request.baseUrls === undefined) {
    return { fields: validateLegacyFields(input.provider, request, input.existing), modelScope };
  }
  // 跟随清单时档位映射对着在服务的模型校验（settleSavedScope），不对着请求里的 models。
  const formInput = followsList({ modelScope }) ? { ...request, modelMapping: undefined } : request;
  const baseUrls = templateBaseUrls({ templateId: input.templateId, baseUrls: request.baseUrls });
  return { fields: validateFields(baseUrls, formInput), modelScope };
}

/** 存的范围是字符串（降级后读得懂）；不认识的当 picked。没有就是没设过。 */
function storedModelScopeOf(endpoint: StoredApiEndpoint | null): ApiEndpointModelScope | undefined {
  if (endpoint?.modelScope === undefined) return undefined;
  return endpoint.modelScope === "vendor" ? "vendor" : "picked";
}

/** 线上的服务范围是字符串：不认识的拒收。 */
export function validateModelScope(raw: string | undefined): ApiEndpointModelScope | undefined {
  if (raw === undefined) return undefined;
  const scope = API_ENDPOINT_MODEL_SCOPES.find((candidate) => candidate === raw);
  if (!scope) {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message: `Unknown model scope '${raw}'`,
    });
  }
  return scope;
}

/**
 * 保存时定下服务范围、自动勾选规则与在服务的模型（model-scope.ts）。跟随清单：models 按清单与手动添加的算，
 * 新客户端的档位映射对着它校验，老客户端的只留还在服务的档位。挑选：规则改了时当前清单里匹配的也勾上
 * （照 magpie SetAutoInclude），随保存带来新清单时勾上其中新出的。
 */
function settleSavedScope(input: {
  endpoint: StoredApiEndpoint;
  base: StoredApiEndpoint | null;
  input: ApiEndpointSaveInput;
  modelScope: ApiEndpointModelScope | undefined;
  isLegacyForm: boolean;
}): StoredApiEndpoint {
  const { base, input: request } = input;
  const { modelScope: _scope, autoPick: _autoPick, ...rest } = input.endpoint;
  const autoPick =
    request.autoPick === undefined ? (base?.autoPick ?? []) : validateAutoPick(request.autoPick);
  const endpoint: StoredApiEndpoint = {
    ...rest,
    ...(input.modelScope !== undefined ? { modelScope: input.modelScope } : {}),
    ...(autoPick.length > 0 ? { autoPick } : {}),
  };
  if (followsList(endpoint)) {
    const models = vendorServedModels(endpoint);
    const { modelMapping: _mapping, ...unmapped } = endpoint;
    const modelMapping = input.isLegacyForm
      ? keepValidMapping(endpoint.modelMapping, models)
      : validateModelMapping(request.modelMapping, models);
    return { ...unmapped, models, ...(modelMapping ? { modelMapping } : {}) };
  }
  const rulesChanged = !isDeepStrictEqual(autoPick, base?.autoPick ?? []);
  const listedBefore = new Set((base?.catalog?.models ?? []).map((model) => model.id));
  let isNew: ((modelId: string) => boolean) | null = null;
  if (rulesChanged) isNew = () => true;
  else if (request.catalog !== undefined) isNew = (modelId) => !listedBefore.has(modelId);
  return settleServedModels(endpoint, isNew);
}

function validateAutoPick(raw: string[]): string[] {
  const cleaned = cleanAutoPickRules(raw);
  if (!cleaned.ok) {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message: `"${cleaned.rule}" ${AUTO_PICK_PROBLEM_MESSAGES[cleaned.problem]}`,
      // app 按 problem 用界面语言说明。
      params: { rule: cleaned.rule, problem: cleaned.problem },
    });
  }
  return cleaned.rules;
}

const AUTO_PICK_PROBLEM_MESSAGES: Record<AutoPickRuleProblem, string> = {
  not_rule: "is a model's id, not a rule: a rule has a * in it, or starts with re:",
  empty_regex: "has no regular expression after re:",
  invalid_regex: "is not a regular expression RE2 can read",
};

/** 添加窗口里保存前拉到的清单：拉取时间记为保存时刻；没给时不写，留下 base 的。 */
function catalogFieldOf(input: {
  requested: ApiEndpointModel[] | undefined;
  timestamp: string;
}): Pick<StoredApiEndpoint, "catalog"> {
  if (input.requested === undefined) return {};
  return { catalog: { fetchedAt: input.timestamp, models: validateModels(input.requested) } };
}

type EndpointFields = Pick<
  StoredApiEndpoint,
  "name" | "baseUrls" | "models" | "modelMapping" | "legacyDefaultModelId" | "manualModels"
>;

/** 新客户端：地址按格式给，模型可以一个都没选，任何格式的接口都能配档位映射。 */
function validateFields(
  rawBaseUrls: ApiEndpointBaseUrl[],
  input: ApiEndpointSaveInput,
): EndpointFields {
  const name = validateName(input.name);
  const baseUrls: StoredApiEndpoint["baseUrls"] = [];
  for (const format of API_ENDPOINT_REQUEST_FORMATS) {
    const entries = rawBaseUrls.filter((entry) => entry.format === format && entry.url.trim());
    if (entries.length > 1) {
      throw new ApiEndpointRequestError({
        code: "invalid_input",
        message: `Only one ${format} base URL is allowed`,
      });
    }
    if (entries[0]) baseUrls.push({ format, url: normalizeBaseUrl(entries[0].url) });
  }
  const unknown = rawBaseUrls.find(
    (entry) => !API_ENDPOINT_REQUEST_FORMATS.some((format) => format === entry.format),
  );
  if (unknown) {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message: `Unknown request format '${unknown.format}'`,
    });
  }
  if (baseUrls.length === 0) {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message: "At least one base URL is required",
    });
  }
  const models = validateModels(input.models);
  const modelMapping = validateModelMapping(input.modelMapping, models);
  return {
    name,
    baseUrls,
    models,
    ...(modelMapping ? { modelMapping } : {}),
    // 带了（哪怕是空数组）就整份替换。
    ...(input.manualModels ? { manualModels: validateModels(input.manualModels) } : {}),
  };
}

/**
 * 老客户端：baseUrl 落进该 Agent 自己的格式，其它格式的地址保留；默认模型必填且是模型之一，
 * 记作老表单为这家选的默认模型。Codex 的老表单没有档位映射，保留这家已有的映射。
 */
function validateLegacyFields(
  provider: ApiEndpointProvider,
  input: ApiEndpointSaveInput,
  existing: StoredApiEndpoint | null,
): EndpointFields {
  const name = validateName(input.name);
  if (input.baseUrl === undefined || input.defaultModelId === undefined) {
    throw new ApiEndpointRequestError({ code: "invalid_input", message: "Base URL is required" });
  }
  const url = legacyAgentBaseUrl(provider, normalizeBaseUrl(input.baseUrl));
  const format = AGENT_REQUEST_FORMAT[provider];
  const others = (existing?.baseUrls ?? []).filter((entry) => entry.format !== format);
  const baseUrls = API_ENDPOINT_REQUEST_FORMATS.flatMap((candidate) => {
    if (candidate === format) return [{ format, url }];
    return others.filter((entry) => entry.format === candidate);
  });
  const models = validateModels(input.models);
  if (models.length === 0) {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message: "At least one model is required",
    });
  }
  const defaultModelId = input.defaultModelId.trim();
  if (!models.some((model) => model.id === defaultModelId)) {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message: "The default model must be one of the models",
    });
  }
  let modelMapping: ApiEndpointModelMapping | undefined;
  if (apiEndpointHasModelMapping(provider)) {
    modelMapping = validateModelMapping(input.modelMapping, models);
  } else if (input.modelMapping && validateModelMapping(input.modelMapping, models)) {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message: "Only Claude endpoints have model mapping",
    });
  } else {
    modelMapping = keepValidMapping(existing?.modelMapping, models);
  }
  return {
    name,
    baseUrls,
    models,
    ...(modelMapping ? { modelMapping } : {}),
    legacyDefaultModelId: defaultModelId,
  };
}

function validateName(raw: string): string {
  const name = raw.trim();
  if (!name) {
    throw new ApiEndpointRequestError({ code: "invalid_input", message: "Name is required" });
  }
  return name;
}

function validateModels(raw: ApiEndpointModel[]): ApiEndpointModel[] {
  const models: ApiEndpointModel[] = [];
  for (const model of raw) {
    const id = model.id.trim();
    if (!id || models.some((existing) => existing.id === id)) continue;
    const label = model.label?.trim();
    models.push(label ? { id, label } : { id });
  }
  return models;
}

/** 每档只能是勾选的模型之一；空白档位视为不映射。 */
function validateModelMapping(
  raw: ApiEndpointModelMapping | undefined,
  models: ApiEndpointModel[],
): ApiEndpointModelMapping | undefined {
  const mapping: ApiEndpointModelMapping = {};
  for (const tier of API_ENDPOINT_MODEL_TIERS) {
    const modelId = raw?.[tier]?.trim();
    if (!modelId) continue;
    if (!models.some((model) => model.id === modelId)) {
      throw new ApiEndpointRequestError({
        code: "invalid_input",
        message: `The ${tier} mapping must be one of the models`,
      });
    }
    mapping[tier] = modelId;
  }
  return Object.keys(mapping).length === 0 ? undefined : mapping;
}

function requireFormat(format: string): ApiEndpointRequestFormat {
  const known = API_ENDPOINT_REQUEST_FORMATS.find((candidate) => candidate === format);
  if (!known) {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message: `Unknown request format '${format}'`,
    });
  }
  return known;
}

/**
 * fetchUpstreamModels 按 provider 决定认证头：Anthropic 地址两种都带（照 claude），
 * OpenAI 两种只带 Bearer（照 codex）。
 */
function providerWithListingHeaders(format: ApiEndpointRequestFormat): ApiEndpointProvider {
  return format === "anthropic_messages" ? "claude" : "codex";
}

const CODEX_CLI_VERSION_TTL_MS = 10 * 60_000;

/** 没有 Codex 样本时取版本的两个来源：本机 CLI（缺省不问）与中转站见过的（缺省是空的）。 */
function codexVersionSources(options: ApiEndpointServiceOptions): {
  readCli: (() => Promise<string | null>) | null;
  seen: SeenCodexVersion;
} {
  return {
    readCli: options.readCodexCliVersion ?? null,
    seen: options.codexSeenVersion ?? new SeenCodexVersion(),
  };
}

/** 测试模型的限值与计时器：没给的用缺省（并发 4、单个 20 秒、整批 3 分钟，真的计时器）。 */
function modelTestSetup(options: ApiEndpointServiceOptions): {
  limits: ModelTestLimits;
  timers: UsagePricingTimers;
} {
  const limits = { ...MODEL_TEST_DEFAULTS, ...options.modelTests };
  const timers = options.modelTestTimers ?? REAL_PRICING_TIMERS;
  return { limits, timers };
}

/**
 * 测一个模型时按先后试的格式与地址：设了「只用这种格式」且还有那种地址时只有它（同中转站）；否则这家给它的格式按地址顺序，
 * 上游清单说它在哪几种格式上的先问那几种，没说时 Claude 模型先问 Anthropic（magpie testOne 挑格式的先后）。
 */
function testAttempts(input: { endpoint: StoredApiEndpoint; modelId: string }): ModelTestAttempt[] {
  const { endpoint, modelId } = input;
  const pin = pinnedFormat({
    settings: endpoint.modelSettings,
    modelId,
    baseUrls: endpoint.baseUrls,
  });
  const formats =
    pin.kind === "pinned"
      ? [pin.format]
      : servedFormats({
          templateId: endpoint.templateId,
          baseUrls: endpoint.baseUrls,
          model: modelId,
        });
  const listedOn = endpoint.catalog?.models.find((model) => model.id === modelId)?.formats ?? [];
  let preferred: string[] = listedOn;
  if (preferred.length === 0) preferred = isClaudeModel(modelId) ? ["anthropic_messages"] : [];
  const ordered = [
    ...formats.filter((format) => preferred.includes(format)),
    ...formats.filter((format) => !preferred.includes(format)),
  ];
  return ordered.flatMap((format) => {
    const url = endpoint.baseUrls.find((entry) => entry.format === format)?.url;
    return url === undefined ? [] : [{ format, baseUrl: url.replace(/\/+$/, "") }];
  });
}

/** 按格式测试的结论换成测试连接的结果；没收到响应的是连不上。 */
function testResultOf(
  detection: ApiEndpointFormatDetection,
  durationMs: number,
): ApiEndpointTestConnectionResult {
  const { httpStatus: status, message } = detection;
  if (detection.status === "ok") return { ok: true, status, durationMs, error: null };
  // 这家的请求头发不出去：原因码照带，界面按语言说。
  if (detection.code === "invalid_header") {
    const error: ApiEndpointError = { code: detection.code, message: message ?? "" };
    if (detection.params !== undefined) error.params = detection.params;
    return { ok: false, status, durationMs, error };
  }
  let code: "auth_failed" | "upstream_unreachable" | "upstream_error" = "upstream_error";
  if (detection.status === "auth_failed") code = "auth_failed";
  else if (status === null) code = "upstream_unreachable";
  return { ok: false, status, durationMs, error: { code, message: message ?? "" } };
}

/** 拉模型、测试时一种格式的地址：Azure 模板的先放到资源的 v1 API 上（同保存时），再去掉末尾斜杠。 */
function upstreamBaseUrl(input: {
  place: TemplatePlace;
  format: ApiEndpointRequestFormat | null;
  raw: string;
}): string {
  const { place, format, raw } = input;
  if (format === null) return normalizeBaseUrl(raw);
  return normalizeBaseUrl(templateBaseUrl({ templateId: place.templateId, format, url: raw }));
}

/** 去掉末尾斜杠，和 CLI 自己拼路径的方式一致。 */
function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!URL.canParse(trimmed)) {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message: "Base URL is not a valid URL",
    });
  }
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message: "Base URL must start with http:// or https://",
    });
  }
  return trimmed.replace(/\/+$/, "");
}

/** 读不懂的配置文件：路径、解析器原文；settings.json 另有结构化的原因。 */
interface UnparsableFile {
  filePath: string;
  detail: string;
  reason?: ClaudeSettingsUnparsableReason;
}

function unparsable(file: UnparsableFile): ApiEndpointRequestError {
  return new ApiEndpointRequestError({
    code: "config_unparsable",
    message: `${file.filePath} could not be parsed, so nothing was written: ${file.detail}`,
    params: unparsableParams(file),
  });
}

/** shell 来源另给 daemon 的系统：修复步骤在 Windows 上讲系统的环境变量。 */
function cloudSwitchIssue(finding: ClaudeCloudSwitchFinding): AgentIssue {
  const { source, file, key, cloud } = finding;
  const where = file ?? "your shell's environment";
  const location: Record<string, string> =
    file === null ? { platform: process.platform } : { file };
  return {
    code: "cloud_switch_on",
    params: { source, key, cloud, ...location },
    message: `${key} is set in ${where}, so Claude Code sends its requests to ${cloud}, not to the gateway: take it out there to go through the gateway`,
  };
}

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

function unparsableStatus(file: UnparsableFile): ApiEndpointFileStatus {
  const message = `${file.filePath} could not be parsed: ${file.detail}`;
  return {
    health: [{ code: "config_unparsable", message }],
    issues: [{ code: "config_unparsable", params: unparsableParams(file), message }],
    baseUrl: null,
  };
}

/** file、detail（解析器原文）；settings.json 另给 reason 与它的参数，app 据此用界面语言说明。 */
function unparsableParams({ filePath, detail, reason }: UnparsableFile): Record<string, string> {
  const params: Record<string, string> = { file: filePath, detail };
  if (reason === undefined) return params;
  params.reason = reason.code;
  if (reason.code === "syntax") {
    params.line = String(reason.line);
    params.column = String(reason.column);
  }
  if (reason.code === "key_not_object" || reason.code === "key_not_array") params.key = reason.key;
  return params;
}

function notThroughGatewayIssues(
  provider: ApiEndpointProvider,
  filePath: string,
  modifiedKeys: string[],
): AgentIssue[] {
  const keys = modifiedKeys.filter((key) => {
    const isRoutingKey = ROUTING_KEYS[provider].includes(key);
    const isCodexMirrorAddress = provider === "codex" && isCodexMirrorKey(key);
    return isRoutingKey || isCodexMirrorAddress;
  });
  if (keys.length === 0) return [];
  const changed = keys.join(", ");
  return [
    {
      code: "not_through_gateway",
      params: { file: filePath, keys: changed },
      message: `${AGENT_NAMES[provider]} no longer goes through the gateway: ${changed} in ${filePath} changed outside Osuna`,
    },
  ];
}

const CLAUDE_TOKEN_KEY = "env.ANTHROPIC_AUTH_TOKEN";

/** 口令被外部改了之后：仍算被改过的负责键、算「不再经过中转站」的键，以及保留 claude.ai 登录的不一致。 */
interface ClaudeTokenFinding {
  modifiedKeys: string[];
  routingKeys: string[];
  issue: AgentIssue | null;
}

/**
 * 照 magpie 的 Check（claude.go）看口令：保留 claude.ai 登录开着却填回了口令，或关着口令却是空的、没了，
 * 各报一条，不算「不再经过中转站」（中转站照收，只是带的凭证不对）。开着、口令没了正是要的样子，不算被改。
 * 地址也被改了时只报「不再经过中转站」。
 */
function claudeTokenFinding(input: {
  modifiedKeys: string[];
  authToken: ClaudeAuthTokenState;
  keepsClaudeAiLogin: boolean;
  filePath: string;
}): ClaudeTokenFinding {
  const { modifiedKeys, authToken, filePath } = input;
  const unchanged = { modifiedKeys, routingKeys: modifiedKeys, issue: null };
  const isTokenChanged = modifiedKeys.includes(CLAUDE_TOKEN_KEY);
  const isAddressChanged = modifiedKeys.includes("env.ANTHROPIC_BASE_URL");
  if (!isTokenChanged || isAddressChanged) return unchanged;
  const otherKeys = modifiedKeys.filter((key) => key !== CLAUDE_TOKEN_KEY);
  const where = `Claude Code's ANTHROPIC_AUTH_TOKEN (${filePath})`;
  if (input.keepsClaudeAiLogin) {
    if (authToken !== "set")
      return { modifiedKeys: otherKeys, routingKeys: otherKeys, issue: null };
    return {
      modifiedKeys,
      routingKeys: otherKeys,
      issue: {
        code: "claude_ai_login_token_set",
        params: { file: filePath },
        message: `${where} is set, so Claude Code sends the gateway that key, not its claude.ai sign-in as Osuna set it`,
      },
    };
  }
  if (authToken === "set") return unchanged;
  const how = authToken === "empty" ? "empty" : "gone";
  return {
    modifiedKeys,
    routingKeys: otherKeys,
    issue: {
      code: "claude_ai_login_token_empty",
      params: { file: filePath, how: authToken },
      message: `${where} is ${how}, so Claude Code sends the gateway its claude.ai sign-in, if it has one, not the gateway's token. To keep it so, turn on Keep claude.ai sign-in`,
    },
  };
}

/** 「被绕过」的提示；英文照 magpie 的说明，时间是 daemon 本地的时:分。 */
function bypassedIssue(input: { agent: string; bypass: CliBypass }): AgentIssue {
  const { agent, bypass } = input;
  const at = bypass.at.toISOString();
  const clock = bypass.at.toTimeString().slice(0, 5);
  switch (bypass.how) {
    case "used":
      return {
        code: "bypassed",
        params: { how: "used", at },
        message: `${agent} was used at ${clock} but none of its requests reached Osuna — one started before Osuna set it up still runs on its old config: apply again, then restart it`,
      };
    case "elsewhere":
      return {
        code: "bypassed",
        params: { how: "elsewhere", at, host: bypass.host },
        message: `${agent}'s last request (${clock}) went to ${bypass.host}, not to Osuna — it was started before Osuna set it up and still runs on its old config: apply again, then quit and reopen it`,
      };
    case "refused":
      return {
        code: "bypassed",
        params: { how: "refused", at },
        message: `${agent} couldn't reach Osuna at ${clock} — Osuna wasn't running then, so it has none of the API endpoints' models: apply again, then quit and reopen it`,
      };
  }
}

function modifiedExternallyIssues(filePath: string, keys: string[]): HealthIssue[] {
  if (keys.length === 0) return [];
  return [
    {
      code: "modified_externally",
      message: `${filePath} was changed outside Osuna: ${keys.join(", ")}`,
    },
  ];
}

/** 有 Agent 用得上模型资料（Claude Code 或 Codex 的总开关开着）：models.dev 才允许下载。 */
function usesModelFacts(state: ApiEndpointState | null): boolean {
  return state !== null && (state.agents.claude.enabled || state.agents.codex.enabled);
}

/** 接管记录是 ChatGPT 登录的接法：Osuna 写了 openai_base_url。 */
function isChatGptWiring(takeover: CodexConfigTakeover | null): boolean {
  return typeof takeover?.keys.openai_base_url?.written === "string";
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export interface ImportedEndpointRef {
  endpointId: string;
  name: string;
}

/**
 * 这次导入一出错就停下：加好的那几家，与出错的那条（指纹对不上时为 null）和原因。
 */
export interface ImportOutcome {
  imported: ImportedEndpointRef[];
  failed: { fingerprint: string; name: string } | null;
  error: ApiEndpointRequestError | null;
}

/** 一条怎么进来：替换名称撞上的那家，或用某个名称新增一家。 */
type ImportAction = { kind: "replace" } | { kind: "add"; name: string };

/**
 * 这条怎么进来：替换，或用某个名称新增。改名后新增的名称是空的（或就是原名）当没改名，按新增（magpie 的 pk.Name）。
 */
function importActionOf(input: {
  pick: ApiEndpointImportPick;
  found: FoundEndpoint;
}): ImportAction {
  const { pick, found } = input;
  const action = API_ENDPOINT_IMPORT_ACTIONS.find((candidate) => candidate === pick.action);
  if (action === undefined) {
    throw new ApiEndpointRequestError({
      code: "invalid_input",
      message: `Unknown import action '${pick.action}'`,
    });
  }
  const renamed = action === "rename" ? (pick.name?.trim() ?? "") : "";
  if (renamed !== "" && renamed !== found.name) return { kind: "add", name: renamed };
  if (action === "replace") return { kind: "replace" };
  return { kind: "add", name: found.name };
}

/** 解析导入链接，拒收时换成 import_link_refused（params.reason 加上拒收的参数，从不带 key）。 */
function parsedImportLinkOrRefuse(link: string): ParsedImportLink {
  try {
    return parseImportLink(link);
  } catch (error) {
    if (!(error instanceof ImportLinkRefusedError)) throw error;
    throw new ApiEndpointRequestError({
      code: "import_link_refused",
      message: error.message,
      params: { ...error.params, reason: error.reason },
    });
  }
}

/**
 * 导入链接会替换的那家（照 magpie Find(id)）：先找标识就是链接标识的，再找名称（不分大小写）就是链接标识的。
 * 只看链接的名称不算：name=DeepSeek&id=my-ds 是新的一家，不替换用户的 DeepSeek。magpie 还认改过的旧 id，
 * Osuna 的标识建好就锁定，没有旧 id。没有为 null。
 */
function importLinkTarget(input: {
  endpoints: readonly StoredApiEndpoint[];
  parsed: ParsedImportLink;
}): StoredApiEndpoint | null {
  const { endpoints, parsed } = input;
  const byId = endpoints.find((endpoint) => endpoint.slug === parsed.identity);
  if (byId !== undefined) return byId;
  const byName = endpoints.find((endpoint) => endpoint.name.toLowerCase() === parsed.identity);
  return byName ?? null;
}

function importGone(): ApiEndpointRequestError {
  return new ApiEndpointRequestError({
    code: "import_gone",
    message: "The scan is out of date: that entry changed or is no longer in its app. Scan again",
  });
}

/** 替换只给名称撞上的那家（magpie 只让 taken 的替换）；那家已经不在了按来源变了处理。 */
function replaceTargetIndex(input: {
  entry: SettledEntry;
  endpoints: readonly StoredApiEndpoint[];
}): number {
  const { entry } = input;
  if (entry.status !== "name_taken" || entry.existing === null) {
    throw new ApiEndpointRequestError({
      code: "import_cannot_replace",
      message: `${entry.name} doesn't share a name with an endpoint you have: add it instead`,
      params: { name: entry.name },
    });
  }
  const existingId = entry.existing.id;
  const index = input.endpoints.findIndex((endpoint) => endpoint.id === existingId);
  if (index === -1) throw importGone();
  return index;
}

/**
 * 导进来的那家（magpie 的 Save 整个换上）：kept 是保留的 id、标识与创建时间（替换时是原来那家的）。
 * 带了模型的只用这几个（「只用挑选的」），没带的跟随接口清单，和新建的一样；开着。
 */
function importedEndpoint(input: {
  found: FoundEndpoint;
  name: string;
  kept: Pick<StoredApiEndpoint, "id" | "slug" | "createdAt">;
  timestamp: string;
  icon: string | null;
}): StoredApiEndpoint {
  const { found, kept } = input;
  const templateId = found.templateId ?? undefined;
  const models = found.models.map((id) => ({ id }));
  const scope: Pick<StoredApiEndpoint, "modelScope" | "manualModels"> =
    models.length > 0 ? { modelScope: "picked", manualModels: models } : { modelScope: "vendor" };
  // 导入链接给的图标（只给「自定义」加的）；没有即用默认的。
  const iconField: Pick<StoredApiEndpoint, "icon"> = {};
  if (input.icon !== null) iconField.icon = input.icon;
  return {
    id: kept.id,
    slug: kept.slug,
    name: input.name,
    baseUrls: templateBaseUrls({ templateId, baseUrls: found.baseUrls }),
    models,
    ...scope,
    enabled: true,
    ...(templateId !== undefined ? { templateId } : {}),
    ...(found.region !== null ? { region: found.region } : {}),
    ...(found.headers !== null ? { headers: found.headers } : {}),
    ...iconField,
    createdAt: kept.createdAt,
    updatedAt: input.timestamp,
  };
}

function maskedKeyOf(key: string | null): string | null {
  if (key === null) return null;
  return maskApiKey(key);
}

function wireImportItem(entry: SettledEntry): ApiEndpointImportItem {
  const found = entry.found;
  return {
    fingerprint: entry.fingerprint,
    ref: entry.ref,
    from: entry.from,
    name: entry.name,
    baseUrls: found?.baseUrls ?? [],
    maskedKey: maskedKeyOf(found?.key ?? null),
    models: found?.models ?? [],
    templateId: found?.templateId ?? null,
    status: entry.status,
    existingEndpointId: entry.existing?.id ?? null,
    existingName: entry.existing?.name ?? null,
    otherKeyName: entry.otherKey?.name ?? null,
    skip: entry.skip,
    off: entry.off,
  };
}
