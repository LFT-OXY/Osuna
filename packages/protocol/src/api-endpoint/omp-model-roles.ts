// 角色清单与思考档位照 magpie（https://github.com/yetone/magpie，internal/agent/omp.go 的 roles 与 ompEfforts）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

/*
 * OMP 的模型角色（Model roles，任务 10-16-pi-omp-endpoints 工单 05）：config.yml 里 modelRoles.<角色> 的键，按 magpie 的先后。
 * 默认角色（default）就是「默认模型」，不在这里。界面里 task 叫 Subagent。
 */
export const OMP_MODEL_ROLES = [
  "task",
  "smol",
  "slow",
  "plan",
  "vision",
  "advisor",
  "commit",
  "tiny",
  "memory",
] as const;
export type OmpModelRole = (typeof OMP_MODEL_ROLES)[number];

/** 角色能带的思考档位（写成「osuna/<模型>:<档位>」）：auto 是 OMP 每轮自己挑，off 是不思考，其余是 OMP 的几档。 */
export const OMP_ROLE_THINKING_LEVELS = [
  "auto",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export function isOmpModelRole(role: string): role is OmpModelRole {
  return OMP_MODEL_ROLES.some((candidate) => candidate === role);
}
