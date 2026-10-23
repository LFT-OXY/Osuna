// 价格倍率的范围与步长移植自 magpie（https://github.com/yetone/magpie，internal/provider/models.go 的 PriceRateOK）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

/*
 * 价格倍率（Price multiplier）：这家按公开价的几倍收钱，估算成本按「公开价 × 倍率」算；没有即按原价，0 即免费。
 * daemon 保存时拿它校验，app 在表单里拿它当场提示。
 */

export const API_ENDPOINT_PRICE_MULTIPLIER_MAX = 1000;

/** 能不能存：0 到 1000，最多三位小数（magpie PriceRateOK）。 */
export function isPriceMultiplier(value: number): boolean {
  if (!Number.isFinite(value) || value < 0 || value > API_ENDPOINT_PRICE_MULTIPLIER_MAX) {
    return false;
  }
  return Math.abs(value * 1000 - Math.round(value * 1000)) <= 1e-6;
}
