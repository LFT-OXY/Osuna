// 冷却设置里读不懂的每天时刻当没设移植自 magpie（https://github.com/yetone/magpie，internal/provider/concurrency.go 的 ParseResetAt 与 internal/provider/provider.go 的 normalize）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { CliTestClient } from "./test-as.js";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type pino from "pino";
import { z } from "zod";
import {
  apiEndpointNameDisplayOf,
  type ApiEndpointNameDisplay,
} from "@getpaseo/protocol/api-endpoint/endpoint-names";
import { parseResetAt } from "@getpaseo/protocol/api-endpoint/cooldown-settings";
import {
  API_ENDPOINT_REQUEST_FORMATS,
  ApiEndpointAgentSettingsSchema,
  ApiEndpointCooldownSettingsSchema,
  ApiEndpointLongConversationsSchema,
  ApiEndpointModelMappingSchema,
  ApiEndpointModelSettingsSchema,
  type ApiEndpointAgentSettings,
  type ApiEndpointLongConversations,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  AGENT_REQUEST_FORMAT,
  generateEndpointSlug,
  legacyAgentBaseUrl,
} from "./host-endpoints.js";
import { writePrivateFileAtomicSync } from "../private-files.js";
import { ClaudeSettingsTakeoverSchema } from "./claude-settings-patch.js";
import { CodexConfigTakeoverSchema } from "./codex-config-patch.js";
import { readOptionalFile } from "./config-file.js";
import { type DataFileSystem, LastGoodFile, NODE_DATA_FILE_SYSTEM } from "./last-good.js";
import { ModelFactsSchema } from "./model-facts.js";

/*
 * $PASEO_HOME/api-endpoints/ 下的私有文件，全部 0600：
 * - endpoints.json：主机共用的接口与每个 Agent 的总开关、默认模型，不含 key；
 * - keys.json：API key 与账户令牌（balanceTokens，查账户余额用），只有 daemon 读，RPC 只给打码（reveal_key、reveal_secret 除外）；
 * - takeover-claude.json：接管记录，含用户原先写在 settings.json 里的值（可能是别的 token）；
 * - takeover-codex.json：config.toml 的接管记录；
 * - codex-models.json：Codex 的 model_catalog_json，Codex 总开关开着时才有；
 * - codex-agent-versions.json：ChatGPT 给 Codex 自带模型的多 Agent 版本，缓存顶替清单时放回（codex-agent-versions.ts）；
 * - models-dev.json：models.dev 模型资料的精简缓存（models-dev.ts），给 Claude Code 的模型提示与 Codex 的模型目录用；
 * - gateway-tokens.json：每个开过总开关的 Agent 一个中转站口令，只说明是哪个 Agent；关掉总开关不作废（ADR 0010）；
 * - retired-models.json：厂商说已下线的「接口 + 模型」与时间，一周内不进列表（retired-models.ts）；
 * - balance-readings.json：每家最近一次成功的余额读数，暂时查不到时回它；不含 key（balance-last.ts）；
 * - cli-rewrites.json：每个 Agent 最近一次改写 CLI 配置（含「重新应用」）的时刻，这之前 CLI 的使用不算「被绕过」（cli-bypass.ts）；
 * - cli-start-reads.json：每个 Agent 启动时读、Osuna 替它写的那部分的摘要与它变成这样的时刻，这之前启动的副本要重开（reopen-hints.ts）；
 * - gateway-seen.json：中转站最近一次收到每个 Agent 请求的时刻，重启后还在（cli-bypass.ts 的 GatewaySightings 读写）；
 * - import-fingerprint-key.json：导入指纹的 HMAC 密钥，第一次扫描时随机取，重启后指纹不变、已忽略的发现照样认得（import-apps.ts）；
 * - icons/：「自定义」加的接口自选的图片，按内容起名，没有接口用就删（endpoint-icons.ts）；
 * - backups/：首次改写前的完整副本，只供手动找回。
 * endpoints.json、keys.json、gateway-tokens.json 写坏时用上一份好的 .bak（last-good.ts）；
 * 接管记录不这样做：拿旧记录去恢复 CLI 配置可能恢复错值，读不懂照旧报错。
 * 不进 config.json，因为 get_daemon_config 会把 agents.providers 原样发给客户端。
 */

