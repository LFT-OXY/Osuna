import type { AgentFeature, AgentModelDefinition } from "@getpaseo/protocol/agent-types";
import type { TFunction } from "i18next";
import { i18n } from "@/i18n/i18next";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import {
  FAST_MODE_FEATURE_ID,
  PLAN_MODE_FEATURE_ID,
  SPEED_FEATURE_ID,
} from "@/agent-controls/policy";

export type ExplainedAgentControl = "mode" | "model" | "thinking";
export type FeatureHighlightColor = "blue" | "default" | "green" | "providerBrand";
export type AgentControlHintKey =
  | "agentControls.hints.thinking"
  | "agentControls.hints.model"
  | "agentControls.hints.mode";

export function getAgentControlHintKey(selector: ExplainedAgentControl): AgentControlHintKey {
  switch (selector) {
    case "thinking":
      return "agentControls.hints.thinking";
    case "model":
      return "agentControls.hints.model";
    case "mode":
      return "agentControls.hints.mode";
    default:
      throw new Error("unreachable");
  }
}

export function normalizeModelId(modelId: string | null | undefined): string | null {
  const normalized = typeof modelId === "string" ? modelId.trim() : "";
  if (!normalized) {
    return null;
  }
  return normalized;
}

export function getFeatureTooltip(feature: Pick<AgentFeature, "label" | "tooltip">): string {
  return feature.tooltip ?? feature.label;
}

// daemon 给 Codex 速度菜单的文字是英文，档位名来自模型目录。功能名、默认档与这两个已知档位按界面语言显示，
// 模型目录里别的档位名原样（docs/i18n.md「Translation Scope」的例外）。
const SPEED_TIER_LABEL_KEYS: Record<
  string,
  "agentControls.speed.fast" | "agentControls.speed.ultrafast"
> = {
  fast: "agentControls.speed.fast",
  ultrafast: "agentControls.speed.ultrafast",
};

export function localizeSpeedFeature(feature: AgentFeature, t: TFunction): AgentFeature {
  if (feature.id !== SPEED_FEATURE_ID || feature.type !== "select") {
    return feature;
  }
  return {
    ...feature,
    label: t("agentControls.speed.label"),
    tooltip: t("agentControls.speed.select"),
    options: feature.options.map((option) => {
      if (option.isDefault) {
        return { ...option, label: t("agentControls.speed.normal") };
      }
      const key = SPEED_TIER_LABEL_KEYS[option.label.trim().toLowerCase()];
      return key ? { ...option, label: t(key) } : option;
    }),
  };
}

export function isFeatureActive(feature: AgentFeature): boolean {
  if (feature.type === "toggle") return feature.value;
  const selectedOption = feature.options.find((option) => option.id === feature.value);
  return selectedOption !== undefined && !selectedOption.isDefault;
}

export function getFeatureHighlightColor(featureId: string): FeatureHighlightColor {
  switch (featureId) {
    case FAST_MODE_FEATURE_ID:
    case SPEED_FEATURE_ID:
      return "providerBrand";
    case "auto_accept":
      return "green";
    case PLAN_MODE_FEATURE_ID:
      return "blue";
    default:
      return "default";
  }
}

function findModelById(
  models: AgentModelDefinition[] | null,
  modelId: string | null,
): AgentModelDefinition | null {
  if (!models || !modelId) {
    return null;
  }
  return (
    models.find((model) => model.id === modelId) ??
    models.find((model) => model.aliases?.includes(modelId)) ??
    null
  );
}

function getFallbackModel(models: AgentModelDefinition[] | null): AgentModelDefinition | null {
  return models?.find((model) => model.isDefault) ?? models?.[0] ?? null;
}

function resolvePreferredModelId(
  runtimeSelectedModel: AgentModelDefinition | null,
  normalizedConfiguredModelId: string | null,
  normalizedRuntimeModelId: string | null,
): string | null {
  return runtimeSelectedModel?.id ?? normalizedConfiguredModelId ?? normalizedRuntimeModelId;
}

