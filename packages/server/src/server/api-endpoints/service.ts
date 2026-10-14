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
  type ApiEndpointHealthIssue,
  type ApiEndpointListResponse,
  type ApiEndpointModel,
  type ApiEndpointModelMapping,
  type ApiEndpointRef,
  type ApiEndpointTestConnectionResult,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { resolveAgentHookConfigPath } from "../../terminal/agent-hooks/agent-hook-installer.js";
import { claudeAgentHookProvider } from "../../terminal/agent-hooks/claude/claude.js";
import { codexAgentHookProvider } from "../../terminal/agent-hooks/codex/codex.js";
import type { AgentModelDefinition } from "../agent/agent-sdk-types.js";
import {
  codexVersionAtLeast,
  normalizeOpenAICompatibleBaseUrl,
  probeCodexVersion,
} from "../agent/providers/codex-app-server-agent.js";
import type { ProviderRuntimeSettings } from "../agent/provider-launch-config.js";
import {
  applyClaudeApiEndpoint,
  buildClaudeEndpointEnv,
  inspectClaudeSettings,
  restoreClaudeOfficial,
  type ClaudeSettingsTakeover,
} from "./claude-settings-patch.js";
import { buildCodexAuthCommand } from "./codex-auth-command.js";
import {
  applyCodexApiEndpoint,
  inspectCodexConfig,
  removeCodexProviderTable,
  replaceCodexProviderTable,
  restoreCodexOfficial,
  type CodexConfigTakeover,
  type CodexProviderTable,
} from "./codex-config-patch.js";
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
  projectedBaseUrl,
  projectedDefaultModelId,
  settleAgentSettings,
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
import { fetchUpstreamModels, type UpstreamFailureCode } from "./upstream-models.js";

export type ApiEndpointErrorCode =
  | "unsupported_provider"
  | "invalid_input"
  | "not_found"
  | "config_unparsable"
  // 写入时文件一直在被别人改，重试三次后放弃，什么都没写。
  | "config_conflict"
  | "codex_version_unsupported"
  // endpoints.json 读不懂；什么都不写。
  | "endpoints_unparsable"
  // 没有开着且已选模型的接口，总开关打不开。
  | "no_usable_model"
  | UpstreamFailureCode;

const DEFAULT_UPSTREAM_TIMEOUT_MS = 15_000;
// 测试连接要等模型真正回一句话，比列出模型慢。
const DEFAULT_CONNECTION_TEST_TIMEOUT_MS = 30_000;

// auth.command 从这个版本开始才有（ADR 0004）。
const CODEX_AUTH_COMMAND_MIN_VERSION: readonly [number, number, number] = [0, 118, 0];

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
}

export interface ApiEndpointTestConnectionInput extends ApiEndpointUpstreamInput {
  modelId: string;
}

export interface ApiEndpointServiceOptions {
  paseoHome: string;
  logger: pino.Logger;
  // 定位 CLI 配置文件用；缺省取 daemon 自己的环境，测试注入临时目录。
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  now?: () => Date;
  // 提供方当前生效的启动设置（含 config.json 里配置的命令）；目前只用来跑 `codex --version` 检查版本。
  providerRuntimeSettings: (provider: ApiEndpointProvider) => ProviderRuntimeSettings | undefined;
  // 某个 Agent 的总开关、默认模型、可用模型或指向的接口变了之后调用；daemon 据此刷新该提供方的快照。
  onActiveEndpointChanged?: (provider: ApiEndpointProvider) => void;
  // 该提供方下还活着的 Agent session 数；改写 CLI 配置会影响到它们，列表查询时带给 App 写进确认框。
  countLiveSessions: (provider: ApiEndpointProvider) => number;
  upstreamTimeoutMs?: number;
  connectionTestTimeoutMs?: number;
  // 改写 CLI 配置时，落下接管记录之后、替换前重读比对之前调用。
  // 只给进程内 daemon 测试模拟「别的工具同时在改这份文件」，生产不传。
  beforeConfigRecheck?: (filePath: string) => void;
}

/** 线上 `code` 是字符串；daemon 这一侧只会发这几种。 */
type ApiEndpointHealthCode =
  | "modified_externally"
  | "config_unparsable"
  | "codex_version_unsupported"
  // 跑不了 `codex --version`，例如找不到 codex；App 显示 daemon 原文。
  | "codex_unavailable"
  | "codex_profile_override";

