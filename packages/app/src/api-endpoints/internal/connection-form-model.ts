// 添加窗口的逐个模型识别、自选图标与粘贴 curl移植自 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的 detectAPIs、iconPicker、curlOf、respellURL、fromCurl）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import {
  API_ENDPOINT_REQUEST_FORMATS,
  type ApiEndpoint,
  type ApiEndpointDetectFormatsRequest,
  type ApiEndpointFetchModelsRequest,
  type ApiEndpointFormatDetection,
  type ApiEndpointModel,
  type ApiEndpointModelDetection,
  type ApiEndpointRequestFormat,
  type ApiEndpointSaveRequest,
  type ApiEndpointTemplate,
  type ApiEndpointTemplateRegion,
  type ApiEndpointTestConnectionRequest,
  type ApiEndpointCheckBalanceRequest,
  type ApiEndpointBalanceReading,
  type ApiEndpointTestConnectionResult,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import equal from "fast-deep-equal";
import { curlOf, type CurlCommand } from "./curl-command";
import { isRequestFormat } from "@getpaseo/protocol/api-endpoint/model-settings";
import { withModelFormat } from "./model-settings-form";
import { siteChoicesOf, type TemplateSiteChoice } from "./templates";
import {
  isThirdPartyAnthropicUrl,
  keyHeaderOf,
  takesInsecureTls,
  type ApiEndpointKeyHeader,
  type HeaderProblem,
} from "@getpaseo/protocol/api-endpoint/request-extras";
import {
  extraBodyOf,
  extraBodyTextOf,
  headerHintsLeft,
  headerRowsOf,
  headerRowsProblem,
  headersToSave,
  minifiedJson,
  prettyJson,
  type ExtraBodyTextProblem,
  type HeaderRow,
} from "./request-extras-form";
import {
  cooldownFieldsOf,
  cooldownFieldsRead,
  hasCooldownSettings,
  type CooldownFieldsRead,
  type QuotaRestMode,
} from "./cooldown-settings-form";
import type { CooldownSettingsProblem } from "@getpaseo/protocol/api-endpoint/cooldown-settings";
import {
  balanceFieldPlaceholder,
  balanceFieldsOf,
  balanceFixOf,
  balanceSettingsOf,
  balanceTokenRequest,
  fieldAfterUsing,
  hasBalanceSettings,
  type BalanceCheck,
  type BalanceFields,
  type BalanceFix,
} from "./balance-settings-form";

/*
 * 第三方接口「添加 / 编辑连接」弹窗的表单模型：纯 TypeScript，无 React（docs/forms.md）。
 * 只管连接：名称、一把 key、自动检测用的地址、三种格式的地址；模型在详情页挑（新建或复制「自定义」时粘贴 curl 带来的除外），编辑时原样带回。
 * key 框从空开始：留空提交就不带 apiKey，daemon 保留原 key；自动检测同理带 endpointId。
 * 主机声明了 apiEndpointManagement 时 key 选填：没 key 也能检测、保存，daemon 不带认证头；老主机仍要 key。
 * 同样只在这种主机上：「复制」以原来那家开一个新建表单（key 留空即沿用它的，daemon 拷），key 框旁有「显示」，
 * 编辑时按它读回已存 key 的原文放进框里；读回来的不算新 key，改了才算（照 magpie）。
 * 从模板（Template）添加时名称与各格式地址按模板填好，不用自动检测；有区域或套餐的可切换，新建时国际站与中国站也可切换，
 * 切换只保留 key（照 magpie：切区域保留名称，切站点连名称一起换）。编辑从模板加的接口时同样能切区域或套餐。
 * 要填用户自己资源地址的模板（Azure OpenAI，endpointExample）没有地址：表单只要一个资源地址，原样当 Chat 与
 * Responses 的地址保存，daemon 把它放到资源的 v1 API 上（照 magpie 编辑窗口的 Endpoint 框）。
 * 本机服务的模板（分组 local）只要一个服务地址：改它只换各格式地址的协议、主机、端口，路径不变；留空或没改就用原来的地址
 * （照 magpie local_address.go 与编辑窗口的 Address 框）。
 * 往地址框或 key 框粘贴服务商文档里的 curl 命令（同样只在这种主机上）照 magpie fromCurl 填表：「自定义」填地址（按 URL
 * 结尾认出的那种格式）和 key，新建或复制时再把正文里的模型加进「模型」；模板只取 key。粘贴后的提示条说取了什么、URL 结尾认不出、
 * 地址里还有占位符、key 只是占位符；没取到 key 时把焦点移到 key 框。
 * 「自定义」加的接口可选图标（只在声明了 apiEndpointManagement 的主机上）：内置图标名，本机一张图片（先经 storeIcon
 * 存到主机上），或从地址所在网站取（fetchSiteIcon，主机找到后同样存下）；保存时带主机给的值。图标没改时保存不带它，由 daemon 保留（复制时由 daemon 从原来那家拷）。
 * 自动检测照 magpie Detect：每种格式一行耗时或错误，「采用这些」才把通了的地址填进去，没在那里找到（404 / 405）的清掉。
 * 「逐个模型」（同样只在这种主机上，照 magpie Each picked model）：表单里的模型（前 30 个）在每种格式上各问一次，逐个模型列出；
 * 编辑时「采用这些」还把只在一种格式上答上的模型设成只用这种格式，随保存生效（新建的在保存后到模型设置里设，同 magpie）。
 * 保存前检查（同样只在这种主机上）：自动检测可填试用的模型，不填时从表单里的模型挑；「测试连接」按表单里的各格式地址、
 * 模板与区域逐格式发最小请求；添加时「拉取模型」用表单的值向上游拉清单预览、点选进「模型」，保存时清单随之写入（照 magpie
 * addFormModels）。三样都只看不存，带的 endpointId 只为借已存的 key。
 */

export type ConnectionFormSeed =
  // templateId 为 null 是「自定义」；「再加一家」用那家的模板。认不出的模板按「自定义」开。
  | { mode: "create"; templateId: string | null }
  // focus：从详情页「填写余额查询地址」打开，展开「高级」并把光标放在余额查询地址上。
  | { mode: "edit"; endpoint: ApiEndpoint; focus?: "balance" }
  // name 是调用方按界面语言起好的「原名 副本」；重名由 daemon 避让。
  | { mode: "duplicate"; source: ApiEndpoint; name: string };

// provider 由调用方补上：接口是主机共用的，按哪个 provider 存都一样。
export type ConnectionSaveRequest = Omit<ApiEndpointSaveRequest, "type" | "requestId" | "provider">;

export type ConnectionSaveResult =
  | { status: "saved"; endpointId: string }
  | { status: "failed"; message: string };

/**
 * 换图标失败的原因：前五种是 daemon 的错误码（太大的图片在发出前就由表单拦下），界面按语言说明；
 * failed 是别的（断线、主机的其他错误），照 message 显示。
 */
export type ConnectionIconErrorCode =
  | "icon_too_large"
  | "icon_not_image"
  | "site_icon_no_address"
  | "site_icon_local"
  | "site_icon_not_found"
  | "failed";

export const CONNECTION_ICON_ERROR_CODES: readonly ConnectionIconErrorCode[] = [
  "icon_too_large",
  "icon_not_image",
  "site_icon_no_address",
  "site_icon_local",
  "site_icon_not_found",
];

export interface ConnectionIconError {
  code: ConnectionIconErrorCode;
  // daemon 的原文（英文）：failed 时显示，site_icon_not_found 时附在后面说明问过哪里。
  message: string;
}

// 存图片或从网站取图标的结果。
export type ConnectionIconResult =
  | { status: "stored"; icon: string }
  | { status: "failed"; error: ConnectionIconError };

// 正在换图标：存本机的图片，或从网站取。
export type ConnectionIconTask = "picture" | "website";

/** 主机最多存这么大的图片（daemon endpoint-icons.ts 的 MAX_ICON_BYTES）；更大的不发过去。 */
export const MAX_ICON_BYTES = 1 << 20;

export type ConnectionRevealKeyResult =
  | { status: "revealed"; apiKey: string | null }
  | { status: "failed"; message: string };

// 读回账户令牌原文：没存令牌时 value 为 null。
export type ConnectionRevealSecretResult =
  | { status: "revealed"; value: string | null }
  | { status: "failed"; message: string };

export type ConnectionDetectRequest = Omit<ApiEndpointDetectFormatsRequest, "type" | "requestId">;

// failed：请求本身没成立（缺 key、地址无效、断线）；每种格式的失败在 done 的 results 里。
// models 是逐个模型识别的逐个模型结论，别的检测为 null。
export type ConnectionDetectResult =
  | {
      status: "done";
      results: ApiEndpointFormatDetection[];
      models: ApiEndpointModelDetection[] | null;
    }
  | { status: "failed"; message: string }
  | { status: "cancelled" };

// provider 由调用方补上，同 ConnectionSaveRequest。
export type ConnectionFetchRequest = Omit<
  ApiEndpointFetchModelsRequest,
  "type" | "requestId" | "provider"
>;

export type ConnectionFetchResult =
  | { status: "done"; models: ApiEndpointModel[] }
  | { status: "failed"; message: string }
  | { status: "cancelled" };

export type ConnectionTestRequest = Omit<
  ApiEndpointTestConnectionRequest,
  "type" | "requestId" | "provider"
>;

// failed：请求本身没成立（断线、主机拒收）；上游的结论（含失败）在 done 的 result 里。
export type ConnectionTestResult =
  | { status: "done"; result: ApiEndpointTestConnectionResult }
  | { status: "failed"; message: string }
  | { status: "cancelled" };

// 「查询余额」：表单里还没保存的余额设置、key、地址与请求头。
export type ConnectionBalanceCheckRequest = Omit<
  ApiEndpointCheckBalanceRequest,
  "type" | "requestId"
>;

// failed：请求本身没成立（断线、主机拒收）；查不到余额写在 done 的读数里。
export type ConnectionBalanceCheckResult =
  | { status: "done"; reading: ApiEndpointBalanceReading }
  | { status: "failed"; message: string }
  | { status: "cancelled" };

// 一种格式的检测结论。
export type FormatDetectionLabel = "ok" | "not_detected" | "auth_failed";

/** 自动检测的一行：这种格式的建议地址、结论、HTTP 状态、原因、耗时与问的模型（老主机不给后两样）。 */
export interface DetectedFormat {
  format: ApiEndpointRequestFormat;
  url: string;
  label: FormatDetectionLabel;
  httpStatus: number | null;
  message: string | null;
  durationMs: number | null;
  modelId: string | null;
  // daemon 自己定的原因（逐个模型识别），界面按语言说；上游的失败与认不出的原因为 null，照 message 显示。
  reason: DetectionReason | null;
}

export type DetectionReason =
  | { code: "upstream_timeout"; seconds: string }
  | { code: "upstream_unreachable" | "models_list_failed"; detail: string }
  | { code: "wrong_shape"; format: string }
  | { code: "batch_timeout" }
  | { code: "not_asked" }
  | { code: "image_model" }
  | { code: "no_model_to_try" }
  // 这家的请求头发不出去（name 是头名，headerReason 是名字不合法还是值里有换行）。
  | { code: "invalid_header"; name: string; headerReason: "name" | "value" };

/**
 * 最近一次自动检测：每种格式一行；isTaken 是已按它「采用这些」。
 * noneAnswered：一种都没通时的提示——没有 key（没打、也没存）时 keyless，否则 check（照 magpie noneAnswered）。
 * waitsForTake：还一个地址都没有、要先「采用这些」才能保存（magpie 的地址框就是检测的那个，不会卡在这里，Osuna 要说一句）。
 */
