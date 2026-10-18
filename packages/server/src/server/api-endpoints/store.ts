import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type pino from "pino";
import { z } from "zod";
import {
  API_ENDPOINT_REQUEST_FORMATS,
  ApiEndpointAgentSettingsSchema,
  ApiEndpointModelMappingSchema,
  type ApiEndpointAgentSettings,
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
 * - keys.json：API key，只有 daemon 读，任何 RPC 都不返回；
 * - takeover-claude.json：接管记录，含用户原先写在 settings.json 里的值（可能是别的 token）；
 * - takeover-codex.json：config.toml 的接管记录；
 * - codex-models.json：Codex 的 model_catalog_json，Codex 总开关开着时才有；
 * - models-dev.json：models.dev 模型资料的精简缓存（models-dev.ts），给 Claude Code 的模型提示与 Codex 的模型目录用；
 * - gateway-tokens.json：每个开过总开关的 Agent 一个中转站口令，只说明是哪个 Agent；关掉总开关不作废（ADR 0010）；
 * - retired-models.json：厂商说已下线的「接口 + 模型」与时间，一周内不进列表（retired-models.ts）；
 * - cli-rewrites.json：每个 Agent 最近一次改写 CLI 配置（含「重新应用」）的时刻，这之前 CLI 的使用不算「被绕过」（cli-bypass.ts）；
 * - gateway-seen.json：中转站最近一次收到每个 Agent 请求的时刻，重启后还在（cli-bypass.ts 的 GatewaySightings 读写）；
 * - backups/：首次改写前的完整副本，只供手动找回。
 * endpoints.json、keys.json、gateway-tokens.json 写坏时用上一份好的 .bak（last-good.ts）；
 * 接管记录不这样做：拿旧记录去恢复 CLI 配置可能恢复错值，读不懂照旧报错。
 * 不进 config.json，因为 get_daemon_config 会把 agents.providers 原样发给客户端。
 */

export const API_ENDPOINT_PROVIDERS = ["claude", "codex"] as const;
export type ApiEndpointProvider = (typeof API_ENDPOINT_PROVIDERS)[number];

const StoredModelSchema = z.object({ id: z.string(), label: z.string().optional() });

// 上游清单里的模型多带列表给的上下文、回复上限与思考档位；只留在 daemon 里，投影给客户端时去掉。
const StoredCatalogModelSchema = StoredModelSchema.extend({ facts: ModelFactsSchema.optional() });

const StoredBaseUrlSchema = z.object({
  format: z.enum(API_ENDPOINT_REQUEST_FORMATS),
  url: z.string(),
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
  // 「自己能联网搜索」：只写 true；没有或手改成 false 都是关（ADR 0009）。
  searchesWeb: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StoredApiEndpoint = z.infer<typeof StoredApiEndpointSchema>;

const EndpointsFileSchema = z.object({
  // 数组顺序即创建顺序。
  endpoints: z.array(StoredApiEndpointSchema),
  agents: z.record(z.string(), ApiEndpointAgentSettingsSchema),
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

const KeysFileSchema = z.object({ keys: z.record(z.string(), z.string()) });
type KeysFile = z.infer<typeof KeysFileSchema>;

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

const ENDPOINTS_FILE = "endpoints.json";
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
  private readonly endpointsFile: LastGoodFile<EndpointsFileContent>;
  private readonly keysFile: LastGoodFile<KeysFile>;
  private readonly gatewayTokensFile: LastGoodFile<GatewayTokensFile>;

  constructor(options: ApiEndpointStoreOptions) {
    this.root = path.join(options.paseoHome, "api-endpoints");
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
    const { agents } = content.file;
    return {
      endpoints: content.file.endpoints,
      agents: {
        claude: agents.claude ?? OFFICIAL_AGENT,
        codex: agents.codex ?? OFFICIAL_AGENT,
      },
    };
  }

  /** 每次都整份写新格式；旧格式的文件第一次写入后即升级。 */
  writeState(state: ApiEndpointState): void {
    this.endpointsFile.write(EndpointsFileSchema.parse(state));
  }

  setApiKey(id: string, apiKey: string): void {
    this.writeKeys({ ...this.readKeys(), [id]: apiKey });
  }

  removeApiKey(id: string): void {
    const { [id]: _removed, ...keys } = this.readKeys();
    this.writeKeys(keys);
  }

  getApiKey(id: string): string | null {
    return this.readKeys()[id] ?? null;
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

  private readKeys(): Record<string, string> {
    return this.keysFile.read()?.keys ?? {};
  }

  private writeKeys(keys: Record<string, string>): void {
    this.keysFile.write(KeysFileSchema.parse({ keys }));
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