interface HealthIssue extends ApiEndpointHealthIssue {
  code: ApiEndpointHealthCode;
}

/** health 为空即正常；cliBaseUrl 只在官方模式下给出。 */
export type ApiEndpointListResult = Required<
  Pick<
    ApiEndpointListResponse["payload"],
    "endpoints" | "activeEndpointId" | "health" | "cliBaseUrl" | "runningSessionCount" | "agents"
  >
>;

/** 本票里 CLI 直接指向的那家：持有默认模型的开着接口里最早建的一家，地址按投影取。 */
interface CliTarget {
  endpoint: StoredApiEndpoint;
  baseUrl: string;
  defaultModelId: string;
}

interface ApiEndpointFileStatus {
  health: HealthIssue[];
  baseUrl: string | null;
}

/**
 * 管理第三方接口，并在启用/切回时改写 CLI 自身的配置文件（ADR 0004）。
 * 所有变更串行执行：改文件是「读—算—写」，并发的两次切换会互相覆盖接管记录。
 */
export class ApiEndpointService {
  private readonly store: ApiEndpointStore;
  private readonly logger: pino.Logger;
  private readonly env: NodeJS.ProcessEnv;
  private readonly homeDir: string;
  private readonly now: () => Date;
  private readonly providerRuntimeSettings: (
    provider: ApiEndpointProvider,
  ) => ProviderRuntimeSettings | undefined;
  private readonly onActiveEndpointChanged: (provider: ApiEndpointProvider) => void;
  private readonly countLiveSessions: (provider: ApiEndpointProvider) => number;
  private readonly upstreamTimeoutMs: number;
  private readonly connectionTestTimeoutMs: number;
  private readonly beforeConfigRecheck: ((filePath: string) => void) | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: ApiEndpointServiceOptions) {
    this.store = new ApiEndpointStore(options.paseoHome);
    this.logger = options.logger.child({ module: "api-endpoints" });
    this.env = options.env ?? process.env;
    this.homeDir = options.homeDir ?? homedir();
    this.now = options.now ?? (() => new Date());
    this.providerRuntimeSettings = options.providerRuntimeSettings;
    this.onActiveEndpointChanged = options.onActiveEndpointChanged ?? (() => undefined);
    this.countLiveSessions = options.countLiveSessions;
    this.upstreamTimeoutMs = options.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
    this.connectionTestTimeoutMs =
      options.connectionTestTimeoutMs ?? DEFAULT_CONNECTION_TEST_TIMEOUT_MS;
    this.beforeConfigRecheck = options.beforeConfigRecheck;
  }

  /**
   * 列表连同健康状态：每次都读真实文件，负责的键不再是上次写入的值就报「已被外部修改」。
   * 只在这里和写入时检测，不在后台监听文件。接口是主机共用的；provider 只决定投影字段怎么换算。
   */
  async list(provider: string): Promise<ApiEndpointListResult> {
    const supported = requireProvider(provider);
    const state = this.readState();
    const target = cliTarget(state, supported);
    const status =
      supported === "codex" ? await this.inspectCodex(target) : this.inspectClaude(target);
    return {
      endpoints: state.endpoints.map((endpoint) => this.toWire(state, endpoint, supported)),
      activeEndpointId: target?.endpoint.id ?? null,
      agents: state.agents,
      health: status.health,
      cliBaseUrl: target ? null : status.baseUrl,
      runningSessionCount: this.countLiveSessions(supported),
    };
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

  /** 已删除的接口返回 null。 */
  endpointName(provider: string, endpointId: string): string | null {
    if (!findProvider(provider)) return null;
    const state = this.readStateForSnapshot();
    return (state && findEndpoint(state, endpointId)?.name) ?? null;
  }

  /**
   * 总开关开着时，所有开着的接口的已选模型（按 id 去重），默认模型即该 Agent 的默认模型。
   * 官方模式、不支持的提供方或文件读不懂时返回 null，模型目录照旧。
   */
  activeModels(provider: string): AgentModelDefinition[] | null {
    const state = this.readStateForSnapshot();
    const supported = findProvider(provider);
    if (!state || !supported) return null;
    const agent = state.agents[supported];
    if (!agent.enabled) return null;
    return usableModels(state).map((model) => ({
      provider: supported,
      id: model.id,
      label: model.label ?? model.id,
      isDefault: model.id === agent.defaultModelId,
    }));
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

  /**
   * 接口开关与「立刻恢复」。关掉开关按默认模型失踪规则处理各 Agent。
   * 冷却还没有实现（04 票），「立刻恢复」目前没有可清的。
   */
  setEndpointState(input: ApiEndpointStateInput): Promise<void> {
    return this.exclusive(async () => {
      const state = this.readState();
      const endpoint = findEndpoint(state, input.endpointId);
      if (!endpoint) {
        throw new ApiEndpointRequestError("not_found", "API endpoint not found");
      }
      if (input.enabled === undefined || input.enabled === endpoint.enabled) return;
      await this.commit(state, {
        ...state,
        endpoints: withEndpoint(state.endpoints, { ...endpoint, enabled: input.enabled }),
      });
    });
  }

  /**
   * 落下一次变更：先按默认模型失踪规则整理各 Agent，再让 CLI 配置跟上（改不成就整个不保存），
   * 最后写 key 与 endpoints.json，并通知设置有变的 Agent。返回落下的状态。
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
    const keys = options.keys ?? {};
    const keyOf = (id: string) => keys[id] ?? this.store.getApiKey(id);

    const changed = API_ENDPOINT_PROVIDERS.filter(
      (provider) =>
        provider === options.rewrite ||
        cliFingerprint(previous, provider, keyOf) !== cliFingerprint(next, provider, keyOf),
    );
    for (const provider of changed) {
      if (provider === "codex" && !cliTarget(previous, "codex") && cliTarget(next, "codex")) {
        await this.requireCodexAuthCommand();
      }
    }
    const synced: ApiEndpointProvider[] = [];
    try {
      for (const provider of changed) {
        this.syncCli(provider, cliTarget(next, provider), keyOf);
        synced.push(provider);
      }
      this.syncCodexProviderTable(previous, next, keyOf);
    } catch (error) {
      // 另一个 Agent 已经改好的 CLI 配置退回去，状态整个不保存。
      for (const provider of synced) {
        try {
          this.syncCli(provider, cliTarget(previous, provider), (id) => this.store.getApiKey(id));
        } catch (revertError) {
          this.logger.error({ err: revertError, provider }, "Failed to revert CLI config");
        }
      }
      throw error;
    }

    for (const [id, apiKey] of Object.entries(keys)) this.store.setApiKey(id, apiKey);
    this.store.writeState(next);
    this.syncGatewayTokens(previous, next);
    for (const provider of API_ENDPOINT_PROVIDERS) {
      if (agentFingerprint(previous, provider) !== agentFingerprint(next, provider)) {
        this.onActiveEndpointChanged(provider);
      }
    }
    return next;
  }

  /**
   * 中转站口令跟着总开关走：从关到开换一个新口令，开着却没有口令（旧数据换算来的）补一个，关掉即删除。
   */
  private syncGatewayTokens(previous: ApiEndpointState, next: ApiEndpointState): void {
    const current = this.store.readGatewayTokens();
    const tokens: GatewayTokens = {};
    for (const provider of API_ENDPOINT_PROVIDERS) {
      if (!next.agents[provider].enabled) continue;
      const existing = current[provider];
      tokens[provider] =
        previous.agents[provider].enabled && existing
          ? existing
          : randomBytes(32).toString("base64url");
    }
    if (JSON.stringify(tokens) !== JSON.stringify(current)) this.store.writeGatewayTokens(tokens);
  }

  private syncCli(
    provider: ApiEndpointProvider,
    target: CliTarget | null,
    keyOf: (id: string) => string | null,
  ): void {
    if (!target) {
      this.restoreOfficial(provider);
      return;
    }
    const apiKey = keyOf(target.endpoint.id);
    if (apiKey === null) {
      throw new ApiEndpointRequestError("not_found", "API key for this endpoint is missing");
    }
    if (provider === "codex") {
      this.writeCodexEndpoint(target, apiKey);
    } else {
      this.writeClaudeEndpoint(target, apiKey);
    }
  }

  /**
   * 官方模式下 config.toml 里仍留着上次那家的专用表，旧 Codex 会话恢复时用它：
   * 那家被删就拿掉表和 key 文件；那家的名称、地址或 key 变了就刷新。
   */
  private syncCodexProviderTable(
    previous: ApiEndpointState,
    next: ApiEndpointState,
    keyOf: (id: string) => string | null,
  ): void {
    if (cliTarget(next, "codex")) return;
    const ownerId = this.store.readCodexTakeover().providerTable?.endpointId;
    if (!ownerId) return;
    const owner = findEndpoint(next, ownerId);
    if (!owner) {
      this.removeCodexProviderTable(ownerId);
      return;
    }
    const before = findEndpoint(previous, ownerId);
    const apiKey = keyOf(ownerId);
    const tableOf = (endpoint: StoredApiEndpoint | null) =>
      endpoint ? JSON.stringify([endpoint.name, projectedBaseUrl(endpoint, "codex")]) : null;
    const keyChanged = apiKey !== this.store.getApiKey(ownerId);
    if (apiKey === null || (tableOf(before) === tableOf(owner) && !keyChanged)) return;
    this.refreshCodexProviderTable(owner, apiKey);
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
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const apiKey = this.resolveRequestKey(input);
    const result = await fetchUpstreamModels({
      provider: supported,
      baseUrl,
      apiKey,
      signal,
      timeoutMs: this.upstreamTimeoutMs,
    });
    if (!result.ok) throw new ApiEndpointRequestError(result.error.code, result.error.message);
    return result.models;
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
    const modelId = input.modelId.trim();
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

  private restoreOfficial(provider: ApiEndpointProvider): void {
    if (provider === "codex") {
      this.restoreCodexOfficial();
    } else {
      this.restoreClaudeOfficial();
    }
  }

  private writeClaudeEndpoint(target: CliTarget, apiKey: string): void {
    const { endpoint } = target;
    const settingsPath = this.resolveClaudeSettingsPath();
    const record = this.store.readClaudeTakeover();
    const env = buildClaudeEndpointEnv({
      baseUrl: target.baseUrl,
      apiKey,
      defaultModelId: target.defaultModelId,
      modelMapping: endpoint.modelMapping,
    });
    // 这次首次改写做出的副本；比对不通过重试时收回，免得留下多份。
    let createdBackup: string | null = null;
    this.writeConfigFile<{ takeover: ClaudeSettingsTakeover; current: Buffer | null }>({
      filePath: settingsPath,
      compute: (text, current) => {
        const result = applyClaudeApiEndpoint({
          text,
          env,
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
    this.logger.info(
      { settingsPath, endpointId: endpoint.id },
      "Claude settings switched to API endpoint",
    );
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

  private async requireCodexAuthCommand(): Promise<void> {
    const versionOutput = await probeCodexVersion(this.providerRuntimeSettings("codex"));
    if (!codexVersionAtLeast(versionOutput, CODEX_AUTH_COMMAND_MIN_VERSION)) {
      throw new ApiEndpointRequestError(
        "codex_version_unsupported",
        codexVersionUnsupportedMessage(versionOutput),
      );
    }
  }

  /**
   * 先算好 config.toml 的新内容（解析失败就什么都不写），再写 key 文件和接管记录，重读比对通过后替换 config.toml。
   * config.toml 替换不成时 key 文件和接管记录都退回切换前的样子。
   */
  private writeCodexEndpoint(target: CliTarget, apiKey: string): void {
    const { endpoint } = target;
    const configPath = this.resolveCodexConfigPath();
    const record = this.store.readCodexTakeover();
    const table = this.buildCodexProviderTable(endpoint.name, target.baseUrl);
    const previousKey = readOptionalFile(this.store.codexKeyFilePath);
    let createdBackup: string | null = null;
    this.writeConfigFile<{ takeover: CodexConfigTakeover; current: Buffer | null }>({
      filePath: configPath,
      compute: (text, current) => {
        const result = applyCodexApiEndpoint({
          text,
          model: target.defaultModelId,
          table,
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
        this.store.writeCodexKeyFile(apiKey);
        this.store.writeCodexTakeover({
          takeover,
          providerTable: { endpointId: endpoint.id },
          backup: record.backup ?? { path: createdBackup },
        });
      },
      rollback: () => {
        this.store.writeCodexTakeover(record);
        this.store.writeCodexKeyFile(previousKey);
        if (createdBackup) this.store.discardBackup(createdBackup);
        createdBackup = null;
      },
    });
    this.logger.info(
      { configPath, endpointId: endpoint.id },
      "Codex config switched to API endpoint",
    );
  }

  private refreshCodexProviderTable(endpoint: StoredApiEndpoint, apiKey: string): void {
    const configPath = this.resolveCodexConfigPath();
    const table = this.buildCodexProviderTable(endpoint.name, projectedBaseUrl(endpoint, "codex"));
    const previousKey = readOptionalFile(this.store.codexKeyFilePath);
    const refreshed = this.writeConfigFile({
      filePath: configPath,
      compute: (text) => {
        const result = replaceCodexProviderTable({
          text,
          table,
        });
        if (result.kind === "unparsable") throw unparsable(configPath, result.message);
        // 文件已经不在了：专用表也就不在了，没什么可刷新的。
        if (result.kind === "missing") return { change: { kind: "keep" }, value: false };
        return { change: { kind: "write", text: result.text }, value: true };
      },
      commit: (writesTable) => {
        if (writesTable) this.store.writeCodexKeyFile(apiKey);
      },
      rollback: () => this.store.writeCodexKeyFile(previousKey),
    });
    if (!refreshed) return;
    this.logger.info(
      { configPath, endpointId: endpoint.id },
      "Codex API endpoint provider table refreshed",
    );
  }

  private buildCodexProviderTable(name: string, rawBaseUrl: string): CodexProviderTable {
    // 保存时已校验过 URL，这里归一化不会落空；落空就是数据坏了，直接报错。
    const baseUrl = normalizeOpenAICompatibleBaseUrl(rawBaseUrl);
    if (baseUrl === null) {
      throw new ApiEndpointRequestError("invalid_input", "Base URL is empty");
    }
    return {
      name,
      baseUrl,
      auth: buildCodexAuthCommand({
        platform: process.platform,
        keyFilePath: this.store.codexKeyFilePath,
        systemRoot: this.env.SystemRoot,
      }),
    };
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
        const change: ConfigFileChange =
          result.kind === "patched" ? { kind: "write", text: result.text } : { kind: "keep" };
        return { change, value: null };
      },
      // 专用表和 key 文件都留着，第三方模式下的 Codex 会话还能恢复。
      commit: () => this.store.writeCodexTakeover({ ...record, takeover: null }),
      rollback: () => this.store.writeCodexTakeover(record),
    });
    this.logger.info({ configPath }, "Codex config restored to Official");
  }

  /** 删除的是专用表当前所属的接口时，拿掉专用表和 key 文件。调用前已切回官方。 */
  private removeCodexProviderTable(endpointId: string): void {
    const record = this.store.readCodexTakeover();
    if (record.providerTable?.endpointId !== endpointId) return;
    const configPath = this.resolveCodexConfigPath();
    const previousKey = readOptionalFile(this.store.codexKeyFilePath);
    this.writeConfigFile({
      filePath: configPath,
      compute: (text) => {
        const result = removeCodexProviderTable({ text });
        if (result.kind === "unparsable") throw unparsable(configPath, result.message);
        let change: ConfigFileChange = { kind: "keep" };
        if (result.kind === "patched") {
          // 接管前没有这个文件、现在又只剩 Osuna 写的东西：删掉，回到原样。
          change =
            result.text === "" && record.backup?.path === null
              ? { kind: "delete" }
              : { kind: "write", text: result.text };
        }
        return { change, value: null };
      },
      commit: () => {
        this.store.writeCodexKeyFile(null);
        this.store.writeCodexTakeover({ ...record, providerTable: null });
      },
      rollback: () => {
        this.store.writeCodexTakeover(record);
        this.store.writeCodexKeyFile(previousKey);
      },
    });
    this.logger.info({ configPath, endpointId }, "Codex API endpoint provider table removed");
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

  private inspectClaude(active: CliTarget | null): ApiEndpointFileStatus {
    const settingsPath = this.resolveClaudeSettingsPath();
    const result = inspectClaudeSettings({
      text: readOptionalFile(settingsPath)?.toString("utf8") ?? null,
      takeover: active ? this.store.readClaudeTakeover().takeover : null,
    });
    if (result.kind === "unparsable") {
      return { health: [unparsableIssue(settingsPath, result.message)], baseUrl: null };
    }
    return {
      health: modifiedExternallyIssues(settingsPath, result.modifiedKeys),
      baseUrl: result.baseUrl,
    };
  }

  private async inspectCodex(active: CliTarget | null): Promise<ApiEndpointFileStatus> {
    const configPath = this.resolveCodexConfigPath();
    const result = inspectCodexConfig({
      text: readOptionalFile(configPath)?.toString("utf8") ?? null,
      takeover: active ? this.store.readCodexTakeover().takeover : null,
      table: active ? this.buildCodexProviderTable(active.endpoint.name, active.baseUrl) : null,
    });
    const health: HealthIssue[] = [];
    let baseUrl: string | null = null;
    if (result.kind === "unparsable") {
      health.push(unparsableIssue(configPath, result.message));
    } else {
      health.push(...modifiedExternallyIssues(configPath, result.modifiedKeys));
      if (result.profileOverride) {
        const { profile, keys } = result.profileOverride;
        health.push({
          code: "codex_profile_override",
          message: `${configPath} selects profile "${profile}", and [profiles.${profile}] sets ${keys.join(", ")}, which overrides the API endpoint`,
        });
      }
      baseUrl = result.baseUrl;
    }
    // Codex 被降级到不认 auth.command 的版本时，启用中的接口已经不能用了。
    if (active) {
      const issue = await this.checkCodexVersion();
      if (issue) health.push(issue);
    }
    return { health, baseUrl };
  }

  private async checkCodexVersion(): Promise<HealthIssue | null> {
    let versionOutput: string;
    try {
      versionOutput = await probeCodexVersion(this.providerRuntimeSettings("codex"));
    } catch (error) {
      // 探测失败不是「版本不足」：原因照实报出，列表照常返回。
      const reason = error instanceof Error ? error.message : String(error);
      return { code: "codex_unavailable", message: `Couldn't run codex --version: ${reason}` };
    }
    if (codexVersionAtLeast(versionOutput, CODEX_AUTH_COMMAND_MIN_VERSION)) return null;
    return {
      code: "codex_version_unsupported",
      message: codexVersionUnsupportedMessage(versionOutput),
    };
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

function cliTarget(state: ApiEndpointState, provider: ApiEndpointProvider): CliTarget | null {
  const endpoint = agentTargetEndpoint(state, provider);
  const defaultModelId = state.agents[provider].defaultModelId;
  if (!endpoint || defaultModelId === null) return null;
  return { endpoint, baseUrl: projectedBaseUrl(endpoint, provider), defaultModelId };
}

/** CLI 配置里会写进去的一切；前后不同才改写文件。 */
function cliFingerprint(
  state: ApiEndpointState,
  provider: ApiEndpointProvider,
  keyOf: (id: string) => string | null,
): string {
  const target = cliTarget(state, provider);
  if (!target) return "official";
  const { endpoint } = target;
  return JSON.stringify([
    endpoint.id,
    endpoint.name,
    target.baseUrl,
    target.defaultModelId,
    endpoint.modelMapping ?? null,
    keyOf(endpoint.id),
  ]);
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
  ]);
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
  return {
    id: existing?.id ?? `ep_${randomUUID()}`,
    slug:
      existing?.slug ??
      generateEndpointSlug(fields.name, new Set(state.endpoints.map((entry) => entry.slug))),
    ...fields,
    enabled: existing?.enabled ?? input.enabledWhenNew,
    ...(legacyDefaultModelId ? { legacyDefaultModelId } : {}),
    createdAt: existing?.createdAt ?? input.timestamp,
    updatedAt: input.timestamp,
  };
}

type EndpointFields = Pick<
  StoredApiEndpoint,
  "name" | "baseUrls" | "models" | "modelMapping" | "legacyDefaultModelId"
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
  return { name, baseUrls, models, ...(modelMapping ? { modelMapping } : {}) };
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
  const url = normalizeBaseUrl(input.baseUrl);
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

function codexVersionUnsupportedMessage(versionOutput: string): string {
  return `API endpoints need Codex ${CODEX_AUTH_COMMAND_MIN_VERSION.join(".")} or later, which reads the API key through auth.command. Found: ${versionOutput}`;
}
