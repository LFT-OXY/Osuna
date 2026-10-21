// 规则移植自 magpie（https://github.com/yetone/magpie，internal/agent/claude.go 的 claude1M / claudeWindow /
// claudeOutput / claudeCaps / claudeCapabilities / writeCompact，含提交 d1c485f7 的「到 max 无 xhigh 也报 xhigh」）。Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { compactThreshold } from "@getpaseo/protocol/api-endpoint/model-settings";
import type { ApiEndpointLongConversations } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { CLAUDE_EFFORTS, claudeEffortsFor } from "./claude-model-name.js";
import { bareModelId, type EndpointModelFacts } from "./model-facts.js";

/*
 * Claude Code 不认识接口模型（非 Claude 官方名）时按「上下文 20 万、回复最多 32000、不能调档位」处理。
 * 这里按已知的模型资料算出要告诉它的：模型名后的 [1m] 和 settings.json env 里的四个值。不知道的不写。
 */

export const CLAUDE_HINT_ENV_KEYS = [
  "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
  "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
  "CLAUDE_CODE_MODEL_CAPABILITIES",
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
] as const;
type ClaudeHintEnvKey = (typeof CLAUDE_HINT_ENV_KEYS)[number];
export type ClaudeHintEnv = Partial<Record<ClaudeHintEnvKey, string>>;

/** Claude Code 看到的模型名（起始模型是模型名，/model 列表里是 `标识/模型名`）和它的已知资料。 */
export interface ClaudeHintModel {
  id: string;
  facts: EndpointModelFacts;
}

const ONE_MILLION = 1_000_000;
export const ONE_MILLION_MARK = "[1m]";
// 不认识的模型不设 CLAUDE_CODE_MAX_OUTPUT_TOKENS 时 Claude Code 要的回复长度（2.1.299）。
const UNKNOWN_MODEL_OUTPUT = 32_000;
// CLAUDE_CODE_MODEL_CAPABILITIES 的长度上限，放不下的模型留给 Claude Code 自己判断。
const CAPABILITIES_MAX_LENGTH = 8000;

/**
 * 已知上下文 ≥ 100 万的模型名后加 [1m]，发请求前 Claude Code 会去掉。不认识的名字只有带它才按 100 万算；
 * Claude 模型也加：Opus 4.6 这类要带 [1m] 才到 100 万，原生 100 万的带上也一样。
 */
export function markOneMillion(model: ClaudeHintModel): string {
  return isOneMillion(model) ? `${model.id}${ONE_MILLION_MARK}` : model.id;
}

/** 起始模型、后台小任务与 Subagent 模型、/model 里的接口模型（都已是写给 Claude Code 的写法）与整台主机的长对话设置。 */
export interface ClaudeHintInput {
  start: ClaudeHintModel;
  // magpie 的档位模型（tiers）：Osuna 只写后台小任务模型（ANTHROPIC_SMALL_FAST_MODEL，haiku 那一档）。
  tiers: ClaudeHintModel[];
  subagent: ClaudeHintModel | null;
  listed: ClaudeHintModel[];
  longConversations: ApiEndpointLongConversations | undefined;
}

export interface ClaudeHints {
  env: ClaudeHintEnv;
  // 压缩阈值是整台主机的默认（272K）：settings.json 里用户自己给主模型设了 autoCompactWindow 时让给它，不写（magpie #876）。
  compactYieldsToOwn: boolean;
}

/**
 * 照 magpie writeWindow、claudeOutput、writeCaps、writeCompact 算出的四个 env 值，只给知道的：
 * - 上下文（claudeWindow）：起始模型的窗口（Claude 模型也写）；起始模型带 [1m] 时取档位模型里不带 [1m] 的最小窗口。
 * - 回复上限（claudeOutput）：起始模型是 Claude 模型时不写；否则取起始、档位与 Subagent 模型里非 Claude 模型的最小值，
 *   有一个不知道、或不超过 32000 也不写。/model 里的其余模型不算。
 * - 思考档位（claudeCapabilities）：每个有档位的模型一段，Claude 模型只报 Claude Code 给它的档位；起始与档位模型在前。
 * - 压缩阈值（writeCompact）：起始模型自己（或整家默认）的压缩阈值在前，Claude 模型也算；否则 Claude 模型不写，
 *   别家模型按整台主机的长对话设置——「完整窗口」不写，全局压缩阈值，没设是 272K；没设全局阈值时手填了窗口的模型不写。
 */
