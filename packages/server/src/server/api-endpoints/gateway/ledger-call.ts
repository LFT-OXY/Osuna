import type { GatewayLedger, GatewayLedgerAttempt, GatewayLedgerRow } from "../../usage/ledger.js";
import type { ApiEndpointProvider } from "../store.js";
import type { GatewayCandidate } from "./routing.js";
import { emptyUsage } from "./translation/ir.js";
import type { DeliveredReply } from "./upstream-call.js";

// 失败原因里引的上游原话截到这么长（与接口余额读失败时的说法一致）。
const REASON_MAX_CHARS = 200;

// Agent 中途走掉时记的失败分类与说法（magpie routing.go 的 failCanceled、side_deadline.go 的 canceled）。
export const CANCELED_FAILURE = "canceled";
export const CANCELED_REASON = "the agent canceled the request";

/** 一次尝试怎么结束的：答了、失败、拒答。 */
export interface LedgerAttemptEnd {
  result: GatewayLedgerAttempt["result"];
  // 失败的分类（冷却的分类、empty、too_long、refused 等）；答了为 null。
  failure: string | null;
  // 上游原话，key 已打码；答了为 null。
  reason: string | null;
  cooldownUntil: number | null;
}

// 没人交回复时记的：0 token，没有编号与首字。
const NO_ANSWER: { by: Answerer; reply: DeliveredReply } = {
  by: null,
  reply: { id: "", usage: emptyUsage(), stop: null, firstContentAt: null, firstTextAt: null },
};

/** 把回复交给 Agent 的那家：接口的这个模型，或 ChatGPT 自带模型（官方，null）。 */
type Answerer = { endpointId: string; endpointName: string; upstreamModel: string } | null;

/**
 * 中转站给一个 CLI 请求记的那一行账（usage/ledger.ts）：每次尝试随问随记，请求结束时交给账本。
 * 没有人把回复交给 Agent 的也记一行（0 token）：都失败的记失败，Agent 先走的记取消（照 magpie）。
 * 只记数字、编号与原因，不碰请求体与回复体。
 */
export class LedgerCall {
  private readonly attempts: GatewayLedgerAttempt[] = [];
  private answer: { by: Answerer; reply: DeliveredReply } | null = null;
  private isCancelled = false;
  // 没问任何一家就交给 Agent 的错误（全在冷却时交出记着的那次）。
  private told: string | null = null;

  constructor(
    private readonly input: {
      ledger: GatewayLedger;
      agent: ApiEndpointProvider;
      sessionId: string | null;
      model: string;
      // 中转站收到请求的时刻，耗时与首字都从这里算。
      since: number;
    },
  ) {}

  attempt(input: {
    candidate: GatewayCandidate;
    startedAt: number;
    reasked: boolean;
    end: LedgerAttemptEnd;
  }): void {
    const { candidate, end } = input;
    this.attempts.push({
      endpointId: candidate.endpoint.id,
      endpointName: candidate.endpoint.name,
      model: candidate.upstreamModel,
      startedAt: new Date(input.startedAt).toISOString(),
      durationMs: Math.max(0, Date.now() - input.startedAt),
      result: end.result,
      failure: end.failure,
      reason: end.reason === null ? null : end.reason.slice(0, REASON_MAX_CHARS),
      cooldownUntil: end.cooldownUntil === null ? null : new Date(end.cooldownUntil).toISOString(),
      reasked: input.reasked,
    });
  }

  /** 问这家时 Agent 走了：记一次取消的尝试，这次请求记为取消。 */
  cancelledAt(input: { candidate: GatewayCandidate; startedAt: number; reasked: boolean }): void {
    this.attempt({
      ...input,
      end: {
        result: "failed",
        failure: CANCELED_FAILURE,
        reason: CANCELED_REASON,
        cooldownUntil: null,
      },
    });
    this.cancelled();
  }

  /** Agent 走了（没在问哪一家时也算）。 */
  cancelled(): void {
    this.isCancelled = true;
  }

  /** 没问任何一家就交给 Agent 的错误；message 已打码。 */
  failedWithout(message: string): void {
    this.told = message;
  }

  /** 这家把回复交给了 Agent：记账用它的回复编号、用量与首字。 */
  answered(candidate: GatewayCandidate, reply: DeliveredReply): void {
    const { endpoint, upstreamModel } = candidate;
    this.answer = {
      by: { endpointId: endpoint.id, endpointName: endpoint.name, upstreamModel },
      reply,
    };
  }

  /** ChatGPT 自带模型把回复交给了 Agent：接口记为官方。 */
  answeredByOfficial(reply: DeliveredReply): void {
    this.answer = { by: null, reply };
  }

  /** 请求结束：记一行。交了回复的记用量；没交的记失败或取消、0 token。 */
  finish(): void {
    const { input } = this;
    const sinceRequest = (at: number | null) =>
      at === null ? null : Math.max(0, at - input.since);
    const { by, reply } = this.answer ?? NO_ANSWER;
    input.ledger.record({
      kind: "gateway",
      at: new Date(input.since).toISOString(),
      agent: input.agent,
      sessionId: input.sessionId,
      model: input.model,
      endpointId: by?.endpointId ?? null,
      endpointName: by?.endpointName ?? null,
      upstreamModel: by?.upstreamModel ?? null,
      input: reply.usage.input,
      cachedInput: reply.usage.cacheRead,
      cacheWrite: reply.usage.cacheWrite,
      cacheWrite1h: reply.usage.cacheWrite1h,
      output: reply.usage.output,
      reasoning: reply.usage.reasoning,
      durationMs: Math.max(0, Date.now() - input.since),
      ttftMs: sinceRequest(reply.firstContentAt),
      firstTextMs: sinceRequest(reply.firstTextAt),
      replyId: reply.id === "" ? null : reply.id,
      stop: reply.stop,
      status: this.status(),
      error: this.error(),
      attempts: this.attempts,
    });
  }

  private status(): GatewayLedgerRow["status"] {
    if (this.answer) return "ok";
    return this.isCancelled ? "cancelled" : "failed";
  }

  /** 交给 Agent 的说法：取消的照 magpie；失败的是没问就交出的那次，或最后一次尝试的原因。 */
  private error(): string | null {
    if (this.answer) return null;
    if (this.isCancelled) return CANCELED_REASON;
    const said = this.told ?? this.attempts.at(-1)?.reason ?? null;
    return said === null ? null : said.slice(0, REASON_MAX_CHARS);
  }
}
