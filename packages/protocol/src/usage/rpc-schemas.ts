import { z } from "zod";
import {
  UsageAgentSummarySchema,
  UsageAgentTurnSchema,
  UsageBackfillSchema,
  UsageCliSchema,
  UsagePricingModelSchema,
  UsagePricingRefreshResultSchema,
  UsagePricingTableInfoSchema,
  UsageReportFiltersSchema,
  UsageReportSchema,
  UsageRequestFacetsSchema,
  UsageRequestFiltersSchema,
  UsageRequestRowSchema,
  UsageSessionRowSchema,
  UsageTrendGranularitySchema,
  UsageTrendStackBySchema,
} from "./types.js";

/**
 * `from` / `to` are client-local dates (`YYYY-MM-DD`, inclusive) that the
 * daemon resolves through `timezone`; `from: null` means "all time".
 */
export const UsageReportGetRequestSchema = z.object({
  type: z.literal("usage.report.get.request"),
  requestId: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  timezone: z.string().min(1),
  filters: UsageReportFiltersSchema.optional(),
  trend: z
    .object({
      granularity: UsageTrendGranularitySchema.optional(),
      stackBy: UsageTrendStackBySchema,
    })
    .optional(),
});
export type UsageReportGetRequest = z.infer<typeof UsageReportGetRequestSchema>;

export const UsageReportGetResponseSchema = z.object({
  type: z.literal("usage.report.get.response"),
  payload: UsageReportSchema.extend({ requestId: z.string() }),
});
export type UsageReportGetResponse = z.infer<typeof UsageReportGetResponseSchema>;
export type UsageReportGetPayload = UsageReportGetResponse["payload"];

/** The same window as the report, answered as one row per session and local day. */
export const UsageSessionsListRequestSchema = z.object({
  type: z.literal("usage.sessions.list.request"),
  requestId: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  timezone: z.string().min(1),
  filters: UsageReportFiltersSchema.optional(),
});
export type UsageSessionsListRequest = z.infer<typeof UsageSessionsListRequestSchema>;

/**
 * Newest activity first. `truncated` says a day held more sessions than the
 * per-day cap, so the tail of that day is missing.
 */
export const UsageSessionsListResponseSchema = z.object({
  type: z.literal("usage.sessions.list.response"),
  payload: z.object({
    requestId: z.string(),
    sessions: z.array(UsageSessionRowSchema),
    truncated: z.boolean(),
  }),
});
export type UsageSessionsListResponse = z.infer<typeof UsageSessionsListResponseSchema>;

/**
 * The Requests list: the same window as the report, newest first, a page at a
 * time. `total` is how many requests the filters keep, every page together.
 */
