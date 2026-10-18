import type pino from "pino";
import type {
  ApiEndpointAgentSettings,
  ApiEndpointError,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import {
  ApiEndpointRequestError,
  type ApiEndpointAgentSettingsInput,
  type ApiEndpointService,
  type KeepCurrentSettingsCode,
} from "../../api-endpoints/service.js";

export interface ApiEndpointSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

type ApiEndpointRequest = Extract<
  SessionInboundMessage,
  {
    type:
      | "provider.api_endpoint.list.request"
      | "provider.api_endpoint.save.request"
      | "provider.api_endpoint.delete.request"
      | "provider.api_endpoint.set_active.request"
      | "provider.api_endpoint.set_agent_settings.request"
      | "provider.api_endpoint.keep_current_settings.request"
      | "provider.api_endpoint.set_endpoint_state.request"
      | "provider.api_endpoint.fetch_models.request"
      | "provider.api_endpoint.test_connection.request"
      | "provider.api_endpoint.detect_formats.request"
      | "provider.api_endpoint.cancel.request";
  }
>;

/** daemon 没有这项服务时为 null，同时也不声明 apiEndpoints 能力。 */
export function createApiEndpointSession(options: {
  host: ApiEndpointSessionHost;
  service: ApiEndpointService | undefined;
  logger: pino.Logger;
}): ApiEndpointSession | null {
  if (!options.service) return null;
  return new ApiEndpointSession({ ...options, service: options.service });
}

/** 失败放进响应的 error 字段，App 按 code 选文案；请求里的 API key 从不写日志。 */
export class ApiEndpointSession {
  private readonly host: ApiEndpointSessionHost;
  private readonly service: ApiEndpointService;
  private readonly logger: pino.Logger;
  // 还在进行的上游请求，按 requestId 取消；会话关闭时全部取消。
  private readonly upstreamRequests = new Map<string, AbortController>();

  constructor(options: {
    host: ApiEndpointSessionHost;
    service: ApiEndpointService;
    logger: pino.Logger;
  }) {
    this.host = options.host;
    this.service = options.service;
    this.logger = options.logger;
  }

  /** `connectionSignal`：发起请求的连接断开时触发，上游请求随之取消。 */
  async handle(request: ApiEndpointRequest, connectionSignal: AbortSignal): Promise<void> {
    switch (request.type) {
      case "provider.api_endpoint.list.request":
        return this.handleList(request);
      case "provider.api_endpoint.save.request":
        return this.handleSave(request);
      case "provider.api_endpoint.delete.request":
        return this.handleDelete(request);
      case "provider.api_endpoint.set_active.request":
        return this.handleSetActive(request);
      case "provider.api_endpoint.set_agent_settings.request":
        return this.handleSetAgentSettings(request);
      case "provider.api_endpoint.keep_current_settings.request":
        return this.handleKeepCurrentSettings(request);
      case "provider.api_endpoint.set_endpoint_state.request":
        return this.handleSetEndpointState(request);
      case "provider.api_endpoint.fetch_models.request":
        return this.handleFetchModels(request, connectionSignal);
      case "provider.api_endpoint.test_connection.request":
        return this.handleTestConnection(request, connectionSignal);
      case "provider.api_endpoint.detect_formats.request":
        return this.handleDetectFormats(request, connectionSignal);
      case "provider.api_endpoint.cancel.request":
        return this.handleCancel(request);
    }
  }

  dispose(): void {
    for (const controller of this.upstreamRequests.values()) controller.abort();
    this.upstreamRequests.clear();
  }

  private async handleList(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.list.request" }>,
  ): Promise<void> {
    try {
      const result = await this.service.list(request.provider);
      this.host.emit({
        type: "provider.api_endpoint.list.response",
        payload: {
          requestId: request.requestId,
          provider: request.provider,
          ...result,
          error: null,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "provider.api_endpoint.list.response",
        payload: {
          requestId: request.requestId,
          provider: request.provider,
          endpoints: [],
          activeEndpointId: null,
          error: this.toWireError(error, request),
        },
      });
    }
  }

  private async handleSave(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.save.request" }>,
  ): Promise<void> {
    try {
      const endpoint = await this.service.save(request.provider, {
        ...(request.endpointId !== undefined ? { endpointId: request.endpointId } : {}),
        name: request.name,
        ...(request.baseUrl !== undefined ? { baseUrl: request.baseUrl } : {}),
        ...(request.baseUrls !== undefined ? { baseUrls: request.baseUrls } : {}),
        ...(request.apiKey !== undefined ? { apiKey: request.apiKey } : {}),
        models: request.models,
        ...(request.defaultModelId !== undefined ? { defaultModelId: request.defaultModelId } : {}),
        ...(request.modelMapping !== undefined ? { modelMapping: request.modelMapping } : {}),
        ...(request.manualModels !== undefined ? { manualModels: request.manualModels } : {}),
        ...(request.searchesWeb !== undefined ? { searchesWeb: request.searchesWeb } : {}),
      });
      this.host.emit({
        type: "provider.api_endpoint.save.response",
        payload: { requestId: request.requestId, endpoint, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "provider.api_endpoint.save.response",
        payload: {
          requestId: request.requestId,
          endpoint: null,
          error: this.toWireError(error, request),
        },
      });
    }
  }

  private async handleDelete(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.delete.request" }>,
  ): Promise<void> {
    try {
      const result = await this.service.delete(request.provider, request.endpointId);
      this.host.emit({
        type: "provider.api_endpoint.delete.response",
        payload: { requestId: request.requestId, ...result, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "provider.api_endpoint.delete.response",
        payload: {
          requestId: request.requestId,
          activeEndpointId: this.currentActive(request.provider),
          error: this.toWireError(error, request),
        },
      });
    }
  }

  private async handleSetActive(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.set_active.request" }>,
  ): Promise<void> {
    try {
      const result = await this.service.setActive(request.provider, request.endpointId);
      this.host.emit({
        type: "provider.api_endpoint.set_active.response",
        payload: { requestId: request.requestId, ...result, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "provider.api_endpoint.set_active.response",
        payload: {
          requestId: request.requestId,
          activeEndpointId: this.currentActive(request.provider),
          error: this.toWireError(error, request),
        },
      });
    }
  }

  private async handleSetAgentSettings(
    request: Extract<
      ApiEndpointRequest,
      { type: "provider.api_endpoint.set_agent_settings.request" }
    >,
  ): Promise<void> {
    // 省略即不变，null 为不设。
    const thinking =
      request.defaultThinkingOptionId === undefined
        ? {}
        : { defaultThinkingOptionId: request.defaultThinkingOptionId };
    const ultraCode =
      request.usesUltraCode === undefined ? {} : { usesUltraCode: request.usesUltraCode };
    const sideModels = sideModelsRequested(request);
    try {
      const { agent, connection } = await this.service.setAgentSettings(request.provider, {
        enabled: request.enabled,
        ...thinking,
        ...ultraCode,
        ...sideModels,
        ...(request.defaultModelId !== undefined ? { defaultModelId: request.defaultModelId } : {}),
        ...(request.reapply !== undefined ? { reapply: request.reapply } : {}),
        ...(request.keepsClaudeAiLogin !== undefined
          ? { keepsClaudeAiLogin: request.keepsClaudeAiLogin }
          : {}),
      });
      this.host.emit({
        type: "provider.api_endpoint.set_agent_settings.response",
        payload: {
          requestId: request.requestId,
          provider: request.provider,
          agent,
          connection,
          error: null,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "provider.api_endpoint.set_agent_settings.response",
        payload: {
          requestId: request.requestId,
          provider: request.provider,
          agent: this.currentAgentSettings(request.provider),
          error: this.toWireError(error, request),
        },
      });
    }
  }

  private async handleKeepCurrentSettings(
    request: Extract<
      ApiEndpointRequest,
      { type: "provider.api_endpoint.keep_current_settings.request" }
    >,
  ): Promise<void> {
    try {
      const code = keepCurrentSettingsCode(request.code);
      const agent = await this.service.keepCurrentSettings({ provider: request.provider, code });
      this.host.emit({
        type: "provider.api_endpoint.keep_current_settings.response",
        payload: { requestId: request.requestId, provider: request.provider, agent, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "provider.api_endpoint.keep_current_settings.response",
        payload: {
          requestId: request.requestId,
          provider: request.provider,
          agent: this.currentAgentSettings(request.provider),
          error: this.toWireError(error, request),
        },
      });
    }
  }

  private async handleSetEndpointState(
    request: Extract<
      ApiEndpointRequest,
      { type: "provider.api_endpoint.set_endpoint_state.request" }
    >,
  ): Promise<void> {
    let error: ApiEndpointError | null = null;
    try {
      await this.service.setEndpointState({
        endpointId: request.endpointId,
        ...(request.enabled !== undefined ? { enabled: request.enabled } : {}),
        ...(request.clearCooldown !== undefined ? { clearCooldown: request.clearCooldown } : {}),
      });
    } catch (caught) {
      error = this.toWireError(caught, request);
    }
    this.host.emit({
      type: "provider.api_endpoint.set_endpoint_state.response",
      payload: { requestId: request.requestId, endpointId: request.endpointId, error },
    });
  }

  private async handleFetchModels(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.fetch_models.request" }>,
    connectionSignal: AbortSignal,
  ): Promise<void> {
    const { signal, release } = this.trackUpstreamRequest(request.requestId, connectionSignal);
    try {
      const models = await this.service.fetchModels(
        request.provider,
        {
          ...(request.endpointId !== undefined ? { endpointId: request.endpointId } : {}),
          baseUrl: request.baseUrl,
          ...(request.apiKey !== undefined ? { apiKey: request.apiKey } : {}),
          ...(request.format !== undefined ? { format: request.format } : {}),
        },
        signal,
      );
      this.host.emit({
        type: "provider.api_endpoint.fetch_models.response",
        payload: { requestId: request.requestId, models, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "provider.api_endpoint.fetch_models.response",
        payload: {
          requestId: request.requestId,
          models: [],
          error: this.toWireError(error, request),
        },
      });
    } finally {
      release();
    }
  }

  private async handleTestConnection(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.test_connection.request" }>,
    connectionSignal: AbortSignal,
  ): Promise<void> {
    const { signal, release } = this.trackUpstreamRequest(request.requestId, connectionSignal);
    try {
      const result = await this.service.testConnection(
        request.provider,
        {
          ...(request.endpointId !== undefined ? { endpointId: request.endpointId } : {}),
          baseUrl: request.baseUrl,
          ...(request.apiKey !== undefined ? { apiKey: request.apiKey } : {}),
          ...(request.modelId !== undefined ? { modelId: request.modelId } : {}),
          ...(request.format !== undefined ? { format: request.format } : {}),
        },
        signal,
      );
      this.host.emit({
        type: "provider.api_endpoint.test_connection.response",
        payload: { requestId: request.requestId, result, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "provider.api_endpoint.test_connection.response",
        payload: {
          requestId: request.requestId,
          result: null,
          error: this.toWireError(error, request),
        },
      });
    } finally {
      release();
    }
  }

  private async handleDetectFormats(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.detect_formats.request" }>,
    connectionSignal: AbortSignal,
  ): Promise<void> {
    const { signal, release } = this.trackUpstreamRequest(request.requestId, connectionSignal);
    try {
      const results = await this.service.detectFormats(
        {
          ...(request.endpointId !== undefined ? { endpointId: request.endpointId } : {}),
          baseUrl: request.baseUrl,
          ...(request.apiKey !== undefined ? { apiKey: request.apiKey } : {}),
        },
        signal,
      );
      this.host.emit({
        type: "provider.api_endpoint.detect_formats.response",
        payload: { requestId: request.requestId, results, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "provider.api_endpoint.detect_formats.response",
        payload: {
          requestId: request.requestId,
          results: [],
          error: this.toWireError(error, request),
        },
      });
    } finally {
      release();
    }
  }

  /** 登记一条可按 requestId 取消的上游请求；连接断开时一并取消。 */
  private trackUpstreamRequest(
    requestId: string,
    connectionSignal: AbortSignal,
  ): { signal: AbortSignal; release: () => void } {
    const controller = new AbortController();
    this.upstreamRequests.set(requestId, controller);
    return {
      signal: AbortSignal.any([controller.signal, connectionSignal]),
      release: () => this.upstreamRequests.delete(requestId),
    };
  }

  private async handleCancel(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.cancel.request" }>,
  ): Promise<void> {
    const controller = this.upstreamRequests.get(request.targetRequestId);
    controller?.abort();
    this.host.emit({
      type: "provider.api_endpoint.cancel.response",
      payload: { requestId: request.requestId, cancelled: controller !== undefined },
    });
  }

  /** 失败后状态保持切换前的样子，回报真实的当前启用接口。 */
  private currentActive(provider: string): string | null {
    try {
      return this.service.activeEndpointId(provider);
    } catch (error) {
      if (error instanceof ApiEndpointRequestError) return null;
      throw error;
    }
  }

  /** 失败后设置保持原样，回报真实的当前设置；读不到时为 null。 */
  private currentAgentSettings(provider: string): ApiEndpointAgentSettings | null {
    try {
      return this.service.agentSettings(provider);
    } catch (error) {
      if (error instanceof ApiEndpointRequestError) return null;
      throw error;
    }
  }

  private toWireError(error: unknown, request: ApiEndpointRequest): ApiEndpointError {
    if (error instanceof ApiEndpointRequestError) {
      this.logger.warn(
        { code: error.code, requestType: request.type },
        "API endpoint request rejected",
      );
      const wireError: ApiEndpointError = { code: error.code, message: error.message };
      if (error.params) wireError.params = error.params;
      return wireError;
    }
    this.logger.error({ err: error, requestType: request.type }, "API endpoint request failed");
    return {
      code: "unknown",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 「保留当前设置」回应的提示：省略为关掉总开关；认得的只有 model_replaced，别的明确拒绝。 */
function keepCurrentSettingsCode(code: string | undefined): KeepCurrentSettingsCode | undefined {
  switch (code) {
    case undefined:
    case "model_replaced":
      return code;
    default:
      throw new ApiEndpointRequestError({
        code: "invalid_input",
        message: `Keep current settings doesn't answer '${code}'`,
      });
  }
}

type SideModelsRequest = Pick<
  ApiEndpointAgentSettingsInput,
  "backgroundModelId" | "subagentModelId" | "subagentThinkingOptionId"
>;

/** 后台小任务模型、Subagent 模型与它的思考档位：只带客户端给了的（省略即不变，null 为不设）。 */
function sideModelsRequested(request: SideModelsRequest): SideModelsRequest {
  const requested: SideModelsRequest = {};
  if (request.backgroundModelId !== undefined) {
    requested.backgroundModelId = request.backgroundModelId;
  }
  if (request.subagentModelId !== undefined) requested.subagentModelId = request.subagentModelId;
  if (request.subagentThinkingOptionId !== undefined) {
    requested.subagentThinkingOptionId = request.subagentThinkingOptionId;
  }
  return requested;
}
