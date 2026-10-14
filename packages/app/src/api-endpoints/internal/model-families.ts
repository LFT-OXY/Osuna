// 前缀表照 magpie（https://github.com/yetone/magpie，internal/agent/icons.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { ModelFamilyIconName } from "@/assets/model-family-icons";

/*
 * 模型家族：按模型名前缀认出的厂商，只用来在接口详情页分组挑模型、给模型名配图标。
 * 中转站常把模型写成「厂商/模型」，取最后一个斜杠之后的部分；认不出的归「其他」。
 */

export type ModelFamilyId =
  | "claude"
  | "gpt"
  | "gemini"
  | "deepseek"
  | "kimi"
  | "glm"
  | "qwen"
  | "grok"
  | "mistral"
  | "minimax"
  | "mimo"
  | "step"
  | "other";

export interface ModelFamily {
  id: ModelFamilyId;
  // 厂商名不翻译；为 null 的家族名走 i18n（settings.apiEndpoints.models.family.<id>）。
  name: string | null;
  icon: ModelFamilyIconName | null;
  prefixes: readonly string[];
}

// 顺序即详情页左栏的顺序：常用的七家，其余认得出的，最后「其他」。
export const MODEL_FAMILIES: readonly ModelFamily[] = [
  { id: "claude", name: "Claude", icon: "claude", prefixes: ["claude"] },
  { id: "gpt", name: "GPT", icon: "openai", prefixes: ["gpt", "o1", "o3", "o4", "codex"] },
  { id: "gemini", name: "Gemini", icon: "gemini", prefixes: ["gemini", "gemma"] },
  { id: "deepseek", name: "DeepSeek", icon: "deepseek", prefixes: ["deepseek"] },
  { id: "kimi", name: "Kimi", icon: "kimi", prefixes: ["kimi", "moonshot"] },
  { id: "glm", name: "GLM", icon: "zhipu", prefixes: ["glm"] },
  { id: "qwen", name: null, icon: "qwen", prefixes: ["qwen", "qwq"] },
  { id: "grok", name: "Grok", icon: "xai", prefixes: ["grok"] },
  {
    id: "mistral",
    name: "Mistral",
    icon: "mistral",
    prefixes: ["mistral", "codestral", "devstral", "magistral"],
  },
  { id: "minimax", name: "MiniMax", icon: "minimax", prefixes: ["minimax"] },
  { id: "mimo", name: "MiMo", icon: "mimocode", prefixes: ["mimo", "xiaomi"] },
  { id: "step", name: "Step", icon: "stepfun", prefixes: ["step"] },
  { id: "other", name: null, icon: null, prefixes: [] },
];

export function modelFamilyOf(modelId: string): ModelFamilyId {
  const lower = modelId.toLowerCase();
  const bare = lower.slice(lower.lastIndexOf("/") + 1);
  const family = MODEL_FAMILIES.find((candidate) =>
    candidate.prefixes.some((prefix) => bare.startsWith(prefix)),
  );
  return family?.id ?? "other";
}
