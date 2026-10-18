// Subagent 的请求改到强制模型、spawn_agent 补上的清单照 magpie（https://github.com/yetone/magpie，internal/gateway/codex_backend.go 的
// codexBackend、gateway.go 的 handle 与 serveAgent 对 codexSubagentPick、spawnAgentModels 的调用，codex_spawn_models.go 的 spawnChoices）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import type { IncomingHttpHeaders } from "node:http";
import type pino from "pino";
import { applyEdits, modify } from "jsonc-parser";
import { codexOwnModels, readCodexModelsCache } from "../codex-models-cache.js";
import { usableModels } from "../host-endpoints.js";
import type { ApiEndpointState } from "../store.js";
import { parseJson } from "../upstream-http.js";
import { isEndpointModel } from "./chatgpt-backend.js";
import type { ChatGptModelsListing } from "./chatgpt-models.js";
import { withSpawnAgentModels, type SpawnChoice } from "./codex-spawn-models.js";
import { pickCodexSubagentModel, type CodexSubagentPick } from "./codex-subagents.js";
import { resolveGatewayRoute } from "./routing.js";

const CHATGPT: ChatGptTurnDestination = "chatgpt";
const ENDPOINT: ChatGptTurnDestination = "endpoint";

/** 改过的请求体与模型名。 */
export interface ShapedCodexRequest {
  text: string;
  model: string;
}

/**
 * Codex 经 /v1/responses 的一轮（API key 接法，Codex 只认 Osuna 的模型目录）：Subagent 的请求改到强制 Subagent 模型，
 * spawn_agent 补上目录里 /model 列着的其余模型。没有 ChatGPT 自带模型，所以没有封存的任务能打开。
 */
export function shapeCodexApiRequest(input: {
  headers: IncomingHttpHeaders;
  text: string;
  model: string;
  state: ApiEndpointState;
  // 去掉已下线模型后的状态（给 Agent 选模型的那份）。
  listed: ApiEndpointState;
  logger: pino.Logger;
}): ShapedCodexRequest {
  const { state, listed } = input;
  const pick = pickCodexSubagentModel({
    headers: input.headers,
    asked: input.model,
    forced: state.agents.codex.forcedSubagentModelId ?? null,
    parsed: parseJson(input.text),
    isServed: (model) => resolveGatewayRoute({ state, listed, agent: "codex", model }).ok,
    opensSealed: () => false,
  });
  const picked = applyPick({ ...input, pick });
  const choices = usableModels(listed).map((model) => ({
    slug: model.id,
    name: model.label ?? model.id,
  }));
  return { text: withSpawnAgentModels({ text: picked.text, choices }), model: picked.model };
}

/** ChatGPT 后端那组路径上的一轮发给谁：ChatGPT（Codex 自己的模型）或接口。 */
export type ChatGptTurnDestination = "chatgpt" | "endpoint";

/** ChatGPT 后端那组路径上的一轮改完之后的请求与去向。 */
export interface ShapedChatGptRequest extends ShapedCodexRequest {
  goesTo: ChatGptTurnDestination;
}

/** 按模型名的去向：带接口标识的走接口，光秃秃的给 ChatGPT（ADR 0010）。 */
export function chatgptTurnDestination(model: string): ChatGptTurnDestination {
  if (isEndpointModel(model)) return ENDPOINT;
  return CHATGPT;
}

/**
 * 用 ChatGPT 登录的 Codex 的一轮（ADR 0010）：Subagent 的请求改到强制 Subagent 模型（光秃秃的名字是 Codex 自己的模型时归它，
 * 只有它打得开 ChatGPT 封存的任务），spawn_agent 补上 Codex 自己的模型与接口模型。主对话在 Codex 自己的模型上、
 * 「Codex Subagent 可用任意模型」又关着时，它的 Subagent 拿到的是封存的任务，只补 Codex 自己的模型。
 * `state` 为 null（endpoints.json 读不懂）时不改模型，spawn_agent 照样补（magpie 同样不看接口的文件）。
 */
export function shapeCodexChatGptRequest(input: {
  headers: IncomingHttpHeaders;
  text: string;
  model: string;
  state: ApiEndpointState | null;
  listed: ApiEndpointState | null;
  listing: ChatGptModelsListing;
  logger: pino.Logger;
}): ShapedChatGptRequest {
  const { state, listed, listing } = input;
  const own = codexOwnModels(readCodexModelsCache(listing.codexHome));
  const ownSlugs = new Set(own.map((model) => model.slug));
  let picked: ShapedCodexRequest = { text: input.text, model: input.model };
  let destination = chatgptTurnDestination(input.model);
  if (state !== null && listed !== null) {
    const isServedByEndpoint = (model: string) =>
      resolveGatewayRoute({ state, listed, agent: "codex", model }).ok;
    const pick = pickCodexSubagentModel({
      headers: input.headers,
      asked: input.model,
      forced: state.agents.codex.forcedSubagentModelId ?? null,
      parsed: parseJson(input.text),
      isServed: (model) => ownSlugs.has(model) || isServedByEndpoint(model),
      opensSealed: (model) => ownSlugs.has(model),
    });
    picked = applyPick({ ...input, pick });
    if (pick.kind === "moved") destination = ownSlugs.has(pick.to) ? CHATGPT : ENDPOINT;
  }
  const isLeadSealing = !listing.marksAgentsV1 && !isEndpointModel(picked.model);
  const choices: SpawnChoice[] = own.map((model) => ({ slug: model.slug, name: model.label }));
  if (!isLeadSealing) {
    for (const entry of listing.entries)
      choices.push({ slug: entry.slug, name: entry.display_name });
  }
  const text = withSpawnAgentModels({ text: picked.text, choices });
  return { text, model: picked.model, goesTo: destination };
}

/** 改到强制的模型（请求体里的 model 一起改），或照原样并记下为什么没改。 */
function applyPick(input: {
  text: string;
  model: string;
  pick: CodexSubagentPick;
  logger: pino.Logger;
}): ShapedCodexRequest {
  const { pick, logger } = input;
  if (pick.kind === "kept") {
    logger.info(
      { asked: input.model, forced: pick.to, why: pick.why },
      "Codex Subagent left on the model its lead asked for",
    );
  }
  if (pick.kind !== "moved") return { text: input.text, model: input.model };
  logger.info(
    { asked: input.model, to: pick.to },
    "Codex Subagent put on the forced Subagent model",
  );
  const text = applyEdits(input.text, modify(input.text, ["model"], pick.to, {}));
  return { text, model: pick.to };
}
