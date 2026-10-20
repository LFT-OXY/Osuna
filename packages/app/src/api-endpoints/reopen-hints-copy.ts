// 每类一句怎么重开的说法与「多久之前」取自 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的
// STALE_HOW 与 ago）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { TFunction } from "i18next";
import type { ReopenHintView } from "./internal/agent-settings";

/*
 * 提示区里「要重开谁」用界面语言说（PRD 第 36 条）：每类一行，说明怎么重开；要用户执行的命令单独给出、完整显示。
 * 启动时间说成「多久之前」，好几天前的不会看成今天；认不出的类照主机的英文原文。
 */

export interface ReopenLine {
  text: string;
  // 要用户自己执行的命令，原样显示，不翻译。
  command: string | null;
}

export interface ReopenHintsCopy {
  title: string;
  lines: ReopenLine[];
  // 主机说了才有：Claude Code 哪些改动正在跑的会话立刻用上、哪些要重开。
  note: string | null;
}

export interface ReopenHintsCopyInput {
  t: TFunction;
  providerLabel: string;
  hints: ReopenHintView[];
  locale: string;
  now: Date;
}

const KEY = "settings.apiEndpoints.agent.reopen";

export function describeReopenHints(input: ReopenHintsCopyInput): ReopenHintsCopy | null {
  const { t, providerLabel: agent, hints } = input;
  const copies = hints.filter((hint) => hint.kind !== "liveEnv");
  if (copies.length === 0) return null;
  const isOnlyRestarted = copies.every((hint) => hint.kind === "appServerRestarted");
  if (isOnlyRestarted) {
    return {
      title: t(`${KEY}.appServerRestarted`, { agent }),
      lines: [{ text: t(`${KEY}.appServerRestartedDetail`, { agent }), command: null }],
      note: null,
    };
  }
  let note: string | null = null;
  if (hints.some((hint) => hint.kind === "liveEnv")) note = t(`${KEY}.liveEnv`, { agent });
  return {
    title: t(`${KEY}.title`, { agent }),
    lines: copies.map((hint) => lineOf({ ...input, hint })),
    note,
  };
}

/** 「3 小时前」「昨天」，按看的人的语言（magpie 的 ago）。 */
export function agoOf(input: { t: TFunction; since: Date; now: Date; locale: string }): string {
  return relativeAgo(input) ?? input.t(`${KEY}.justNow`);
}

/** 「3 小时前」「昨天」（Intl，按看的人的语言）；不到一分钟为 null，由调用方写自己的「刚刚」整句。 */
export function relativeAgo(input: { since: Date; now: Date; locale: string }): string | null {
  const seconds = (input.since.getTime() - input.now.getTime()) / 1000;
  const format = new Intl.RelativeTimeFormat(input.locale, { numeric: "auto" });
  for (const [unit, size] of AGO_UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return null;
}

const AGO_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

function lineOf(input: ReopenHintsCopyInput & { hint: ReopenHintView }): ReopenLine {
  const { t, providerLabel: agent, hint } = input;
  const ago = (since: Date) => agoOf({ ...input, since });
  switch (hint.kind) {
    case "osunaSessions":
      return { text: t(`${KEY}.osunaSessions`, { agent, count: hint.count }), command: null };
    case "cli":
    case "ide":
      return {
        // 「几个」不用复数形式：句子写成「（2 个，最早 3 小时前启动）」，各语言都通。
        text: t(`${KEY}.${hint.kind}`, { agent, copies: hint.count, ago: ago(hint.since) }),
        command: null,
      };
    case "app":
    case "embedded":
      return {
        text: t(`${KEY}.${hint.kind}`, { agent, app: hint.app, ago: ago(hint.since) }),
        command: null,
      };
    case "appServer":
      return { text: t(`${KEY}.appServer`, { ago: ago(hint.since) }), command: hint.command };
    case "appServerRestarted":
      return { text: t(`${KEY}.appServerRestartedLine`, { agent }), command: null };
    case "liveEnv":
      return { text: t(`${KEY}.liveEnv`, { agent }), command: null };
    case "unknown":
      return { text: hint.message, command: null };
  }
}

/** 这些副本的指纹：用户点了「知道了」之后，副本变了才再显示（magpie staleSeen）。 */
export function reopenSignature(hints: ReopenHintView[]): string {
  return JSON.stringify(hints);
}
