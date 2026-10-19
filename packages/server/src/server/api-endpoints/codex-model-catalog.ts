// 条目按模型资料的写法与默认推理档的取法移植自 magpie（https://github.com/yetone/magpie，internal/codexcat/codexcat.go 的
// entriesAt、DefaultEffort、ModelDefault、Stamp，internal/catalog/catalog.go 的 EffortRank、NearestEffort，internal/catalog/live.go 的 levelsOf）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。档位说明文字取自 openai/codex（Apache-2.0），同见该文件。

import { CODEX_BASE_INSTRUCTIONS } from "./codex-base-instructions.js";
import { endpointModelGroups, usableModels } from "./host-endpoints.js";
import type { ModelFacts } from "./model-facts.js";
import type { ApiEndpointState, StoredApiEndpoint } from "./store.js";

/*
 * Codex 的 model_catalog_json 文件（ADR 0007）：给了它，Codex 的模型列表就完全以它为准，
 * /model 里能选接口的模型，每轮也不再报「未知模型」。
 * 列表里是开着的接口的已选模型、去重后的光秃秃名字；各家的 `标识/模型名` 隐藏，只供 Osuna 会话直达某家。
 *
 * 每个条目都必须带指令（base_instructions），否则整个目录读不进来（codex-rs/protocol/src/openai_models.rs
 * 的 deserialize_model_infos_with_legacy_base，提交 90f00bd）。
 * 条目字段照 Codex 对未知模型的回退元数据（codex-rs/models-manager/src/model_info.rs），Codex 今天就是这样跑接口模型的；
 * 另加两个不同版本要求必填的字段（supports_parallel_tool_calls 从 0.147 起、supports_reasoning_summaries 在 0.145 以前），
 * 少一个整个目录都读不进来。
 *
 * 上下文、推理档位、能否看图按这家这个模型的已知资料写（接口清单在前，models.dev 补上），照 magpie entriesAt；
 * 逐项查不到的照旧：上下文 272K、四档固定（说明文字取 Codex 自带目录）、不写 input_modalities（Codex 缺省当能看图）。
 * Codex 的条目没有回复上限这一项（ModelInfo 里没有），资料里的 output 不写。
 * 有了档位，Codex 在 /model 换模型时才会把不支持的档位换掉（codex-rs session/turn_context.rs 的 with_model）。
 * 默认档取离用户 model_reasoning_effort 最近的一档，免得换到接口模型时档位被打回 medium。
 */

const FALLBACK_LEVELS = ["low", "medium", "high", "xhigh"];
const FALLBACK_CONTEXT = 272_000;

// Codex 自带目录里这几档的说明；别的档位 magpie 写空串，Codex 只要求有这个字段。
const LEVEL_DESCRIPTIONS: Record<string, string> = {
  low: "Fast responses with lighter reasoning",
  medium: "Balances speed and reasoning depth for everyday tasks",
  high: "Greater reasoning depth for complex problems",
  xhigh: "Extra high reasoning depth for complex problems",
};

// 由弱到强（magpie EffortRank）。
const EFFORT_RANK = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

export type CodexModelFactsLookup = (endpoint: StoredApiEndpoint, modelId: string) => ModelFacts;

/**
 * `reasoningEffort` 是 config.toml 顶层的 model_reasoning_effort，没设或读不出为 null。
 * `factsFor` 查这家这个模型的已知资料；光秃秃的名字按接口顺序里最靠前、开着、选了它的那家查（中转站也先发给那家）。
 * `marksAgentsV1` 是「Codex Subagent 可用任意模型」：每个条目写 multi_agent_version = "v1"。
 */
export function buildCodexModelCatalog(input: {
  state: ApiEndpointState;
  reasoningEffort: string | null;
  factsFor: CodexModelFactsLookup;
  marksAgentsV1: boolean;
}): string {
  const { state, reasoningEffort, factsFor, marksAgentsV1 } = input;
  const models: Array<
    Omit<CodexModelEntryInput, "priority" | "reasoningEffort" | "marksAgentsV1">
  > = [];
  for (const model of usableModels(state)) {
    const endpoint = state.endpoints.find(
      (entry) => entry.enabled && entry.models.some((own) => own.id === model.id),
    );
    models.push({
      slug: model.id,
      displayName: model.label ?? model.id,
      visibility: "list",
      facts: endpoint ? factsFor(endpoint, model.id) : {},
    });
  }
  for (const endpoint of state.endpoints) {
    if (!endpoint.enabled) continue;
    for (const model of endpoint.models) {
      const slug = `${endpoint.slug}/${model.id}`;
      // 模型名本身带斜杠时可能和某家的 `标识/模型名` 撞上；Codex 按 slug 找条目，同名只留一条。
      if (models.some((existing) => existing.slug === slug)) continue;
      models.push({
        slug,
        displayName: model.label ?? model.id,
        visibility: "hide",
        facts: factsFor(endpoint, model.id),
      });
    }
  }
  const entries = models.map((model, index) =>
    codexModelEntry({ ...model, priority: index + 1, reasoningEffort, marksAgentsV1 }),
  );
  return `${JSON.stringify({ models: entries }, null, 2)}\n`;
}

/**
 * 用 ChatGPT 登录的 Codex 的 /model 里接在 ChatGPT 自带模型后面的接口模型（ADR 0010）：开着的接口的已选模型，
 * 写成「接口标识/模型名」，显示成「模型名 (接口名)」（两家选了同一个模型时分得开），顺序同聊天模型选择器，
 * 能力按这家这个模型的已知资料写。priority 从 1 起，中转站合并清单时再排到 ChatGPT 自带模型之后。
 */
