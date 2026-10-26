// 换号判断移植自 magpie（https://github.com/yetone/magpie，d5805372）：internal/provider/codex_switch.go 的
// NextLogin、usedPast、resetPassed、SwitchWhenSpent 与 login-returns，account_caps.go 的上限。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import {
  isWholeAccountWindow,
  type ProviderAccountSwitchWindow,
  type ProviderAccountUsage,
  type ProviderAccountWindow,
} from "@getpaseo/protocol/provider-account/rpc-schemas";

/*
 * 多号自动轮换的换号规则（照 magpie internal/provider/codex_switch.go 的 NextLogin，d5805372），
 * Codex 与 Claude Code 共用：只看各号的读数、顺序、上限、固定与「等着换回」，不读写任何登录。
 * - 没有余量：任一窗口用到 98%，或到了用户给这个窗口设的上限，或 Codex 应用不让这个号发送（held）。
 *   重置时间已过的窗口算已经重新开始，不管读数是多少（magpie 的 usedPast / resetPassed）。
 *   只看整个号的窗口：ID 里带「:」的是某个模型或功能自己的窗口（如 Code review），不算。
 * - 换走：当前号没有余量时，按顺序换到第一个不是当前号、没失效、有已知且无错的读数、也有余量的号；没有就不动。
 *   当前号的读数不知道或出错时不动（magpie 同样）。
 * - 换回：自动换走后（returning.to 是当前号），排在当前号前面的号所有窗口都低于 90%、也没到上限时，
 *   换回排得最靠前的那个。用户自己换的号（立即使用）不算「换走」，不会被换回。
 * - 固定：固定到某个号后只会换到它上面，用完也不换走。
 * - CLI 登录的号不在列表里（用户移除了在用的号）：换到排第一、有余量的号（访谈 Q22）。
 */

export const SPENT_PCT = 98;
export const BACK_PCT = 90;

export interface RotationAccount {
  id: string;
  // CLI 现在登录的就是它。
  inUse: boolean;
  // 能换上去：登录没失效，Osuna 存着它的登录（当前号除外）。
  switchable: boolean;
  // 这次检查读到的额度；没读过是 undefined。
  usage: ProviderAccountUsage | undefined;
  limits: Record<string, number>;
}

export interface RotationReturning {
  back: string;
  to: string;
}

export type RotationReason =
  | "used_up"
  | "limit"
  | "held"
  | "room_again"
  | "keep_signed_in"
  | "not_listed";

/** 换号记录里的原因：自动换号的这些，加上「立即使用」与「号失效」。 */
export type SwitchReason = RotationReason | "use_now" | "lapsed";

export interface RotationMove {
  to: string;
  reason: RotationReason;
  // used_up、limit：当前号哪个窗口到了。
  window?: ProviderAccountSwitchWindow;
}

/** 号为什么没有余量；有余量时是 null。 */
export type OutOfRoom =
  | { kind: "used_up"; window: ProviderAccountSwitchWindow }
  | { kind: "limit"; window: ProviderAccountSwitchWindow }
  | { kind: "held" };

export interface NextMoveInput {
  // 按用户排的顺序。
  accounts: RotationAccount[];
  keepSignedInTo: string | null;
  returning: RotationReturning | null;
  now: number;
}

function resetPassed(window: ProviderAccountWindow, now: number): boolean {
  if (!window.resetsAt) return false;
  const at = Date.parse(window.resetsAt);
  return Number.isFinite(at) && at <= now;
}

/** 按 share（98 或换回时的 90）与用户的上限判断号有没有余量；读数未知或出错时返回 null 之外的判断交给调用方。 */
export function outOfRoom(input: {
  usage: Extract<ProviderAccountUsage, { status: "read" }>;
  limits: Record<string, number>;
  share: number;
  now: number;
}): OutOfRoom | null {
  const { usage, limits, share, now } = input;
  if (usage.held) return { kind: "held" };
  for (const window of usage.windows) {
    if (!isWholeAccountWindow(window) || resetPassed(window, now)) continue;
    const used = window.usedPct;
    if (typeof used !== "number") continue;
    const limit = limits[window.id];
    if (limit !== undefined && used >= limit) {
      return {
        kind: "limit",
        window: { id: window.id, label: window.label, usedPct: used, limitPct: limit },
      };
    }
    if (used >= share) {
      return { kind: "used_up", window: { id: window.id, label: window.label, usedPct: used } };
    }
  }
  return null;
}

function knownReading(
  account: RotationAccount,
): Extract<ProviderAccountUsage, { status: "read" }> | null {
  return account.usage?.status === "read" ? account.usage : null;
}

/** 能换上去、读数已知且无错、按 share 有余量。 */
function hasRoom(input: { account: RotationAccount; share: number; now: number }): boolean {
  const { account, share, now } = input;
  if (!account.switchable) return false;
  const usage = knownReading(account);
  if (!usage) return false;
  return outOfRoom({ usage, limits: account.limits, share, now }) === null;
}

/** 按顺序第一个不是当前号、有余量（98% 与上限）的号；没有就是 null。 */
export function pickTarget(input: { accounts: RotationAccount[]; now: number }): string | null {
  const target = input.accounts.find(
    (account) => !account.inUse && hasRoom({ account, share: SPENT_PCT, now: input.now }),
  );
  return target?.id ?? null;
}

/** 这次检查该换到哪个号；不换是 null。 */
export function nextMove(input: NextMoveInput): RotationMove | null {
  const { accounts, keepSignedInTo, returning, now } = input;
  if (keepSignedInTo !== null) {
    const kept = accounts.find((account) => account.id === keepSignedInTo);
    if (!kept || kept.inUse || !kept.switchable) return null;
    return { to: kept.id, reason: "keep_signed_in" };
  }
  const current = accounts.findIndex((account) => account.inUse);
  if (current === -1) {
    const to = pickTarget({ accounts, now });
    return to ? { to, reason: "not_listed" } : null;
  }
  const inUse = accounts[current]!;
  if (returning?.to === inUse.id) {
    const back = accounts
      .slice(0, current)
      .find((account) => hasRoom({ account, share: BACK_PCT, now }));
    if (back) return { to: back.id, reason: "room_again" };
  }
  const usage = knownReading(inUse);
  if (!usage) return null;
  const out = outOfRoom({ usage, limits: inUse.limits, share: SPENT_PCT, now });
  if (!out) return null;
  const to = pickTarget({ accounts, now });
  if (!to) return null;
  if (out.kind === "held") return { to, reason: "held" };
  return { to, reason: out.kind, window: out.window };
}

/**
 * 换号之后「等着换回」的记录：自动换走（含号失效）时记下最早被换走的号；换回到它（或比它更靠前的号）时清掉；
 * 别的换法（立即使用、固定、不在列表里）都清掉。
 */
export function returningAfter(input: {
  move: { from: string; to: string; reason: SwitchReason };
  returning: RotationReturning | null;
  order: string[];
}): RotationReturning | null {
  const { move, returning, order } = input;
  const chained = returning?.to === move.from ? returning : null;
  switch (move.reason) {
    // 号失效被换走也算：「重新登录」修好、有余量后换回它。
    case "used_up":
    case "limit":
    case "held":
    case "lapsed":
      return { back: chained?.back ?? move.from, to: move.to };
    case "room_again": {
      if (!chained) return null;
      const reached = order.indexOf(move.to) <= order.indexOf(chained.back);
      return reached ? null : { back: chained.back, to: move.to };
    }
    default:
      return null;
  }
}
