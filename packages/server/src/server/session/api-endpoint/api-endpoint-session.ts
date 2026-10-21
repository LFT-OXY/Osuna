import type pino from "pino";
import type {
  ApiEndpointAgentSettings,
  ApiEndpointError,
  ApiEndpointIconImage,
  ApiEndpointRequestExtras,
  ApiEndpointVendorStatusResponse,
  ApiEndpointImportScanResponse,
  ApiEndpointImportResponse,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { keyHeaderOf } from "@getpaseo/protocol/api-endpoint/request-extras";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import {
  ApiEndpointRequestError,
  type ApiEndpointAgentSettingsInput,
  type ApiEndpointService,
  type ApiEndpointRequestExtrasInput,
  type KeepCurrentSettingsCode,
  validateModelScope,
} from "../../api-endpoints/service.js";

export interface ApiEndpointSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export type ApiEndpointRequest = Extract<
  SessionInboundMessage,
  {
    type:
      | "provider.api_endpoint.list.request"
      | "provider.api_endpoint.save.request"
      | "provider.api_endpoint.delete.request"
      | "provider.api_endpoint.set_active.request"
      | "provider.api_endpoint.set_agent_settings.request"
      | "provider.api_endpoint.keep_current_settings.request"
      | "provider.api_endpoint.preview_switch_off.request"
      | "provider.api_endpoint.set_endpoint_state.request"
      | "provider.api_endpoint.set_order.request"
      | "provider.api_endpoint.set_long_conversations.request"
      | "provider.api_endpoint.set_disabled_models.request"
      | "provider.api_endpoint.set_endpoint_name_display.request"
      | "provider.api_endpoint.reveal_key.request"
      | "provider.api_endpoint.forget_catalog.request"
      | "provider.api_endpoint.vendor_status.request"
      | "provider.api_endpoint.import_scan.request"
      | "provider.api_endpoint.import.request"
      | "provider.api_endpoint.list_templates.request"
      | "provider.api_endpoint.store_icon.request"
      | "provider.api_endpoint.fetch_site_icon.request"
      | "provider.api_endpoint.read_icon.request"
      | "provider.api_endpoint.fetch_models.request"
      | "provider.api_endpoint.test_connection.request"
      | "provider.api_endpoint.detect_formats.request"
      | "provider.api_endpoint.test_models.request"
      | "provider.api_endpoint.cancel.request";
  }
>;

// 写成以类型为键的对象：ApiEndpointRequest 加了类型而这里漏了，类型检查就过不去。
const API_ENDPOINT_REQUEST_TYPES: Record<ApiEndpointRequest["type"], true> = {
  "provider.api_endpoint.list.request": true,
  "provider.api_endpoint.save.request": true,
  "provider.api_endpoint.delete.request": true,
  "provider.api_endpoint.set_active.request": true,
  "provider.api_endpoint.set_agent_settings.request": true,
  "provider.api_endpoint.keep_current_settings.request": true,
  "provider.api_endpoint.preview_switch_off.request": true,
  "provider.api_endpoint.set_endpoint_state.request": true,
  "provider.api_endpoint.set_order.request": true,
  "provider.api_endpoint.set_long_conversations.request": true,
  "provider.api_endpoint.set_disabled_models.request": true,
  "provider.api_endpoint.set_endpoint_name_display.request": true,
  "provider.api_endpoint.reveal_key.request": true,
  "provider.api_endpoint.forget_catalog.request": true,
  "provider.api_endpoint.vendor_status.request": true,
  "provider.api_endpoint.import_scan.request": true,
  "provider.api_endpoint.import.request": true,
  "provider.api_endpoint.list_templates.request": true,
  "provider.api_endpoint.store_icon.request": true,
  "provider.api_endpoint.fetch_site_icon.request": true,
  "provider.api_endpoint.read_icon.request": true,
  "provider.api_endpoint.fetch_models.request": true,
  "provider.api_endpoint.test_connection.request": true,
  "provider.api_endpoint.detect_formats.request": true,
  "provider.api_endpoint.test_models.request": true,
  "provider.api_endpoint.cancel.request": true,
};

export function isApiEndpointRequest(msg: SessionInboundMessage): msg is ApiEndpointRequest {
  return Object.hasOwn(API_ENDPOINT_REQUEST_TYPES, msg.type);
}

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
      case "provider.api_endpoint.preview_switch_off.request":
        return this.handlePreviewSwitchOff(request);
      case "provider.api_endpoint.set_endpoint_state.request":
        return this.handleSetEndpointState(request);
      case "provider.api_endpoint.set_order.request":
        return this.handleSetOrder(request);
      case "provider.api_endpoint.set_long_conversations.request":
        return this.handleSetLongConversations(request);
      case "provider.api_endpoint.set_disabled_models.request":
        return this.handleSetDisabledModels(request);
      case "provider.api_endpoint.set_endpoint_name_display.request":
        return this.handleSetEndpointNameDisplay(request);
      case "provider.api_endpoint.reveal_key.request":
        return this.handleRevealKey(request);
      case "provider.api_endpoint.forget_catalog.request":
        return this.handleForgetCatalog(request);
      case "provider.api_endpoint.vendor_status.request":
        return this.handleVendorStatus(request);
      default:
        return this.handleAddingAids(request, connectionSignal);
    }
  }

  /** 添加接口的辅助：模板、图标、从别的软件导入；其余是要向上游发请求的几种。 */
  private async handleAddingAids(
    request: Extract<
      ApiEndpointRequest,
      {
        type:
          | "provider.api_endpoint.import_scan.request"
          | "provider.api_endpoint.import.request"
          | "provider.api_endpoint.list_templates.request"
          | "provider.api_endpoint.store_icon.request"
          | "provider.api_endpoint.read_icon.request"
          | "provider.api_endpoint.fetch_site_icon.request"
          | "provider.api_endpoint.fetch_models.request"
          | "provider.api_endpoint.test_connection.request"
          | "provider.api_endpoint.detect_formats.request"
          | "provider.api_endpoint.test_models.request"
          | "provider.api_endpoint.cancel.request";
      }
    >,
    connectionSignal: AbortSignal,
  ): Promise<void> {
    switch (request.type) {
      case "provider.api_endpoint.import_scan.request":
        return this.handleImportScan(request);
      case "provider.api_endpoint.import.request":
        return this.handleImport(request);
      case "provider.api_endpoint.list_templates.request":
        return this.handleListTemplates(request);
      case "provider.api_endpoint.store_icon.request":
        return this.handleStoreIcon(request);
      case "provider.api_endpoint.read_icon.request":
        return this.handleReadIcon(request);
      default:
        return this.handleUpstream(request, connectionSignal);
    }
  }

  /** 要向上游发请求的几种（可被取消），与取消本身。 */
  private async handleUpstream(
    request: Extract<
      ApiEndpointRequest,
      {
        type:
          | "provider.api_endpoint.fetch_site_icon.request"
          | "provider.api_endpoint.fetch_models.request"
          | "provider.api_endpoint.test_connection.request"
          | "provider.api_endpoint.detect_formats.request"
          | "provider.api_endpoint.test_models.request"
          | "provider.api_endpoint.cancel.request";
      }
    >,
    connectionSignal: AbortSignal,
  ): Promise<void> {
    switch (request.type) {
      case "provider.api_endpoint.fetch_site_icon.request":
        return this.handleFetchSiteIcon(request, connectionSignal);
      case "provider.api_endpoint.fetch_models.request":
        return this.handleFetchModels(request, connectionSignal);
      case "provider.api_endpoint.test_connection.request":
        return this.handleTestConnection(request, connectionSignal);
      case "provider.api_endpoint.detect_formats.request":
        return this.handleDetectFormats(request, connectionSignal);
      case "provider.api_endpoint.test_models.request":
        return this.handleTestModels(request, connectionSignal);
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
        ...(request.copyOf !== undefined ? { copyOf: request.copyOf } : {}),
        ...(request.templateId !== undefined ? { templateId: request.templateId } : {}),
        ...(request.region !== undefined ? { region: request.region } : {}),
        ...(request.icon !== undefined ? { icon: request.icon } : {}),
        ...(request.catalog !== undefined ? { catalog: request.catalog } : {}),
        ...(request.modelScope !== undefined
          ? { modelScope: validateModelScope(request.modelScope) }
          : {}),
        ...(request.autoPick !== undefined ? { autoPick: request.autoPick } : {}),
        ...(request.modelSettings !== undefined ? { modelSettings: request.modelSettings } : {}),
        ...(request.cooldownSettings !== undefined
          ? { cooldownSettings: request.cooldownSettings }
          : {}),
        ...requestExtrasOf(request),
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

  private async handlePreviewSwitchOff(
    request: Extract<
      ApiEndpointRequest,
      { type: "provider.api_endpoint.preview_switch_off.request" }
    >,
  ): Promise<void> {
    try {
      const preview = await this.service.previewSwitchOff(request.provider);
      this.host.emit({
        type: "provider.api_endpoint.preview_switch_off.response",
        payload: { requestId: request.requestId, provider: request.provider, preview, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "provider.api_endpoint.preview_switch_off.response",
        payload: {
          requestId: request.requestId,
          provider: request.provider,
          preview: null,
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

  private async handleSetOrder(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.set_order.request" }>,
  ): Promise<void> {
    let error: ApiEndpointError | null = null;
    try {
      await this.service.setOrder(request.endpointIds);
    } catch (caught) {
      error = this.toWireError(caught, request);
    }
    this.host.emit({
      type: "provider.api_endpoint.set_order.response",
      payload: { requestId: request.requestId, error },
    });
  }

  private async handleSetLongConversations(
    request: Extract<
      ApiEndpointRequest,
      { type: "provider.api_endpoint.set_long_conversations.request" }
    >,
  ): Promise<void> {
    let error: ApiEndpointError | null = null;
    try {
      await this.service.setLongConversations({
        fullContext: request.fullContext,
        ...(request.compactAt !== undefined ? { compactAt: request.compactAt } : {}),
      });
    } catch (caught) {
      error = this.toWireError(caught, request);
    }
    this.host.emit({
      type: "provider.api_endpoint.set_long_conversations.response",
      payload: { requestId: request.requestId, error },
    });
  }

  private async handleSetDisabledModels(
    request: Extract<
      ApiEndpointRequest,
      { type: "provider.api_endpoint.set_disabled_models.request" }
    >,
  ): Promise<void> {
    let error: ApiEndpointError | null = null;
    try {
      await this.service.setDisabledModels({ models: request.models });
    } catch (caught) {
      error = this.toWireError(caught, request);
    }
    this.host.emit({
      type: "provider.api_endpoint.set_disabled_models.response",
      payload: { requestId: request.requestId, error },
    });
  }

  private async handleSetEndpointNameDisplay(
    request: Extract<
      ApiEndpointRequest,
      { type: "provider.api_endpoint.set_endpoint_name_display.request" }
    >,
  ): Promise<void> {
    let error: ApiEndpointError | null = null;
    try {
      await this.service.setEndpointNameDisplay({ display: request.display });
    } catch (caught) {
      error = this.toWireError(caught, request);
    }
    this.host.emit({
      type: "provider.api_endpoint.set_endpoint_name_display.response",
      payload: { requestId: request.requestId, error },
    });
  }

  private async handleRevealKey(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.reveal_key.request" }>,
  ): Promise<void> {
    let apiKey: string | null = null;
    let error: ApiEndpointError | null = null;
    try {
      apiKey = this.service.revealKey(request.endpointId);
    } catch (caught) {
      error = this.toWireError(caught, request);
    }
    this.host.emit({
      type: "provider.api_endpoint.reveal_key.response",
      payload: { requestId: request.requestId, apiKey, error },
    });
  }

  private async handleForgetCatalog(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.forget_catalog.request" }>,
  ): Promise<void> {
    let error: ApiEndpointError | null = null;
    try {
      await this.service.forgetCatalog(request.endpointId);
    } catch (caught) {
      error = this.toWireError(caught, request);
    }
    this.host.emit({
      type: "provider.api_endpoint.forget_catalog.response",
      payload: { requestId: request.requestId, error },
    });
  }

  /** 读接口存储失败时整个请求失败；一个来源读不了只记在那个来源的 error 里。 */
  private handleImportScan(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.import_scan.request" }>,
  ): void {
    let payload: Omit<ApiEndpointImportScanResponse["payload"], "requestId">;
    try {
      const sources = this.service.scanImports({
        includeOpenCode: request.includeOpenCode === true,
      });
      payload = { sources, error: null };
    } catch (caught) {
      payload = { sources: [], error: this.toWireError(caught, request) };
    }
    this.host.emit({
      type: "provider.api_endpoint.import_scan.response",
      payload: { requestId: request.requestId, ...payload },
    });
  }

  private async handleImport(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.import.request" }>,
  ): Promise<void> {
    let payload: Omit<ApiEndpointImportResponse["payload"], "requestId">;
    try {
      const outcome = await this.service.importFromApps(request.picks);
      const { failed } = outcome;
      payload = {
        imported: outcome.imported,
        failed: failed === null ? null : { fingerprint: failed.fingerprint, name: failed.name },
        error: failed === null ? null : this.toWireError(failed.error, request),
      };
    } catch (caught) {
      payload = { imported: [], failed: null, error: this.toWireError(caught, request) };
    }
    this.host.emit({
      type: "provider.api_endpoint.import.response",
      payload: { requestId: request.requestId, ...payload },
    });
  }

  /** 读接口存储失败时整个请求失败；状态页读不到只记在那家的 error 里。 */
  private async handleVendorStatus(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.vendor_status.request" }>,
  ): Promise<void> {
    let payload: Omit<ApiEndpointVendorStatusResponse["payload"], "requestId">;
    try {
      payload = {
        ...(await this.service.vendorStatus({ vendors: request.vendors ?? [] })),
        error: null,
      };
    } catch (caught) {
      payload = {
        autoUpdate: false,
        vendors: [],
        endpointVendors: {},
        error: this.toWireError(caught, request),
      };
    }
    this.host.emit({
      type: "provider.api_endpoint.vendor_status.response",
      payload: { requestId: request.requestId, ...payload },
    });
  }

  private handleListTemplates(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.list_templates.request" }>,
  ): void {
    this.host.emit({
      type: "provider.api_endpoint.list_templates.response",
      payload: {
        requestId: request.requestId,
        templates: this.service.listTemplates(),
        error: null,
      },
    });
  }

  private handleStoreIcon(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.store_icon.request" }>,
  ): void {
    let icon: string | null = null;
    let error: ApiEndpointError | null = null;
    try {
      icon = this.service.storeIcon(Buffer.from(request.data, "base64"));
    } catch (caught) {
      error = this.toWireError(caught, request);
    }
    this.host.emit({
      type: "provider.api_endpoint.store_icon.response",
      payload: { requestId: request.requestId, icon, error },
    });
  }

  private async handleFetchSiteIcon(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.fetch_site_icon.request" }>,
    connectionSignal: AbortSignal,
  ): Promise<void> {
    const { signal, release } = this.trackUpstreamRequest(request.requestId, connectionSignal);
    let icon: string | null = null;
    let error: ApiEndpointError | null = null;
    try {
      icon = await this.service.fetchSiteIcon(
        { baseUrl: request.baseUrl, name: request.name },
        signal,
      );
    } catch (caught) {
      error = this.toWireError(caught, request);
    } finally {
      release();
    }
    this.host.emit({
      type: "provider.api_endpoint.fetch_site_icon.response",
      payload: { requestId: request.requestId, icon, error },
    });
  }

  private handleReadIcon(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.read_icon.request" }>,
  ): void {
    let icon: ApiEndpointIconImage | null = null;
    let error: ApiEndpointError | null = null;
    try {
      icon = this.service.readIcon(request.icon);
    } catch (caught) {
      error = this.toWireError(caught, request);
    }
    this.host.emit({
      type: "provider.api_endpoint.read_icon.response",
      payload: { requestId: request.requestId, icon, error },
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
          ...(request.preview !== undefined ? { preview: request.preview } : {}),
          ...(request.templateId !== undefined ? { templateId: request.templateId } : {}),
          ...(request.region !== undefined ? { region: request.region } : {}),
          ...(request.baseUrls !== undefined ? { baseUrls: request.baseUrls } : {}),
          ...requestExtrasOf(request),
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
          ...(request.templateId !== undefined ? { templateId: request.templateId } : {}),
          ...(request.region !== undefined ? { region: request.region } : {}),
          ...(request.modelIds !== undefined ? { modelIds: request.modelIds } : {}),
          ...requestExtrasOf(request),
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
      const { results, models } = await this.service.detectFormats(
        {
          ...(request.endpointId !== undefined ? { endpointId: request.endpointId } : {}),
          baseUrl: request.baseUrl,
          ...(request.apiKey !== undefined ? { apiKey: request.apiKey } : {}),
          ...(request.modelId !== undefined ? { modelId: request.modelId } : {}),
          ...(request.modelIds !== undefined ? { modelIds: request.modelIds } : {}),
          ...(request.eachModel !== undefined ? { eachModel: request.eachModel } : {}),
          ...requestExtrasOf(request),
        },
        signal,
      );
      this.host.emit({
        type: "provider.api_endpoint.detect_formats.response",
        payload: {
          requestId: request.requestId,
          results,
          ...(models === null ? {} : { models }),
          error: null,
        },
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

  /** 每测完一个模型推一条进度；取消时回应带已测完的结果与 cancelled。 */
  private async handleTestModels(
    request: Extract<ApiEndpointRequest, { type: "provider.api_endpoint.test_models.request" }>,
    connectionSignal: AbortSignal,
  ): Promise<void> {
    const { requestId } = request;
    const { signal, release } = this.trackUpstreamRequest(requestId, connectionSignal);
    try {
      const outcome = await this.service.testModels({
        request: {
          endpointId: request.endpointId,
          ...(request.modelId !== undefined ? { modelId: request.modelId } : {}),
          ...(request.method !== undefined ? { method: request.method } : {}),
        },
        signal,
        onStarted: (modelIds) =>
          this.host.emit({
            type: "provider.api_endpoint.test_models.started",
            payload: { requestId, modelIds },
          }),
        onResult: ({ result, done, total }) =>
          this.host.emit({
            type: "provider.api_endpoint.test_models.progress",
            payload: { requestId, result, done, total },
          }),
      });
      const cancelled: ApiEndpointError = { code: "cancelled", message: "Request cancelled" };
      const error = outcome.kind === "cancelled" ? cancelled : null;
      this.host.emit({
        type: "provider.api_endpoint.test_models.response",
        payload: { requestId, results: outcome.results, error },
      });
    } catch (error) {
      this.host.emit({
        type: "provider.api_endpoint.test_models.response",
        payload: { requestId, results: [], error: this.toWireError(error, request) },
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
  | "backgroundModelId"
  | "subagentModelId"
  | "subagentThinkingOptionId"
  | "memoryModelId"
  | "forcedSubagentModelId"
  | "allowsAnySubagentModel"
>;

/**
 * 后台小任务模型、Subagent 模型与它的思考档位、记忆模型、强制 Subagent 模型与「Codex Subagent 可用任意模型」：
 * 只带客户端给了的（省略即不变，null 为不设）。
 */
function sideModelsRequested(request: SideModelsRequest): SideModelsRequest {
  const requested: SideModelsRequest = {};
  if (request.backgroundModelId !== undefined) {
    requested.backgroundModelId = request.backgroundModelId;
  }
  if (request.subagentModelId !== undefined) requested.subagentModelId = request.subagentModelId;
  if (request.subagentThinkingOptionId !== undefined) {
    requested.subagentThinkingOptionId = request.subagentThinkingOptionId;
  }
  if (request.memoryModelId !== undefined) requested.memoryModelId = request.memoryModelId;
  if (request.forcedSubagentModelId !== undefined) {
    requested.forcedSubagentModelId = request.forcedSubagentModelId;
  }
  if (request.allowsAnySubagentModel !== undefined) {
    requested.allowsAnySubagentModel = request.allowsAnySubagentModel;
  }
  return requested;
}

/**
 * 请求带的请求头、附加请求体、key 放哪个头与不校验证书（保存、拉模型、测试、检测都一样）；没带的不传。
 * 线上的 keyHeader 是字符串，在这里换成认得的一种（不认识的当 both）。
 */
function requestExtrasOf(request: ApiEndpointRequestExtras): ApiEndpointRequestExtrasInput {
  const extras: ApiEndpointRequestExtrasInput = {};
  if (request.headers !== undefined) extras.headers = request.headers;
  if (request.extraBody !== undefined) extras.extraBody = request.extraBody;
  if (request.keyHeader !== undefined) extras.keyHeader = keyHeaderOf(request.keyHeader);
  if (request.insecureTls !== undefined) extras.insecureTls = request.insecureTls;
  return extras;
}