export interface ConnectionDetection {
  results: DetectedFormat[];
  // 逐个模型识别：每个模型一行，各格式一格（按 Anthropic → Chat → Responses）；别的检测为 null。
  byModel: ModelDetectionRow[] | null;
  // 表单里的模型比问了的多：只问了前 asked 个。
  askedOnlyFirst: { asked: number; picked: number } | null;
  // 逐个模型识别后「采用这些」会设成只用这种格式的模型（编辑时，只在一种格式上答上的）。
  singleFormatPins: ModelFormatPin[];
  isTaken: boolean;
  // 「只在 {格式} 上问 {模型}」：编辑时试的是这家的模型、只有部分格式通了才有（照 magpie）；staged 是保存时要设的格式。
  onlyChoices: ConnectionOnlyChoices | null;
  canTake: boolean;
  waitsForTake: boolean;
  noneAnswered: "keyless" | "check" | null;
}

export interface ModelDetectionRow {
  modelId: string;
  cells: DetectedFormat[];
}

export interface ModelFormatPin {
  modelId: string;
  format: ApiEndpointRequestFormat;
}

export interface ConnectionOnlyChoices {
  modelId: string;
  formats: ApiEndpointRequestFormat[];
  // 保存后这个模型只用的格式；null 为不限（自动）。
  staged: ApiEndpointRequestFormat | null;
  // 和已存的不同，要保存才算。
  isPending: boolean;
}

/** 添加时「拉取模型」：拉到的清单只在表单里，保存时一起写入。 */
export type ConnectionCatalogFetch =
  | { status: "idle" }
  | { status: "fetching" }
  | { status: "failed"; message: string }
  | { status: "fetched"; models: ApiEndpointModel[] };

/** 「测试连接」一种格式的结果。failed 的 status 是 HTTP 状态码，没收到响应为 null。 */
export type FormatTestOutcome =
  | { kind: "testing" }
  | { kind: "ok"; durationMs: number }
  | { kind: "authFailed"; status: number | null; message: string }
  | { kind: "failed"; status: number | null; message: string };

export interface FormatTestRow {
  format: ApiEndpointRequestFormat;
  url: string;
  outcome: FormatTestOutcome;
}

export interface ConnectionFormatField {
  format: ApiEndpointRequestFormat;
  url: string;
  invalid: boolean;
}

export interface ConnectionFormOptions {
  // 主机声明了 apiEndpointManagement：key 可以不填。
  isKeyOptional: boolean;
  // 同上：key 框旁有「显示」，能读回已存的 key。
  canRevealKey: boolean;
  // 同上：「自定义」加的接口能选图标。
  canPickIcon: boolean;
  // 同上：往地址框或 key 框粘贴 curl 命令能填表。
  canPasteCurl: boolean;
  // 同上：保存前能测试连接、添加时能拉模型，自动检测能填试用的模型。
  canCheckBeforeSave: boolean;
  // 同上：新建的接口「跟随接口清单」（服务范围 vendor）；复制的随原来那家，由 daemon 拷。
  followsListWhenNew: boolean;
  // 同上：「高级」里能设请求头、附加请求体、key 放哪个头。
  canSetRequestExtras: boolean;
  // 主机声明了 apiEndpointBalance：「高级」里有余额查询地址、方法、取值写法与「查询余额」。
  canSetBalance: boolean;
  // 主机给的模板清单；老主机没有，为空。
  templates: readonly ApiEndpointTemplate[];
}

/** 表单用的模板：区域或套餐、站点（国际 / 中国，只在新建时）与当前的「去拿 key」页面。 */
export interface ConnectionTemplateState {
  id: string;
  name: string;
  note: string | null;
  keyHint: string | null;
  // 不填 key 也能用（本机服务、免费模型）。
  keyOptional: boolean;
  // 本机服务：表单只要一个服务地址，不列各格式地址。
  asksServiceAddress: boolean;
  // daemon 给的字符串：region（区域）或 plan（套餐）。
  regionLabel: string;
  regions: { id: string; name: string }[] | null;
  regionId: string | null;
  sites: TemplateSiteChoice[] | null;
  keysUrl: string | null;
  // 官网：区域或套餐有自己的文档页时跟着它（照 magpie 编辑窗口顶上的链接）。
  websiteUrl: string | null;
  // 要填自己资源地址的模板：地址框的示例与框下的英文说明；别的模板为 null。
  endpointExample: string | null;
  endpointHint: string | null;
}

/** 粘贴 curl 后填上的一项，按 magpie 的顺序：地址（和它的格式）、key、模型。 */
export type ConnectionCurlFill =
  | { kind: "baseUrl"; format: ApiEndpointRequestFormat }
  | { kind: "apiKey" }
  | { kind: "model"; model: string };

/** 粘贴 curl 后的提示条：四条提示照 magpie，界面按语言拼。 */
export interface ConnectionCurlNote {
  filled: ConnectionCurlFill[];
  // 「自定义」时 URL 不以 /chat/completions、/messages 或 /responses 结尾。
  isEndpointUnknown: boolean;
  // 「自定义」时填上的地址里还没替换的占位符。
  urlPlaceholder: string | null;
  // curl 里的 key 只是占位符时它的原文。
  keyPlaceholder: string | null;
}

/**
 * 一次粘贴 curl 要输入框自己改写的值（输入框不随状态重绘，照 docs/forms.md 用 replaceText）：地址框、「模型」框的新值，
 * 没取到能用的 key 时 key 框要获得焦点。null 是这一框不动。
 */
export interface ConnectionCurlInputs {
  address: string | null;
  modelIds: string[] | null;
  focusesKey: boolean;
}

export interface ConnectionFormState {
  mode: ConnectionFormSeed["mode"];
  // 「自定义」或模板认不出时为 null。
  template: ConnectionTemplateState | null;
  name: string;
  // 换站点改写了名称时加一，名称框据此换成新值。
  nameGeneration: number;
  // 用户打的 key；空即不换（编辑保留原 key，复制沿用原来那家的）。
  apiKey: string;
  // key 框里显示的值与它换值的次数：读回已存的 key 时放进去，再藏起来时清掉；不是用户打的不进 apiKey。
  keyBoxValue: string;
  keyBoxGeneration: number;
  // 编辑时这家已存了 key；复制时原来那家有 key。
  hasSavedKey: boolean;
  canShowKey: boolean;
  isKeyVisible: boolean;
  isRevealingKey: boolean;
  revealError: string | null;
  isKeyOptional: boolean;
  address: string;
  addressInvalid: boolean;
  // 新建或复制时粘贴 curl 加进来、或从拉到的清单点选的模型（可改）；hasModelField 为真时「模型」框显示。
  modelIds: string[];
  // 点选清单改了「模型」时加一，输入框据此换成新值。
  modelIdsGeneration: number;
  hasModelField: boolean;
  curlNote: ConnectionCurlNote | null;
  // 资源地址（template.endpointExample 不为 null 时才用）：就是 Chat 与 Responses 的地址。
  endpoint: string;
  // 服务地址（template.asksServiceAddress 时才用）与它是不是一个地址。
  serviceAddress: string;
  serviceAddressInvalid: boolean;
  // 「自定义」加的接口才能选图标；icon 是选的内置图标名或存下的图片（`file:`），没选为 null。
  canPickIcon: boolean;
  icon: string | null;
  iconTask: ConnectionIconTask | null;
  iconError: ConnectionIconError | null;
  formats: ConnectionFormatField[];
  // 「采用这些」改写了地址栏时加一，输入框据此换成新值。
  urlGeneration: number;
  canCheckBeforeSave: boolean;
  // 自动检测的试用模型（只在 canCheckBeforeSave 时有这一框）。
  detectModel: string;
  detecting: boolean;
  detectError: string | null;
  detection: ConnectionDetection | null;
  // 能点「逐个模型」；点了但表单里还没有模型时 eachNeedsModels 为真，提示先选模型。
  canDetectEach: boolean;
  eachNeedsModels: boolean;
  // 上游拒绝了这把 key（401 / 403）；改 key 之前一直标红。
  keyRejected: boolean;
  canDetect: boolean;
  catalogFetch: ConnectionCatalogFetch;
  canFetchModels: boolean;
  // 测过的格式，按 Anthropic → Chat → Responses。
  tests: FormatTestRow[];
  isTesting: boolean;
  canTest: boolean;
  canSubmit: boolean;
  submitting: boolean;
  submitError: string | null;
  // 「高级」：请求头、附加请求体、key 放哪个头（只在 canSetRequestExtras 时有）。设了任一项时一打开就展开（照 magpie advancedSet）。
  canSetRequestExtras: boolean;
  isAdvancedOpen: boolean;
  headerRows: HeaderRow[];
  // 模板提示的、还没加的请求头名。
  headerHints: string[];
  headerProblem: HeaderProblem | null;
  extraBodyText: string;
  extraBodyProblem: ExtraBodyTextProblem | null;
  keyHeader: ApiEndpointKeyHeader;
  // 只对第三方 Anthropic 地址显示（Anthropic 自己、Bedrock、Azure 的只收一种）。
  showsKeyHeader: boolean;
  // 不校验证书：只对「自定义」、至少一个 https 地址时显示（照 magpie tlsTakes、onHTTPS）。
  showsInsecureTls: boolean;
  insecureTls: boolean;
  // 打开前的确认框开着。
  isConfirmingInsecureTls: boolean;
  // 「高级」里的冷却设置（同 canSetRequestExtras）：额度冷却按分钟或到每天几点，冷却上限的分钟框（空即用中转站自己的），
  // 与「原因不明的失败不冷却」。
  quotaRestMode: QuotaRestMode;
  quotaRestText: string;
  quotaResetAtText: string;
  restCapText: string;
  noFailRest: boolean;
  // 「原因不明不冷却」开着时冷却上限不起作用，不显示（照 magpie 两者是同一项）。
  showsRestCap: boolean;
  // 哪一项不对（分钟数不是 0 到八天的整数、时刻读不懂）；挡住保存。
  cooldownProblem: CooldownSettingsProblem | null;
  // 「高级」里的余额设置（只在 canSetBalance 时有）：余额查询地址、方法、取值写法；占位是按地址给的默认写法。
  canSetBalance: boolean;
  balanceUrlText: string;
  balanceMethod: BalanceFields["balanceMethod"];
  balanceFieldText: string;
  balanceFieldPlaceholder: string;
  balanceCheck: BalanceCheck;
  // 从「填写余额查询地址」打开：光标放在余额查询地址上。
  focusesBalance: boolean;
  // 「改用 …」换了地址与取值写法时加一，框里的字按新值重新带进去。
  balanceUrlGeneration: number;
  balanceFieldGeneration: number;
  balanceUserIdText: string;
  // 账户令牌：存了的打码（移除后为 null），框里显示的字（打的或读回的），显示与读回中的状态。
  balanceTokenMask: string | null;
  hasSavedBalanceToken: boolean;
  balanceTokenBoxValue: string;
  balanceTokenBoxGeneration: number;
  isBalanceTokenVisible: boolean;
  isRevealingBalanceToken: boolean;
  balanceTokenRevealError: string | null;
  // 令牌与地址对不上、缺用户 ID 的提示。
  balanceFix: BalanceFix | null;
}

export interface ConnectionFormDeps {
  save: (request: ConnectionSaveRequest) => Promise<ConnectionSaveResult>;
  detect: (
    request: ConnectionDetectRequest,
    signal: AbortSignal,
  ) => Promise<ConnectionDetectResult>;
  revealKey: (endpointId: string) => Promise<ConnectionRevealKeyResult>;
  storeIcon: (bytes: Uint8Array) => Promise<ConnectionIconResult>;
  fetchSiteIcon: (input: { baseUrl: string; name: string }) => Promise<ConnectionIconResult>;
  fetchModels: (
    request: ConnectionFetchRequest,
    signal: AbortSignal,
  ) => Promise<ConnectionFetchResult>;
  testConnection: (
    request: ConnectionTestRequest,
    signal: AbortSignal,
  ) => Promise<ConnectionTestResult>;
  checkBalance: (
    request: ConnectionBalanceCheckRequest,
    signal: AbortSignal,
  ) => Promise<ConnectionBalanceCheckResult>;
  revealBalanceToken: (endpointId: string) => Promise<ConnectionRevealSecretResult>;
}

