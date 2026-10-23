import type { GatewayLedger, GatewayLedgerAttempt } from "../../usage/ledger.js";
import type { ApiEndpointProvider } from "../store.js";
import type { GatewayCandidate } from "./routing.js";
import type { DeliveredReply } from "./upstream-call.js";

// 失败原因里引的上游原话截到这么长（与接口余额读失败时的说法一致）。
const REASON_MAX_CHARS = 200;

/** 一次尝试怎么结束的：答了、失败、拒答。 */
export interface LedgerAttemptEnd {
  result: GatewayLedgerAttempt["result"];
  // 失败的分类（冷却的分类、empty、too_long、refused 等）；答了为 null。
  failure: string | null;
  // 上游原话，key 已打码；答了为 null。
  reason: string | null;
  cooldownUntil: number | null;
}

/**
 * 中转站给一个 CLI 请求记的那一行账（usage/ledger.ts）：每次尝试随问随记，请求结束时交给账本。
 * 只记数字、编号与原因，不碰请求体与回复体。
 */
export class LedgerCall {
  private readonly attempts: GatewayLedgerAttempt[] = [];
  private answer: { candidate: GatewayCandidate; reply: DeliveredReply } | null = null;

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

  /** 这家把回复交给了 Agent：记账用它的回复编号、用量与首字。 */
  answered(candidate: GatewayCandidate, reply: DeliveredReply): void {
    this.answer = { candidate, reply };
  }

  /** 请求结束：交给 Agent 了回复的记一行。 */
  finish(): void {
    const { answer, input } = this;
    // Codex 的回复编号还没与它的会话记录合并：先不记，免得同一次调用算两遍。
    if (!answer || input.agent !== "claude") return;
    const { candidate, reply } = answer;
    const sinceRequest = (at: number | null) =>
      at === null ? null : Math.max(0, at - input.since);
    input.ledger.record({
      kind: "gateway",
      at: new Date(input.since).toISOString(),
      agent: input.agent,
      sessionId: input.sessionId,
      model: input.model,
      endpointId: candidate.endpoint.id,
      endpointName: candidate.endpoint.name,
      upstreamModel: candidate.upstreamModel,
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
      status: "ok",
      attempts: this.attempts,
    });
  }
}
