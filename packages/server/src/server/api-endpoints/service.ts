import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type pino from "pino";
import {
  API_ENDPOINT_MODEL_TIERS,
  apiEndpointHasModelMapping,
  type ApiEndpoint,
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
import { PRIVATE_FILE_MODE } from "../private-files.js";
import {
  applyClaudeApiEndpoint,
  buildClaudeEndpointEnv,
  restoreClaudeOfficial,
} from "./claude-settings-patch.js";
import { buildCodexAuthCommand } from "./codex-auth-command.js";
import {
  applyCodexApiEndpoint,
  removeCodexProviderTable,
  replaceCodexProviderTable,
  restoreCodexOfficial,
  type CodexProviderTable,
} from "./codex-config-patch.js";
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
  }

  list(provider: string): { endpoints: ApiEndpoint[]; activeEndpointId: string | null } {
    const supported = requireProvider(provider);
    return {
      endpoints: this.store.listEndpoints(supported).map((endpoint) => this.toWire(endpoint)),
      activeEndpointId: this.store.getActiveEndpointId(supported),
    };
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
      if (supported === "codex") this.removeCodexProviderTable(endpointId);
      this.store.removeEndpoint(supported, endpointId);
      if (wasActive) this.onActiveEndpointChanged(supported);
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
    const current = readOptionalFile(settingsPath);
    const record = this.store.readClaudeTakeover();
    const result = applyClaudeApiEndpoint({
      text: current?.toString("utf8") ?? null,
      env: buildClaudeEndpointEnv({
        baseUrl: endpoint.baseUrl,
        apiKey,
        defaultModelId: endpoint.defaultModelId,
        modelMapping: endpoint.modelMapping,
      }),
      takeover: record.takeover,
    });
    if (result.kind === "unparsable") {
      throw unparsable(settingsPath, result.message);
    }

    const backup = record.backup ?? {
      path: this.store.writeClaudeSettingsBackup(current, this.now()),
    };
    // 先记接管记录再写文件：写文件失败时接管记录回滚；反过来会丢掉原值。
    this.store.writeClaudeTakeover({ takeover: result.takeover, backup });
    try {
      writeConfigFileKeepingMode(settingsPath, result.text);
    } catch (error) {
      this.store.writeClaudeTakeover(record);
      throw error;
    }
    this.logger.info(
      { settingsPath, endpointId: endpoint.id },
      "Claude settings switched to API endpoint",
    );
  }

  private restoreClaudeOfficial(): void {
    const record = this.store.readClaudeTakeover();
    if (!record.takeover) return;
    const settingsPath = this.resolveClaudeSettingsPath();
    const current = readOptionalFile(settingsPath);
    const result = restoreClaudeOfficial({
      text: current?.toString("utf8") ?? null,
      takeover: record.takeover,
    });
    if (result.kind === "unparsable") {
      throw unparsable(settingsPath, result.message);
    }
    if (result.kind === "patched") {
      writeConfigFileKeepingMode(settingsPath, result.text);
    }
    if (result.kind === "delete") {
      rmSync(settingsPath, { force: true });
    }
    this.store.writeClaudeTakeover({ takeover: null, backup: record.backup });
    this.logger.info({ settingsPath }, "Claude settings restored to Official");
  }

  private async requireCodexAuthCommand(): Promise<void> {
    const versionOutput = await this.probeCodexVersion();
    if (!codexVersionAtLeast(versionOutput, CODEX_AUTH_COMMAND_MIN_VERSION)) {
      throw new ApiEndpointRequestError(
        "codex_version_unsupported",
        `API endpoints need Codex ${CODEX_AUTH_COMMAND_MIN_VERSION.join(".")} or later, which reads the API key through auth.command. Found: ${versionOutput}`,
      );
    }
  }

  /**
   * 先算好 config.toml 的新内容（解析失败就什么都不写），再写 key 文件，最后写 config.toml。
   * config.toml 写不成时 key 文件和接管记录都退回切换前的样子。
   */
  private writeCodexEndpoint(endpoint: StoredApiEndpoint, apiKey: string): void {
    const configPath = this.resolveCodexConfigPath();
    const current = readOptionalFile(configPath);
    const record = this.store.readCodexTakeover();
    const result = applyCodexApiEndpoint({
      text: current?.toString("utf8") ?? null,
      model: endpoint.defaultModelId,
      table: this.buildCodexProviderTable(endpoint),
      takeover: record.takeover,
    });
    if (result.kind === "unparsable") {
      throw unparsable(configPath, result.message);
    }

    const backup = record.backup ?? {
      path: this.store.writeCodexConfigBackup(current, this.now()),
    };
    const previousKey = readOptionalFile(this.store.codexKeyFilePath);
    this.store.writeCodexKeyFile(apiKey);
    this.store.writeCodexTakeover({
      takeover: result.takeover,
      providerTable: { endpointId: endpoint.id },
      backup,
    });
    try {
      writeConfigFileKeepingMode(configPath, result.text);
    } catch (error) {
      this.store.writeCodexTakeover(record);
      this.store.writeCodexKeyFile(previousKey);
      throw error;
    }
    this.logger.info(
      { configPath, endpointId: endpoint.id },
      "Codex config switched to API endpoint",
    );
  }

  private refreshCodexProviderTable(endpoint: StoredApiEndpoint, apiKey: string): void {
    const configPath = this.resolveCodexConfigPath();
    const current = readOptionalFile(configPath);
    const result = replaceCodexProviderTable({
      text: current?.toString("utf8") ?? null,
      table: this.buildCodexProviderTable(endpoint),
    });
    if (result.kind === "unparsable") {
      throw unparsable(configPath, result.message);
    }
    // 文件已经不在了：专用表也就不在了，没什么可刷新的。
    if (result.kind === "missing") return;
    const previousKey = readOptionalFile(this.store.codexKeyFilePath);
    this.store.writeCodexKeyFile(apiKey);
    try {
      writeConfigFileKeepingMode(configPath, result.text);
    } catch (error) {
      this.store.writeCodexKeyFile(previousKey);
      throw error;
    }
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
    if (!record.takeover) return;
    const configPath = this.resolveCodexConfigPath();
    const current = readOptionalFile(configPath);
    const result = restoreCodexOfficial({
      text: current?.toString("utf8") ?? null,
      takeover: record.takeover,
    });
    if (result.kind === "unparsable") {
      throw unparsable(configPath, result.message);
    }
    if (result.kind === "patched") {
      writeConfigFileKeepingMode(configPath, result.text);
    }
    // 专用表和 key 文件都留着，第三方模式下的 Codex 会话还能恢复。
    this.store.writeCodexTakeover({ ...record, takeover: null });
    this.logger.info({ configPath }, "Codex config restored to Official");
  }

  /** 删除的是专用表当前所属的接口时，拿掉专用表和 key 文件。调用前已切回官方。 */
  private removeCodexProviderTable(endpointId: string): void {
    const record = this.store.readCodexTakeover();
    if (record.providerTable?.endpointId !== endpointId) return;
    const configPath = this.resolveCodexConfigPath();
    const current = readOptionalFile(configPath);
    const result = removeCodexProviderTable({ text: current?.toString("utf8") ?? null });
    if (result.kind === "unparsable") {
      throw unparsable(configPath, result.message);
    }
    if (result.kind === "patched") {
      // 接管前没有这个文件、现在又只剩 Osuna 写的东西：删掉，回到原样。
      if (result.text === "" && record.backup?.path === null) {
        rmSync(configPath, { force: true });
      } else {
        writeConfigFileKeepingMode(configPath, result.text);
      }
    }
    this.store.writeCodexKeyFile(null);
    this.store.writeCodexTakeover({ ...record, providerTable: null });
    this.logger.info({ configPath, endpointId }, "Codex API endpoint provider table removed");
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

/**
 * 原子替换 CLI 自己的配置文件，保留原有权限位、不动所在目录的权限。
 * 新建的文件含 token，按 0600 创建。
 */
function writeConfigFileKeepingMode(filePath: string, text: string): void {
  const mode = readOptionalMode(filePath) ?? PRIVATE_FILE_MODE;
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}`,
  );
  try {
    writeFileSync(temporary, text, { mode });
    // writeFileSync 的 mode 会被 umask 削掉，显式再设一次。
    if (process.platform !== "win32") chmodSync(temporary, mode);
    renameSync(temporary, filePath);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function readOptionalMode(filePath: string): number | null {
  try {
    return statSync(filePath).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function readOptionalFile(filePath: string): Buffer | null {
  try {
    return readFileSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