export interface ConnectionFormModel {
  getState(): ConnectionFormState;
  subscribe(listener: () => void): () => void;
  setName(value: string): void;
  // 切区域或套餐：各格式地址与「去拿 key」页面跟着换，key 与名称保留。
  setRegion(regionId: string): void;
  // 新建时切国际站 / 中国站：只保留 key，其余按那个模板重来。
  setSite(templateId: string): void;
  setApiKey(value: string): void;
  // 「显示 / 隐藏」：编辑已存了 key、框里没打新的时先读回原文。
  toggleKeyVisible(): void;
  setAddress(value: string): void;
  // 粘贴到地址框或 key 框的文字：是 curl 命令就按它填表并返回 true（调用方据此拦下这次粘贴），否则 false。
  pasteCurl(text: string): boolean;
  // 每次粘贴 curl 填了表之后，告诉各输入框要改写什么。
  subscribeCurlInputs(listener: (inputs: ConnectionCurlInputs) => void): () => void;
  // 「模型」框：逗号或换行分隔的模型 id。
  setModelIds(value: string): void;
  // 拉到的清单上点一个模型：选上或去掉。
  toggleModel(modelId: string): void;
  // 「全选」「选上显示的」与「全不选」。
  pickModels(modelIds: string[]): void;
  unpickModels(modelIds: string[]): void;
  // 添加时「拉取模型」：用表单的值向上游拉，只看不存。
  fetchModels(): void;
  cancelFetchModels(): void;
  // 「测试连接」：表单里每种格式的地址各发一条最小请求。
  testConnection(): void;
  cancelTest(): void;
  // 填自己资源地址的模板：Chat 与 Responses 都用它。
  setEndpoint(value: string): void;
  setUrl(format: ApiEndpointRequestFormat, value: string): void;
  // 本机服务的地址：不写协议按 http，带上的路径不算。
  setServiceAddress(value: string): void;
  // 选内置图标；null 是「默认」（按名称首字）。
  setIcon(icon: string | null): void;
  // 选本机一张图片：先存到主机上，成了才换图标。
  pickIconImage(bytes: Uint8Array): void;
  // 「从网站取图标」：按填的地址找它所在网站的图标（照 magpie）。
  fetchSiteIcon(): void;
  setDetectModel(value: string): void;
  // 「高级」展开或收起。
  toggleAdvanced(): void;
  // 「添加请求头」加一行空的；点模板提示的头时带上它的名字。
  addHeader(name: string | null): void;
  setHeaderName(id: number, value: string): void;
  setHeaderValue(id: number, value: string): void;
  removeHeader(id: number): void;
  // 值框在一行与按 JSON 排版的多行之间切换；收起时压回一行。
  toggleHeaderJson(id: number): void;
  setExtraBody(value: string): void;
  setKeyHeader(value: ApiEndpointKeyHeader): void;
  // 打开先弹确认框（confirmInsecureTls 才真的打开），关掉直接关。
  setInsecureTls(value: boolean): void;
  confirmInsecureTls(): void;
  cancelInsecureTls(): void;
  setQuotaRestMode(value: QuotaRestMode): void;
  setQuotaRest(value: string): void;
  setQuotaResetAt(value: string): void;
  setRestCap(value: string): void;
  setNoFailRest(value: boolean): void;
  setBalanceUrl(value: string): void;
  setBalanceMethod(value: BalanceFields["balanceMethod"]): void;
  setBalanceField(value: string): void;
  setBalanceUserId(value: string): void;
  setBalanceToken(value: string): void;
  toggleBalanceTokenVisible(): void;
  removeBalanceToken(): void;
  // 「改用 …」：把余额查询地址换成账户查询。
  useBalanceUrl(url: string): void;
  // 「查询余额」：用表单里还没保存的值当场查一次；再按一次重来。
  checkBalance(): void;
  detect(): void;
  // 「逐个模型」：表单里的模型（前 30 个）在每种格式上各问一次。
  detectEachModel(): void;
  cancelDetect(): void;
  // 「采用这些」：通了的格式填上建议地址，没在那里找到的（404 / 405）清掉。
  takeDetected(): void;
  // 「只用 {格式} 问 {模型}」：保存时把试的那个模型设成只用这种格式，再点一次取消；这家还没有那种地址时先采用检测到的地址。
  askOnlyOn(format: ApiEndpointRequestFormat): void;
  submit(): Promise<ConnectionSaveResult | null>;
  close(): void;
}

type Urls = Record<ApiEndpointRequestFormat, string>;
type FormatTests = Partial<Record<ApiEndpointRequestFormat, FormatTestOutcome>>;

interface DetectionValues {
  results: DetectedFormat[];
  isTaken: boolean;
  // 这次检测试的模型（自动检测框里打的）；没打为 null。
  askedModel: string | null;
  // 逐个模型识别的结论与当时表单里有几个模型；别的检测为 null。
  each: { rows: ModelDetectionRow[]; picked: number } | null;
}

// 保存时要给各模型设的格式；null 为取消只用这种格式。没列的不动。
type StagedPins = Record<string, ApiEndpointRequestFormat | null>;

// 表单里一种格式要问的地址。
interface CheckedUrl {
  format: ApiEndpointRequestFormat;
  url: string;
}

interface Values {
  template: ApiEndpointTemplate | null;
  regionId: string | null;
  name: string;
  nameGeneration: number;
  apiKey: string;
  keyBoxValue: string;
  keyBoxGeneration: number;
  isKeyVisible: boolean;
  // 框里是读回来的原 key，不是用户打的。
  isKeyRevealed: boolean;
  isRevealingKey: boolean;
  revealError: string | null;
  address: string;
  modelIds: string[];
  modelIdsGeneration: number;
  hasModelField: boolean;
  curlNote: ConnectionCurlNote | null;
  urls: Urls;
  urlGeneration: number;
  detectModel: string;
  detection: DetectionValues | null;
  detecting: boolean;
  detectError: string | null;
  stagedPins: StagedPins;
  eachNeedsModels: boolean;
  catalogFetch: ConnectionCatalogFetch;
  tests: FormatTests;
  serviceAddress: string;
  icon: string | null;
  iconTask: ConnectionIconTask | null;
  iconError: ConnectionIconError | null;
  submitting: boolean;
  submitError: string | null;
  isAdvancedOpen: boolean;
  headerRows: HeaderRow[];
  nextHeaderId: number;
  extraBodyText: string;
  keyHeader: ApiEndpointKeyHeader;
  insecureTls: boolean;
  isConfirmingInsecureTls: boolean;
  quotaRestMode: QuotaRestMode;
  quotaRestText: string;
  quotaResetAtText: string;
  restCapText: string;
  noFailRest: boolean;
  balanceUrlText: string;
  balanceMethod: BalanceFields["balanceMethod"];
  balanceFieldText: string;
  balanceUserIdText: string;
  balanceCheck: BalanceCheck;
  balanceUrlGeneration: number;
  balanceFieldGeneration: number;
  // 打的令牌；读回来没改的不算。
  balanceTokenText: string;
  balanceTokenBoxValue: string;
  balanceTokenBoxGeneration: number;
  isBalanceTokenVisible: boolean;
  isBalanceTokenRevealed: boolean;
  isRevealingBalanceToken: boolean;
  balanceTokenRevealError: string | null;
  balanceTokenRemoved: boolean;
}

// 粘贴的 curl 给「自定义」填的地址与它的格式。
interface CurlBaseUrl {
  format: ApiEndpointRequestFormat;
  url: string;
}

// 什么也没设的「高级」保存时的样子。
const EMPTY_EXTRAS = { headers: {}, extraBody: {}, keyHeader: "both" };

const EMPTY_URLS: Urls = { anthropic_messages: "", openai_chat: "", openai_responses: "" };

