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

/**
 * CLI 配置里现在的选择（照 magpie 一律读文件）：model 只在与接管记录不同时有；level 是 CLI 现在读到的档位（没有为 null）；
 * isUltraCodeOn 是 Ultra Code 开没开（Codex 没有，为 null）。档位与 Ultra Code 由调用方和 Osuna 的设置比。
 */
export interface CliPicks {
  model: CliModelPick | null;
  level: string | null;
  isUltraCodeOn: boolean | null;
  // Subagent 模型不再是 Osuna 写的值时有（照 magpie subagent 字段读文件）：Claude Code 的可带「:档位」，Codex 的是默认 Subagent 模型。
  subagent: CliSidePick | null;
  // Codex 的默认 Subagent 档位与记忆模型不再是 Osuna 写的值时有；Claude Code 没有，为 null。
  subagentLevel: CliSidePick | null;
  memory: CliSidePick | null;
  // OMP 的模型角色里不再是 Osuna 写的值的（按角色键）；别的 CLI 为 null。
  roles: Record<string, CliRolePick> | null;
}

/** 角色现在的模型（不带档位；删掉了或是一串备选为 null）与它末尾的思考档位（没有为 null）。 */
export interface CliRolePick {
  now: string | null;
  level: string | null;
}

/** 文件里现在的值；删掉了为 null。 */
export interface CliSidePick {
  now: string | null;
}
