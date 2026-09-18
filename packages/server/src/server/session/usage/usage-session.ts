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
    try {
      const report = await this.usageService.getReport({
        from: request.from,
        to: request.to,
        timezone: request.timezone,
        filters: request.filters,
        trend: request.trend,
      });
      this.host.emit({
        type: "usage.report.get.response",
        payload: { requestId: request.requestId, ...report },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ err: error, requestType: request.type }, "Usage report request failed");
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