export function createConnectionFormModel(
  seed: ConnectionFormSeed,
  deps: ConnectionFormDeps,
  options: ConnectionFormOptions,
): ConnectionFormModel {
  const {
    isKeyOptional,
    canRevealKey,
    canPickIcon,
    canPasteCurl,
    canCheckBeforeSave,
    followsListWhenNew,
    canSetRequestExtras,
    canSetBalance,
    templates,
  } = options;
  // 添加窗口（新建或复制）：能在保存前拉模型，「模型」框一直显示。
  const isAdding = seed.mode !== "edit";
  const listeners = new Set<() => void>();
  const curlInputListeners = new Set<(inputs: ConnectionCurlInputs) => void>();
  // 编辑的这家，或复制的原来那家：没打 key 时检测、保存都用它已存的 key。
  const keyOwner = keyOwnerOf(seed);
  const hasSavedKey = keyOwner?.hasApiKey === true;
  let closed = false;
  // 当前这次自动检测、拉模型、测试连接；取消或重来后，旧请求晚到的结果不再生效。
  let pendingDetect: AbortController | null = null;
  let pendingFetch: AbortController | null = null;
  let pendingTest: AbortController | null = null;
  let pendingBalanceCheck: AbortController | null = null;
  const seededTemplate = templateOf(seed, templates);
  const seededRegion = seededTemplate ? initialRegionOf(seed, seededTemplate) : null;
  const seededUrls = initialUrlsOf({
    keyOwner,
    template: seededTemplate,
    region: seededRegion,
  });
  // 服务地址从开表单时的地址起步，改了才挪这些地址（照 magpie addressFrom / addressWas）。
  const serviceAddressWas = originOf(seededUrls);
  const seededIcon = keyOwner?.icon ?? null;
  const seededCooldown = cooldownFieldsOf(keyOwner?.cooldownSettings);
  const seededBalance = balanceFieldsOf(keyOwner?.balance);
  const savedTokenMask = keyOwner?.balanceTokenMask ?? null;
  const focusesBalance = canSetBalance && seed.mode === "edit" && seed.focus === "balance";
  const hasSeededBalance =
    canSetBalance && (hasBalanceSettings(seededBalance) || savedTokenMask !== null);
  const seededExtras = seededRequestExtras({
    keyOwner,
    isCustom: seededTemplate === null,
    hasCooldownSettings: hasCooldownSettings(seededCooldown),
    opensAdvanced: focusesBalance || hasSeededBalance,
  });
  let values: Values = {
    template: seededTemplate,
    regionId: seededRegion?.id ?? null,
    name: seededTemplate && seed.mode === "create" ? seededTemplate.name : initialNameOf(seed),
    nameGeneration: 0,
    apiKey: "",
    keyBoxValue: "",
    keyBoxGeneration: 0,
    isKeyVisible: false,
    isKeyRevealed: false,
    isRevealingKey: false,
    revealError: null,
    address: API_ENDPOINT_REQUEST_FORMATS.map((format) => seededUrls[format]).find(Boolean) ?? "",
    modelIds: [],
    modelIdsGeneration: 0,
    hasModelField: false,
    curlNote: null,
    urls: seededUrls,
    urlGeneration: 0,
    detectModel: "",
    detection: null,
    detecting: false,
    detectError: null,
    stagedPins: {},
    eachNeedsModels: false,
    catalogFetch: { status: "idle" },
    tests: {},
    serviceAddress: serviceAddressWas,
    icon: seededIcon,
    iconTask: null,
    iconError: null,
    submitting: false,
    submitError: null,
    ...seededExtras,
    // 复制时随原来那家（照 magpie 复制的草稿带 insecureTLS）。
    insecureTls: keyOwner?.insecureTls === true,
    isConfirmingInsecureTls: false,
    ...seededCooldown,
    ...seededBalance,
    balanceCheck: { status: "idle" },
    balanceUrlGeneration: 0,
    balanceFieldGeneration: 0,
    balanceTokenText: "",
    balanceTokenBoxValue: "",
    balanceTokenBoxGeneration: 0,
    isBalanceTokenVisible: false,
    isBalanceTokenRevealed: false,
    isRevealingBalanceToken: false,
    balanceTokenRevealError: null,
    balanceTokenRemoved: false,
  };
  let state = derive(values);
  const extrasAtOpen = extrasNow();
  const cooldownAtOpen = cooldownFieldsRead(seededCooldown);
  const balanceAtOpen = balanceSettingsOf(seededBalance);
  const hasSeededExtras = !equal(extrasAtOpen, EMPTY_EXTRAS);
  // 当前这次换图标；再换一次或关掉表单后，旧请求晚到的结果不再生效。
  let pendingIcon: object | null = null;

  function derive(next: Values): ConnectionFormState {
    const hasKey = isKeyOptional || next.apiKey.trim() !== "" || hasSavedKey;
    const address = next.address.trim();
    const addressInvalid = address !== "" && !isHttpUrl(address);
    const formats = API_ENDPOINT_REQUEST_FORMATS.map((format) => {
      const url = next.urls[format];
      return { format, url, invalid: url.trim() !== "" && !isHttpUrl(url.trim()) };
    });
    const endpoint = next.urls.openai_chat;
    const asksEndpoint = next.template?.endpointExample !== undefined;
    const serviceAddressInvalid = serverOrigin(next.serviceAddress) === null;
    const isIconPickable = canPickIcon && next.template === null;
    // 至少填了一个地址，且填了的都像 http(s) 地址；资源地址只有资源名也行，由 daemon 补全并校验。
    const hasValidUrls = asksEndpoint
      ? endpoint.trim() !== ""
      : formats.some((field) => field.url.trim() !== "") && !formats.some((field) => field.invalid);
    const hasValidAddress = address !== "" && !addressInvalid;
    // 检测、拉模型、保存或存图片进行中时检测与保存都不可点。
    const isFetching = next.catalogFetch.status === "fetching";
    const busy = next.detecting || next.submitting || next.iconTask !== null || isFetching;
    const checks = deriveChecks({
      next,
      hasKey,
      busy,
      serviceAddressInvalid,
      hasValidUrls,
      hasValidAddress,
    });
    const extras = deriveExtras(next);
    const cooldown = deriveCooldown(next);
    return {
      mode: seed.mode,
      template: next.template ? templateStateOf(next.template, next.regionId) : null,
      name: next.name,
      nameGeneration: next.nameGeneration,
      apiKey: next.apiKey,
      keyBoxValue: next.keyBoxValue,
      keyBoxGeneration: next.keyBoxGeneration,
      hasSavedKey,
      canShowKey: canRevealKey,
      isKeyVisible: next.isKeyVisible,
      isRevealingKey: next.isRevealingKey,
      revealError: next.revealError,
      isKeyOptional,
      address: next.address,
      addressInvalid,
      modelIds: next.modelIds,
      modelIdsGeneration: next.modelIdsGeneration,
      curlNote: next.curlNote,
      endpoint,
      serviceAddress: next.serviceAddress,
      serviceAddressInvalid,
      canPickIcon: isIconPickable,
      icon: next.icon,
      iconTask: next.iconTask,
      iconError: next.iconError,
      formats,
      urlGeneration: next.urlGeneration,
      ...checks,
      detecting: next.detecting,
      detectError: next.detectError,
      canDetect: !busy && hasKey && hasValidAddress,
      canSubmit: canSubmitOf({
        next,
        busy,
        hasKey,
        hasValidUrls,
        serviceAddressInvalid,
        extras,
        cooldown,
      }),
      submitting: next.submitting,
      submitError: next.submitError,
      ...extras,
      ...cooldown,
      canSetBalance,
      balanceUrlText: next.balanceUrlText,
      balanceMethod: next.balanceMethod,
      balanceFieldText: next.balanceFieldText,
      balanceFieldPlaceholder: balanceFieldPlaceholder(next.balanceUrlText),
      balanceCheck: next.balanceCheck,
      focusesBalance,
      ...deriveBalanceToken(next),
    };
  }

  /** 账户令牌与用户 ID 这几栏的样子，和令牌、地址对不上的提示。 */
  function deriveBalanceToken(next: Values) {
    const mask = next.balanceTokenRemoved ? null : savedTokenMask;
    const hasToken = next.balanceTokenText.trim() !== "" || mask !== null;
    return {
      balanceUrlGeneration: next.balanceUrlGeneration,
      balanceFieldGeneration: next.balanceFieldGeneration,
      balanceUserIdText: next.balanceUserIdText,
      balanceTokenMask: mask,
      hasSavedBalanceToken: mask !== null,
      balanceTokenBoxValue: next.balanceTokenBoxValue,
      balanceTokenBoxGeneration: next.balanceTokenBoxGeneration,
      isBalanceTokenVisible: next.isBalanceTokenVisible,
      isRevealingBalanceToken: next.isRevealingBalanceToken,
      balanceTokenRevealError: next.balanceTokenRevealError,
      balanceFix: balanceFixOf({
        hasToken,
        balanceUrl: next.balanceUrlText,
        userId: next.balanceUserIdText,
        addresses: [
          next.urls.openai_chat,
          next.urls.anthropic_messages,
          next.urls.openai_responses,
        ],
        headerNames: next.headerRows
          .filter((row) => row.value.trim() !== "")
          .map((row) => row.name),
      }),
    };
  }

  /** 能保存：不在忙、有名称、有 key（选填时不要求）、地址都像样，「高级」里也没有读不通的。 */
  function canSubmitOf(input: {
    next: Values;
    busy: boolean;
    hasKey: boolean;
    hasValidUrls: boolean;
    serviceAddressInvalid: boolean;
    extras: ExtrasState;
    cooldown: CooldownState;
  }): boolean {
    // 发不出去的请求头只提示、不挡保存（magpie 照存）；读不通的附加请求体挡住，daemon 也会拒收。
    const hasExtrasProblem =
      input.extras.extraBodyProblem !== null || input.cooldown.cooldownProblem !== null;
    const isFilled = input.next.name.trim() !== "" && input.hasKey && input.hasValidUrls;
    return !input.busy && isFilled && !input.serviceAddressInvalid && !hasExtrasProblem;
  }

  type ExtrasState = Pick<
    ConnectionFormState,
    | "canSetRequestExtras"
    | "isAdvancedOpen"
    | "headerRows"
    | "headerHints"
    | "headerProblem"
    | "extraBodyText"
    | "extraBodyProblem"
    | "keyHeader"
    | "showsKeyHeader"
    | "showsInsecureTls"
    | "insecureTls"
    | "isConfirmingInsecureTls"
  >;

  type CooldownState = Pick<
    ConnectionFormState,
    | "quotaRestMode"
    | "quotaRestText"
    | "quotaResetAtText"
    | "restCapText"
    | "noFailRest"
    | "showsRestCap"
    | "cooldownProblem"
  >;

  /** 「高级」里的冷却设置与哪一项不对。主机不认它们时不算不对。 */
  function deriveCooldown(next: Values): CooldownState {
    const read = cooldownFieldsRead(next);
    const isInvalid = canSetRequestExtras && read.kind === "invalid";
    return {
      quotaRestMode: next.quotaRestMode,
      quotaRestText: next.quotaRestText,
      quotaResetAtText: next.quotaResetAtText,
      restCapText: next.restCapText,
      noFailRest: next.noFailRest,
      showsRestCap: !next.noFailRest,
      cooldownProblem: isInvalid ? read.problem : null,
    };
  }

  /** 「高级」那部分：请求头、附加请求体、key 放哪个头与哪里不对。主机不认它们时都不算。 */
  function deriveExtras(next: Values): ExtrasState {
    const { headerRows, extraBodyText, keyHeader } = next;
    const extraBody = extraBodyOf(extraBodyText);
    const anthropicUrl = urlsToSave(next).anthropic_messages;
    const headerHints = headerHintsLeft(next.template?.headerHints ?? [], headerRows);
    let headerProblem: HeaderProblem | null = null;
    let extraBodyProblem: ExtraBodyTextProblem | null = null;
    let showsKeyHeader = false;
    if (canSetRequestExtras) {
      headerProblem = headerRowsProblem(headerRows);
      if (extraBody.kind === "invalid") extraBodyProblem = extraBody.problem;
      showsKeyHeader = isThirdPartyAnthropicUrl(anthropicUrl);
    }
    const isAdvancedOpen = next.isAdvancedOpen;
    const showsInsecureTls = canSetRequestExtras && takesInsecureTlsAt(next);
    return {
      canSetRequestExtras,
      isAdvancedOpen,
      headerRows,
      headerHints,
      headerProblem,
      extraBodyText,
      extraBodyProblem,
      keyHeader,
      showsKeyHeader,
      showsInsecureTls,
      insecureTls: next.insecureTls,
      isConfirmingInsecureTls: next.isConfirmingInsecureTls,
    };
  }

  /** 这张表单的接口能不能不校验证书：「自定义」，且保存时会存的地址里有 https 的。 */
  function takesInsecureTlsAt(from: Values): boolean {
    const urls = Object.values(urlsToSave(from));
    return takesInsecureTls({ templateId: from.template?.id, urls });
  }

  /**
   * 不校验证书：「自定义」的表单保存、拉模型、测试、检测都带上（照 magpie：开着且有 https 地址才为 true）；
   * 这家原来没开、现在也没开时不带，和以前一样。模板接口与老主机不带。
   */
  function insecureTlsRequest(): Pick<ConnectionSaveRequest, "insecureTls"> {
    const isCustom = values.template === null;
    if (!canSetRequestExtras || !isCustom) return {};
    const insecureTls = values.insecureTls && takesInsecureTlsAt(values);
    const wasOn = keyOwner?.insecureTls === true;
    const isNeverOn = !insecureTls && !wasOn;
    return isNeverOn ? {} : { insecureTls };
  }

  type CheckState = Pick<
    ConnectionFormState,
    | "canCheckBeforeSave"
    | "hasModelField"
    | "detectModel"
    | "detection"
    | "canDetectEach"
    | "eachNeedsModels"
    | "keyRejected"
    | "catalogFetch"
    | "canFetchModels"
    | "tests"
    | "isTesting"
    | "canTest"
  >;

  /** 保存前检查的那部分：自动检测结论、拉到的清单、测试结果与能不能点。 */
  function deriveChecks(input: {
    next: Values;
    hasKey: boolean;
    busy: boolean;
    serviceAddressInvalid: boolean;
    hasValidUrls: boolean;
    hasValidAddress: boolean;
  }): CheckState {
    const { next, hasKey, busy, serviceAddressInvalid, hasValidUrls } = input;
    const isDetectionRejected =
      next.detection?.results.some((result) => result.label === "auth_failed") === true;
    const isTestRejected = Object.values(next.tests).some(
      (outcome) => outcome?.kind === "authFailed",
    );
    // 行上写问的那个地址（本机服务换了地址时是挪过去的）。
    const askedUrls = urlsToSave(next);
    const tests = API_ENDPOINT_REQUEST_FORMATS.flatMap((format) => {
      const outcome = next.tests[format];
      return outcome ? [{ format, url: askedUrls[format].trim(), outcome }] : [];
    });
    const isTesting = tests.some((row) => row.outcome.kind === "testing");
    const hasCheckedUrls = checkedUrlsOf(next).length > 0;
    const canCheck = canCheckBeforeSave && hasKey && !serviceAddressInvalid && hasCheckedUrls;
    // 逐个模型和自动检测一样问地址框里的地址。
    const canDetectHere = !busy && hasKey && input.hasValidAddress;
    const canAskEachModel = canCheckBeforeSave && canDetectHere;
    return {
      canCheckBeforeSave,
      // 添加窗口能拉模型时「模型」框一直显示。
      hasModelField: next.hasModelField || (canCheckBeforeSave && isAdding),
      detectModel: next.detectModel,
      detection: next.detection
        ? detectionStateOf({
            detection: next.detection,
            apiKey: next.apiKey,
            hasValidUrls,
            stagedPins: next.stagedPins,
          })
        : null,
      canDetectEach: canAskEachModel,
      eachNeedsModels: next.eachNeedsModels,
      keyRejected: isDetectionRejected || isTestRejected,
      catalogFetch: next.catalogFetch,
      canFetchModels: canCheck && isAdding && !busy,
      tests,
      isTesting,
      canTest: canCheck && !isTesting && !next.submitting,
    };
  }

  function update(patch: Partial<Values>): void {
    if (closed) return;
    values = { ...values, ...patch };
    state = derive(values);
    for (const listener of listeners) listener();
  }

  function templateStateOf(
    template: ApiEndpointTemplate,
    regionId: string | null,
  ): ConnectionTemplateState {
    const region = template.regions?.find((candidate) => candidate.id === regionId) ?? null;
    return {
      id: template.id,
      name: template.name,
      note: template.note ?? null,
      keyHint: template.keyHint ?? null,
      keyOptional: template.keyOptional === true,
      asksServiceAddress: template.group === LOCAL_GROUP,
      regionLabel: template.regionLabel ?? "region",
      regions: template.regions?.map(({ id, name }) => ({ id, name })) ?? null,
      regionId,
      // 国际站与中国站只在新建时切换（照 magpie）。
      sites: seed.mode === "create" ? siteChoicesOf(templates, template.id) : null,
      keysUrl: region?.keysUrl ?? template.keysUrl ?? null,
      websiteUrl: region?.website ?? template.website ?? null,
      endpointExample: template.endpointExample ?? null,
      endpointHint: template.endpointHint ?? null,
    };
  }

  function abortPendingDetect(): void {
    pendingDetect?.abort();
    pendingDetect = null;
  }

  function abortPendingFetch(): void {
    pendingFetch?.abort();
    pendingFetch = null;
  }

  function abortPendingTest(): void {
    pendingTest?.abort();
    pendingTest = null;
  }

  /** 地址、key、区域或模板变了：拉到的清单与测试结果都作废，进行中的一并中止。返回要并进去的改动。 */
  function invalidateChecks(): Pick<Values, "catalogFetch" | "tests"> {
    abortPendingFetch();
    abortPendingTest();
    return { catalogFetch: { status: "idle" }, tests: {} };
  }

  /** 照 magpie noneAnswered：一种都没通、又没有 key（没打、没存、复制来的那家也没有）时提示先填 key。 */
  function detectionStateOf(input: {
    detection: DetectionValues;
    apiKey: string;
    hasValidUrls: boolean;
    stagedPins: StagedPins;
  }): ConnectionDetection {
    const { detection } = input;
    const { each } = detection;
    const anyAnswered = detection.results.some((result) => result.label === "ok");
    const isKeyless = input.apiKey.trim() === "" && !hasSavedKey;
    let noneAnswered: ConnectionDetection["noneAnswered"] = null;
    if (!anyAnswered) noneAnswered = isKeyless ? "keyless" : "check";
    const canTake = anyAnswered && !detection.isTaken;
    let askedOnlyFirst: ConnectionDetection["askedOnlyFirst"] = null;
    let singleFormatPins: ModelFormatPin[] = [];
    if (each !== null) {
      const isCut = each.picked > each.rows.length;
      if (isCut) askedOnlyFirst = { asked: each.rows.length, picked: each.picked };
      singleFormatPins = singleFormatPinsOf(each.rows);
    }
    return {
      results: detection.results,
      byModel: each?.rows ?? null,
      askedOnlyFirst,
      singleFormatPins,
      isTaken: detection.isTaken,
      onlyChoices: onlyChoicesOf(detection, input.stagedPins),
      canTake,
      waitsForTake: canTake && !input.hasValidUrls,
      noneAnswered,
    };
  }

  /**
   * 照 magpie Each picked model 的「采用这些」：编辑一家时，问了两种以上格式、只在一种上答上的这家的模型，给它那种格式。
   */
  function singleFormatPinsOf(rows: ModelDetectionRow[]): ModelFormatPin[] {
    if (seed.mode !== "edit") return [];
    const { endpoint } = seed;
    return rows.flatMap((row) => {
      const answered = row.cells.filter((cell) => cell.label === "ok");
      const [only] = answered;
      const wasAskedOnSeveral = row.cells.length > 1;
      const isEndpointModel = endpointHasModel(endpoint, row.modelId);
      const isSingleFormat = answered.length === 1 && wasAskedOnSeveral && isEndpointModel;
      if (!isSingleFormat || !only) return [];
      return [{ modelId: row.modelId, format: only.format }];
    });
  }

  /**
   * 照 magpie Detect：编辑一家时，打了试用的模型、它是这家的模型，又不是每种格式都通，每种通了的格式给一个「只在…上问」。
   * 新建、复制的接口没有可设的模型（magpie 在保存后的 Names & levels 里设）。
   */
  function onlyChoicesOf(
    detection: DetectionValues,
    stagedPins: StagedPins,
  ): ConnectionOnlyChoices | null {
    const modelId = detection.askedModel;
    if (seed.mode !== "edit" || modelId === null || !endpointHasModel(seed.endpoint, modelId)) {
      return null;
    }
    const formats = detection.results
      .filter((result) => result.label === "ok")
      .map((result) => result.format);
    const isSomeOnly = formats.length > 0 && formats.length < detection.results.length;
    if (!isSomeOnly) return null;
    const saved = savedPinOf(modelId);
    const isStagedHere = modelId in stagedPins;
    const staged = isStagedHere ? (stagedPins[modelId] ?? null) : saved;
    return { modelId, formats, staged, isPending: staged !== saved };
  }

  /** 照 magpie stageAPI：和已存的相同就不改（去掉暂存），否则暂存那种格式。 */
  function withGivenPins(current: StagedPins, given: ModelFormatPin[]): StagedPins {
    const pins = { ...current };
    for (const pin of given) {
      if (savedPinOf(pin.modelId) === pin.format) delete pins[pin.modelId];
      else pins[pin.modelId] = pin.format;
    }
    return pins;
  }

  function savedPinOf(modelId: string): ApiEndpointRequestFormat | null {
    if (seed.mode !== "edit") return null;
    const format = seed.endpoint.modelSettings?.models?.[modelId]?.format;
    return format !== undefined && isRequestFormat(format) ? format : null;
  }

  /** 保存时带的模型设置：只在设了、又和已存的不同时才带（照 magpie stageAPI）。 */
  function stagedModelSettings(): Pick<ConnectionSaveRequest, "modelSettings"> {
    if (seed.mode !== "edit") return {};
    const changed = Object.entries(values.stagedPins).filter(
      ([modelId, format]) => format !== savedPinOf(modelId),
    );
    let modelSettings = seed.endpoint.modelSettings;
    for (const [modelId, format] of changed) {
      modelSettings = withModelFormat({ current: modelSettings, modelId, format });
    }
    if (changed.length === 0) return {};
    return { modelSettings };
  }

  // 本机服务换了地址时各格式地址挪过去；别的照填的。
  function urlsToSave(from: Values): Urls {
    const origin = serverOrigin(from.serviceAddress);
    const isMoved = from.template?.group === LOCAL_GROUP && origin && origin !== serviceAddressWas;
    return isMoved ? atOrigin(from.urls, origin) : from.urls;
  }

  /** 拉模型、测试连接要问的地址：保存时会存的、像 http(s) 地址的那些，按 Anthropic → Chat → Responses。 */
  function checkedUrlsOf(from: Values): CheckedUrl[] {
    const urls = urlsToSave(from);
    return API_ENDPOINT_REQUEST_FORMATS.flatMap((format) => {
      const url = urls[format].trim();
      return url !== "" && isHttpUrl(url) ? [{ format, url }] : [];
    });
  }

  /**
   * 编辑时总带这家的 id（照 magpie 的 id: p?.id）：daemon 按它找上游模型名，打了的 key 照样优先；
   * 复制时没打 key 才带原来那家的 id，借它已存的 key。
   */
  function keyOwnerRequest(): { endpointId?: string; apiKey?: string } {
    const apiKey = typedKey();
    const typed = apiKey ? { apiKey } : {};
    if (seed.mode === "edit") return { endpointId: seed.endpoint.id, ...typed };
    if (apiKey) return typed;
    return keyOwner ? { endpointId: keyOwner.id } : {};
  }

  /** 表单当前的模板与区域或套餐：拉模型、测试连接按它们问（「自定义」不带）。 */
  function placeRequest(): { templateId?: string; region?: string } {
    if (!values.template) return {};
    return {
      templateId: values.template.id,
      ...(values.regionId ? { region: values.regionId } : {}),
    };
  }

  /** 表单里的模型：编辑、复制时那家已选的，加上「模型」框里的。 */
  function formModelIds(): string[] {
    const typedModels = values.modelIds.map((id) => ({ id }));
    return withModels(keyOwner?.models ?? [], typedModels).map((model) => model.id);
  }

  /** 测试连接从这些模型里挑：表单里的在前，拉到的清单（没拉过时是那家已存的）在后。 */
  function testModelIds(): string[] {
    const listed =
      values.catalogFetch.status === "fetched"
        ? values.catalogFetch.models
        : (keyOwner?.catalog?.models ?? []);
    return [...new Set([...formModelIds(), ...listed.map((model) => model.id)])];
  }

  /**
   * 拉模型、测试连接、检测带上表单里还没保存的请求头、附加请求体与 key 头（照 magpie asTyped）：
   * 读不通的附加请求体、不合法的请求头不带，daemon 用这家存的。
   */
  function typedExtrasRequest(): Pick<
    ConnectionSaveRequest,
    "headers" | "extraBody" | "keyHeader"
  > {
    // 表单和那家存的都什么也没设：不带，和以前一样。
    const isAllEmpty = !hasSeededExtras && equal(extrasNow(), EMPTY_EXTRAS);
    if (!canSetRequestExtras || isAllEmpty) return {};
    const extraBody = extraBodyOf(values.extraBodyText);
    const headers = headersToSave(values.headerRows);
    const typed: Pick<ConnectionSaveRequest, "headers" | "extraBody" | "keyHeader"> = {
      headers,
      keyHeader: values.keyHeader,
    };
    if (extraBody.kind === "ok") typed.extraBody = extraBody.value;
    return typed;
  }

  /** 表单里这三项保存时的样子（空的、both 即清掉）；能保存时这几项都已读通。 */
  function extrasNow(): Required<
    Pick<ConnectionSaveRequest, "headers" | "extraBody" | "keyHeader">
  > {
    const extraBodyRead = extraBodyOf(values.extraBodyText);
    const headers = headersToSave(values.headerRows);
    let extraBody: Record<string, unknown> = {};
    if (extraBodyRead.kind === "ok") extraBody = extraBodyRead.value;
    return { headers, extraBody, keyHeader: values.keyHeader };
  }

  /** 保存时只在改过时整份带上；没改的省略，daemon 留着那家原来的（复制时由 daemon 拷）。 */
  function savedExtrasRequest(): Pick<
    ConnectionSaveRequest,
    "headers" | "extraBody" | "keyHeader"
  > {
    if (!canSetRequestExtras) return {};
    const now = extrasNow();
    const isUnchanged = equal(now, extrasAtOpen);
    return isUnchanged ? {} : now;
  }

  /** 冷却设置只在改过时整份带上；没改的省略，daemon 留着那家原来的（复制时由 daemon 拷）。老主机不带。 */
  function savedCooldownRequest(): Pick<ConnectionSaveRequest, "cooldownSettings"> {
    if (!canSetRequestExtras) return {};
    const now: CooldownFieldsRead = cooldownFieldsRead(values);
    const isUnchanged = equal(now, cooldownAtOpen);
    if (now.kind === "invalid" || isUnchanged) return {};
    return { cooldownSettings: now.value };
  }

  /**
   * 余额设置只在改过时整份带上；没改的省略，daemon 留着那家原来的（复制时由 daemon 拷）。账户令牌打了或移除了才带。
   * 老主机不带。
   */
  function savedBalanceRequest(): Pick<ConnectionSaveRequest, "balance" | "balanceToken"> {
    if (!canSetBalance) return {};
    const now = balanceSettingsOf(values);
    return {
      ...(equal(now, balanceAtOpen) ? {} : { balance: now }),
      ...balanceTokenRequest({
        typed: values.balanceTokenText,
        removed: values.balanceTokenRemoved,
      }),
    };
  }

  /** 「查询余额」：表单里的 key、各格式地址、模板、请求头与余额设置，都还没保存。 */
  async function runBalanceCheck(controller: AbortController): Promise<void> {
    const outcome = await deps.checkBalance(
      {
        ...keyOwnerRequest(),
        // 复制时打了 key 也带原来那家的 id：没动的账户令牌用它存的。
        ...(keyOwner ? { endpointId: keyOwner.id } : {}),
        baseUrls: checkedUrlsOf(values),
        ...(values.template ? { templateId: values.template.id } : {}),
        balance: balanceSettingsOf(values),
        ...balanceTokenRequest({
          typed: values.balanceTokenText,
          removed: values.balanceTokenRemoved,
        }),
        ...typedExtrasRequest(),
        ...insecureTlsRequest(),
      },
      controller.signal,
    );
    if (pendingBalanceCheck !== controller) return;
    pendingBalanceCheck = null;
    if (outcome.status === "cancelled") update({ balanceCheck: { status: "idle" } });
    else if (outcome.status === "done") {
      update({ balanceCheck: { status: "done", reading: outcome.reading } });
    } else update({ balanceCheck: { status: "failed", message: outcome.message } });
  }

  /** 改一行请求头。 */
  function updateHeaderRow(id: number, change: (row: HeaderRow) => HeaderRow): void {
    const headerRows = values.headerRows.map((row) => {
      if (row.id !== id) return row;
      return change(row);
    });
    update({ headerRows });
  }

  /** 表单里的全部地址一次交给 daemon：各格式各拉一次、按模型 id 合并（照 magpie）。 */
  async function runFetch(controller: AbortController): Promise<void> {
    const checked = checkedUrlsOf(values);
    const [first] = checked;
    if (!first) {
      pendingFetch = null;
      update({ catalogFetch: { status: "idle" } });
      return;
    }
    const outcome = await deps.fetchModels(
      {
        ...keyOwnerRequest(),
        baseUrl: first.url,
        format: first.format,
        baseUrls: checked,
        preview: true,
        ...placeRequest(),
        ...typedExtrasRequest(),
        ...insecureTlsRequest(),
      },
      controller.signal,
    );
    if (pendingFetch !== controller) return;
    pendingFetch = null;
    if (outcome.status === "cancelled") update({ catalogFetch: { status: "idle" } });
    else if (outcome.status === "done") {
      update({ catalogFetch: { status: "fetched", models: outcome.models } });
    } else update({ catalogFetch: { status: "failed", message: outcome.message } });
  }

  async function runTest(controller: AbortController, checked: CheckedUrl): Promise<void> {
    const outcome = await deps.testConnection(
      {
        ...keyOwnerRequest(),
        baseUrl: checked.url,
        format: checked.format,
        ...placeRequest(),
        modelIds: testModelIds(),
        ...typedExtrasRequest(),
        ...insecureTlsRequest(),
      },
      controller.signal,
    );
    if (pendingTest !== controller) return;
    const tests = { ...values.tests };
    if (outcome.status === "cancelled") delete tests[checked.format];
    else tests[checked.format] = testOutcomeOf({ outcome, url: checked.url });
    update({ tests });
  }

  function typedKey(): string | undefined {
    const apiKey = values.apiKey.trim();
    return apiKey === "" ? undefined : apiKey;
  }

  async function runDetect(controller: AbortController, isEach: boolean): Promise<void> {
    const detectModel = isEach ? "" : values.detectModel.trim();
    const picked = canCheckBeforeSave ? formModelIds() : [];
    const outcome = await deps.detect(
      {
        ...keyOwnerRequest(),
        baseUrl: values.address.trim(),
        ...(canCheckBeforeSave && detectModel !== "" ? { modelId: detectModel } : {}),
        ...(picked.length > 0 ? { modelIds: picked } : {}),
        ...(isEach ? { eachModel: true } : {}),
        ...typedExtrasRequest(),
        ...insecureTlsRequest(),
      },
      controller.signal,
    );
    if (pendingDetect !== controller) return;
    pendingDetect = null;
    if (outcome.status === "failed") {
      update({ detecting: false, detectError: outcome.message });
      return;
    }
    if (outcome.status === "cancelled") {
      update({ detecting: false });
      return;
    }
    // 只列出结论，「采用这些」才填进地址栏（照 magpie Detect）。
    const results = outcome.results.flatMap(detectedFormatOf);
    const askedModel = canCheckBeforeSave && detectModel !== "" ? detectModel : null;
    let each: DetectionValues["each"] = null;
    if (outcome.models !== null) {
      const rows = outcome.models.map(modelDetectionRowOf);
      each = { rows, picked: picked.length };
    }
    update({ detecting: false, detection: { results, isTaken: false, askedModel, each } });
  }

  function startDetect(isEach: boolean): void {
    abortPendingDetect();
    const controller = new AbortController();
    pendingDetect = controller;
    update({ detecting: true, detectError: null, detection: null, eachNeedsModels: false });
    void runDetect(controller, isEach);
  }

  /** 照 magpie useDetected：通了的填上建议地址；没在那里找到的（404、405）清掉，但只清和建议地址一样的那栏。 */
  function takenUrls(results: DetectedFormat[]): Urls {
    const urls = { ...values.urls };
    for (const result of results) {
      const isMissingThere = result.httpStatus === 404 || result.httpStatus === 405;
      if (result.label === "ok") urls[result.format] = result.url;
      else if (isMissingThere && trimSlashes(urls[result.format]) === result.url) {
        urls[result.format] = "";
      }
    }
    return urls;
  }

  function buildRequest(): ConnectionSaveRequest {
    const apiKey = typedKey();
    const urls = urlsToSave(values);
    const baseUrls = API_ENDPOINT_REQUEST_FORMATS.flatMap((format) => {
      const url = urls[format].trim();
      return url ? [{ format, url }] : [];
    });
    const isIconChanged = state.canPickIcon && values.icon !== seededIcon;
    // 粘贴 curl 加进来的模型：选上，并记作手动添加（同详情页「添加模型」）；复制时并进原来那家的。
    const typedModels = values.modelIds.map((id) => ({ id }));
    const models = withModels(keyOwner?.models ?? [], typedModels);
    const manualModels = withModels(keyOwner?.manualModels ?? [], typedModels);
    return {
      ...(seed.mode === "edit" ? { endpointId: seed.endpoint.id } : {}),
      name: values.name.trim(),
      baseUrls,
      ...(apiKey ? { apiKey } : {}),
      ...(values.template ? { templateId: values.template.id } : {}),
      ...(values.regionId ? { region: values.regionId } : {}),
      ...(isIconChanged ? { icon: values.icon } : {}),
      // 连接弹窗不挑模型：只加粘贴 curl 带来的；编辑、复制时把已选模型与档位映射原样带上。
      models,
      ...(typedModels.length > 0 ? { manualModels } : {}),
      ...(keyOwner?.modelMapping ? { modelMapping: keyOwner.modelMapping } : {}),
      // 复制：上游清单、手动添加的模型、联网搜索开关等其余设置由 daemon 从原来那家拷。
      ...(seed.mode === "duplicate" ? { copyOf: seed.source.id } : {}),
      // 新建的「跟随接口清单」；表单里打的模型记作手动添加，跟随时总在服务。
      ...(followsListWhenNew && seed.mode === "create" ? { modelScope: "vendor" } : {}),
      // 添加时拉到的清单随保存写入。
      ...(values.catalogFetch.status === "fetched" ? { catalog: values.catalogFetch.models } : {}),
      ...stagedModelSettings(),
      ...savedExtrasRequest(),
      ...insecureTlsRequest(),
      ...savedCooldownRequest(),
      ...savedBalanceRequest(),
    };
  }

  async function runIconTask(task: ConnectionIconTask, run: () => Promise<ConnectionIconResult>) {
    const token = {};
    pendingIcon = token;
    update({ iconTask: task, iconError: null });
    const outcome = await run();
    if (pendingIcon !== token) return;
    pendingIcon = null;
    if (outcome.status === "failed") {
      update({ iconTask: null, iconError: outcome.error });
      return;
    }
    update({ iconTask: null, icon: outcome.icon, iconError: null });
  }

  /** 找网站图标用的地址：照 magpie 先 Chat、再 Responses、再 Anthropic，都没填时用自动检测的地址框。 */
  function siteBaseUrl(): string {
    const filled = (["openai_chat", "openai_responses", "anthropic_messages"] as const)
      .map((format) => values.urls[format].trim())
      .find((url) => url !== "");
    return filled ?? values.address.trim();
  }

  /** 照 magpie fromCurl：「自定义」填地址与格式，新建或复制时加模型；key 都取；占位符不算 key。 */
  function applyCurl(text: string): boolean {
    if (!canPasteCurl) return false;
    const command = curlOf(text);
    if (!command) return false;
    const isCustom = values.template === null;
    // 照 magpie：复制一家「自定义」也是新建，模型同样加上；编辑时已选的模型不动。
    const takesModels = isCustom && seed.mode !== "edit";
    const baseUrl = isCustom ? curlBaseUrlOf(command) : null;
    const model = takesModels ? command.model : null;
    const modelIds = model === null ? null : withId(values.modelIds, model);
    const curlNote = curlNoteOf({ command, isCustom, baseUrl, model });
    const urlChange = baseUrl ? baseUrlPatch(baseUrl) : {};
    const keyChange = command.apiKey ? apiKeyPatch(command.apiKey) : {};
    const modelChange = modelIds ? { modelIds, hasModelField: true } : {};
    const isConnectionChanged = baseUrl !== null || command.apiKey !== null;
    if (isConnectionChanged) abortPendingDetect();
    const checkChange = isConnectionChanged ? invalidateChecks() : {};
    update({ ...urlChange, ...keyChange, ...modelChange, ...checkChange, curlNote });
    const inputs: ConnectionCurlInputs = {
      address: baseUrl?.url ?? null,
      modelIds,
      focusesKey: command.apiKey === null,
    };
    for (const listener of curlInputListeners) listener(inputs);
    return true;
  }

  function baseUrlPatch(baseUrl: CurlBaseUrl): Partial<Values> {
    return {
      address: baseUrl.url,
      urls: { ...values.urls, [baseUrl.format]: baseUrl.url },
      urlGeneration: values.urlGeneration + 1,
      detection: null,
      detecting: false,
      detectError: null,
    };
  }

  function apiKeyPatch(apiKey: string): Partial<Values> {
    return {
      apiKey,
      keyBoxValue: apiKey,
      keyBoxGeneration: values.keyBoxGeneration + 1,
      isKeyRevealed: false,
      isRevealingKey: false,
      revealError: null,
      detection: null,
      detecting: false,
      detectError: null,
    };
  }

  async function runTokenReveal(endpointId: string): Promise<void> {
    const outcome = await deps.revealBalanceToken(endpointId);
    if (!values.isRevealingBalanceToken) return;
    if (outcome.status === "failed") {
      update({ isRevealingBalanceToken: false, balanceTokenRevealError: outcome.message });
      return;
    }
    // 等的时候已经打了新令牌，或其实没存：只把框里的显示出来。
    if (values.balanceTokenText !== "" || outcome.value === null) {
      update({ isRevealingBalanceToken: false, isBalanceTokenVisible: true });
      return;
    }
    update({
      isRevealingBalanceToken: false,
      isBalanceTokenVisible: true,
      isBalanceTokenRevealed: true,
      balanceTokenBoxValue: outcome.value,
      balanceTokenBoxGeneration: values.balanceTokenBoxGeneration + 1,
    });
  }

  async function runReveal(endpointId: string): Promise<void> {
    const outcome = await deps.revealKey(endpointId);
    if (!values.isRevealingKey) return;
    if (outcome.status === "failed") {
      update({ isRevealingKey: false, revealError: outcome.message });
      return;
    }
    // 等的时候已经打了新 key，或这家其实没存 key：只把框里的显示出来，不拿原 key 盖掉。
    const hasTypedKey = values.apiKey !== "";
    const savedKey = outcome.apiKey;
    if (hasTypedKey || savedKey === null) {
      update({ isRevealingKey: false, isKeyVisible: true });
      return;
    }
    update({
      isRevealingKey: false,
      isKeyVisible: true,
      isKeyRevealed: true,
      keyBoxValue: savedKey,
      keyBoxGeneration: values.keyBoxGeneration + 1,
    });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setName: (name) => update({ name }),
    setRegion(regionId) {
      const region = values.template?.regions?.find((candidate) => candidate.id === regionId);
      if (!values.template || !region) return;
      // 拉到的清单属于原来的区域或套餐。
      update({
        regionId,
        urls: urlsOf(region.baseUrls),
        urlGeneration: values.urlGeneration + 1,
        ...invalidateChecks(),
      });
    },
    setSite(templateId) {
      const template = templates.find((candidate) => candidate.id === templateId);
      const isSiteChoice = state.template?.sites?.some(
        (choice) => choice.templateId === templateId,
      );
      if (!template || !isSiteChoice) return;
      const region = template.regions?.[0] ?? null;
      update({
        template,
        regionId: region?.id ?? null,
        name: template.name,
        nameGeneration: values.nameGeneration + 1,
        urls: urlsOf(templateBaseUrls(template, region)),
        urlGeneration: values.urlGeneration + 1,
        ...invalidateChecks(),
      });
    },
    setApiKey(apiKey) {
      abortPendingDetect();
      update({
        apiKey,
        keyBoxValue: apiKey,
        isRevealingKey: false,
        revealError: null,
        detection: null,
        detecting: false,
        detectError: null,
        ...invalidateChecks(),
      });
    },
    toggleKeyVisible() {
      if (!canRevealKey || values.isRevealingKey) return;
      if (values.isKeyVisible) {
        // 读回来又没改的原 key 不留在框里（照 magpie）。
        const clearsBox = values.isKeyRevealed && values.apiKey === "";
        update({
          isKeyVisible: false,
          isKeyRevealed: false,
          ...(clearsBox ? { keyBoxValue: "", keyBoxGeneration: values.keyBoxGeneration + 1 } : {}),
        });
        return;
      }
      const readsSavedKey = seed.mode === "edit" && hasSavedKey && values.apiKey === "";
      if (readsSavedKey) {
        update({ isRevealingKey: true, revealError: null });
        void runReveal(seed.endpoint.id);
        return;
      }
      update({ isKeyVisible: true, revealError: null });
    },
    setAddress(address) {
      abortPendingDetect();
      update({ address, detection: null, detecting: false, detectError: null });
    },
    pasteCurl: applyCurl,
    subscribeCurlInputs(listener) {
      curlInputListeners.add(listener);
      return () => curlInputListeners.delete(listener);
    },
    setModelIds(value) {
      update({ modelIds: typedModelIds(value), eachNeedsModels: false });
    },
    toggleModel(modelId) {
      const modelIds = values.modelIds.includes(modelId)
        ? values.modelIds.filter((id) => id !== modelId)
        : [...values.modelIds, modelId];
      update({ modelIds, modelIdsGeneration: values.modelIdsGeneration + 1 });
    },
    pickModels(modelIds) {
      const picked = modelIds.reduce(withId, values.modelIds);
      update({ modelIds: picked, modelIdsGeneration: values.modelIdsGeneration + 1 });
    },
    unpickModels(modelIds) {
      const dropped = new Set(modelIds);
      update({
        modelIds: values.modelIds.filter((id) => !dropped.has(id)),
        modelIdsGeneration: values.modelIdsGeneration + 1,
      });
    },
    fetchModels() {
      if (!state.canFetchModels) return;
      abortPendingFetch();
      const controller = new AbortController();
      pendingFetch = controller;
      update({ catalogFetch: { status: "fetching" } });
      void runFetch(controller);
    },
    cancelFetchModels() {
      if (!pendingFetch) return;
      abortPendingFetch();
      update({ catalogFetch: { status: "idle" } });
    },
    testConnection() {
      if (!state.canTest) return;
      abortPendingTest();
      const controller = new AbortController();
      pendingTest = controller;
      const checked = checkedUrlsOf(values);
      const tests: FormatTests = {};
      for (const entry of checked) tests[entry.format] = { kind: "testing" };
      update({ tests });
      for (const entry of checked) void runTest(controller, entry);
    },
    cancelTest() {
      if (!pendingTest) return;
      abortPendingTest();
      update({ tests: {} });
    },
    setEndpoint(endpoint) {
      update({
        urls: { ...values.urls, openai_chat: endpoint, openai_responses: endpoint },
        ...invalidateChecks(),
      });
    },
    setUrl(format, url) {
      update({ urls: { ...values.urls, [format]: url }, ...invalidateChecks() });
    },
    setServiceAddress(serviceAddress) {
      update({ serviceAddress, ...invalidateChecks() });
    },
    setIcon(icon) {
      pendingIcon = null;
      update({ icon, iconTask: null, iconError: null });
    },
    pickIconImage(bytes) {
      if (!state.canPickIcon) return;
      if (bytes.length > MAX_ICON_BYTES) {
        pendingIcon = null;
        update({ iconTask: null, iconError: { code: "icon_too_large", message: "" } });
        return;
      }
      void runIconTask("picture", () => deps.storeIcon(bytes));
    },
    fetchSiteIcon() {
      if (!state.canPickIcon) return;
      const input = { baseUrl: siteBaseUrl(), name: values.name.trim() };
      void runIconTask("website", () => deps.fetchSiteIcon(input));
    },
    setDetectModel: (detectModel) => update({ detectModel }),
    detect() {
      if (!state.canDetect) return;
      startDetect(false);
    },
    detectEachModel() {
      if (!state.canDetectEach) return;
      // 照 magpie：没有模型时只提示先选，什么也不问。
      if (formModelIds().length === 0) {
        abortPendingDetect();
        update({ eachNeedsModels: true, detection: null, detectError: null });
        return;
      }
      startDetect(true);
    },
    takeDetected() {
      const detection = values.detection;
      const given = state.detection?.singleFormatPins ?? [];
      if (!state.detection?.canTake || !detection) return;
      const stagedPins = withGivenPins(values.stagedPins, given);
      update({
        stagedPins,
        urls: takenUrls(detection.results),
        urlGeneration: values.urlGeneration + 1,
        detection: { ...detection, isTaken: true },
        ...invalidateChecks(),
      });
    },
    askOnlyOn(format) {
      const detection = values.detection;
      const choices = state.detection?.onlyChoices;
      if (!detection || !choices?.formats.includes(format)) return;
      // 再点选着的那个即取消（照 magpie stageAPI 的切换）。
      const next = choices.staged === format ? null : format;
      const stagedPins = { ...values.stagedPins, [choices.modelId]: next };
      if (next === null || values.urls[format].trim() !== "") {
        update({ stagedPins });
        return;
      }
      // 这家还没有那种格式的地址：先采用检测到的地址（magpie 的 use(r.results)）。
      update({
        stagedPins,
        urls: takenUrls(detection.results),
        urlGeneration: values.urlGeneration + 1,
        detection: { ...detection, isTaken: true },
        ...invalidateChecks(),
      });
    },
    toggleAdvanced() {
      update({ isAdvancedOpen: !values.isAdvancedOpen });
    },
    addHeader(name) {
      const row = { id: values.nextHeaderId, name: name ?? "", value: "", isJson: false };
      update({ headerRows: [...values.headerRows, row], nextHeaderId: values.nextHeaderId + 1 });
    },
    setHeaderName(id, value) {
      updateHeaderRow(id, (row) => ({ ...row, name: value }));
    },
    setHeaderValue(id, value) {
      updateHeaderRow(id, (row) => ({ ...row, value }));
    },
    removeHeader(id) {
      update({ headerRows: values.headerRows.filter((row) => row.id !== id) });
    },
    toggleHeaderJson(id) {
      updateHeaderRow(id, (row) => {
        const isJson = !row.isJson;
        let value = minifiedJson(row.value);
        if (isJson) value = prettyJson(row.value);
        return { ...row, isJson, value };
      });
    },
    setExtraBody(value) {
      update({ extraBodyText: value });
    },
    setKeyHeader(value) {
      update({ keyHeader: value });
    },
    setInsecureTls(value) {
      if (value) update({ isConfirmingInsecureTls: true });
      else update({ insecureTls: false });
    },
    confirmInsecureTls() {
      update({ insecureTls: true, isConfirmingInsecureTls: false });
    },
    cancelInsecureTls() {
      update({ isConfirmingInsecureTls: false });
    },
    setQuotaRestMode(value) {
      update({ quotaRestMode: value });
    },
    setQuotaRest(value) {
      update({ quotaRestText: value });
    },
    setQuotaResetAt(value) {
      update({ quotaResetAtText: value });
    },
    setRestCap(value) {
      update({ restCapText: value });
    },
    setNoFailRest(value) {
      update({ noFailRest: value });
    },
    setBalanceUrl(value) {
      update({ balanceUrlText: value });
    },
    setBalanceMethod(value) {
      update({ balanceMethod: value });
    },
    setBalanceField(value) {
      update({ balanceFieldText: value });
    },
    setBalanceUserId(value) {
      update({ balanceUserIdText: value });
    },
    setBalanceToken(value) {
      update({
        balanceTokenText: value,
        balanceTokenBoxValue: value,
        isRevealingBalanceToken: false,
        balanceTokenRevealError: null,
      });
    },
    toggleBalanceTokenVisible() {
      if (values.isRevealingBalanceToken) return;
      if (values.isBalanceTokenVisible) {
        // 读回来又没改的原令牌不留在框里（同 key）。
        const clearsBox = values.isBalanceTokenRevealed && values.balanceTokenText === "";
        update({
          isBalanceTokenVisible: false,
          isBalanceTokenRevealed: false,
          ...(clearsBox
            ? {
                balanceTokenBoxValue: "",
                balanceTokenBoxGeneration: values.balanceTokenBoxGeneration + 1,
              }
            : {}),
        });
        return;
      }
      const readsSaved =
        seed.mode === "edit" &&
        savedTokenMask !== null &&
        !values.balanceTokenRemoved &&
        values.balanceTokenText === "";
      if (readsSaved) {
        update({ isRevealingBalanceToken: true, balanceTokenRevealError: null });
        void runTokenReveal(seed.endpoint.id);
        return;
      }
      update({ isBalanceTokenVisible: true, balanceTokenRevealError: null });
    },
    removeBalanceToken() {
      update({
        balanceTokenRemoved: true,
        balanceTokenText: "",
        balanceTokenBoxValue: "",
        balanceTokenBoxGeneration: values.balanceTokenBoxGeneration + 1,
        isBalanceTokenRevealed: false,
        isRevealingBalanceToken: false,
        balanceTokenRevealError: null,
      });
    },
    useBalanceUrl(url) {
      update({
        balanceUrlText: url,
        balanceUrlGeneration: values.balanceUrlGeneration + 1,
        balanceFieldText: fieldAfterUsing(values.balanceFieldText),
        balanceFieldGeneration: values.balanceFieldGeneration + 1,
      });
    },
    checkBalance() {
      if (!canSetBalance) return;
      pendingBalanceCheck?.abort();
      const controller = new AbortController();
      pendingBalanceCheck = controller;
      update({ balanceCheck: { status: "checking" } });
      void runBalanceCheck(controller);
    },
    cancelDetect() {
      if (!pendingDetect) return;
      abortPendingDetect();
      update({ detecting: false });
    },
    async submit() {
      if (!state.canSubmit) return null;
      update({ submitting: true, submitError: null });
      const result = await deps.save(buildRequest());
      update({
        submitting: false,
        submitError: result.status === "failed" ? result.message : null,
      });
      return result;
    },
    close() {
      abortPendingDetect();
      abortPendingFetch();
      abortPendingTest();
      pendingBalanceCheck?.abort();
      pendingBalanceCheck = null;
      pendingIcon = null;
      closed = true;
      listeners.clear();
      curlInputListeners.clear();
    },
  };
}

