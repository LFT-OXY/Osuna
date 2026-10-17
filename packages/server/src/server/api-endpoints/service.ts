import { randomBytes, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import type pino from "pino";
import {
  API_ENDPOINT_MODEL_TIERS,
  API_ENDPOINT_REQUEST_FORMATS,
  apiEndpointHasModelMapping,
  type ApiEndpoint,
  type ApiEndpointAgentSettings,
  type ApiEndpointBaseUrl,
  type ApiEndpointCooldown,
  type ApiEndpointFormatDetection,
  type ApiEndpointHealthIssue,
  type ApiEndpointListResponse,
  type ApiEndpointModel,
  type ApiEndpointModelMapping,
  type ApiEndpointRef,
  type ApiEndpointRequestFormat,
  type ApiEndpointTestConnectionResult,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { resolveAgentHookConfigPath } from "../../terminal/agent-hooks/agent-hook-installer.js";
import { claudeAgentHookProvider } from "../../terminal/agent-hooks/claude/claude.js";
import { codexAgentHookProvider } from "../../terminal/agent-hooks/codex/codex.js";
import type { AgentModelDefinition, ApiEndpointModelGroup } from "../agent/agent-sdk-types.js";
import { normalizeOpenAICompatibleBaseUrl } from "../agent/providers/codex-app-server-agent.js";
import { claudeHintEnv, markOneMillion, type ClaudeHintModel } from "./claude-model-hints.js";
import {
  applyClaudeApiEndpoint,
  inspectClaudeSettings,
  restoreClaudeOfficial,
  type ClaudeGatewayWiring,
  type ClaudeSettingsTakeover,
} from "./claude-settings-patch.js";
import {
  applyCodexApiEndpoint,
  inspectCodexConfig,
  readCodexReasoningEffort,
  removeCodexProviderTable,
  restoreCodexOfficial,
  type CodexConfigTakeover,
} from "./codex-config-patch.js";
import { buildCodexModelCatalog } from "./codex-model-catalog.js";
import type { EndpointCooldowns } from "./gateway/cooldown.js";
import type { RetiredModels } from "./retired-models.js";
import { API_ENDPOINT_GATEWAY_PATH } from "./gateway/gateway.js";
import {
  readOptionalFile,
  writeConfigFileGuarded,
  type ConfigFileChange,
  type ConfigFilePlan,
} from "./config-file.js";
import {
  AGENT_REQUEST_FORMAT,
  agentTargetEndpoint,
  findEndpoint,
  generateEndpointSlug,
  legacyAgentBaseUrl,
  projectedBaseUrl,
  projectedDefaultModelId,
  settleAgentSettings,
  endpointModelGroups,
  type EndpointGroupModel,
  usableModels,
} from "./host-endpoints.js";
import {
  API_ENDPOINT_PROVIDERS,
  ApiEndpointStore,
  ApiEndpointsFileUnparsableError,
  type ApiEndpointProvider,
  type ApiEndpointState,
  type GatewayTokens,
  type StoredApiEndpoint,
} from "./store.js";
import { testUpstreamConnection } from "./upstream-connection.js";
import { detectUpstreamFormats, pickProbeModel, probeUpstreamFormat } from "./upstream-detect.js";
import { hostOf, mergeModelFacts, type ModelFacts } from "./model-facts.js";
import { ModelsDevCatalog } from "./models-dev.js";
import {
  fetchUpstreamModels,
  type ListedModel,
  type UpstreamFailureCode,
} from "./upstream-models.js";

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
  | UpstreamFailureCode;

const DEFAULT_UPSTREAM_TIMEOUT_MS = 15_000;
// Codex 的自定义 provider 地址要带上它，Claude Code 的不带。
const CODEX_GATEWAY_SUFFIX = "/v1";
// 测试连接要等模型真正回一句话，比列出模型慢。
const DEFAULT_CONNECTION_TEST_TIMEOUT_MS = 30_000;

export class ApiEndpointRequestError extends Error {
  readonly code: ApiEndpointErrorCode;

  constructor(code: ApiEndpointErrorCode, message: string) {
    super(message);
    this.name = "ApiEndpointRequestError";
    this.code = code;
  }
}

/**
 * 新客户端带 baseUrls；老客户端带 baseUrl（按 provider 落进对应格式）与 defaultModelId。
 * 两种都没有就拒绝。
 */
export interface ApiEndpointSaveInput {
  endpointId?: string;
  name: string;
  baseUrl?: string;
  baseUrls?: ApiEndpointBaseUrl[];
  // undefined 或空白：更新时保留原 key。
  apiKey?: string;
  models: ApiEndpointModel[];
  defaultModelId?: string;
  modelMapping?: ApiEndpointModelMapping;
  // undefined：保留这家已有的手动添加模型。
  manualModels?: ApiEndpointModel[];
}

export interface ApiEndpointAgentSettingsInput {
  enabled: boolean;
  defaultModelId?: string;
}

export interface ApiEndpointStateInput {
  endpointId: string;
  enabled?: boolean;
  clearCooldown?: boolean;
}

// 拉取模型和测试连接都要的上游地址与 key。
export interface ApiEndpointUpstreamInput {
  // 编辑已保存的接口时带上；apiKey 留空就用它已保存的 key。
  endpointId?: string;
  baseUrl: string;
  apiKey?: string;
  // 新客户端按「地址 + 格式」请求；不带时按 provider 走 CLI 自己的格式。
  format?: string;
}

export interface ApiEndpointTestConnectionInput extends ApiEndpointUpstreamInput {
  // 按格式测试时可省，daemon 自己挑。
  modelId?: string;
}

export interface ApiEndpointServiceOptions {
  paseoHome: string;
  logger: pino.Logger;
  // 中转站记下的冷却；列表显示它，「立刻恢复」、编辑连接与删除清掉它。
  cooldowns: EndpointCooldowns;
  // 中转站记下的已下线模型；给 Agent 选模型的列表都去掉它们，接口页与默认模型不受影响。
  retiredModels: RetiredModels;
  // 定位 CLI 配置文件用；缺省取 daemon 自己的环境，测试注入临时目录。
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  now?: () => Date;
  // 某个 Agent 的总开关、默认模型、可用模型或指向的接口变了之后调用；daemon 据此刷新该提供方的快照。
  onActiveEndpointChanged?: (provider: ApiEndpointProvider) => void;
  // 该提供方下还活着的 Agent session 数；改写 CLI 配置会影响到它们，列表查询时带给 App 写进确认框。
  countLiveSessions: (provider: ApiEndpointProvider) => number;
  upstreamTimeoutMs?: number;
  connectionTestTimeoutMs?: number;
  // 价格表的自动更新开关：开着才下载 models.dev（另外还要 Claude Code 总开关开着）；缺省不下载。
  isModelsDevAutoUpdate?: () => boolean;
  // 改写 CLI 配置时，落下接管记录之后、替换前重读比对之前调用。
  // 只给进程内 daemon 测试模拟「别的工具同时在改这份文件」，生产不传。
  beforeConfigRecheck?: (filePath: string) => void;
}

/** 线上 `code` 是字符串；daemon 这一侧只会发这几种。 */
type ApiEndpointHealthCode = "modified_externally" | "config_unparsable" | "codex_profile_override";

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
  >
>;

/**
 * 总开关开着时 CLI 配置里写的一切：daemon 中转站地址、该 Agent 的口令、新会话的起始模型。
 * Claude 原样写；Codex 地址补 /v1，另写模型目录路径。
 */
type CliWiring = ClaudeGatewayWiring;

/** CLI 配置里上次写进去的中转站地址与口令。 */
interface WrittenGateway {
  url: string;
  token: string;
}

/** daemon 绑定端口之后才知道中转站地址；不在 TCP 上监听时没有地址。 */
type GatewayAddress = { kind: "pending" } | { kind: "bound"; url: string } | { kind: "socket" };

interface ApiEndpointFileStatus {
  health: HealthIssue[];
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
  private readonly now: () => Date;
  private readonly onActiveEndpointChanged: (provider: ApiEndpointProvider) => void;
  private readonly countLiveSessions: (provider: ApiEndpointProvider) => number;
  private readonly upstreamTimeoutMs: number;
  private readonly connectionTestTimeoutMs: number;
  private readonly beforeConfigRecheck: ((filePath: string) => void) | undefined;
  private readonly cooldowns: EndpointCooldowns;
  private readonly retiredModels: RetiredModels;
  private readonly modelsDev: ModelsDevCatalog;
  private queue: Promise<unknown> = Promise.resolve();
  private gateway: GatewayAddress = { kind: "pending" };

  constructor(options: ApiEndpointServiceOptions) {
    this.logger = options.logger.child({ module: "api-endpoints" });
    this.store = new ApiEndpointStore({ paseoHome: options.paseoHome, logger: this.logger });
    this.env = options.env ?? process.env;
    this.homeDir = options.homeDir ?? homedir();
    this.now = options.now ?? (() => new Date());
    this.onActiveEndpointChanged = options.onActiveEndpointChanged ?? (() => undefined);
    this.countLiveSessions = options.countLiveSessions;
    this.upstreamTimeoutMs = options.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
    this.connectionTestTimeoutMs =
      options.connectionTestTimeoutMs ?? DEFAULT_CONNECTION_TEST_TIMEOUT_MS;
    this.beforeConfigRecheck = options.beforeConfigRecheck;
    this.cooldowns = options.cooldowns;
    this.retiredModels = options.retiredModels;
    const isModelsDevAutoUpdate = options.isModelsDevAutoUpdate ?? (() => false);
    this.modelsDev = new ModelsDevCatalog({
      filePath: this.store.modelsDevPath,
      logger: this.logger,
      isAllowed: () =>
        isModelsDevAutoUpdate() && this.readStateForSnapshot()?.agents.claude.enabled === true,
      onUpdated: () => {
        void this.refreshClaudeHints();
      },
    });
    this.modelsDev.start();
  }

  /**
   * 列表连同健康状态：每次都读真实文件，负责的键不再是上次写入的值就报「已被外部修改」。
   * 只在这里和写入时检测，不在后台监听文件。接口是主机共用的；provider 只决定投影字段怎么换算。
   */
  async list(provider: string): Promise<ApiEndpointListResult> {
    const supported = requireProvider(provider);
    const state = this.readState();
    const enabled = state.agents[supported].enabled;
    const status = supported === "codex" ? this.inspectCodex(enabled) : this.inspectClaude(enabled);
    return {
      endpoints: state.endpoints.map((endpoint) => this.toWire(state, endpoint, supported)),
      activeEndpointId: agentTargetEndpoint(state, supported)?.id ?? null,
      agents: state.agents,
      health: status.health,
      cliBaseUrl: enabled ? null : status.baseUrl,
      runningSessionCount: this.countLiveSessions(supported),
      gatewayUnavailable: this.gatewayUnavailable(),
    };
  }

  /**
   * daemon 绑定端口之后调用；`url` 为 null 表示不在 TCP 上监听，中转站用不了，总开关打不开。
   * 开着总开关的 Agent 没有口令就补一个（旧数据换算来的从没经历「从关到开」），
   * CLI 配置里的中转站地址或口令不是现在的就重写，其它内容不动；Codex 的模型目录跟着补齐。
   * 官方模式下清掉旧版本留下的专用表与 key 文件。出错只记日志，不挡 daemon 启动。
   */
  attachGateway(url: string | null): Promise<void> {
    return this.exclusive(() => {
      this.gateway = url === null ? { kind: "socket" } : { kind: "bound", url };
      const state = this.readStateForSnapshot();
      if (!state) return;
      const current = this.store.readGatewayTokens();
      // 前后是同一个状态：只给开着却没有口令的补上。
      const tokens = nextGatewayTokens(state, state, current);
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
    });
  }

  activeEndpointId(provider: string): string | null {
    return agentTargetEndpoint(this.readState(), requireProvider(provider))?.id ?? null;
  }

  agentSettings(provider: string): ApiEndpointAgentSettings {
    return this.readState().agents[requireProvider(provider)];
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
    return usableModels(this.retiredModels.listed(state)).map((model) => ({
      provider: supported,
      id: model.id,
      label: model.label ?? model.id,
      isDefault: model.id === agent.defaultModelId,
    }));
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
    let defaultMarked = false;
    function toDefinition({ id, model }: EndpointGroupModel): AgentModelDefinition {
      const isDefault = !defaultMarked && model.id === agent.defaultModelId;
      if (isDefault) defaultMarked = true;
      const label = model.label ?? model.id;
      return { provider: agentProvider, id, label, isDefault };
    }
    return endpointModelGroups(this.retiredModels.listed(state)).map((group) => {
      const models = group.models.map(toDefinition);
      return { name: group.endpoint.name, models };
    });
  }

  save(provider: string, input: ApiEndpointSaveInput): Promise<ApiEndpoint> {
    return this.exclusive(async () => {
      const supported = requireProvider(provider);
      const state = this.readState();
      const existing = input.endpointId ? findEndpoint(state, input.endpointId) : null;
      if (input.endpointId && !existing) {
        throw new ApiEndpointRequestError("not_found", "API endpoint not found");
      }
      const apiKey = input.apiKey?.trim() ? input.apiKey.trim() : undefined;
      if (!existing && !apiKey) {
        throw new ApiEndpointRequestError("invalid_input", "API key is required");
      }
      const isLegacyForm = input.baseUrls === undefined;
      const fields = isLegacyForm
        ? validateLegacyFields(supported, input, existing)
        : validateFields(input.baseUrls ?? [], input);
      const endpoint = buildEndpoint({
        state,
        existing,
        fields,
        // 新客户端建的接口默认开着；老客户端建的要等 set_active 才开，和以前「保存不启用」一样。
        enabledWhenNew: !isLegacyForm,
        timestamp: this.now().toISOString(),
      });
      const endpoints = withEndpoint(state.endpoints, endpoint);
      let agents = state.agents;
      // 老客户端编辑它眼里启用中的接口：表单里的默认模型就是该 Agent 的默认模型。
      const editsActiveEndpoint =
        existing !== null && agentTargetEndpoint(state, supported)?.id === existing.id;
      if (isLegacyForm && editsActiveEndpoint) {
        agents = {
          ...agents,
          [supported]: { enabled: true, defaultModelId: fields.legacyDefaultModelId ?? null },
        };
      }
      const next = await this.commit(
        state,
        { endpoints, agents },
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
      return this.toWire(next, endpoint, supported);
    });
  }

  /** 接口是主机共用的，删除对所有 Agent 生效；返回值按 provider 投影。 */
  delete(provider: string, endpointId: string): Promise<{ activeEndpointId: string | null }> {
    return this.exclusive(async () => {
      const supported = requireProvider(provider);
      const state = this.readState();
      if (!findEndpoint(state, endpointId)) {
        throw new ApiEndpointRequestError("not_found", "API endpoint not found");
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
    return this.exclusive(async () => {
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
      if (!endpoint || this.store.getApiKey(endpointId) === null) {
        throw new ApiEndpointRequestError("not_found", "API endpoint not found");
      }
      if (endpoint.models.length === 0) {
        throw new ApiEndpointRequestError(
          "no_usable_model",
          "This endpoint has no models selected",
        );
      }
      const defaultModelId = projectedDefaultModelId(state.agents[supported], endpoint);
      const next = await this.commit(
        state,
        {
          endpoints: withEndpoint(state.endpoints, { ...endpoint, enabled: true }),
          agents: { ...state.agents, [supported]: { enabled: true, defaultModelId } },
        },
        { rewrite: supported },
      );
      return { activeEndpointId: agentTargetEndpoint(next, supported)?.id ?? null };
    });
  }

  /**
   * 「使用第三方接口」总开关与默认模型。打开要求至少一家接口开着且已选模型；
   * 省略默认模型时保留当前的（还能用的话），否则取最早开着接口的第一个已选模型。关掉时忽略默认模型。
   */
  setAgentSettings(
    provider: string,
    input: ApiEndpointAgentSettingsInput,
  ): Promise<ApiEndpointAgentSettings> {
    return this.exclusive(async () => {
      const supported = requireProvider(provider);
      const state = this.readState();
      const agent = input.enabled
        ? enabledAgentSettings(state, supported, input.defaultModelId?.trim())
        : // 关掉总开关从不被拒；默认模型留着，下次打开时还能用就沿用。
          { ...state.agents[supported], enabled: false };
      const next = await this.commit(state, {
        ...state,
        agents: { ...state.agents, [supported]: agent },
      });
      return next.agents[supported];
    });
  }

  /** 接口开关与「立刻恢复」。关掉开关按默认模型失踪规则处理各 Agent。 */
  setEndpointState(input: ApiEndpointStateInput): Promise<void> {
    return this.exclusive(async () => {
      const state = this.readState();
      const endpoint = findEndpoint(state, input.endpointId);
      if (!endpoint) {
        throw new ApiEndpointRequestError("not_found", "API endpoint not found");
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
   * 落下一次变更：先按默认模型失踪规则整理各 Agent，再让 Codex 模型目录与 CLI 配置跟上（改不成就整个不保存），
   * 最后写 key、endpoints.json 与口令，并通知设置有变的 Agent。返回落下的状态。
   * 口令跟着总开关走：从关到开换一个新口令，开着却没有就补一个，关掉即作废。
   */
  private async commit(
    previous: ApiEndpointState,
    proposed: ApiEndpointState,
    options: {
      keys?: Record<string, string>;
      // 老客户端的「重新应用」：内容没变也重写这个 Agent 的 CLI 配置，盖掉外部改动。
      rewrite?: ApiEndpointProvider;
    } = {},
  ): Promise<ApiEndpointState> {
    const next = settleAgentSettings(proposed);
    for (const provider of API_ENDPOINT_PROVIDERS) {
      if (!previous.agents[provider].enabled && next.agents[provider].enabled) {
        this.requireGateway();
      }
    }
    const previousTokens = this.store.readGatewayTokens();
    const tokens = nextGatewayTokens(previous, next, previousTokens);

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
        this.syncCli(provider, this.cliWiring(next, provider, tokens));
        synced.push(provider);
      }
    } catch (error) {
      // 已经改好的 CLI 配置和目录退回去，状态整个不保存。
      for (const provider of synced) {
        try {
          this.syncCli(provider, this.cliWiring(previous, provider, previousTokens));
        } catch (revertError) {
          this.logger.error({ err: revertError, provider }, "Failed to revert CLI config");
        }
      }
      if (catalog !== catalogBefore) this.store.writeCodexModelCatalog(catalogBefore);
      throw error;
    }
    if (catalog === null && catalogBefore !== null) this.store.writeCodexModelCatalog(null);

    for (const [id, apiKey] of Object.entries(options.keys ?? {})) {
      this.store.setApiKey(id, apiKey);
    }
    this.store.writeState(next);
    if (!sameTokens(tokens, previousTokens)) this.store.writeGatewayTokens(tokens);
    this.announceCommitted(previous, next);
    return next;
  }

  /** 通知设置有变的 Agent；刚打开 Claude Code 总开关时让 models.dev 马上检查一次。 */
  private announceCommitted(previous: ApiEndpointState, next: ApiEndpointState): void {
    for (const provider of API_ENDPOINT_PROVIDERS) {
      if (agentFingerprint(previous, provider) !== agentFingerprint(next, provider)) {
        this.onActiveEndpointChanged(provider);
      }
    }
    if (!previous.agents.claude.enabled && next.agents.claude.enabled) this.modelsDev.wake();
  }

  private syncCli(provider: ApiEndpointProvider, wiring: CliWiring | null): void {
    if (!wiring) {
      this.restoreOfficial(provider);
    } else if (provider === "codex") {
      this.writeCodexEndpoint(wiring);
    } else {
      this.writeClaudeEndpoint(wiring);
    }
  }

  /**
   * 启动时的对账：开着的 Agent 只在 CLI 配置里的中转站地址或口令不是现在的时才重写，
   * 用户手改的其它负责的键留给健康检查报告；官方模式下清掉旧版本留下的东西。
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
      if (catalog !== this.store.readCodexModelCatalog()) {
        this.store.writeCodexModelCatalog(catalog);
      }
    }
    if (!wiring) {
      if (provider === "codex") this.removeLegacyCodexLeftovers();
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
    if (isUpToDate && !isPickerUnrecorded && !isHintUnrecorded) return;
    this.syncCli(provider, wiring);
    this.logger.info({ provider }, "CLI config pointed at the API endpoint gateway");
  }

  /** 没有接管、或记录是旧版本直接指向接口时写的（地址不是中转站）为 null。 */
  private writtenGateway(provider: ApiEndpointProvider): WrittenGateway | null {
    if (provider === "claude") {
      const env = this.store.readClaudeTakeover().takeover?.env;
      const url = env?.ANTHROPIC_BASE_URL?.written;
      const token = env?.ANTHROPIC_AUTH_TOKEN?.written;
      return url?.endsWith(API_ENDPOINT_GATEWAY_PATH) && token ? { url, token } : null;
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
    return { baseUrl, token, ...this.cliModels(state, provider, agent.defaultModelId) };
  }

  /**
   * CLI 看到的起始模型；Claude Code 另有终端 /model 里的接口模型（与聊天模型选择器同样的分组和顺序，每行直达那一家，
   * 去掉已下线的）和按已知模型资料算出的提示。Codex 的模型列表在单独的目录文件里，不进 config.toml。
   */
  private cliModels(
    state: ApiEndpointState,
    provider: ApiEndpointProvider,
    defaultModelId: string,
  ): Pick<CliWiring, "model" | "modelPicker" | "hintEnv"> {
    if (provider !== "claude") return { model: defaultModelId, modelPicker: [], hintEnv: {} };
    const listed = this.retiredModels.listed(state);
    const start: ClaudeHintModel = {
      id: defaultModelId,
      facts: this.startModelFacts(listed, defaultModelId),
    };
    const rows = endpointModelGroups(listed).flatMap((group) =>
      group.models.map(({ id, model }) => ({
        hint: { id, facts: this.modelFacts(group.endpoint, model.id) },
        label: model.label ?? model.id,
        description: group.endpoint.name,
      })),
    );
    return {
      model: markOneMillion(start),
      modelPicker: rows.map((row) => ({
        model: markOneMillion(row.hint),
        label: row.label,
        description: row.description,
      })),
      hintEnv: claudeHintEnv({ start, listed: rows.map((row) => row.hint) }),
    };
  }

  /** 起始模型是不带接口标识的模型名，中转站先发给最早开着、选了它的那家：资料也按那家查。 */
  private startModelFacts(state: ApiEndpointState, modelId: string): ModelFacts {
    const endpoint = state.endpoints.find(
      (entry) => entry.enabled && entry.models.some((model) => model.id === modelId),
    );
    return endpoint ? this.modelFacts(endpoint, modelId) : this.modelsDev.facts(modelId);
  }

  /**
   * 这家这个模型的资料：这家上游清单给的在前，models.dev 补上没给的。
   * Claude Code 的模型提示与中转站（翻译时的档位、回复上限、采样参数，选路时的窗口）都按它查。
   */
  modelFacts(endpoint: StoredApiEndpoint, modelId: string): ModelFacts {
    const listed = endpoint.catalog?.models.find((model) => model.id === modelId)?.facts;
    const facts = mergeModelFacts(listed, this.modelsDev.facts(modelId));
    // 收不收采样参数只认这家自己（按地址的主机名）在 models.dev 的条目，不借别家的目录。
    const hosts = endpoint.baseUrls.map((base) => hostOf(base.url));
    const takesSampling = this.modelsDev.takesSampling({ hosts, modelId });
    if (takesSampling === undefined) return facts;
    return { ...facts, takesSampling };
  }

  /**
   * 模型资料变了（models.dev 更新、上游清单重拉）或有模型下线、恢复：开着的 Claude Code 跟着重写。
   * 负责的键被外部改过时不动，留给健康检查和用户；写不成只记日志，不挡调用方。
   */
  private rewriteClaudeHints(state: ApiEndpointState): void {
    if (!state.agents.claude.enabled || this.gatewayUrlFor("claude") === null) return;
    if (this.inspectClaude(true).health.length > 0) {
      this.logger.info("Claude settings changed outside Osuna; model hints left as they are");
      return;
    }
    try {
      this.syncCli("claude", this.cliWiring(state, "claude", this.store.readGatewayTokens()));
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to rewrite the Claude model hints");
    }
  }

  /**
   * 中转站记下或恢复了已下线模型（含满一周到期）：走「接口变了」的流程，重写 Codex 模型目录与
   * Claude Code 的模型选择列表，再通知客户端刷新开着总开关的 Agent。接口与默认模型都不动。
   */
  retiredModelsChanged(): Promise<void> {
    return this.exclusive(() => {
      const state = this.readStateForSnapshot();
      if (!state) return;
      if (state.agents.codex.enabled) {
        const catalog = this.codexModelCatalog(state);
        if (catalog !== this.store.readCodexModelCatalog()) {
          this.store.writeCodexModelCatalog(catalog);
        }
      }
      this.rewriteClaudeHints(state);
      for (const provider of API_ENDPOINT_PROVIDERS) {
        if (state.agents[provider].enabled) this.onActiveEndpointChanged(provider);
      }
    });
  }

  private refreshClaudeHints(): Promise<void> {
    return this.exclusive(() => {
      const state = this.readStateForSnapshot();
      if (state) this.rewriteClaudeHints(state);
    });
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
      this.cliModels(state, provider, agent.defaultModelId),
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
    return new ApiEndpointRequestError(issue.code, issue.message);
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
      throw new ApiEndpointRequestError("endpoints_unparsable", error.message);
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
   */
  async fetchModels(
    provider: string,
    input: ApiEndpointUpstreamInput,
    signal: AbortSignal,
  ): Promise<ApiEndpointModel[]> {
    const supported = requireProvider(provider);
    const format = input.format === undefined ? null : requireFormat(input.format);
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const apiKey = this.resolveRequestKey(input);
    const result = await fetchUpstreamModels({
      provider: format === null ? supported : providerWithListingHeaders(format),
      baseUrl,
      apiKey,
      signal,
      timeoutMs: this.upstreamTimeoutMs,
    });
    if (!result.ok) throw new ApiEndpointRequestError(result.error.code, result.error.message);
    if (format !== null && input.endpointId) {
      await this.keepCatalog(input.endpointId, result.models);
    }
    return result.models.map(toWireModel);
  }

  /**
   * 记下这家的上游清单，不影响路由与模型目录。拉取期间被删的接口不再写回。
   * 清单带的模型资料改变了 Claude Code 的模型提示时，跟着重写 settings.json。
   */
  private keepCatalog(endpointId: string, models: ListedModel[]): Promise<void> {
    return this.exclusive(() => {
      const state = this.readState();
      const endpoint = findEndpoint(state, endpointId);
      if (!endpoint) return;
      const catalog = { fetchedAt: this.now().toISOString(), models };
      const next = {
        ...state,
        endpoints: withEndpoint(state.endpoints, { ...endpoint, catalog }),
      };
      this.store.writeState(next);
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
      throw new ApiEndpointRequestError("invalid_input", "A model is required");
    }
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const apiKey = this.resolveRequestKey(input);
    const outcome = await testUpstreamConnection({
      provider: supported,
      // Codex 和写进 config.toml 的 base_url 一样补 /v1。
      baseUrl:
        supported === "codex" ? (normalizeOpenAICompatibleBaseUrl(baseUrl) ?? baseUrl) : baseUrl,
      apiKey,
      modelId,
      signal,
      timeoutMs: this.connectionTestTimeoutMs,
    });
    if (outcome.kind === "cancelled") {
      throw new ApiEndpointRequestError("cancelled", "Request cancelled");
    }
    return outcome.result;
  }

  /** 按一种请求格式向一个地址发最小请求；上游回 401 / 403 时结论的 code 是 auth_failed。 */
  private async testFormat(
    format: ApiEndpointRequestFormat,
    input: ApiEndpointTestConnectionInput,
    signal: AbortSignal,
  ): Promise<ApiEndpointTestConnectionResult> {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const apiKey = this.resolveRequestKey(input);
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);
    let modelId = input.modelId?.trim() || this.probeModelFromEndpoint(input.endpointId, format);
    if (!modelId) {
      // 这家还没选模型也没拉过清单：先列一次（不花钱）再挑。
      const listed = await fetchUpstreamModels({
        provider: providerWithListingHeaders(format),
        baseUrl,
        apiKey,
        signal,
        timeoutMs: this.upstreamTimeoutMs,
      });
      if (!listed.ok) {
        if (listed.error.code === "cancelled") {
          throw new ApiEndpointRequestError("cancelled", "Request cancelled");
        }
        const status = listed.error.status ?? null;
        const code = status === 401 || status === 403 ? "auth_failed" : listed.error.code;
        return {
          ok: false,
          status,
          durationMs: elapsed(),
          error: { code, message: listed.error.message },
        };
      }
      modelId = pickProbeModel(
        listed.models.map((model) => model.id),
        format,
      );
    }
    const detection = await probeUpstreamFormat({
      format,
      baseUrl,
      apiKey,
      modelId: modelId ?? null,
      signal,
      timeoutMs: this.connectionTestTimeoutMs,
    });
    if (signal.aborted) throw new ApiEndpointRequestError("cancelled", "Request cancelled");
    return testResultOf(detection, elapsed());
  }

  /** 从这家已选的模型、再从上游清单里挑一个适合该格式的；都没有时为 null。 */
  private probeModelFromEndpoint(
    endpointId: string | undefined,
    format: ApiEndpointRequestFormat,
  ): string | null {
    if (!endpointId) return null;
    const endpoint = findEndpoint(this.readState(), endpointId);
    if (!endpoint) return null;
    return (
      pickProbeModel(
        endpoint.models.map((model) => model.id),
        format,
      ) ??
      pickProbeModel(
        (endpoint.catalog?.models ?? []).map((model) => model.id),
        format,
      )
    );
  }

  /**
   * 自动检测：从一个地址推出三种格式各自的地址，各发一条最小请求。和拉取模型一样只读、不进串行队列。
   * 每种格式的结论（含失败）放在返回值里；请求本身不成立或被取消才抛 ApiEndpointRequestError。
   */
  async detectFormats(
    input: ApiEndpointUpstreamInput,
    signal: AbortSignal,
  ): Promise<ApiEndpointFormatDetection[]> {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const apiKey = this.resolveRequestKey(input);
    const outcome = await detectUpstreamFormats({
      baseUrl,
      apiKey,
      signal,
      modelsTimeoutMs: this.upstreamTimeoutMs,
      probeTimeoutMs: this.connectionTestTimeoutMs,
    });
    if (outcome.kind === "cancelled") {
      throw new ApiEndpointRequestError("cancelled", "Request cancelled");
    }
    return outcome.results;
  }

  /** 请求里带了 key 就用它；否则用 endpointId 对应的已保存 key。key 从不回给客户端。 */
  private resolveRequestKey(input: ApiEndpointUpstreamInput): string {
    const typed = input.apiKey?.trim();
    if (typed) return typed;
    if (input.endpointId) {
      const endpointId = input.endpointId;
      if (!findEndpoint(this.readState(), endpointId)) {
        throw new ApiEndpointRequestError("not_found", "API endpoint not found");
      }
      const saved = this.store.getApiKey(input.endpointId);
      if (saved !== null) return saved;
    }
    throw new ApiEndpointRequestError("invalid_input", "API key is required");
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

  /** 目录的默认档跟着用户 config.toml 的 model_reasoning_effort；只在重新生成目录时读，读不出按没设。 */
  private codexModelCatalog(state: ApiEndpointState): string {
    let effort: string | null = null;
    try {
      effort = readCodexReasoningEffort(
        readOptionalFile(this.resolveCodexConfigPath())?.toString("utf8") ?? null,
      );
    } catch (error) {
      this.logger.warn({ err: error }, "Could not read Codex reasoning effort");
    }
    return buildCodexModelCatalog(this.retiredModels.listed(state), effort);
  }

  private restoreOfficial(provider: ApiEndpointProvider): void {
    if (provider === "codex") {
      this.restoreCodexOfficial();
    } else {
      this.restoreClaudeOfficial();
    }
  }

  private writeClaudeEndpoint(wiring: CliWiring): void {
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
        });
        if (result.kind === "unparsable") throw unparsable(settingsPath, result.message);
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

  private restoreClaudeOfficial(): void {
    const record = this.store.readClaudeTakeover();
    const { takeover } = record;
    if (!takeover) return;
    const settingsPath = this.resolveClaudeSettingsPath();
    this.writeConfigFile({
      filePath: settingsPath,
      compute: (text) => {
        const result = restoreClaudeOfficial({ text, takeover });
        if (result.kind === "unparsable") throw unparsable(settingsPath, result.message);
        let change: ConfigFileChange = { kind: "keep" };
        if (result.kind === "patched") change = { kind: "write", text: result.text };
        if (result.kind === "delete") change = { kind: "delete" };
        return { change, value: null };
      },
      commit: () => this.store.writeClaudeTakeover({ takeover: null, backup: record.backup }),
      rollback: () => this.store.writeClaudeTakeover(record),
    });
    this.logger.info({ settingsPath }, "Claude settings restored to Official");
  }

  /**
   * 先算好 config.toml 的新内容（解析失败就什么都不写），再写接管记录，重读比对通过后替换 config.toml。
   * config.toml 替换不成时接管记录退回切换前的样子。
   */
  private writeCodexEndpoint(wiring: CliWiring): void {
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
          },
          takeover: record.takeover,
        });
        if (result.kind === "unparsable") throw unparsable(configPath, result.message);
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

  private restoreCodexOfficial(): void {
    const record = this.store.readCodexTakeover();
    const { takeover } = record;
    if (!takeover) return;
    const configPath = this.resolveCodexConfigPath();
    this.writeConfigFile({
      filePath: configPath,
      compute: (text) => {
        const result = restoreCodexOfficial({ text, takeover });
        if (result.kind === "unparsable") throw unparsable(configPath, result.message);
        let change: ConfigFileChange = { kind: "keep" };
        if (result.kind === "patched") change = { kind: "write", text: result.text };
        if (result.kind === "delete") change = { kind: "delete" };
        return { change, value: null };
      },
      commit: () => this.store.writeCodexTakeover({ ...record, takeover: null }),
      rollback: () => this.store.writeCodexTakeover(record),
    });
    this.store.removeLegacyCodexKeyFile();
    this.logger.info({ configPath }, "Codex config restored to Official");
  }

  /**
   * v0.15 切回官方时把专用表和 key 文件留着给旧会话恢复用；现在官方就是官方，启动时拿掉。
   * 专用 provider id 只有 Osuna 会写，文件里有它就是留下的。
   * COMPAT(codexLegacyProviderTable): added after v0.15.0, remove after 2027-04-14.
   */
  private removeLegacyCodexLeftovers(): void {
    const record = this.store.readCodexTakeover();
    if (record.takeover) return;
    const configPath = this.resolveCodexConfigPath();
    this.writeConfigFile({
      filePath: configPath,
      compute: (text) => {
        const result = removeCodexProviderTable({ text });
        if (result.kind === "unparsable") throw unparsable(configPath, result.message);
        let change: ConfigFileChange = { kind: "keep" };
        if (result.kind === "patched" && result.text !== text) {
          // 接管前没有这个文件、现在又只剩 Osuna 写的东西：删掉，回到原样。
          change =
            result.text === "" && record.backup?.path === null
              ? { kind: "delete" }
              : { kind: "write", text: result.text };
        }
        return { change, value: null };
      },
      commit: () => undefined,
      rollback: () => undefined,
    });
    this.store.removeLegacyCodexKeyFile();
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
      throw new ApiEndpointRequestError(
        "config_conflict",
        `${input.filePath} kept changing while Osuna was writing it, so nothing was written`,
      );
    }
    return result.value;
  }

  private inspectClaude(enabled: boolean): ApiEndpointFileStatus {
    const settingsPath = this.resolveClaudeSettingsPath();
    const result = inspectClaudeSettings({
      text: readOptionalFile(settingsPath)?.toString("utf8") ?? null,
      takeover: enabled ? this.store.readClaudeTakeover().takeover : null,
    });
    if (result.kind === "unparsable") {
      return { health: [unparsableIssue(settingsPath, result.message)], baseUrl: null };
    }
    return {
      health: modifiedExternallyIssues(settingsPath, result.modifiedKeys),
      baseUrl: result.baseUrl,
    };
  }

  private inspectCodex(enabled: boolean): ApiEndpointFileStatus {
    const configPath = this.resolveCodexConfigPath();
    const result = inspectCodexConfig({
      text: readOptionalFile(configPath)?.toString("utf8") ?? null,
      takeover: enabled ? this.store.readCodexTakeover().takeover : null,
    });
    if (result.kind === "unparsable") {
      return { health: [unparsableIssue(configPath, result.message)], baseUrl: null };
    }
    const health = modifiedExternallyIssues(configPath, result.modifiedKeys);
    if (result.profileOverride) {
      const { profile, keys } = result.profileOverride;
      health.push({
        code: "codex_profile_override",
        message: `${configPath} selects profile "${profile}", and [profiles.${profile}] sets ${keys.join(", ")}, which overrides the API endpoint`,
      });
    }
    return { health, baseUrl: result.baseUrl };
  }

  /** 主机级字段原样给出；provider、baseUrl、defaultModelId 是给老客户端的投影。标识不出现。 */
  private toWire(
    state: ApiEndpointState,
    endpoint: StoredApiEndpoint,
    provider: ApiEndpointProvider,
  ): ApiEndpoint {
    return {
      id: endpoint.id,
      provider,
      name: endpoint.name,
      baseUrl: projectedBaseUrl(endpoint, provider),
      baseUrls: endpoint.baseUrls,
      models: endpoint.models,
      defaultModelId: projectedDefaultModelId(state.agents[provider], endpoint),
      ...(endpoint.modelMapping ? { modelMapping: endpoint.modelMapping } : {}),
      enabled: endpoint.enabled,
      hasApiKey: this.store.getApiKey(endpoint.id) !== null,
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
    };
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

  private exclusive<T>(run: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

function findProvider(provider: string): ApiEndpointProvider | undefined {
  return API_ENDPOINT_PROVIDERS.find((candidate) => candidate === provider);
}

function requireProvider(provider: string): ApiEndpointProvider {
  const supported = findProvider(provider);
  if (!supported) {
    throw new ApiEndpointRequestError(
      "unsupported_provider",
      `API endpoints are not supported for provider '${provider}'`,
    );
  }
  return supported;
}

/**
 * 总开关打开的 Agent 都有口令：从关到开换一个新的，一直开着的沿用，开着却没有（旧数据换算来的）补一个；
 * 关着的没有口令，旧口令即作废。
 */
function nextGatewayTokens(
  previous: ApiEndpointState,
  next: ApiEndpointState,
  current: GatewayTokens,
): GatewayTokens {
  const tokens: GatewayTokens = {};
  for (const provider of API_ENDPOINT_PROVIDERS) {
    if (!next.agents[provider].enabled) continue;
    const existing = current[provider];
    tokens[provider] =
      previous.agents[provider].enabled && existing
        ? existing
        : randomBytes(32).toString("base64url");
  }
  return tokens;
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
    usableModels(state),
    target ? [target.id, target.name] : null,
    endpointModelGroups(state).map((group) => [
      group.endpoint.name,
      group.models.map((entry) => [entry.id, entry.model.label]),
    ]),
  ]);
}

/** 上游清单里的模型资料只留在 daemon 里；发给客户端的只有 id 和显示名。 */
function toWireModel(model: ListedModel): ApiEndpointModel {
  return model.label === undefined ? { id: model.id } : { id: model.id, label: model.label };
}

/** 打开总开关后的设置；没有可用模型或指定的默认模型不可用时拒绝。 */
function enabledAgentSettings(
  state: ApiEndpointState,
  provider: ApiEndpointProvider,
  requested: string | undefined,
): ApiEndpointAgentSettings {
  const models = usableModels(state);
  const first = models[0];
  if (!first) {
    throw new ApiEndpointRequestError(
      "no_usable_model",
      "Turn on an API endpoint and select at least one of its models first",
    );
  }
  const isUsable = (id: string | null | undefined) => models.some((model) => model.id === id);
  if (requested && !isUsable(requested)) {
    throw new ApiEndpointRequestError(
      "invalid_input",
      "The default model must be one of the models selected on an endpoint that is on",
    );
  }
  const current = state.agents[provider].defaultModelId;
  if (requested) return { enabled: true, defaultModelId: requested };
  return { enabled: true, defaultModelId: isUsable(current) ? current : first.id };
}

/** 按 id 替换，找不到就追加到末尾（创建顺序）。 */
function withEndpoint(
  endpoints: StoredApiEndpoint[],
  endpoint: StoredApiEndpoint,
): StoredApiEndpoint[] {
  const index = endpoints.findIndex((entry) => entry.id === endpoint.id);
  return index === -1 ? [...endpoints, endpoint] : endpoints.with(index, endpoint);
}

/** 标识、开关、创建时间与老表单的默认模型沿用已有的；新建时生成标识。 */
function buildEndpoint(input: {
  state: ApiEndpointState;
  existing: StoredApiEndpoint | null;
  fields: EndpointFields;
  enabledWhenNew: boolean;
  timestamp: string;
}): StoredApiEndpoint {
  const { state, existing, fields } = input;
  const legacyDefaultModelId = fields.legacyDefaultModelId ?? existing?.legacyDefaultModelId;
  const manualModels = fields.manualModels ?? existing?.manualModels;
  return {
    id: existing?.id ?? `ep_${randomUUID()}`,
    slug:
      existing?.slug ??
      generateEndpointSlug(fields.name, new Set(state.endpoints.map((entry) => entry.slug))),
    ...fields,
    enabled: existing?.enabled ?? input.enabledWhenNew,
    ...(legacyDefaultModelId ? { legacyDefaultModelId } : {}),
    // 上游清单只由拉取模型改，保存时沿用。
    ...(existing?.catalog ? { catalog: existing.catalog } : {}),
    ...(manualModels && manualModels.length > 0 ? { manualModels } : {}),
    createdAt: existing?.createdAt ?? input.timestamp,
    updatedAt: input.timestamp,
  };
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
      throw new ApiEndpointRequestError("invalid_input", `Only one ${format} base URL is allowed`);
    }
    if (entries[0]) baseUrls.push({ format, url: normalizeBaseUrl(entries[0].url) });
  }
  const unknown = rawBaseUrls.find(
    (entry) => !API_ENDPOINT_REQUEST_FORMATS.some((format) => format === entry.format),
  );
  if (unknown) {
    throw new ApiEndpointRequestError(
      "invalid_input",
      `Unknown request format '${unknown.format}'`,
    );
  }
  if (baseUrls.length === 0) {
    throw new ApiEndpointRequestError("invalid_input", "At least one base URL is required");
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
    throw new ApiEndpointRequestError("invalid_input", "Base URL is required");
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
    throw new ApiEndpointRequestError("invalid_input", "At least one model is required");
  }
  const defaultModelId = input.defaultModelId.trim();
  if (!models.some((model) => model.id === defaultModelId)) {
    throw new ApiEndpointRequestError(
      "invalid_input",
      "The default model must be one of the models",
    );
  }
  let modelMapping: ApiEndpointModelMapping | undefined;
  if (apiEndpointHasModelMapping(provider)) {
    modelMapping = validateModelMapping(input.modelMapping, models);
  } else if (input.modelMapping && validateModelMapping(input.modelMapping, models)) {
    throw new ApiEndpointRequestError("invalid_input", "Only Claude endpoints have model mapping");
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
    throw new ApiEndpointRequestError("invalid_input", "Name is required");
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
      throw new ApiEndpointRequestError(
        "invalid_input",
        `The ${tier} mapping must be one of the models`,
      );
    }
    mapping[tier] = modelId;
  }
  return Object.keys(mapping).length === 0 ? undefined : mapping;
}

/** 保留已有映射里仍在模型之中的档位。 */
function keepValidMapping(
  mapping: ApiEndpointModelMapping | undefined,
  models: ApiEndpointModel[],
): ApiEndpointModelMapping | undefined {
  if (!mapping) return undefined;
  const kept: ApiEndpointModelMapping = {};
  for (const tier of API_ENDPOINT_MODEL_TIERS) {
    const modelId = mapping[tier];
    if (modelId && models.some((model) => model.id === modelId)) kept[tier] = modelId;
  }
  return Object.keys(kept).length === 0 ? undefined : kept;
}

function requireFormat(format: string): ApiEndpointRequestFormat {
  const known = API_ENDPOINT_REQUEST_FORMATS.find((candidate) => candidate === format);
  if (!known) {
    throw new ApiEndpointRequestError("invalid_input", `Unknown request format '${format}'`);
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

/** 按格式测试的结论换成测试连接的结果；没收到响应的是连不上。 */
function testResultOf(
  detection: ApiEndpointFormatDetection,
  durationMs: number,
): ApiEndpointTestConnectionResult {
  const { httpStatus: status, message } = detection;
  if (detection.status === "ok") return { ok: true, status, durationMs, error: null };
  let code: "auth_failed" | "upstream_unreachable" | "upstream_error" = "upstream_error";
  if (detection.status === "auth_failed") code = "auth_failed";
  else if (status === null) code = "upstream_unreachable";
  return { ok: false, status, durationMs, error: { code, message: message ?? "" } };
}

/** 去掉末尾斜杠，和 CLI 自己拼路径的方式一致。 */
function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!URL.canParse(trimmed)) {
    throw new ApiEndpointRequestError("invalid_input", "Base URL is not a valid URL");
  }
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ApiEndpointRequestError(
      "invalid_input",
      "Base URL must start with http:// or https://",
    );
  }
  return trimmed.replace(/\/+$/, "");
}

function unparsable(filePath: string, detail: string): ApiEndpointRequestError {
  return new ApiEndpointRequestError(
    "config_unparsable",
    `${filePath} could not be parsed, so nothing was written: ${detail}`,
  );
}

function unparsableIssue(filePath: string, detail: string): HealthIssue {
  return { code: "config_unparsable", message: `${filePath} could not be parsed: ${detail}` };
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
