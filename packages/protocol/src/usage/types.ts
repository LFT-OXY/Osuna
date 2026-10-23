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
  /**
   * API endpoint ids the gateway ledger attributed the usage to; `null` is
   * Official, every call that went through no endpoint. A daemon without
   * `features.gatewayLedger` ignores it.
   */
  endpoints: z.array(z.string().nullable()).optional(),
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

/**
 * One API endpoint's share of the range, or Official (`endpointId: null`, no
 * name) for the calls that went through none. Endpoint usage comes from the
 * gateway ledger merged with the CLI logs.
 */
export const UsageEndpointBreakdownSchema = z.object({
  endpointId: z.string().nullable(),
  name: z.string().nullable(),
  deleted: z.boolean(),
  totals: UsageTokenTotalsSchema,
  estimatedCost: z.number(),
  share: z.number(),
});
export type UsageEndpointBreakdown = z.infer<typeof UsageEndpointBreakdownSchema>;

/** How the Speed card groups the gateway's requests. */
export const UsageSpeedGroupBySchema = z.enum(["endpoint", "model", "model_endpoint", "agent"]);
export type UsageSpeedGroupBy = z.infer<typeof UsageSpeedGroupBySchema>;

/** The endpoint a speed group is of; `endpointId: null` is Official. */
export const UsageSpeedEndpointSchema = z.object({
  endpointId: z.string().nullable(),
  name: z.string().nullable(),
  deleted: z.boolean(),
});
export type UsageSpeedEndpoint = z.infer<typeof UsageSpeedEndpointSchema>;

/**
 * One group's speed, as sums so groups from several hosts add up: of the
 * answered gateway requests whose first content was timed, how many and their
 * waits in ms (the mean is `ttftMs / ttftCount`); of those that told a speed,
 * how many, their output tokens and their windows in ms (the speed is
 * `speedOutput / speedMs`, weighted by tokens). `cli`, `model` and `endpoint`
 * are the fields the grouping is by, null for the others. `tokens` is what the
 * group's calls billed, which orders groups of the same speed.
 */
export const UsageSpeedGroupSchema = z.object({
  cli: UsageCliSchema.nullable(),
  model: z.string().nullable(),
  endpoint: UsageSpeedEndpointSchema.nullable(),
  tokens: z.number().int(),
  ttftCount: z.number().int(),
  ttftMs: z.number().int(),
  speedCount: z.number().int(),
  speedOutput: z.number().int(),
  speedMs: z.number().int(),
});
export type UsageSpeedGroup = z.infer<typeof UsageSpeedGroupSchema>;

export const UsageSpeedSchema = z.object({
  groupBy: UsageSpeedGroupBySchema,
  groups: z.array(UsageSpeedGroupSchema),
});
export type UsageSpeed = z.infer<typeof UsageSpeedSchema>;

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
  /**
   * The gateway requests no CLI log names (ADR 0014): no directory and no name.
   * `rootPath` is "" and `kind` "directory" only because older clients require
   * both; read this flag, not them.
   */
  unknown: z.boolean().optional(),
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
  // 没有中转站账本的 daemon 不给（能力位 gatewayLedger）。
  endpoints: z.array(UsageEndpointBreakdownSchema).optional(),
  // 只在请求要了速度时给；没有中转站账本的 daemon 不给（能力位 gatewayLedger）。
  speed: UsageSpeedSchema.optional(),
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

/** One try inside a gateway request: which endpoint (`null` is Official), how it ended, and the cooldown it caused. */
export const UsageRequestAttemptSchema = z.object({
  endpointId: z.string().nullable(),
  endpointName: z.string().nullable(),
  model: z.string(),
  startedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  result: z.enum(["answered", "failed", "refused"]),
  failure: z.string().nullable(),
  reason: z.string().nullable(),
  cooldownUntil: z.string().nullable(),
  reasked: z.boolean(),
});
export type UsageRequestAttempt = z.infer<typeof UsageRequestAttemptSchema>;

/**
 * One request in the Requests list. `through: "gateway"` is a request the gateway
 * carried (its ledger row, merged with the log's reply when there is one);
 * `"direct"` is a reply only the CLI log has, with no timing and no tries.
 * `endpointId` null is Official, or, for a request no one answered, the endpoint
 * it last tried is named instead. `outputSpeed` is tokens a second, null when the
 * reply tells none.
 */
export const UsageRequestRowSchema = z.object({
  id: z.string(),
  at: z.string(),
  cli: UsageCliSchema,
  model: z.string(),
  through: z.enum(["gateway", "direct"]),
  endpointId: z.string().nullable(),
  endpointName: z.string().nullable(),
  endpointDeleted: z.boolean(),
  totals: UsageTokenTotalsSchema,
  estimatedCost: z.number(),
  priced: z.boolean(),
  durationMs: z.number().int().nonnegative().nullable(),
  ttftMs: z.number().int().nonnegative().nullable(),
  outputSpeed: z.number().nonnegative().nullable(),
  status: z.enum(["ok", "failed", "cancelled"]),
  error: z.string().nullable(),
  attempts: z.array(UsageRequestAttemptSchema),
  replyId: z.string().nullable(),
  sessionId: z.string().nullable(),
  project: UsageProjectRefSchema.nullable(),
});
export type UsageRequestRow = z.infer<typeof UsageRequestRowSchema>;

/**
 * `failed` is a request the agent got an error for (failed or cancelled);
 * `switched` one answered after the gateway moved on from another endpoint.
 */
export const UsageRequestStatusFilterSchema = z.enum(["all", "failed", "switched"]);
export type UsageRequestStatusFilter = z.infer<typeof UsageRequestStatusFilterSchema>;

export const UsageRequestThroughFilterSchema = z.enum(["all", "gateway", "direct"]);
export type UsageRequestThroughFilter = z.infer<typeof UsageRequestThroughFilterSchema>;

/** Every list is "any of"; an absent list keeps all. `endpoints` takes `null` for Official. */
export const UsageRequestFiltersSchema = z.object({
  status: UsageRequestStatusFilterSchema.optional(),
  through: UsageRequestThroughFilterSchema.optional(),
  clis: z.array(UsageCliSchema).optional(),
  endpoints: z.array(z.string().nullable()).optional(),
  models: z.array(z.string()).optional(),
  search: z.string().optional(),
});
export type UsageRequestFilters = z.infer<typeof UsageRequestFiltersSchema>;

/** What the period holds, whatever the filters keep: what the filter menus offer. */
export const UsageRequestFacetsSchema = z.object({
  clis: z.array(UsageCliSchema),
  endpoints: z.array(
    z.object({
      endpointId: z.string().nullable(),
      name: z.string().nullable(),
      deleted: z.boolean(),
    }),
  ),
  models: z.array(z.string()),
});
export type UsageRequestFacets = z.infer<typeof UsageRequestFacetsSchema>;