/**
 * 表单起步时的「高级」：编辑、复制时那家存的；「自定义」没有请求头时先放一行空的（照 magpie）。设了任一项（含冷却设置）就展开。
 */
function seededRequestExtras(input: {
  keyOwner: ApiEndpoint | null;
  isCustom: boolean;
  hasCooldownSettings: boolean;
  // 填了余额查询地址，或从「填写余额查询地址」打开。
  opensAdvanced: boolean;
}): Pick<Values, "isAdvancedOpen" | "headerRows" | "nextHeaderId" | "extraBodyText" | "keyHeader"> {
  const { keyOwner } = input;
  const saved = headerRowsOf(keyOwner?.headers);
  const extraBodyText = extraBodyTextOf(keyOwner?.extraBody);
  const keyHeader = keyHeaderOf(keyOwner?.keyHeader);
  const isSet =
    saved.length > 0 ||
    extraBodyText !== "" ||
    keyHeader !== "both" ||
    input.hasCooldownSettings ||
    input.opensAdvanced;
  const startsEmpty = input.isCustom && saved.length === 0;
  const headerRows = startsEmpty ? [{ id: 0, name: "", value: "", isJson: false }] : saved;
  return {
    isAdvancedOpen: isSet,
    headerRows,
    nextHeaderId: headerRows.length,
    extraBodyText,
    keyHeader,
  };
}