export function claudeHints(input: ClaudeHintInput): ClaudeHints {
  const env: ClaudeHintEnv = {};
  const { start } = input;
  const window = windowOf(input);
  if (window !== undefined) env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(window);
  const isStartClaude = isClaudeModel(start.id);
  const running = [start, ...input.tiers, ...(input.subagent ? [input.subagent] : [])];
  const output = isStartClaude
    ? undefined
    : leastOutput(running.filter((m) => !isClaudeModel(m.id)));
  if (output !== undefined && output > UNKNOWN_MODEL_OUTPUT) {
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(output);
  }
  const capabilities = capabilitiesOf([start, ...input.tiers, ...input.listed]);
  if (capabilities !== "") env.CLAUDE_CODE_MODEL_CAPABILITIES = capabilities;
  const compact = compactOf(input);
  if (compact.value !== undefined) env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(compact.value);
  return { env, compactYieldsToOwn: compact.yieldsToOwn };
}

/** 一个值管所有不带 [1m] 的模型：起始模型的；它带 [1m] 时取不带的档位模型里最小的，免得哪个超出自己的窗口。 */
function windowOf(input: ClaudeHintInput): number | undefined {
  if (!isOneMillion(input.start)) return input.start.facts.context;
  let least: number | undefined;
  for (const tier of input.tiers) {
    const context = tier.facts.context;
    if (context === undefined || isOneMillion(tier)) continue;
    if (least === undefined || context < least) least = context;
  }
  return least;
}

/** Claude 模型没设自己的压缩阈值时跑到它自己的窗口（Anthropic 自家就这样跑）；别家的照 compactThreshold。 */
function compactOf(input: ClaudeHintInput): { value: number | undefined; yieldsToOwn: boolean } {
  const { facts } = input.start;
  const isOwn = facts.compact !== undefined;
  if (!isOwn && isClaudeModel(input.start.id)) return { value: undefined, yieldsToOwn: false };
  const value = compactThreshold({ facts, longConversations: input.longConversations });
  // 只有 272K 这个默认让给用户在 Claude Code 里设的 autoCompactWindow；模型自己的和打了的全局阈值不让。
  const isDefault = !isOwn && input.longConversations?.compactAt === undefined;
  return { value, yieldsToOwn: value !== undefined && isDefault };
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
    // Claude Code 去掉 [1m]、把模型转成小写再和模式比较，模式本身不转。
    const pattern = withoutOneMillionMark(model.id).toLowerCase();
    if (seen.has(pattern) || /[;=,]/.test(pattern) || pattern.endsWith("*")) continue;
    seen.add(pattern);
    const caps = capabilityNames({ efforts: model.facts.efforts ?? [], id: pattern });
    if (caps.length === 0) continue;
    const segment = `${value === "" ? "" : ";"}${pattern}=${caps.join(",")}`;
    if (value.length + segment.length > CAPABILITIES_MAX_LENGTH) break;
    value += segment;
  }
  return value;
}

/** Claude 模型只报 Claude Code 给它的档位（别家模型五档都给）。 */
function capabilityNames(input: { efforts: string[]; id: string }): string[] {
  const given = claudeEffortsFor(input.id);
  const efforts = input.efforts.filter((effort) => given.includes(effort));
  if (!efforts.some((effort) => CLAUDE_EFFORTS.includes(effort))) return [];
  const caps = ["effort"];
  // 能到 max 却没有 xhigh 的也报 xhigh：Claude Code 的 Ultra Code 要 xhigh_effort，中转站会把 xhigh 按 max 发出。
  // Claude Code 自己不给 xhigh 的 Claude 模型（Opus / Sonnet 4.6）不报。
  const isXhighReached = efforts.includes("xhigh") || efforts.includes("max");
  if (isXhighReached && given.includes("xhigh")) caps.push("xhigh_effort");
  if (efforts.includes("max")) caps.push("max_effort");
  return caps;
}

/** 去掉模型名后的 [1m]（Claude Code 发请求、比模型名前都先去掉它）。 */
export function withoutOneMillionMark(id: string): string {
  return id.endsWith(ONE_MILLION_MARK) ? id.slice(0, -ONE_MILLION_MARK.length) : id;
}

function isOneMillion(model: ClaudeHintModel): boolean {
  return (model.facts.context ?? 0) >= ONE_MILLION;
}

/** 模型名（去掉接口前缀）以 claude 开头：Claude Code 自己认识它的窗口、回复上限和档位。 */
function isClaudeModel(id: string): boolean {
  return bareModelId(id).startsWith("claude");
}
