import { z } from "zod";

/** The four CLIs whose local session logs the daemon parses. */
export const UsageCliSchema = z.enum(["claude", "codex", "pi", "omp"]);
export type UsageCli = z.infer<typeof UsageCliSchema>;

/**
 * The five token columns, same meaning for every CLI: `input` is uncached
 * input, `reasoning` is a subset of `output` kept for display only.
 */
export const UsageTokenTotalsSchema = z.object({
  input: z.number().int(),
  cachedInput: z.number().int(),
  cacheWrite: z.number().int(),
  output: z.number().int(),
  reasoning: z.number().int(),
});
export type UsageTokenTotals = z.infer<typeof UsageTokenTotalsSchema>;

export const UsageAmountSchema = z.object({
  totals: UsageTokenTotalsSchema,
  estimatedCost: z.number(),
});
export type UsageAmount = z.infer<typeof UsageAmountSchema>;

/** A usage source: the CLI plus, for Pi/OMP, the backend it routed to. */
export const UsageSourceRefSchema = z.object({
  cli: UsageCliSchema,
  backend: z.string().nullable(),
});
export type UsageSourceRef = z.infer<typeof UsageSourceRefSchema>;

export const UsageTrendGranularitySchema = z.enum(["hour", "day", "month"]);
export type UsageTrendGranularity = z.infer<typeof UsageTrendGranularitySchema>;

export const UsageTrendStackBySchema = z.enum(["source", "model"]);
export type UsageTrendStackBy = z.infer<typeof UsageTrendStackBySchema>;

export const UsageProjectKindSchema = z.enum(["git", "non_git", "directory"]);
export type UsageProjectKind = z.infer<typeof UsageProjectKindSchema>;

/**
 * Backfill is the daemon's first scan round after start. `filesTotal` /
 * `filesDone` count that round only.
 */
export const UsageBackfillSchema = z.object({
  state: z.enum(["idle", "running", "done"]),
  filesTotal: z.number().int().nonnegative(),
  filesDone: z.number().int().nonnegative(),
  startedAt: z.string().nullable(),
});
export type UsageBackfill = z.infer<typeof UsageBackfillSchema>;

export const UsageReportFiltersSchema = z.object({
  sources: z.array(UsageSourceRefSchema).optional(),
  models: z.array(z.string()).optional(),
  projects: z.array(z.string()).optional(),
});
export type UsageReportFilters = z.infer<typeof UsageReportFiltersSchema>;