interface CurlNoteInput {
  command: CurlCommand;
  isCustom: boolean;
  // 这次填上的地址与模型；没填为 null。
  baseUrl: CurlBaseUrl | null;
  model: string | null;
}

/** 粘贴 curl 后的提示条：填了什么与三条要用户自己改的；没有一句可说时为 null（照 magpie editorError("")）。 */
function curlNoteOf(input: CurlNoteInput): ConnectionCurlNote | null {
  const { command, isCustom, baseUrl, model } = input;
  const filled: ConnectionCurlFill[] = [];
  if (baseUrl) filled.push({ kind: "baseUrl", format: baseUrl.format });
  if (command.apiKey) filled.push({ kind: "apiKey" });
  if (model !== null) filled.push({ kind: "model", model });
  const isEndpointUnknown = isCustom && command.format === null;
  const urlPlaceholder = isCustom ? command.urlPlaceholder : null;
  const { keyPlaceholder } = command;
  const hasNote =
    filled.length > 0 || isEndpointUnknown || urlPlaceholder !== null || keyPlaceholder !== null;
  return hasNote ? { filled, isEndpointUnknown, urlPlaceholder, keyPlaceholder } : null;
}

/** curl 的 URL 认出了格式时，它给的地址与格式；认不出为 null。 */
function curlBaseUrlOf(command: CurlCommand): CurlBaseUrl | null {
  if (command.format === null || command.baseUrl === null) return null;
  return { format: command.format, url: command.baseUrl };
}

