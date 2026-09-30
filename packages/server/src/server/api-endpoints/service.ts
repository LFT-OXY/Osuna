import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import type pino from "pino";
import {
  API_ENDPOINT_MODEL_TIERS,
  apiEndpointHasModelMapping,
  type ApiEndpoint,
  type ApiEndpointHealthIssue,
  type ApiEndpointListResponse,
  type ApiEndpointModel,
  type ApiEndpointModelMapping,
  type ApiEndpointTestConnectionResult,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { resolveAgentHookConfigPath } from "../../terminal/agent-hooks/agent-hook-installer.js";
import { claudeAgentHookProvider } from "../../terminal/agent-hooks/claude/claude.js";
import { codexAgentHookProvider } from "../../terminal/agent-hooks/codex/codex.js";
import type { AgentModelDefinition } from "../agent/agent-sdk-types.js";
import {
  codexVersionAtLeast,
  normalizeOpenAICompatibleBaseUrl,
} from "../agent/providers/codex-app-server-agent.js";
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
  API_ENDPOINT_PROVIDERS,
  ApiEndpointStore,
  type ApiEndpointProvider,
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

export interface ApiEndpointSaveInput {
  endpointId?: string;
  name: string;
  baseUrl: string;
  // undefined 或空白：更新时保留原 key。
  apiKey?: string;
  models: ApiEndpointModel[];
  defaultModelId: string;
  modelMapping?: ApiEndpointModelMapping;
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
  // `codex --version` 的输出；启用 Codex 接口前检查版本。
  probeCodexVersion: () => Promise<string>;
  // 启用、切回、编辑或删除启用中的接口之后调用；daemon 据此刷新该提供方的快照。
  onActiveEndpointChanged?: (provider: ApiEndpointProvider) => void;
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
    "endpoints" | "activeEndpointId" | "health" | "cliBaseUrl"
  >
>;

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
  private readonly probeCodexVersion: () => Promise<string>;
  private readonly onActiveEndpointChanged: (provider: ApiEndpointProvider) => void;
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
    this.probeCodexVersion = options.probeCodexVersion;
    this.onActiveEndpointChanged = options.onActiveEndpointChanged ?? (() => undefined);
    this.upstreamTimeoutMs = options.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
    this.connectionTestTimeoutMs =
      options.connectionTestTimeoutMs ?? DEFAULT_CONNECTION_TEST_TIMEOUT_MS;
    this.beforeConfigRecheck = options.beforeConfigRecheck;
  }

  /**
   * 列表连同健康状态：每次都读真实文件，负责的键不再是上次写入的值就报「已被外部修改」。
   * 只在这里和写入时检测，不在后台监听文件。
   */
  async list(provider: string): Promise<ApiEndpointListResult> {
    const supported = requireProvider(provider);
    const activeEndpointId = this.store.getActiveEndpointId(supported);
    const active = activeEndpointId ? this.store.getEndpoint(supported, activeEndpointId) : null;
    const status =
      supported === "codex" ? await this.inspectCodex(active) : this.inspectClaude(active);
    return {
      endpoints: this.store.listEndpoints(supported).map((endpoint) => this.toWire(endpoint)),
      activeEndpointId,
      health: status.health,
      cliBaseUrl: active ? null : status.baseUrl,
    };
  }

  activeEndpointId(provider: string): string | null {
    return this.store.getActiveEndpointId(requireProvider(provider));
  }

  /**
   * 启用中的接口勾选的模型，id 就是传给 CLI 的真实 id，默认模型即接口的默认模型。
   * 官方模式或不支持的提供方返回 null，模型目录照旧。
   */
  activeModels(provider: string): AgentModelDefinition[] | null {
    const supported = findProvider(provider);
    if (!supported) return null;
    const activeEndpointId = this.store.getActiveEndpointId(supported);
    if (!activeEndpointId) return null;
    const endpoint = this.store.getEndpoint(supported, activeEndpointId);
    if (!endpoint) return null;
    return endpoint.models.map((model) => {
      const label = model.label ?? model.id;
      const isDefault = model.id === endpoint.defaultModelId;
      return { provider: supported, id: model.id, label, isDefault };
    });
  }

  save(provider: string, input: ApiEndpointSaveInput): Promise<ApiEndpoint> {
    return this.exclusive(() => {
      const supported = requireProvider(provider);
      const existing = input.endpointId
        ? this.store.getEndpoint(supported, input.endpointId)
        : null;
      if (input.endpointId && !existing) {
        throw new ApiEndpointRequestError("not_found", "API endpoint not found");
      }
      const apiKey = input.apiKey?.trim() ? input.apiKey.trim() : undefined;
      if (!existing && !apiKey) {
        throw new ApiEndpointRequestError("invalid_input", "API key is required");
      }
      const timestamp = this.now().toISOString();
      const endpoint: StoredApiEndpoint = {
        id: existing?.id ?? `ep_${randomUUID()}`,
        provider: supported,
        ...validateFields(supported, input),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };

      // 编辑当前启用的接口：先按新配置改文件，改不成就整个不保存。
      // 官方模式下编辑 Codex 专用表所属的接口：只刷新专用表和 key 文件，旧会话恢复时用的是新配置。
      const isActive = this.store.getActiveEndpointId(supported) === endpoint.id;
      const ownsCodexTable =
        supported === "codex" &&
        this.store.readCodexTakeover().providerTable?.endpointId === endpoint.id;
      if (isActive || ownsCodexTable) {
        const resolvedKey = apiKey ?? this.store.getApiKey(endpoint.id);
        if (resolvedKey === null) {
          throw new ApiEndpointRequestError("not_found", "API key for this endpoint is missing");
        }
        if (isActive) {
          this.writeEndpoint(endpoint, resolvedKey);
        } else {
          this.refreshCodexProviderTable(endpoint, resolvedKey);
        }
      }
      this.store.upsertEndpoint(endpoint, apiKey);
      if (isActive) this.onActiveEndpointChanged(supported);
      return this.toWire(endpoint);
    });
  }

  delete(provider: string, endpointId: string): Promise<{ activeEndpointId: string | null }> {
    return this.exclusive(() => {
      const supported = requireProvider(provider);
      if (!this.store.getEndpoint(supported, endpointId)) {
        throw new ApiEndpointRequestError("not_found", "API endpoint not found");
      }
      // 删除启用中的接口前先切回官方，CLI 不能停在一个已经不存在的配置上。
      const wasActive = this.store.getActiveEndpointId(supported) === endpointId;
      if (wasActive) {
        this.restoreOfficial(supported);
        this.store.setActiveEndpointId(supported, null);
      }
      try {
        if (supported === "codex") this.removeCodexProviderTable(endpointId);
        this.store.removeEndpoint(supported, endpointId);
      } finally {
        // 删表失败时接口还在、模式已是官方；快照照样要跟着回到官方。
        if (wasActive) this.onActiveEndpointChanged(supported);
      }
      return { activeEndpointId: this.store.getActiveEndpointId(supported) };
    });
  }

  setActive(
    provider: string,
    endpointId: string | null,
  ): Promise<{ activeEndpointId: string | null }> {
    return this.exclusive(async () => {
      const supported = requireProvider(provider);
      if (endpointId === null) {
        this.restoreOfficial(supported);
        this.store.setActiveEndpointId(supported, null);
        this.onActiveEndpointChanged(supported);
        return { activeEndpointId: null };
      }
      const endpoint = this.store.getEndpoint(supported, endpointId);
      const apiKey = this.store.getApiKey(endpointId);
      if (!endpoint || apiKey === null) {
        throw new ApiEndpointRequestError("not_found", "API endpoint not found");
      }
      if (supported === "codex") await this.requireCodexAuthCommand();
      this.writeEndpoint(endpoint, apiKey);
      this.store.setActiveEndpointId(supported, endpointId);
      this.onActiveEndpointChanged(supported);
      return { activeEndpointId: endpointId };
    });
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
    const apiKey = this.resolveRequestKey(supported, input);
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
    const apiKey = this.resolveRequestKey(supported, input);
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
  private resolveRequestKey(
    provider: ApiEndpointProvider,
    input: ApiEndpointUpstreamInput,
  ): string {
    const typed = input.apiKey?.trim();
    if (typed) return typed;
    if (input.endpointId) {
      if (!this.store.getEndpoint(provider, input.endpointId)) {
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

  private writeEndpoint(endpoint: StoredApiEndpoint, apiKey: string): void {
    if (endpoint.provider === "codex") {
      this.writeCodexEndpoint(endpoint, apiKey);
    } else {
      this.writeClaudeEndpoint(endpoint, apiKey);
    }
  }

  private restoreOfficial(provider: ApiEndpointProvider): void {
    if (provider === "codex") {
      this.restoreCodexOfficial();
    } else {
      this.restoreClaudeOfficial();
    }
  }

  private writeClaudeEndpoint(endpoint: StoredApiEndpoint, apiKey: string): void {
    const settingsPath = this.resolveClaudeSettingsPath();
    const record = this.store.readClaudeTakeover();
    const env = buildClaudeEndpointEnv({
      baseUrl: endpoint.baseUrl,
      apiKey,
      defaultModelId: endpoint.defaultModelId,
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
    const versionOutput = await this.probeCodexVersion();
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
  private writeCodexEndpoint(endpoint: StoredApiEndpoint, apiKey: string): void {
    const configPath = this.resolveCodexConfigPath();
    const record = this.store.readCodexTakeover();
    const table = this.buildCodexProviderTable(endpoint);
    const previousKey = readOptionalFile(this.store.codexKeyFilePath);
    let createdBackup: string | null = null;
    this.writeConfigFile<{ takeover: CodexConfigTakeover; current: Buffer | null }>({
      filePath: configPath,
      compute: (text, current) => {
        const result = applyCodexApiEndpoint({
          text,
          model: endpoint.defaultModelId,
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
    const table = this.buildCodexProviderTable(endpoint);
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

  private buildCodexProviderTable(endpoint: StoredApiEndpoint): CodexProviderTable {
    // 保存时已校验过 URL，这里归一化不会落空；落空就是数据坏了，直接报错。
    const baseUrl = normalizeOpenAICompatibleBaseUrl(endpoint.baseUrl);
    if (baseUrl === null) {
      throw new ApiEndpointRequestError("invalid_input", "Base URL is empty");
    }
    return {
      name: endpoint.name,
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

  private inspectClaude(active: StoredApiEndpoint | null): ApiEndpointFileStatus {
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

  private async inspectCodex(active: StoredApiEndpoint | null): Promise<ApiEndpointFileStatus> {
    const configPath = this.resolveCodexConfigPath();
    const result = inspectCodexConfig({
      text: readOptionalFile(configPath)?.toString("utf8") ?? null,
      takeover: active ? this.store.readCodexTakeover().takeover : null,
      table: active ? this.buildCodexProviderTable(active) : null,
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
      versionOutput = await this.probeCodexVersion();
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

  private toWire(endpoint: StoredApiEndpoint): ApiEndpoint {
    return {
      id: endpoint.id,
      provider: endpoint.provider,
      name: endpoint.name,
      baseUrl: endpoint.baseUrl,
      models: endpoint.models,
      defaultModelId: endpoint.defaultModelId,
      ...(endpoint.modelMapping ? { modelMapping: endpoint.modelMapping } : {}),
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

function validateFields(
  provider: ApiEndpointProvider,
  input: ApiEndpointSaveInput,
): Pick<StoredApiEndpoint, "name" | "baseUrl" | "models" | "defaultModelId" | "modelMapping"> {
  const name = input.name.trim();
  if (!name) {
    throw new ApiEndpointRequestError("invalid_input", "Name is required");
  }
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const models: ApiEndpointModel[] = [];
  for (const model of input.models) {
    const id = model.id.trim();
    if (!id || models.some((existing) => existing.id === id)) continue;
    const label = model.label?.trim();
    models.push(label ? { id, label } : { id });
  }
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
  const modelMapping = validateModelMapping(provider, input.modelMapping, models);
  return { name, baseUrl, models, defaultModelId, ...(modelMapping ? { modelMapping } : {}) };
}

/** 每档只能是勾选的模型之一；空白档位视为不映射。只有 Claude 有映射。 */
function validateModelMapping(
  provider: ApiEndpointProvider,
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
  if (Object.keys(mapping).length === 0) return undefined;
  if (!apiEndpointHasModelMapping(provider)) {
    throw new ApiEndpointRequestError("invalid_input", "Only Claude endpoints have model mapping");
  }
  return mapping;
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
