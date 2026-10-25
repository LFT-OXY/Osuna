import type { GatewayLedger, GatewayLedgerAttempt, GatewayLedgerRow } from "../../usage/ledger.js";
import type { ApiEndpointProvider } from "../store.js";
import type { EndpointRest } from "./cooldown.js";
import type { GatewayCandidate } from "./routing.js";
import { UNTIMED } from "./reply-clock.js";
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

/** 把回复交给 Agent 的那家：接口的这个模型，或 ChatGPT 自带模型（官方，null）。 */
type Answerer = { endpointId: string; endpointName: string; upstreamModel: string } | null;

/** 官方那次用的 Codex 的 ChatGPT 号（第二层）；Codex 原样的登录、不在列表里的号没有。 */
export interface LedgerAccount {
  id: string;
  email?: string;
}

/** 一次尝试问的是谁：接口的这个模型，或官方（ChatGPT 后端，没有接口）。 */
interface AttemptTarget {
  endpointId: string | null;
  endpointName: string | null;
  model: string;
  account?: LedgerAccount;
}

/**
 * 这次请求落在哪：还没结果；有一家把回复交给了 Agent；失败（told 是交给 Agent 的说法）；Agent 先走了。
 * 还没结果就结束的只有请求处理本身崩了，记失败、没有说法。
 */
type LedgerOutcome =
  | { kind: "open" }
  | { kind: "answered"; by: Answerer; reply: DeliveredReply; account?: LedgerAccount }
  | { kind: "failed"; told: string }
  | { kind: "cancelled" };

// 没人交回复时记的：0 token，没有编号与计时。
const NO_REPLY: DeliveredReply = {
  id: "",
  usage: emptyUsage(),
  stop: null,
  ...UNTIMED,
};

/**
 * 中转站给一个 CLI 请求记的那一行账（usage/ledger.ts）：每次尝试随问随记，请求结束时交给账本。
 * 没有人把回复交给 Agent 的也记一行（0 token）：都失败的记失败，Agent 先走的记取消（照 magpie）。
 * 只记数字、编号与原因，不碰请求体与回复体。
 */
export class LedgerCall {
  private readonly attempts: GatewayLedgerAttempt[] = [];
  private outcome: LedgerOutcome = { kind: "open" };

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
    const { candidate } = input;
    this.push({ ...input, target: targetOf(candidate) });
  }

  /** 问 ChatGPT 后端（官方）的那一次（magpie codex_backend.go 的 Tries[0]）；第二层另记问的是哪个号。 */
  officialAttempt(input: {
    model: string;
    startedAt: number;
    end: LedgerAttemptEnd;
    account?: LedgerAccount;
  }): void {
    const { account, ...rest } = input;
    const target = {
      endpointId: null,
      endpointName: null,
      model: input.model,
      ...(account ? { account } : {}),
    };
    this.push({ ...rest, target, reasked: false });
  }

  /**
   * 全在冷却、没问就交出记着的错误（magpie gateway.go 的 quotaHeld 与 verifyHeld 分支同样留一次尝试）：
   * 这家记一次 0 毫秒的失败，带冷却的分类、原话与到期时刻；told 是交给 Agent 的说法。
   */
  heldBack(input: { candidate: GatewayCandidate; rest: EndpointRest; told: string }): void {
    const { rest } = input;
    this.push({
      target: targetOf(input.candidate),
      startedAt: Date.now(),
      reasked: false,
      end: { result: "failed", failure: rest.why, reason: rest.said, cooldownUntil: rest.until },
    });
    this.failed(input.told);
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
    this.outcome = { kind: "cancelled" };
  }

  /** 这次请求失败了：told 是交给 Agent 的说法（key 已打码）。 */
  failed(told: string): void {
    this.outcome = { kind: "failed", told };
  }

  /** 这家把回复交给了 Agent：记账用它的回复编号、用量与首字。 */
  answered(candidate: GatewayCandidate, reply: DeliveredReply): void {
    const { endpoint, upstreamModel } = candidate;
    const by = { endpointId: endpoint.id, endpointName: endpoint.name, upstreamModel };
    this.outcome = { kind: "answered", by, reply };
  }

  /** ChatGPT 自带模型把回复交给了 Agent：接口记为官方；第二层另记答话的号。 */
  answeredByOfficial(reply: DeliveredReply, account?: LedgerAccount): void {
    this.outcome = { kind: "answered", by: null, reply, ...(account ? { account } : {}) };
  }

  /** 请求结束：记一行。交了回复的记用量；没交的记失败或取消、0 token。 */
  finish(): void {
    const { input, outcome } = this;
    const sinceRequest = (at: number | null) =>
      at === null ? null : Math.max(0, at - input.since);
    const by = outcome.kind === "answered" ? outcome.by : null;
    const reply = outcome.kind === "answered" ? outcome.reply : NO_REPLY;
    const account = outcome.kind === "answered" ? outcome.account : undefined;
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
      flowMs: reply.flowMs,
      firstReasoningMs: sinceRequest(reply.firstReasoningAt),
      reasoningHidden: reply.reasoningHidden,
      replyId: reply.id === "" ? null : reply.id,
      stop: reply.stop,
      ...statusOf(outcome),
      attempts: this.attempts,
      ...accountFields(account),
    });
  }

  private push(input: {
    target: AttemptTarget;
    startedAt: number;
    reasked: boolean;
    end: LedgerAttemptEnd;
  }): void {
    const { end } = input;
    const { account, ...target } = input.target;
    this.attempts.push({
      ...target,
      startedAt: new Date(input.startedAt).toISOString(),
      durationMs: Math.max(0, Date.now() - input.startedAt),
      result: end.result,
      failure: end.failure,
      reason: cut(end.reason),
      cooldownUntil: end.cooldownUntil === null ? null : new Date(end.cooldownUntil).toISOString(),
      reasked: input.reasked,
      ...accountFields(account),
    });
  }
}

function accountFields(account: LedgerAccount | undefined): {
  accountId?: string;
  accountEmail?: string;
} {
  if (!account) return {};
  return { accountId: account.id, ...(account.email ? { accountEmail: account.email } : {}) };
}

function targetOf(candidate: GatewayCandidate): AttemptTarget {
  const { endpoint, upstreamModel } = candidate;
  return { endpointId: endpoint.id, endpointName: endpoint.name, model: upstreamModel };
}

/** 行上的状态与交给 Agent 的说法（magpie 的 Route.Error 即交出的那句，截短）。 */
function statusOf(outcome: LedgerOutcome): Pick<GatewayLedgerRow, "status" | "error"> {
  switch (outcome.kind) {
    case "answered":
      return { status: "ok", error: null };
    case "cancelled":
      return { status: "cancelled", error: CANCELED_REASON };
    case "failed":
      return { status: "failed", error: cut(outcome.told) };
    case "open":
      return { status: "failed", error: null };
  }
}

function cut(text: string | null): string | null {
  return text === null ? null : text.slice(0, REASON_MAX_CHARS);
}