/** 加上一个模型 id，已有就不重复。 */
function withId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

/** 在已有的模型后面接上新加的，已有的 id 不重复。 */
function withModels(kept: ApiEndpointModel[], added: ApiEndpointModel[]): ApiEndpointModel[] {
  const keptIds = new Set(kept.map((model) => model.id));
  return [...kept, ...added.filter((model) => !keptIds.has(model.id))];
}

/** 「模型」框里的 id：逗号或换行分隔，去掉空白与重复（照 magpie typedIds）。 */
function typedModelIds(value: string): string[] {
  const ids = value
    .split(/[,\n]/)
    .map((id) => id.trim())
    .filter((id) => id !== "");
  return [...new Set(ids)];
}

function initialNameOf(seed: ConnectionFormSeed): string {
  if (seed.mode === "edit") return seed.endpoint.name;
  if (seed.mode === "duplicate") return seed.name;
  return "";
}

/** 这家有这个模型：已选、上游清单里或手动添加的（同 daemon 的 endpointKnowsModel）。 */
function endpointHasModel(endpoint: ApiEndpoint, modelId: string): boolean {
  const lists = [endpoint.models, endpoint.catalog?.models ?? [], endpoint.manualModels ?? []];
  return lists.some((models) => models.some((model) => model.id === modelId));
}

