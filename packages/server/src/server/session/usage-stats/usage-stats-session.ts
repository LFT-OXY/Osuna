import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { UsageService } from "../../usage/service.js";

export interface UsageStatsSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface UsageStatsSessionOptions {
  host: UsageStatsSessionHost;
  usageService: UsageService;
  logger: pino.Logger;
}

export interface CreateUsageStatsSessionOptions {
  host: UsageStatsSessionHost;
  usageService: UsageService | undefined;
  logger: pino.Logger;
}

/** Null when the daemon has no usage service, which also hides the feature flag. */
export function createUsageStatsSession(
  options: CreateUsageStatsSessionOptions,
): UsageStatsSession | null {
  if (!options.usageService) return null;
  return new UsageStatsSession({
    host: options.host,
    usageService: options.usageService,
    logger: options.logger,
  });
}

export class UsageStatsSession {
  private readonly host: UsageStatsSessionHost;
  private readonly usageService: UsageService;
  private readonly logger: pino.Logger;

  constructor(options: UsageStatsSessionOptions) {
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
        speed: request.speed,
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

  async handleUsageRequestsListRequest(
    request: Extract<SessionInboundMessage, { type: "usage.requests.list.request" }>,
  ): Promise<void> {
    await this.respond(request, async () => ({
      type: "usage.requests.list.response",
      payload: {
        requestId: request.requestId,
        ...(await this.usageService.listRequests({
          from: request.from,
          to: request.to,
          timezone: request.timezone,
          filters: request.filters,
          offset: request.offset,
          limit: request.limit,
        })),
      },
    }));
  }

  async handleUsageRequestsExportRequest(
    request: Extract<SessionInboundMessage, { type: "usage.requests.export.request" }>,
  ): Promise<void> {
    await this.respond(request, async () => ({
      type: "usage.requests.export.response",
      payload: {
        requestId: request.requestId,
        csv: await this.usageService.exportRequests({
          from: request.from,
          to: request.to,
          timezone: request.timezone,
          filters: request.filters,
        }),
      },
    }));
  }

  async handleRecentProblemsRequest(
    request: Extract<
      SessionInboundMessage,
      { type: "provider.api_endpoint.recent_problems.request" }
    >,
  ): Promise<void> {
    await this.respond(request, async () => ({
      type: "provider.api_endpoint.recent_problems.response",
      payload: {
        requestId: request.requestId,
        problems: this.usageService.listRecentProblems(request.endpointId),
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

  async handleUsageExchangeRateGetRequest(
    request: Extract<SessionInboundMessage, { type: "usage.exchange_rate.get.request" }>,
  ): Promise<void> {
    await this.respond(request, async () => ({
      type: "usage.exchange_rate.get.response",
      payload: { requestId: request.requestId, ...this.usageService.getExchangeRate() },
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