function pickSelectedModel(
  models: AgentModelDefinition[] | null,
  preferredModelId: string | null,
  fallbackModel: AgentModelDefinition | null,
): AgentModelDefinition | null {
  if (!preferredModelId) {
    return fallbackModel;
  }
  return findModelById(models, preferredModelId);
}

function resolveThinkingId(
  runtimeThinkingOptionId: string | null | undefined,
  explicitThinkingOptionId: string | null | undefined,
  selectedModel: AgentModelDefinition | null,
): string | null {
  const runtimeThinkingOption = selectedModel?.thinkingOptions?.find(
    (option) => option.id === runtimeThinkingOptionId,
  );
  if (runtimeThinkingOption) {
    return runtimeThinkingOption.id;
  }
  if (explicitThinkingOptionId && explicitThinkingOptionId !== "default") {
    return explicitThinkingOptionId;
  }
  return selectedModel?.defaultThinkingOptionId ?? null;
}

type ThinkingOption = NonNullable<AgentModelDefinition["thinkingOptions"]>[number];

function resolveEffectiveThinking(
  thinkingOptions: ThinkingOption[] | null,
  resolvedThinkingId: string | null,
): ThinkingOption | null {
  const selectedThinking =
    thinkingOptions?.find((option) => option.id === resolvedThinkingId) ?? null;
  return selectedThinking ?? thinkingOptions?.[0] ?? null;
}

function resolveModelDisplay(
  selectedModel: AgentModelDefinition | null,
  preferredModelId: string | null,
  fallbackModel: AgentModelDefinition | null,
  unknownModelLabel: string,
): { activeModelId: string | null; displayModel: string } {
  return {
    activeModelId: selectedModel?.id ?? preferredModelId ?? null,
    displayModel:
      selectedModel?.label ?? preferredModelId ?? fallbackModel?.label ?? unknownModelLabel,
  };
}

function resolveThinkingDisplay(
  effectiveThinking: ThinkingOption | null,
  selectedThinkingId: string | null,
  unknownThinkingLabel: string,
): string {
  if (effectiveThinking) {
    return formatThinkingOptionLabel(effectiveThinking);
  }

  if (selectedThinkingId) {
    return formatThinkingOptionLabel({ id: selectedThinkingId });
  }

  return unknownThinkingLabel;
}

export function resolveAgentModelSelection(input: {
  models: AgentModelDefinition[] | null;
  runtimeModelId: string | null | undefined;
  configuredModelId: string | null | undefined;
  runtimeThinkingOptionId: string | null | undefined;
  explicitThinkingOptionId: string | null | undefined;
}) {
  const {
    models,
    runtimeModelId,
    configuredModelId,
    runtimeThinkingOptionId,
    explicitThinkingOptionId,
  } = input;
  const normalizedRuntimeModelId = normalizeModelId(runtimeModelId);
  const normalizedConfiguredModelId = normalizeModelId(configuredModelId);

  const runtimeSelectedModel = findModelById(models, normalizedRuntimeModelId);
  const preferredModelId = resolvePreferredModelId(
    runtimeSelectedModel,
    normalizedConfiguredModelId,
    normalizedRuntimeModelId,
  );
  const fallbackModel = getFallbackModel(models);
  const selectedModel = pickSelectedModel(models, preferredModelId, fallbackModel);

  const { activeModelId, displayModel } = resolveModelDisplay(
    selectedModel,
    preferredModelId,
    fallbackModel,
    i18n.t("agentControls.model.unknown"),
  );

  const thinkingOptions = selectedModel?.thinkingOptions ?? null;
  const resolvedThinkingId = resolveThinkingId(
    runtimeThinkingOptionId,
    explicitThinkingOptionId,
    selectedModel,
  );
  const effectiveThinking = resolveEffectiveThinking(thinkingOptions, resolvedThinkingId);
  const selectedThinkingId = effectiveThinking?.id ?? resolvedThinkingId;
  const displayThinking = resolveThinkingDisplay(
    effectiveThinking,
    selectedThinkingId,
    i18n.t("agentControls.thinking.unknown"),
  );

  return {
    selectedModel,
    activeModelId,
    displayModel,
    thinkingOptions,
    selectedThinkingId,
    displayThinking,
  };
}
