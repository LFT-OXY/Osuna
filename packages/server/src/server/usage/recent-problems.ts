// 什么算出过事（这家的尝试没答成：失败、拒答、Agent 走了、在冷却中被跳过；或请求最后停在这家仍失败）、
// 新的在前，照 magpie（https://github.com/yetone/magpie，internal/gui/assets/plugins/routing/client.js 的
// outcome、failedRoute、tryOk 与 allListed：答了但换过家的是 moved，失败或取消的是 bad，按请求新旧倒排）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { ApiEndpointRecentProblem } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { UsageListedCall } from "./call-merge.js";
import type { GatewayLedgerAttempt, GatewayLedgerRow } from "./ledger.js";
import type { UsageEndpointIdentity } from "./types.js";

/** The endpoint page shows this many, as the prd's Recent problems section does. */
export const RECENT_PROBLEMS_LIMIT = 20;

/**
 * The latest requests the endpoint failed, was switched away from or went
 * into a cooldown on, newest first. Only the gateway's own rows: a reply only
 * the CLI's log has never touched an endpoint.
 */
export function buildRecentProblems(input: {
  endpointId: string;
  calls: readonly UsageListedCall[];
  endpointIdentities: ReadonlyMap<string, UsageEndpointIdentity>;
}): ApiEndpointRecentProblem[] {
  const problems: ApiEndpointRecentProblem[] = [];
  for (const [index, call] of input.calls.entries()) {
    if (call.kind !== "gateway") continue;
    const problem = problemOf(call.ledger, index, input);
    if (problem) problems.push(problem);
  }
  return problems
    .sort((a, b) => (a.at === b.at ? compare(b.id, a.id) : compare(b.at, a.at)))
    .slice(0, RECENT_PROBLEMS_LIMIT);
}

function problemOf(
  ledger: GatewayLedgerRow,
  index: number,
  input: { endpointId: string; endpointIdentities: ReadonlyMap<string, UsageEndpointIdentity> },
): ApiEndpointRecentProblem | null {
  const { attempts } = ledger;
  const last = attempts.at(-1);
  // 这家最后一次没答成的尝试；没有时，请求停在这家（答了一半断了）仍失败也算。
  const missedAt = attempts.findLastIndex(
    (attempt) => attempt.endpointId === input.endpointId && attempt.result !== "answered",
  );
  const endedHere = ledger.status !== "ok" && last?.endpointId === input.endpointId;
  if (missedAt === -1 && !endedHere) return null;
  const missed: GatewayLedgerAttempt | null = missedAt === -1 ? null : attempts[missedAt];
  const tried = missed ?? last;
  const next = missedAt === -1 ? undefined : attempts.slice(missedAt + 1).find(isElsewhere(input));
  return {
    id: `${ledger.agent}:${ledger.replyId ?? ledger.at}#${index}`,
    at: ledger.at,
    model: tried?.model ?? ledger.model,
    failure: missed?.failure ?? null,
    reason: missed?.reason ?? null,
    cooldownUntil: missed?.cooldownUntil ?? null,
    switchedTo: next ? switchedTo(next, input.endpointIdentities) : null,
    status: ledger.status,
  };
}

function isElsewhere(input: { endpointId: string }) {
  return (attempt: GatewayLedgerAttempt) => attempt.endpointId !== input.endpointId;
}

/** The endpoint tried next, under its current name, else the name the ledger recorded. */
function switchedTo(
  attempt: GatewayLedgerAttempt,
  identities: ReadonlyMap<string, UsageEndpointIdentity>,
): ApiEndpointRecentProblem["switchedTo"] {
  if (attempt.endpointId === null) return { endpointId: null, endpointName: null };
  const identity = identities.get(attempt.endpointId);
  return {
    endpointId: attempt.endpointId,
    endpointName: identity?.name ?? attempt.endpointName ?? attempt.endpointId,
  };
}

function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