export const UsageRequestsListRequestSchema = z.object({
  type: z.literal("usage.requests.list.request"),
  requestId: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  timezone: z.string().min(1),
  filters: UsageRequestFiltersSchema.optional(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export type UsageRequestsListRequest = z.infer<typeof UsageRequestsListRequestSchema>;

export const UsageRequestsListResponseSchema = z.object({
  type: z.literal("usage.requests.list.response"),
  payload: z.object({
    requestId: z.string(),
    requests: z.array(UsageRequestRowSchema),
    total: z.number().int().nonnegative(),
    facets: UsageRequestFacetsSchema,
  }),
});
export type UsageRequestsListResponse = z.infer<typeof UsageRequestsListResponseSchema>;

/**
 * Every request the Requests list's filters keep, all pages, as CSV text: the
 * list's columns plus reasoning tokens, the failure, the tries, the reply id
 * and the session. Costs are in USD whatever the client shows.
 */
export const UsageRequestsExportRequestSchema = z.object({
  type: z.literal("usage.requests.export.request"),
  requestId: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  timezone: z.string().min(1),
  filters: UsageRequestFiltersSchema.optional(),
});
export type UsageRequestsExportRequest = z.infer<typeof UsageRequestsExportRequestSchema>;

export const UsageRequestsExportResponseSchema = z.object({
  type: z.literal("usage.requests.export.response"),
  payload: z.object({
    requestId: z.string(),
    csv: z.string(),
  }),
});
export type UsageRequestsExportResponse = z.infer<typeof UsageRequestsExportResponseSchema>;

export const UsageBackfillProgressMessageSchema = z.object({
  type: z.literal("usage.backfill.progress"),
  payload: UsageBackfillSchema,
});
export type UsageBackfillProgressMessage = z.infer<typeof UsageBackfillProgressMessageSchema>;

export const UsagePricingListRequestSchema = z.object({
  type: z.literal("usage.pricing.list.request"),
  requestId: z.string(),
});
export type UsagePricingListRequest = z.infer<typeof UsagePricingListRequestSchema>;

export const UsagePricingListResponseSchema = z.object({
  type: z.literal("usage.pricing.list.response"),
  payload: z.object({
    requestId: z.string(),
    table: UsagePricingTableInfoSchema,
    models: z.array(UsagePricingModelSchema),
  }),
});
export type UsagePricingListResponse = z.infer<typeof UsagePricingListResponseSchema>;

/** Refreshing ignores the auto-update switch: the user asked for it explicitly. */
export const UsagePricingRefreshRequestSchema = z.object({
  type: z.literal("usage.pricing.refresh.request"),
  requestId: z.string(),
});
export type UsagePricingRefreshRequest = z.infer<typeof UsagePricingRefreshRequestSchema>;

export const UsagePricingRefreshResponseSchema = z.object({
  type: z.literal("usage.pricing.refresh.response"),
  payload: z.object({
    requestId: z.string(),
    result: UsagePricingRefreshResultSchema,
    fetchedAt: z.string(),
    error: z.string().nullable(),
  }),
});
export type UsagePricingRefreshResponse = z.infer<typeof UsagePricingRefreshResponseSchema>;

/**
 * Sent when the table or the overrides changed; the client re-reads what it
 * needs. It carries no payload — a correlated one would make it look like a
 * reply to the session's reply classifier.
 */
export const UsagePricingUpdatedMessageSchema = z.object({
  type: z.literal("usage.pricing.updated"),
});
export type UsagePricingUpdatedMessage = z.infer<typeof UsagePricingUpdatedMessageSchema>;

export const UsageAgentGetRequestSchema = z.object({
  type: z.literal("usage.agent.get.request"),
  requestId: z.string(),
  agentId: z.string(),
});
export type UsageAgentGetRequest = z.infer<typeof UsageAgentGetRequestSchema>;

export const UsageAgentGetResponseSchema = z.object({
  type: z.literal("usage.agent.get.response"),
  payload: UsageAgentSummarySchema.extend({ requestId: z.string() }),
});
export type UsageAgentGetResponse = z.infer<typeof UsageAgentGetResponseSchema>;

/** Every turn of the agent, oldest first. Small enough that it does not page. */
export const UsageAgentTurnsListRequestSchema = z.object({
  type: z.literal("usage.agent.turns.list.request"),
  requestId: z.string(),
  agentId: z.string(),
});
export type UsageAgentTurnsListRequest = z.infer<typeof UsageAgentTurnsListRequestSchema>;

export const UsageAgentTurnsListResponseSchema = z.object({
  type: z.literal("usage.agent.turns.list.response"),
  payload: z.object({
    requestId: z.string(),
    turns: z.array(UsageAgentTurnSchema),
    complete: z.boolean(),
  }),
});
export type UsageAgentTurnsListResponse = z.infer<typeof UsageAgentTurnsListResponseSchema>;

/**
 * Sent after each batch of parsed rows reaches disk, once per affected session.
 * `agentId` is there when the session backs a Paseo agent, so a screen showing
 * that agent can refetch without matching session ids itself.
 */
export const UsageUpdatedMessageSchema = z.object({
  type: z.literal("usage.updated"),
  payload: z.object({
    cli: UsageCliSchema,
    sessionId: z.string(),
    agentId: z.string().optional(),
  }),
});
export type UsageUpdatedMessage = z.infer<typeof UsageUpdatedMessageSchema>;
