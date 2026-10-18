// 打开开关时挑默认模型的办法照 magpie（https://github.com/yetone/magpie，internal/agent/applied.go 的 ConnectHow、connect、
// connectWas、reconnect 与 Connection）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { API_ENDPOINT_MODEL_TIERS } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { sameModel } from "./gateway/routing.js";
import {
  defaultModelChoices,
  endpointModelGroups,
  isDefaultModelChoice,
  usableModels,
} from "./host-endpoints.js";
import type { ApiEndpointProvider, ApiEndpointState } from "./store.js";

/*
 * 打开「使用第三方接口」时默认模型怎么挑（ADR 0012、PRD 第 28 条），依次：
 * - kept：开关本来就开着，或 CLI 配置还指向中转站且它的模型有接口提供，原样不动；
 * - again：上次关掉开关后 CLI 的模型没再变过，放回关掉前的默认模型（记在接管记录的 reconnect 里）；
 * - joined：用 ChatGPT 登录、用着内置 openai 服务商（或 CC Switch 的镜像）的 Codex 保持它自己选的模型，
 *   接口模型并进 /model（ADR 0010）；默认模型只给 Osuna 自己的新对话用；
 * - same：CLI 现在用的模型有接口提供，沿用（去掉接口标识、[1m] 与写法差别后对上）；
 * - alike：CLI 用的是光秃秃的档位名（opus 等）：第一家为这个档位配了映射的接口与映射到的模型，
 *   没有映射时取名字属于这一族的模型（magpie 的 alike）；
 * - first：都没有时取最早开着接口的第一个已选模型。
 */

export type DefaultModelPickHow = "kept" | "again" | "joined" | "same" | "alike" | "first";

/** 上次关掉开关时的默认模型，与关掉后 CLI 配置里留下的模型（没有为 null）。 */
export interface DefaultModelReconnect {
  model: string;
  left: string | null;
}

export interface DefaultModelPickInput {
  state: ApiEndpointState;
  provider: ApiEndpointProvider;
  // CLI 配置里现在的模型（Claude Code 的 settings.json model、Codex 的 config.toml model），没设为 null。
  cliModel: string | null;
  // CLI 配置现在就指向中转站（例如「保留当前设置」之后）。
  isWired: boolean;
  reconnect: DefaultModelReconnect | null;
  // 用 ChatGPT 登录的 Codex，模型归它自己（joined）。
  joinsOwnModel: boolean;
}

export interface DefaultModelPick {
  how: DefaultModelPickHow;
  defaultModelId: string;
  // 挑之前 CLI 配置里的模型，给设置页的说明用。
  previousModel: string | null;
}

/** 一个可用模型都没有时为 null（调用方照旧拒绝）。 */
export function pickDefaultModel(input: DefaultModelPickInput): DefaultModelPick | null {
  const { state } = input;
  const first = usableModels(state)[0];
  if (!first) return null;
  const agent = state.agents[input.provider];
  const previousModel = input.cliModel;
  const picked = (how: DefaultModelPickHow, defaultModelId: string): DefaultModelPick => ({
    how,
    defaultModelId,
    previousModel,
  });

  if (agent.enabled && isDefaultModelChoice(state, agent.defaultModelId)) {
    return picked("kept", agent.defaultModelId);
  }
  const served = servedModel(state, input.cliModel);
  if (input.isWired && served !== null) return picked("kept", served);
  const { reconnect } = input;
  const isLeftAsItWas = reconnect !== null && reconnect.left === input.cliModel;
  if (isLeftAsItWas && isDefaultModelChoice(state, reconnect.model)) {
    return picked("again", reconnect.model);
  }
  if (input.joinsOwnModel) {
    const kept = isDefaultModelChoice(state, agent.defaultModelId) ? agent.defaultModelId : null;
    return picked("joined", kept ?? first.id);
  }
  if (served !== null) return picked("same", served);
  const alike = aliasModel(state, input.cliModel);
  if (alike !== null) return picked("alike", alike);
  return picked("first", first.id);
}

/** magpie `connectWas`：去掉接口或厂商前缀；另去掉 Claude Code 的 [1m]（Osuna 写进去的 1M 标记）。 */
function modelIdOf(model: string): string {
  const id = model.slice(model.lastIndexOf("/") + 1).trim();
  return id.toLowerCase().endsWith("[1m]") ? id.slice(0, -"[1m]".length) : id;
}

/**
 * CLI 的模型对上的默认模型：原样就是一个能选的名字（光秃秃的或带接口标识的）；去掉 [1m] 后是；
 * 否则去掉前缀后与哪家提供的模型同名或只差写法（sameModel：claude-opus-4.6 即 claude-opus-4-6），取光秃秃的名字。
 */
export function servedModel(state: ApiEndpointState, cliModel: string | null): string | null {
  if (cliModel === null || cliModel.trim() === "") return null;
  const choices = defaultModelChoices(state);
  const trimmed = cliModel.trim();
  const unmarked = trimmed.toLowerCase().endsWith("[1m]")
    ? trimmed.slice(0, -"[1m]".length)
    : trimmed;
  const exact = choices.find((choice) => choice === trimmed || choice === unmarked);
  if (exact) return exact;
  const id = modelIdOf(trimmed);
  const bare = usableModels(state).map((model) => model.id);
  return (
    bare.find((model) => model === id) ??
    bare.find((model) => sameModel(model) === sameModel(id)) ??
    null
  );
}

/**
 * 光秃秃的档位名（没有连字符）：先找第一家为它配了映射的接口，取「接口标识/映射到的模型」；
 * 再照 magpie 找名字里有「-档位-」的模型（opus → claude-opus-4-6），光秃秃的名字在前。
 */
function aliasModel(state: ApiEndpointState, cliModel: string | null): string | null {
  if (cliModel === null) return null;
  const cur = modelIdOf(cliModel);
  if (cur === "" || cur.includes("-")) return null;
  const tier = API_ENDPOINT_MODEL_TIERS.find((entry) => entry === cur.toLowerCase());
  if (tier) {
    for (const group of endpointModelGroups(state)) {
      const mapped = group.endpoint.modelMapping?.[tier];
      const entry = group.models.find(({ model }) => model.id === mapped);
      if (entry) return entry.id;
    }
  }
  const family = `-${cur}-`;
  return (
    defaultModelChoices(state).find((choice) => `${modelIdOf(choice)}-`.includes(family)) ?? null
  );
}
