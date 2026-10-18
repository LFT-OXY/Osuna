// 规则移植自 magpie（https://github.com/yetone/magpie，internal/agent/claude.go 的 claude1M / claudeWindow /
// claudeOutput / claudeCaps / claudeCapabilities，含提交 d1c485f7 的「到 max 无 xhigh 也报 xhigh」）。Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { bareModelId, type ModelFacts } from "./model-facts.js";

/*
 * Claude Code 不认识接口模型（非 Claude 官方名）时按「上下文 20 万、回复最多 32000、不能调档位」处理。
 * 这里按已知的模型资料算出要告诉它的：模型名后的 [1m] 和 settings.json env 里的三个值。不知道的不写。
 */

export const CLAUDE_HINT_ENV_KEYS = [
  "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
  "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
  "CLAUDE_CODE_MODEL_CAPABILITIES",
] as const;
type ClaudeHintEnvKey = (typeof CLAUDE_HINT_ENV_KEYS)[number];
export type ClaudeHintEnv = Partial<Record<ClaudeHintEnvKey, string>>;

/** Claude Code 看到的模型名（起始模型是模型名，/model 列表里是 `标识/模型名`）和它的已知资料。 */
export interface ClaudeHintModel {
  id: string;
  facts: ModelFacts;
}

const ONE_MILLION = 1_000_000;
const ONE_MILLION_MARK = "[1m]";
// 不认识的模型不设 CLAUDE_CODE_MAX_OUTPUT_TOKENS 时 Claude Code 要的回复长度（2.1.299）。
const UNKNOWN_MODEL_OUTPUT = 32_000;
const CLAUDE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
// CLAUDE_CODE_MODEL_CAPABILITIES 的长度上限，放不下的模型留给 Claude Code 自己判断。
const CAPABILITIES_MAX_LENGTH = 8000;

/**
 * 已知上下文 ≥ 100 万的模型名后加 [1m]，发请求前 Claude Code 会去掉。不认识的名字只有带它才按 100 万算；
 * Claude 模型也加：Opus 4.6 这类要带 [1m] 才到 100 万，原生 100 万的带上也一样。
 */
export function markOneMillion(model: ClaudeHintModel): string {
  return isOneMillion(model) ? `${model.id}${ONE_MILLION_MARK}` : model.id;
}

/**
 * 三个 env 值，只给知道的：
 * - 上下文：按起始模型；它带 [1m] 或是 Claude 模型时不写（一个值管所有不带 [1m] 的不认识模型）。
 * - 回复上限：起始模型是 Claude 模型时不写（一个值管所有请求）；否则取起始模型和 /model 列表里所有非 Claude 模型的
 *   最小值，有一个不知道、或不超过 32000 也不写。
 * - 思考档位：每个有档位的非 Claude 模型一段，起始模型在前。
 */
export function claudeHintEnv(input: {
  start: ClaudeHintModel;
  listed: ClaudeHintModel[];
}): ClaudeHintEnv {
  const env: ClaudeHintEnv = {};
  const { start } = input;
  const isStartClaude = isClaudeModel(start.id);
  const startContext = start.facts.context;
  const isStartWindowNeeded = !isStartClaude && !isOneMillion(start);
  if (startContext !== undefined && isStartWindowNeeded) {
    env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(startContext);
  }
  const models = [start, ...input.listed].filter((model) => !isClaudeModel(model.id));
  const output = isStartClaude ? undefined : leastOutput(models);
  if (output !== undefined && output > UNKNOWN_MODEL_OUTPUT) {
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(output);
  }
  const capabilities = capabilitiesOf(models);
  if (capabilities !== "") env.CLAUDE_CODE_MODEL_CAPABILITIES = capabilities;
  return env;
}

function leastOutput(models: ClaudeHintModel[]): number | undefined {
  let least: number | undefined;
  for (const model of models) {
    const output = model.facts.output;
    if (output === undefined) return undefined;
    if (least === undefined || output < least) least = output;
  }
  return least;
}

function capabilitiesOf(models: ClaudeHintModel[]): string {
  const seen = new Set<string>();
  let value = "";
  for (const model of models) {
    // Claude Code 把模型转成小写再和模式比较，模式本身不转。
    const pattern = model.id.toLowerCase();
    if (seen.has(pattern) || /[;=,]/.test(pattern) || pattern.endsWith("*")) continue;
    seen.add(pattern);
    const caps = capabilityNames(model.facts.efforts ?? []);
    if (caps.length === 0) continue;
    const segment = `${value === "" ? "" : ";"}${pattern}=${caps.join(",")}`;
    if (value.length + segment.length > CAPABILITIES_MAX_LENGTH) break;
    value += segment;
  }
  return value;
}

function capabilityNames(efforts: string[]): string[] {
  if (!efforts.some((effort) => CLAUDE_EFFORTS.has(effort))) return [];
  const caps = ["effort"];
  // 能到 max 却没有 xhigh 的也报 xhigh：Claude Code 的 Ultra Code 要 xhigh_effort，中转站会把 xhigh 按 max 发出。
  if (efforts.includes("xhigh") || efforts.includes("max")) caps.push("xhigh_effort");
  if (efforts.includes("max")) caps.push("max_effort");
  return caps;
}

function isOneMillion(model: ClaudeHintModel): boolean {
  return (model.facts.context ?? 0) >= ONE_MILLION;
}

/** 模型名（去掉接口前缀）以 claude 开头：Claude Code 自己认识它的窗口、回复上限和档位。 */
function isClaudeModel(id: string): boolean {
  return bareModelId(id).startsWith("claude");
}
