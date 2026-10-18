import type { TFunction } from "i18next";

/*
 * 「被绕过」用界面语言说明：说明按怎么看出来的（params.how），时间按看的人的语言显示时:分。
 * 认不出的 how、读不出的时间照主机给的英文原文。
 */

const DETAIL_KEYS: Record<string, string> = {
  used: "settings.apiEndpoints.agent.issues.bypassedUsedDetail",
  elsewhere: "settings.apiEndpoints.agent.issues.bypassedElsewhereDetail",
  refused: "settings.apiEndpoints.agent.issues.bypassedRefusedDetail",
};

export interface BypassedCopyInput {
  t: TFunction;
  providerLabel: string;
  params: Record<string, string>;
  // 主机给的英文原文。
  message: string;
  locale: string;
}

export interface BypassedCopy {
  title: string;
  description: string;
}

export function describeBypassed(input: BypassedCopyInput): BypassedCopy {
  const { t, providerLabel, params, message, locale } = input;
  const title = t("settings.apiEndpoints.agent.issues.bypassed", { agent: providerLabel });
  const detailKey = DETAIL_KEYS[params.how];
  const at = new Date(params.at ?? "");
  const isKnown = detailKey !== undefined && !Number.isNaN(at.getTime());
  if (!isKnown) return { title, description: message };
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(at);
  return {
    title,
    description: t(detailKey, { agent: providerLabel, time, host: params.host }),
  };
}
