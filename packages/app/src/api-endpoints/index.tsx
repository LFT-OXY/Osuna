export { selectActiveApiEndpoint, selectInheritedApiEndpoint } from "./internal/notices";
export { modelFamilyOf } from "./internal/model-families";

/** 能切第三方接口、Osuna 对话里换成接口模型的内置提供方；自定义提供方不在此列。 */
const API_ENDPOINT_PROVIDERS = new Set(["claude", "codex"]);

export function supportsApiEndpoints(provider: string): boolean {
  return API_ENDPOINT_PROVIDERS.has(provider);
}

/**
 * 提供方页要不要有「第三方接口」区：Claude Code、Codex 一直有；Pi 要主机声明 apiEndpointPi
 * （老主机不认 provider "pi"，不显示用不了的开关）。
 */
export function showsApiEndpointSettings(input: {
  provider: string;
  hostSupportsPi: boolean;
}): boolean {
  if (supportsApiEndpoints(input.provider)) return true;
  return input.provider === "pi" && input.hostSupportsPi;
}
