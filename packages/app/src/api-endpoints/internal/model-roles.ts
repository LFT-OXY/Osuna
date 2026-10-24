// 角色空着时 OMP 用什么移植自 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的 FOLLOWS_MODEL、
// OMP_UNSET 与 tierMenu 的 unset）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { OmpModelRole } from "@getpaseo/protocol/api-endpoint/omp-model-roles";

/*
 * OMP 的模型角色空着时用什么（OMP 的 model-resolver.ts 与 commit/model-selection.ts，magpie 照着写）：
 * Subagent、小任务、难题跟默认模型；规划、看图由 OMP 自己挑；顾问先用难题的，难题也空着就由 OMP 自己挑（不跟默认模型）；
 * 提交说明、极小任务用小任务的（小任务空着即默认模型）；记忆先用极小任务的，再用小任务的。
 */

/** 空着时跟的那个：默认模型或另一个角色。 */
export type RoleFallbackSource = "default" | "slow" | "smol" | "tiny";

export type RoleFallback<Model> =
  | { kind: "ompPicks" }
  | { kind: "model"; via: RoleFallbackSource; model: Model };

export interface RoleFallbackInput<Model> {
  role: OmpModelRole;
  defaultModel: Model | null;
  // 设了的角色的模型；没设为 null。
  modelOf: (role: OmpModelRole) => Model | null;
}

export function roleFallback<Model>(input: RoleFallbackInput<Model>): RoleFallback<Model> {
  const { role, defaultModel, modelOf } = input;
  const followed = (via: RoleFallbackSource, model: Model | null): RoleFallback<Model> =>
    model === null ? { kind: "ompPicks" } : { kind: "model", via, model };
  const smol = modelOf("smol") ?? defaultModel;
  switch (role) {
    case "task":
    case "smol":
    case "slow":
      return followed("default", defaultModel);
    case "plan":
    case "vision":
      return { kind: "ompPicks" };
    case "advisor":
      return followed("slow", modelOf("slow"));
    case "commit":
    case "tiny":
      return followed("smol", smol);
    case "memory": {
      const tiny = modelOf("tiny");
      return tiny === null ? followed("smol", smol) : followed("tiny", tiny);
    }
  }
}
