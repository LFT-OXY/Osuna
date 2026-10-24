// 角色的设、清空与跟随照 magpie（https://github.com/yetone/magpie，internal/agent/omp.go 的 role 与它的 thinking 字段）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import {
  isOmpModelRole,
  OMP_MODEL_ROLES,
  OMP_ROLE_THINKING_LEVELS,
} from "@getpaseo/protocol/api-endpoint/omp-model-roles";
import type {
  ApiEndpointAgentSettings,
  ApiEndpointModelRole,
  ApiEndpointModelRoles,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { CliRolePick } from "./cli-model-hold.js";
import { isDefaultModelChoice } from "./host-endpoints.js";
import type { PiLikeRoleWiring } from "./pi-config-patch.js";
import {
  providerOfAgent,
  type ApiEndpointAgentKey,
  type ApiEndpointProvider,
  type ApiEndpointState,
} from "./store.js";

/*
 * OMP 的模型角色（工单 05）：存在 OMP 那份 Agent 设置的 modelRoles 里，打开开关时写进 config.yml 的 modelRoles.<角色>
 * （omp-config-patch.ts）。默认角色是默认模型，不在这里。
 */

// 有模型角色的 CLI（OMP 的每套命名配置同样有）。
const MODEL_ROLE_PROVIDERS: ReadonlySet<ApiEndpointProvider> = new Set(["omp"]);

export function takesModelRoles(provider: ApiEndpointAgentKey): boolean {
  return MODEL_ROLE_PROVIDERS.has(providerOfAgent(provider));
}

/** 一次设置里要改的角色：给出的设成这个模型与档位，null 为清空，没给的不变。 */
export type ModelRolesChange = Record<string, ApiEndpointModelRole | null>;

export interface ModelRolesChangeInput {
  state: ApiEndpointState;
  agent: ApiEndpointAgentSettings;
  change: ModelRolesChange;
}

/** 改过角色的设置；角色、模型或档位不认得时整个拒绝，message 说哪里不对。 */
export type ModelRolesChangeResult =
  | { kind: "changed"; agent: ApiEndpointAgentSettings }
  | RoleRefusal;

export function withModelRolesChanged(input: ModelRolesChangeInput): ModelRolesChangeResult {
  const roles: ApiEndpointModelRoles = { ...input.agent.modelRoles };
  for (const [role, requested] of Object.entries(input.change)) {
    if (!isOmpModelRole(role)) {
      return refused(`OMP's model roles are ${OMP_MODEL_ROLES.join(", ")}, not ${role}`);
    }
    if (requested === null) {
      delete roles[role];
      continue;
    }
    const checked = checkedRole({ state: input.state, role, requested });
    if (checked.kind === "refused") return checked;
    roles[role] = checked.role;
  }
  return { kind: "changed", agent: { ...input.agent, modelRoles: roles } };
}

interface RoleCheck {
  state: ApiEndpointState;
  role: string;
  requested: ApiEndpointModelRole;
}

type RoleCheckResult = { kind: "checked"; role: ApiEndpointModelRole } | RoleRefusal;

interface RoleRefusal {
  kind: "refused";
  message: string;
}

function checkedRole(input: RoleCheck): RoleCheckResult {
  const modelId = input.requested.modelId.trim();
  if (!isDefaultModelChoice(input.state, modelId)) {
    return refused(`${modelId} is not one of the models selected on an endpoint that is on`);
  }
  const level = input.requested.thinkingOptionId?.trim().toLowerCase() ?? null;
  const isKnownLevel = level === null || OMP_ROLE_THINKING_LEVELS.some((known) => known === level);
  if (!isKnownLevel) {
    return refused(
      `OMP's ${input.role} role thinks at one of ${OMP_ROLE_THINKING_LEVELS.join(", ")}, not ${level}`,
    );
  }
  return { kind: "checked", role: { modelId, thinkingOptionId: level } };
}

/** 写进 config.yml 的角色，按 OMP 的角色先后；没设的不写。 */
export function modelRoleWiring(agent: ApiEndpointAgentSettings): PiLikeRoleWiring[] {
  const roles = agent.modelRoles ?? {};
  return OMP_MODEL_ROLES.flatMap((role) => {
    const value = roles[role];
    if (value === undefined) return [];
    return [{ role, model: value.modelId, thinking: value.thinkingOptionId ?? null }];
  });
}

export interface FollowedRolesInput {
  agent: ApiEndpointAgentSettings;
  picks: Record<string, CliRolePick>;
  // OMP 里写成 osuna/<模型> 的模型对上的 Osuna 模型；对不上为 null。
  followedModel: (cliModel: string | null) => string | null;
}

/**
 * OMP 里改过的角色（照 magpie 的 role 字段 Get 读文件）：换成 Osuna 的另一个模型就跟过去、「:档位」是它的档位；
 * 删掉、换到别处或一串备选就不再设，交给 OMP（关开关时也不碰它）。没变时原样返回同一个对象。
 */
export function followedModelRoles(input: FollowedRolesInput): ApiEndpointAgentSettings {
  const { agent, picks } = input;
  const entries = Object.entries(picks);
  if (entries.length === 0) return agent;
  const roles: ApiEndpointModelRoles = { ...agent.modelRoles };
  for (const [role, pick] of entries) {
    const modelId = input.followedModel(pick.now);
    if (modelId === null) delete roles[role];
    else roles[role] = { modelId, thinkingOptionId: pick.level };
  }
  return { ...agent, modelRoles: roles };
}

function refused(message: string): RoleRefusal {
  return { kind: "refused", message };
}
