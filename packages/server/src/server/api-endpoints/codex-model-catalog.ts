import { CODEX_BASE_INSTRUCTIONS } from "./codex-base-instructions.js";
import { usableModels } from "./host-endpoints.js";
import type { ApiEndpointState } from "./store.js";

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
 */

interface CatalogModel {
  slug: string;
  displayName: string;
  visibility: "list" | "hide";
}

export function buildCodexModelCatalog(state: ApiEndpointState): string {
  const models: CatalogModel[] = usableModels(state).map((model) => ({
    slug: model.id,
    displayName: model.label ?? model.id,
    visibility: "list",
  }));
  for (const endpoint of state.endpoints) {
    if (!endpoint.enabled) continue;
    for (const model of endpoint.models) {
      const slug = `${endpoint.slug}/${model.id}`;
      // 模型名本身带斜杠时可能和某家的 `标识/模型名` 撞上；Codex 按 slug 找条目，同名只留一条。
      if (models.some((existing) => existing.slug === slug)) continue;
      models.push({ slug, displayName: model.label ?? model.id, visibility: "hide" });
    }
  }
  return `${JSON.stringify({ models: models.map(toEntry) }, null, 2)}\n`;
}

function toEntry(model: CatalogModel, index: number) {
  return {
    slug: model.slug,
    display_name: model.displayName,
    description: null,
    base_instructions: CODEX_BASE_INSTRUCTIONS,
    default_reasoning_level: null,
    supported_reasoning_levels: [],
    shell_type: "unified_exec",
    visibility: model.visibility,
    supported_in_api: true,
    priority: index + 1,
    availability_nux: null,
    upgrade: null,
    include_apps_usage_instructions: false,
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: null,
    truncation_policy: { mode: "bytes", limit: 10_000 },
    context_window: 272_000,
    max_context_window: 272_000,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    supports_parallel_tool_calls: true,
    supports_reasoning_summaries: false,
  };
}
