// 用掉一次重置的确认与结果说法照 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的
// askReset、resetOutcome、resetUseTitle，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { TFunction } from "i18next";
import type { UsageResetOutcome } from "@getpaseo/protocol/messages";
import type { UsageReportEntry } from "@/usage/types";

export const RESET_USE_KEY = "settings.apiEndpoints.balance.resets.use";

/**
 * 卡片上有没有「用掉一次重置」：主机认这个操作、来源能用、报告里有还没用的重置。
 * 按窗口计的（智谱团队）只显示，到厂商自己的页面去用（照 magpie）。
 */
export function canConsumeReset(input: {
  entry: UsageReportEntry;
  hostSupports: boolean;
}): boolean {
  const { entry } = input;
  if (!input.hostSupports || !entry.consumesResets) return false;
  if (entry.report.status !== "available" || !entry.report.resets) return false;
  return entry.report.resets.count > 0 && !entry.report.resets.byWindow;
}

/** 账号在卡片上的名字：来源名，带账号名时加在括号里。 */
function accountName(entry: UsageReportEntry): string {
  return entry.account.label ? `${entry.sourceLabel} (${entry.account.label})` : entry.sourceLabel;
}

/** 确认框的标题与几段话：写明是哪个账号、不能撤回、用掉的是哪一张。 */
export function resetConfirmation(input: {
  t: TFunction;
  entry: UsageReportEntry;
  formatTime: (iso: string) => string;
}): { title: string; paragraphs: string[] } {
  const { t, entry } = input;
  const report = entry.report.status === "available" ? entry.report : null;
  const count = report?.resets?.count ?? 0;
  const until = report?.resets?.until ?? null;
  const who = accountName(entry);
  const lines = [
    count === 1
      ? t(`${RESET_USE_KEY}.confirmOne`, { who })
      : t(`${RESET_USE_KEY}.confirmMany`, { who, count }),
  ];
  // 没有过期时间（都不过期，或清单没读到）时不写哪一张，照 magpie
  if (until) lines.push(t(`${RESET_USE_KEY}.confirmSoonest`, { when: input.formatTime(until) }));
  // 一个窗口都没用过时，用掉也没有窗口可以从头开始
  const used = (report?.windows ?? []).some((window) => (window.usedPct ?? 0) > 0);
  if (!used) lines.push(t(`${RESET_USE_KEY}.confirmIdle`));
  return {
    title: t(`${RESET_USE_KEY}.confirmTitle`, { source: entry.sourceLabel }),
    paragraphs: lines,
  };
}

/** 用掉之后的一句结果；只有真的有窗口从头开始才算成功的语气。认不出的结果代码用 daemon 的说明。 */
export function resetOutcomeLine(input: { t: TFunction; outcome: UsageResetOutcome }): {
  text: string;
  tone: "success" | "notice";
} {
  const { t, outcome } = input;
  switch (outcome.code) {
    case "reset":
      return {
        text:
          outcome.windows === 1
            ? t(`${RESET_USE_KEY}.outcomeResetOne`)
            : t(`${RESET_USE_KEY}.outcomeResetMany`, { count: outcome.windows }),
        tone: "success",
      };
    case "nothing_to_reset":
      return { text: t(`${RESET_USE_KEY}.outcomeNothingToReset`), tone: "notice" };
    case "no_credit":
      return { text: t(`${RESET_USE_KEY}.outcomeNoCredit`), tone: "notice" };
    case "already_redeemed":
    case "already_used":
      return { text: t(`${RESET_USE_KEY}.outcomeAlreadyRedeemed`), tone: "notice" };
  }
  return { text: outcome.message ?? outcome.code, tone: "notice" };
}
