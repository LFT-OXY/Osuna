import { z } from "zod";
import { UsageCliSchema } from "@getpaseo/protocol/usage/types";

/**
 * One try at an API endpoint inside a gateway request: which endpoint and
 * model, when it started and how long it took, how it ended, and when it
 * failed, the failure's class and the vendor's words (key masked, cut short)
 * and the cooldown it caused. `reasked` marks a try the endpoint refused a
 * field or header of and was asked again without it. `endpointId` null is
 * Official: the ChatGPT backend a Codex ChatGPT model is relayed to.
 */
export const GATEWAY_LEDGER_ATTEMPT_SCHEMA = z.object({
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
export type GatewayLedgerAttempt = z.infer<typeof GATEWAY_LEDGER_ATTEMPT_SCHEMA>;

/**
 * One request the gateway carried, written when it ended (docs/data-model.md
 * §7). No conversation content: no prompt, reply, tool arguments or bodies.
 * `replyId` is the id the CLI got back (Claude `message.id`), which is how the
 * row finds the same call in the CLI's log (Codex `response_id`). `endpointId`
 * is the endpoint that answered; null is Official, or no one answered: a
 * request every endpoint failed, or the agent cancelled, is a row of 0 tokens
 * whose tries say what happened, and `error` what the agent was told.
 * Times are milliseconds from the gateway taking the request.
 */
export const GATEWAY_LEDGER_ROW_SCHEMA = z.object({
  kind: z.literal("gateway"),
  at: z.string(),
  agent: UsageCliSchema,
  sessionId: z.string().nullable(),
  model: z.string(),
  endpointId: z.string().nullable(),
  endpointName: z.string().nullable(),
  upstreamModel: z.string().nullable(),
  input: z.number().int(),
  cachedInput: z.number().int(),
  cacheWrite: z.number().int(),
  cacheWrite1h: z.number().int(),
  output: z.number().int(),
  reasoning: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  ttftMs: z.number().int().nonnegative().nullable(),
  firstTextMs: z.number().int().nonnegative().nullable(),
  // 出字速度要用的（usage/speed.ts）：内容流动的时长、可见推理的起点、推理是否封存。工单 09 之前写的行没有它们。
  flowMs: z.number().int().nonnegative().nullable().optional(),
  firstReasoningMs: z.number().int().nonnegative().nullable().optional(),
  reasoningHidden: z.boolean().optional(),
  replyId: z.string().nullable(),
  stop: z.string().nullable(),
  status: z.enum(["ok", "failed", "cancelled"]),
  // 失败与取消时交给 Agent 的说法（key 已打码、截短到 200 字）；成功为 null。工单 01 写的行没有它。
  error: z.string().nullable().optional(),
  attempts: z.array(GATEWAY_LEDGER_ATTEMPT_SCHEMA),
});
export type GatewayLedgerRow = z.infer<typeof GATEWAY_LEDGER_ROW_SCHEMA>;

/**
 * One reply as the CLI's log counted it, after the log's own deduplication,
 * with the key its tokens went to the first time it was seen. Written again,
 * whole, every time a later line corrects the reply; the last line of an id
 * wins on load. It is what lets a ledger row that arrives after the scan move
 * the reply's tokens to its endpoint.
 */
export const USAGE_CLI_CALL_SCHEMA = z.object({
  kind: z.literal("cli"),
  replyId: z.string(),
  cli: UsageCliSchema,
  at: z.string(),
  model: z.string(),
  sessionId: z.string(),
  cwd: z.string(),
  bucket: z.string(),
  turnKey: z.string().nullable(),
  input: z.number().int(),
  cachedInput: z.number().int(),
  cacheWrite: z.number().int(),
  output: z.number().int(),
  reasoning: z.number().int(),
});
export type UsageCliCall = z.infer<typeof USAGE_CLI_CALL_SCHEMA>;

/**
 * Written in the scan batch that moved a call from Official and the unknown
 * project to its endpoint, so a restart knows the move is done.
 */
export const USAGE_MERGED_CALL_SCHEMA = z.object({
  kind: z.literal("merged"),
  agent: UsageCliSchema,
  replyId: z.string(),
  at: z.string(),
});
export type UsageMergedCall = z.infer<typeof USAGE_MERGED_CALL_SCHEMA>;

/** A line of `usage/requests/YYYY-MM-DD.jsonl`. */
export const USAGE_REQUEST_RECORD_SCHEMA = z.discriminatedUnion("kind", [
  GATEWAY_LEDGER_ROW_SCHEMA,
  USAGE_CLI_CALL_SCHEMA,
  USAGE_MERGED_CALL_SCHEMA,
]);
export type UsageRequestRecord = z.infer<typeof USAGE_REQUEST_RECORD_SCHEMA>;

/** Where the gateway hands each request it carried once it ended. */
export interface GatewayLedger {
  record(row: GatewayLedgerRow): void;
}