export const API_ENDPOINT_PROVIDERS = ["claude", "codex"] as const;
export type ApiEndpointProvider = (typeof API_ENDPOINT_PROVIDERS)[number];

// 存下的 key 头：两个都放（缺省）不存。
const STORED_KEY_HEADERS = ["x-api-key", "bearer"] as const;

const StoredModelSchema = z.object({ id: z.string(), label: z.string().optional() });

// 上游清单里的模型多带列表给的上下文、回复上限与思考档位，以及哪些格式列过它（catalog-merge.ts）；
// 只留在 daemon 里，投影给客户端时去掉。
const StoredCatalogModelSchema = StoredModelSchema.extend({
  facts: ModelFactsSchema.optional(),
  formats: z.array(z.enum(API_ENDPOINT_REQUEST_FORMATS)).optional(),
});

const StoredBaseUrlSchema = z.object({
  format: z.enum(API_ENDPOINT_REQUEST_FORMATS),
  url: z.string(),
});

// 手改成读不懂的每天时刻当没设（照 magpie normalize 清掉 QuotaResetAt），别的项照留。
const StoredCooldownSettingsSchema = ApiEndpointCooldownSettingsSchema.extend({
  quotaResetAt: z
    .string()
    .refine((text) => parseResetAt(text).kind === "ok")
    .optional()
    .catch(undefined),
});

