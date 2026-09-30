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
import type { ApiEndpoint, ApiEndpointModel } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { resolveAgentHookConfigPath } from "../../terminal/agent-hooks/agent-hook-installer.js";
import { claudeAgentHookProvider } from "../../terminal/agent-hooks/claude/claude.js";
import { PRIVATE_FILE_MODE } from "../private-files.js";
import {
  applyClaudeApiEndpoint,
  buildClaudeEndpointEnv,
  restoreClaudeOfficial,
} from "./claude-settings-patch.js";
import {
  API_ENDPOINT_PROVIDERS,
  ApiEndpointStore,
  type ApiEndpointProvider,
  type StoredApiEndpoint,
} from "./store.js";

export type ApiEndpointErrorCode =
  | "unsupported_provider"
  | "invalid_input"
  | "not_found"
  | "config_unparsable";

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
}

export interface ApiEndpointServiceOptions {
  paseoHome: string;
  logger: pino.Logger;
  // 定位 CLI 配置文件用；缺省取 daemon 自己的环境，测试注入临时目录。
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  now?: () => Date;
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
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: ApiEndpointServiceOptions) {
    this.store = new ApiEndpointStore(options.paseoHome);
    this.logger = options.logger.child({ module: "api-endpoints" });
    this.env = options.env ?? process.env;
    this.homeDir = options.homeDir ?? homedir();
    this.now = options.now ?? (() => new Date());
  }

  list(provider: string): { endpoints: ApiEndpoint[]; activeEndpointId: string | null } {
    const supported = requireProvider(provider);
    return {
      endpoints: this.store.listEndpoints(supported).map((endpoint) => this.toWire(endpoint)),
      activeEndpointId: this.store.getActiveEndpointId(supported),
    };
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
        ...validateFields(input),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };

      // 编辑当前启用的接口：先按新配置改文件，改不成就整个不保存。
      if (this.store.getActiveEndpointId(supported) === endpoint.id) {
        const resolvedKey = apiKey ?? this.store.getApiKey(endpoint.id);
        if (resolvedKey === null) {
          throw new ApiEndpointRequestError("not_found", "API key for this endpoint is missing");
        }
        this.writeClaudeEndpoint(endpoint, resolvedKey);
      }
      this.store.upsertEndpoint(endpoint, apiKey);
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
      if (this.store.getActiveEndpointId(supported) === endpointId) {
        this.restoreClaudeOfficial();
        this.store.setActiveEndpointId(supported, null);
      }
      this.store.removeEndpoint(supported, endpointId);
      return { activeEndpointId: this.store.getActiveEndpointId(supported) };
    });
  }

  setActive(
    provider: string,
    endpointId: string | null,
  ): Promise<{ activeEndpointId: string | null }> {
    return this.exclusive(() => {
      const supported = requireProvider(provider);
      if (endpointId === null) {
        this.restoreClaudeOfficial();
        this.store.setActiveEndpointId(supported, null);
        return { activeEndpointId: null };
      }
      const endpoint = this.store.getEndpoint(supported, endpointId);
      const apiKey = this.store.getApiKey(endpointId);
      if (!endpoint || apiKey === null) {
        throw new ApiEndpointRequestError("not_found", "API endpoint not found");
      }
      this.writeClaudeEndpoint(endpoint, apiKey);
      this.store.setActiveEndpointId(supported, endpointId);
      return { activeEndpointId: endpointId };
    });
  }

  resolveClaudeSettingsPath(): string {
    return resolveAgentHookConfigPath(claudeAgentHookProvider, {
      env: this.env,
      homeDir: this.homeDir,
    });
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

  private toWire(endpoint: StoredApiEndpoint): ApiEndpoint {
    return {
      id: endpoint.id,
      provider: endpoint.provider,
      name: endpoint.name,
      baseUrl: endpoint.baseUrl,
      models: endpoint.models,
      defaultModelId: endpoint.defaultModelId,
      hasApiKey: this.store.getApiKey(endpoint.id) !== null,
    };
  }

  private exclusive<T>(run: () => T): Promise<T> {
    const next = this.queue.then(run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

function requireProvider(provider: string): ApiEndpointProvider {
  const supported = API_ENDPOINT_PROVIDERS.find((candidate) => candidate === provider);
  if (!supported) {
    throw new ApiEndpointRequestError(
      "unsupported_provider",
      `API endpoints are not supported for provider '${provider}'`,
    );
  }
  return supported;
}

function validateFields(
  input: ApiEndpointSaveInput,
): Pick<StoredApiEndpoint, "name" | "baseUrl" | "models" | "defaultModelId"> {
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
  return { name, baseUrl, models, defaultModelId };
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
