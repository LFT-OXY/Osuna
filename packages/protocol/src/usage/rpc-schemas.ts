import { z } from "zod";
import {
  UsageBackfillSchema,
  UsagePricingModelSchema,
  UsagePricingRefreshResultSchema,
  UsagePricingTableInfoSchema,
  UsageReportFiltersSchema,
  UsageReportSchema,
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
