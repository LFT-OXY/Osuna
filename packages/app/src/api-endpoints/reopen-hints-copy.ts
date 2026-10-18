// 每类一句怎么重开的说法取自 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的 STALE_HOW）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { TFunction } from "i18next";
import type { ReopenHintKind, ReopenHintView } from "./internal/agent-settings";

/*
 * 提示区里「要重开谁」用界面语言说（PRD 第 36 条，文案照 magpie 的 STALE_HOW）：每类一行，说明怎么重开；
 * 要用户执行的命令单独给出、完整显示。时间按看的人的语言显示时:分；认不出的类、读不出的时间照主机的英文原文。
 */

export interface ReopenLine {
  text: string;
  // 要用户自己执行的命令，原样显示，不翻译。
  command: string | null;
}

export interface ReopenHintsCopy {
  title: string;
  lines: ReopenLine[];
  // 只有 Claude Code 有：哪些改动正在跑的会话立刻用上、哪些要重开。
  note: string | null;
}

export interface ReopenHintsCopyInput {
  t: TFunction;
  provider: string;
  providerLabel: string;
  hints: ReopenHintView[];
  locale: string;
}

const KEY = "settings.apiEndpoints.agent.reopen";

// 带启动时间说的几类；读不出时间时照主机原文。
const TIMED_KEYS: Partial<Record<ReopenHintKind, string>> = {
  cli: `${KEY}.cli`,
  ide: `${KEY}.ide`,
  app: `${KEY}.app`,
  embedded: `${KEY}.embedded`,
  appServer: `${KEY}.appServer`,
};

export function describeReopenHints(input: ReopenHintsCopyInput): ReopenHintsCopy | null {
  const { t, providerLabel, hints } = input;
  if (hints.length === 0) return null;
  const isOnlyRestarted = hints.every((hint) => hint.kind === "appServerRestarted");
  if (isOnlyRestarted) {
    return {
      title: t(`${KEY}.appServerRestarted`, { agent: providerLabel }),
      lines: [
        { text: t(`${KEY}.appServerRestartedDetail`, { agent: providerLabel }), command: null },
      ],
      note: null,
    };
  }
  let note: string | null = null;
  if (input.provider === "claude") note = t(`${KEY}.claudeNote`, { agent: providerLabel });
  return {
    title: t(`${KEY}.title`, { agent: providerLabel }),
    lines: hints.map((hint) => lineOf({ ...input, hint })),
    note,
  };
}

function lineOf(input: ReopenHintsCopyInput & { hint: ReopenHintView }): ReopenLine {
  const { t, providerLabel, hint, locale } = input;
  const agent = providerLabel;
  if (hint.kind === "osunaSessions") {
    return { text: t(`${KEY}.osunaSessions`, { agent, count: hint.count ?? 0 }), command: null };
  }
  if (hint.kind === "appServerRestarted") {
    return { text: t(`${KEY}.appServerRestartedLine`, { agent }), command: null };
  }
  const key = TIMED_KEYS[hint.kind];
  const { since } = hint;
  if (key === undefined) return { text: hint.message, command: null };
  if (since === null) return { text: hint.message, command: null };
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
    since,
  );
  return {
    // 「几个」不用复数形式：句子写成「（2 个，最早 09:12 启动）」，各语言都通。
    text: t(key, { agent, time, copies: hint.count ?? 1, app: hint.app ?? "" }),
    command: hint.command,
  };
}
