// 导入窗口默认选上哪几条照 magpie（https://github.com/yetone/magpie，7597c132）internal/gui/importapps.go 的
// discovery 条件与 internal/gui/assets/app.js 的 openImportApps。Copyright (c) 2026 yetone. MIT License —
// 完整声明见本仓库 THIRD_PARTY_NOTICES。

/** 判断一条发现默认选不选要看的几样（daemon 的对照结果与线上的条目都能给出）。 */
export interface ImportOfferFacts {
  skip: string | null;
  off: string | null;
  status: string;
  // 同一地址、另一把 key 的那家存在（magpie 的 KeyOf）。
  hasOtherKey: boolean;
}

const PRESELECTED_STATUSES = new Set(["new", "other_key", "name_taken"]);

/**
 * 导入窗口打开时默认选上的，也就是发现提示里会提的：读得了、在那个软件里开着、新的或同一家 key 不同的；
 * 只是名称撞上的要用户自己选，名称撞上又是同一家 key 不同的算。认不出的状态不选。
 */
export function isPreselectedImport(facts: ImportOfferFacts): boolean {
  if (facts.skip !== null || facts.off !== null) return false;
  if (!PRESELECTED_STATUSES.has(facts.status)) return false;
  return facts.status !== "name_taken" || facts.hasOtherKey;
}