const StoredApiEndpointSchema = z.object({
  id: z.string(),
  // 从名称生成、建好即锁定，只在 Osuna 内部使用，任何响应都不带。
  slug: z.string(),
  name: z.string(),
  // 每种格式最多一个，按 API_ENDPOINT_REQUEST_FORMATS 的顺序，至少一个。
  baseUrls: z.array(StoredBaseUrlSchema).min(1),
  models: z.array(StoredModelSchema),
  // 每档都是 models 里的一个。
  modelMapping: ApiEndpointModelMappingSchema.optional(),
  // 接口开关，对所有 Agent 生效。
  enabled: z.boolean(),
  // 只给老客户端投影用：老表单上次为这家选的默认模型（迁移时取旧 defaultModelId）。
  legacyDefaultModelId: z.string().optional(),
  // 上次按格式向上游列出的模型，只供详情页挑选；路由与模型目录只看 models。
  catalog: z
    .object({ fetchedAt: z.string(), models: z.array(StoredCatalogModelSchema) })
    .optional(),
  // 用户手动添加的模型名，开没开都留着。
  manualModels: z.array(StoredModelSchema).optional(),
  // 服务范围：vendor「跟随接口清单」时 models 由 model-scope.ts 按清单算好写回；没有或别的值都当 picked。
  // 存成字符串：以后加了范围再降级时整个文件仍读得懂。
  modelScope: z.string().optional(),
  // 自动勾选规则（model-scope.ts），只在 picked 时起作用；没有即没有规则。
  autoPick: z.array(z.string()).optional(),
  // 模型设置（Model settings）：按模型 id 与整家默认手改的资料，取值顺序见 protocol 的 model-settings.ts；没有即都用自动取到的。
  modelSettings: ApiEndpointModelSettingsSchema.optional(),
  // 「自己能联网搜索」：只写 true；没有或手改成 false 都是关（ADR 0009）。
  searchesWeb: z.boolean().optional(),
  // 从哪个模板加的（templates.ts 的 id）、选的哪个区域或套餐；「自定义」加的都没有。
  templateId: z.string().optional(),
  region: z.string().optional(),
  // 「自定义」加的接口自选的图标：内置图标名，或 `file:<名字>` 指 icons/ 里的图片副本（endpoint-icons.ts）。
  icon: z.string().optional(),
  // 用户加给这家每个请求的请求头（名字照用户写的，值可能是密钥，不写日志）、附加请求体（JSON 对象）、
  // key 放哪个头（x-api-key、bearer；两个都放不存）。都没有即不加（request-extras.ts）。
  headers: z.record(z.string(), z.string()).optional(),
  extraBody: z.record(z.string(), z.unknown()).optional(),
  // 手改成别的值时当两个都放（照 magpie normalize），不让整个文件读不懂。
  keyHeader: z.enum(STORED_KEY_HEADERS).optional().catch(undefined),
  // 不校验证书（insecure-tls.ts）：只写 true；只对「自定义」加的接口自己的 https 主机起作用，模板接口手改成 true 也不算。
  insecureTls: z.boolean().optional().catch(undefined),
  // 冷却设置（gateway/cooldown.ts）：分钟数，0 不存；手改成别的类型时当没设，不让整个文件读不懂，越界的用时按 0 到八天算。
  cooldownSettings: StoredCooldownSettingsSchema.optional().catch(undefined),
  // 余额设置（balance.ts）：余额查询地址，方法只存 POST（GET 是缺省），取值写法与 new-api 的用户 ID 空着不存。
  // 没有地址即没有这项；手改成读不懂的当没设，不让整个文件读不懂。
  balance: z
    .object({
      url: z.string(),
      method: z.string().optional(),
      field: z.string().optional(),
      userId: z.string().optional(),
    })
    .optional()
    .catch(undefined),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StoredApiEndpoint = z.infer<typeof StoredApiEndpointSchema>;

const EndpointsFileSchema = z.object({
  // 数组顺序即接口顺序（Endpoint order）：用户可整体改写（set_order），新建的追加在最后。
  endpoints: z.array(StoredApiEndpointSchema),
  agents: z.record(z.string(), ApiEndpointAgentSettingsSchema),
  // 整台主机的长对话设置（完整窗口、全局压缩阈值）；没有即关着、272K。
  longConversations: ApiEndpointLongConversationsSchema.optional(),
  // 已禁用的模型（完整 id 或 glob，不分大小写）；没有即一个都没禁。
  disabledModels: z.array(z.string()).optional(),
  // 接口名显示方式（clash、never；always 不存）；没有即一直显示。
  endpointNameDisplay: z.string().optional(),
  // 发现提示里点了「忽略」的那几条的指纹（HMAC，不含 key 原文）；没有即一条都没忽略。
  ignoredImports: z.array(z.string()).optional(),
  // 「自动刷新余额与套餐用量」关着时存 false；没有即开着。
  balanceAutoRefresh: z.boolean().optional(),
});

/** v0.15.0 及以前：接口按提供方各存一份，每个提供方一家「当前启用」。读时换算，写时升级。 */
const LegacyEndpointsFileSchema = z.object({
  endpoints: z.array(
    z.object({
      id: z.string(),
      provider: z.enum(API_ENDPOINT_PROVIDERS),
      name: z.string(),
      baseUrl: z.string(),
      models: z.array(StoredModelSchema),
      defaultModelId: z.string(),
      modelMapping: ApiEndpointModelMappingSchema.optional(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
  active: z.record(z.string(), z.string()),
});
type LegacyEndpointsFile = z.infer<typeof LegacyEndpointsFileSchema>;

// endpoints.json 读得懂的两种样子；写回时 .bak 存的是写入前的原字节，所以旧格式的 .bak 也照样能用。
type EndpointsFileContent =
  | { kind: "current"; file: z.infer<typeof EndpointsFileSchema> }
  | { kind: "legacy"; file: LegacyEndpointsFile };

function parseEndpointsFile(filePath: string, raw: unknown): EndpointsFileContent {
  const current = EndpointsFileSchema.safeParse(raw);
  if (current.success) return { kind: "current", file: current.data };
  const legacy = LegacyEndpointsFileSchema.safeParse(raw);
  if (legacy.success) return { kind: "legacy", file: legacy.data };
  throw new ApiEndpointsFileUnparsableError(filePath, current.error.message);
}

export interface ApiEndpointState {
  endpoints: StoredApiEndpoint[];
  agents: Record<ApiEndpointProvider, ApiEndpointAgentSettings>;
  longConversations?: ApiEndpointLongConversations;
  disabledModels?: string[];
  // 接口名显示方式；always 不存。
  endpointNameDisplay?: Exclude<ApiEndpointNameDisplay, "always">;
  ignoredImports?: string[];
  balanceAutoRefresh?: boolean;
}

/** 文件里的接口名显示方式：没有或认不出的当 always，always 不放进状态。 */
function storedNameDisplay(raw: string | undefined): Pick<ApiEndpointState, "endpointNameDisplay"> {
  if (raw === undefined) return {};
  const display = apiEndpointNameDisplayOf(raw);
  return display === "always" ? {} : { endpointNameDisplay: display };
}

/** 主机的接口名显示方式：没存即 always。 */
export function endpointNameDisplayOf(state: ApiEndpointState): ApiEndpointNameDisplay {
  return state.endpointNameDisplay ?? "always";
}

const OFFICIAL_AGENT: ApiEndpointAgentSettings = { enabled: false, defaultModelId: null };

/** endpoints.json 存在却读不懂；这时什么都不写，免得把用户的接口覆盖掉。 */
export class ApiEndpointsFileUnparsableError extends Error {
  readonly filePath: string;

  constructor(filePath: string, detail: string) {
    super(`${filePath} could not be parsed: ${detail}`);
    this.name = "ApiEndpointsFileUnparsableError";
    this.filePath = filePath;
  }
}

const KeysFileSchema = z.object({
  keys: z.record(z.string(), z.string()),
  // 账户令牌，按接口 id；没有的接口不留条目。升级前的文件没有这一项。
  balanceTokens: z.record(z.string(), z.string()).optional(),
});
type KeysFile = z.infer<typeof KeysFileSchema>;

// 导入指纹的 HMAC 密钥（import-apps.ts）。
const IMPORT_FINGERPRINT_KEY_FILE = "import-fingerprint-key.json";
const ImportFingerprintKeyFileSchema = z.object({ secret: z.string().regex(/^[0-9a-f]{64}$/) });

// 上次关掉开关时的默认模型与关掉后 CLI 配置里留下的模型；再打开时 CLI 的模型没变过就放回（default-model-pick.ts 的 again）。
// 下一次接管时随整份记录重写而去掉。
const DefaultModelReconnectSchema = z.object({ model: z.string(), left: z.string().nullable() });

const ClaudeTakeoverFileSchema = z.object({
  // null：当前没有接管（官方模式）。
  takeover: ClaudeSettingsTakeoverSchema.nullable(),
  // 首次改写前的完整副本，整个生命周期只做一次。null：还没改写过；
  // path 为 null：首次改写时文件不存在，没有可备份的。
  backup: z.object({ path: z.string().nullable() }).nullable(),
  reconnect: DefaultModelReconnectSchema.optional(),
});
export type ClaudeTakeoverFile = z.infer<typeof ClaudeTakeoverFileSchema>;

// v0.15 的记录另有 providerTable（官方模式下留着的专用表属于哪个接口），读时丢掉；那张表启动时清理。
const CodexTakeoverFileSchema = z.object({
  // null：当前没有接管（官方模式）。
  takeover: CodexConfigTakeoverSchema.nullable(),
  backup: z.object({ path: z.string().nullable() }).nullable(),
  // 「保留当前设置」时 Osuna 的服务商表已被外部改过：这张表归用户，启动时不再改写，直到再打开开关（ADR 0012）。
  tableKept: z.boolean().optional(),
  reconnect: DefaultModelReconnectSchema.optional(),
});
export type CodexTakeoverFile = z.infer<typeof CodexTakeoverFileSchema>;

// 按 provider 存；发了就一直用，关掉总开关也不作废（ADR 0010）。没有条目即该 Agent 从没开过。
const GatewayTokensFileSchema = z.object({ tokens: z.record(z.string(), z.string()) });
type GatewayTokensFile = z.infer<typeof GatewayTokensFileSchema>;
export type GatewayTokens = GatewayTokensFile["tokens"];

// 每个 Agent 最近一次改写 CLI 配置的时刻（ISO 时间）；没有条目即这个 daemon 目录下没改写过。
const CliRewritesFileSchema = z.object({
  claude: z.string().datetime().optional(),
  codex: z.string().datetime().optional(),
});
type CliRewritesFile = z.infer<typeof CliRewritesFileSchema>;

// 每个 Agent 启动时读的那部分的摘要与它变成这样的时刻（magpie stash 的 "<agent>.started"）。
const CliStartReadSchema = z.object({ digest: z.string(), at: z.string().datetime() });
const CliStartReadsFileSchema = z.object({
  claude: CliStartReadSchema.optional(),
  codex: CliStartReadSchema.optional(),
});
type CliStartReadsFile = z.infer<typeof CliStartReadsFileSchema>;

/** 启动时读的那部分的摘要，和它从什么时候起是这样的。 */
export interface CliStartRead {
  digest: string;
  at: Date;
}

// CLI 请求头样本：头名小写，只有表明 CLI 身份的头，不含认证、会话与请求体（cli-header-samples.ts）。
const CliHeaderSampleSchema = z.record(z.string(), z.string());
export type CliHeaderSample = z.infer<typeof CliHeaderSampleSchema>;
const CliHeaderSamplesFileSchema = z.object({
  claude_code: CliHeaderSampleSchema.optional(),
  codex: CliHeaderSampleSchema.optional(),
});
type CliHeaderSamplesFile = z.infer<typeof CliHeaderSamplesFileSchema>;

const ENDPOINTS_FILE = "endpoints.json";
const CLI_HEADER_SAMPLES_FILE = "cli-header-samples.json";
const CLI_START_READS_FILE = "cli-start-reads.json";
const CLI_REWRITES_FILE = "cli-rewrites.json";
const CODEX_MODEL_CATALOG_FILE = "codex-models.json";
const CODEX_AGENT_VERSIONS_FILE = "codex-agent-versions.json";
// v0.15 让 Codex 通过 auth.command 读 key 的文件；现在不再写，见到就删。
// COMPAT(codexLegacyProviderTable): added after v0.15.0, remove after 2027-04-14.
const LEGACY_CODEX_KEY_FILE = "codex-api-key";

export interface ApiEndpointStoreOptions {
  paseoHome: string;
  logger: pino.Logger;
  // 只给测试换：.bad-<时间> 用的时钟、模拟占用的文件系统。
  now?: () => Date;
  fileSystem?: DataFileSystem;
}

export class ApiEndpointStore {
  private readonly root: string;
  private readonly logger: pino.Logger;
  private readonly endpointsFile: LastGoodFile<EndpointsFileContent>;
  private readonly keysFile: LastGoodFile<KeysFile>;
  private readonly gatewayTokensFile: LastGoodFile<GatewayTokensFile>;

  constructor(options: ApiEndpointStoreOptions) {
    this.root = path.join(options.paseoHome, "api-endpoints");
    this.logger = options.logger;
    const shared = {
      logger: options.logger,
      now: options.now ?? (() => new Date()),
      fileSystem: options.fileSystem ?? NODE_DATA_FILE_SYSTEM,
    };
    const endpointsPath = path.join(this.root, ENDPOINTS_FILE);
    this.endpointsFile = new LastGoodFile({
      ...shared,
      filePath: endpointsPath,
      parse: (raw) => parseEndpointsFile(endpointsPath, raw),
    });
    this.keysFile = new LastGoodFile({
      ...shared,
      filePath: path.join(this.root, "keys.json"),
      parse: (raw) => KeysFileSchema.parse(raw),
    });
    this.gatewayTokensFile = new LastGoodFile({
      ...shared,
      filePath: path.join(this.root, "gateway-tokens.json"),
      parse: (raw) => GatewayTokensFileSchema.parse(raw),
    });
  }

  /** $PASEO_HOME/api-endpoints/。 */
  get endpointsDir(): string {
    return this.root;
  }

  /** 把首次改写前的字节原样存一份，返回副本路径；文件不存在时返回 null。 */
  writeClaudeSettingsBackup(bytes: Buffer | null, at: Date): string | null {
    return this.writeBackup({ bytes, at, prefix: "claude-settings", extension: "json" });
  }

  writeCodexConfigBackup(bytes: Buffer | null, at: Date): string | null {
    return this.writeBackup({ bytes, at, prefix: "codex-config", extension: "toml" });
  }

  /** 收回一份没能记进接管记录的副本。 */
  discardBackup(backupPath: string): void {
    rmSync(backupPath, { force: true });
  }

  readState(): ApiEndpointState {
    let content: EndpointsFileContent | null;
    try {
      content = this.endpointsFile.read();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ApiEndpointsFileUnparsableError(
          path.join(this.root, ENDPOINTS_FILE),
          error.message,
        );
      }
      throw error;
    }
    if (content === null) {
      return { endpoints: [], agents: { claude: OFFICIAL_AGENT, codex: OFFICIAL_AGENT } };
    }
    if (content.kind === "legacy") return upgradeLegacyFile(content.file);
    const {
      agents,
      longConversations,
      disabledModels,
      endpointNameDisplay,
      ignoredImports,
      balanceAutoRefresh,
    } = content.file;
    return {
      endpoints: content.file.endpoints,
      agents: {
        claude: agents.claude ?? OFFICIAL_AGENT,
        codex: agents.codex ?? OFFICIAL_AGENT,
      },
      ...(longConversations === undefined ? {} : { longConversations }),
      ...(disabledModels === undefined ? {} : { disabledModels }),
      ...storedNameDisplay(endpointNameDisplay),
      ...(ignoredImports === undefined ? {} : { ignoredImports }),
      ...(balanceAutoRefresh === undefined ? {} : { balanceAutoRefresh }),
    };
  }

  /** 每次都整份写新格式；旧格式的文件第一次写入后即升级。 */
  writeState(state: ApiEndpointState): void {
    this.endpointsFile.write(EndpointsFileSchema.parse(state));
  }

  /**
   * 导入指纹的 HMAC 密钥；还没有、或读不懂时随机取一把存下（0600），之前忽略的发现随之不再认得（再提示）。
   * 读不了（没权限等）照样抛出。
   */
  readImportFingerprintSecret(): Buffer {
    let raw: unknown = null;
    try {
      raw = this.readJson(IMPORT_FINGERPRINT_KEY_FILE);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      raw = undefined;
    }
    const parsed = ImportFingerprintKeyFileSchema.safeParse(raw);
    if (parsed.success) return Buffer.from(parsed.data.secret, "hex");
    if (raw !== null) {
      this.logger.warn(
        { file: IMPORT_FINGERPRINT_KEY_FILE },
        "Import fingerprint key file could not be parsed; a new key replaces it and ignored entries come back",
      );
    }
    const secret = randomBytes(32);
    this.writeJson(IMPORT_FINGERPRINT_KEY_FILE, { secret: secret.toString("hex") });
    return secret;
  }

  setApiKey(id: string, apiKey: string): void {
    this.writeKeys({ ...this.readKeys(), [id]: apiKey });
  }

  removeApiKey(id: string): void {
    const { [id]: _removed, ...keys } = this.readKeys();
    this.writeKeys(keys);
  }

  /** 接口删掉了：它的 key 与账户令牌一起删。 */
  removeSecrets(id: string): void {
    const file = this.readKeysFile();
    const { [id]: _removed, ...keys } = file.keys;
    const { [id]: _token, ...balanceTokens } = file.balanceTokens ?? {};
    this.writeKeysFile({ keys, balanceTokens });
  }

  getApiKey(id: string): string | null {
    return this.readKeys()[id] ?? null;
  }

  getBalanceToken(id: string): string | null {
    return this.readKeysFile().balanceTokens?.[id] ?? null;
  }

  /** null 清掉。 */
  setBalanceToken(id: string, token: string | null): void {
    const file = this.readKeysFile();
    const { [id]: _previous, ...rest } = file.balanceTokens ?? {};
    this.writeKeysFile({
      ...file,
      balanceTokens: token === null ? rest : { ...rest, [id]: token },
    });
  }

  readGatewayTokens(): GatewayTokens {
    return this.gatewayTokensFile.read()?.tokens ?? {};
  }

  /** 两个 Agent 都关着时没有口令，文件连同 .bak 删掉。 */
  writeGatewayTokens(tokens: GatewayTokens): void {
    if (Object.keys(tokens).length === 0) {
      this.gatewayTokensFile.remove();
      return;
    }
    this.gatewayTokensFile.write(GatewayTokensFileSchema.parse({ tokens }));
  }

  /** 最近一次改写这个 Agent 的 CLI 配置的时刻；没改写过、或文件读不懂（只影响提示）为 null。 */
  readCliRewrittenAt(provider: ApiEndpointProvider): Date | null {
    const at = this.readCliRewrites()[provider];
    if (at === undefined) return null;
    return new Date(at);
  }

  recordCliRewrite(input: { provider: ApiEndpointProvider; at: Date }): void {
    const next = { ...this.readCliRewrites(), [input.provider]: input.at.toISOString() };
    this.writeJson(CLI_REWRITES_FILE, CliRewritesFileSchema.parse(next));
  }

  /** 上次见到的、这个 Agent 启动时读的那部分；没见过、或文件读不懂（只影响提示）为 null。 */
  readCliStartRead(provider: ApiEndpointProvider): CliStartRead | null {
    const entry = this.readCliStartReads()[provider];
    if (entry === undefined) return null;
    return { digest: entry.digest, at: new Date(entry.at) };
  }

  writeCliStartRead(input: { provider: ApiEndpointProvider; read: CliStartRead }): void {
    const entry = { digest: input.read.digest, at: input.read.at.toISOString() };
    const next = { ...this.readCliStartReads(), [input.provider]: entry };
    this.writeJson(CLI_START_READS_FILE, CliStartReadsFileSchema.parse(next));
  }

  /** 这个 CLI 最近一次经过中转站时记下的请求头；还没经过、或文件读不懂为 null。 */
  readCliHeaderSample(client: CliTestClient): CliHeaderSample | null {
    return this.readCliHeaderSamples()[client] ?? null;
  }

  writeCliHeaderSample(input: { client: CliTestClient; sample: CliHeaderSample }): void {
    const next = { ...this.readCliHeaderSamples(), [input.client]: input.sample };
    this.writeJson(CLI_HEADER_SAMPLES_FILE, CliHeaderSamplesFileSchema.parse(next));
  }

  readClaudeTakeover(): ClaudeTakeoverFile {
    const raw = this.readJson("takeover-claude.json");
    return raw === null ? { takeover: null, backup: null } : ClaudeTakeoverFileSchema.parse(raw);
  }

  writeClaudeTakeover(file: ClaudeTakeoverFile): void {
    this.writeJson("takeover-claude.json", ClaudeTakeoverFileSchema.parse(file));
  }

  readCodexTakeover(): CodexTakeoverFile {
    const raw = this.readJson("takeover-codex.json");
    return raw === null ? { takeover: null, backup: null } : CodexTakeoverFileSchema.parse(raw);
  }

  writeCodexTakeover(file: CodexTakeoverFile): void {
    this.writeJson("takeover-codex.json", CodexTakeoverFileSchema.parse(file));
  }

  get modelsDevPath(): string {
    return path.join(this.root, "models-dev.json");
  }

  get retiredModelsPath(): string {
    return path.join(this.root, "retired-models.json");
  }

  /** ChatGPT 给 Codex 的自带模型原来的多 Agent 版本（codex-agent-versions.ts）。 */
  get codexAgentVersionsPath(): string {
    return path.join(this.root, CODEX_AGENT_VERSIONS_FILE);
  }

  get codexModelCatalogPath(): string {
    return path.join(this.root, CODEX_MODEL_CATALOG_FILE);
  }

  readCodexModelCatalog(): string | null {
    return readOptionalFile(this.codexModelCatalogPath)?.toString("utf8") ?? null;
  }

  /** null 表示删掉。 */
  writeCodexModelCatalog(text: string | null): void {
    if (text === null) {
      rmSync(this.codexModelCatalogPath, { force: true });
      return;
    }
    writePrivateFileAtomicSync(this.codexModelCatalogPath, text);
  }

  removeLegacyCodexKeyFile(): void {
    rmSync(path.join(this.root, LEGACY_CODEX_KEY_FILE), { force: true });
  }

  private writeBackup(input: {
    bytes: Buffer | null;
    at: Date;
    prefix: string;
    extension: string;
  }): string | null {
    if (input.bytes === null) return null;
    const stamp = input.at.toISOString().replaceAll(":", "-");
    const backupPath = path.join(
      this.root,
      "backups",
      `${input.prefix}.${stamp}.${input.extension}`,
    );
    writePrivateFileAtomicSync(backupPath, input.bytes);
    return backupPath;
  }

  private readCliRewrites(): CliRewritesFile {
    let raw: unknown;
    try {
      raw = this.readJson(CLI_REWRITES_FILE);
    } catch (error) {
      if (error instanceof SyntaxError) return {};
      throw error;
    }
    const parsed = CliRewritesFileSchema.safeParse(raw ?? {});
    if (!parsed.success) return {};
    return parsed.data;
  }

  private readCliHeaderSamples(): CliHeaderSamplesFile {
    let raw: unknown;
    try {
      raw = this.readJson(CLI_HEADER_SAMPLES_FILE);
    } catch (error) {
      if (error instanceof SyntaxError) return {};
      throw error;
    }
    const parsed = CliHeaderSamplesFileSchema.safeParse(raw ?? {});
    if (!parsed.success) return {};
    return parsed.data;
  }

  private readCliStartReads(): CliStartReadsFile {
    let raw: unknown;
    try {
      raw = this.readJson(CLI_START_READS_FILE);
    } catch (error) {
      if (error instanceof SyntaxError) return {};
      throw error;
    }
    const parsed = CliStartReadsFileSchema.safeParse(raw ?? {});
    if (!parsed.success) return {};
    return parsed.data;
  }

  private readKeys(): Record<string, string> {
    return this.readKeysFile().keys;
  }

  private writeKeys(keys: Record<string, string>): void {
    this.writeKeysFile({ ...this.readKeysFile(), keys });
  }

  private readKeysFile(): KeysFile {
    return this.keysFile.read() ?? { keys: {} };
  }

  private writeKeysFile(file: KeysFile): void {
    const { balanceTokens, ...rest } = file;
    const hasTokens = balanceTokens !== undefined && Object.keys(balanceTokens).length > 0;
    this.keysFile.write(KeysFileSchema.parse(hasTokens ? { ...rest, balanceTokens } : rest));
  }

  private readJson(name: string): unknown {
    let text: string;
    try {
      text = readFileSync(path.join(this.root, name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    return JSON.parse(text) as unknown;
  }

  private writeJson(name: string, value: unknown): void {
    writePrivateFileAtomicSync(path.join(this.root, name), `${JSON.stringify(value, null, 2)}\n`);
  }
}

/**
 * 旧格式换算：baseUrl 按旧 provider 落进对应格式；某 Agent 当前启用的接口开着、该 Agent 总开关打开、
 * 默认模型取那家旧的默认模型；其余旧接口关着，和迁移前「只是存着」一样。
 */
function upgradeLegacyFile(file: LegacyEndpointsFile): ApiEndpointState {
  const activeIds = new Set(Object.values(file.active));
  const slugs = new Set<string>();
  const endpoints = file.endpoints.map((legacy): StoredApiEndpoint => {
    const slug = generateEndpointSlug(legacy.name, slugs);
    slugs.add(slug);
    return {
      id: legacy.id,
      slug,
      name: legacy.name,
      baseUrls: [
        {
          format: AGENT_REQUEST_FORMAT[legacy.provider],
          url: legacyAgentBaseUrl(legacy.provider, legacy.baseUrl),
        },
      ],
      models: legacy.models,
      ...(legacy.modelMapping ? { modelMapping: legacy.modelMapping } : {}),
      enabled: activeIds.has(legacy.id),
      legacyDefaultModelId: legacy.defaultModelId,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
    };
  });
  const agents = { claude: OFFICIAL_AGENT, codex: OFFICIAL_AGENT };
  for (const provider of API_ENDPOINT_PROVIDERS) {
    const active = file.endpoints.find(
      (legacy) => legacy.provider === provider && legacy.id === file.active[provider],
    );
    if (active) agents[provider] = { enabled: true, defaultModelId: active.defaultModelId };
  }
  return { endpoints, agents };
}
