// 价格倍率框的读法（空即按原价、小数点可写成逗号、0 到 1000 最多三位小数）移植自 magpie
// （https://github.com/yetone/magpie，internal/gui/assets/app.js 的 decimalOf、priceRateOfDraft）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { isPriceMultiplier } from "@getpaseo/protocol/api-endpoint/price-multiplier";

/*
 * 添加 / 编辑窗口「高级」里价格倍率的纯逻辑：存的倍率与框里的文字互相换算，以及能不能存（当场提示，挡住保存）。
 */

export function priceMultiplierTextOf(multiplier: number | undefined): string {
  return multiplier === undefined ? "" : String(multiplier);
}

/** 空的是 null（按原价）；不是 0 到 1000、多于三位小数或不是数的是 invalid。 */
export type PriceMultiplierRead = { kind: "ok"; value: number | null } | { kind: "invalid" };

export function readPriceMultiplierText(text: string): PriceMultiplierRead {
  let trimmed = text.trim();
  if (trimmed === "") return { kind: "ok", value: null };
  if (/^\d*,\d+$/.test(trimmed)) trimmed = trimmed.replace(",", ".");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(trimmed)) return { kind: "invalid" };
  const value = Number(trimmed);
  return isPriceMultiplier(value) ? { kind: "ok", value } : { kind: "invalid" };
}
