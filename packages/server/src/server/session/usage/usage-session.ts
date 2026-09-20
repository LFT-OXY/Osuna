import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { UsageService } from "../../usage/service.js";

export interface UsageSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface UsageSessionOptions {
  host: UsageSessionHost;
  usageService: UsageService;
  logger: pino.Logger;
}

export interface CreateUsageSessionOptions {
  host: UsageSessionHost;
  usageService: UsageService | undefined;
  logger: pino.Logger;
}

/** Null when the daemon has no usage service, which also hides the feature flag. */
export function createUsageSession(options: CreateUsageSessionOptions): UsageSession | null {
  if (!options.usageService) return null;
  return new UsageSession({
    host: options.host,
    usageService: options.usageService,
    logger: options.logger,
  });
}

export class UsageSession {
  private readonly host: UsageSessionHost;
  private readonly usageService: UsageService;
  private readonly logger: pino.Logger;

  constructor(options: UsageSessionOptions) {
    this.host = options.host;
    this.usageService = options.usageService;
    this.logger = options.logger;
  }

  async handleUsageReportGetRequest(
    request: Extract<SessionInboundMessage, { type: "usage.report.get.request" }>,
  ): Promise<void> {
    await this.respond(request, async () => {
      const report = await this.usageService.getReport({
        from: request.from,
        to: request.to,
        timezone: request.timezone,
        filters: request.filters,
        trend: request.trend,
      });
      return {
        type: "usage.report.get.response",
        payload: { requestId: request.requestId, ...report },
      };
    });
  }

  async handleUsageSessionsListRequest(
    request: Extract<SessionInboundMessage, { type: "usage.sessions.list.request" }>,
  ): Promise<void> {
    await this.respond(request, async () => ({
      type: "usage.sessions.list.response",
      payload: {
        requestId: request.requestId,
        ...(await this.usageService.listSessions({
          from: request.from,
          to: request.to,
          timezone: request.timezone,
          filters: request.filters,
        })),
      },
    }));
  }

  async handleUsagePricingListRequest(
    request: Extract<SessionInboundMessage, { type: "usage.pricing.list.request" }>,
  ): Promise<void> {
    await this.respond(request, async () => ({
      type: "usage.pricing.list.response",
      payload: { requestId: request.requestId, ...this.usageService.listPricing() },
    }));
  }

  async handleUsagePricingRefreshRequest(
    request: Extract<SessionInboundMessage, { type: "usage.pricing.refresh.request" }>,
  ): Promise<void> {
    await this.respond(request, async () => ({
      type: "usage.pricing.refresh.response",
      payload: { requestId: request.requestId, ...(await this.usageService.refreshPricing()) },
    }));
  }

  async handleUsageAgentGetRequest(
    request: Extract<SessionInboundMessage, { type: "usage.agent.get.request" }>,
  ): Promise<void> {
    await this.respond(request, async () => ({
      type: "usage.agent.get.response",
      payload: {
        requestId: request.requestId,
        ...(await this.usageService.getAgentUsage(request.agentId)),
      },
    }));
  }

  async handleUsageAgentTurnsListRequest(
    request: Extract<SessionInboundMessage, { type: "usage.agent.turns.list.request" }>,
  ): Promise<void> {
    await this.respond(request, async () => ({
      type: "usage.agent.turns.list.response",
      payload: {
        requestId: request.requestId,
        ...(await this.usageService.listAgentTurns(request.agentId)),
      },
    }));
  }

  /** One failure shape for the whole namespace, so every handler stays two lines. */
  private async respond(
    request: { type: string; requestId: string },
    run: () => Promise<SessionOutboundMessage>,
  ): Promise<void> {
    try {
      this.host.emit(await run());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ err: error, requestType: request.type }, "Usage request failed");
      this.host.emit({
        type: "rpc_error",
        payload: {
          requestId: request.requestId,
          requestType: request.type,
          error: message,
          code: "usage_request_failed",
        },
      });
    }
  }
}
