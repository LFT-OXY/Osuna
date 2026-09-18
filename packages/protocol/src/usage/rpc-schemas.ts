import { z } from "zod";
import {
  UsageBackfillSchema,
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
