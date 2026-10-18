// 照 magpie（https://github.com/yetone/magpie，internal/agent/claude.go 的 Follow、internal/agent/applied.go 的 Drift 与 Keep）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { z } from "zod";

/**
 * CLI 配置里的模型归 CLI 自己时，接管记录怎么记（照 magpie 的 Follow 与 Keep，ADR 0012）：
 * - followed：CLI 自己换成了某家接口提供的模型，Osuna 跟了过去；之后再换成哪家都没有的模型照样提示「模型被换掉」；
 * - kept：「模型被换掉」时选了保留当前设置，之后不再提示。
 * 两种都让之后的重写不碰这个模型，直到「重新应用」或在 Osuna 里换默认模型。
 */
export const CliModelHoldSchema = z.enum(["followed", "kept"]);
export type CliModelHold = z.infer<typeof CliModelHoldSchema>;

/** CLI 配置里的模型不再是 Osuna 记下的写入值：现在的值（没设为 null）；isKept 为之前选过保留当前设置。 */
export interface CliModelPick {
  now: string | null;
  isKept: boolean;
}

/** CLI 现在读到的档位不再是 Osuna 写的那档：现在的（删掉了为 null）。 */
export interface CliLevelPick {
  now: string | null;
}

/** Osuna 写过的 Ultra Code 被改过：现在开没开。 */
export interface CliUltraCodePick {
  isOn: boolean;
}

/** CLI 自己存下、与接管记录不同的选择；没变的为 null（Codex 没有 Ultra Code，恒为 null）。 */
export interface CliPicks {
  model: CliModelPick | null;
  level: CliLevelPick | null;
  ultraCode: CliUltraCodePick | null;
}
