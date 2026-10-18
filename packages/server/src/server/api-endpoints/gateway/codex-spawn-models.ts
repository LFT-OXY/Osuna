// 移植自 magpie（https://github.com/yetone/magpie，internal/gateway/codex_spawn_models.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { isRecord, parseJson } from "../upstream-http.js";

/*
 * Codex 的 spawn_agent 工具说明只列模型目录里的前 5 个（codex-rs core/src/agent/child_config.rs
 * MAX_SPAWN_AGENT_MODEL_OVERRIDES，multi_agents_spec.rs spawn_agent_models_description），却收目录里任何一个模型名
 * （find_spawn_agent_model_name）。所以主对话最多只能把 Subagent 放到 5 个模型上。这里在 Codex 那段清单后面补上其余能选的，
 * 最多 200 个。补的这段跟着提示词发给上游（ChatGPT 自带模型时也发给 OpenAI），所以措辞中性：不提 Osuna，也不提 Codex 的上限。
 */

const SPAWN_AGENT = "spawn_agent";
const CODEX_LIST_HEADER = "Available model overrides";
const SPAWN_MORE = "More models that may be set as `model`:";
const SPAWN_MOST = 200;

/** 一个能补上的模型：spawn_agent 收的写法与显示名。 */
export interface SpawnChoice {
  slug: string;
  name: string;
}

/**
 * 请求里 spawn_agent 的说明补上 choices 里 Codex 没列的模型；它在 tools 里（单独或在 Codex 的协作 namespace 里），
 * 或在 tool_search_output 交回的工具里（能搜工具的模型要搜到才拿到它，Codex 每轮原样带着这段输出）。
 * 没有可补的、不是 JSON、或已经补过时原样返回。
 */
export function withSpawnAgentModels(input: { text: string; choices: SpawnChoice[] }): string {
  const { text, choices } = input;
  const mentionsSpawn = text.includes(`"${SPAWN_AGENT}"`) && text.includes(CODEX_LIST_HEADER);
  if (!mentionsSpawn || choices.length === 0) return text;
  const body = parseJson(text);
  if (!isRecord(body)) return text;
  let isChanged = false;
  const tools = moreSpawnTools(body.tools, choices);
  if (tools !== null) {
    body.tools = tools;
    isChanged = true;
  }
  if (Array.isArray(body.input)) {
    for (const item of body.input) {
      const isSearchOutput = isRecord(item) && item.type === "tool_search_output";
      if (!isSearchOutput) continue;
      const found = moreSpawnTools(item.tools, choices);
      if (found === null) continue;
      item.tools = found;
      isChanged = true;
    }
  }
  if (!isChanged) return text;
  return JSON.stringify(body);
}

/** 一组工具里的 spawn_agent（单独或在 namespace 里）补上模型；没有要补的为 null。 */
function moreSpawnTools(raw: unknown, choices: SpawnChoice[]): unknown[] | null {
  if (!Array.isArray(raw)) return null;
  let isChanged = false;
  for (const tool of raw) {
    if (!isRecord(tool)) continue;
    if (moreSpawnModels(tool, choices)) {
      isChanged = true;
      continue;
    }
    const isNamespace = tool.type === "namespace" && Array.isArray(tool.tools);
    if (!isNamespace) continue;
    const inner = moreSpawnTools(tool.tools, choices);
    if (inner === null) continue;
    tool.tools = inner;
    isChanged = true;
  }
  if (!isChanged) return null;
  return raw;
}

/** 是带 model 参数、说明里有 Codex 那段清单的 spawn_agent 时，补上清单里没有的；补了为 true。 */
function moreSpawnModels(tool: Record<string, unknown>, choices: SpawnChoice[]): boolean {
  const description = tool.description;
  if (typeof description !== "string") return false;
  const isCodexSpawn =
    tool.name === SPAWN_AGENT &&
    tool.type === "function" &&
    description.includes(CODEX_LIST_HEADER) &&
    !description.includes(SPAWN_MORE);
  if (!isCodexSpawn || !takesModel(tool.parameters)) return false;
  const lines: string[] = [];
  for (const choice of choices) {
    if (description.includes(`\`${choice.slug}\``)) continue;
    const isNamed = choice.name !== "" && choice.name !== choice.slug;
    let line = `- \`${choice.slug}\``;
    if (isNamed) line += `: ${choice.name}`;
    lines.push(line);
    if (lines.length === SPAWN_MOST) break;
  }
  if (lines.length === 0) return false;
  const end = codexListEnd(description);
  const added = `\n${SPAWN_MORE}\n${lines.join("\n")}`;
  tool.description = description.slice(0, end) + added + description.slice(end);
  return true;
}

function takesModel(parameters: unknown): boolean {
  return (
    isRecord(parameters) && isRecord(parameters.properties) && "model" in parameters.properties
  );
}

/** Codex 那段清单的末尾：标题那一行之后，每个「- `slug`…」占一行，接在最后一行后面、下文之前。 */
function codexListEnd(description: string): number {
  let end = description.indexOf(CODEX_LIST_HEADER);
  for (;;) {
    const newline = description.indexOf("\n", end);
    if (newline < 0) return description.length;
    end = newline;
    if (!description.startsWith("- `", end + 1)) return end;
    end += 1;
  }
}