function keyOwnerOf(seed: ConnectionFormSeed): ApiEndpoint | null {
  if (seed.mode === "edit") return seed.endpoint;
  if (seed.mode === "duplicate") return seed.source;
  return null;
}

/** 模板起步的那家：新建是 templateId 指的，编辑、复制是这家记下的；清单里没有就当「自定义」。 */
function templateOf(
  seed: ConnectionFormSeed,
  templates: readonly ApiEndpointTemplate[],
): ApiEndpointTemplate | null {
  const templateId =
    seed.mode === "create" ? seed.templateId : (keyOwnerOf(seed)?.templateId ?? null);
  if (templateId === null) return null;
  return templates.find((candidate) => candidate.id === templateId) ?? null;
}

/** 新建从第一个区域或套餐起步；编辑、复制用这家记下的，没记或已不在模板里时也用第一个（照 magpie）。 */
function initialRegionOf(
  seed: ConnectionFormSeed,
  template: ApiEndpointTemplate,
): ApiEndpointTemplateRegion | null {
  const regions = template.regions ?? [];
  const saved = keyOwnerOf(seed)?.region;
  return regions.find((candidate) => candidate.id === saved) ?? regions[0] ?? null;
}

/** 编辑、复制从这家存的地址起步；新建从模板（和它的第一个区域）起步；「自定义」全空。 */
function initialUrlsOf(input: {
  keyOwner: ApiEndpoint | null;
  template: ApiEndpointTemplate | null;
  region: ApiEndpointTemplateRegion | null;
}): Urls {
  if (input.keyOwner) return urlsOf(input.keyOwner.baseUrls ?? []);
  if (input.template) return urlsOf(templateBaseUrls(input.template, input.region));
  return EMPTY_URLS;
}

function templateBaseUrls(
  template: ApiEndpointTemplate,
  region: ApiEndpointTemplateRegion | null,
): ApiEndpointTemplate["baseUrls"] {
  return region?.baseUrls ?? template.baseUrls;
}

function urlsOf(baseUrls: ApiEndpointTemplate["baseUrls"]): Urls {
  const urls = { ...EMPTY_URLS };
  for (const entry of baseUrls) {
    const format = API_ENDPOINT_REQUEST_FORMATS.find((candidate) => candidate === entry.format);
    if (format) urls[format] = entry.url;
  }
  return urls;
}

const LOCAL_GROUP = "local";

/**
 * 本机服务的地址照 magpie localAddress：去掉首尾空白，不写协议按 http，只取协议、主机与端口（带上的路径不算）。
 * 空串是没填（不挪地址），为 ""；不是 http(s) 地址、带空白、端口不在 1–65535 为 null。原生端的 URL 实现不完整，用正则。
 */
function serverOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (/\s/.test(trimmed)) return null;
  const withScheme = trimmed.includes("://") ? trimmed : `http://${trimmed}`;
  const match = /^(https?):\/\/(\[[0-9a-f:.]+\]|[^/?#:@[\]]+)(?::(\d*))?(?:[/?#].*)?$/i.exec(
    withScheme,
  );
  if (!match) return null;
  const [, scheme, host, port] = match;
  if (port !== undefined && port !== "") {
    const number = Number(port);
    if (number < 1 || number > 65535) return null;
  }
  const portPart = port === undefined || port === "" ? "" : `:${port}`;
  return `${scheme.toLowerCase()}://${host.toLowerCase()}${portPart}`;
}

/** 开表单时地址所在的协议、主机与端口：照 magpie originOf 先看 Chat，再 Responses，最后 Anthropic；都没有为 ""。 */
function originOf(urls: Urls): string {
  for (const format of ["openai_chat", "openai_responses", "anthropic_messages"] as const) {
    const origin = urls[format] === "" ? null : serverOrigin(urls[format]);
    if (origin) return origin;
  }
  return "";
}

/** 每个地址换到 origin 上，路径不变（照 magpie atAddress）。 */
function atOrigin(urls: Urls, origin: string): Urls {
  const moved = { ...urls };
  for (const format of API_ENDPOINT_REQUEST_FORMATS) {
    moved[format] = urls[format].replace(/^[a-z][\w+.-]*:\/\/[^/?#]*/i, origin);
  }
  return moved;
}

// 线上 status 是字符串；认不出的新结论按「未检测到」显示。
function toLabel(status: string): FormatDetectionLabel {
  if (status === "ok" || status === "auth_failed") return status;
  return "not_detected";
}

/** 逐个模型识别的一个模型：认不出的格式不列。 */
function modelDetectionRowOf(row: ApiEndpointModelDetection): ModelDetectionRow {
  const cells = row.results.flatMap(detectedFormatOf);
  return { modelId: row.modelId, cells };
}

/** 主机给的一行检测结论；认不出的格式不列。 */
function detectedFormatOf(result: ApiEndpointFormatDetection): DetectedFormat[] {
  const format = API_ENDPOINT_REQUEST_FORMATS.find((candidate) => candidate === result.format);
  if (!format) return [];
  let message: string | null = null;
  if (result.message !== null) {
    message = conciseUpstreamMessage({ message: result.message, url: result.url });
  }
  const reason = detectionReasonOf(result);
  return [
    {
      format,
      url: result.url,
      label: toLabel(result.status),
      httpStatus: result.httpStatus,
      message,
      durationMs: result.durationMs ?? null,
      modelId: result.modelId ?? null,
      reason,
    },
  ];
}

/** 线上的原因码换成界面认得的；认不出的为 null。 */
function detectionReasonOf(result: ApiEndpointFormatDetection): DetectionReason | null {
  switch (result.code) {
    case "upstream_timeout":
      return { code: result.code, seconds: result.params?.seconds ?? "" };
    case "upstream_unreachable":
    case "models_list_failed":
      return { code: result.code, detail: result.params?.detail ?? "" };
    case "wrong_shape":
      return { code: result.code, format: result.params?.format ?? "" };
    case "batch_timeout":
    case "not_asked":
    case "image_model":
    case "no_model_to_try":
      return { code: result.code };
    case "invalid_header":
      return {
        code: result.code,
        name: result.params?.name ?? "",
        headerReason: result.params?.reason === "value" ? "value" : "name",
      };
    default:
      return null;
  }
}

/**
 * 上游失败原因的简写：去掉开头的「POST <地址>」（行上已写着地址），只把多出来的路径接在后面，
 * 如「HTTP 404: Not Found · /responses」。不是这种开头的原样。
 */
export function conciseUpstreamMessage(input: { message: string; url: string }): string {
  const match = /^(?:GET|POST) (\S+?): ([\s\S]*)$/.exec(input.message);
  if (!match) return input.message;
  const [, target, rest] = match;
  const base = trimSlashes(input.url);
  const path = target.startsWith(base) ? target.slice(base.length) : target;
  return path === "" ? rest : `${rest} · ${path}`;
}

function testOutcomeOf(input: {
  outcome: Exclude<ConnectionTestResult, { status: "cancelled" }>;
  url: string;
}): FormatTestOutcome {
  const { outcome, url } = input;
  if (outcome.status === "failed") {
    return { kind: "failed", status: null, message: outcome.message };
  }
  const { result } = outcome;
  if (result.ok) return { kind: "ok", durationMs: result.durationMs };
  const message = conciseUpstreamMessage({ message: result.error?.message ?? "", url });
  if (result.error?.code === "auth_failed") {
    return { kind: "authFailed", status: result.status, message };
  }
  return { kind: "failed", status: result.status, message };
}

function trimSlashes(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

// 原生端的 URL 实现不完整，用正则做粗校验；严格校验在 daemon。
const HTTP_URL = /^https?:\/\/[^\s/?#]+[^\s]*$/i;

function isHttpUrl(value: string): boolean {
  return HTTP_URL.test(value);
}