export function codexEndpointEntries(input: {
  state: ApiEndpointState;
  // config.toml 顶层的 model_reasoning_effort，没设为 null。
  reasoningEffort: string | null;
  factsFor: CodexModelFactsLookup;
  // 「Codex Subagent 可用任意模型」开着。
  marksAgentsV1: boolean;
}): CodexModelEntry[] {
  const listed = endpointModelGroups(input.state).flatMap((group) =>
    group.models.map(({ id, model }) => ({ id, model, endpoint: group.endpoint })),
  );
  return listed.map(({ id, model, endpoint }, index) =>
    codexModelEntry({
      slug: id,
      displayName: `${model.label ?? model.id} (${endpoint.name})`,
      visibility: "list",
      priority: index + 1,
      facts: input.factsFor(endpoint, model.id),
      reasoningEffort: input.reasoningEffort,
      marksAgentsV1: input.marksAgentsV1,
    }),
  );
}

export type CodexModelEntry = ReturnType<typeof codexModelEntry>;

export interface CodexModelEntryInput {
  slug: string;
  displayName: string;
  visibility: "list" | "hide";
  priority: number;
  facts: ModelFacts;
  // config.toml 顶层的 model_reasoning_effort，没设为 null。
  reasoningEffort: string | null;
  // 「Codex Subagent 可用任意模型」：写 multi_agent_version = "v1"，Codex 给这个模型的 Subagent 发明文任务（magpie Stamp）。
  marksAgentsV1: boolean;
}

/**
 * 多 Agent 版本（magpie CodexAgentsV1）：Codex 自己的 multi_agent_v2 没开时，按条目的 multi_agent_version 选 V1 或 V2
 * （codex-rs core/src/config/mod.rs multi_agent_version_for_model）。V1 的任务以明文交给 Subagent，接口模型读得懂；
 * V2 的任务由 OpenAI 服务端封存，只有 ChatGPT 账号的模型打得开。
 */
export const AGENTS_V1 = { multi_agent_version: "v1" };
const UNMARKED = {};

/** Codex 模型目录（models.json 格式）的一个条目。 */
export function codexModelEntry(input: CodexModelEntryInput) {
  const { facts } = input;
  const agentsVersion = input.marksAgentsV1 ? AGENTS_V1 : UNMARKED;
  const levels = codexModelLevels(facts);
  const context = facts.context ?? FALLBACK_CONTEXT;
  return {
    slug: input.slug,
    display_name: input.displayName,
    description: null,
    base_instructions: CODEX_BASE_INSTRUCTIONS,
    default_reasoning_level:
      levels.length > 0 ? codexDefaultLevel(levels, input.reasoningEffort) : null,
    supported_reasoning_levels: levels.map((effort) => ({
      effort,
      description: LEVEL_DESCRIPTIONS[effort] ?? "",
    })),
    shell_type: "unified_exec",
    visibility: input.visibility,
    supported_in_api: true,
    priority: input.priority,
    availability_nux: null,
    upgrade: null,
    include_apps_usage_instructions: false,
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: null,
    truncation_policy: { mode: "bytes", limit: 10_000 },
    context_window: context,
    // 查不到时照 Codex 回退元数据两项都写；查到的就是整个窗口，照 magpie 不另写可放大到的上限。
    ...(facts.context === undefined ? { max_context_window: FALLBACK_CONTEXT } : {}),
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    ...(facts.images === undefined
      ? {}
      : { input_modalities: facts.images ? ["text", "image"] : ["text"] }),
    supports_parallel_tool_calls: true,
    // 0.145 以前的 Codex 只对写了 true 的模型发档位（magpie Summaries）：有档位才写 true。
    supports_reasoning_summaries: levels.length > 0,
    ...agentsVersion,
  };
}

/** 这个模型在 Codex 里能选的档位：查不到资料时四档固定。 */
export function codexModelLevels(facts: ModelFacts): string[] {
  return facts.efforts === undefined ? FALLBACK_LEVELS : codexReasoningLevels(facts.efforts);
}

/**
 * 接口清单或 models.dev 的档位名对到 Codex 收的档位名（magpie levelsOf）。
 * Codex 认得的名字之外，任何非空字符串它都当作这个模型自己的档位收下（codex-rs openai_models.rs ReasoningEffort::Custom），
 * 所以名字原样保留、顺序不变；只去掉首尾空白、空的（空串会让整个目录读不进来）与重复的。
 */
export function codexReasoningLevels(efforts: readonly string[]): string[] {
  const levels: string[] = [];
  for (const effort of efforts) {
    const name = effort.trim();
    if (name !== "" && !levels.includes(name)) levels.push(name);
  }
  return levels;
}

/**
 * 新会话从哪一档起（magpie ModelDefault）：模型有用户设的那档就用它，否则取最近的一档（一样近取强的，
 * 不取 none）；没设、或设的不是认得的档位，取 medium，没有取 high，再没有取列表第一档。
 */
export function codexDefaultLevel(levels: readonly string[], chosen: string | null): string {
  const want = chosen?.trim() ?? "";
  if (want !== "") {
    const nearest = nearestLevel(want, levels);
    if (nearest !== null) return nearest;
  }
  for (const middle of ["medium", "high"]) {
    if (levels.includes(middle)) return middle;
  }
  return levels[0] ?? "medium";
}

function nearestLevel(want: string, levels: readonly string[]): string | null {
  if (levels.includes(want)) return want;
  const at = EFFORT_RANK.indexOf(want);
  if (at < 0) return null;
  let best: string | null = null;
  let distance = Infinity;
  for (const level of levels) {
    const rank = EFFORT_RANK.indexOf(level);
    if (rank < 0 || level === "none") continue;
    const gap = Math.abs(rank - at);
    if (gap < distance || (gap === distance && rank > at)) {
      best = level;
      distance = gap;
    }
  }
  return best;
}