export const UsageSummarySchema = z.object({
  totals: UsageTokenTotalsSchema,
  estimatedCost: z.number(),
  sessionCount: z.number().int().nonnegative(),
  last7Days: UsageAmountSchema,
  last30Days: UsageAmountSchema,
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

export const UsageSourceBreakdownSchema = z.object({
  cli: UsageCliSchema,
  backend: z.string().nullable(),
  totals: UsageTokenTotalsSchema,
  estimatedCost: z.number(),
  modelCount: z.number().int().nonnegative(),
  share: z.number(),
});
export type UsageSourceBreakdown = z.infer<typeof UsageSourceBreakdownSchema>;

export const UsageModelBreakdownSchema = z.object({
  model: z.string(),
  cli: UsageCliSchema,
  backend: z.string().nullable(),
  totals: UsageTokenTotalsSchema,
  estimatedCost: z.number(),
  priced: z.boolean(),
});
export type UsageModelBreakdown = z.infer<typeof UsageModelBreakdownSchema>;

export const UsageTrendPointSchema = z.object({
  key: z.string(),
  groups: z.record(z.string(), UsageAmountSchema),
});
export type UsageTrendPoint = z.infer<typeof UsageTrendPointSchema>;

export const UsageTrendSchema = z.object({
  granularity: UsageTrendGranularitySchema,
  stackBy: UsageTrendStackBySchema,
  points: z.array(UsageTrendPointSchema),
});
export type UsageTrend = z.infer<typeof UsageTrendSchema>;

export const UsageDayBreakdownSchema = z.object({
  day: z.string(),
  totals: UsageTokenTotalsSchema,
  estimatedCost: z.number(),
  sessionCount: z.number().int().nonnegative(),
  turns: z.number().int().nonnegative(),
});
export type UsageDayBreakdown = z.infer<typeof UsageDayBreakdownSchema>;

export const UsageMonthBreakdownSchema = z.object({
  month: z.string(),
  totals: UsageTokenTotalsSchema,
  estimatedCost: z.number(),
  sessionCount: z.number().int().nonnegative(),
  turns: z.number().int().nonnegative(),
});
export type UsageMonthBreakdown = z.infer<typeof UsageMonthBreakdownSchema>;

export const UsageHeatmapDaySchema = z.object({
  day: z.string(),
  totals: UsageTokenTotalsSchema,
});
export type UsageHeatmapDay = z.infer<typeof UsageHeatmapDaySchema>;

export const UsageProjectCwdSchema = z.object({
  cwd: z.string(),
  totals: UsageTokenTotalsSchema,
  estimatedCost: z.number(),
});

/** Which project a cwd was attributed to; the identity without the amounts. */
export const UsageProjectRefSchema = z.object({
  rootPath: z.string(),
  displayName: z.string(),
  kind: UsageProjectKindSchema,
});
export type UsageProjectRef = z.infer<typeof UsageProjectRefSchema>;

export const UsageProjectBreakdownSchema = UsageProjectRefSchema.extend({
  totals: UsageTokenTotalsSchema,
  estimatedCost: z.number(),
  /** Which CLIs and backends ran here, largest first; the row wears their marks. */
  sources: z.array(UsageSourceRefSchema),
  cwds: z.array(UsageProjectCwdSchema),
});
export type UsageProjectBreakdown = z.infer<typeof UsageProjectBreakdownSchema>;

export const UsageReportSchema = z.object({
  summary: UsageSummarySchema,
  sources: z.array(UsageSourceBreakdownSchema),
  models: z.array(UsageModelBreakdownSchema),
  trend: UsageTrendSchema,
  days: z.array(UsageDayBreakdownSchema),
  months: z.array(UsageMonthBreakdownSchema),
  heatmapDays: z.array(UsageHeatmapDaySchema),
  projects: z.array(UsageProjectBreakdownSchema),
  backfill: UsageBackfillSchema,
  error: z.string().nullable(),
});
export type UsageReport = z.infer<typeof UsageReportSchema>;

/** Dollars per million tokens — what a user types, and what the price table shows. */
export const UsagePricePerMillionSchema = z.object({
  input: z.number().nonnegative(),
  cachedInput: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  output: z.number().nonnegative(),
});
export type UsagePricePerMillion = z.infer<typeof UsagePricePerMillionSchema>;

/**
 * A user-set price for one model. `model` matches the stored model id exactly,
 * ignoring case and surrounding space; all four columns are required so a
 * half-filled override cannot silently price part of a turn. Zero is a price,
 * not "unknown".
 */
export const UsagePricingOverrideSchema = z.object({
  model: z.string().min(1),
  pricePerMillion: UsagePricePerMillionSchema,
  note: z.string().optional(),
});
export type UsagePricingOverride = z.infer<typeof UsagePricingOverrideSchema>;

export const UsagePricingSourceSchema = z.enum(["override", "table"]);
export type UsagePricingSource = z.infer<typeof UsagePricingSourceSchema>;

/** Where the loaded table came from and whether the daemon will refresh it. */
export const UsagePricingTableInfoSchema = z.object({
  fetchedAt: z.string(),
  source: z.enum(["cache", "snapshot"]),
  autoUpdate: z.boolean(),
});
export type UsagePricingTableInfo = z.infer<typeof UsagePricingTableInfoSchema>;

/** One model seen in the usage rows, with the price it resolves to today. */
export const UsagePricingModelSchema = z.object({
  model: z.string(),
  cli: UsageCliSchema,
  backend: z.string().nullable(),
  priced: z.boolean(),
  priceSource: UsagePricingSourceSchema.nullable(),
  matchedKey: z.string().nullable(),
  pricePerMillion: UsagePricePerMillionSchema.nullable(),
  lastSeenAt: z.string(),
});
export type UsagePricingModel = z.infer<typeof UsagePricingModelSchema>;

export const UsagePricingRefreshResultSchema = z.enum(["updated", "not_modified", "failed"]);
export type UsagePricingRefreshResult = z.infer<typeof UsagePricingRefreshResultSchema>;

/** One model's share of a turn or of an agent's total — a report row minus its source. */
export const UsageModelAmountSchema = UsageModelBreakdownSchema.omit({ cli: true, backend: true });
export type UsageModelAmount = z.infer<typeof UsageModelAmountSchema>;

/**
 * How the Session history panel names the same session: the CLI plus the id it
 * resumes by. Claude and Codex resume by session id; Pi and OMP take the
 * transcript path, which only the scanner's cursors know.
 */
export const UsageSessionHandleSchema = z.object({
  providerId: z.string(),
  providerHandleId: z.string(),
});
export type UsageSessionHandle = z.infer<typeof UsageSessionHandleSchema>;

/**
 * One session's usage on one local day. A session that ran past midnight has a
 * row per day, each holding only that day's tokens. A Claude resume chain is
 * one session here, reported under the id it last used.
 */
export const UsageSessionRowSchema = z.object({
  day: z.string(),
  cli: UsageCliSchema,
  backend: z.string().nullable(),
  sessionId: z.string(),
  cwd: z.string(),
  project: UsageProjectRefSchema,
  models: z.array(UsageModelAmountSchema),
  totals: UsageTokenTotalsSchema,
  estimatedCost: z.number(),
  turns: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  firstAt: z.string(),
  lastAt: z.string(),
  /** Null when the transcript is no longer where the cursor last saw it. */
  handle: UsageSessionHandleSchema.nullable(),
  importedAgentId: z.string().optional(),
  importedAgentWorkspaceId: z.string().optional(),
});
export type UsageSessionRow = z.infer<typeof UsageSessionRowSchema>;

/**
 * One turn of a Paseo agent. `turnId` is Paseo's own id, present once a turn
 * the daemon watched closed; `turnKey` is the CLI's id and is always there.
 * A turn still running is reported like any other — the client adds the
 * stopwatch.
 */
export const UsageAgentTurnSchema = z.object({
  cli: UsageCliSchema,
  backend: z.string().nullable(),
  sessionId: z.string(),
  turnKey: z.string(),
  turnId: z.string().nullable(),
  userMessageIds: z.array(z.string()),
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  byModel: z.array(UsageModelAmountSchema),
  totals: UsageTokenTotalsSchema,
  estimatedCost: z.number(),
  priced: z.boolean(),
});
export type UsageAgentTurn = z.infer<typeof UsageAgentTurnSchema>;

/**
 * What one agent spent across every provider session it ran in. `complete` is
 * false while the backfill is still running or while one of those sessions has
 * not been scanned yet, which is how the client knows the number can still grow.
 */
export const UsageAgentSummarySchema = z.object({
  byModel: z.array(UsageModelAmountSchema),
  totals: UsageTokenTotalsSchema,
  estimatedCost: z.number(),
  turns: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  firstAt: z.string().nullable(),
  lastAt: z.string().nullable(),
  complete: z.boolean(),
});
export type UsageAgentSummary = z.infer<typeof UsageAgentSummarySchema>;
